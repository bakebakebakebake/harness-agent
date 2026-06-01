import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  forgetMemoryCard,
  listSupersedingMemoryCards,
  readMemoryCardFromDb,
  searchMemoryCards,
  touchMemoryCard,
  upsertMemoryCard,
} from "../memory/store.js";
import { writeCoreDigest } from "../memory/digest.js";
import { readTranscriptTurns } from "../memory/transcript.js";
import type { Tool, ToolContext, ToolResult } from "./types.js";
import type { MemoryCard } from "../memory/types.js";

const ScopeSchema = z.enum(["project", "user"]).optional();
const KindSchema = z.enum([
  "preference",
  "decision",
  "constraint",
  "fact",
  "workflow",
  "pattern",
]);
const TierSchema = z.enum(["core", "archive"]).optional();
const StatusSchema = z.enum(["active", "superseded", "expired", "forgotten"]).optional();
const SourceKindSchema = z.enum(["manual", "extracted", "inferred"]).optional();

const SearchArgs = z.object({
  query: z.string().trim().min(1),
  scope: ScopeSchema,
  kind: KindSchema.optional(),
  limit: z.number().int().positive().max(20).optional(),
});

const WriteArgs = z.object({
  title: z.string().trim().min(1),
  scope: z.enum(["project", "user"]),
  kind: KindSchema,
  summary: z.string().trim().min(1),
  body: z.string().trim().optional(),
  tags: z.array(z.string().trim().min(1)).optional(),
  entities: z.array(z.string().trim().min(1)).optional(),
  tier: TierSchema,
  trust: z.number().min(0).max(1).optional(),
  importance: z.number().min(0).max(1).optional(),
  sourceSessionId: z.string().trim().optional(),
  sourceTurnRefs: z.array(z.string().trim().min(1)).optional(),
  sourceKind: SourceKindSchema,
});

const UpdateArgs = z.object({
  id: z.string().trim().min(1),
  title: z.string().trim().min(1).optional(),
  summary: z.string().trim().min(1).optional(),
  body: z.string().trim().optional(),
  tags: z.array(z.string().trim().min(1)).optional(),
  entities: z.array(z.string().trim().min(1)).optional(),
  tier: TierSchema,
  validUntil: z.string().trim().optional(),
  status: StatusSchema,
});

const ForgetArgs = z.object({
  id: z.string().trim().min(1),
  reason: z.string().trim().optional(),
});

const DrillArgs = z.object({
  id: z.string().trim().min(1),
});

function formatCard(card: MemoryCard): string {
  const meta = [
    card.scope,
    card.kind,
    card.tier,
    card.status,
    `${card.trust.toFixed(2)} trust`,
    `${card.importance.toFixed(2)} importance`,
  ].join(" · ");
  const tags = card.tags.length ? `\n  tags: ${card.tags.join(", ")}` : "";
  const entities = card.entities.length ? `\n  entities: ${card.entities.join(", ")}` : "";
  return `- ${card.id} ${card.title}\n  ${meta}\n  ${card.summary}${tags}${entities}`;
}

function makeCard(args: z.infer<typeof WriteArgs>): MemoryCard {
  const now = new Date().toISOString();
  return {
    id: randomUUID(),
    title: args.title,
    scope: args.scope,
    kind: args.kind,
    tier: args.tier ?? "archive",
    summary: args.summary,
    body: args.body ?? args.summary,
    tags: args.tags ?? [],
    entities: args.entities ?? [],
    importance: args.importance ?? 0.5,
    trust: args.trust ?? 0.8,
    status: "active",
    supersedes: [],
    sourceSessionId: args.sourceSessionId,
    sourceTurnRefs: args.sourceTurnRefs ?? [],
    sourceKind: args.sourceKind ?? "manual",
    createdAt: now,
    updatedAt: now,
    accessCount: 0,
  };
}

function scopeLabel(scope?: string): string {
  return scope ? ` (${scope})` : "";
}

export const memorySearchTool: Tool = {
  name: "memory_search",
  description: "Search the native memory store for relevant cards.",
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string" },
      scope: { type: "string", enum: ["project", "user"] },
      kind: {
        type: "string",
        enum: ["preference", "decision", "constraint", "fact", "workflow", "pattern"],
      },
      limit: { type: "number" },
    },
    required: ["query"],
    additionalProperties: false,
  },
  riskLevel: "low",
  concurrency: "concurrent",
  async execute(rawInput: unknown, ctx: ToolContext): Promise<ToolResult> {
    const parsed = SearchArgs.safeParse(rawInput);
    if (!parsed.success) {
      return {
        isError: true,
        content:
          "Invalid arguments for memory_search: " +
          parsed.error.issues.map((i) => i.message).join("; "),
      };
    }
    const hits = searchMemoryCards(ctx.workdir, parsed.data.query, {
      scope: parsed.data.scope,
      limit: parsed.data.limit,
    }).filter((hit) => !parsed.data.kind || hit.card.kind === parsed.data.kind);
    for (const hit of hits) touchMemoryCard(ctx.workdir, hit.card.id);
    if (hits.length > 0) writeCoreDigest(ctx.workdir);
    return {
      isError: false,
      content: hits.length
        ? hits
            .map(
              (hit, i) =>
                `${i + 1}. ${hit.card.title} ${scopeLabel(hit.card.scope)}\n` +
                `   ${hit.card.summary}\n` +
                `   score=${hit.score.toFixed(3)} ${hit.reason}`,
            )
            .join("\n")
        : "No memories found.",
    };
  },
};

export const memoryWriteTool: Tool = {
  name: "memory_write",
  description: "Write a new memory card to the native memory store.",
  inputSchema: {
    type: "object",
    properties: {
      title: { type: "string" },
      scope: { type: "string", enum: ["project", "user"] },
      kind: {
        type: "string",
        enum: ["preference", "decision", "constraint", "fact", "workflow", "pattern"],
      },
      summary: { type: "string" },
      body: { type: "string" },
      tags: { type: "array", items: { type: "string" } },
      entities: { type: "array", items: { type: "string" } },
      tier: { type: "string", enum: ["core", "archive"] },
      trust: { type: "number" },
      importance: { type: "number" },
      sourceSessionId: { type: "string" },
      sourceTurnRefs: { type: "array", items: { type: "string" } },
      sourceKind: { type: "string", enum: ["manual", "extracted", "inferred"] },
    },
    required: ["title", "scope", "kind", "summary"],
    additionalProperties: false,
  },
  riskLevel: "medium",
  concurrency: "exclusive",
  async execute(rawInput: unknown, ctx: ToolContext): Promise<ToolResult> {
    const parsed = WriteArgs.safeParse(rawInput);
    if (!parsed.success) {
      return {
        isError: true,
        content:
          "Invalid arguments for memory_write: " +
          parsed.error.issues.map((i) => i.message).join("; "),
      };
    }
    const card = makeCard(parsed.data);
    upsertMemoryCard(ctx.workdir, card);
    writeCoreDigest(ctx.workdir);
    return {
      isError: false,
      content: `Wrote memory ${card.id}: ${card.title} (${card.scope}/${card.kind})`,
    };
  },
};

export const memoryUpdateTool: Tool = {
  name: "memory_update",
  description: "Update an existing memory card.",
  inputSchema: {
    type: "object",
    properties: {
      id: { type: "string" },
      title: { type: "string" },
      summary: { type: "string" },
      body: { type: "string" },
      tags: { type: "array", items: { type: "string" } },
      entities: { type: "array", items: { type: "string" } },
      tier: { type: "string", enum: ["core", "archive"] },
      validUntil: { type: "string" },
      status: { type: "string", enum: ["active", "superseded", "expired", "forgotten"] },
    },
    required: ["id"],
    additionalProperties: false,
  },
  riskLevel: "medium",
  concurrency: "exclusive",
  async execute(rawInput: unknown, ctx: ToolContext): Promise<ToolResult> {
    const parsed = UpdateArgs.safeParse(rawInput);
    if (!parsed.success) {
      return {
        isError: true,
        content:
          "Invalid arguments for memory_update: " +
          parsed.error.issues.map((i) => i.message).join("; "),
      };
    }
    const current = readMemoryCardFromDb(ctx.workdir, parsed.data.id);
    if (!current) {
      return { isError: true, content: `No memory "${parsed.data.id}".` };
    }
    const next: MemoryCard = {
      ...current,
      ...(parsed.data.title ? { title: parsed.data.title } : {}),
      ...(parsed.data.summary ? { summary: parsed.data.summary } : {}),
      ...(parsed.data.body ? { body: parsed.data.body } : {}),
      ...(parsed.data.tags ? { tags: parsed.data.tags } : {}),
      ...(parsed.data.entities ? { entities: parsed.data.entities } : {}),
      ...(parsed.data.tier ? { tier: parsed.data.tier } : {}),
      ...(parsed.data.validUntil ? { validUntil: parsed.data.validUntil } : {}),
      ...(parsed.data.status ? { status: parsed.data.status } : {}),
      updatedAt: new Date().toISOString(),
    };
    upsertMemoryCard(ctx.workdir, next);
    writeCoreDigest(ctx.workdir);
    return { isError: false, content: `Updated memory ${parsed.data.id}.` };
  },
};

export const memoryForgetTool: Tool = {
  name: "memory_forget",
  description: "Soft-forget a memory card without deleting its evidence.",
  inputSchema: {
    type: "object",
    properties: {
      id: { type: "string" },
      reason: { type: "string" },
    },
    required: ["id"],
    additionalProperties: false,
  },
  riskLevel: "medium",
  concurrency: "exclusive",
  async execute(rawInput: unknown, ctx: ToolContext): Promise<ToolResult> {
    const parsed = ForgetArgs.safeParse(rawInput);
    if (!parsed.success) {
      return {
        isError: true,
        content:
          "Invalid arguments for memory_forget: " +
          parsed.error.issues.map((i) => i.message).join("; "),
      };
    }
    if (!forgetMemoryCard(ctx.workdir, parsed.data.id)) {
      return { isError: true, content: `No memory "${parsed.data.id}".` };
    }
    writeCoreDigest(ctx.workdir);
    return {
      isError: false,
      content: parsed.data.reason
        ? `Forgot memory ${parsed.data.id}: ${parsed.data.reason}`
        : `Forgot memory ${parsed.data.id}.`,
    };
  },
};

export const memoryDrillTool: Tool = {
  name: "memory_drill",
  description: "Retrieve the stored card and its recorded evidence trail.",
  inputSchema: {
    type: "object",
    properties: {
      id: { type: "string" },
    },
    required: ["id"],
    additionalProperties: false,
  },
  riskLevel: "low",
  concurrency: "concurrent",
  async execute(rawInput: unknown, ctx: ToolContext): Promise<ToolResult> {
    const parsed = DrillArgs.safeParse(rawInput);
    if (!parsed.success) {
      return {
        isError: true,
        content:
          "Invalid arguments for memory_drill: " +
          parsed.error.issues.map((i) => i.message).join("; "),
      };
    }
    const card = readMemoryCardFromDb(ctx.workdir, parsed.data.id);
    if (!card) {
      return { isError: true, content: `No memory "${parsed.data.id}".` };
    }
    touchMemoryCard(ctx.workdir, parsed.data.id);
    writeCoreDigest(ctx.workdir);
    const evidence = card.sourceSessionId
      ? readTranscriptTurns(card.sourceSessionId)
          .filter((turn) =>
            card.sourceTurnRefs.some((ref) => ref.endsWith(`:${turn.turnIndex}`)),
          )
          .map((turn) => `${turn.role}[${turn.turnIndex}]: ${turn.text}`)
      : [];
    const supersededBy = listSupersedingMemoryCards(ctx.workdir, parsed.data.id);
    return {
      isError: false,
      content:
        formatCard(card) +
        (card.supersedes.length
          ? `\n\nSupersedes:\n${card.supersedes.map((id) => `- ${id}`).join("\n")}`
          : "") +
        (supersededBy.length
          ? `\n\nSuperseded by:\n${supersededBy.map((next) => `- ${next.id} ${next.title}`).join("\n")}`
          : "") +
        (evidence.length ? `\n\nEvidence:\n${evidence.map((line) => `- ${line}`).join("\n")}` : ""),
    };
  },
};
