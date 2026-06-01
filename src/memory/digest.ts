import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { digestPath } from "./paths.js";
import { listMemoryCards } from "./store.js";
import type { MemoryCard } from "./types.js";

function approxTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function digestScore(card: MemoryCard): number {
  let score = 0;
  score += card.tier === "core" ? 4 : 0;
  score += card.scope === "user" ? 3 : 2;
  score += card.kind === "preference" ? 3 : 0;
  score += card.kind === "decision" ? 2 : 0;
  score += card.kind === "constraint" ? 2 : 0;
  score += card.kind === "workflow" ? 1.5 : 0;
  score += card.importance * 3;
  score += card.trust * 2;
  score += Math.min(card.accessCount, 8) * 0.6;
  if (card.lastAccessedAt) {
    const ageDays =
      (Date.now() - new Date(card.lastAccessedAt).getTime()) / (1000 * 60 * 60 * 24);
    score += Math.max(0, 4 - ageDays / 7);
  }
  if (card.status !== "active") score -= 5;
  return score;
}

export function buildCoreDigest(cwd: string, limit = 6): string[] {
  const cards = listMemoryCards(cwd)
    .filter((card) => card.status === "active")
    .sort((a, b) => digestScore(b) - digestScore(a) || b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, limit);
  const lines = ["# Core Digest"];
  if (cards.length === 0) {
    lines.push("- No active memories yet.");
    return lines;
  }
  const byScope = {
    project: cards.filter((card) => card.scope === "project"),
    user: cards.filter((card) => card.scope === "user"),
  } as const;
  for (const scope of ["project", "user"] as const) {
    if (byScope[scope].length === 0) continue;
    lines.push(`## ${scope}`);
    for (const card of byScope[scope]) {
      lines.push(`- ${card.title}: ${card.summary}`);
    }
  }
  return lines;
}

export function writeCoreDigest(cwd: string): string[] {
  const lines = buildCoreDigest(cwd);
  const path = digestPath(cwd);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, lines.join("\n") + "\n", "utf8");
  return lines;
}

export function readCoreDigest(cwd: string): string[] {
  const path = digestPath(cwd);
  if (!existsSync(path)) return writeCoreDigest(cwd);
  const raw = readFileSync(path, "utf8").trim();
  if (!raw) return writeCoreDigest(cwd);
  return raw.split("\n");
}

export function coreDigestTokenEstimate(lines: string[]): number {
  return approxTokens(lines.join("\n"));
}
