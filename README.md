# qnode

Query Nodes — link-graph indexing and querying for markdown knowledge vaults.

Full-text search surfaces documents. Vector search surfaces meaning. Neither understands **how** your notes connect. qnode builds a typed, directional graph from your wikilinks and answers structural graph questions: who are the siblings of this idea? what's the shortest path between two concepts? which notes are most central to my knowledge base?

---

## Quick Start

### Install

**Via Claude Code marketplace (recommended):**

```sh
claude plugin marketplace add idanariav/pkm-query-tools
claude plugin install qnode@pkm-query-tools
```

**Via npm:**

```sh
npm install -g @idan_ariav/qnode
```

Requires Node ≥ 22.

### Setup and first queries

```sh
# 1. Register a folder of markdown notes
qnode collection add ~/notes/claims --name claims

# 2. Build the graph index
qnode index --collection claims

# 3. Query the graph
qnode siblings "epistemology.md"              # notes that share a parent topic
qnode neighbors "free-will.md" --category Right  # notes that support this idea
qnode find-by-distance "consciousness.md" --max-distance 2  # nearby notes
qnode distance "determinism.md" "agency.md"   # how many hops apart?
qnode path "rationalism.md" "empiricism.md"   # shortest connection path

# 4. Compute network metrics (optional)
qnode metrics compute --collection claims
qnode metrics show --top 20 --sort pagerank   # most central notes
```

Once installed as an MCP plugin, you can ask Claude Code questions like:
- *"Find all claims within 2 hops of 'epistemology' that I haven't linked yet."*
- *"What's the shortest conceptual path from 'free will' to 'determinism'?"*
- *"Which notes are the most central hubs in my knowledge base?"*

---

## Use Cases

qnode answers structural questions about your knowledge graph that search tools can't. It's designed for personal knowledge management workflows — Zettelkasten, Obsidian vaults, research notes — where the connections between ideas matter as much as the content.

**Find related ideas you've already written about**
> "Show me all claims within 2 hops of this note that I haven't linked yet."
> `qnode find-by-distance "my-note.md" --max-distance 2`

**Discover sibling ideas — notes that share a common parent topic**
> "What other claims live under the same topic as this one?"
> `qnode siblings "confirmation-bias.md"`

**Trace the conceptual chain between two ideas**
> "How does 'rationalism' connect to 'pragmatism' through my notes?"
> `qnode path "rationalism.md" "pragmatism.md"`

**Find supporters and challengers of a claim**
> "Which notes argue for or against this idea?"
> `qnode neighbors "free-will.md" --category Right`
> `qnode neighbors "free-will.md" --category Left`

**Identify the most central nodes in your vault**
> "Which ideas appear most often on the paths between other ideas?"
> `qnode metrics show --sort betweenness --top 20`

**Understand community structure**
> "Which clusters of notes form their own densely linked sub-graphs?"
> `qnode metrics show --sort community`

---

## Commands

### Collection management

Collections are scoped views into your vault. Register any folder of markdown files as a collection.

```sh
qnode collection add <path> --name <name> [--pattern <glob>] [--vault-root <path>]
```

- `--pattern`: glob for which files to include (default: `**/*.md`)
- `--vault-root`: parent directory for resolving cross-folder wikilinks

```sh
qnode collection list                   # show all registered collections
qnode collection remove <name>          # unregister a collection
qnode collection rename <old> <new>     # rename a collection
```

**Example:**
```sh
qnode collection add ~/notes/claims --name claims --vault-root ~/notes
qnode collection add ~/notes/books --name books --vault-root ~/notes
qnode collection list
```

---

### Indexing

```sh
qnode index [--collection <name>]       # walk files and build the graph
qnode status [--collection <name>]      # show edge counts by category
```

Run `index` after adding a collection or when your notes change. `status` gives a quick summary of what's in the graph.

---

### Field mappings

qnode classifies each link into one of seven categories based on the frontmatter key or inline annotation used. You can configure which field names map to which category.

```sh
qnode fields get [--collection <name>]                    # show current mappings
qnode fields set <field> <val,val,...> [--collection <name>]  # set a mapping
qnode fields reset [--collection <name>]                  # restore defaults
```

Valid `<field>` names: `up-frontmatter`, `down-frontmatter`, `right-inline`, `left-inline`, `in-inline`, `out-inline`.

**Examples:**
```sh
qnode fields get                                  # show global defaults
qnode fields get --collection claims              # show effective mappings for a collection
qnode fields set up-frontmatter "Topic,Parent"    # global: treat Topic and Parent as Up links
qnode fields set right-inline "Supports,Backs" --collection claims  # per-collection override
qnode fields reset --collection claims            # remove per-collection overrides
```

Default mappings:
| Field | Default keys |
|---|---|
| `up-frontmatter` | `Topic` |
| `down-frontmatter` | `Down` |
| `right-inline` | `Supports`, `Supported` |
| `left-inline` | `Opposes`, `Weakens` |
| `in-inline` | `Jump` |
| `out-inline` | `Related`, `Reminds`, `Aka` |

---

### Graph queries

**`qnode get <file>`**
Returns all incoming and outgoing edges for a node, plus network metrics if computed.
```sh
qnode get "epistemology.md"
```

**`qnode neighbors <file>`**
Returns notes directly linked to or from this file, optionally filtered by category and direction.
```sh
qnode neighbors "free-will.md"
qnode neighbors "free-will.md" --category Right            # only supporters
qnode neighbors "free-will.md" --category Left --direction in  # notes that oppose this one
qnode neighbors "free-will.md" --json                      # machine-readable output
```
Options: `--category <Up|Down|Right|Left|In|Out|Uncategorized>`, `--direction <out|in|both>` (default: both), `--json`

**`qnode siblings <file>`**
Returns notes that share at least one Up (topic/parent) link with this file.
```sh
qnode siblings "confirmation-bias.md"
qnode siblings "confirmation-bias.md" --shared-min 2   # must share at least 2 parents
```
Options: `--shared-min N` (default: 1)

**`qnode distance <a> <b>`**
Returns the shortest-path distance in hops between two notes.
```sh
qnode distance "rationalism.md" "empiricism.md"
qnode distance "rationalism.md" "empiricism.md" --max 5 --include-external
```
Options: `--max N`, `--include-external`

**`qnode path <a> <b>`**
Returns the full shortest path between two notes as a list of file paths.
```sh
qnode path "rationalism.md" "pragmatism.md"
qnode path "rationalism.md" "pragmatism.md" --max 6 --include-external
```
Options: `--max N`, `--include-external`

**`qnode find-by-distance <file>`**
Returns all notes reachable within N hops, with optional filtering. By default, directly-linked notes are excluded (surfacing less-obvious connections).
```sh
qnode find-by-distance "consciousness.md"
qnode find-by-distance "consciousness.md" --max-distance 3
qnode find-by-distance "consciousness.md" --file-type claim --max-distance 2
qnode find-by-distance "consciousness.md" --include-existing --include-external --json
```
Options: `--max-distance N` (default: 2), `--file-type <tag>` (filter by frontmatter `type`/`tags`), `--include-existing` (include directly-linked notes), `--include-external`, `--json`

---

### Network metrics

```sh
qnode metrics compute [--collection <name>]
```
Computes and stores five metrics per node. Run after `qnode index`; re-run after re-indexing.

```sh
qnode metrics show [--collection <name>] [--top N] [--sort <metric>]
                   [--min-<field> N] [--max-<field> N] [--json]
```

**Examples:**
```sh
qnode metrics compute --collection claims
qnode metrics show --top 20 --sort pagerank
qnode metrics show --sort betweenness --min-in_degree 10
qnode metrics show --sort community --json
```

| Metric | Description |
|---|---|
| `in_degree` | Number of notes pointing at this node |
| `out_degree` | Number of notes this node points at |
| `pagerank` | How often a random walk lands here — overall importance |
| `betweenness` | How often this node lies on shortest paths between others — bridge role |
| `clustering_coeff` | How densely connected this node's neighbors are |
| `community` | Cluster ID from label propagation — notes in the same cluster link densely together |

---

### MCP server

```sh
qnode mcp    # Start the MCP server (stdio transport)
```

Exposes 8 tools for use by Claude Code agents:

| Tool | Description |
|---|---|
| `get(path)` | Full node detail: edges, metrics, title |
| `neighbors(path, category?, direction?, collection?)` | Categorized incoming/outgoing edges |
| `siblings(path, shared_min?, collection?)` | Notes sharing a topic/parent |
| `distance(from, to, max?, include_external?)` | Shortest-path hop count |
| `path(from, to, max?, include_external?)` | Shortest path as file list |
| `find_by_distance(path, max_distance?, file_type?, exclude_existing?, include_external?)` | Neighborhood search with filters |
| `metrics(path)` | PageRank, betweenness, clustering, degree, community |
| `status(collection?)` | Index counts by category and collection |

---

## Methodology

### How links are classified

qnode reads two kinds of link annotations from your markdown:

- **Frontmatter fields**: YAML lists or scalars of wikilinks. `Topic: ["[[Parent]]"]` creates an Up edge from the current file to `Parent`.
- **Inline-field annotations** (Dataview-style): a key immediately before a wikilink in the body. `(Supports:: [[target]])` creates a Right edge. `(Opposes:: [[target]])` creates a Left edge.
- **Plain wikilinks** in the body (`[[target]]`, `[[target|alias]]`, `[[target#section]]`) are recorded as **Uncategorized** edges.

Every edge is typed into one of seven categories:

| Category | Meaning |
|---|---|
| **Up** | topic / parent — this note belongs to that topic |
| **Down** | child idea — that note is a sub-idea of this one |
| **Right** | supporter — that note argues for this one |
| **Left** | opponent — that note argues against this one |
| **In** | deep-dive — that note expands on a concept mentioned here |
| **Out** | related idea from another domain |
| **Uncategorized** | plain wikilink with no semantic annotation |

### Graph construction

After parsing, qnode stores nodes and edges in a local SQLite database (`~/.cache/qnode/index.sqlite`). Each node is a file; each edge is a directed, typed link between two files. Unresolved wikilinks (no matching file) are still stored — they just have no resolved destination path. Files outside the registered collection are stored as external endpoints and not traversed.

### Graph traversal

- **`neighbors`**: direct edge lookup — O(1) in the SQLite index.
- **`siblings`**: finds all files sharing at least one Up-edge target, via a set-intersection query.
- **`distance` / `path`**: bidirectional BFS from both endpoints, meeting in the middle for efficiency.
- **`find-by-distance`**: standard BFS up to depth N with optional tag/type filtering at each hop.

### Network metrics

`qnode metrics compute` runs graph-wide analysis using the full edge set:

- **PageRank**: directed, damping factor 0.85. Measures how much "link authority" flows into each node via the directed graph.
- **Betweenness centrality**: undirected. Counts how many shortest paths between all pairs of nodes pass through each node — identifies bridges and connectors.
- **Clustering coefficient**: undirected local measure. Fraction of a node's neighbors that are also connected to each other — identifies tightly-knit clusters.
- **Community detection**: label propagation on the undirected graph. Nodes converge to a shared community ID when they are densely interconnected.

Metrics are scoped to in-collection nodes; edges to external files are excluded from computation.

---

## Privacy and Security

qnode is entirely local. No data leaves your device.

- **No network calls**: the indexer reads your markdown files and writes to a local SQLite database. There are no external API calls, no telemetry, no cloud sync.
- **No model or embedding service**: graph traversal and metrics are computed with classical graph algorithms — BFS, PageRank, label propagation — entirely in process.
- **Your notes stay on disk**: the SQLite index (`~/.cache/qnode/index.sqlite`) and config (`~/.config/qnode/index.yml`) are written only to your local filesystem.
- **MCP transport is stdio**: when running as an MCP server, qnode communicates over standard input/output to the local MCP client. No network port is opened.

---

## Other Plugins

qnode is part of the **pkm-query-tools** marketplace plugin, alongside:

| Plugin | Description |
|---|---|
| **qimg** | Image indexing and visual search — find images by content, similarity, or semantic query |
| **qvoid** | Semantic clustering and void detection — find gaps and blind spots in your knowledge graph |

Install the whole suite:

```sh
claude plugin marketplace add idanariav/pkm-query-tools
claude plugin install qimg@pkm-query-tools
claude plugin install qvoid@pkm-query-tools
```

---

## License

MIT
