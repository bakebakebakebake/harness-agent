import { describe, it, expect } from "vitest";
import { createSubagentTool } from "../src/tools/subagent.js";

describe("subagent tool", () => {
  it("delegates to the nested runner and returns its summary", async () => {
    const calls: unknown[] = [];
    const tool = createSubagentTool();
    const r = await tool.execute(
      {
        task: "Investigate the failing test",
        instructions: "Focus on the shell tool.",
        tool_whitelist: ["read", "grep"],
        max_turns: 3,
      },
      {
        workdir: "/work",
        runSubagent: async (req) => {
          calls.push(req);
          return { summary: "Found the bug.", turns: 2, history: [] };
        },
      },
    );
    expect(r.isError).toBe(false);
    expect(r.content).toBe("Found the bug.");
    expect(r.details).toContain("Subagent turns: 2");
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      task: "Investigate the failing test",
      instructions: "Focus on the shell tool.",
      toolWhitelist: ["read", "grep"],
      maxTurns: 3,
    });
  });

  it("rejects missing runners cleanly", async () => {
    const tool = createSubagentTool();
    const r = await tool.execute({ task: "noop" }, { workdir: "/work" });
    expect(r.isError).toBe(true);
    expect(r.content).toContain("unavailable");
  });
});
