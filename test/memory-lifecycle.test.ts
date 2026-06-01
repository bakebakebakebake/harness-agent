import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendTranscriptMessages, readTranscriptTurns } from "../src/memory/transcript.js";
import { extractAndApplyMemory } from "../src/memory/extract.js";
import { forgetMemoryCard, listMemoryCards } from "../src/memory/store.js";
import type { Message } from "../src/model/types.js";

const SAVED = { ...process.env };

afterEach(() => {
  for (const k of Object.keys(process.env)) {
    if (!(k in SAVED)) delete process.env[k];
  }
  Object.assign(process.env, SAVED);
  delete process.env.HARNESS_HOME;
});

function isolated() {
  const home = mkdtempSync(join(tmpdir(), "ha-mem-life-home-"));
  const cwd = mkdtempSync(join(tmpdir(), "ha-mem-life-cwd-"));
  process.env.HARNESS_HOME = home;
  return { home, cwd };
}

describe("memory lifecycle", () => {
  it("records transcript messages in a stable order", () => {
    const { home, cwd } = isolated();
    const messages: Message[] = [
      { role: "user", content: [{ type: "text", text: "User prefers concise answers." }] },
      {
        role: "assistant",
        content: [
          { type: "text", text: "Noted." },
          { type: "tool_use", id: "t1", name: "read", input: { path: "README.md" } },
        ],
      },
      {
        role: "user",
        content: [{ type: "tool_result", toolUseId: "t1", content: "README body", isError: false }],
      },
    ];
    appendTranscriptMessages("sess-1", messages);
    const transcript = readTranscriptTurns("sess-1");
    expect(transcript.map((turn) => turn.turnIndex)).toEqual([0, 1, 2]);
    expect(transcript[1]?.text).toContain("[tool:read]");
    expect(transcript[2]?.text).toContain("[tool_result:t1]");
    rmSync(home, { recursive: true, force: true });
    rmSync(cwd, { recursive: true, force: true });
  });

  it("can extract from transcript and then forget a memory softly", () => {
    const { home, cwd } = isolated();
    const messages: Message[] = [
      { role: "user", content: [{ type: "text", text: "User prefers concise answers." }] },
      { role: "assistant", content: [{ type: "text", text: "Always run typecheck before tests." }] },
    ];
    appendTranscriptMessages("sess-1", messages);
    const transcript = readTranscriptTurns("sess-1");
    extractAndApplyMemory(cwd, transcript);
    const cards = listMemoryCards(cwd);
    expect(cards.length).toBeGreaterThan(0);
    expect(forgetMemoryCard(cwd, cards[0]!.id)).toBe(true);
    const forgotten = listMemoryCards(cwd).find((card) => card.id === cards[0]!.id);
    expect(forgotten?.status).toBe("forgotten");
    rmSync(home, { recursive: true, force: true });
    rmSync(cwd, { recursive: true, force: true });
  });
});
