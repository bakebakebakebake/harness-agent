import { z } from "zod";
import type { ActionPreview, Tool, ToolResult } from "./types.js";
import { buildMacosGuiScript, runMacosGuiAction } from "../gui/macos.js";

const inputSchema = {
  type: "object",
  properties: {
    app: { type: "string", description: "Target app family, e.g. finder, notes, safari, system." },
    action: { type: "string", description: "Allowed action name for that app." },
    args: { type: "object", description: "Action-specific arguments." },
  },
  required: ["app", "action"],
  additionalProperties: false,
} as const;

const ArgsSchema = z.object({
  app: z.string().trim().min(1),
  action: z.string().trim().min(1),
  args: z.record(z.string(), z.unknown()).optional(),
});

export const macosGuiTool: Tool = {
  name: "macos_gui",
  description:
    "Control supported macOS apps through a structured AppleScript/JXA bridge. Use only registered app/action pairs.",
  inputSchema,
  riskLevel: "high",
  concurrency: "exclusive",
  describeAction(input: unknown): ActionPreview {
    const parsed = ArgsSchema.safeParse(input);
    if (!parsed.success) return { summary: "Run a macOS GUI action (invalid arguments)" };
    try {
      const built = buildMacosGuiScript({
        app: parsed.data.app,
        action: parsed.data.action,
        args: parsed.data.args,
      });
      return {
        summary: built.summary,
        details: built.script,
      };
    } catch (err) {
      return {
        summary: `Run macOS GUI action ${parsed.data.app}.${parsed.data.action}`,
        details: (err as Error).message,
      };
    }
  },
  async execute(input: unknown): Promise<ToolResult> {
    const parsed = ArgsSchema.safeParse(input);
    if (!parsed.success) {
      return {
        isError: true,
        content:
          "Invalid arguments for macos_gui: " +
          parsed.error.issues.map((issue) => issue.message).join("; "),
      };
    }
    try {
      const result = runMacosGuiAction(parsed.data);
      return {
        isError: false,
        content: `${result.summary}\n${result.content}`.trim(),
      };
    } catch (err) {
      return {
        isError: true,
        content: (err as Error).message,
      };
    }
  },
};
