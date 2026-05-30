import { statSync } from "node:fs";
import { relative } from "node:path";
import { z } from "zod";
import type { Tool, ToolContext, ToolResult } from "./types.js";
import { resolveInWorkdir } from "./read.js";
import { walkRelativeFiles } from "../util/fileTree.js";

const MAX_RESULTS = 200;
const MAX_WALK = 10_000;

const inputSchema = {
  type: "object",
  properties: {
    pattern: {
      type: "string",
      description:
        "Glob pattern over paths relative to the working directory. Supports *, ?, and **.",
    },
    path: {
      type: "string",
      description:
        "Optional directory to search under (relative to workdir). Results are still returned relative to the workdir root.",
    },
    include_hidden: {
      type: "boolean",
      description: "Include hidden files and directories (default false).",
    },
  },
  required: ["pattern"],
  additionalProperties: false,
} as const;

const ArgsSchema = z.object({
  pattern: z.string().min(1),
  path: z.string().optional(),
  include_hidden: z.boolean().optional(),
});

function escapeRegex(ch: string): string {
  return /[\\^$+?.()|{}[\]]/.test(ch) ? `\\${ch}` : ch;
}

function globToRegExp(pattern: string): RegExp {
  const normalized = pattern.split("\\").join("/");
  let re = "^";
  for (let i = 0; i < normalized.length; i++) {
    const ch = normalized[i] ?? "";
    if (ch === "*") {
      const next = normalized[i + 1] ?? "";
      const afterNext = normalized[i + 2] ?? "";
      if (next === "*" && afterNext === "/") {
        re += "(?:[^/]+/)*";
        i += 2;
      } else if (next === "*") {
        re += ".*";
        i += 1;
      } else {
        re += "[^/]*";
      }
    } else if (ch === "?") {
      re += "[^/]";
    } else if (ch === "/") {
      re += "/";
    } else {
      re += escapeRegex(ch);
    }
  }
  re += "$";
  return new RegExp(re);
}

export const globTool: Tool = {
  name: "glob",
  description:
    "Find file paths by glob pattern across the working directory. Supports *, ?, and **.",
  inputSchema,
  riskLevel: "low",
  concurrency: "concurrent",

  async execute(rawInput: unknown, ctx: ToolContext): Promise<ToolResult> {
    const parsed = ArgsSchema.safeParse(rawInput);
    if (!parsed.success) {
      return {
        isError: true,
        content:
          "Invalid arguments for glob: " +
          parsed.error.issues.map((i) => i.message).join("; ") +
          ". Expected { pattern: string, path?: string, include_hidden?: boolean }.",
      };
    }

    const { pattern, path, include_hidden } = parsed.data;
    let re: RegExp;
    try {
      re = globToRegExp(pattern);
    } catch (err) {
      return {
        isError: true,
        content: `Invalid glob pattern "${pattern}": ${(err as Error).message}`,
      };
    }

    const resolved = resolveInWorkdir(ctx.workdir, path ?? ".", ctx.allowOutsideWorkdir);
    if (!resolved.ok) return { isError: true, content: resolved.reason };

    let st;
    try {
      st = statSync(resolved.abs);
    } catch {
      return { isError: true, content: `Path not found: ${path ?? "."}` };
    }
    if (!st.isDirectory()) {
      return {
        isError: true,
        content: `"${path ?? "."}" is not a directory. Use read for files.`,
      };
    }

    let relBase = relative(ctx.workdir, resolved.abs).split("\\").join("/");
    if (relBase === "") relBase = ".";
    const prefix = relBase === "." ? "" : `${relBase}/`;
    const allMatches = walkRelativeFiles(resolved.abs, {
      includeHidden: include_hidden ?? false,
      maxFiles: MAX_WALK,
    })
      .map((rel) => `${prefix}${rel}`)
      .filter((rel) => re.test(rel));
    const truncated = allMatches.length > MAX_RESULTS;
    const matches = allMatches.slice(0, MAX_RESULTS);

    if (matches.length === 0) {
      return { isError: false, content: `No paths match "${pattern}".` };
    }

    const footer =
      truncated
        ? `\n\n(showing first ${MAX_RESULTS} matches; narrow the pattern or path)`
        : `\n\n(${matches.length} match${matches.length === 1 ? "" : "es"})`;
    return { isError: false, content: matches.join("\n") + footer };
  },
};
