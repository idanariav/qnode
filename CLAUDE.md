# qnode

Build and query a graph index of wikilink relationships across Obsidian-style vaults — with an MCP server for Claude Code.

## General instructions

When refactoring commands (renaming, adding/removing params) — review CLAUDE.md, docs/, and README.md to ensure no stale references remain.

## Commands

```sh
qnode collection add <path> --name <n> [--pattern <glob>] [--vault-root <path>]
qnode collection list
qnode collection remove <name>
qnode collection rename <old> <new>

qnode fields get   [--collection <n>]
qnode fields set   <field> <val,val,...> [--collection <n>]
qnode fields reset [--collection <n>]

qnode index   [--collection <n>]          # Parse files and populate SQLite index
qnode status  [--collection <n>]          # Node/edge counts by category

qnode get              <file>
qnode neighbors        <file> [--category <cat>] [--direction out|in|both] [--json]
qnode siblings         <file> [--shared-min N]
qnode distance         <a> <b> [--max N] [--include-external]
qnode path             <a> <b> [--max N] [--include-external]
qnode find-by-distance <file> [--max-distance N] [--file-type <tag>] [--include-existing] [--include-external] [--json]
qnode metrics compute  [--collection <n>]
qnode metrics show     [--collection <n>] [--sort <key>] [--min-<field> N] [--json]

qnode mcp                                 # Start MCP server (stdio transport)
```

## Development

```sh
npx tsx src/cli/qnode.ts <command>   # Run from source (no build needed)
npm run build                        # Compile TypeScript → dist/
npm test                             # Run test suite (vitest, in-memory SQLite)
```

## Important: Do NOT run automatically

- Never run `qnode index` automatically — it modifies the SQLite index
- Write out commands for the user to run manually

## Do NOT compile unnecessarily

Use `npx tsx src/cli/qnode.ts <command>` during development to avoid repeated builds. Only run `npm run build` when testing the compiled output or before publishing.

## Releasing

Use `/npm-release` to cut a release.

- Add changelog entries under `## [Unreleased]` **as you make changes**
- The release script renames `[Unreleased]` → `[X.Y.Z] - date` at release time

## Architecture

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the full module map, end-to-end data flow, key types, and config paths.

Subsystem docs:

| Topic | File |
|-------|------|
| File discovery, parsing, path resolution, SQLite write | [docs/INDEXING.md](docs/INDEXING.md) |
| Graph traversal, BFS, metrics, CLI output formats | [docs/QUERYING.md](docs/QUERYING.md) |
| MCP tool schemas, handler pattern, adding new tools | [docs/MCP.md](docs/MCP.md) |
