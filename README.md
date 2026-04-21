# qnode

Query Nodes — link-graph indexing and querying for markdown knowledge vaults.

Answers questions that existing search tools don't handle well:

1. **Siblings of X** — files that share a topical parent with X.
2. **Supporters / opposers of X** — files that argue for or against X via categorized links.
3. **Distance from X to Y** — how many link hops separate two notes.
4. **Neighborhood of X** — all notes within N hops, optionally filtered by type and excluding already-linked notes.
5. **Network importance of X** — PageRank, betweenness centrality, clustering coefficient, and community assignment across the whole graph.

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
npm install -g @idan_ariav/qnode
```

Requires Node ≥ 22.

## Quickstart

```sh
# 1. Register a collection (any folder containing .md files)
qnode collection add <path-to-notes> --name <collection-name> \
      [--vault-root <path>]    # optional: parent dir for resolving cross-folder wikilinks

# 2. Build the index
qnode index --collection <collection-name>

# 3. (Optional) customise field → category mappings
qnode fields set up-frontmatter "Topic,Source"          # global
qnode fields set right-inline "Supports,Backs" --collection my-notes  # per-collection
qnode fields get --collection my-notes                  # inspect effective mappings

# 4. Ask questions
qnode siblings         <file.md>
qnode neighbors        <file.md> --category Right --direction in
qnode distance         <file-a.md> <file-b.md>
qnode path             <file-a.md> <file-b.md>
qnode find-by-distance <file.md> --file-type claim --max-distance 2
qnode get              <file.md>
qnode status

# 5. (Optional) compute network metrics
qnode metrics compute --collection <collection-name>
qnode metrics show --top 20 --sort pagerank
```

## Command reference

```
qnode collection add <path> --name <n> [--pattern <glob>] [--vault-root <path>]
qnode collection list
qnode collection remove <name>
qnode collection rename <old> <new>

qnode fields get   [--collection <n>]                Show effective field→category mappings
qnode fields set   <field> <val,val,...>              Set a field (comma-separated values)
                   [--collection <n>]                Scoped to collection, or global if omitted
qnode fields reset [--collection <n>]                Remove overrides, restore inherited defaults

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

qnode metrics compute [--collection <n>]             Compute network metrics and store in index
qnode metrics show    [--collection <n>]             Display stored metrics (requires compute first)
                      [--top N]                      Show only top N nodes
                      [--sort pagerank|betweenness|clustering_coeff|in_degree|out_degree|community]
                      [--min-<field> N]              Only nodes where field ≥ N (e.g. --min-in_degree 50)
                      [--max-<field> N]              Only nodes where field ≤ N
                      [--json]

qnode mcp                                            Start stdio MCP server
```

## Network metrics

`qnode metrics compute` analyses the link graph and stores five metrics per node. Run it after `qnode index`; re-run whenever you re-index.

| Metric | Description |
|---|---|
| `in_degree` | Number of distinct resolved sources pointing at this node |
| `out_degree` | Number of distinct resolved destinations this node points at |
| `pagerank` | Directed PageRank (d = 0.85) — measures how often a random walk lands here |
| `betweenness` | Undirected betweenness centrality — how often this node lies on shortest paths between others |
| `clustering_coeff` | Undirected local clustering coefficient — how densely connected this node's neighbors are |
| `community` | Community ID assigned by label propagation — nodes with the same ID form a densely linked cluster |

Metrics are scoped to in-collection nodes only; edges to external files are excluded. Each metric is stored in the index and returned by `qnode get` and the MCP `get` / `metrics` tools.

Valid `<field>` names for `fields set`: `up-frontmatter`, `down-frontmatter`, `right-inline`, `left-inline`, `in-inline`, `out-inline`.

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

## Claude Code MCP Integration

Run qnode as a Model Context Protocol server to enable Claude Code agents to query your knowledge graph.

### Quick Start

```bash
# Install from npm (if not already installed)
npm install -g @idan_ariav/qnode

# Add qnode to Claude Code via plugin marketplace (one command)
claude plugin marketplace add idanariav/qnode

# Install the plugin
claude plugin install qnode@qnode

# Verify it's connected
/mcp list
```

You should see `qnode` in the list of active MCP servers.

### Manual Setup (if marketplace doesn't work)

If the marketplace approach has issues, configure directly in `~/.claude/settings.json`:

```json
{
  "mcpServers": {
    "qnode": {
      "command": "qnode",
      "args": ["mcp"]
    }
  }
}
```

Then verify with `/mcp list`.

### Using qnode in Claude Code Agents

Once registered, agents can query your knowledge graph directly:

```
Find all notes within 2 hops of "epistemology.md" that are of type "claim".
Show me the shortest path from "artificial-intelligence.md" to "consciousness.md".
What are the strongest nodes by PageRank in my knowledge base?
```

The agent will:
1. Use `qnode get` to fetch node details and metrics
2. Use `qnode distance` / `qnode path` for graph traversal
3. Use `qnode find_by_distance` for filtered neighborhood searches
4. Use `qnode status` to understand your index

### MCP Tools Reference

`qnode mcp` exposes 8 tools:

- `siblings(path, shared_min?, collection?)` — Files sharing one or more Up (topic/parent) links
- `neighbors(path, category?, direction?, collection?)` — Incoming/outgoing categorized edges
- `distance(from, to, max?, include_external?)` — Shortest-path distance (in hops)
- `path(from, to, max?, include_external?)` — Shortest path as a list of file paths
- `find_by_distance(path, max_distance?, file_type?, exclude_existing?, include_external?)` — All nodes within N hops, optionally filtered by `type` field or hierarchical tags
- `get(path)` — Full node detail: incoming/outgoing edges, metrics, title
- `metrics(path)` — Network metrics (PageRank, betweenness, clustering coefficient, in/out degree, community ID)
- `status(collection?)` — Index counts by category and collection

### Running the MCP Server Standalone

For debugging or custom integrations:

```sh
qnode mcp
```

qnode uses stdio transport, compatible with Claude Code and all standard MCP clients.

## How it compares to other tools

| Tool         | What it sees                        | What qnode adds                                   |
|--------------|-------------------------------------|---------------------------------------------------|
| Full-text / vector search | document content         | typed edges and graph traversal                    |
| `obsidian-cli` / core backlinks | raw link endpoints   | semantic categorization + "uncategorized" bucket   |
| Dataview     | inline fields per-note, per-key     | cross-note siblings, distance, path, typed queries |

## License

MIT
