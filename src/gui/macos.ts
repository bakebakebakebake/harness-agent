import { spawnSync } from "node:child_process";

export interface GuiActionInput {
  app: string;
  action: string;
  args?: Record<string, unknown>;
}

function appleQuote(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function stringArg(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`"${key}" must be a non-empty string.`);
  }
  return value.trim();
}

function optionalStringArg(args: Record<string, unknown>, key: string): string | undefined {
  const value = args[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function supportedMacosGuiActions(): Array<{ app: string; action: string; hint: string }> {
  return [
    { app: "finder", action: "activate", hint: "Bring Finder to the front" },
    { app: "finder", action: "open_path", hint: "Open a file or folder in Finder" },
    { app: "finder", action: "reveal_path", hint: "Reveal a file or folder in Finder" },
    { app: "finder", action: "new_folder", hint: "Create a new folder" },
    { app: "notes", action: "activate", hint: "Bring Notes to the front" },
    { app: "notes", action: "create_note", hint: "Create a note in Apple Notes" },
    { app: "notes", action: "append_to_note", hint: "Append text to a note by title" },
    { app: "notes", action: "list_folders", hint: "List Apple Notes folders" },
    { app: "safari", action: "activate", hint: "Bring Safari to the front" },
    { app: "safari", action: "open_url", hint: "Open a URL in Safari" },
    { app: "safari", action: "list_tabs", hint: "List Safari tab titles and URLs" },
    { app: "safari", action: "focus_tab", hint: "Focus the first tab matching a title or URL fragment" },
    { app: "system", action: "activate_app", hint: "Activate any macOS app by name" },
    { app: "system", action: "keystroke", hint: "Send a keystroke via System Events" },
    { app: "system", action: "menu_click", hint: "Click a menu item via System Events" },
  ];
}

export function buildMacosGuiScript(input: GuiActionInput): {
  language: "AppleScript";
  script: string;
  summary: string;
} {
  const app = input.app.trim().toLowerCase();
  const action = input.action.trim().toLowerCase();
  const args = input.args ?? {};
  if (app === "finder") {
    if (action === "activate") {
      return {
        language: "AppleScript",
        summary: "Activate Finder",
        script: `tell application "Finder" to activate`,
      };
    }
    if (action === "open_path") {
      const path = stringArg(args, "path");
      return {
        language: "AppleScript",
        summary: `Open ${path} in Finder`,
        script: `tell application "Finder" to open POSIX file ${appleQuote(path)}`,
      };
    }
    if (action === "reveal_path") {
      const path = stringArg(args, "path");
      return {
        language: "AppleScript",
        summary: `Reveal ${path} in Finder`,
        script: `tell application "Finder"\nactivate\nreveal POSIX file ${appleQuote(path)}\nend tell`,
      };
    }
    if (action === "new_folder") {
      const name = stringArg(args, "name");
      const parent = optionalStringArg(args, "parentPath") ?? ".";
      return {
        language: "AppleScript",
        summary: `Create Finder folder ${name}`,
        script:
          `tell application "Finder"\n` +
          `set targetFolder to POSIX file ${appleQuote(parent)} as alias\n` +
          `make new folder at targetFolder with properties {name:${appleQuote(name)}}\n` +
          `activate\nend tell`,
      };
    }
  }
  if (app === "notes") {
    if (action === "activate") {
      return {
        language: "AppleScript",
        summary: "Activate Notes",
        script: `tell application "Notes" to activate`,
      };
    }
    if (action === "create_note") {
      const body = stringArg(args, "body");
      const title = optionalStringArg(args, "title");
      const folder = optionalStringArg(args, "folder") ?? "Notes";
      const noteBody = title ? `${title}\n\n${body}` : body;
      return {
        language: "AppleScript",
        summary: `Create note in ${folder}`,
        script:
          `tell application "Notes"\n` +
          `activate\n` +
          `tell folder ${appleQuote(folder)}\n` +
          `make new note with properties {body:${appleQuote(noteBody)}}\n` +
          `end tell\nend tell`,
      };
    }
    if (action === "append_to_note") {
      const title = stringArg(args, "title");
      const body = stringArg(args, "body");
      return {
        language: "AppleScript",
        summary: `Append to note ${title}`,
        script:
          `tell application "Notes"\n` +
          `set targetNote to first note whose name is ${appleQuote(title)}\n` +
          `set body of targetNote to (body of targetNote) & return & ${appleQuote(body)}\n` +
          `activate\nend tell`,
      };
    }
    if (action === "list_folders") {
      return {
        language: "AppleScript",
        summary: "List Notes folders",
        script: `tell application "Notes" to get name of every folder`,
      };
    }
  }
  if (app === "safari") {
    if (action === "activate") {
      return {
        language: "AppleScript",
        summary: "Activate Safari",
        script: `tell application "Safari" to activate`,
      };
    }
    if (action === "open_url") {
      const url = stringArg(args, "url");
      return {
        language: "AppleScript",
        summary: `Open ${url} in Safari`,
        script:
          `tell application "Safari"\n` +
          `activate\n` +
          `open location ${appleQuote(url)}\n` +
          `end tell`,
      };
    }
    if (action === "list_tabs") {
      return {
        language: "AppleScript",
        summary: "List Safari tabs",
        script:
          `tell application "Safari"\n` +
          `set output to {}\n` +
          `repeat with w in windows\n` +
          `repeat with t in tabs of w\n` +
          `set end of output to ((name of t) & " | " & (URL of t))\n` +
          `end repeat\nend repeat\n` +
          `return output\nend tell`,
      };
    }
    if (action === "focus_tab") {
      const titleContains = optionalStringArg(args, "titleContains") ?? "";
      const urlContains = optionalStringArg(args, "urlContains") ?? "";
      if (!titleContains && !urlContains) {
        throw new Error("focus_tab requires titleContains or urlContains.");
      }
      return {
        language: "AppleScript",
        summary: "Focus a Safari tab",
        script:
          `tell application "Safari"\n` +
          `activate\n` +
          `repeat with w in windows\n` +
          `repeat with i from 1 to (count of tabs of w)\n` +
          `set t to tab i of w\n` +
          `set tabName to name of t\n` +
          `set tabUrl to URL of t\n` +
          `if (${titleContains ? `(tabName contains ${appleQuote(titleContains)})` : "false"} or ${urlContains ? `(tabUrl contains ${appleQuote(urlContains)})` : "false"}) then\n` +
          `set current tab of w to t\nset index of w to 1\nreturn "focused"\nend if\n` +
          `end repeat\nend repeat\n` +
          `error "No matching Safari tab found."\nend tell`,
      };
    }
  }
  if (app === "system") {
    if (action === "activate_app") {
      const name = stringArg(args, "name");
      return {
        language: "AppleScript",
        summary: `Activate app ${name}`,
        script: `tell application ${appleQuote(name)} to activate`,
      };
    }
    if (action === "keystroke") {
      const text = stringArg(args, "text");
      return {
        language: "AppleScript",
        summary: "Send keystroke via System Events",
        script:
          `tell application "System Events"\n` +
          `keystroke ${appleQuote(text)}\n` +
          `end tell`,
      };
    }
    if (action === "menu_click") {
      const appName = stringArg(args, "appName");
      const menu = stringArg(args, "menu");
      const item = stringArg(args, "item");
      return {
        language: "AppleScript",
        summary: `Click ${menu} > ${item} in ${appName}`,
        script:
          `tell application ${appleQuote(appName)} to activate\n` +
          `tell application "System Events"\n` +
          `tell process ${appleQuote(appName)}\n` +
          `click menu item ${appleQuote(item)} of menu ${appleQuote(menu)} of menu bar 1\n` +
          `end tell\nend tell`,
      };
    }
  }
  throw new Error(`Unsupported macOS GUI action: ${app}.${action}`);
}

export function runMacosGuiAction(input: GuiActionInput): {
  summary: string;
  content: string;
} {
  const built = buildMacosGuiScript(input);
  const result = spawnSync("osascript", ["-l", built.language], {
    input: built.script,
    encoding: "utf8",
  });
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || "").trim();
    throw new Error(detail || `macOS GUI action failed: ${built.summary}`);
  }
  return {
    summary: built.summary,
    content: (result.stdout || "").trim() || "ok",
  };
}

export function doctorMacosGui(): string[] {
  const rows = [`osascript: ${process.platform === "darwin" ? "available" : "unsupported platform"}`];
  if (process.platform !== "darwin") return rows;
  const result = spawnSync("osascript", ["-e", 'tell application "System Events" to count processes'], {
    encoding: "utf8",
  });
  if (result.status === 0) {
    rows.push("System Events automation: ok");
  } else {
    rows.push("System Events automation: check Accessibility / Automation permissions");
    const detail = (result.stderr || result.stdout || "").trim();
    if (detail) rows.push(detail);
  }
  return rows;
}
