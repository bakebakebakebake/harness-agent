import { z } from "zod";
import { fetchWebPage, searchWeb, type SearchBackend, type SearchBias } from "../util/web.js";
import type { Tool, ToolResult } from "./types.js";

const searchSchema = {
  type: "object",
  properties: {
    query: { type: "string", description: "What to search for on the web." },
    limit: { type: "number", description: "Maximum number of results to return." },
    bias: {
      type: "string",
      enum: ["general", "technical", "recent"],
      description: "How to rank results: general, technical docs/repo sources, or recent updates.",
    },
    backend: {
      type: "string",
      enum: ["auto", "tavily", "bing"],
      description: "Search backend preference. auto = Tavily when configured, otherwise Bing.",
    },
  },
  required: ["query"],
  additionalProperties: false,
} as const;

const fetchSchema = {
  type: "object",
  properties: {
    url: { type: "string", description: "URL to fetch and summarize." },
    max_chars: { type: "number", description: "Maximum number of characters to return." },
  },
  required: ["url"],
  additionalProperties: false,
} as const;

const SearchArgs = z.object({
  query: z.string().trim().min(1),
  limit: z.number().int().positive().max(10).optional(),
  bias: z.enum(["general", "technical", "recent"]).optional(),
  backend: z.enum(["auto", "tavily", "bing"]).optional(),
});

const FetchArgs = z.object({
  url: z.string().url(),
  max_chars: z.number().int().positive().max(50_000).optional(),
});

function renderSearch(results: Awaited<ReturnType<typeof searchWeb>>): ToolResult {
  if (results.length === 0) {
    return { isError: false, content: "No web results found." };
  }
  return {
    isError: false,
    content: results
      .map((result, index) => {
        const lines = [
          `${index + 1}. ${result.title}`,
          `source: ${result.source}`,
          `backend: ${result.backend}`,
          `url: ${result.url}`,
        ];
        if (result.publishedAt) lines.push(`published_at: ${result.publishedAt}`);
        lines.push(`summary: ${result.snippet}`);
        return lines.join("\n");
      })
      .join("\n\n"),
  };
}

export const webSearchTool: Tool = {
  name: "web_search",
  description:
    "Search the web and return ranked results with source, URL, summary, and optional date.",
  inputSchema: searchSchema,
  riskLevel: "low",
  concurrency: "concurrent",
  async execute(input) {
    const parsed = SearchArgs.safeParse(input);
    if (!parsed.success) {
      return {
        isError: true,
        content:
          "Invalid arguments for web_search: " +
          parsed.error.issues.map((issue) => issue.message).join("; "),
      };
    }
    try {
      const results = await searchWeb(parsed.data.query, {
        ...(parsed.data.limit ? { limit: parsed.data.limit } : {}),
        ...(parsed.data.bias ? { bias: parsed.data.bias as SearchBias } : {}),
        ...(parsed.data.backend ? { backend: parsed.data.backend as SearchBackend } : {}),
      });
      return renderSearch(results);
    } catch (err) {
      return {
        isError: true,
        content: `web_search failed: ${(err as Error).message}`,
      };
    }
  },
};

export const webFetchTool: Tool = {
  name: "web_fetch",
  description:
    "Fetch a specific web page and return cleaned text for deeper reading after a search result looks relevant.",
  inputSchema: fetchSchema,
  riskLevel: "low",
  concurrency: "concurrent",
  async execute(input) {
    const parsed = FetchArgs.safeParse(input);
    if (!parsed.success) {
      return {
        isError: true,
        content:
          "Invalid arguments for web_fetch: " +
          parsed.error.issues.map((issue) => issue.message).join("; "),
      };
    }
    try {
      const text = await fetchWebPage(parsed.data.url, {
        ...(parsed.data.max_chars ? { maxChars: parsed.data.max_chars } : {}),
      });
      return {
        isError: false,
        content: `url: ${parsed.data.url}\n\n${text}`,
      };
    } catch (err) {
      return {
        isError: true,
        content: `web_fetch failed: ${(err as Error).message}`,
      };
    }
  },
};
