import type { Message } from "../model/types.js";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { transcriptPath } from "./paths.js";
import type { RawTurn } from "./types.js";

export function appendTranscriptTurn(sessionId: string, turn: RawTurn): string {
  const path = transcriptPath(sessionId);
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, JSON.stringify(turn) + "\n", "utf8");
  return path;
}

export function readTranscriptTurns(sessionId: string): RawTurn[] {
  const path = transcriptPath(sessionId);
  if (!existsSync(path)) return [];
  const raw = readFileSync(path, "utf8").trim();
  if (!raw) return [];
  const turns: RawTurn[] = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      turns.push(JSON.parse(line) as RawTurn);
    } catch {
      continue;
    }
  }
  return turns;
}

function flattenMessage(message: Message): string {
  return message.content
    .map((block) => {
      if (block.type === "text") return block.text;
      if (block.type === "image") {
        return `[image:${block.source}] ${block.path}`;
      }
      if (block.type === "tool_use") {
        return `[tool:${block.name}] ${JSON.stringify(block.input)}`;
      }
      return `[tool_result:${block.toolUseId}] ${block.content}`;
    })
    .join("\n")
    .trim();
}

export function appendTranscriptMessages(
  sessionId: string,
  messages: Message[],
): RawTurn[] {
  const start = readTranscriptTurns(sessionId).length;
  const appended: RawTurn[] = [];
  for (const [offset, message] of messages.entries()) {
    const text = flattenMessage(message);
    if (!text) continue;
    const turn: RawTurn = {
      sessionId,
      turnIndex: start + offset,
      role: message.role,
      text,
      createdAt: new Date().toISOString(),
    };
    appendTranscriptTurn(sessionId, turn);
    appended.push(turn);
  }
  return appended;
}
