import { randomUUID } from "node:crypto";
import { listMemoryCards, upsertMemoryCard } from "./store.js";
import type { MemoryCard, MemoryDraft, RawTurn } from "./types.js";

function normalize(text: string): string {
  return text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

function signature(text: string): string {
  return [...new Set(normalize(text).split(/\s+/).filter(Boolean))].sort().join(" ");
}

function firstSentence(text: string): string {
  const line = text.trim().split(/\r?\n/, 1)[0] ?? "";
  const cut = line.split(/[.!?。！？]/, 1)[0] ?? line;
  return cut.trim() || line.trim();
}

function hasCjk(text: string): boolean {
  return /[\u3400-\u9fff]/u.test(text);
}

export function isDurableCandidate(text: string): boolean {
  const t = text.trim();
  if (t.length < (hasCjk(t) ? 8 : 16)) return false;
  if (/[?？]$/.test(t)) return false;
  if (/\b(today|now|temporary|tmp|later|todo)\b/i.test(t)) return false;
  if (/(临时|稍后|回头|待办|todo)/.test(t)) return false;
  return /(prefer|always|never|must|should|cannot|can't|workflow|convention|remember|use |run |keep |constraint|decision|偏好|喜欢|希望|尽量|记住|约定|规范|流程|先.*再|必须|不能|不要|风格|简洁|详细|优先|习惯)/i.test(
    t,
  );
}

function inferScope(turn: RawTurn): "project" | "user" {
  if (
    /(i prefer|user prefers|answer style|tone|format|concise|verbose)/i.test(turn.text) ||
    /(我希望|我喜欢|我偏好|用户偏好|回答风格|语气|格式|简洁|详细)/.test(turn.text)
  ) {
    return "user";
  }
  return "project";
}

function inferKind(text: string): MemoryDraft["kind"] {
  if (/(prefer|style|tone|format|concise|verbose)/i.test(text) || /(偏好|风格|语气|格式|简洁|详细|我希望|我喜欢)/.test(text)) {
    return "preference";
  }
  if (/(must|cannot|can't|forbid|required|constraint)/i.test(text) || /(必须|不能|不要|限制|约束|禁止)/.test(text)) {
    return "constraint";
  }
  if (/(decide|decision|chose|chosen)/i.test(text) || /(决定|决策|选用|采用)/.test(text)) return "decision";
  if (/(workflow|run |steps|process|before|after|always)/i.test(text) || /(流程|步骤|先.*再|每次|总是|运行|执行)/.test(text)) {
    return "workflow";
  }
  if (/(pattern|usually|typically)/i.test(text) || /(通常|一般|习惯|模式)/.test(text)) return "pattern";
  return "fact";
}

function mergeEvidenceRefs(
  existing: readonly string[],
  incoming: readonly string[] | undefined,
): string[] {
  return [...new Set([...existing, ...(incoming ?? [])])];
}

export function extractMemoryDrafts(turns: RawTurn[]): Array<MemoryDraft & { sourceTurnRefs: string[]; sourceSessionId?: string }> {
  return turns
    .filter((turn) => isDurableCandidate(turn.text))
    .map((turn) => {
      const summary = firstSentence(turn.text);
      return {
        title: summary.length > 60 ? summary.slice(0, 60) + "…" : summary,
        scope: inferScope(turn),
        kind: inferKind(turn.text),
        summary,
        body: turn.text.trim(),
        tags: [],
        entities: [],
        tier: "archive",
        trust: turn.role === "user" ? 0.9 : 0.75,
        importance: 0.65,
        sourceKind: "extracted",
        sourceSessionId: turn.sessionId,
        sourceTurnRefs: [`${turn.sessionId}:${turn.turnIndex}`],
      };
    });
}

function similar(existing: MemoryCard, draft: MemoryDraft): boolean {
  const a = signature(existing.title + " " + existing.summary);
  const b = signature(draft.title + " " + draft.summary);
  return a === b || a.includes(b) || b.includes(a);
}

export function applyMemoryDraft(
  cwd: string,
  draft: MemoryDraft & { sourceTurnRefs?: string[]; sourceSessionId?: string },
): { action: "insert" | "refresh" | "supersede" | "ignore"; card?: MemoryCard } {
  const existing = listMemoryCards(cwd).filter(
    (card) => card.scope === draft.scope && card.kind === draft.kind && card.status !== "forgotten",
  );
  const exact = existing.find(
    (card) => normalize(card.summary) === normalize(draft.summary) || similar(card, draft),
  );
  const now = new Date().toISOString();
  if (exact && normalize(exact.summary) === normalize(draft.summary)) {
    const refreshed: MemoryCard = {
      ...exact,
      sourceSessionId: exact.sourceSessionId ?? draft.sourceSessionId,
      sourceTurnRefs: mergeEvidenceRefs(exact.sourceTurnRefs, draft.sourceTurnRefs),
      updatedAt: now,
      lastAccessedAt: now,
      accessCount: exact.accessCount + 1,
    };
    upsertMemoryCard(cwd, refreshed);
    return { action: "refresh", card: refreshed };
  }
  if (exact) {
    const superseded: MemoryCard = {
      ...exact,
      status: "superseded",
      validUntil: now,
      updatedAt: now,
    };
    upsertMemoryCard(cwd, superseded);
    const card: MemoryCard = {
      id: randomUUID(),
      title: draft.title,
      scope: draft.scope,
      kind: draft.kind,
      tier: draft.tier ?? "archive",
      summary: draft.summary,
      body: draft.body ?? draft.summary,
      tags: draft.tags ?? [],
      entities: draft.entities ?? [],
      importance: draft.importance ?? 0.5,
      trust: draft.trust ?? 0.8,
      status: "active",
      supersedes: [superseded.id],
      ...(draft.sourceSessionId ? { sourceSessionId: draft.sourceSessionId } : {}),
      sourceTurnRefs: draft.sourceTurnRefs ?? [],
      sourceKind: draft.sourceKind ?? "extracted",
      createdAt: now,
      updatedAt: now,
      accessCount: 0,
    };
    upsertMemoryCard(cwd, card);
    return { action: "supersede", card };
  }
  const card: MemoryCard = {
    id: randomUUID(),
    title: draft.title,
    scope: draft.scope,
    kind: draft.kind,
    tier: draft.tier ?? "archive",
    summary: draft.summary,
    body: draft.body ?? draft.summary,
    tags: draft.tags ?? [],
    entities: draft.entities ?? [],
    importance: draft.importance ?? 0.5,
    trust: draft.trust ?? 0.8,
    status: "active",
    supersedes: [],
    ...(draft.sourceSessionId ? { sourceSessionId: draft.sourceSessionId } : {}),
    sourceTurnRefs: draft.sourceTurnRefs ?? [],
    sourceKind: draft.sourceKind ?? "extracted",
    createdAt: now,
    updatedAt: now,
    accessCount: 0,
  };
  upsertMemoryCard(cwd, card);
  return { action: "insert", card };
}

export function extractAndApplyMemory(cwd: string, turns: RawTurn[]): Array<{ action: string; card?: MemoryCard }> {
  const drafts = extractMemoryDrafts(turns);
  return drafts.map((draft) => applyMemoryDraft(cwd, draft));
}
