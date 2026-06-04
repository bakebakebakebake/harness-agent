import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  appendFileSync,
  renameSync,
  statSync,
  unlinkSync,
} from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { storeDir } from "../profiles.js";
import type {
  ScheduledJob,
  SchedulerRunRecord,
  SchedulerStore,
  ScheduleType,
} from "./types.js";

function schedulerDir(): string {
  return join(storeDir(), "scheduler");
}

export function schedulerJobsPath(): string {
  return join(schedulerDir(), "jobs.json");
}

export function schedulerRunsDir(): string {
  return join(schedulerDir(), "runs");
}

export function schedulerRunnerPidPath(): string {
  return join(schedulerDir(), "runner.pid");
}

export function schedulerRunnerLogPath(): string {
  return join(schedulerDir(), "runner.log");
}

function emptyStore(): SchedulerStore {
  return { jobs: [] };
}

export function loadSchedulerStore(): SchedulerStore {
  const path = schedulerJobsPath();
  if (!existsSync(path)) return emptyStore();
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<SchedulerStore>;
    return {
      jobs: Array.isArray(parsed.jobs) ? parsed.jobs as ScheduledJob[] : [],
    };
  } catch {
    return emptyStore();
  }
}

export function saveSchedulerStore(store: SchedulerStore): string {
  const path = schedulerJobsPath();
  mkdirSync(schedulerDir(), { recursive: true });
  writeFileSync(path, JSON.stringify(store, null, 2) + "\n", "utf8");
  return path;
}

export function appendSchedulerRun(record: SchedulerRunRecord): string {
  const path = join(schedulerRunsDir(), `${record.jobId}.jsonl`);
  mkdirSync(schedulerRunsDir(), { recursive: true });
  appendFileSync(path, JSON.stringify(record) + "\n", "utf8");
  return path;
}

export function appendSchedulerLog(line: string): void {
  mkdirSync(schedulerDir(), { recursive: true });
  rotateSchedulerLogIfNeeded();
  appendFileSync(
    schedulerRunnerLogPath(),
    `[${new Date().toISOString()}] ${line}\n`,
    "utf8",
  );
}

export function rotateSchedulerLogIfNeeded(opts?: {
  maxBytes?: number;
  maxFiles?: number;
}): void {
  const path = schedulerRunnerLogPath();
  const maxBytes = opts?.maxBytes;
  const maxFiles = opts?.maxFiles ?? 3;
  if (!maxBytes || maxBytes <= 0 || !existsSync(path)) return;
  let size = 0;
  try {
    size = statSync(path).size;
  } catch {
    return;
  }
  if (size < maxBytes) return;

  for (let i = Math.max(1, maxFiles - 1); i >= 1; i--) {
    const from = `${path}.${i}`;
    const to = `${path}.${i + 1}`;
    if (!existsSync(from)) continue;
    if (i + 1 > maxFiles) {
      unlinkSync(from);
      continue;
    }
    renameSync(from, to);
  }
  renameSync(path, `${path}.1`);
}

export function createScheduledJob(input: {
  name: string;
  prompt: string;
  cwd: string;
  profileName: string | null;
  provider: "anthropic" | "openai";
  model: string;
  scheduleType: ScheduleType;
  scheduleSpec: string;
}): ScheduledJob {
  const now = new Date().toISOString();
  return {
    id: randomUUID(),
    name: input.name,
    prompt: input.prompt,
    cwd: input.cwd,
    profileName: input.profileName,
    provider: input.provider,
    model: input.model,
    scheduleType: input.scheduleType,
    scheduleSpec: input.scheduleSpec,
    enabled: true,
    createdAt: now,
    updatedAt: now,
    lastRunStatus: "idle",
    nextRunAt: computeNextRunAt(input.scheduleType, input.scheduleSpec, undefined),
  };
}

export function updateJob(
  store: SchedulerStore,
  id: string,
  patch: Partial<ScheduledJob>,
): ScheduledJob | null {
  const idx = store.jobs.findIndex((job) => job.id === id);
  if (idx < 0) return null;
  const current = store.jobs[idx]!;
  const next: ScheduledJob = {
    ...current,
    ...patch,
    updatedAt: new Date().toISOString(),
  };
  store.jobs[idx] = next;
  return next;
}

function parseTime(value: string): { hour: number; minute: number } | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return { hour, minute };
}

function weeklyDayIndex(token: string): number | null {
  const value = token.trim().toLowerCase();
  const table = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
  const idx = table.findIndex((day) => day === value || day.startsWith(value));
  return idx >= 0 ? idx : null;
}

export function validateScheduleSpec(type: ScheduleType, spec: string): string {
  const trimmed = spec.trim();
  if (type === "once") {
    if (!Number.isFinite(Date.parse(trimmed))) {
      throw new Error("Once schedule must be an ISO or YYYY-MM-DD HH:MM style datetime.");
    }
    return new Date(trimmed).toISOString();
  }
  if (type === "daily") {
    if (!parseTime(trimmed)) {
      throw new Error("Daily schedule must look like HH:MM.");
    }
    return trimmed;
  }
  const [day, time] = trimmed.split("@");
  if (weeklyDayIndex(day ?? "") === null || !parseTime(time ?? "")) {
    throw new Error("Weekly schedule must look like mon@09:30.");
  }
  return `${(day ?? "").toLowerCase()}@${time ?? ""}`;
}

export function computeNextRunAt(
  type: ScheduleType,
  spec: string,
  fromIso?: string,
): string | undefined {
  const now = fromIso ? new Date(fromIso) : new Date();
  if (type === "once") {
    const at = new Date(spec);
    if (!Number.isFinite(at.getTime())) return undefined;
    return at.toISOString();
  }
  if (type === "daily") {
    const parsed = parseTime(spec);
    if (!parsed) return undefined;
    const at = new Date(now);
    at.setSeconds(0, 0);
    at.setHours(parsed.hour, parsed.minute, 0, 0);
    if (at.getTime() <= now.getTime()) at.setDate(at.getDate() + 1);
    return at.toISOString();
  }
  const [dayToken, timeToken] = spec.split("@");
  const day = weeklyDayIndex(dayToken ?? "");
  const parsed = parseTime(timeToken ?? "");
  if (day === null || !parsed) return undefined;
  const at = new Date(now);
  at.setSeconds(0, 0);
  at.setHours(parsed.hour, parsed.minute, 0, 0);
  const delta = (day - at.getDay() + 7) % 7;
  at.setDate(at.getDate() + delta);
  if (at.getTime() <= now.getTime()) at.setDate(at.getDate() + 7);
  return at.toISOString();
}
