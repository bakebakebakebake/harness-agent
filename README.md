# Harness-Agent

A local-first coding agent CLI with:

- interactive slash-command menus
- smarter slash ranking for exact and prefix matches
- editable multi-line input
- session resume and rewind
- native project/user memory
- todo tracking
- shell, subagent, MCP, and web search support
- inline `#skill` attach, repo protection rules, and Tavily-first search

## Requirements

- Node.js `>=20`
- An API key for one of the supported providers

## Install

### From npm

```bash
npm install -g harness-agent
```

Then run:

```bash
harness-agent
```

Or run without installing first:

```bash
npx harness-agent
```

### From a GitHub release tarball

If you want to install a specific release directly:

```bash
npm install -g https://github.com/bakebakebakebake/harness-agent/releases/download/v0.3.2/harness-agent-0.3.2.tgz
```

## First Run

On first launch, Harness-Agent walks you through provider setup and stores your profile locally.

Supported providers in the current build:

- Anthropic
- OpenAI-compatible endpoints

You can also prepare config from the included example:

```bash
cp .env.example .env
```

## Usage

Start the CLI:

```bash
harness-agent
```

Useful commands inside the app:

- `/help`
- `/search <query>`
- `/memory`
- `/remember`
- `/forget`
- `/profile`
- `/model`
- `/mode`
- `/diff`
- `/resume`
- `/rewind`
- `/skill`
- `/debug`
- `/mcp`
- `/usage`
- `/protect`

## Interaction Highlights

- `/` menus now rank exact and prefix hits above loose fuzzy matches, so `/mode`
  lands on `/mode` instead of unrelated commands.
- `#` now opens an inline skill picker directly inside the input box. Pick a
  skill, keep typing, and the current draft keeps a visible `skills:` badge.
- `/skill` opens the same searchable picker, and also supports
  `/skill list`, `/skill enable <name>`, `/skill disable <name>`, and
  `/skill clear`.
- Disabled skills stay out of the always-on skill catalog, out of automatic
  retrieval, and out of the inline picker until you re-enable them.
- `/diff` now starts from changed files, then lets you inspect a patch for the
  file you choose instead of dumping the whole repo diff at once. After you view
  one patch, you can immediately keep browsing other changed files.
- `/search <query>` now uses Tavily first when `TAVILY_API_KEY` is present, then
  falls back to Bing. Results keep source, backend, URL, and dates so they stay
  easy to verify.
- `!` commands now run through your login + interactive shell, so aliases such
  as `ll` match your local terminal more closely.
- `/mcp` shows configured servers plus live connection / loaded-tool state.
- `/protect` lets you block risky model-side command patterns and protect repo
  paths from accidental edits or destructive shell calls.
- `/debug on` writes structured logs to `~/.harness-agent/logs/harness-agent.log`
  so UI and provider issues are easier to diagnose.

## Repo Config

Harness-Agent reads repo-local config from:

- `<workdir>/.agents/harness-agent.json`
- `<workdir>/.agent/harness-agent.json` as a compatibility fallback

Current keys:

```json
{
  "disabledSkills": ["review"],
  "blockedCommands": ["rm -rf", "git reset --hard"],
  "protectedPaths": ["src/secret", ".env"]
}
```

Notes:

- `disabledSkills` removes a skill from the prompt catalog and from `#` / `/skill`.
- `blockedCommands` only applies to model-driven `bash` / `shell` actions.
- `protectedPaths` blocks model-driven `edit` / `write`, and also blocks shell
  commands that obviously target those paths.
- User-typed `!` commands are not blocked by `/protect`.

## Memory

Harness-Agent now includes a native memory system with:

- file-backed memory cards
- session transcript evidence
- a local SQLite index for retrieval
- a derived core digest that stays small enough for stable injection
- automatic pre-turn memory injection
- access tracking so frequently used memories rise into the digest over time
- conservative durable-memory extraction for both English and common Chinese instructions

Storage layout:

- project memory: `<workdir>/.agents/memory/project/*.md`
- user memory: `~/.harness-agent/memory/user/*.md`
- index: `~/.harness-agent/memory/index.sqlite`
- transcripts: `~/.harness-agent/memory/transcripts/<session-id>.jsonl`
- digests: `~/.harness-agent/memory/digests/<hash>.md`

Useful memory commands:

- `/memory`
- `/memory list`
- `/memory search <query>`
- `/memory show <id>` for evidence preview and relationship overview
- `/memory rebuild`
- `/memory compact`
- `/memory diagnose <query>`
- `/remember [project|user] <text>`
- `/forget <id>`

In TTY mode, `/memory`, `/remember`, and `/forget` also support picker-driven flows so you usually do not need to type the full subcommand or memory id by hand.

If you want a full example-driven walkthrough, see:

- [docs/12-memory-system.md](docs/12-memory-system.md)

## Release Notes

- Releases are published on GitHub under the repository Releases page.
- npm publishing is configured for public release and `harness-agent` can be installed directly from npm.
- GitHub Actions now runs `npm run typecheck`, `npm test`, and `npm run build`
  on pushes, pull requests, and release tags.

## More Docs

- [docs/12-memory-system.md](docs/12-memory-system.md)
- [docs/13-interaction-and-search.md](docs/13-interaction-and-search.md)

## License

MIT
