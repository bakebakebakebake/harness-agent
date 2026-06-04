import type { PermissionGate } from "../loop/agentLoop.js";
import type { RepoAgentConfig } from "../ext/repoConfig.js";
import { protectedActionFor } from "../permissions/protect.js";
import type { Tool } from "../tools/types.js";

export const DEFAULT_SCHEDULER_POLL_INTERVAL_SECONDS = 30;
export const DEFAULT_SCHEDULER_LOG_ROTATION_BYTES = 1_000_000;
export const DEFAULT_SCHEDULER_LOG_ROTATION_FILES = 3;

function commandLineFromInput(input: unknown): string | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const rec = input as Record<string, unknown>;
  if (typeof rec.command_line === "string") return rec.command_line;
  if (typeof rec.command === "string") {
    const args = Array.isArray(rec.args)
      ? rec.args.filter((value): value is string => typeof value === "string")
      : [];
    return [rec.command, ...args].join(" ");
  }
  return null;
}

function matchesCommandPattern(commandLine: string, patterns: readonly string[]): string | null {
  const hay = commandLine.trim().toLowerCase();
  return patterns.find((pattern) => hay.includes(pattern.toLowerCase())) ?? null;
}

function allowsSchedulerTool(tool: Tool, config: RepoAgentConfig): boolean {
  return config.scheduler.allowedTools.includes(tool.name.toLowerCase());
}

export function schedulerPermissionSummary(config: RepoAgentConfig): string[] {
  const tools =
    config.scheduler.allowedTools.length > 0
      ? config.scheduler.allowedTools.join(", ")
      : "(none)";
  const commands =
    config.scheduler.allowedCommandPatterns.length > 0
      ? config.scheduler.allowedCommandPatterns.join(", ")
      : "(none)";
  return [
    `allowed tools: ${tools}`,
    `allowed command patterns: ${commands}`,
  ];
}

export function createSchedulerGate(opts: {
  workdir: string;
  repoConfig: () => RepoAgentConfig;
  onDeny?: (reason: string) => void;
}): PermissionGate {
  const { workdir, repoConfig, onDeny } = opts;
  return async ({ tool, input }) => {
    const config = repoConfig();
    const blocked = protectedActionFor(tool, input, workdir, config);
    if (blocked) {
      const reason = `blocked by repo protection rules (${blocked.reason})`;
      onDeny?.(reason);
      return { allow: false, reason };
    }

    if (tool.riskLevel === "low") return { allow: true };

    if (!allowsSchedulerTool(tool, config)) {
      const reason =
        `scheduler policy does not allow the ${tool.name} tool. ` +
        "Add it to scheduler.allowedTools in .agents/light-agent.json if needed.";
      onDeny?.(reason);
      return { allow: false, reason };
    }

    if (tool.name === "bash" || tool.name === "shell") {
      const commandLine = commandLineFromInput(input);
      if (!commandLine) {
        const reason = `scheduler ${tool.name} input did not contain a command line`;
        onDeny?.(reason);
        return { allow: false, reason };
      }
      const match = matchesCommandPattern(
        commandLine,
        config.scheduler.allowedCommandPatterns,
      );
      if (!match) {
        const reason =
          `scheduler command did not match any allowedCommandPatterns: ${commandLine}`;
        onDeny?.(reason);
        return { allow: false, reason };
      }
    }

    return { allow: true };
  };
}
