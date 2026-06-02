import type { GitDiffFile } from "../util/git.js";
import { green, red, gray, dim, bold, cyan, yellow } from "./theme.js";

/**
 * Colorize a unified diff / patch for terminal display (#2).
 *
 * Used both for the inline diff shown after a successful edit/write and for the
 * `/diff` command's git output. Pure string→string so it's trivially testable.
 * We color by line prefix, leaving content untouched:
 *  - `+` added → green, `-` removed → red
 *  - `@@ … @@` hunk headers → gray
 *  - `diff`/`index`/`+++`/`---`/`new file`… file headers → dim
 *  - everything else (context) → unchanged
 *
 * The leading `---`/`+++` file markers are NOT treated as add/remove lines
 * (they'd otherwise mis-color), so they're matched before the +/- rules.
 */
export function colorizeDiff(patch: string): string {
  const lines = patch.split("\n");
  const out: string[] = [];
  for (const line of lines) {
    if (line.startsWith("+++") || line.startsWith("---")) {
      out.push(dim(line));
    } else if (line.startsWith("@@")) {
      out.push(gray(line));
    } else if (
      line.startsWith("diff ") ||
      line.startsWith("index ") ||
      line.startsWith("new file") ||
      line.startsWith("deleted file") ||
      line.startsWith("rename ") ||
      line.startsWith("similarity ") ||
      line.startsWith("\\ No newline")
    ) {
      out.push(dim(line));
    } else if (line.startsWith("+")) {
      out.push(green(line));
    } else if (line.startsWith("-")) {
      out.push(red(line));
    } else {
      out.push(line);
    }
  }
  return out.join("\n");
}

/**
 * Trim a unified patch to just its body (drop the `Index:`/`===`/`+++`/`---`
 * header lines that `createTwoFilesPatch` emits) for a tighter inline preview.
 * Keeps hunk headers and the actual +/- lines.
 */
export function diffBody(patch: string): string {
  const lines = patch.split("\n");
  const start = lines.findIndex((l) => l.startsWith("@@"));
  if (start === -1) return patch.trim();
  return lines.slice(start).join("\n").trimEnd();
}

function statusLabel(file: GitDiffFile): string {
  switch (file.status) {
    case "added":
      return green("added");
    case "deleted":
      return red("deleted");
    case "renamed":
      return yellow("renamed");
    case "copied":
      return yellow("copied");
    case "modified":
      return cyan("modified");
    default:
      return dim("changed");
  }
}

export function summarizeDiffFile(file: GitDiffFile): string {
  const stats = `${green("+" + file.additions)} ${red("-" + file.deletions)}`;
  const path =
    file.previousPath && file.previousPath !== file.path
      ? `${file.previousPath} ${dim("→")} ${file.path}`
      : file.path;
  return `${statusLabel(file)}  ${path}  ${dim(`(${stats})`)}`;
}

export function renderDiffFileList(
  title: string,
  files: readonly GitDiffFile[],
): string[] {
  if (files.length === 0) return [dim(`  No ${title.toLowerCase()} changes.`)];
  return [
    bold(`  ${title}`),
    ...files.map((file) => `  ${summarizeDiffFile(file)}`),
  ];
}

export function truncateDiffPatch(patch: string, maxLines = 220): string {
  const lines = patch.trimEnd().split("\n");
  if (lines.length <= maxLines) return patch.trimEnd();
  return (
    lines.slice(0, maxLines).join("\n") +
    `\n${dim(`… truncated after ${maxLines} lines`)}` 
  );
}
