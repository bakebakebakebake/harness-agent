import { createHash } from "node:crypto";
import { join } from "node:path";
import { storeDir } from "../profiles.js";

export function memoryHome(): string {
  return join(storeDir(), "memory");
}

export function userMemoryDir(): string {
  return join(memoryHome(), "user");
}

export function projectMemoryDir(cwd: string): string {
  return join(cwd, ".agents", "memory", "project");
}

export function memoryIndexPath(): string {
  return join(memoryHome(), "index.sqlite");
}

export function transcriptDir(): string {
  return join(memoryHome(), "transcripts");
}

export function transcriptPath(sessionId: string): string {
  return join(transcriptDir(), `${sessionId}.jsonl`);
}

export function digestDir(): string {
  return join(memoryHome(), "digests");
}

function digestId(cwd: string): string {
  return createHash("sha1").update(cwd).digest("hex").slice(0, 12);
}

export function digestPath(cwd: string): string {
  return join(digestDir(), `${digestId(cwd)}.md`);
}
