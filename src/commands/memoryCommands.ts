import { randomUUID } from "node:crypto";
import type { CommandContext, SlashCommand } from "./registry.js";
import { retrieveMemoryContext } from "../memory/retrieve.js";
import { readCoreDigest, writeCoreDigest } from "../memory/digest.js";
import {
  forgetMemoryCard,
  listMemoryCards,
  listMemoryStats,
  listSupersedingMemoryCards,
  readMemoryCardFromDb,
  rebuildMemoryIndex,
  searchMemoryCards,
  touchMemoryCard,
  upsertMemoryCard,
} from "../memory/store.js";
import { readTranscriptTurns } from "../memory/transcript.js";
import type { MemoryCard } from "../memory/types.js";
import { bold, cyan, dim, green, red, symbols } from "../ui/theme.js";

function memoryCardItems(cards: readonly MemoryCard[]): Array<{
  label: string;
  value: string;
  hint?: string;
}> {
  return cards.map((card) => ({
    label: card.title,
    value: card.id,
    hint: `${card.scope} ${symbols.dot} ${card.kind} ${symbols.dot} ${card.status}`,
  }));
}

async function pickMemoryCard(
  ctx: CommandContext,
  prompt: string,
  cards: readonly MemoryCard[],
): Promise<string | null> {
  if (cards.length === 0) {
    ctx.out(dim("  No memories yet."));
    return null;
  }
  if (!ctx.pick) return null;
  return ctx.pick(prompt, memoryCardItems(cards));
}

async function askMemoryQuery(ctx: CommandContext, prompt: string): Promise<string> {
  const query = (await ctx.ask(prompt)).trim();
  if (!query) {
    ctx.out(dim("  Cancelled."));
    return "";
  }
  return query;
}

function printMemoryOverview(ctx: CommandContext): void {
  const stats = listMemoryStats(ctx.state.config.workdir);
  const digest = readCoreDigest(ctx.state.config.workdir);
  ctx.out(bold("  Memory"));
  ctx.out(`  ${dim("total")}      ${stats.total}`);
  ctx.out(`  ${dim("active")}     ${stats.active}`);
  ctx.out(`  ${dim("superseded")} ${stats.superseded}`);
  ctx.out(`  ${dim("expired")}    ${stats.expired}`);
  ctx.out(`  ${dim("forgotten")}  ${stats.forgotten}`);
  ctx.out(`  ${dim("digest")}     ${Math.max(0, digest.length - 1)} line(s)`);
  ctx.out(
    dim(
      "  Use /memory list, /memory search <query>, /memory show <id>, /memory rebuild, /memory compact, /memory diagnose <query>.",
    ),
  );
}

export const memoryCommand: SlashCommand = {
  name: "memory",
  description: "Inspect and manage native memory cards",
  keywords: ["mem", "remember", "forget", "recall"],
  priority: 110,
  subcommands: ["list", "search", "show", "rebuild", "compact", "diagnose"],
  async run(ctx, args) {
    let sub = (args[0] ?? "").trim().toLowerCase();
    if (!sub) {
      if (ctx.pick) {
        const choice = await ctx.pick("  Memory action", [
          { label: "Overview", value: "overview", hint: "stats and digest summary" },
          { label: "List memories", value: "list", hint: "show current memory cards" },
          { label: "Show memory", value: "show", hint: "pick a memory card to inspect" },
          { label: "Search memories", value: "search", hint: "find by keyword" },
          { label: "Diagnose retrieval", value: "diagnose", hint: "explain why memories rank" },
          { label: "Refresh digest", value: "compact", hint: "rebuild the core digest" },
          { label: "Rebuild index", value: "rebuild", hint: "rebuild sqlite index from cards" },
        ]);
        if (choice === null) {
          ctx.out(dim("  Cancelled."));
          return {};
        }
        sub = choice;
      } else {
        printMemoryOverview(ctx);
        return {};
      }
    }

    if (sub === "overview") {
      printMemoryOverview(ctx);
      return {};
    }

    if (sub === "list") {
      const cards = listMemoryCards(ctx.state.config.workdir).slice(0, 20);
      if (cards.length === 0) {
        ctx.out(dim("  No memories yet."));
        return {};
      }
      ctx.out(bold("  Memory cards"));
      for (const card of cards) {
        ctx.out(
          `  ${cyan(card.id)} ${bold(card.title)} ${dim(`(${card.scope} · ${card.kind} · ${card.status})`)}`,
        );
        ctx.out(`    ${card.summary}`);
      }
      return {};
    }

    if (sub === "search") {
      let query = args.slice(1).join(" ").trim();
      if (!query && ctx.pick) {
        query = await askMemoryQuery(ctx, "  Search memories: ");
      }
      if (!query) {
        ctx.out(dim("  Usage: /memory search <query>"));
        return {};
      }
      const hits = searchMemoryCards(ctx.state.config.workdir, query, { limit: 8 });
      if (hits.length === 0) {
        ctx.out(dim("  No matching memories."));
        return {};
      }
      for (const hit of hits) touchMemoryCard(ctx.state.config.workdir, hit.card.id);
      writeCoreDigest(ctx.state.config.workdir);
      ctx.out(bold(`  Memory search: ${query}`));
      for (const hit of hits) {
        ctx.out(
          `  ${cyan(hit.card.id)} ${bold(hit.card.title)} ${dim(`(${hit.card.scope} · ${hit.card.kind})`)}`,
        );
        ctx.out(`    ${hit.card.summary}`);
      }
      return {};
    }

    if (sub === "show") {
      let id = (args[1] ?? "").trim();
      if (!id && ctx.pick) {
        id =
          (await pickMemoryCard(
            ctx,
            "  Show which memory?",
            listMemoryCards(ctx.state.config.workdir).slice(0, 50),
          )) ?? "";
      }
      if (!id) {
        ctx.out(dim("  Usage: /memory show <id>"));
        return {};
      }
      const card = readMemoryCardFromDb(ctx.state.config.workdir, id);
      if (!card) {
        ctx.out(red(`  No memory "${id}".`));
        return {};
      }
      touchMemoryCard(ctx.state.config.workdir, id);
      writeCoreDigest(ctx.state.config.workdir);
      ctx.out(bold(`  ${card.title}`));
      ctx.out(
        dim(
          `  ${card.id} ${symbols.dot} ${card.scope} ${symbols.dot} ${card.kind} ${symbols.dot} ${card.status}`,
        ),
      );
      ctx.out(`  ${card.summary}`);
      ctx.out(
        dim(
          `  accessed ${card.accessCount} time(s) · ` +
            `${card.sourceTurnRefs.length} evidence ref(s)` +
            (card.sourceSessionId ? ` · session ${card.sourceSessionId}` : ""),
        ),
      );
      if (card.supersedes.length > 0) {
        ctx.out(
          dim(
            `  supersedes ${card.supersedes
              .map((ref) => readMemoryCardFromDb(ctx.state.config.workdir, ref)?.title ?? ref)
              .join(", ")}`,
          ),
        );
      }
      const supersededBy = listSupersedingMemoryCards(ctx.state.config.workdir, card.id);
      if (supersededBy.length > 0) {
        ctx.out(
          dim(
            `  superseded by ${supersededBy
              .map((next) => `${next.title} (${next.id})`)
              .join(", ")}`,
          ),
        );
      }
      const evidence =
        card.sourceSessionId && card.sourceTurnRefs.length > 0
          ? readTranscriptTurns(card.sourceSessionId)
              .filter((turn) => card.sourceTurnRefs.some((ref) => ref.endsWith(`:${turn.turnIndex}`)))
              .slice(0, 3)
          : [];
      if (evidence.length > 0) {
        ctx.out(dim("  evidence preview"));
        for (const turn of evidence) {
          const prefix = `${turn.role}[${turn.turnIndex}]`;
          const text = turn.text.length > 120 ? `${turn.text.slice(0, 117)}…` : turn.text;
          ctx.out(`    ${prefix} ${text}`);
        }
      }
      if (card.body.trim()) ctx.out("\n" + card.body);
      return {};
    }

    if (sub === "rebuild") {
      const count = rebuildMemoryIndex(ctx.state.config.workdir);
      writeCoreDigest(ctx.state.config.workdir);
      ctx.out(green(`  Rebuilt memory index from ${count} card(s).`));
      return {};
    }

    if (sub === "compact") {
      const digest = writeCoreDigest(ctx.state.config.workdir);
      ctx.out(green("  Core digest refreshed."));
      for (const line of digest) ctx.out(`  ${line}`);
      return {};
    }

    if (sub === "diagnose") {
      let query = args.slice(1).join(" ").trim();
      if (!query && ctx.pick) {
        query = await askMemoryQuery(ctx, "  Diagnose memory for query: ");
      }
      if (!query) {
        ctx.out(dim("  Usage: /memory diagnose <query>"));
        return {};
      }
      const packet = retrieveMemoryContext({
        cwd: ctx.state.config.workdir,
        query,
        budget: ctx.state.config.memoryInjectionBudget,
      });
      ctx.out(bold(`  Memory diagnose: ${query}`));
      ctx.out(`  ${dim("intent")} ${packet.intent}`);
      ctx.out(`  ${dim("budget")} ${packet.tokenEstimate}/${ctx.state.config.memoryInjectionBudget}`);
      ctx.out(`  ${dim("preferred scope")} ${packet.diagnostics?.preferredScope ?? "n/a"}`);
      if (packet.coreDigest.length > 0) {
        ctx.out(`  ${dim("core digest")}`);
        for (const line of packet.coreDigest) ctx.out(`    ${line}`);
      }
      if ((packet.diagnostics?.candidates.length ?? 0) > 0) {
        ctx.out(`  ${dim("candidates")}`);
        for (const cand of packet.diagnostics!.candidates) {
          ctx.out(
            `    ${cand.id} ${symbols.dot} ${cand.title} ${dim(`(${cand.scope} · ${cand.kind} · ${cand.status} · ${cand.source})`)}`,
          );
          ctx.out(
            `      ${dim("score")} ${cand.score.toFixed(3)} ${dim("quality")} ${cand.quality.toFixed(3)} ${dim("freshness")} ${cand.freshness.toFixed(3)}`,
          );
          if (cand.reasons.length > 0) {
            ctx.out(`      ${dim("reasons")} ${cand.reasons.join(", ")}`);
          }
        }
      }
      if ((packet.diagnostics?.relationships.length ?? 0) > 0) {
        ctx.out(`  ${dim("conflicts")}`);
        for (const rel of packet.diagnostics!.relationships) {
          const label = rel.relation === "supersedes" ? "supersedes" : "superseded by";
          ctx.out(
            `    ${rel.id} ${symbols.dot} ${rel.title} ${dim(label)} ${rel.targetId} ${dim(`(${rel.targetTitle} · ${rel.targetStatus})`)}`,
          );
        }
      }
      if (packet.skills.length > 0) {
        ctx.out(`  ${dim("related skills")}`);
        for (const skill of packet.skills) {
          ctx.out(`    ${skill.name} ${dim(`(${skill.scope})`)} ${skill.description}`);
        }
      }
      return {};
    }

    ctx.out(red(`  Unknown /memory subcommand "${args[0]}".`));
    return {};
  },
};

export const rememberCommand: SlashCommand = {
  name: "remember",
  description: "Write a memory card from a short note",
  keywords: ["memory", "save"],
  priority: 75,
  async run(ctx, args) {
    let scope: "project" | "user" = "project";
    if ((args[0] ?? "") === "user" || (args[0] ?? "") === "project") {
      scope = args[0] as "project" | "user";
      args = args.slice(1);
    } else if (args.length === 0 && ctx.pick) {
      const choice = await ctx.pick("  Remember as", [
        { label: "Project memory", value: "project", hint: "repo convention or workflow" },
        { label: "User memory", value: "user", hint: "personal preference or style" },
      ]);
      if (choice === null) {
        ctx.out(dim("  Cancelled."));
        return {};
      }
      scope = choice as "project" | "user";
    }
    let text = args.join(" ").trim();
    if (!text && ctx.pick) {
      text = await askMemoryQuery(ctx, `  ${scope} memory text: `);
    }
    if (!text) {
      ctx.out(dim("  Usage: /remember [project|user] <text>"));
      return {};
    }
    const now = new Date().toISOString();
    const title = text.length > 48 ? text.slice(0, 48) + "…" : text;
    const card: MemoryCard = {
      id: randomUUID(),
      title,
      scope,
      kind: scope === "user" ? "preference" : "fact",
      tier: "archive" as const,
      summary: text,
      body: text,
      tags: [],
      entities: [],
      importance: 0.6,
      trust: 0.9,
      status: "active" as const,
      supersedes: [],
      sourceSessionId: ctx.state.session.id,
      sourceTurnRefs: [],
      sourceKind: "manual" as const,
      createdAt: now,
      updatedAt: now,
      accessCount: 0,
    };
    upsertMemoryCard(ctx.state.config.workdir, card);
    writeCoreDigest(ctx.state.config.workdir);
    ctx.out(green(`  Remembered ${scope} memory ${card.id}.`));
    return {};
  },
};

export const forgetCommand: SlashCommand = {
  name: "forget",
  description: "Soft-forget a memory card by id",
  keywords: ["memory", "remove"],
  priority: 50,
  async run(ctx, args) {
    let id = args.join(" ").trim();
    if (!id && ctx.pick) {
      id =
        (await pickMemoryCard(
          ctx,
          "  Forget which memory?",
          listMemoryCards(ctx.state.config.workdir)
            .filter((card) => card.status !== "forgotten")
            .slice(0, 50),
        )) ?? "";
    }
    if (!id) {
      ctx.out(dim("  Usage: /forget <id>"));
      return {};
    }
    if (!forgetMemoryCard(ctx.state.config.workdir, id)) {
      ctx.out(red(`  No memory "${id}".`));
      return {};
    }
    writeCoreDigest(ctx.state.config.workdir);
    ctx.out(green(`  Forgot memory ${id}.`));
    return {};
  },
};
