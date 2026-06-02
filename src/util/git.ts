import { spawnSync } from "node:child_process";

/**
 * Tiny git helpers (#2 diff, #10 branch). Parameterized spawnSync (shell:false)
 * so no value is ever interpolated into a shell string. All functions degrade
 * gracefully when git is missing or the directory isn't a repo — they return
 * null/empty rather than throwing, so callers can show a friendly message.
 */

/** Run git with args in `cwd`, returning stdout (or null on any failure). */
function git(cwd: string, args: string[]): string | null {
  try {
    const r = spawnSync("git", args, {
      cwd,
      encoding: "utf8",
      shell: false,
      maxBuffer: 10 * 1024 * 1024,
    });
    if (r.status !== 0 || r.error) return null;
    return r.stdout;
  } catch {
    return null;
  }
}

function diffBaseArgs(opts: { staged?: boolean } = {}): string[] {
  const args = ["--no-pager", "diff", "--no-color"];
  if (opts.staged) args.push("--staged");
  return args;
}

function withPath(args: string[], path?: string): string[] {
  return path ? [...args, "--", path] : args;
}

/** True if `cwd` is inside a git work tree. */
export function isGitRepo(cwd: string): boolean {
  const out = git(cwd, ["rev-parse", "--is-inside-work-tree"]);
  return out?.trim() === "true";
}

/**
 * Current branch name, or null if not a repo / git missing / detached HEAD
 * (in which case the short commit is returned instead when available).
 */
export function gitBranch(cwd: string): string | null {
  const out = git(cwd, ["rev-parse", "--abbrev-ref", "HEAD"]);
  if (out === null) return null;
  const name = out.trim();
  if (!name) return null;
  if (name === "HEAD") {
    // Detached: fall back to the short SHA so the footer still says something.
    const sha = git(cwd, ["rev-parse", "--short", "HEAD"]);
    return sha ? sha.trim() : null;
  }
  return name;
}

/**
 * Cached wrapper over gitBranch for the prompt footer (#10). The footer is
 * reprinted before every prompt, but the branch rarely changes; spawning git
 * each time would be wasteful. Results are cached per-cwd for `ttlMs` (default
 * 5s) so a `git checkout` between prompts is still picked up promptly.
 */
const branchCache = new Map<string, { value: string | null; at: number }>();

export function gitBranchCached(cwd: string, ttlMs = 5000): string | null {
  const now = Date.now();
  const hit = branchCache.get(cwd);
  if (hit && now - hit.at < ttlMs) return hit.value;
  const value = gitBranch(cwd);
  branchCache.set(cwd, { value, at: now });
  return value;
}

/** Drop cached branch data (used by tests and after a known branch change). */
export function clearBranchCache(): void {
  branchCache.clear();
}

/**
 * Working-tree diff. With `staged`, shows the index diff (`--staged`).
 * Returns the raw unified diff (possibly empty), or null if not a repo.
 */
export function gitDiff(
  cwd: string,
  opts: { staged?: boolean; path?: string } = {},
): string | null {
  if (!isGitRepo(cwd)) return null;
  return git(cwd, withPath(diffBaseArgs(opts), opts.path));
}

export interface GitDiffFile {
  path: string;
  previousPath?: string;
  status: "modified" | "added" | "deleted" | "renamed" | "copied" | "unknown";
  additions: number;
  deletions: number;
}

function mapStatus(code: string): GitDiffFile["status"] {
  switch (code[0] ?? "") {
    case "A":
      return "added";
    case "D":
      return "deleted";
    case "R":
      return "renamed";
    case "C":
      return "copied";
    case "M":
      return "modified";
    default:
      return "unknown";
  }
}

export function gitDiffFiles(
  cwd: string,
  opts: { staged?: boolean; path?: string } = {},
): GitDiffFile[] | null {
  if (!isGitRepo(cwd)) return null;
  const numstat = git(cwd, withPath([...diffBaseArgs(opts), "--numstat"], opts.path)) ?? "";
  const nameStatus = git(cwd, withPath([...diffBaseArgs(opts), "--name-status"], opts.path)) ?? "";
  const stats = new Map<string, { additions: number; deletions: number }>();

  for (const line of numstat.split("\n")) {
    if (!line.trim()) continue;
    const parts = line.split("\t");
    if (parts.length < 3) continue;
    const additions = parts[0] === "-" ? 0 : Number(parts[0] ?? 0);
    const deletions = parts[1] === "-" ? 0 : Number(parts[1] ?? 0);
    const path = parts.slice(2).join("\t");
    stats.set(path, {
      additions: Number.isFinite(additions) ? additions : 0,
      deletions: Number.isFinite(deletions) ? deletions : 0,
    });
  }

  const files: GitDiffFile[] = [];
  for (const line of nameStatus.split("\n")) {
    if (!line.trim()) continue;
    const parts = line.split("\t");
    const code = parts[0] ?? "M";
    const status = mapStatus(code);
    const previousPath =
      status === "renamed" || status === "copied" ? parts[1] : undefined;
    const path =
      status === "renamed" || status === "copied"
        ? parts[2] ?? parts[1] ?? ""
        : parts[1] ?? "";
    const stat = stats.get(path) ?? stats.get(parts.slice(1).join("\t")) ?? {
      additions: 0,
      deletions: 0,
    };
    files.push({
      path,
      ...(previousPath ? { previousPath } : {}),
      status,
      additions: stat.additions,
      deletions: stat.deletions,
    });
  }
  return files;
}
