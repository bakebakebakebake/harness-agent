import {
  accessSync,
  constants,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { basename, extname, isAbsolute, join, resolve } from "node:path";
import { storeDir } from "../profiles.js";
import type { Config } from "../config.js";
import type { ContentBlock } from "../model/types.js";

export type VisionMode = "auto" | "on" | "off";
export type PendingImageBlock = Extract<ContentBlock, { type: "image" }>;

const IMAGE_MIME_BY_EXT = new Map<string, PendingImageBlock["mimeType"]>([
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".webp", "image/webp"],
  [".gif", "image/gif"],
]);

const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const MAX_TOTAL_IMAGE_BYTES = 40 * 1024 * 1024;

function normalizePath(input: string, cwd: string): string {
  return isAbsolute(input) ? input : resolve(cwd, input);
}

export function imageMimeTypeForPath(path: string): PendingImageBlock["mimeType"] | null {
  return IMAGE_MIME_BY_EXT.get(extname(path).toLowerCase()) ?? null;
}

export function isImagePath(path: string): boolean {
  return imageMimeTypeForPath(path) !== null;
}

export function validateImagePath(
  inputPath: string,
  opts: {
    cwd?: string;
    source?: PendingImageBlock["source"];
    alt?: string;
  } = {},
): PendingImageBlock {
  const cwd = opts.cwd ?? process.cwd();
  const path = normalizePath(inputPath.trim(), cwd);
  const mimeType = imageMimeTypeForPath(path);
  if (!mimeType) {
    throw new Error(`Unsupported image type: ${inputPath}`);
  }
  if (!existsSync(path)) {
    throw new Error(`Image not found: ${path}`);
  }
  accessSync(path, constants.R_OK);
  const stat = statSync(path);
  if (!stat.isFile()) throw new Error(`Not a file: ${path}`);
  if (stat.size > MAX_IMAGE_BYTES) {
    throw new Error(`Image is too large: ${basename(path)} (${stat.size} bytes)`);
  }
  return {
    type: "image",
    path,
    mimeType,
    source: opts.source ?? "file",
    ...(opts.alt?.trim() ? { alt: opts.alt.trim() } : {}),
  };
}

export function readImageAsBase64(path: string): string {
  return readFileSync(path).toString("base64");
}

export function enforceVisionMode(
  config: Pick<Config, "provider" | "model" | "visionMode">,
  images: readonly PendingImageBlock[],
): void {
  if (images.length === 0) return;
  const totalBytes = images.reduce((sum, image) => {
    try {
      return sum + statSync(image.path).size;
    } catch {
      return sum;
    }
  }, 0);
  if (totalBytes > MAX_TOTAL_IMAGE_BYTES) {
    throw new Error(`Attached images exceed the ${MAX_TOTAL_IMAGE_BYTES} byte limit.`);
  }
  const mode = config.visionMode ?? "auto";
  if (mode === "off") {
    throw new Error("Image input is disabled for the active profile (visionMode=off).");
  }
  if (mode === "auto" && !modelSupportsVision(config.provider, config.model)) {
    throw new Error(`Model "${config.model}" does not look vision-capable. Switch visionMode to on if you know it supports images.`);
  }
}

export function modelSupportsVision(
  provider: Config["provider"],
  model: string,
): boolean {
  const value = model.toLowerCase();
  if (provider === "anthropic") {
    return /claude|sonnet|haiku|opus/.test(value);
  }
  return /gpt-4\.1|gpt-4o|gpt-5|o1|o3|o4|vision|vl|gemini|qwen-vl|glm-4v|claude/.test(value);
}

function clipboardImportScript(pngPath: string, tiffPath: string): string {
  return `
ObjC.import("AppKit");
ObjC.import("Foundation");
const pngTarget = ${JSON.stringify(pngPath)};
const tiffTarget = ${JSON.stringify(tiffPath)};
const board = $.NSPasteboard.generalPasteboard;

function isNil(value) {
  return ObjC.unwrap(value) === undefined;
}

function saveFirst(types, target) {
  for (const type of types) {
    const data = board.dataForType($(type));
    if (isNil(data)) continue;
    if (!data.writeToFileOptionsError($(target), 0, null)) {
      throw new Error("Failed to save clipboard image.");
    }
    return true;
  }
  return false;
}
if (saveFirst(["public.png"], pngTarget)) {
  console.log("png");
} else if (saveFirst(["public.tiff"], tiffTarget)) {
  console.log("tiff");
} else {
  throw new Error("Clipboard does not contain a readable image.");
}
`;
}

export function importClipboardImage(): PendingImageBlock {
  const dir = join(storeDir(), "tmp", "images");
  mkdirSync(dir, { recursive: true });
  const base = join(dir, `${Date.now()}-${randomUUID()}`);
  const pngPath = `${base}.png`;
  const tiffPath = `${base}.tiff`;
  const script = clipboardImportScript(pngPath, tiffPath);
  const result = spawnSync("osascript", ["-l", "JavaScript"], {
    input: script,
    encoding: "utf8",
  });
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || "").trim();
    throw new Error(detail || "Clipboard does not contain a readable image.");
  }
  const rawType = (result.stdout || "").trim().toLowerCase();
  if (rawType === "tiff") {
    const convert = spawnSync("sips", ["-s", "format", "png", tiffPath, "--out", pngPath], {
      encoding: "utf8",
    });
    rmSync(tiffPath, { force: true });
    if (convert.status !== 0) {
      const detail = (convert.stderr || convert.stdout || "").trim();
      throw new Error(detail || "Failed to convert clipboard image to PNG.");
    }
  }
  return validateImagePath(pngPath, { source: "clipboard" });
}

function unescapeShellPathToken(token: string): string {
  let out = "";
  let escaping = false;
  for (const ch of token) {
    if (escaping) {
      out += ch;
      escaping = false;
      continue;
    }
    if (ch === "\\") {
      escaping = true;
      continue;
    }
    out += ch;
  }
  return out;
}

interface ShellToken {
  value: string;
  start: number;
  end: number;
}

function shellTokens(text: string): ShellToken[] {
  const out: ShellToken[] = [];
  let current = "";
  let quote: '"' | "'" | null = null;
  let escaping = false;
  let tokenStart = -1;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (escaping) {
      current += ch;
      escaping = false;
      continue;
    }
    if (ch === "\\") {
      if (tokenStart === -1) tokenStart = i;
      escaping = true;
      continue;
    }
    if (quote) {
      if (ch === quote) {
        quote = null;
      } else {
        current += ch;
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      if (tokenStart === -1) tokenStart = i;
      quote = ch;
      continue;
    }
    if (/\s/.test(ch)) {
      if (current) {
        out.push({
          value: unescapeShellPathToken(current),
          start: tokenStart,
          end: i,
        });
        current = "";
        tokenStart = -1;
      }
      continue;
    }
    if (tokenStart === -1) tokenStart = i;
    current += ch;
  }
  if (current) {
    out.push({
      value: unescapeShellPathToken(current),
      start: tokenStart,
      end: text.length,
    });
  }
  return out;
}

export function detectDroppedImagePaths(
  text: string,
  cwd: string,
): PendingImageBlock[] {
  const tokens = shellTokens(text).map((token) => token.value);
  if (tokens.length === 0) return [];
  const resolved = tokens.map((token) => normalizePath(token, cwd));
  if (resolved.some((token) => !existsSync(token) || !isImagePath(token))) return [];
  return resolved.map((path) => validateImagePath(path, { cwd, source: "drop" }));
}

export function consumeImagePathsFromText(
  text: string,
  cwd: string,
): { text: string; images: PendingImageBlock[] } {
  const tokens = shellTokens(text);
  if (tokens.length === 0) return { text, images: [] };

  const images: PendingImageBlock[] = [];
  const removals: Array<{ start: number; end: number }> = [];
  for (const token of tokens) {
    try {
      const image = validateImagePath(token.value, { cwd, source: "file" });
      images.push(image);
      removals.push({ start: token.start, end: token.end });
    } catch {
      continue;
    }
  }
  if (images.length === 0) return { text, images: [] };

  let remaining = "";
  let cursor = 0;
  for (const removal of removals) {
    remaining += text.slice(cursor, removal.start);
    cursor = removal.end;
  }
  remaining += text.slice(cursor);
  return { text: remaining.replace(/\s{2,}/g, " ").trim(), images };
}

export function listImageFiles(cwd: string, limit = 40): string[] {
  const out: string[] = [];
  const queue = [cwd];
  while (queue.length > 0 && out.length < limit) {
    const dir = queue.shift()!;
    let entries: ReturnType<typeof readdirSync>;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (out.length >= limit) break;
      if (entry.name.startsWith(".git")) continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        queue.push(full);
        continue;
      }
      if (entry.isFile() && isImagePath(full)) out.push(full);
    }
  }
  return out;
}
