# qnode — Indexing Pipeline

**When to read this:** You're touching file discovery, parsing logic, wikilink tokenization, path resolution, edge/node storage, or the category field system.

See [ARCHITECTURE.md](ARCHITECTURE.md) for key types (`NodeRow`, `EdgeRow`, `Category`, `CategoryFields`).

## Pipeline Overview

```
1. Discover files    indexer.ts:collectMarkdownFiles()
2. Build resolver    resolver.ts:buildIndex()
3. Parse in-coll.    indexer.ts:parseAndWrite() × N  [collection=name]
4. Parse external    indexer.ts:parseAndWrite() × M  [collection=null, filter to edges into coll]
5. Post-pass relink  store.ts:relinkUnresolved()
```

Entry: `indexer.ts:indexCollection(store, col, fields, log?)` → returns `IndexReport`.

## 1. File Discovery — `indexer.ts`

`collectMarkdownFiles(root, pattern, ignore?)` uses `fast-glob` to enumerate files.

- `root` = collection path (or `vault_root` when scanning for external files)
- `pattern` = glob from collection config, default `**/*.md`
- Files are classified: **in-collection** (under `col.path`) vs **external** (under `vault_root` but outside `col.path`)
- External files are only stored if they have at least one edge resolving into the collection (`touchesCollection=true`)

## 2. Path Resolution Index — `resolver.ts`

`buildIndex(files, root)` builds a `ResolverIndex` once per indexing run:

```typescript
interface ResolverIndex {
  byBasename: Map<string, string[]>;  // lowercase stem → [abs paths...]
  byRelpath: Map<string, string>;     // lowercase rel path (no .md) → abs path
  root: string;
}
```

`resolveTarget(target, idx)` → absolute path or `null`:
1. Normalize: lowercase, strip `.md`, convert backslashes
2. Try `byRelpath` exact match → return immediately
3. Extract basename (last path segment)
4. Try `byBasename` — return only if exactly 1 match; null if 0 or 2+ (ambiguous)

Unresolved edges are stored with `dst_path=NULL` and retried in step 5.

## 3 & 4. Parse and Write — `indexer.ts:parseAndWrite()`

For each file:
1. `store.clearEdgesFrom(file)` — wipe previous edges (idempotent re-index)
2. `parser.parse(content, fields)` → `{ title, edges: ParsedEdge[] }`
3. For each `ParsedEdge`: call `resolveTarget()` → build `NewEdge`
4. `store.insertEdges(edges)` (batch transaction)
5. `store.upsertNode(path, collection, title, mtime, indexed_at)`

For external files: only edges where `dst_path` is inside the collection are kept.

## Parsing — `parser.ts:parse(content, fields)`

Returns `{ title: string | null, edges: ParsedEdge[] }`. Three phases:

### Phase 1 — Frontmatter (YAML via `gray-matter`)
- Walk YAML values recursively for `[[target]]` strings
- Match YAML key against `frontmatterKeyIndex(fields)` → `Category` (Up or Down)
- Context stored as `"frontmatter:<key>"`

### Phase 2 — Inline Fields (remark + micromark)
- Parse body with `remark-parse` + custom micromark extensions (see below)
- Walk AST for `inlineField` nodes: `(Key:: [[target]])`
- Match `key` against `inlineKeyIndex(fields)` → `Category` (Right/Left/In/Out or Uncategorized)

### Phase 3 — Plain Wikilinks (remark AST)
- Walk AST for bare `wikilink` nodes not consumed by inline field tokenizer
- Always `Uncategorized`

**Title extraction:** First H1 (`# Title`) in body; fallback to frontmatter `title`.

**`ParsedEdge` structure:**
```typescript
{ target, category, fieldKey, line, context, alias }
```
`context` = ±80 chars of surrounding text (or `"frontmatter:<key>"` for YAML edges).

## Wikilink Tokenization — `src/remark-extensions.ts`

Two custom micromark constructs (state machines):

| Construct | Syntax | Produces |
|-----------|--------|----------|
| Wikilink | `[[target]]` or `[[target\|alias]]` | `WikilinkNode { type, target, alias }` |
| InlineField | `(Key:: [[target]])` | `InlineFieldNode { type, key, target, alias }` |

Key validation for inline fields: must start with a letter, followed by `[A-Za-z0-9_-]*`.
Code spans and fenced code blocks are excluded automatically by remark-parse before tokenization.

## SQLite Write — `store.ts`

### Schema (relevant tables)

```sql
CREATE TABLE nodes (
  path TEXT PRIMARY KEY,
  collection TEXT,   -- null for external nodes; FK to collections(name)
  title TEXT,
  mtime INTEGER NOT NULL,
  indexed_at INTEGER NOT NULL
);

CREATE TABLE edges (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  src_path TEXT NOT NULL,
  dst_target TEXT NOT NULL,   -- raw wikilink string
  dst_path TEXT,              -- resolved abs path; null = unresolved
  category TEXT NOT NULL,
  field_key TEXT,
  line INTEGER,
  context TEXT,
  alias TEXT
);
CREATE INDEX idx_edges_src     ON edges(src_path, category);
CREATE INDEX idx_edges_dst     ON edges(dst_path, category);
CREATE INDEX idx_edges_dst_tgt ON edges(dst_target);
```

### Key Methods

| Method | Purpose |
|--------|---------|
| `store.upsertNode(row)` | INSERT OR REPLACE node |
| `store.clearEdgesFrom(src)` | Delete all edges for a file before re-parse |
| `store.insertEdges(edges[])` | Batch insert in a single transaction |
| `store.relinkUnresolved(basenameIndex)` | Post-pass: UPDATE edges where dst_path=null if basename resolves uniquely |
| `store.upsertCollection(row)` | Register/update collection metadata |

## 5. Post-Pass Relink — `store.ts:relinkUnresolved()`

After all files are parsed, unresolved edges (`dst_path=NULL`) are retried using `byBasename`. If a target matches exactly one file, the edge is updated with the resolved path. This handles forward-reference cases where file B is parsed before file A that B links to.

## Category Fields — `categories.ts`

`resolveCategoryFields(overrides?)` merges: built-in defaults → global config overrides → per-collection overrides.

`frontmatterKeyIndex(fields)` and `inlineKeyIndex(fields)` build `Map<string, Category>` lookup tables used during parsing. Later entries in the merged arrays win on key conflicts.

Default mappings:

| Category | Source | Default Keys |
|----------|--------|--------------|
| `Up` | frontmatter | `Topic` |
| `Down` | frontmatter | `Down` |
| `Right` | inline | `Supports`, `Supported` |
| `Left` | inline | `Opposes`, `Weakens` |
| `In` | inline | `Jump` |
| `Out` | inline | `Related`, `Reminds`, `Aka` |
| `Uncategorized` | body | (plain wikilinks) |
