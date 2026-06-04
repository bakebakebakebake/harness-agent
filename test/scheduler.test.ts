import { afterEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  computeNextRunAt,
  rotateSchedulerLogIfNeeded,
  schedulerRunnerLogPath,
  validateScheduleSpec,
} from "../src/scheduler/store.js";
import { createSchedulerGate } from "../src/scheduler/policy.js";
import { runtimeSettingsForJobs } from "../src/scheduler/runner.js";
import type { Tool } from "../src/tools/types.js";
import type { RepoAgentConfig } from "../src/ext/repoConfig.js";

const envBackup = { ...process.env };

afterEach(() => {
  process.env = { ...envBackup };
});

describe("scheduler store helpers", () => {
  it("validates once schedules into ISO timestamps", () => {
    const iso = validateScheduleSpec("once", "2026-06-03T20:30:00+08:00");
    expect(iso).toMatch(/^2026-06-03T12:30:00\.000Z$/);
  });

  it("validates daily schedules", () => {
    expect(validateScheduleSpec("daily", "09:30")).toBe("09:30");
  });

  it("validates weekly schedules", () => {
    expect(validateScheduleSpec("weekly", "mon@09:30")).toBe("mon@09:30");
  });

  it("computes the next daily run after the reference time", () => {
    const next = computeNextRunAt("daily", "09:30", "2026-06-03T10:00:00.000Z");
    expect(next).toBeTruthy();
    const scheduled = new Date(next!);
    expect(scheduled.getFullYear()).toBe(2026);
    expect(scheduled.getMonth()).toBe(5);
    expect(scheduled.getDate()).toBe(4);
    expect(scheduled.getHours()).toBe(9);
    expect(scheduled.getMinutes()).toBe(30);
    expect(scheduled.getSeconds()).toBe(0);
  });

  it("rotates the runner log once it exceeds the configured size", () => {
    const home = mkdtempSync(join(tmpdir(), "light-agent-scheduler-"));
    process.env.LIGHT_AGENT_HOME = home;
    const path = schedulerRunnerLogPath();
    mkdirSync(join(home, "scheduler"), { recursive: true });
    writeFileSync(path, "x".repeat(120), "utf8");
    rotateSchedulerLogIfNeeded({ maxBytes: 100, maxFiles: 2 });
    expect(readFileSync(`${path}.1`, "utf8")).toHaveLength(120);
  });
});

describe("scheduler permission gate", () => {
  const mediumTool: Tool = {
    name: "write",
    description: "write file",
    inputSchema: {},
    riskLevel: "medium",
    concurrency: "exclusive",
    async execute() {
      return { content: "ok", isError: false };
    },
  };
  const bashTool: Tool = {
    name: "bash",
    description: "run command",
    inputSchema: {},
    riskLevel: "high",
    concurrency: "exclusive",
    async execute() {
      return { content: "ok", isError: false };
    },
  };

  function config(extra?: Partial<RepoAgentConfig>): RepoAgentConfig {
    return {
      disabledSkills: [],
      blockedCommands: [],
      protectedPaths: [],
      scheduler: {
        allowedTools: [],
        allowedCommandPatterns: [],
      },
      ...extra,
    };
  }

  it("allows low-risk tools but blocks medium/high tools unless allowlisted", async () => {
    const gate = createSchedulerGate({
      workdir: process.cwd(),
      repoConfig: () => config(),
    });
    await expect(gate({ tool: mediumTool, input: { path: "a.txt" } })).resolves.toEqual({
      allow: false,
      reason:
        'scheduler policy does not allow the write tool. Add it to scheduler.allowedTools in .agents/light-agent.json if needed.',
    });
  });

  it("allows allowlisted bash commands that match allowed patterns", async () => {
    const gate = createSchedulerGate({
      workdir: process.cwd(),
      repoConfig: () =>
        config({
          scheduler: {
            allowedTools: ["bash"],
            allowedCommandPatterns: ["npm test"],
          },
        }),
    });
    await expect(
      gate({ tool: bashTool, input: { command: "npm", args: ["test"] } }),
    ).resolves.toEqual({ allow: true });
  });

  it("blocks allowlisted bash commands when the command pattern does not match", async () => {
    const gate = createSchedulerGate({
      workdir: process.cwd(),
      repoConfig: () =>
        config({
          scheduler: {
            allowedTools: ["bash"],
            allowedCommandPatterns: ["npm test"],
          },
        }),
    });
    const result = await gate({
      tool: bashTool,
      input: { command: "npm", args: ["run", "build"] },
    });
    expect(result.allow).toBe(false);
    if (!result.allow) {
      expect(result.reason).toContain("allowedCommandPatterns");
    }
  });
});

describe("scheduler runtime settings", () => {
  it("uses the strictest poll and rotation byte settings across jobs", () => {
    const root = mkdtempSync(join(tmpdir(), "light-agent-scheduler-config-"));
    const repoA = join(root, "a");
    const repoB = join(root, "b");
    mkdirSync(join(repoA, ".agents"), { recursive: true });
    mkdirSync(join(repoB, ".agents"), { recursive: true });
    writeFileSync(
      join(repoA, ".agents", "light-agent.json"),
      JSON.stringify({
        scheduler: {
          pollIntervalSeconds: 12,
          logRotationBytes: 2000,
          logRotationFiles: 2,
        },
      }),
      { encoding: "utf8", flag: "w" },
    );
    writeFileSync(
      join(repoB, ".agents", "light-agent.json"),
      JSON.stringify({
        scheduler: {
          pollIntervalSeconds: 20,
          logRotationBytes: 5000,
          logRotationFiles: 5,
        },
      }),
      { encoding: "utf8", flag: "w" },
    );
    const settings = runtimeSettingsForJobs([
      {
        id: "a",
        name: "A",
        prompt: "p",
        cwd: repoA,
        profileName: null,
        provider: "anthropic",
        model: "m",
        scheduleType: "daily",
        scheduleSpec: "09:30",
        enabled: true,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
      {
        id: "b",
        name: "B",
        prompt: "p",
        cwd: repoB,
        profileName: null,
        provider: "anthropic",
        model: "m",
        scheduleType: "daily",
        scheduleSpec: "09:30",
        enabled: true,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    ]);
    expect(settings.pollIntervalSeconds).toBe(12);
    expect(settings.logRotationBytes).toBe(2000);
    expect(settings.logRotationFiles).toBe(5);
  });
});
