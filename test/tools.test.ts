import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeTool } from "../src/tools/write.js";
import { grepTool } from "../src/tools/grep.js";
import { lsTool } from "../src/tools/ls.js";
import { globTool } from "../src/tools/glob.js";
import { todoReadTool, todoWriteTool } from "../src/tools/todo.js";
import { defaultRegistry } from "../src/tools/registry.js";
import { systemPrompt } from "../src/prompt.js";
import type { TodoItem } from "../src/todos.js";

let dir: string;
const ctx = () => ({ workdir: dir });

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "tools-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("write tool", () => {
  it("creates a new file, making parent directories", async () => {
    const r = await writeTool.execute(
      { path: "src/deep/new.ts", content: "export const x = 1;\n" },
      ctx(),
    );
    expect(r.isError).toBe(false);
    expect(readFileSync(join(dir, "src/deep/new.ts"), "utf8")).toBe(
      "export const x = 1;\n",
    );
    expect(r.content).toContain("Created");
  });

  it("overwrites an existing file and reports it", async () => {
    writeFileSync(join(dir, "a.txt"), "old");
    const r = await writeTool.execute({ path: "a.txt", content: "new" }, ctx());
    expect(r.isError).toBe(false);
    expect(r.content).toContain("Overwrote");
    expect(readFileSync(join(dir, "a.txt"), "utf8")).toBe("new");
  });

  it("rejects paths outside the workdir", async () => {
    const r = await writeTool.execute(
      { path: "../escape.txt", content: "x" },
      ctx(),
    );
    expect(r.isError).toBe(true);
    expect(r.content).toMatch(/outside the working directory/);
  });

  it("previews a create as a diff against /dev/null", () => {
    const preview = writeTool.describeAction!(
      { path: "n.ts", content: "a\nb\n" },
      ctx(),
    );
    expect(preview.summary).toContain("Create n.ts");
    expect(preview.details).toContain("/dev/null");
  });
});

describe("grep tool", () => {
  beforeEach(() => {
    mkdirSync(join(dir, "src"));
    writeFileSync(join(dir, "src/a.ts"), "const foo = 1;\nconst bar = 2;\n");
    writeFileSync(join(dir, "src/b.ts"), "function foo() {}\n");
    writeFileSync(join(dir, "notes.md"), "foo appears here too\n");
  });

  it("finds matches across files as path:line: text", async () => {
    const r = await grepTool.execute({ pattern: "foo" }, ctx());
    expect(r.isError).toBe(false);
    expect(r.content).toContain("src/a.ts:1:");
    expect(r.content).toContain("src/b.ts:1:");
    expect(r.content).toContain("notes.md:1:");
  });

  it("restricts by glob", async () => {
    const r = await grepTool.execute({ pattern: "foo", glob: "*.md" }, ctx());
    expect(r.content).toContain("notes.md");
    expect(r.content).not.toContain("src/a.ts");
  });

  it("supports case-insensitive search", async () => {
    writeFileSync(join(dir, "c.ts"), "const FOO = 9;\n");
    const r = await grepTool.execute(
      { pattern: "foo", ignore_case: true },
      ctx(),
    );
    expect(r.content).toContain("c.ts:1:");
  });

  it("reports no matches cleanly", async () => {
    const r = await grepTool.execute({ pattern: "zzzznope" }, ctx());
    expect(r.isError).toBe(false);
    expect(r.content).toMatch(/No matches/);
  });

  it("returns an info-rich error on a bad regex", async () => {
    const r = await grepTool.execute({ pattern: "(" }, ctx());
    expect(r.isError).toBe(true);
    expect(r.content).toMatch(/Invalid regular expression/);
  });
});

describe("ls tool", () => {
  beforeEach(() => {
    mkdirSync(join(dir, "src"));
    writeFileSync(join(dir, "src/a.ts"), "x");
    writeFileSync(join(dir, "readme.md"), "hello");
    writeFileSync(join(dir, ".hidden"), "secret");
  });

  it("lists directories first with a trailing slash, then files", async () => {
    const r = await lsTool.execute({}, ctx());
    expect(r.isError).toBe(false);
    expect(r.content).toContain("src/");
    expect(r.content).toContain("readme.md");
  });

  it("hides dotfiles unless all is set", async () => {
    const hidden = await lsTool.execute({}, ctx());
    expect(hidden.content).not.toContain(".hidden");
    const shown = await lsTool.execute({ all: true }, ctx());
    expect(shown.content).toContain(".hidden");
  });

  it("errors when the path is a file", async () => {
    const r = await lsTool.execute({ path: "readme.md" }, ctx());
    expect(r.isError).toBe(true);
    expect(r.content).toMatch(/not a directory/);
  });

  it("rejects paths outside the workdir", async () => {
    const r = await lsTool.execute({ path: ".." }, ctx());
    expect(r.isError).toBe(true);
  });
});

describe("glob tool", () => {
  beforeEach(() => {
    mkdirSync(join(dir, "src", "util"), { recursive: true });
    mkdirSync(join(dir, "node_modules", "dep"), { recursive: true });
    writeFileSync(join(dir, "src", "app.ts"), "x");
    writeFileSync(join(dir, "src", "util", "fmt.ts"), "x");
    writeFileSync(join(dir, "src", "util", "fx.ts"), "x");
    writeFileSync(join(dir, "README.md"), "x");
    writeFileSync(join(dir, ".env.example"), "x");
    writeFileSync(join(dir, "node_modules", "dep", "index.ts"), "x");
  });

  it("matches files by path with **", async () => {
    const r = await globTool.execute({ pattern: "src/**/*.ts" }, ctx());
    expect(r.isError).toBe(false);
    expect(r.content).toContain("src/app.ts");
    expect(r.content).toContain("src/util/fmt.ts");
  });

  it("supports * and ? wildcards", async () => {
    const r = await globTool.execute({ pattern: "src/util/f?.ts" }, ctx());
    expect(r.content).toContain("src/util/fx.ts");
    expect(r.content).not.toContain("src/util/fmt.ts");
  });

  it("can limit the search subtree with path", async () => {
    const r = await globTool.execute(
      { pattern: "src/util/*.ts", path: "src" },
      ctx(),
    );
    expect(r.content).toContain("src/util/fmt.ts");
    expect(r.content).not.toContain("README.md");
  });

  it("hides hidden files unless include_hidden is set", async () => {
    const hidden = await globTool.execute({ pattern: ".env*" }, ctx());
    expect(hidden.content).toMatch(/No paths match/);
    const shown = await globTool.execute(
      { pattern: ".env*", include_hidden: true },
      ctx(),
    );
    expect(shown.content).toContain(".env.example");
  });

  it("skips noise directories", async () => {
    const r = await globTool.execute({ pattern: "**/*.ts" }, ctx());
    expect(r.content).not.toContain("node_modules/dep/index.ts");
  });

  it("caps very broad results", async () => {
    mkdirSync(join(dir, "many"), { recursive: true });
    for (let i = 0; i < 205; i++) {
      writeFileSync(join(dir, "many", `f-${i}.ts`), "x");
    }
    const r = await globTool.execute({ pattern: "many/*.ts" }, ctx());
    expect(r.content).toContain("showing first 200 matches");
  });
});

describe("todo tools", () => {
  it("writes and reads the full session todo list", async () => {
    let todos: TodoItem[] = [];
    const todoCtx = {
      workdir: dir,
      getTodos: () => todos.map((item) => ({ ...item })),
      setTodos: (items: TodoItem[]) => {
        todos = items.map((item) => ({ ...item }));
      },
    };
    const next = [
      { text: "Inspect files", status: "done" as const },
      { text: "Add tests", status: "in_progress" as const },
    ];
    const write = await todoWriteTool.execute({ items: next }, todoCtx);
    expect(write.isError).toBe(false);
    expect(write.content).toContain("Todo updated: 2 items");
    expect(todos).toEqual(next);

    const read = await todoReadTool.execute({}, todoCtx);
    expect(read.isError).toBe(false);
    expect(read.content).toContain("[x] Inspect files");
    expect(read.content).toContain("[~] Add tests");
  });

  it("validates todo item status", async () => {
    const r = await todoWriteTool.execute(
      { items: [{ text: "Nope", status: "later" }] },
      { workdir: dir, setTodos: () => {} },
    );
    expect(r.isError).toBe(true);
    expect(r.content).toMatch(/Invalid arguments for todo_write/);
  });
});

describe("tool registry and prompt", () => {
  it("registers glob and todo tools by default", () => {
    const names = defaultRegistry({ bashTimeoutMs: 1000 }).list().map((t) => t.name);
    expect(names).toContain("glob");
    expect(names).toContain("todo_read");
    expect(names).toContain("todo_write");
    expect(names).toContain("shell");
    expect(names).toContain("subagent");
    expect(names).toContain("mcp_search");
  });

  it("documents glob and todo guidance in the system prompt", () => {
    const prompt = systemPrompt("/work");
    expect(prompt).toContain("- glob:");
    expect(prompt).toContain("- todo_read:");
    expect(prompt).toContain("- shell:");
    expect(prompt).toContain("- subagent:");
    expect(prompt).toContain("- mcp_search:");
    expect(prompt).toContain("Prefer glob for finding files");
    expect(prompt).toContain("create a todo list early");
  });
});
