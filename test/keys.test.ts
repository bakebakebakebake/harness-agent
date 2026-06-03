import { afterEach, describe, expect, it, vi } from "vitest";

describe("KeySource bracketed paste", () => {
  afterEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it("emits a paste event when bracketed paste has no body", async () => {
    const listeners = new Map<string, Array<(chunk: Buffer) => void>>();
    const stdinMock = {
      isTTY: true,
      setRawMode: vi.fn(),
      resume: vi.fn(),
      pause: vi.fn(),
      on: vi.fn((event: string, handler: (chunk: Buffer) => void) => {
        listeners.set(event, [...(listeners.get(event) ?? []), handler]);
      }),
      off: vi.fn((event: string, handler: (chunk: Buffer) => void) => {
        listeners.set(event, (listeners.get(event) ?? []).filter((entry) => entry !== handler));
      }),
    };
    const stdoutMock = { write: vi.fn() };

    vi.doMock("node:process", () => ({
      stdin: stdinMock,
      stdout: stdoutMock,
    }));

    const { KeySource } = await import("../src/ui/keys.js");
    const source = new KeySource();
    const seen: Array<{ str: string | undefined; name?: string }> = [];
    source.onKey((str, key) => {
      seen.push({ str, name: key.name });
    });
    source.start();

    const handler = listeners.get("data")?.[0];
    expect(handler).toBeTruthy();
    handler!(Buffer.from("\x1b[200~\x1b[201~", "utf8"));

    expect(seen).toEqual([{ str: undefined, name: "paste" }]);
    source.stop();
  });
});
