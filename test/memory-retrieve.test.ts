import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readCoreDigest } from "../src/memory/digest.js";
import { retrieveMemoryContext, formatMemoryContext } from "../src/memory/retrieve.js";
import { readMemoryCardFromDb, upsertMemoryCard } from "../src/memory/store.js";
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
  const home = mkdtempSync(join(tmpdir(), "ha-mem-rt-home-"));
  const cwd = mkdtempSync(join(tmpdir(), "ha-mem-rt-cwd-"));
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

describe("retrieveMemoryContext", () => {
  it("prefers project workflow memories for procedural queries and surfaces skills", () => {
    const { home, cwd } = isolated();
    upsertMemoryCard(cwd, seedCard());
    mkdirSync(join(cwd, ".agents", "skills", "review"), { recursive: true });
    writeFileSync(
      join(cwd, ".agents", "skills", "review", "SKILL.md"),
      "---\nname: review\ndescription: code review helper\n---\nReview carefully.",
    );
    const packet = retrieveMemoryContext({
      cwd,
      query: "how should I run tests and review this change",
      budget: 3000,
    });
    expect(packet.intent).toBe("procedural");
    expect(packet.cards[0]?.scope).toBe("project");
    expect(packet.cards[0]?.summary).toContain("typecheck");
    expect(packet.skills[0]?.name).toBe("review");
    expect(packet.coreDigest[0]).toBe("# Core Digest");
    const rendered = formatMemoryContext(packet);
    expect(rendered).toContain("<memory_context>");
    expect(rendered).toContain("  # Core Digest");
    expect(rendered).not.toContain("- # Core Digest");
    const touched = readMemoryCardFromDb(cwd, "mem-1");
    expect(touched?.accessCount).toBe(1);
    expect(touched?.lastAccessedAt).toBeTruthy();
    expect(packet.diagnostics?.candidates[0]?.quality).toBeGreaterThan(0);
    expect(packet.diagnostics?.candidates[0]?.reasons.join(" ")).toContain("preferred scope");
    rmSync(home, { recursive: true, force: true });
    rmSync(cwd, { recursive: true, force: true });
  });

  it("prefers user preferences for preference-shaped queries", () => {
    const { home, cwd } = isolated();
    upsertMemoryCard(
      cwd,
      seedCard({
        id: "user-1",
        scope: "user",
        kind: "preference",
        title: "Answer style",
        summary: "Prefer concise answers.",
        body: "Keep answers concise and structured.",
        tags: ["style"],
      }),
    );
    upsertMemoryCard(
      cwd,
      seedCard({
        id: "proj-1",
        scope: "project",
        title: "Project note",
        summary: "Use vitest in this repo.",
      }),
    );
    const packet = retrieveMemoryContext({
      cwd,
      query: "what answer style does the user prefer",
      budget: 3000,
    });
    expect(packet.intent).toBe("preference");
    expect(packet.cards[0]?.scope).toBe("user");
    expect(packet.cards[0]?.summary).toContain("concise");
    rmSync(home, { recursive: true, force: true });
    rmSync(cwd, { recursive: true, force: true });
  });

  it("refreshes the persisted digest after a memory gets used", () => {
    const { home, cwd } = isolated();
    upsertMemoryCard(
      cwd,
      seedCard({
        id: "older-hit",
        title: "Testing flow",
        summary: "Run typecheck before tests.",
        updatedAt: "2026-05-30T00:00:00.000Z",
      }),
    );
    upsertMemoryCard(
      cwd,
      seedCard({
        id: "newer-other",
        title: "Release flow",
        summary: "Publish after approvals pass.",
        updatedAt: "2026-05-31T00:00:00.000Z",
      }),
    );
    const before = readCoreDigest(cwd).join("\n");
    expect(before.indexOf("Release flow")).toBeLessThan(before.indexOf("Testing flow"));
    retrieveMemoryContext({
      cwd,
      query: "typecheck tests",
      budget: 3000,
    });
    const after = readCoreDigest(cwd).join("\n");
    expect(after.indexOf("Testing flow")).toBeLessThan(after.indexOf("Release flow"));
    rmSync(home, { recursive: true, force: true });
    rmSync(cwd, { recursive: true, force: true });
  });

  it("explains supersede relationships in diagnostics", () => {
    const { home, cwd } = isolated();
    upsertMemoryCard(
      cwd,
      seedCard({
        id: "old-1",
        title: "Old testing flow",
        status: "superseded",
      }),
    );
    upsertMemoryCard(
      cwd,
      seedCard({
        id: "new-1",
        title: "New testing flow",
        supersedes: ["old-1"],
      }),
    );
    const packet = retrieveMemoryContext({
      cwd,
      query: "typecheck tests",
      budget: 3000,
    });
    expect(packet.diagnostics?.relationships.some((rel) => rel.relation === "supersedes")).toBe(true);
    expect(packet.diagnostics?.relationships.some((rel) => rel.relation === "superseded_by")).toBe(true);
    rmSync(home, { recursive: true, force: true });
    rmSync(cwd, { recursive: true, force: true });
  });
});
