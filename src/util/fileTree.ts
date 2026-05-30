import { readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/** Directories that are noise for code-oriented file traversal. */
export const NOISE_DIRS = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  "coverage",
  ".next",
  ".cache",
]);

export interface WalkFilesOptions {
  includeHidden?: boolean;
  maxFiles?: number;
}

/**
 * Recursively collect file paths under `root`, returning forward-slash paths
 * relative to that root. Hidden entries are skipped unless requested, while
 * known noise directories are always skipped.
 */
export function walkRelativeFiles(
  root: string,
  opts: WalkFilesOptions = {},
): string[] {
  const out: string[] = [];
  const budget = { n: opts.maxFiles ?? Infinity };
  walk(root, root, out, budget, opts.includeHidden ?? false);
  return out;
}

function walk(
  root: string,
  dir: string,
  out: string[],
  budget: { n: number },
  includeHidden: boolean,
): void {
  if (budget.n <= 0) return;
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    if (budget.n <= 0) return;
    if (NOISE_DIRS.has(entry)) continue;
    if (!includeHidden && entry.startsWith(".")) continue;
    const full = join(dir, entry);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      walk(root, full, out, budget, includeHidden);
    } else if (st.isFile()) {
      out.push(relative(root, full).split("\\").join("/"));
      budget.n -= 1;
    }
  }
}
