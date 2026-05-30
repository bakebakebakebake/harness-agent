import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { extRoots, type ExtScope } from "./paths.js";

/** Stdio-based MCP server definition loaded from a project/user config file. */
export interface McpServerDefinition {
  name: string;
  command: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  description?: string;
  scope: ExtScope;
}

function parseJson(file: string): unknown | null {
  try {
    return JSON.parse(readFileSync(file, "utf8")) as unknown;
  } catch {
    return null;
  }
}

function normalize(def: Partial<McpServerDefinition>, fallback: string, scope: ExtScope): McpServerDefinition | null {
  if (typeof def.command !== "string" || def.command.trim() === "") return null;
  return {
    name: (typeof def.name === "string" && def.name.trim() ? def.name : fallback).toLowerCase(),
    command: def.command,
    ...(Array.isArray(def.args) ? { args: def.args.filter((a) => typeof a === "string") as string[] } : {}),
    ...(typeof def.cwd === "string" && def.cwd.trim() ? { cwd: def.cwd } : {}),
    ...(def.env && typeof def.env === "object" ? { env: Object.fromEntries(Object.entries(def.env).filter(([, v]) => typeof v === "string")) as Record<string, string> } : {}),
    ...(typeof def.description === "string" && def.description.trim() ? { description: def.description } : {}),
    scope,
  };
}

/**
 * Load MCP server definitions across the active extension roots.
 *
 * The shape is intentionally tiny: one JSON file per server under
 * `.agent/mcp/*.json` (or `.agents/mcp/*.json`). Project scope wins on name
 * clashes.
 */
export function loadMcpServerDefinitions(cwd: string): McpServerDefinition[] {
  const byName = new Map<string, McpServerDefinition>();
  for (const root of extRoots(cwd)) {
    const dir = join(root.dir, "mcp");
    if (!existsSync(dir)) continue;
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.endsWith(".json")) continue;
      const full = join(dir, entry);
      const parsed = parseJson(full);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) continue;
      const def = normalize(
        parsed as Partial<McpServerDefinition>,
        entry.replace(/\.json$/, ""),
        root.scope,
      );
      if (!def) continue;
      byName.set(def.name, def);
    }
  }
  return [...byName.values()];
}
