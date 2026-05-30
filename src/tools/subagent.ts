import { z } from "zod";
import type { ActionPreview, Tool, ToolContext, ToolResult } from "./types.js";

const inputSchema = {
  type: "object",
  properties: {
    task: {
      type: "string",
      description: "What the subagent should accomplish.",
    },
    instructions: {
      type: "string",
      description: "Additional guidance for the subagent.",
    },
    tool_whitelist: {
      type: "array",
      description:
        "Optional tool names the subagent is allowed to use. If omitted, a " +
        "small read-only default set is used.",
      items: { type: "string" },
    },
    max_turns: {
      type: "number",
      description: "Optional maximum number of turns for the subagent.",
    },
  },
  required: ["task"],
  additionalProperties: false,
} as const;

const ArgsSchema = z.object({
  task: z.string().trim().min(1),
  instructions: z.string().trim().optional(),
  tool_whitelist: z.array(z.string().trim().min(1)).optional(),
  max_turns: z.number().int().positive().optional(),
});

function summarizeTask(task: string): string {
  const firstLine = task.split("\n", 1)[0] ?? "";
  return firstLine.length > 80 ? firstLine.slice(0, 80) + "…" : firstLine;
}

export function createSubagentTool(): Tool {
  return {
    name: "subagent",
    description:
      "Spawn an isolated helper agent for a larger subtask. Returns the final " +
      "summary only, not the intermediate trace.",
    inputSchema,
    riskLevel: "medium",
    concurrency: "exclusive",

    describeAction(rawInput: unknown): ActionPreview {
      const parsed = ArgsSchema.safeParse(rawInput);
      if (!parsed.success) return { summary: "Spawn subagent (invalid arguments)" };
      return {
        summary: `Spawn subagent: ${summarizeTask(parsed.data.task)}`,
        ...(parsed.data.tool_whitelist?.length
          ? { details: `Tools: ${parsed.data.tool_whitelist.join(", ")}` }
          : {}),
      };
    },

    async execute(rawInput: unknown, ctx: ToolContext): Promise<ToolResult> {
      const parsed = ArgsSchema.safeParse(rawInput);
      if (!parsed.success) {
        return {
          isError: true,
          content:
            "Invalid arguments for subagent: " +
            parsed.error.issues.map((i) => i.message).join("; ") +
            ". Expected { task: string, instructions?: string, tool_whitelist?: string[], max_turns?: number }.",
        };
      }
      if (!ctx.runSubagent) {
        return {
          isError: true,
          content: "subagent is unavailable in this context.",
        };
      }

      try {
        const result = await ctx.runSubagent({
          task: parsed.data.task,
          ...(parsed.data.instructions ? { instructions: parsed.data.instructions } : {}),
          ...(parsed.data.tool_whitelist !== undefined
            ? { toolWhitelist: parsed.data.tool_whitelist }
            : {}),
          ...(parsed.data.max_turns ? { maxTurns: parsed.data.max_turns } : {}),
          ...(ctx.signal ? { signal: ctx.signal } : {}),
        });
        return {
          isError: false,
          content: result.summary,
          details: `Subagent turns: ${result.turns}`,
        };
      } catch (err) {
        return {
          isError: true,
          content: `Subagent failed: ${(err as Error).message}`,
        };
      }
    },
  };
}
