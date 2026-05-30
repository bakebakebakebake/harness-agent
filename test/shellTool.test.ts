import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createShellTool } from "../src/tools/shell.js";

let dir: string;
const shell = createShellTool({ defaultTimeoutMs: 5000 });

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "shell-tool-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("shell tool", () => {
  it("runs a raw shell line with pipes and variable expansion", async () => {
    const r = await shell.execute(
      { command_line: 'FOO=bar; printf "%s" "$FOO" | tr a-z A-Z' },
      { workdir: dir },
    );
    expect(r.isError).toBe(false);
    expect(r.content).toContain("BAR");
  });

  it("handles redirects in the command line", async () => {
    const r = await shell.execute(
      { command_line: 'printf "hello" > out.txt; cat out.txt' },
      { workdir: dir },
    );
    expect(r.isError).toBe(false);
    expect(r.content).toContain("hello");
    expect(readFileSync(join(dir, "out.txt"), "utf8")).toBe("hello");
  });

  it("previews the raw shell line", () => {
    const preview = shell.describeAction?.(
      { command_line: "git log --oneline | head -5" },
      { workdir: dir },
    );
    expect(preview?.summary).toBe("Run: git log --oneline | head -5");
  });
});
