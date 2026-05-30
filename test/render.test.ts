import { afterEach, describe, expect, it, vi } from "vitest";
import { Renderer } from "../src/ui/render.js";

const writeSpy = vi.spyOn(process.stdout, "write");

afterEach(() => {
  writeSpy.mockReset();
  writeSpy.mockImplementation(() => true);
});

describe("Renderer", () => {
  it("shows a concise notification for todo_write results", () => {
    const out: string[] = [];
    writeSpy.mockImplementation(((chunk: string | Uint8Array) => {
      out.push(String(chunk));
      return true;
    }) as typeof process.stdout.write);

    const renderer = new Renderer();
    renderer.on({
      type: "tool_result",
      id: "t1",
      name: "todo_write",
      content: "Todo updated: 2 items (1 in progress, 1 done).",
      isError: false,
      details: "[~] Add tests\n[x] Ship glob",
    });

    const joined = out.join("");
    expect(joined).toContain("Todo updated: 2 items");
    expect(joined).toContain("[~] Add tests");
    expect(joined).not.toContain("✓");
  });
});
