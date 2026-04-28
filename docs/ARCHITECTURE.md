# qnode — Architecture Overview

Start here. This document orients you to the whole system so you know which file to open for a given task.

## Module Map

| File | Responsibility | Key Exports |
|------|---------------|-------------|
| `src/cli/qnode.ts` | CLI entry point and command dispatch | `main()` |
| `src/mcp/server.ts` | MCP stdio server; exposes graph tools to LLMs | `startMcpServer()` |
| `src/indexer.ts` | Walks files, orchestrates parse → resolve → store | `indexCollection()` |
| `src/parser.ts` | Extracts wikilinks and inline fields from markdown | `parse()` |
| `src/resolver.ts` | Resolves wikilink targets to absolute file paths | `buildIndex()`, `resolveTarget()` |
| `src/store.ts` | SQLite persistence; nodes, edges, metrics, graph queries | `Store` class |
| `src/graph.ts` | High-level query interface; path normalization + algorithm wrappers | `resolveFileArg()`, `getNodeDetail()`, `neighbors()`, `distance()`, `path()`, `findByDistance()`, `siblings()` |
| `src/categories.ts` | Category enum, default field mappings, key-index builders | `Category`, `CategoryFields`, `resolveCategoryFields()` |
| `src/collections.ts` | Collection config lifecycle (load/save YAML) | `loadConfig()`, `addCollection()`, `effectiveCategoryFields()` |
| `src/remark-extensions.ts` | Micromark tokenizers for `[[wikilink]]` and `(Key:: [[target]])` | (internal, used by parser) |
| `src/index.ts` | Public API re-exports | — |

## End-to-End Data Flow

```
─── INDEXING ────────────────────────────────────────────────────────────────────
  qnode index
    └─ cli/qnode.ts:cmdIndex()
         └─ indexer.ts:indexCollection()
              ├─ collectMarkdownFiles()       [fast-glob]
              ├─ resolver.ts:buildIndex()     [byBasename + byRelpath maps]
              ├─ store.ts:upsertCollection()
              │
              ├─ [in-collection files]
              │    └─ parseAndWrite()
              │         ├─ parser.ts:parse()  [YAML → micromark → AST]
              │         ├─ resolver.ts:resolveTarget()  [path → abs path | null]
              │         ├─ store.ts:clearEdgesFrom() + insertEdges()
              │         └─ store.ts:upsertNode()
              │
              ├─ [external files that link into collection]
              │    └─ parseAndWrite()  (same, collection=null)
              │
              └─ store.ts:relinkUnresolved()  [post-pass basename fixup]

─── QUERYING (CLI) ──────────────────────────────────────────────────────────────
  qnode neighbors / distance / path / find-by-distance / siblings / get
    └─ cli/qnode.ts:cmdXxx()
         └─ graph.ts:resolveFileArg()         [normalize input path]
              └─ graph.ts:graphXxx()
                   └─ store.ts:Xxx()           [SQL query or JS BFS]

─── QUERYING (MCP) ──────────────────────────────────────────────────────────────
  MCP client → mcp/server.ts → resolveFileArg() → graph.ts → store.ts
```

## Key Types

Defined in source; reproduced here as a shared reference for other docs.

```typescript
// categories.ts
type Category = "Up" | "Down" | "Right" | "Left" | "In" | "Out" | "Uncategorized";

interface CategoryFields {
  up_frontmatter: string[];    // default: ["Topic"]
  down_frontmatter: string[];  // default: ["Down"]
  right_inline: string[];      // default: ["Supports", "Supported"]
  left_inline: string[];       // default: ["Opposes", "Weakens"]
  in_inline: string[];         // default: ["Jump"]
  out_inline: string[];        // default: ["Related", "Reminds", "Aka"]
}

// store.ts
interface NodeRow {
  path: string;              // PRIMARY KEY — absolute file path
  collection: string | null; // null for external nodes
  title: string | null;
  mtime: number;
  indexed_at: number;
}

interface EdgeRow {
  id: number;
  src_path: string;
  dst_target: string;        // raw wikilink target (may be unresolved)
  dst_path: string | null;   // resolved absolute path; null if unresolved
  category: Category;
  field_key: string | null;  // e.g. "Topic", "Supports"
  line: number | null;
  context: string | null;    // ±80 chars surrounding text
  alias: string | null;
}

interface MetricsRow {
  path: string;
  in_degree: number; out_degree: number;
  pagerank: number; betweenness: number; clustering_coeff: number;
  community: number;
  computed_at: number;
}

// collections.ts
interface Collection {
  path: string;
  pattern: string;                          // glob, default "**/*.md"
  ignore?: string[];
  vault_root?: string;
  category_fields?: Partial<CategoryFields>;
}
```

## Config & Cache Paths

| Purpose | Default Path | Override |
|---------|-------------|---------|
| Config YAML | `~/.config/qnode/index.yml` | `$QNODE_CONFIG_DIR` or `$XDG_CONFIG_HOME` |
| SQLite DB | `~/.cache/qnode/index.sqlite` | `$QNODE_CACHE_DIR` |

## Entry Points

- **CLI:** `src/cli/qnode.ts` — run via `qnode <command>` or `npx tsx src/cli/qnode.ts <command>`
- **MCP server:** `src/mcp/server.ts` — run via `qnode mcp` (stdio transport)
- **Public API:** `src/index.ts` — re-exports `Store`, `graph.*`, `indexCollection`, types

## Detailed Docs

| Topic | Doc |
|-------|-----|
| File discovery, parsing, edge storage | [INDEXING.md](INDEXING.md) |
| Graph traversal, BFS, metrics | [QUERYING.md](QUERYING.md) |
| MCP tools, schemas, adding new tools | [MCP.md](MCP.md) |
