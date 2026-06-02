import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchWebPage, searchWeb } from "../src/util/web.js";

const realFetch = global.fetch;

afterEach(() => {
  global.fetch = realFetch;
  vi.restoreAllMocks();
});

describe("searchWeb", () => {
  it("merges and ranks bing rss results", async () => {
    global.fetch = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (!url.includes("bing.com/search?format=rss")) {
        throw new Error(`unexpected url ${url}`);
      }
      return new Response(
        [
          '<?xml version="1.0" encoding="utf-8" ?><rss><channel>',
          "<item>",
          "<title>Official API docs</title>",
          "<link>https://docs.example.com/api</link>",
          "<description>Read the official API reference.</description>",
          "<pubDate>Mon, 01 Jun 2026 05:39:00 GMT</pubDate>",
          "</item>",
          "<item>",
          "<title>Community blog</title>",
          "<link>https://blog.example.com/post</link>",
          "<description>A secondary explanation.</description>",
          "</item>",
          "</channel></rss>",
        ].join(""),
        {
          status: 200,
          headers: { "content-type": "text/xml; charset=utf-8" },
        },
      );
    }) as typeof fetch;

    const results = await searchWeb("api reference", { bias: "technical", limit: 2 });
    expect(results).toHaveLength(2);
    expect(results[0]?.url).toBe("https://docs.example.com/api");
    expect(results[0]?.source).toBe("docs.example.com");
  });

  it("prefers Tavily when configured and falls back cleanly", async () => {
    process.env.TAVILY_API_KEY = "test-key";
    global.fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url === "https://api.tavily.com/search") {
        expect(init?.method).toBe("POST");
        return new Response(
          JSON.stringify({
            results: [
              {
                title: "Official React docs",
                url: "https://react.dev/reference/react",
                content: "React reference docs.",
                published_date: "2026-06-01T00:00:00.000Z",
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      throw new Error(`unexpected url ${url}`);
    }) as typeof fetch;

    const results = await searchWeb("react reference", { bias: "technical", limit: 1 });
    expect(results[0]?.backend).toBe("tavily");
    expect(results[0]?.source).toBe("react.dev");
  });
});

describe("fetchWebPage", () => {
  it("strips html when fetching a page", async () => {
    global.fetch = vi.fn(async () =>
      new Response("<html><body><h1>Hello</h1><p>World</p></body></html>", {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" },
      })) as typeof fetch;

    const text = await fetchWebPage("https://example.com");
    expect(text).toContain("Hello");
    expect(text).toContain("World");
    expect(text).not.toContain("<h1>");
  });
});
