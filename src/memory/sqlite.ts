import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";

export function sqliteExists(): boolean {
  return existsSync("/usr/bin/sqlite3");
}

export function sqliteEscape(value: string): string {
  return value.replace(/'/g, "''");
}

export function sqliteExec(dbPath: string, sql: string): string {
  try {
    return execFileSync("sqlite3", [dbPath, sql], {
      encoding: "utf8",
      maxBuffer: 10 * 1024 * 1024,
    }).toString();
  } catch (err) {
    throw new Error(
      `sqlite3 exec failed for ${dbPath}: ${(err as Error).message}\nSQL: ${sql}`,
    );
  }
}

export function sqliteQuery<T = Record<string, unknown>>(
  dbPath: string,
  sql: string,
): T[] {
  try {
    const out = execFileSync("sqlite3", ["-json", dbPath, sql], {
      encoding: "utf8",
      maxBuffer: 10 * 1024 * 1024,
    }).toString().trim();
    if (!out) return [];
    return JSON.parse(out) as T[];
  } catch (err) {
    throw new Error(
      `sqlite3 query failed for ${dbPath}: ${(err as Error).message}\nSQL: ${sql}`,
    );
  }
}
