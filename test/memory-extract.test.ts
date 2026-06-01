import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  applyMemoryDraft,
  extractAndApplyMemory,
  extractMemoryDrafts,
  isDurableCandidate,
} from "../src/memory/extract.js";
import { listMemoryCards } from "../src/memory/store.js";
import type { RawTurn } from "../src/memory/types.js";

const SAVED = { ...process.env };

afterEach(() => {
  for (const k of Object.keys(process.env)) {
    if (!(k in SAVED)) delete process.env[k];
  }
  Object.assign(process.env, SAVED);
  delete process.env.HARNESS_HOME;
});

function isolated() {
  const home = mkdtempSync(join(tmpdir(), "ha-mem-ex-home-"));
  const cwd = mkdtempSync(join(tmpdir(), "ha-mem-ex-cwd-"));
  process.env.HARNESS_HOME = home;
  return { home, cwd };
}

function turn(text: string, role: RawTurn["role"] = "user"): RawTurn {
  return {
    sessionId: "sess-1",
    turnIndex: 0,
    role,
    text,
    createdAt: "2026-05-31T00:00:00.000Z",
  };
}

describe("memory extraction", () => {
  it("extracts only durable candidates", () => {
    expect(isDurableCandidate("User prefers concise answers.")).toBe(true);
    expect(isDurableCandidate("Always run typecheck before tests.")).toBe(true);
    expect(isDurableCandidate("回答尽量简洁，保持有条理。")).toBe(true);
    expect(isDurableCandidate("这个项目必须先跑 typecheck 再跑测试。")).toBe(true);
    expect(isDurableCandidate("todo later")).toBe(false);
    expect(isDurableCandidate("这个之后再说，先记个临时点。")).toBe(false);
    expect(isDurableCandidate("how do we run tests?")).toBe(false);
  });

  it("builds drafts with inferred scope and kind", () => {
    const drafts = extractMemoryDrafts([
      turn("User prefers concise answers."),
      turn("Always run typecheck before tests."),
      turn("我希望回答尽量简洁，格式清晰。"),
      turn("这个项目必须先跑 typecheck，再跑测试。"),
    ]);
    expect(drafts).toHaveLength(4);
    expect(drafts[0]?.scope).toBe("user");
    expect(drafts[0]?.kind).toBe("preference");
    expect(drafts[1]?.scope).toBe("project");
    expect(drafts[1]?.kind).toBe("workflow");
    expect(drafts[2]?.scope).toBe("user");
    expect(drafts[2]?.kind).toBe("preference");
    expect(drafts[3]?.scope).toBe("project");
    expect(drafts[3]?.kind).toBe("constraint");
  });

  it("refreshes duplicates instead of creating noisy copies", () => {
    const { home, cwd } = isolated();
    const draft = extractMemoryDrafts([turn("Always run typecheck before tests.")])[0]!;
    expect(applyMemoryDraft(cwd, draft).action).toBe("insert");
    expect(applyMemoryDraft(cwd, draft).action).toBe("refresh");
    expect(listMemoryCards(cwd)).toHaveLength(1);
    rmSync(home, { recursive: true, force: true });
    rmSync(cwd, { recursive: true, force: true });
  });

  it("merges new evidence refs when a durable memory is refreshed", () => {
    const { home, cwd } = isolated();
    const first = {
      ...extractMemoryDrafts([
        { ...turn("Always run typecheck before tests."), turnIndex: 1, sessionId: "sess-1" },
      ])[0]!,
    };
    const second = {
      ...extractMemoryDrafts([
        { ...turn("Always run typecheck before tests."), turnIndex: 2, sessionId: "sess-2" },
      ])[0]!,
    };
    expect(applyMemoryDraft(cwd, first).action).toBe("insert");
    expect(applyMemoryDraft(cwd, second).action).toBe("refresh");
    const card = listMemoryCards(cwd)[0]!;
    expect(card.sourceTurnRefs).toContain("sess-1:1");
    expect(card.sourceTurnRefs).toContain("sess-2:2");
    rmSync(home, { recursive: true, force: true });
    rmSync(cwd, { recursive: true, force: true });
  });

  it("creates a supersede chain when a durable fact changes", () => {
    const { home, cwd } = isolated();
    const first = extractMemoryDrafts([turn("Always run typecheck before tests.")])[0]!;
    const second = extractMemoryDrafts([turn("Always run tests before typecheck.")])[0]!;
    expect(applyMemoryDraft(cwd, first).action).toBe("insert");
    expect(applyMemoryDraft(cwd, second).action).toBe("supersede");
    const cards = listMemoryCards(cwd);
    expect(cards.some((card) => card.status === "superseded")).toBe(true);
    expect(cards.some((card) => card.supersedes.length > 0)).toBe(true);
    rmSync(home, { recursive: true, force: true });
    rmSync(cwd, { recursive: true, force: true });
  });

  it("extracts and applies several turns at once", () => {
    const { home, cwd } = isolated();
    const results = extractAndApplyMemory(cwd, [
      turn("User prefers concise answers."),
      turn("Always run typecheck before tests."),
      turn("todo later"),
    ]);
    expect(results).toHaveLength(2);
    expect(listMemoryCards(cwd)).toHaveLength(2);
    rmSync(home, { recursive: true, force: true });
    rmSync(cwd, { recursive: true, force: true });
  });
});
