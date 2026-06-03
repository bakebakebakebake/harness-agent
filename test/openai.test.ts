import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fetchModels } from "../src/model/models.js";
import {
  StreamState,
  toOpenAIMessages,
  toOpenAITools,
  mapFinishReason,
  sseLines,
} from "../src/model/openai.js";
import type { Message, ModelEvent, ToolSpec } from "../src/model/types.js";
import { OpenAIProvider } from "../src/model/openai.js";

describe("toOpenAIMessages", () => {
  it("prepends system and passes through plain user text", () => {
    const msgs: Message[] = [
      { role: "user", content: [{ type: "text", text: "hi" }] },
    ];
    const out = toOpenAIMessages("be helpful", msgs);
    expect(out[0]).toEqual({ role: "system", content: "be helpful" });
    expect(out[1]).toEqual({ role: "user", content: "hi" });
  });

  it("maps assistant tool_use blocks to tool_calls with stringified args", () => {
    const msgs: Message[] = [
      {
        role: "assistant",
        content: [
          { type: "text", text: "let me read" },
          { type: "tool_use", id: "c1", name: "read", input: { path: "a.txt" } },
        ],
      },
    ];
    const out = toOpenAIMessages("", msgs);
    const asst = out[0] as Extract<
      ReturnType<typeof toOpenAIMessages>[number],
      { role: "assistant" }
    >;
    expect(asst.role).toBe("assistant");
    expect(asst.content).toBe("let me read");
    expect(asst.tool_calls?.[0]).toEqual({
      id: "c1",
      type: "function",
      function: { name: "read", arguments: '{"path":"a.txt"}' },
    });
  });

  it("maps tool_result blocks to standalone role:tool messages", () => {
    const msgs: Message[] = [
      {
        role: "user",
        content: [
          { type: "tool_result", toolUseId: "c1", content: "file body", isError: false },
        ],
      },
    ];
    const out = toOpenAIMessages("", msgs);
    expect(out[0]).toEqual({
      role: "tool",
      tool_call_id: "c1",
      content: "file body",
    });
  });

  it("encodes user image blocks as image_url content parts", () => {
    const dir = mkdtempSync(join(tmpdir(), "light-agent-openai-"));
    const path = join(dir, "sample.png");
    writeFileSync(path, Buffer.from("png"));
    const msgs: Message[] = [
      {
        role: "user",
        content: [
          { type: "text", text: "look at this" },
          { type: "image", path, mimeType: "image/png", source: "file" },
        ],
      },
    ];
    const out = toOpenAIMessages("", msgs);
    const user = out[0] as Extract<ReturnType<typeof toOpenAIMessages>[number], { role: "user" }>;
    expect(Array.isArray(user.content)).toBe(true);
    expect(user.content).toMatchObject([
      { type: "text", text: "look at this" },
      { type: "image_url", image_url: { url: expect.stringContaining("data:image/png;base64,") } },
    ]);
  });

  it("uses a single space for an assistant turn that is only tool calls", () => {
    const msgs: Message[] = [
      {
        role: "assistant",
        content: [{ type: "tool_use", id: "c2", name: "bash", input: {} }],
      },
    ];
    const out = toOpenAIMessages("", msgs);
    const asst = out[0] as { content: string | null };
    expect(asst.content).toBe(" ");
  });

  it("drops truly empty assistant and user messages", () => {
    const msgs: Message[] = [
      { role: "assistant", content: [] },
      { role: "user", content: [] },
      { role: "user", content: [{ type: "text", text: "hi" }] },
    ];
    expect(toOpenAIMessages("", msgs)).toEqual([{ role: "user", content: "hi" }]);
  });

  it("replays assistant reasoning_content when present", () => {
    const msgs: Message[] = [
      {
        role: "assistant",
        reasoningContent: "step by step",
        content: [{ type: "tool_use", id: "c2", name: "bash", input: {} }],
      },
    ];
    const out = toOpenAIMessages("", msgs);
    const asst = out[0] as Extract<
      ReturnType<typeof toOpenAIMessages>[number],
      { role: "assistant" }
    >;
    expect(asst.reasoning_content).toBe("step by step");
  });
});

describe("toOpenAITools", () => {
  it("wraps each spec in the function-tool shape", () => {
    const specs: ToolSpec[] = [
      { name: "read", description: "read a file", inputSchema: { type: "object" } },
    ];
    const out = toOpenAITools(specs);
    expect(out[0]).toEqual({
      type: "function",
      function: {
        name: "read",
        description: "read a file",
        parameters: { type: "object" },
      },
    });
  });
});

describe("mapFinishReason", () => {
  it("maps known reasons", () => {
    expect(mapFinishReason("tool_calls")).toBe("tool_use");
    expect(mapFinishReason("stop")).toBe("end_turn");
    expect(mapFinishReason("length")).toBe("max_tokens");
    expect(mapFinishReason(null)).toBe("unknown");
    expect(mapFinishReason("weird")).toBe("unknown");
  });
});

function drain(state: StreamState, chunks: unknown[]): ModelEvent[] {
  const out: ModelEvent[] = [];
  for (const c of chunks) for (const ev of state.consume(c as never)) out.push(ev);
  for (const ev of state.finish()) out.push(ev);
  return out;
}

describe("StreamState — chunk → event accumulation", () => {
  it("streams plain text then emits message_stop with usage", () => {
    const events = drain(new StreamState(), [
      { choices: [{ delta: { content: "Hel" } }] },
      { choices: [{ delta: { content: "lo" } }] },
      { choices: [{ delta: {}, finish_reason: "stop" }] },
      { choices: [], usage: { prompt_tokens: 10, completion_tokens: 2 } },
    ]);
    const text = events
      .filter((e): e is Extract<ModelEvent, { type: "text_delta" }> => e.type === "text_delta")
      .map((e) => e.text)
      .join("");
    expect(text).toBe("Hello");
    const stop = events.find((e) => e.type === "message_stop");
    expect(stop).toMatchObject({
      stopReason: "end_turn",
      usage: { inputTokens: 10, outputTokens: 2 },
    });
  });

  it("reassembles a streamed tool call keyed by index", () => {
    const events = drain(new StreamState(), [
      {
        choices: [
          {
            delta: {
              tool_calls: [
                { index: 0, id: "call_1", function: { name: "read", arguments: "" } },
              ],
            },
          },
        ],
      },
      {
        choices: [
          { delta: { tool_calls: [{ index: 0, function: { arguments: '{"path":' } }] } },
        ],
      },
      {
        choices: [
          { delta: { tool_calls: [{ index: 0, function: { arguments: '"x.txt"}' } }] } },
        ],
      },
      { choices: [{ delta: {}, finish_reason: "tool_calls" }] },
    ]);

    const start = events.find((e) => e.type === "tool_use_start");
    expect(start).toEqual({ type: "tool_use_start", id: "call_1", name: "read" });

    const args = events
      .filter((e): e is Extract<ModelEvent, { type: "tool_input_delta" }> => e.type === "tool_input_delta")
      .map((e) => e.partialJson)
      .join("");
    expect(args).toBe('{"path":"x.txt"}');

    expect(events.some((e) => e.type === "tool_use_stop")).toBe(true);
    const stop = events.find((e) => e.type === "message_stop");
    expect(stop).toMatchObject({ stopReason: "tool_use" });
  });

  it("handles two parallel tool calls on different indices", () => {
    const events = drain(new StreamState(), [
      {
        choices: [
          {
            delta: {
              tool_calls: [
                { index: 0, id: "a", function: { name: "read", arguments: "{}" } },
                { index: 1, id: "b", function: { name: "bash", arguments: "{}" } },
              ],
            },
          },
        ],
      },
      { choices: [{ delta: {}, finish_reason: "tool_calls" }] },
    ]);
    const starts = events.filter((e) => e.type === "tool_use_start");
    expect(starts).toHaveLength(2);
    const stops = events.filter((e) => e.type === "tool_use_stop");
    expect(stops).toHaveLength(2);
  });
});

describe("sseLines", () => {
  it("parses data lines and tolerates split chunks", async () => {
    const parts = ['data: {"a":1}\n', "data: ", '{"b":2}\n', "data: [DONE]\n"];
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const enc = new TextEncoder();
        for (const p of parts) controller.enqueue(enc.encode(p));
        controller.close();
      },
    });
    const out: string[] = [];
    for await (const line of sseLines(stream)) out.push(line);
    expect(out).toEqual(['{"a":1}', '{"b":2}', "[DONE]"]);
  });
});

describe("OpenAIProvider streaming validation", () => {
  it("fails clearly when an endpoint returns HTML instead of SSE", async () => {
    const realFetch = global.fetch;
    global.fetch = (async () =>
      new Response("<!doctype html><html><body>no api</body></html>", {
        status: 200,
        headers: { "content-type": "text/html" },
      })) as typeof fetch;
    try {
      const provider = new OpenAIProvider({
        apiKey: "test",
        model: "gpt-5-mini",
        baseURL: "https://example.com/v1",
      });
      const events: ModelEvent[] = [];
      for await (const ev of provider.stream({
        system: "",
        messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
        tools: [],
      })) {
        events.push(ev);
      }
      const err = events.find((ev) => ev.type === "error");
      expect(err && err.type === "error" ? err.error.message : "").toContain("returned HTML");
    } finally {
      global.fetch = realFetch;
    }
  });

  it("retries with /v1 when the base URL points at a website root", async () => {
    const realFetch = global.fetch;
    const calls: string[] = [];
    global.fetch = (async (input) => {
      const url = String(input);
      calls.push(url);
      if (calls.length === 1) {
        return new Response("<!doctype html><html><body>home</body></html>", {
          status: 200,
          headers: { "content-type": "text/html" },
        });
      }
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          const enc = new TextEncoder();
          controller.enqueue(
            enc.encode('data: {"choices":[{"delta":{"content":"OK"}}]}\n'),
          );
          controller.enqueue(
            enc.encode('data: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":1,"completion_tokens":1}}\n'),
          );
          controller.enqueue(enc.encode("data: [DONE]\n"));
          controller.close();
        },
      });
      return new Response(stream, {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      });
    }) as typeof fetch;
    try {
      const provider = new OpenAIProvider({
        apiKey: "test",
        model: "gpt-5-mini",
        baseURL: "https://example.com",
      });
      const events: ModelEvent[] = [];
      for await (const ev of provider.stream({
        system: "",
        messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
        tools: [],
      })) {
        events.push(ev);
      }
      const text = events
        .filter((ev): ev is Extract<ModelEvent, { type: "text_delta" }> => ev.type === "text_delta")
        .map((ev) => ev.text)
        .join("");
      expect(text).toBe("OK");
      expect(calls).toEqual([
        "https://example.com/chat/completions",
        "https://example.com/v1/chat/completions",
      ]);
    } finally {
      global.fetch = realFetch;
    }
  });
});

describe("fetchModels", () => {
  it("retries model discovery with /v1 when an OpenAI base URL returns website HTML", async () => {
    const realFetch = global.fetch;
    const calls: string[] = [];
    global.fetch = (async (input) => {
      const url = String(input);
      calls.push(url);
      if (calls.length === 1) {
        return new Response("<!doctype html><html><body>home</body></html>", {
          status: 200,
          headers: { "content-type": "text/html" },
        });
      }
      return new Response(JSON.stringify({ data: [{ id: "gpt-5.4-mini" }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;
    try {
      const result = await fetchModels({
        provider: "openai",
        apiKey: "test",
        baseURL: "https://example.com",
      });
      expect(result.models).toEqual(["gpt-5.4-mini"]);
      expect(result.error).toBeUndefined();
      expect(result.resolvedURL).toBe("https://example.com/v1/models");
      expect(calls).toEqual([
        "https://example.com/models",
        "https://example.com/v1/models",
      ]);
    } finally {
      global.fetch = realFetch;
    }
  });
});
