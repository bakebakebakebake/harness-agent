import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildCoreDigest, readCoreDigest, writeCoreDigest } from "../src/memory/digest.js";
import { upsertMemoryCard } from "../src/memory/store.js";
import type { MemoryCard } from "../src/memory/types.js";

const SAVED = { ...process.env };

afterEach(() => {
  for (const k of Object.keys(process.env)) {
    if (!(k in SAVED)) delete process.env[k];
  }
  Object.assign(process.env, SAVED);
  delete process.env.HARNESS_HOME;
});

function isolated() {
  const home = mkdtempSync(join(tmpdir(), "ha-mem-digest-home-"));
  const cwd = mkdtempSync(join(tmpdir(), "ha-mem-digest-cwd-"));
  process.env.HARNESS_HOME = home;
  return { home, cwd };
}

function seedCard(overrides: Partial<MemoryCard> = {}): MemoryCard {
  return {
    id: overrides.id ?? "mem-1",
    title: overrides.title ?? "Testing flow",
    scope: overrides.scope ?? "project",
    kind: overrides.kind ?? "workflow",
    tier: overrides.tier ?? "archive",
    summary: overrides.summary ?? "Run typecheck before tests.",
    body: overrides.body ?? "Always run npm run typecheck before npm test.",
    tags: overrides.tags ?? ["testing"],
    entities: overrides.entities ?? ["tsc", "vitest"],
    importance: overrides.importance ?? 0.8,
    trust: overrides.trust ?? 0.9,
    status: overrides.status ?? "active",
    supersedes: overrides.supersedes ?? [],
    sourceTurnRefs: overrides.sourceTurnRefs ?? [],
    sourceKind: overrides.sourceKind ?? "manual",
    createdAt: overrides.createdAt ?? "2026-05-31T00:00:00.000Z",
    updatedAt: overrides.updatedAt ?? "2026-05-31T00:00:00.000Z",
    accessCount: overrides.accessCount ?? 0,
    ...(overrides.sourceSessionId ? { sourceSessionId: overrides.sourceSessionId } : {}),
    ...(overrides.validFrom ? { validFrom: overrides.validFrom } : {}),
    ...(overrides.validUntil ? { validUntil: overrides.validUntil } : {}),
    ...(overrides.lastAccessedAt ? { lastAccessedAt: overrides.lastAccessedAt } : {}),
  };
}

describe("core digest", () => {
  it("builds and persists a compact digest from active cards", () => {
    const { home, cwd } = isolated();
    upsertMemoryCard(cwd, seedCard({ id: "p1", scope: "project", summary: "Use vitest." }));
    upsertMemoryCard(
      cwd,
      seedCard({
        id: "u1",
        scope: "user",
        kind: "preference",
        title: "Answer style",
        summary: "Prefer concise answers.",
      }),
    );
    const built = buildCoreDigest(cwd);
    expect(built[0]).toBe("# Core Digest");
    expect(built.join("\n")).toContain("## project");
    expect(built.join("\n")).toContain("## user");
    const persisted = writeCoreDigest(cwd);
    expect(readCoreDigest(cwd)).toEqual(persisted);
    rmSync(home, { recursive: true, force: true });
    rmSync(cwd, { recursive: true, force: true });
  });
});
