import { describe, expect, it } from "vitest";
import { buildMacosGuiScript, supportedMacosGuiActions } from "../src/gui/macos.js";

describe("macos GUI action catalog", () => {
  it("lists supported actions", () => {
    expect(supportedMacosGuiActions().some((row) => row.app === "finder" && row.action === "reveal_path")).toBe(true);
    expect(supportedMacosGuiActions().some((row) => row.app === "safari" && row.action === "list_tabs")).toBe(true);
  });

  it("builds a Finder reveal script", () => {
    const script = buildMacosGuiScript({
      app: "finder",
      action: "reveal_path",
      args: { path: "/tmp/demo.txt" },
    });
    expect(script.summary).toContain("Reveal");
    expect(script.script).toContain('tell application "Finder"');
    expect(script.script).toContain("/tmp/demo.txt");
  });
});
