import { describe, expect, it } from "vitest";
import { classifyRuntimeError } from "../src/util/errors.js";

describe("classifyRuntimeError", () => {
  it("classifies configuration problems", () => {
    expect(classifyRuntimeError(new Error("401 invalid api key"))).toContain(
      "configuration problem",
    );
  });

  it("classifies temporary provider problems", () => {
    expect(classifyRuntimeError(new Error("fetch failed: 429 rate limit"))).toContain(
      "temporary network/provider problem",
    );
  });

  it("classifies external tool problems", () => {
    expect(classifyRuntimeError(new Error("spawn git ENOENT"))).toContain(
      "external tool problem",
    );
  });

  it("falls back to unexpected internal error", () => {
    expect(classifyRuntimeError(new Error("something odd happened"))).toContain(
      "unexpected internal error",
    );
  });
});
