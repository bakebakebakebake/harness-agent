import type { CommandContext, SlashCommand } from "./registry.js";
import { bold, cyan, dim, green, red, yellow, symbols } from "../ui/theme.js";
import {
  createScheduledJob,
  loadSchedulerStore,
  saveSchedulerStore,
  schedulerRunnerPidPath,
  updateJob,
  validateScheduleSpec,
} from "../scheduler/store.js";
import {
  isSchedulerRunning,
  runDueJobs,
  schedulerLogPath,
  schedulerRunnerPid,
  startSchedulerDaemon,
  stopSchedulerDaemon,
} from "../scheduler/runner.js";
import type { ScheduleType } from "../scheduler/types.js";
import type { ScheduledJob } from "../scheduler/types.js";

function shortTime(iso: string | undefined): string {
  if (!iso) return "-";
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return iso;
  const pad = (value: number): string => String(value).padStart(2, "0");
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
}

function formatJob(job: ReturnType<typeof loadSchedulerStore>["jobs"][number]): string {
  return (
    `  ${cyan(job.name)} ${dim(`(${job.id.slice(0, 8)})`)}\n` +
    `    ${dim("schedule")} ${job.scheduleType} ${symbols.dot} ${job.scheduleSpec}\n` +
    `    ${dim("next")} ${job.enabled ? shortTime(job.nextRunAt) : dim("paused")}\n` +
    `    ${dim("last")} ${job.lastRunStatus ?? "idle"} ${symbols.dot} ${shortTime(job.lastRunAt)}`
  );
}

function jobPickerItems(jobs: readonly ScheduledJob[]): Array<{
  label: string;
  value: string;
  hint?: string;
}> {
  return jobs.map((job) => ({
    label: job.name,
    value: job.id,
    hint:
      `${job.scheduleType} ${symbols.dot} ${job.scheduleSpec} ${symbols.dot} ` +
      `${job.enabled ? `next ${shortTime(job.nextRunAt)}` : "paused"}`,
  }));
}

async function pickJob(
  ctx: CommandContext,
  jobs: readonly ScheduledJob[],
  prompt: string,
): Promise<ScheduledJob | null> {
  if (jobs.length === 0) return null;
  if (!ctx.pick) return jobs[0] ?? null;
  const picked = await ctx.pick(prompt, jobPickerItems(jobs));
  if (!picked) return null;
  return jobs.find((job) => job.id === picked) ?? null;
}

async function pickJobAction(
  ctx: CommandContext,
  job: ScheduledJob,
): Promise<string | null> {
  if (!ctx.pick) return null;
  return ctx.pick(`  ${job.name}`, [
    { label: "Show details", value: "show", hint: "Inspect prompt, profile, and schedule" },
    { label: "Run now", value: "run-now", hint: "Execute this job immediately" },
    {
      label: job.enabled ? "Pause job" : "Resume job",
      value: job.enabled ? "pause" : "resume",
      hint: job.enabled ? "Temporarily disable future runs" : "Enable future runs again",
    },
    { label: "Remove job", value: "remove", hint: "Delete this job from the local scheduler" },
  ]);
}

async function promptScheduleJob(ctx: CommandContext): Promise<{
  name: string;
  prompt: string;
  scheduleType: ScheduleType;
  scheduleSpec: string;
} | null> {
  const name = (await ctx.ask("Job name: ")).trim();
  if (!name) return null;
  const prompt = (await ctx.ask("Prompt: ")).trim();
  if (!prompt) return null;
  let scheduleType = ((await ctx.ask("Schedule type [once/daily/weekly]: ")).trim().toLowerCase() || "once") as ScheduleType;
  if (!["once", "daily", "weekly"].includes(scheduleType)) {
    throw new Error("Schedule type must be once, daily, or weekly.");
  }
  const specPrompt =
    scheduleType === "once"
      ? "When? (e.g. 2026-06-03T20:30:00+08:00): "
      : scheduleType === "daily"
        ? "Daily at what time? (HH:MM): "
        : "Weekly when? (e.g. mon@09:30): ";
  const scheduleSpec = validateScheduleSpec(scheduleType, await ctx.ask(specPrompt));
  return { name, prompt, scheduleType, scheduleSpec };
}

export const scheduleCommand: SlashCommand = {
  name: "schedule",
  description: "Manage local background jobs",
  keywords: ["cron", "reminder", "automation", "background", "job"],
  priority: 75,
  subcommands: ["add", "list", "show", "remove", "pause", "resume", "run-now", "status", "stop-runner"],
  async run(ctx, args) {
    const sub = (args[0] ?? "").trim().toLowerCase();
    const store = loadSchedulerStore();
    if (!sub) {
      if (ctx.pick) {
        const choice = await ctx.pick("  Scheduler", [
          {
            label: "Add job",
            value: "__add__",
            hint: "Create a once/daily/weekly background task",
          },
          {
            label: "Runner status",
            value: "__status__",
            hint: `${isSchedulerRunning() ? "running" : "stopped"} ${symbols.dot} ${store.jobs.length} job(s)`,
          },
          ...(store.jobs.length > 0
            ? [
                ...jobPickerItems(store.jobs).map((item) => ({
                  ...item,
                  value: `job:${item.value}`,
                })),
              ]
            : []),
        ]);
        if (!choice) return {};
        if (choice === "__add__") return scheduleCommand.run(ctx, ["add"]);
        if (choice === "__status__") return scheduleCommand.run(ctx, ["status"]);
        if (choice.startsWith("job:")) {
          const job = store.jobs.find((item) => item.id === choice.slice(4));
          if (!job) {
            ctx.out(red("  Selected schedule job no longer exists."));
            return {};
          }
          const action = await pickJobAction(ctx, job);
          if (!action) return {};
          return scheduleCommand.run(ctx, [action, job.id]);
        }
      } else {
        ctx.out(bold("  Scheduler"));
        ctx.out(`  ${dim("runner")} ${isSchedulerRunning() ? green("running") : yellow("stopped")}`);
        ctx.out(`  ${dim("pid")}    ${schedulerRunnerPid() ?? dim("(none)")}`);
        ctx.out(`  ${dim("jobs")}   ${store.jobs.length}`);
        if (store.jobs.length > 0) {
          ctx.out("");
          for (const job of store.jobs) ctx.out(formatJob(job));
        }
      }
      return {};
    }
    if (sub === "status") {
      ctx.out(bold("  Scheduler status"));
      ctx.out(`  ${dim("runner")} ${isSchedulerRunning() ? green("running") : yellow("stopped")}`);
      ctx.out(`  ${dim("pid file")} ${schedulerRunnerPidPath()}`);
      ctx.out(`  ${dim("log")} ${schedulerLogPath()}`);
      return {};
    }
    if (sub === "list") {
      if (store.jobs.length === 0) {
        ctx.out(dim("  No scheduled jobs yet."));
        return {};
      }
      ctx.out(bold("  Scheduled jobs"));
      for (const job of store.jobs) ctx.out(formatJob(job));
      return {};
    }
    if (sub === "add") {
      const draft = await promptScheduleJob(ctx);
      if (!draft) {
        ctx.out(yellow("  Cancelled."));
        return {};
      }
      const job = createScheduledJob({
        ...draft,
        cwd: ctx.state.config.workdir,
        profileName: ctx.state.profileName,
        provider: ctx.state.config.provider,
        model: ctx.state.config.model,
      });
      store.jobs.push(job);
      saveSchedulerStore(store);
      startSchedulerDaemon();
      ctx.out(green(`  Added job "${job.name}" (${job.id.slice(0, 8)}).`));
      ctx.out(dim(`  Next run: ${shortTime(job.nextRunAt)}`));
      return {};
    }
    const target = (args[1] ?? "").trim();
    let job = target
      ? store.jobs.find((item) => item.id === target || item.id.startsWith(target) || item.name === target)
      : undefined;
    if (!job && !target && ["show", "remove", "pause", "resume", "run-now"].includes(sub)) {
      job = await pickJob(ctx, store.jobs, `  ${sub} which job?`) ?? undefined;
      if (!job) {
        ctx.out(dim("  Cancelled."));
        return {};
      }
    }
    if (!job) {
      ctx.out(red(`  No schedule job "${target}".`));
      return {};
    }
    if (sub === "show") {
      ctx.out(formatJob(job));
      ctx.out(`    ${dim("cwd")} ${job.cwd}`);
      ctx.out(`    ${dim("profile")} ${job.profileName ?? "(env/.env)"}`);
      ctx.out(`    ${dim("model")} ${job.model}`);
      ctx.out(`    ${dim("prompt")} ${job.prompt}`);
      return {};
    }
    if (sub === "remove") {
      store.jobs = store.jobs.filter((item) => item.id !== job.id);
      saveSchedulerStore(store);
      ctx.out(green(`  Removed job "${job.name}".`));
      return {};
    }
    if (sub === "pause") {
      updateJob(store, job.id, { enabled: false });
      saveSchedulerStore(store);
      ctx.out(green(`  Paused job "${job.name}".`));
      return {};
    }
    if (sub === "resume") {
      updateJob(store, job.id, { enabled: true });
      saveSchedulerStore(store);
      startSchedulerDaemon();
      ctx.out(green(`  Resumed job "${job.name}".`));
      return {};
    }
    if (sub === "run-now") {
      await runDueJobs({ onlyJobId: job.id });
      ctx.out(green(`  Ran job "${job.name}" now.`));
      return {};
    }
    if (sub === "stop-runner") {
      if (!stopSchedulerDaemon()) {
        ctx.out(dim("  Scheduler runner is not active."));
        return {};
      }
      ctx.out(green("  Sent SIGTERM to the scheduler runner."));
      return {};
    }
    ctx.out(dim("  Usage: /schedule [add|list|show|remove|pause|resume|run-now|status|stop-runner]"));
    return {};
  },
};
