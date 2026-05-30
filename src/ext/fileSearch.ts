import { basename, dirname } from "node:path";
import { walkRelativeFiles } from "../util/fileTree.js";

/**
 * File search for the `@` mention menu (#4).
 *
 * Walks the working directory (skipping noise dirs), substring/subsequence
 * matches the query against each file's relative path, ranks by match quality,
 * and caps the result. Read-only and synchronous — it runs on every keystroke
 * while the `@` menu is open, so it's bounded by MAX_WALK to stay snappy on
 * large trees.
 */

/** Hard cap on files visited per search so a huge tree can't stall the UI. */
const MAX_WALK = 8000;

export interface FileHit {
  /** Path relative to the workdir (forward slashes), the value to insert. */
  path: string;
  /** Directory portion for a dim hint, or "" at the root. */
  dir: string;
}

/**
 * Score a path against a lowercased query. Higher is better; -1 = no match.
 * Rewards: exact basename match > basename prefix > basename substring >
 * path substring > subsequence anywhere. Shorter paths break ties.
 */
function score(pathLower: string, baseLower: string, q: string): number {
  if (q === "") return 1; // empty query: everything matches weakly
  if (baseLower === q) return 1000;
  if (baseLower.startsWith(q)) return 800 - baseLower.length;
  if (baseLower.includes(q)) return 600 - baseLower.length;
  const idx = pathLower.indexOf(q);
  if (idx !== -1) return 400 - idx;
  // Subsequence (fuzzy): all chars of q appear in order somewhere in the path.
  let i = 0;
  for (const ch of pathLower) {
    if (ch === q[i]) i++;
    if (i === q.length) break;
  }
  return i === q.length ? 100 - pathLower.length : -1;
}

/**
 * Search files under `workdir` matching `query`, best first, capped at `limit`.
 */
export function searchFiles(workdir: string, query: string, limit = 20): FileHit[] {
  const files = walkRelativeFiles(workdir, {
    includeHidden: true,
    maxFiles: MAX_WALK,
  });
  const q = query.toLowerCase();
  const scored: Array<{ path: string; s: number }> = [];
  for (const path of files) {
    const s = score(path.toLowerCase(), basename(path).toLowerCase(), q);
    if (s >= 0) scored.push({ path, s });
  }
  scored.sort((a, b) => b.s - a.s || a.path.localeCompare(b.path));
  return scored.slice(0, limit).map(({ path }) => {
    const d = dirname(path);
    return { path, dir: d === "." ? "" : d };
  });
}
