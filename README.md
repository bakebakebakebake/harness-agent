# Harness-Agent

A local-first coding agent CLI with:

- interactive slash-command menus
- editable multi-line input
- session resume and rewind
- native project/user memory
- todo tracking
- shell, subagent, and MCP support

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
- `/memory`
- `/remember`
- `/forget`
- `/profile`
- `/model`
- `/mode`
- `/resume`
- `/rewind`
- `/skill`
- `/mcp`
- `/usage`

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

## License

MIT
