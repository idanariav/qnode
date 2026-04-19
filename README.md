# qnode

Query Nodes — link-graph indexing and querying for markdown knowledge vaults.

Answers questions that existing search tools don't handle well:

1. **Siblings of X** — files that share a topical parent with X.
2. **Supporters / opposers of X** — files that argue for or against X via categorized links.
3. **Distance from X to Y** — how many link hops separate two notes.
4. **Neighborhood of X** — all notes within N hops, optionally filtered by type and excluding already-linked notes.

## Why

Full-text search surfaces documents. Vector search surfaces meaning. Neither understands **how** your notes connect. qnode builds a typed, directional graph from your wikilinks and answers graph questions — not text questions.

## The 7 Link Categories

Every edge between two notes is classified into one of seven types:

| Category          | Meaning                           |
|-------------------|-----------------------------------|
| **Up**            | topic / parent                    |
| **Down**          | child idea                        |
| **Right**         | supportive idea                   |
| **Left**          | opposing idea                     |
| **In**            | deep-dive into a mentioned idea   |
| **Out**           | related idea from another field   |
| **Uncategorized** | plain body wikilink               |

You tell qnode which frontmatter keys and inline-field names map to which category. All mappings live in one YAML file (`~/.config/qnode/index.yml`) and can differ per collection. qnode ships with sensible defaults that match common Obsidian / Dataview conventions, but nothing is hard-coded.

## Syntax qnode understands

- **Frontmatter**: YAML lists or scalars of wikilinks, e.g. `Topic: ["[[Parent]]"]`.
- **Inline-field annotations** (Dataview-style) immediately before a wikilink: `(Supports:: [[target]])`, `(Opposes:: [[target]])`, `(Related:: [[target]])`, etc.
- **Plain wikilinks** in the body: `[[target]]`, `[[target|alias]]`, `[[target#section]]`, `[[target^block]]` — classified as **Uncategorized**.

Unresolved links (wikilinks with no matching file) are still recorded; they just have no destination path.

## Collections

A **collection** is a scoped view of your vault. Registering a collection tells qnode which folder to treat as "in-scope". External files that link into your collection are recorded as endpoints but are not themselves traversed — this keeps the graph focused and fast on large vaults.

## Install

```sh
git clone https://github.com/idanariav/qnode.git
cd qnode
npm install
npm run build
npm link   # makes `qnode` available globally
```

Requires Node ≥ 22.

## Quickstart

```sh
# 1. Register a collection (any folder containing .md files)
qnode collection add <path-to-notes> --name <collection-name> \
      [--vault-root <path>]    # optional: parent dir for resolving cross-folder wikilinks

# 2. Build the index
qnode index --collection <collection-name>

# 3. Ask questions
qnode siblings         <file.md>
qnode neighbors        <file.md> --category Right --direction in
qnode distance         <file-a.md> <file-b.md>
qnode path             <file-a.md> <file-b.md>
qnode find-by-distance <file.md> --file-type claim --max-distance 2
qnode get              <file.md>
qnode status
```

## Command reference

```
qnode collection add <path> --name <n> [--pattern <glob>] [--vault-root <path>]
qnode collection list
qnode collection remove <name>
qnode collection rename <old> <new>

qnode index   [--collection <n>]                     Walk and (re)build the graph
qnode status  [--collection <n>]                     Counts by category

qnode get              <file>                        All incoming + outgoing edges for a node
qnode neighbors        <file> [--category <cat>]
                              [--direction out|in|both]   Default: both
                              [--json]
qnode siblings         <file> [--shared-min N]       Shares ≥N Up parents (default 1)
qnode distance         <a> <b> [--max N] [--include-external]
qnode path             <a> <b> [--max N] [--include-external]
qnode find-by-distance <file> [--max-distance N]     All nodes within N hops (default 2)
                              [--file-type <tag>]    Filter by frontmatter type/tags field
                              [--include-existing]   Include directly-linked nodes (excluded by default)
                              [--include-external]   Traverse through out-of-collection files
                              [--json]

qnode mcp                                            Start stdio MCP server
```

## Configuration

qnode is driven by a single YAML file at `~/.config/qnode/index.yml` (override with `QNODE_CONFIG_DIR`). Example:

```yaml
collections:
  my-notes:
    path: /absolute/path/to/notes
    pattern: "**/*.md"
    ignore: ["Templates/**", "Archive/**"]
    vault_root: /absolute/path/to/vault   # optional
    # Per-collection overrides (optional):
    # category_fields:
    #   up_frontmatter: [Parent, Topic]
    #   right_inline:   [Supports, Backs]

category_fields:                                     # global defaults
  up_frontmatter:   [Topic]
  down_frontmatter: [Down]
  right_inline:     [Supports, Supported]
  left_inline:      [Opposes, Weakens]
  in_inline:        [Jump]
  out_inline:       [Related, Reminds, Aka]
```

Any field not listed in `category_fields` is ignored. Plain wikilinks (no prefix) are always **Uncategorized**.

## MCP

`qnode mcp` starts a stdio MCP server. Tools exposed:

- `siblings(path, shared_min?, collection?)`
- `neighbors(path, category?, direction?, collection?)`
- `distance(from, to, max?, include_external?)`
- `path(from, to, max?, include_external?)`
- `find_by_distance(path, max_distance?, file_type?, exclude_existing?, include_external?)` — all nodes within N hops; `file_type` matches frontmatter `type` field or Obsidian hierarchical tags (e.g. `"claim"` matches `Type/Claim`); `exclude_existing` (default `true`) skips directly-linked notes
- `get(path)`
- `status(collection?)`

Register it with your MCP-capable client (e.g. via the included `.mcp.json`).

## How it compares to other tools

| Tool         | What it sees                        | What qnode adds                                   |
|--------------|-------------------------------------|---------------------------------------------------|
| Full-text / vector search | document content         | typed edges and graph traversal                    |
| `obsidian-cli` / core backlinks | raw link endpoints   | semantic categorization + "uncategorized" bucket   |
| Dataview     | inline fields per-note, per-key     | cross-note siblings, distance, path, typed queries |

## License

MIT
