import { z } from "zod";
import type { ActionPreview, Tool, ToolContext, ToolResult } from "./types.js";
import type { McpToolCandidate } from "../mcp/types.js";

const inputSchema = {
  type: "object",
  properties: {
    query: {
      type: "string",
      description: "What capability you want to find among configured MCP servers.",
    },
    server: {
      type: "string",
      description: "Optional server name to narrow the search.",
    },
    limit: {
      type: "number",
      description: "Optional maximum number of matches to load.",
    },
  },
  required: ["query"],
  additionalProperties: false,
} as const;

const ArgsSchema = z.object({
  query: z.string().trim().min(1),
  server: z.string().trim().min(1).optional(),
  limit: z.number().int().positive().optional(),
});

function toolNameFor(candidate: McpToolCandidate): string {
  return candidate.registeredName;
}

function formatLoaded(candidates: McpToolCandidate[]): string {
  if (candidates.length === 0) return "No MCP tools matched that query.";
  return [
    `Loaded ${candidates.length} MCP tool${candidates.length === 1 ? "" : "s"}:`,
    ...candidates.map((c) => `- ${toolNameFor(c)} ← ${c.server}/${c.name}`),
  ].join("\n");
}

export const mcpSearchTool: Tool = {
  name: "mcp_search",
  description:
    "Search configured MCP servers for matching tools and load the best matches into the live tool pool.",
  inputSchema,
  riskLevel: "low",
  concurrency: "exclusive",

  describeAction(rawInput: unknown): ActionPreview {
    const parsed = ArgsSchema.safeParse(rawInput);
    if (!parsed.success) return { summary: "Search MCP tools (invalid arguments)" };
    return { summary: `Search MCP tools: ${parsed.data.query}` };
  },

  async execute(rawInput: unknown, ctx: ToolContext): Promise<ToolResult> {
    const parsed = ArgsSchema.safeParse(rawInput);
    if (!parsed.success) {
      return {
        isError: true,
        content:
          "Invalid arguments for mcp_search: " +
          parsed.error.issues.map((i) => i.message).join("; ") +
          ". Expected { query: string, server?: string, limit?: number }.",
      };
    }
    if (!ctx.mcp || !ctx.registry) {
      return {
        isError: true,
        content: "mcp_search is unavailable in this context.",
      };
    }

    const hits = await ctx.mcp.search(parsed.data.query, {
      ...(parsed.data.server ? { server: parsed.data.server } : {}),
      ...(parsed.data.limit ? { limit: parsed.data.limit } : {}),
    });

    const loaded: McpToolCandidate[] = [];
    for (const hit of hits) {
      if (ctx.registry.get(hit.registeredName)) continue;
      ctx.registry.register({
        name: hit.registeredName,
        description: `MCP tool from ${hit.server}/${hit.name}. ${hit.description}`.trim(),
        inputSchema: hit.inputSchema,
        riskLevel: "high",
        concurrency: "exclusive",
        describeAction(): ActionPreview {
          return { summary: `Run MCP tool: ${hit.server}/${hit.name}` };
        },
        async execute(input: unknown, toolCtx: ToolContext): Promise<ToolResult> {
          if (!toolCtx.mcp) {
            return { isError: true, content: "MCP runtime is unavailable." };
          }
          return toolCtx.mcp.callTool(hit, input, toolCtx.signal);
        },
      });
      loaded.push(hit);
    }

    return {
      isError: false,
      content:
        hits.length === 0
          ? "No MCP tools matched that query."
          : loaded.length === 0
            ? "Matching MCP tools were already loaded."
            : formatLoaded(loaded),
      ...(loaded.length ? { details: loaded.map((c) => c.registeredName).join("\n") } : {}),
    };
  },
};
