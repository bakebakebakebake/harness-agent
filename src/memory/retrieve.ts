import { searchSkills } from "../ext/skills.js";
import { coreDigestTokenEstimate, readCoreDigest, writeCoreDigest } from "./digest.js";
import {
  listMemoryCards,
  listSupersedingMemoryCards,
  readMemoryCardFromDb,
  searchMemoryCards,
  touchMemoryCard,
} from "./store.js";
import type { MemoryCard, MemoryContextPacket, MemoryScope } from "./types.js";

type MemoryIntent = MemoryContextPacket["intent"];
type RankedCard = {
  card: MemoryCard;
  score: number;
  source: string;
  quality: number;
  freshness: number;
  reasons: string[];
};

function approxTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function classifyMemoryIntent(query: string): MemoryIntent {
  const q = query.toLowerCase();
  if (/(prefer|preference|style|tone|format|concise|verbose)/.test(q)) {
    return "preference";
  }
  if (/(how|steps|workflow|process|run|fix|debug|implement|where do i start)/.test(q)) {
    return "procedural";
  }
  if (/(history|previous|earlier|before|used to|last time)/.test(q)) {
    return "historical";
  }
  if (/(must|cannot|constraint|requirement|required|forbidden|limit)/.test(q)) {
    return "constraint_aware";
  }
  return "factual";
}

function scopeOrder(intent: MemoryIntent): MemoryScope[] {
  if (intent === "preference") return ["user", "project"];
  return ["project", "user"];
}

function ageDays(iso?: string): number | null {
  if (!iso) return null;
  const ts = new Date(iso).getTime();
  if (Number.isNaN(ts)) return null;
  return Math.max(0, (Date.now() - ts) / (1000 * 60 * 60 * 24));
}

function normalizedFreshness(age: number | null, horizonDays: number): number {
  if (age === null) return 0;
  return Math.max(0, 1 - age / horizonDays);
}

function qualityScore(card: MemoryCard): number {
  const accessSignal = Math.min(1, card.accessCount / 8);
  const accessFreshness = normalizedFreshness(ageDays(card.lastAccessedAt), 30);
  const contentFreshness = normalizedFreshness(ageDays(card.updatedAt), 120);
  const statusFactor =
    card.status === "active" ? 1 : card.status === "superseded" || card.status === "expired" ? 0.4 : 0;
  const raw =
    card.importance * 0.35 +
    card.trust * 0.3 +
    accessSignal * 0.15 +
    accessFreshness * 0.1 +
    contentFreshness * 0.05 +
    statusFactor * 0.05;
  return Math.max(0, Math.min(1, Number(raw.toFixed(3))));
}

function freshnessScore(card: MemoryCard): number {
  const accessFreshness = normalizedFreshness(ageDays(card.lastAccessedAt), 30);
  const contentFreshness = normalizedFreshness(ageDays(card.updatedAt), 120);
  return Math.max(0, Math.min(1, Number((accessFreshness * 0.65 + contentFreshness * 0.35).toFixed(3))));
}

function rerank(
  cards: Array<{ card: MemoryCard; score: number; source: string }>,
  preferred: MemoryScope,
): RankedCard[] {
  return cards
    .map((entry) => {
      let score = entry.score;
      const reasons: string[] = [entry.source];
      const freshness = freshnessScore(entry.card);
      const quality = qualityScore(entry.card);
      if (entry.card.scope === preferred) score -= 0.4;
      if (entry.card.scope === preferred) reasons.push(`preferred scope:${preferred}`);
      if (entry.card.tier === "core") score -= 0.3;
      if (entry.card.tier === "core") reasons.push("core tier");
      if (entry.card.status === "superseded" || entry.card.status === "expired") score += 1;
      if (entry.card.status === "superseded" || entry.card.status === "expired") {
        reasons.push(`status:${entry.card.status}`);
      }
      if (entry.card.status === "forgotten") score += 100;
      if (entry.card.status === "forgotten") reasons.push("status:forgotten");
      score -= entry.card.importance * 0.2;
      if (entry.card.importance >= 0.7) reasons.push(`importance:${entry.card.importance.toFixed(2)}`);
      score -= entry.card.trust * 0.1;
      if (entry.card.trust >= 0.7) reasons.push(`trust:${entry.card.trust.toFixed(2)}`);
      score -= freshness * 0.25;
      if (entry.card.lastAccessedAt) reasons.push("recently accessed");
      else reasons.push("content recency only");
      score -= quality * 0.2;
      if (entry.card.accessCount > 0) reasons.push(`accesses:${entry.card.accessCount}`);
      if (entry.card.sourceTurnRefs.length > 0) reasons.push(`evidence:${entry.card.sourceTurnRefs.length}`);
      return { card: entry.card, score, source: entry.source, quality, freshness, reasons };
    })
    .sort(
      (a, b) =>
        a.score - b.score ||
        b.freshness - a.freshness ||
        b.quality - a.quality ||
        b.card.updatedAt.localeCompare(a.card.updatedAt),
    )
    .map((entry) => entry);
}

function fallbackMatches(
  cwd: string,
  query: string,
): Array<{ card: MemoryCard; score: number; source: string }> {
  const terms = query
    .toLowerCase()
    .split(/[^\p{L}\p{N}_-]+/u)
    .map((term) => term.trim())
    .filter(Boolean);
  if (terms.length === 0) return [];
  return listMemoryCards(cwd)
    .map((card) => {
      const haystack = [
        card.title,
        card.summary,
        card.body,
        card.tags.join(" "),
        card.entities.join(" "),
      ]
        .join(" ")
        .toLowerCase();
      let score = 0;
      for (const term of terms) {
        if (haystack.includes(term)) score += 1;
      }
      return { card, score, source: "keyword" };
    })
    .filter((entry) => entry.score > 0)
    .map((entry) => ({ card: entry.card, score: 10 - entry.score, source: entry.source }));
}

function formatCard(card: MemoryCard): string {
  return `[${card.scope}/${card.kind}/${card.status}] ${card.title}: ${card.summary}`;
}

function relationshipSummary(cwd: string, cards: readonly MemoryCard[]) {
  const relationships: NonNullable<MemoryContextPacket["diagnostics"]>["relationships"] = [];
  const seen = new Set<string>();
  for (const card of cards) {
    for (const targetId of card.supersedes) {
      const target = readMemoryCardFromDb(cwd, targetId);
      const key = `${card.id}:supersedes:${targetId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      relationships.push({
        id: card.id,
        title: card.title,
        relation: "supersedes",
        targetId,
        targetTitle: target?.title ?? targetId,
        targetStatus: target?.status ?? "active",
      });
    }
    for (const newer of listSupersedingMemoryCards(cwd, card.id)) {
      const key = `${card.id}:superseded_by:${newer.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      relationships.push({
        id: card.id,
        title: card.title,
        relation: "superseded_by",
        targetId: newer.id,
        targetTitle: newer.title,
        targetStatus: newer.status,
      });
    }
  }
  return relationships;
}

function noteCardAccess(cwd: string, cards: readonly MemoryCard[]): void {
  const seen = new Set<string>();
  let touched = false;
  for (const card of cards) {
    if (seen.has(card.id)) continue;
    seen.add(card.id);
    touched = touchMemoryCard(cwd, card.id) || touched;
  }
  if (touched) {
    writeCoreDigest(cwd);
  }
}

export function retrieveMemoryContext(opts: {
  cwd: string;
  query: string;
  budget: number;
}): MemoryContextPacket {
  const intent = classifyMemoryIntent(opts.query);
  const preferred = scopeOrder(intent)[0]!;
  const results = scopeOrder(intent).flatMap((scope) =>
    searchMemoryCards(opts.cwd, opts.query, { scope, limit: 6 }).map((hit) => ({
      card: hit.card,
      score: hit.score,
      source: hit.reason,
    })),
  );
  const digest = readCoreDigest(opts.cwd);
  const ranked = rerank(
    results.length > 0 ? results : fallbackMatches(opts.cwd, opts.query),
    preferred,
  );
  const chosen: MemoryCard[] = [];
  const summaryLines = [`intent: ${intent}`, `core_digest: ${digest.length} line(s)`];
  let used = approxTokens(summaryLines.join("\n"));
  used += coreDigestTokenEstimate(digest);
  for (const entry of ranked) {
    const card = entry.card;
    if (card.status === "forgotten") continue;
    const line = formatCard(card);
    const cost = approxTokens(line);
    if (chosen.length >= 5 || used + cost > opts.budget) break;
    chosen.push(card);
    used += cost;
  }
  const skills =
    intent === "procedural"
      ? searchSkills(opts.cwd, opts.query, 3).map((skill) => ({
          name: skill.name,
          description: skill.description,
          scope: skill.scope,
        }))
      : [];
  used += approxTokens(skills.map((skill) => `${skill.name} ${skill.description}`).join("\n"));
  if (chosen.length > 0) {
    summaryLines.push(`retrieved: ${chosen.length} memory card(s)`);
  }
  if (skills.length > 0) {
    summaryLines.push(`skills: ${skills.length} related skill(s)`);
  }
  if (chosen.length > 0) {
    noteCardAccess(opts.cwd, chosen);
  }
  return {
    intent,
    summaryLines,
    coreDigest: digest,
    cards: chosen,
    skills,
    tokenEstimate: used,
    diagnostics: {
      preferredScope: preferred,
      candidates: ranked.slice(0, 8).map((entry) => ({
        id: entry.card.id,
        title: entry.card.title,
        scope: entry.card.scope,
        kind: entry.card.kind,
        status: entry.card.status,
        score: entry.score,
        quality: entry.quality,
        freshness: entry.freshness,
        source: entry.source,
        reasons: entry.reasons,
      })),
      relationships: relationshipSummary(opts.cwd, chosen.length > 0 ? chosen : ranked.slice(0, 3).map((entry) => entry.card)),
    },
  };
}

export function formatMemoryContext(packet: MemoryContextPacket): string {
  if (packet.coreDigest.length === 0 && packet.cards.length === 0 && packet.skills.length === 0) {
    return "";
  }
  const lines = ["<memory_context>"];
  for (const line of packet.summaryLines) lines.push(line);
  if (packet.coreDigest.length > 0) {
    lines.push("core_digest:");
    for (const line of packet.coreDigest) lines.push(`  ${line}`);
  }
  if (packet.cards.length > 0) {
    lines.push("memories:");
    for (const card of packet.cards) lines.push(`- ${formatCard(card)}`);
  }
  if (packet.skills.length > 0) {
    lines.push("related_skills:");
    for (const skill of packet.skills) {
      lines.push(`- ${skill.name} (${skill.scope}): ${skill.description || "(no description)"}`);
    }
  }
  lines.push("</memory_context>");
  return lines.join("\n");
}
