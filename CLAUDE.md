# qnode — Developer Guide

## Commands

```sh
qnode collection add <path> --name <n> [--pattern <glob>] [--vault-root <path>]
qnode collection list
qnode collection remove <name>
qnode collection rename <old> <new>

qnode fields get   [--collection <n>]
qnode fields set   <field> <val,val,...> [--collection <n>]
qnode fields reset [--collection <n>]

qnode index   [--collection <n>]
qnode status  [--collection <n>]

qnode get              <file>
qnode neighbors        <file> [--category <cat>] [--direction out|in|both] [--json]
qnode siblings         <file> [--shared-min N]
qnode distance         <a> <b> [--max N] [--include-external]
qnode path             <a> <b> [--max N] [--include-external]
qnode find-by-distance <file> [--max-distance N] [--file-type <tag>] [--include-existing] [--include-external] [--json]

qnode mcp                                    # Start MCP server (stdio)
```

## Development Setup

```sh
npm install
npm run build        # Compile TypeScript → dist/
npm test             # Run tests with vitest
```

Run from source without building (useful during development):

```sh
npx tsx src/cli/qnode.ts <command>
```

## Project Structure

```
src/
  cli/qnode.ts      # CLI entry point and command dispatch
  mcp/server.ts     # MCP server (exposes graph query tools)
  store.ts          # SQLite store: nodes, edges, collection management
  graph.ts          # Graph traversal: BFS, distance, path, siblings
  indexer.ts        # File walker: parses notes and populates the store
  parser.ts         # Wikilink + inline-field parser
  resolver.ts       # Wikilink → file path resolution
  categories.ts     # Link category definitions and field mappings
  collections.ts    # Collection config types and validation
  index.ts          # Public API re-exports
test/
  ...               # vitest unit tests
```

## Config & Cache

- Config: `~/.config/qnode/index.yml` (override with `QNODE_CONFIG_DIR`)
- DB: `~/.cache/qnode/index.sqlite` (override with `QNODE_CACHE_DIR`)

## Running Tests

```sh
npm test
```

Tests use vitest and create in-memory SQLite databases — no external services required.

## Publishing

```sh
npm run build
npm publish
```

Requires `npm login` and `publishConfig.access: "public"` in `package.json` (already set).
