import { resolve } from "node:path";
import type { Tool } from "../tools/types.js";
import type { RepoAgentConfig } from "../ext/repoConfig.js";

export interface ProtectHit {
  reason: string;
}

function normalizedCommand(text: string): string {
  return text.trim().toLowerCase();
}

function matchesBlockedCommand(command: string, blocked: readonly string[]): string | null {
  const hay = normalizedCommand(command);
  return blocked.find((pattern) => hay.includes(pattern.toLowerCase())) ?? null;
}

function protectedPrefixes(cwd: string, paths: readonly string[]): string[] {
  return paths.map((path) => resolve(cwd, path));
}

function hitsProtectedPath(absPath: string, prefixes: readonly string[]): string | null {
  const found = prefixes.find((prefix) => absPath === prefix || absPath.startsWith(prefix + "/"));
  return found ?? null;
}

function shellCommandLine(input: unknown): string | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const rec = input as Record<string, unknown>;
  if (typeof rec.command_line === "string") return rec.command_line;
  if (typeof rec.command === "string") {
    const args = Array.isArray(rec.args)
      ? rec.args.filter((value): value is string => typeof value === "string")
      : [];
    return [rec.command, ...args].join(" ");
  }
  return null;
}

function toolPath(input: unknown): string | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const rec = input as Record<string, unknown>;
  return typeof rec.path === "string" ? rec.path : null;
}

function commandPathTokens(commandLine: string): string[] {
  return commandLine
    .split(/\s+/)
    .map((part) => part.trim().replace(/^['"]|['"]$/g, ""))
    .filter(Boolean)
    .filter((part) => part === "." || part === ".." || part.startsWith("/") || part.startsWith(".") || part.includes("/"));
}

export function protectedActionFor(
  tool: Tool,
  input: unknown,
  cwd: string,
  config: RepoAgentConfig,
): ProtectHit | null {
  const blocked = config.blockedCommands;
  const protectedRoots = protectedPrefixes(cwd, config.protectedPaths);

  if (tool.name === "shell" || tool.name === "bash") {
    const commandLine = shellCommandLine(input);
    if (!commandLine) return null;
    const blockedMatch = matchesBlockedCommand(commandLine, blocked);
    if (blockedMatch) {
      return { reason: `blocked command pattern matched: ${blockedMatch}` };
    }
    for (const token of commandPathTokens(commandLine)) {
      const hit = hitsProtectedPath(resolve(cwd, token), protectedRoots);
      if (hit) return { reason: `command touches protected path: ${hit}` };
    }
    return null;
  }

  if (tool.name === "edit" || tool.name === "write") {
    const path = toolPath(input);
    if (!path) return null;
    const hit = hitsProtectedPath(resolve(cwd, path), protectedRoots);
    if (hit) return { reason: `path is protected: ${hit}` };
  }

  return null;
}
