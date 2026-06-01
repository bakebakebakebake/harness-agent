import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join, dirname } from "node:path";
import { memoryIndexPath, projectMemoryDir, userMemoryDir } from "./paths.js";
import { sqliteEscape, sqliteExec, sqliteQuery } from "./sqlite.js";
import type {
  MemoryCard,
  MemorySearchHit,
  MemoryScope,
  MemoryStatus,
} from "./types.js";

type CardRow = {
  rowid: number;
  id: string;
  path: string;
  title: string;
  scope: MemoryScope;
  kind: string;
  tier: string;
  summary: string;
  body: string;
  tags_json: string;
  entities_json: string;
  importance: number;
  trust: number;
  status: MemoryStatus;
  supersedes_json: string;
  valid_from: string | null;
  valid_until: string | null;
  source_session_id: string | null;
  source_turn_refs_json: string;
  source_kind: string;
  created_at: string;
  updated_at: string;
  last_accessed_at: string | null;
  access_count: number;
};

type CardShape = Omit<CardRow, "rowid" | "path">;

function jsonArray(value: readonly string[] | undefined): string {
  return JSON.stringify(value ?? []);
}

function parseArray(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((v): v is string => typeof v === "string")
      : [];
  } catch {
    return [];
  }
}

function encode(value: unknown): string {
  return JSON.stringify(value);
}

function decode(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

function cardDir(scope: MemoryScope, cwd: string): string {
  return scope === "project" ? projectMemoryDir(cwd) : userMemoryDir();
}

export function cardPath(card: Pick<MemoryCard, "id" | "scope">, cwd: string): string {
  return join(cardDir(card.scope, cwd), `${card.id}.md`);
}

export function ensureMemoryDirs(cwd: string): void {
  mkdirSync(projectMemoryDir(cwd), { recursive: true });
  mkdirSync(userMemoryDir(), { recursive: true });
  mkdirSync(dirname(memoryIndexPath()), { recursive: true });
}

export function serializeMemoryCard(card: MemoryCard): string {
  const frontmatter = [
    "---",
    `id: ${encode(card.id)}`,
    `title: ${encode(card.title)}`,
    `scope: ${encode(card.scope)}`,
    `kind: ${encode(card.kind)}`,
    `tier: ${encode(card.tier)}`,
    `summary: ${encode(card.summary)}`,
    `tags: ${encode(card.tags)}`,
    `entities: ${encode(card.entities)}`,
    `importance: ${encode(card.importance)}`,
    `trust: ${encode(card.trust)}`,
    `status: ${encode(card.status)}`,
    `supersedes: ${encode(card.supersedes)}`,
    `validFrom: ${encode(card.validFrom ?? null)}`,
    `validUntil: ${encode(card.validUntil ?? null)}`,
    `sourceSessionId: ${encode(card.sourceSessionId ?? null)}`,
    `sourceTurnRefs: ${encode(card.sourceTurnRefs)}`,
    `sourceKind: ${encode(card.sourceKind)}`,
    `createdAt: ${encode(card.createdAt)}`,
    `updatedAt: ${encode(card.updatedAt)}`,
    `lastAccessedAt: ${encode(card.lastAccessedAt ?? null)}`,
    `accessCount: ${encode(card.accessCount)}`,
    "---",
  ].join("\n");
  return `${frontmatter}\n${card.body.trimEnd()}\n`;
}

export function parseMemoryCard(text: string): MemoryCard | null {
  const match = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(text);
  if (!match) return null;
  const data: Record<string, unknown> = {};
  for (const line of (match[1] ?? "").split("\n")) {
    if (!line.trim()) continue;
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    const raw = line.slice(idx + 1).trim();
    data[key] = decode(raw);
  }
  const scope = data.scope === "user" ? "user" : "project";
  const kind = typeof data.kind === "string" ? data.kind : "fact";
  const tier = data.tier === "core" ? "core" : "archive";
  const status: MemoryStatus =
    data.status === "superseded" || data.status === "expired" || data.status === "forgotten"
      ? data.status
      : "active";
  return {
    id: typeof data.id === "string" ? data.id : "",
    title: typeof data.title === "string" ? data.title : "",
    scope,
    kind: kind as MemoryCard["kind"],
    tier,
    summary: typeof data.summary === "string" ? data.summary : "",
    body: (match[2] ?? "").trimEnd(),
    tags: parseArray(typeof data.tags === "string" ? data.tags : JSON.stringify(data.tags)),
    entities: parseArray(
      typeof data.entities === "string" ? data.entities : JSON.stringify(data.entities),
    ),
    importance: typeof data.importance === "number" ? data.importance : Number(data.importance ?? 0),
    trust: typeof data.trust === "number" ? data.trust : Number(data.trust ?? 0),
    status,
    supersedes: parseArray(
      typeof data.supersedes === "string" ? data.supersedes : JSON.stringify(data.supersedes),
    ),
    validFrom: typeof data.validFrom === "string" && data.validFrom ? data.validFrom : undefined,
    validUntil:
      typeof data.validUntil === "string" && data.validUntil ? data.validUntil : undefined,
    sourceSessionId:
      typeof data.sourceSessionId === "string" && data.sourceSessionId
        ? data.sourceSessionId
        : undefined,
    sourceTurnRefs: parseArray(
      typeof data.sourceTurnRefs === "string"
        ? data.sourceTurnRefs
        : JSON.stringify(data.sourceTurnRefs),
    ),
    sourceKind:
      data.sourceKind === "extracted" || data.sourceKind === "inferred"
        ? data.sourceKind
        : "manual",
    createdAt: typeof data.createdAt === "string" ? data.createdAt : new Date().toISOString(),
    updatedAt: typeof data.updatedAt === "string" ? data.updatedAt : new Date().toISOString(),
    lastAccessedAt:
      typeof data.lastAccessedAt === "string" && data.lastAccessedAt
        ? data.lastAccessedAt
        : undefined,
    accessCount:
      typeof data.accessCount === "number" ? data.accessCount : Number(data.accessCount ?? 0),
  };
}

export function writeMemoryCard(cwd: string, card: MemoryCard): string {
  ensureMemoryDirs(cwd);
  const path = cardPath(card, cwd);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, serializeMemoryCard(card), "utf8");
  return path;
}

export function readMemoryCard(path: string): MemoryCard | null {
  if (!existsSync(path)) return null;
  try {
    return parseMemoryCard(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

export function listMemoryCardFiles(cwd: string, scope?: MemoryScope): string[] {
  const dirs = scope
    ? [cardDir(scope, cwd)]
    : [projectMemoryDir(cwd), userMemoryDir()];
  const files: string[] = [];
  for (const dir of dirs) {
    if (!existsSync(dir)) continue;
    for (const entry of readdirSync(dir)) {
      if (entry.endsWith(".md")) files.push(join(dir, entry));
    }
  }
  return files.sort();
}

export function memoryDbPath(): string {
  return memoryIndexPath();
}

export function ensureMemoryIndex(cwd: string): string {
  ensureMemoryDirs(cwd);
  const dbPath = memoryDbPath();
  if (!existsSync(dbPath)) {
    writeFileSync(dbPath, "", "utf8");
  }
  sqliteExec(
    dbPath,
    [
      "PRAGMA journal_mode=WAL;",
      "PRAGMA foreign_keys=ON;",
      "CREATE TABLE IF NOT EXISTS memory_cards (",
      "  rowid INTEGER PRIMARY KEY AUTOINCREMENT,",
      "  id TEXT NOT NULL UNIQUE,",
      "  path TEXT NOT NULL UNIQUE,",
      "  title TEXT NOT NULL,",
      "  scope TEXT NOT NULL,",
      "  kind TEXT NOT NULL,",
      "  tier TEXT NOT NULL,",
      "  summary TEXT NOT NULL,",
      "  body TEXT NOT NULL,",
      "  tags_json TEXT NOT NULL,",
      "  entities_json TEXT NOT NULL,",
      "  importance REAL NOT NULL DEFAULT 0,",
      "  trust REAL NOT NULL DEFAULT 0,",
      "  status TEXT NOT NULL,",
      "  supersedes_json TEXT NOT NULL,",
      "  valid_from TEXT,",
      "  valid_until TEXT,",
      "  source_session_id TEXT,",
      "  source_turn_refs_json TEXT NOT NULL,",
      "  source_kind TEXT NOT NULL,",
      "  created_at TEXT NOT NULL,",
      "  updated_at TEXT NOT NULL,",
      "  last_accessed_at TEXT,",
      "  access_count INTEGER NOT NULL DEFAULT 0",
      ");",
      "CREATE VIRTUAL TABLE IF NOT EXISTS memory_cards_fts USING fts5(",
      "  id UNINDEXED, title, summary, body, tags, entities, scope, kind, tier, status,",
      "  content='memory_cards', content_rowid='rowid'",
      ");",
      "CREATE TRIGGER IF NOT EXISTS memory_cards_ai AFTER INSERT ON memory_cards BEGIN",
      "  INSERT INTO memory_cards_fts(rowid, id, title, summary, body, tags, entities, scope, kind, tier, status)",
      "  VALUES (new.rowid, new.id, new.title, new.summary, new.body, new.tags_json, new.entities_json, new.scope, new.kind, new.tier, new.status);",
      "END;",
      "CREATE TRIGGER IF NOT EXISTS memory_cards_au AFTER UPDATE ON memory_cards BEGIN",
      "  INSERT INTO memory_cards_fts(memory_cards_fts, rowid, id, title, summary, body, tags, entities, scope, kind, tier, status)",
      "  VALUES ('delete', old.rowid, old.id, old.title, old.summary, old.body, old.tags_json, old.entities_json, old.scope, old.kind, old.tier, old.status);",
      "  INSERT INTO memory_cards_fts(rowid, id, title, summary, body, tags, entities, scope, kind, tier, status)",
      "  VALUES (new.rowid, new.id, new.title, new.summary, new.body, new.tags_json, new.entities_json, new.scope, new.kind, new.tier, new.status);",
      "END;",
      "CREATE TRIGGER IF NOT EXISTS memory_cards_ad AFTER DELETE ON memory_cards BEGIN",
      "  INSERT INTO memory_cards_fts(memory_cards_fts, rowid, id, title, summary, body, tags, entities, scope, kind, tier, status)",
      "  VALUES ('delete', old.rowid, old.id, old.title, old.summary, old.body, old.tags_json, old.entities_json, old.scope, old.kind, old.tier, old.status);",
      "END;",
    ].join("\n"),
  );
  return dbPath;
}

export function cardToRow(card: MemoryCard, path: string): string {
  return [
    "INSERT INTO memory_cards(",
    "id, path, title, scope, kind, tier, summary, body, tags_json, entities_json, importance, trust, status, supersedes_json, valid_from, valid_until, source_session_id, source_turn_refs_json, source_kind, created_at, updated_at, last_accessed_at, access_count",
    ") VALUES (",
    [
      card.id,
      path,
      card.title,
      card.scope,
      card.kind,
      card.tier,
      card.summary,
      card.body,
      jsonArray(card.tags),
      jsonArray(card.entities),
      String(card.importance),
      String(card.trust),
      card.status,
      jsonArray(card.supersedes),
      card.validFrom ?? null,
      card.validUntil ?? null,
      card.sourceSessionId ?? null,
      jsonArray(card.sourceTurnRefs),
      card.sourceKind,
      card.createdAt,
      card.updatedAt,
      card.lastAccessedAt ?? null,
      String(card.accessCount),
    ]
      .map((v) => (v === null ? "NULL" : `'${sqliteEscape(String(v))}'`))
      .join(", "),
    ") ON CONFLICT(id) DO UPDATE SET ",
    [
      "path=excluded.path",
      "title=excluded.title",
      "scope=excluded.scope",
      "kind=excluded.kind",
      "tier=excluded.tier",
      "summary=excluded.summary",
      "body=excluded.body",
      "tags_json=excluded.tags_json",
      "entities_json=excluded.entities_json",
      "importance=excluded.importance",
      "trust=excluded.trust",
      "status=excluded.status",
      "supersedes_json=excluded.supersedes_json",
      "valid_from=excluded.valid_from",
      "valid_until=excluded.valid_until",
      "source_session_id=excluded.source_session_id",
      "source_turn_refs_json=excluded.source_turn_refs_json",
      "source_kind=excluded.source_kind",
      "created_at=excluded.created_at",
      "updated_at=excluded.updated_at",
      "last_accessed_at=excluded.last_accessed_at",
      "access_count=excluded.access_count",
    ].join(", "),
    ";",
  ].join("");
}

function rowToCard(row: CardShape): MemoryCard {
  return {
    id: row.id,
    title: row.title,
    scope: row.scope,
    kind: row.kind as MemoryCard["kind"],
    tier: row.tier as MemoryCard["tier"],
    summary: row.summary,
    body: row.body,
    tags: parseArray(row.tags_json),
    entities: parseArray(row.entities_json),
    importance: row.importance,
    trust: row.trust,
    status: row.status,
    supersedes: parseArray(row.supersedes_json),
    validFrom: row.valid_from ?? undefined,
    validUntil: row.valid_until ?? undefined,
    sourceSessionId: row.source_session_id ?? undefined,
    sourceTurnRefs: parseArray(row.source_turn_refs_json),
    sourceKind: row.source_kind as MemoryCard["sourceKind"],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastAccessedAt: row.last_accessed_at ?? undefined,
    accessCount: row.access_count,
  };
}

export function upsertMemoryCard(cwd: string, card: MemoryCard): string {
  const dbPath = ensureMemoryIndex(cwd);
  const path = writeMemoryCard(cwd, card);
  sqliteExec(dbPath, cardToRow(card, path));
  return path;
}

export function readMemoryCardFromDb(cwd: string, id: string): MemoryCard | null {
  const dbPath = ensureMemoryIndex(cwd);
  const rows = sqliteQuery<CardRow>(
    dbPath,
    `SELECT * FROM memory_cards WHERE id = '${sqliteEscape(id)}' LIMIT 1;`,
  );
  return rows[0] ? rowToCard(rows[0]!) : null;
}

export function listMemoryCards(cwd: string, scope?: MemoryScope): MemoryCard[] {
  const dbPath = ensureMemoryIndex(cwd);
  const where = scope ? `WHERE scope = '${sqliteEscape(scope)}'` : "";
  const rows = sqliteQuery<CardRow>(
    dbPath,
    `SELECT * FROM memory_cards ${where} ORDER BY updated_at DESC, created_at DESC;`,
  );
  return rows.map(rowToCard);
}

export function listSupersedingMemoryCards(cwd: string, id: string): MemoryCard[] {
  return listMemoryCards(cwd).filter((card) => card.supersedes.includes(id));
}

function ftsQuery(query: string): string {
  const terms = query
    .toLowerCase()
    .split(/[^\p{L}\p{N}_-]+/u)
    .map((t) => t.trim())
    .filter(Boolean)
    .slice(0, 12);
  if (terms.length === 0) return '""';
  return terms.map((t) => `"${t.replace(/"/g, '""')}"`).join(" AND ");
}

export function searchMemoryCards(
  cwd: string,
  query: string,
  opts?: { scope?: MemoryScope; limit?: number },
): MemorySearchHit[] {
  const dbPath = ensureMemoryIndex(cwd);
  const clause = ftsQuery(query);
  const scopeClause = opts?.scope ? `AND c.scope = '${sqliteEscape(opts.scope)}'` : "";
  const limit = opts?.limit ?? 5;
  const rows = sqliteQuery<{
    id: string;
    score: number;
    title: string;
    scope: MemoryScope;
    kind: string;
    tier: string;
    summary: string;
    body: string;
    tags_json: string;
    entities_json: string;
    importance: number;
    trust: number;
    status: MemoryStatus;
    supersedes_json: string;
    valid_from: string | null;
    valid_until: string | null;
    source_session_id: string | null;
    source_turn_refs_json: string;
    source_kind: string;
    created_at: string;
    updated_at: string;
    last_accessed_at: string | null;
    access_count: number;
  }>(
    dbPath,
    [
      "SELECT",
      "  c.id,",
      "  bm25(memory_cards_fts) AS score,",
      "  c.title, c.scope, c.kind, c.tier, c.summary, c.body, c.tags_json, c.entities_json,",
      "  c.importance, c.trust, c.status, c.supersedes_json, c.valid_from, c.valid_until,",
      "  c.source_session_id, c.source_turn_refs_json, c.source_kind, c.created_at,",
      "  c.updated_at, c.last_accessed_at, c.access_count",
      "FROM memory_cards_fts",
      "JOIN memory_cards c ON c.rowid = memory_cards_fts.rowid",
      `WHERE memory_cards_fts MATCH '${sqliteEscape(clause)}' ${scopeClause}`,
      "ORDER BY score ASC, c.updated_at DESC",
      `LIMIT ${limit};`,
    ].join(" "),
  );
  return rows.map((row) => ({
    card: rowToCard(row as CardShape),
    score: typeof row.score === "number" ? row.score : Number(row.score ?? 0),
    reason: `fts:${ftsQuery(query)}`,
  }));
}

export function rebuildMemoryIndex(cwd: string): number {
  const dbPath = ensureMemoryIndex(cwd);
  sqliteExec(dbPath, "DELETE FROM memory_cards;");
  const cards = listMemoryCardFiles(cwd).map(readMemoryCard).filter((c): c is MemoryCard => c !== null);
  let count = 0;
  for (const card of cards) {
    upsertMemoryCard(cwd, card);
    count += 1;
  }
  return count;
}

export function forgetMemoryCard(cwd: string, id: string): boolean {
  const card = readMemoryCardFromDb(cwd, id);
  if (!card) return false;
  const updated: MemoryCard = {
    ...card,
    status: "forgotten",
    updatedAt: new Date().toISOString(),
  };
  upsertMemoryCard(cwd, updated);
  return true;
}

export function touchMemoryCard(cwd: string, id: string): boolean {
  const card = readMemoryCardFromDb(cwd, id);
  if (!card) return false;
  const updated: MemoryCard = {
    ...card,
    accessCount: card.accessCount + 1,
    lastAccessedAt: new Date().toISOString(),
  };
  upsertMemoryCard(cwd, updated);
  return true;
}

export function listMemoryStats(cwd: string): {
  total: number;
  active: number;
  superseded: number;
  expired: number;
  forgotten: number;
} {
  const cards = listMemoryCards(cwd);
  let active = 0;
  let superseded = 0;
  let expired = 0;
  let forgotten = 0;
  for (const card of cards) {
    if (card.status === "active") active += 1;
    else if (card.status === "superseded") superseded += 1;
    else if (card.status === "expired") expired += 1;
    else forgotten += 1;
  }
  return { total: cards.length, active, superseded, expired, forgotten };
}
