import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { resolveConfig, type Config } from "../config.js";
import { loadStore, profileToConfig } from "../profiles.js";
import { createProvider } from "../model/index.js";
import { defaultRegistry } from "../tools/registry.js";
import { appendPromptBlocks, systemPrompt } from "../prompt.js";
import { loadSkills, formatSkillCatalog } from "../ext/skills.js";
import { newSession, saveSession } from "../sessions.js";
import { LocalMcpRuntime } from "../mcp/runtime.js";
import { runAgentLoop } from "../loop/agentLoop.js";
import { createGate, denyingConfirmer } from "../permissions/confirm.js";
import { PermissionPolicy } from "../permissions/policy.js";
import { cloneTodos, type TodoItem } from "../todos.js";
import { formatMemoryContext, retrieveMemoryContext } from "../memory/retrieve.js";
import {
  appendSchedulerLog,
  appendSchedulerRun,
  computeNextRunAt,
  loadSchedulerStore,
  saveSchedulerStore,
  schedulerRunnerLogPath,
  schedulerRunnerPidPath,
  updateJob,
} from "./store.js";
import type { ScheduledJob, SchedulerRunRecord } from "./types.js";

function resolveJobConfig(job: ScheduledJob): Config | null {
  if (job.profileName) {
    const store = loadStore();
    const profile = store.profiles[job.profileName];
    if (profile) return profileToConfig(profile, job.cwd);
  }
  return resolveConfig(job.cwd);
}

function isDue(job: ScheduledJob, now = new Date()): boolean {
  if (!job.enabled) return false;
  if (!job.nextRunAt) return false;
  return Date.parse(job.nextRunAt) <= now.getTime();
}

export async function runScheduledJob(job: ScheduledJob): Promise<SchedulerRunRecord> {
  const config = resolveJobConfig(job);
  if (!config) {
    throw new Error(`Could not resolve a profile/config for job "${job.name}".`);
  }
  const provider = createProvider(config);
  const registry = defaultRegistry({ bashTimeoutMs: config.bashTimeoutMs });
  const mcp = new LocalMcpRuntime(job.cwd);
  const history: import("../model/types.js").Message[] = [];
  let todos: TodoItem[] = [];
  const policy = new PermissionPolicy();
  const gate = createGate({
    policy,
    confirmer: denyingConfirmer,
    workdir: job.cwd,
  });
  const skillCatalog = formatSkillCatalog(loadSkills(job.cwd));
  const memoryBlock = config.memoryEnabled
    ? formatMemoryContext(
        retrieveMemoryContext({
          cwd: job.cwd,
          query: job.prompt,
          budget: config.memoryInjectionBudget,
        }),
      )
    : "";
  const system = appendPromptBlocks(systemPrompt(job.cwd, skillCatalog), [memoryBlock]);
  const session = newSession({
    title: `[schedule] ${job.name}`,
    provider: config.provider,
    model: config.model,
  });
  let summary = "";
  let failed: Error | null = null;
  try {
    for await (const ev of runAgentLoop({
      provider,
      registry,
      system,
      userInput: job.prompt,
      history,
      maxTurns: config.maxTurns,
      workdir: job.cwd,
      ...(config.thinkingDepth ? { thinking: config.thinkingDepth } : {}),
      todoStore: {
        get: () => cloneTodos(todos),
        set: (items) => {
          todos = cloneTodos(items);
        },
      },
      gate,
      mcp,
    })) {
      if (ev.type === "text_delta") summary += ev.text;
      if (ev.type === "error") failed = new Error(ev.message);
    }
  } catch (err) {
    failed = err as Error;
  }
  session.messages = history;
  session.todos = cloneTodos(todos);
  saveSession(session);
  return {
    id: `${job.id}:${Date.now()}`,
    jobId: job.id,
    startedAt: session.createdAt,
    endedAt: new Date().toISOString(),
    status: failed ? "error" : "success",
    sessionId: session.id,
    ...(summary.trim() ? { summary: summary.trim() } : {}),
    ...(failed ? { error: failed.message } : {}),
  };
}

export async function runDueJobs(opts: { onlyJobId?: string } = {}): Promise<number> {
  const store = loadSchedulerStore();
  const now = new Date();
  let ran = 0;
  for (const job of store.jobs) {
    if (opts.onlyJobId && job.id !== opts.onlyJobId) continue;
    if (!opts.onlyJobId && !isDue(job, now)) continue;
    const startedAt = new Date().toISOString();
    updateJob(store, job.id, { lastRunStatus: "running", lastRunAt: startedAt });
    saveSchedulerStore(store);
    appendSchedulerLog(`running job ${job.id} (${job.name})`);
    try {
      const record = await runScheduledJob(job);
      appendSchedulerRun(record);
      const nextRunAt =
        job.scheduleType === "once"
          ? undefined
          : computeNextRunAt(job.scheduleType, job.scheduleSpec, record.endedAt);
      updateJob(store, job.id, {
        lastRunStatus: record.status,
        lastRunAt: record.endedAt,
        nextRunAt,
        enabled: job.scheduleType === "once" ? false : job.enabled,
      });
      appendSchedulerLog(`job ${job.id} finished: ${record.status}`);
    } catch (err) {
      const endedAt = new Date().toISOString();
      appendSchedulerRun({
        id: `${job.id}:${Date.now()}`,
        jobId: job.id,
        startedAt,
        endedAt,
        status: "error",
        error: (err as Error).message,
      });
      updateJob(store, job.id, {
        lastRunStatus: "error",
        lastRunAt: endedAt,
        nextRunAt: computeNextRunAt(job.scheduleType, job.scheduleSpec, endedAt),
      });
      appendSchedulerLog(`job ${job.id} failed: ${(err as Error).message}`);
    }
    saveSchedulerStore(store);
    ran += 1;
  }
  return ran;
}

export async function runSchedulerDaemon(opts: { once?: boolean; onlyJobId?: string } = {}): Promise<void> {
  writeFileSync(schedulerRunnerPidPath(), String(process.pid), "utf8");
  appendSchedulerLog(`runner started${opts.once ? " (once)" : ""}`);
  try {
    do {
      await runDueJobs({ onlyJobId: opts.onlyJobId });
      if (opts.once) break;
      await new Promise((resolve) => setTimeout(resolve, 30_000));
    } while (true);
  } finally {
    appendSchedulerLog("runner stopped");
    if (existsSync(schedulerRunnerPidPath())) unlinkSync(schedulerRunnerPidPath());
  }
}

export function schedulerRunnerPid(): number | null {
  try {
    const raw = readFileSync(schedulerRunnerPidPath(), "utf8").trim();
    const pid = Number(raw);
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

export function isSchedulerRunning(): boolean {
  const pid = schedulerRunnerPid();
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function startSchedulerDaemon(args: string[] = []): boolean {
  if (isSchedulerRunning()) return false;
  const child = spawn(
    process.execPath,
    [...process.execArgv, process.argv[1]!, "internal-run-scheduler", ...args],
    {
      detached: true,
      stdio: "ignore",
      env: process.env,
    },
  );
  child.unref();
  return true;
}

export function stopSchedulerDaemon(): boolean {
  const pid = schedulerRunnerPid();
  if (!pid) return false;
  try {
    process.kill(pid, "SIGTERM");
    return true;
  } catch {
    return false;
  }
}

export function schedulerLogPath(): string {
  return schedulerRunnerLogPath();
}
