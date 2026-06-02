import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";
import { extRoots, type ExtScope } from "./paths.js";
import { loadRepoAgentConfig } from "./repoConfig.js";

/**
 * Skills loader (B2, docs/09).
 *
 * A Skill is a named markdown document whose body is injected as high-signal
 * context for a turn (progressive disclosure: only the chosen skill's body is
 * loaded, not every skill at once). Two on-disk shapes are accepted under a
 * scope's `skills/` directory:
 *   - skills/<name>/SKILL.md   (preferred — lets a skill carry helper files)
 *   - skills/<name>.md         (flat single-file form)
 *
 * An optional front-matter block (--- … ---) provides `name` and `description`.
 * Parsing is deliberately tiny: only `key: value` lines, no YAML dependency.
 *
 * Security (docs/04/09): skill content is UNTRUSTED data. It only shapes the
 * model prompt; it never bypasses the permission gate. Any tool the model then
 * calls is still gated normally.
 */

export interface Skill {
  name: string;
  description: string;
  body: string;
  scope: ExtScope;
  scopeLabel: "global" | "project" | "system";
  enabled: boolean;
  approxTokens: number;
  sourcePath: string;
}

interface FrontMatter {
  data: Record<string, string>;
  body: string;
}

/**
 * Split optional `--- … ---` front-matter from a markdown document. Only simple
 * `key: value` lines are read; everything after the closing fence is the body.
 */
export function parseFrontMatter(text: string): FrontMatter {
  const m = /^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/.exec(text);
  if (!m) return { data: {}, body: text.trim() };
  const data: Record<string, string> = {};
  for (const line of (m[1] ?? "").split("\n")) {
    const kv = /^([A-Za-z0-9_-]+)\s*:\s*(.*)$/.exec(line.trim());
    if (kv) data[kv[1]!.toLowerCase()] = (kv[2] ?? "").replace(/^["']|["']$/g, "").trim();
  }
  return { data, body: (m[2] ?? "").trim() };
}

/** Read and parse one skill file into a Skill, or null if unreadable/empty. */
function readSkill(
  file: string,
  fallbackName: string,
  scope: ExtScope,
  disabled: Set<string>,
): Skill | null {
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    return null;
  }
  const { data, body } = parseFrontMatter(text);
  if (!body) return null;
  return {
    name: (data.name ?? fallbackName).toLowerCase(),
    description: data.description ?? "",
    body,
    scope,
    scopeLabel: scope === "project" ? "project" : "global",
    enabled: !disabled.has((data.name ?? fallbackName).toLowerCase()),
    approxTokens: Math.max(1, Math.round(body.length / 4)),
    sourcePath: file,
  };
}

/**
 * Load all skills across the active extension roots. Project-scope skills
 * override user-scope ones with the same name (workdir wins). Returns a map
 * keyed by lowercase skill name.
 */
export function loadSkills(
  cwd: string,
  opts: { includeDisabled?: boolean } = {},
): Map<string, Skill> {
  const disabled = new Set(loadRepoAgentConfig(cwd).disabledSkills);
  const skills = new Map<string, Skill>();
  for (const root of extRoots(cwd)) {
    const dir = join(root.dir, "skills");
    if (!existsSync(dir)) continue;
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = join(dir, entry);
      let skill: Skill | null = null;
      try {
        if (statSync(full).isDirectory()) {
          const md = join(full, "SKILL.md");
          if (existsSync(md)) skill = readSkill(md, entry, root.scope, disabled);
        } else if (entry.endsWith(".md")) {
          skill = readSkill(full, entry.replace(/\.md$/, ""), root.scope, disabled);
        }
      } catch {
        skill = null;
      }
      // Later roots (project) overwrite earlier (user) on name clash.
      if (skill && (opts.includeDisabled || skill.enabled)) skills.set(skill.name, skill);
    }
  }
  return skills;
}

/** Sorted skill list for stable display and prompt injection. */
export function listSkills(skills: Map<string, Skill>): Skill[] {
  return [...skills.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function searchSkills(
  cwd: string,
  query: string,
  limit = 3,
): Skill[] {
  const terms = query
    .toLowerCase()
    .split(/[^\p{L}\p{N}_-]+/u)
    .map((term) => term.trim())
    .filter(Boolean);
  if (terms.length === 0) return [];
  const scored = listSkills(loadSkills(cwd))
    .map((skill) => {
      const haystack = `${skill.name} ${skill.description}`.toLowerCase();
      let score = 0;
      for (const term of terms) {
        if (skill.name === term) score += 120;
        else if (skill.name.startsWith(term)) score += 80;
        else if (skill.name.includes(term)) score += 40;
        else if (haystack.includes(term)) score += 8;
      }
      return { skill, score };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.skill.name.localeCompare(b.skill.name));
  return scored.slice(0, limit).map((entry) => entry.skill);
}

/** Render the catalog lines that should appear in the system prompt. */
export function formatSkillCatalog(skills: Map<string, Skill>): string[] {
  const items = listSkills(skills);
  if (items.length === 0) return [];
  return [
    "Available skills:",
    ...items.map(
      (skill) =>
        `- ${skill.name}: ${skill.description || "(no description)"} ` +
        `(${skill.scopeLabel}, ~${skill.approxTokens} tokens)`,
    ),
    "- When a listed skill fits the task, call skill_load with its name and use the returned body.",
  ];
}

/** Build the body block returned by /skill and skill_load. */
export function skillContextBlock(skill: Skill): string {
  return `# Skill: ${skill.name}\n\n${skill.body}`;
}
