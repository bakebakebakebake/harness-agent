import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendTranscriptTurn, readTranscriptTurns } from "../src/memory/transcript.js";
import {
  rebuildMemoryIndex,
  readMemoryCard,
  searchMemoryCards,
  serializeMemoryCard,
  touchMemoryCard,
  upsertMemoryCard,
  writeMemoryCard,
} from "../src/memory/store.js";
import { projectMemoryDir } from "../src/memory/paths.js";
import type { MemoryCard, RawTurn } from "../src/memory/types.js";

const SAVED = { ...process.env };

afterEach(() => {
  for (const k of Object.keys(process.env)) {
    if (!(k in SAVED)) delete process.env[k];
  }
  Object.assign(process.env, SAVED);
  delete process.env.HARNESS_HOME;
});

function isolated() {
  const home = mkdtempSync(join(tmpdir(), "ha-mem-home-"));
  const cwd = mkdtempSync(join(tmpdir(), "ha-mem-cwd-"));
  process.env.HARNESS_HOME = home;
  return { home, cwd };
}

function sampleCard(scope: "project" | "user" = "project"): MemoryCard {
  return {
    id: "mem-1",
    title: "Testing convention",
    scope,
    kind: "workflow",
    tier: "archive",
    summary: "Run typecheck before tests.",
    body: "Always run `npm run typecheck` before `npm test`.",
    tags: ["testing", "workflow"],
    entities: ["vitest", "tsc"],
    importance: 0.8,
    trust: 1,
    status: "active",
    supersedes: [],
    sourceSessionId: "sess-1",
    sourceTurnRefs: ["sess-1:1"],
    sourceKind: "manual",
    createdAt: "2026-05-31T00:00:00.000Z",
    updatedAt: "2026-05-31T00:00:00.000Z",
    accessCount: 0,
  };
}

describe("memory transcript", () => {
  it("appends transcript evidence without mutating order", () => {
    const { home, cwd } = isolated();
    const turns: RawTurn[] = [
      {
        sessionId: "sess-1",
        turnIndex: 0,
        role: "user",
        text: "remember this",
        createdAt: "2026-05-31T00:00:00.000Z",
      },
      {
        sessionId: "sess-1",
        turnIndex: 1,
        role: "assistant",
        text: "noted",
        createdAt: "2026-05-31T00:00:01.000Z",
      },
    ];
    for (const turn of turns) appendTranscriptTurn("sess-1", turn);
    expect(readTranscriptTurns("sess-1")).toEqual(turns);
    rmSync(home, { recursive: true, force: true });
    rmSync(cwd, { recursive: true, force: true });
  });
});

describe("memory cards", () => {
  it("round-trips a memory card through markdown", () => {
    const { home, cwd } = isolated();
    const card = sampleCard();
    const path = writeMemoryCard(cwd, card);
    expect(readMemoryCard(path)).toEqual(card);
    expect(serializeMemoryCard(card)).toContain('summary: "Run typecheck before tests."');
    rmSync(home, { recursive: true, force: true });
    rmSync(cwd, { recursive: true, force: true });
  });

  it("rebuilds the sqlite index from markdown cards", () => {
    const { home, cwd } = isolated();
    writeMemoryCard(cwd, sampleCard());
    writeMemoryCard(cwd, {
      ...sampleCard(),
      id: "mem-2",
      title: "User preference",
      scope: "user",
      kind: "preference",
      summary: "Prefer concise answers.",
      body: "Keep answers concise and structured.",
      tags: ["style"],
      entities: ["user"],
    });
    expect(rebuildMemoryIndex(cwd)).toBe(2);
    const hits = searchMemoryCards(cwd, "concise answers", { limit: 3 });
    expect(hits[0]?.card.id).toBe("mem-2");
    const more = searchMemoryCards(cwd, "typecheck tests", { scope: "project" });
    expect(more[0]?.card.id).toBe("mem-1");
    rmSync(home, { recursive: true, force: true });
    rmSync(cwd, { recursive: true, force: true });
  });

  it("upserts cards into markdown and sqlite together", () => {
    const { home, cwd } = isolated();
    upsertMemoryCard(cwd, sampleCard());
    const hits = searchMemoryCards(cwd, "typecheck", { scope: "project" });
    expect(hits).toHaveLength(1);
    expect(readMemoryCard(join(projectMemoryDir(cwd), "mem-1.md"))?.title).toBe(
      "Testing convention",
    );
    rmSync(home, { recursive: true, force: true });
    rmSync(cwd, { recursive: true, force: true });
  });

  it("updates access stats without changing content updatedAt", () => {
    const { home, cwd } = isolated();
    upsertMemoryCard(cwd, sampleCard());
    const before = searchMemoryCards(cwd, "typecheck", { scope: "project" })[0]!.card;
    expect(touchMemoryCard(cwd, before.id)).toBe(true);
    const after = searchMemoryCards(cwd, "typecheck", { scope: "project" })[0]!.card;
    expect(after.accessCount).toBe(before.accessCount + 1);
    expect(after.lastAccessedAt).toBeTruthy();
    expect(after.updatedAt).toBe(before.updatedAt);
    rmSync(home, { recursive: true, force: true });
    rmSync(cwd, { recursive: true, force: true });
  });
});
