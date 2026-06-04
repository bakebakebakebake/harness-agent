import { describe, expect, it } from "vitest";
import type { Message } from "../src/model/types.js";
import { transcriptLines } from "../src/ui/transcript.js";

describe("transcript replay", () => {
  it("replays nearby tool results with the originating tool call", () => {
    const history: Message[] = [
      {
        role: "assistant",
        content: [
          { type: "tool_use", id: "t1", name: "read", input: { path: "README.md" } },
        ],
      },
      {
        role: "user",
        content: [
          { type: "tool_result", toolUseId: "t1", content: "Read 42 lines.", isError: false },
        ],
      },
    ];

    const lines = transcriptLines(history).join("\n");
    expect(lines).toContain("read");
    expect(lines).toContain("Read 42 lines.");
  });
});
