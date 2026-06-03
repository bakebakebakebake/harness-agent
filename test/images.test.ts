import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdtempSync } from "node:fs";

const spawnSyncMock = vi.fn();

vi.mock("node:child_process", () => ({
  spawnSync: spawnSyncMock,
}));

const SAVED_ENV = { ...process.env };

afterEach(() => {
  for (const key of Object.keys(process.env)) {
    if (!(key in SAVED_ENV)) delete process.env[key];
  }
  Object.assign(process.env, SAVED_ENV);
  spawnSyncMock.mockReset();
  vi.resetModules();
});

describe("importClipboardImage", () => {
  it("builds a safe JXA script and imports the saved image", async () => {
    const home = mkdtempSync(join(tmpdir(), "light-agent-images-"));
    process.env.HARNESS_HOME = home;

    spawnSyncMock.mockImplementation((cmd: string, _args: string[], opts?: { input?: string }) => {
      if (cmd === "osascript") {
        const script = opts?.input ?? "";
        expect(script).toContain("function isNil(value)");
        expect(script).toContain("ObjC.unwrap(value) === undefined");
        expect(script).toContain("saveFirst([\"public.png\"], pngTarget)");
        expect(script).toContain("saveFirst([\"public.tiff\"], tiffTarget)");
        const match = /const pngTarget = "([^"]+)";/.exec(script);
        const outputPath = match?.[1];
        expect(outputPath).toBeTruthy();
        mkdirSync(join(home, "tmp", "images"), { recursive: true });
        writeFileSync(outputPath!, Buffer.from("png"));
        return { status: 0, stdout: "png\n", stderr: "" };
      }
      throw new Error(`unexpected command: ${cmd}`);
    });

    const { importClipboardImage } = await import("../src/util/images.js");
    const image = importClipboardImage();

    expect(image.source).toBe("clipboard");
    expect(image.mimeType).toBe("image/png");
    expect(readFileSync(image.path).toString()).toBe("png");

    rmSync(home, { recursive: true, force: true });
  });

  it("surfaces osascript failures cleanly", async () => {
    const home = mkdtempSync(join(tmpdir(), "light-agent-images-"));
    process.env.HARNESS_HOME = home;

    spawnSyncMock.mockReturnValue({
      status: 1,
      stdout: "",
      stderr: "Clipboard does not contain a readable image.",
    });

    const { importClipboardImage } = await import("../src/util/images.js");
    expect(() => importClipboardImage()).toThrow("Clipboard does not contain a readable image.");

    rmSync(home, { recursive: true, force: true });
  });

  it("converts TIFF clipboard data through sips", async () => {
    const home = mkdtempSync(join(tmpdir(), "light-agent-images-"));
    process.env.HARNESS_HOME = home;
    let pngPath = "";
    let tiffPath = "";

    spawnSyncMock.mockImplementation((cmd: string, args: string[], opts?: { input?: string }) => {
      if (cmd === "osascript") {
        const script = opts?.input ?? "";
        pngPath = /const pngTarget = "([^"]+)";/.exec(script)?.[1] ?? "";
        tiffPath = /const tiffTarget = "([^"]+)";/.exec(script)?.[1] ?? "";
        expect(pngPath).toBeTruthy();
        expect(tiffPath).toBeTruthy();
        mkdirSync(join(home, "tmp", "images"), { recursive: true });
        writeFileSync(tiffPath, Buffer.from("tiff"));
        return { status: 0, stdout: "tiff\n", stderr: "" };
      }
      if (cmd === "sips") {
        expect(args).toEqual(["-s", "format", "png", tiffPath, "--out", pngPath]);
        writeFileSync(pngPath, Buffer.from("png"));
        return { status: 0, stdout: "", stderr: "" };
      }
      throw new Error(`unexpected command: ${cmd}`);
    });

    const { importClipboardImage } = await import("../src/util/images.js");
    const image = importClipboardImage();

    expect(image.path).toBe(pngPath);
    expect(image.mimeType).toBe("image/png");

    rmSync(home, { recursive: true, force: true });
  });
});

describe("consumeImagePathsFromText", () => {
  it("extracts an escaped absolute image path from a question", async () => {
    const workdir = mkdtempSync(join(tmpdir(), "light-agent-workdir-"));
    const nestedDir = join(workdir, "Mobile Documents", "下载");
    mkdirSync(nestedDir, { recursive: true });
    const imagePath = join(nestedDir, "云-天空-插图.png");
    writeFileSync(imagePath, Buffer.from("png"));

    const { consumeImagePathsFromText } = await import("../src/util/images.js");
    const result = consumeImagePathsFromText(
      `${imagePath.replace(/ /g, "\\ ")} 这个路径中的内容是什么?`,
      workdir,
    );

    expect(result.images).toHaveLength(1);
    expect(result.images[0]?.path).toBe(imagePath);
    expect(result.text).toBe("这个路径中的内容是什么?");

    rmSync(workdir, { recursive: true, force: true });
  });
});
