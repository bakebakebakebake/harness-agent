import { z } from "zod";
import type { ActionPreview, Tool, ToolContext, ToolResult } from "./types.js";
import { DEFAULT_MAX_OUTPUT, runShell } from "../util/shell.js";

const inputSchema = {
  type: "object",
  properties: {
    command_line: {
      type: "string",
      description:
        "Raw shell command line to run in the working directory. Shell features " +
        "like pipes, redirects, variables, and globs are interpreted.",
    },
    timeout_ms: {
      type: "number",
      description: "Optional per-command timeout in milliseconds.",
    },
  },
  required: ["command_line"],
  additionalProperties: false,
} as const;

const ArgsSchema = z.object({
  command_line: z.string().trim().min(1),
  timeout_ms: z.number().int().positive().optional(),
});

function cap(s: string): string {
  if (s.length <= DEFAULT_MAX_OUTPUT) return s;
  return s.slice(0, DEFAULT_MAX_OUTPUT) + `\n… [output truncated at ${DEFAULT_MAX_OUTPUT} chars]`;
}

export function createShellTool(opts: { defaultTimeoutMs: number }): Tool {
  return {
    name: "shell",
    description:
      "Run a raw shell command line in the working directory. Unlike bash, " +
      "this accepts a full shell string, so pipes, redirects, variables, and " +
      "globs work.",
    inputSchema,
    riskLevel: "high",
    concurrency: "exclusive",

    describeAction(rawInput: unknown): ActionPreview {
      const parsed = ArgsSchema.safeParse(rawInput);
      if (!parsed.success) return { summary: "Run shell command (invalid arguments)" };
      return { summary: `Run: ${parsed.data.command_line}` };
    },

    async execute(rawInput: unknown, ctx: ToolContext): Promise<ToolResult> {
      const parsed = ArgsSchema.safeParse(rawInput);
      if (!parsed.success) {
        return {
          isError: true,
          content:
            "Invalid arguments for shell: " +
            parsed.error.issues.map((i) => i.message).join("; ") +
            ". Expected { command_line: string, timeout_ms?: number }.",
        };
      }

      const timeout = parsed.data.timeout_ms ?? opts.defaultTimeoutMs;
      const r = await runShell(parsed.data.command_line, {
        cwd: ctx.workdir,
        timeoutMs: timeout,
        ...(ctx.signal ? { signal: ctx.signal } : {}),
      });

      if (r.error) {
        return { isError: true, content: `Failed to run shell command: ${r.error}` };
      }
      const head = r.timedOut
        ? `Command timed out after ${timeout}ms and was killed.`
        : `Exit code: ${r.exitCode ?? "null"}`;
      const body =
        (r.stdout ? `\n--- stdout ---\n${cap(r.stdout)}` : "") +
        (r.stderr ? `\n--- stderr ---\n${cap(r.stderr)}` : "");
      return {
        isError: r.timedOut || (r.exitCode ?? 1) !== 0,
        content: head + body,
      };
    },
  };
}
