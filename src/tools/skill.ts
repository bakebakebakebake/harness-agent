import { z } from "zod";
import type { ActionPreview, Tool, ToolContext, ToolResult } from "./types.js";
import {
  loadSkills,
  formatSkillCatalog,
  skillContextBlock,
} from "../ext/skills.js";

const inputSchema = {
  type: "object",
  properties: {
    name: {
      type: "string",
      description:
        "Optional skill name to load. Omit it to list the currently available skills.",
    },
  },
  additionalProperties: false,
} as const;

const ArgsSchema = z.object({
  name: z.string().trim().min(1).optional(),
});

function formatCatalog(ctx: ToolContext): string {
  const skills = loadSkills(ctx.workdir);
  const lines = formatSkillCatalog(skills);
  if (lines.length === 0) {
    return "No skills found. Add files under .agents/skills/ or .agent/skills/.";
  }
  return lines.join("\n");
}

export const skillLoadTool: Tool = {
  name: "skill_load",
  description:
    "Load the full body of a named Skill. Use this after the skill catalog in the system prompt points to a relevant skill.",
  inputSchema,
  riskLevel: "low",
  concurrency: "concurrent",

  describeAction(rawInput: unknown): ActionPreview {
    const parsed = ArgsSchema.safeParse(rawInput);
    if (!parsed.success) return { summary: "Load skill (invalid arguments)" };
    return parsed.data.name
      ? { summary: `Load skill: ${parsed.data.name}` }
      : { summary: "List available skills" };
  },

  async execute(rawInput: unknown, ctx: ToolContext): Promise<ToolResult> {
    const parsed = ArgsSchema.safeParse(rawInput);
    if (!parsed.success) {
      return {
        isError: true,
        content:
          "Invalid arguments for skill_load: " +
          parsed.error.issues.map((i) => i.message).join("; ") +
          ". Expected { name?: string }.",
      };
    }

    const skills = loadSkills(ctx.workdir);
    if (skills.size === 0) {
      return {
        isError: true,
        content: "No skills found. Add files under .agents/skills/ or .agent/skills/.",
      };
    }

    if (!parsed.data.name) {
      return {
        isError: false,
        content: formatCatalog(ctx),
      };
    }

    const name = parsed.data.name.toLowerCase();
    const skill = skills.get(name);
    if (!skill) {
      return {
        isError: true,
        content:
          `No skill "${parsed.data.name}". Available skills:\n` +
          formatSkillCatalog(skills).slice(1, -1).join("\n"),
      };
    }

    return {
      isError: false,
      content: skillContextBlock(skill),
      details: `${skill.description || "(no description)"} (${skill.scope})`,
    };
  },
};
