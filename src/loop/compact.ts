import type {
  Message,
  ModelProvider,
  ModelRequest,
} from "../model/types.js";

export type CompactMode = "soft" | "strong" | "emergency";
type SummaryLayer = "working" | "archival";

const SUMMARY_PREFIX = "[Summary layer=";
export const AUTO_COMPACT_SOFT_THRESHOLD = 0.7;
export const AUTO_COMPACT_STRONG_THRESHOLD = 0.85;
const DEFAULT_KEEP_RECENT: Record<CompactMode, number> = {
  soft: 4,
  strong: 3,
  emergency: 2,
};

export interface CompactOptions {
  keepRecent?: number;
  signal?: AbortSignal;
  mode?: CompactMode;
}

export interface CompactResult {
  messages: Message[];
  summary: string;
  collapsed: number;
}

export function compactModeForUsage(opts: {
  usedTokens: number;
  totalTokens: number;
  contextOverflow?: boolean;
}): CompactMode | null {
  if (opts.contextOverflow) return "emergency";
  if (opts.totalTokens <= 0) return null;
  const frac = opts.usedTokens / opts.totalTokens;
  if (frac >= AUTO_COMPACT_STRONG_THRESHOLD) return "strong";
  if (frac >= AUTO_COMPACT_SOFT_THRESHOLD) return "soft";
  return null;
}

function userTurnBoundaries(messages: Message[]): number[] {
  const out: number[] = [];
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i]!;
    if (m.role !== "user") continue;
    const hasText = m.content.some(
      (b) => b.type === "text" && b.text.trim() !== "",
    );
    if (hasText) out.push(i);
  }
  return out;
}

function messageToText(m: Message): string {
  const parts: string[] = [];
  for (const b of m.content) {
    if (b.type === "text") parts.push(b.text);
    else if (b.type === "tool_use")
      parts.push(`[called ${b.name}(${JSON.stringify(b.input)})]`);
    else if (b.type === "tool_result")
      parts.push(`[tool result${b.isError ? " ERROR" : ""}: ${b.content.slice(0, 500)}]`);
  }
  return parts.join("\n");
}

function summaryInstruction(layer: SummaryLayer): string {
  const brevity =
    layer === "archival"
      ? "Keep it short and highly compressed."
      : "Keep enough detail to resume coding work accurately.";
  return (
    "You are compacting a coding-assistant conversation to save context. " +
    "Summarize the material below into markdown with these exact sections:\n" +
    "- User goals\n" +
    "- Completed work\n" +
    "- Current code state\n" +
    "- Key files / commands / decisions\n" +
    "- Open issues / next steps\n" +
    "Use terse bullet points. Preserve explicit instructions, key decisions, " +
    "files touched, and unresolved work. Prefer facts over prose. " +
    `${brevity} Do not invent facts.`
  );
}

async function summarizeViaModel(
  provider: ModelProvider,
  conversationText: string,
  layer: SummaryLayer,
  signal?: AbortSignal,
): Promise<string> {
  const req: ModelRequest = {
    system: summaryInstruction(layer),
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: "Conversation to summarize:\n\n" + conversationText },
        ],
      },
    ],
    tools: [],
    ...(signal ? { signal } : {}),
  };
  let text = "";
  for await (const ev of provider.stream(req)) {
    if (ev.type === "text_delta") text += ev.text;
    else if (ev.type === "error") throw new Error(ev.error.message);
  }
  return text.trim();
}

function summaryHeader(layer: SummaryLayer): string {
  return `${SUMMARY_PREFIX}${layer}]`;
}

function layerOfSummaryMessage(m: Message): SummaryLayer | null {
  if (m.role !== "assistant") return null;
  const text = m.content[0];
  if (!text || text.type !== "text") return null;
  const match = new RegExp(`^\\${SUMMARY_PREFIX}(working|archival)\\]`).exec(text.text);
  return match?.[1] === "working" || match?.[1] === "archival"
    ? match[1]
    : null;
}

function summaryBody(m: Message): string {
  const text = m.content[0];
  if (!text || text.type !== "text") return "";
  return text.text.replace(/^\[Summary layer=(working|archival)\]\n?/, "").trim();
}

function buildSummaryMessage(layer: SummaryLayer, body: string): Message {
  return {
    role: "assistant",
    content: [
      {
        type: "text",
        text: `${summaryHeader(layer)}\n${body}`,
      },
    ],
  };
}

export async function compactHistory(
  provider: ModelProvider,
  messages: Message[],
  opts: CompactOptions = {},
): Promise<CompactResult> {
  const mode = opts.mode ?? "soft";
  const keepRecent = opts.keepRecent ?? DEFAULT_KEEP_RECENT[mode];
  const boundaries = userTurnBoundaries(messages);
  if (boundaries.length <= keepRecent) {
    return { messages, summary: "", collapsed: 0 };
  }

  const cut = boundaries[boundaries.length - keepRecent]!;
  const olderPrefix = messages.slice(0, cut);
  const tail = messages.slice(cut);
  if (olderPrefix.length === 0) {
    return { messages, summary: "", collapsed: 0 };
  }

  const archivalSources: string[] = [];
  const workingSources: Message[] = [];
  for (const message of olderPrefix) {
    const layer = layerOfSummaryMessage(message);
    if (layer === "archival" || layer === "working") {
      const body = summaryBody(message);
      if (body) archivalSources.push(body);
      continue;
    }
    workingSources.push(message);
  }

  let archivalSummary = "";
  if (archivalSources.length > 0) {
    archivalSummary = await summarizeViaModel(
      provider,
      archivalSources.join("\n\n"),
      "archival",
      opts.signal,
    );
  }

  let workingSummary = "";
  if (workingSources.length > 0) {
    workingSummary = await summarizeViaModel(
      provider,
      workingSources.map(messageToText).join("\n\n"),
      "working",
      opts.signal,
    );
  }

  if (!archivalSummary && !workingSummary) {
    return { messages, summary: "", collapsed: 0 };
  }

  const compacted: Message[] = [];
  if (archivalSummary) compacted.push(buildSummaryMessage("archival", archivalSummary));
  if (workingSummary) compacted.push(buildSummaryMessage("working", workingSummary));

  return {
    messages: [...compacted, ...tail],
    summary: [archivalSummary, workingSummary].filter(Boolean).join("\n\n"),
    collapsed: olderPrefix.length,
  };
}
