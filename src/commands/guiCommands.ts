import type { SlashCommand } from "./registry.js";
import { bold, cyan, dim } from "../ui/theme.js";
import { doctorMacosGui, supportedMacosGuiActions } from "../gui/macos.js";

export const guiCommand: SlashCommand = {
  name: "gui",
  description: "Inspect supported macOS GUI automation actions",
  keywords: ["macos", "applescript", "jxa", "automation", "finder", "safari", "notes"],
  priority: 55,
  subcommands: ["list", "doctor", "apps"],
  async run(ctx, args) {
    const sub = (args[0] ?? "").trim().toLowerCase();
    if (!sub && ctx.pick) {
      const picked = await ctx.pick("  GUI", [
        { label: "List actions", value: "list", hint: "Show every supported app.action pair" },
        { label: "List apps", value: "apps", hint: "Show the supported macOS app groups" },
        { label: "Run doctor", value: "doctor", hint: "Check osascript and System Events access" },
      ]);
      if (!picked) return {};
      return guiCommand.run(ctx, [picked]);
    }
    if (!sub || sub === "list") {
      ctx.out(bold("  macOS GUI actions"));
      for (const row of supportedMacosGuiActions()) {
        ctx.out(`  ${cyan(`${row.app}.${row.action}`.padEnd(24))} ${dim(row.hint)}`);
      }
      return {};
    }
    if (sub === "apps") {
      ctx.out(bold("  Supported apps"));
      for (const app of [...new Set(supportedMacosGuiActions().map((row) => row.app))]) {
        ctx.out(`  ${cyan(app)}`);
      }
      return {};
    }
    if (sub === "doctor") {
      ctx.out(bold("  GUI doctor"));
      for (const line of doctorMacosGui()) ctx.out(`  ${line}`);
      return {};
    }
    ctx.out(dim("  Usage: /gui [list|apps|doctor]"));
    return {};
  },
};
