# qnode — Querying & Graph Traversal

**When to read this:** You're touching graph traversal, BFS algorithms, metrics computation, or CLI query commands (`neighbors`, `distance`, `path`, `find-by-distance`, `siblings`, `get`, `metrics`).

See [ARCHITECTURE.md](ARCHITECTURE.md) for key types. See [MCP.md](MCP.md) for the MCP query layer.

## Query Entry Points

All queries flow through two layers:

```
graph.ts          ← public interface: path normalization + algorithm wrappers
  └─ store.ts     ← primitives: SQL queries and JS BFS
```

CLI commands (`cli/qnode.ts:cmdXxx`) call `graph.ts` functions directly.
MCP tools (`mcp/server.ts`) also call `graph.ts` — same code path.

## Path Normalization — `graph.ts:resolveFileArg(store, arg)`

Accepts three input forms and returns an absolute path (or `null`):
1. **Absolute path** — used as-is
2. **CWD-relative path** — resolved against `process.cwd()`
3. **Basename suffix** — delegates to `store.findNodeBySuffix(arg)` which does `path LIKE '%/' || arg`

All graph functions call `resolveFileArg()` before any query.

## Neighbor Lookup — `store.ts`

| Method | SQL | Notes |
|--------|-----|-------|
| `outgoing(src, category?)` | `SELECT * FROM edges WHERE src_path = ?` | Optional category filter |
| `incoming(dst, category?)` | `SELECT * FROM edges WHERE dst_path = ?` | Optional category filter |

Backed by indexes `idx_edges_src(src_path, category)` and `idx_edges_dst(dst_path, category)`.

`graph.ts:neighbors(store, path, opts?)` wraps these:
- `opts.direction` = `"out"` (default) | `"in"` | `"both"`
- `opts.category` = any `Category` value for filtering

## BFS Algorithms — `store.ts`

Both algorithms use **lazy adjacency loading** — neighbors are fetched per-node via `outgoing()`/`incoming()` SQL calls rather than materializing the full graph up front.

### `store.path(start, end, maxHops, includeExternal)` → `string[] | null`

Standard BFS with a parent-tracking map. Reconstructs the shortest path by backtracking from `end` to `start`. Returns `null` if `end` is not reached within `maxHops` (default 6).

`includeExternal=true` allows traversal through nodes with `collection=null`.

`store.distance(start, end, maxHops, includeExternal)` delegates to `path()` and returns `path.length - 1` (or `null`).

### `store.findByDistance(start, maxHops, includeExternal)` → `DistanceResult[]`

BFS that records distance to every reachable node, sorted by distance ascending. Returns:
```typescript
{ path: string; distance: number; collection: string | null; title: string | null }[]
```

`graph.ts:graphFindByDistance()` wraps this with two post-BFS filters:
- **`fileType`**: reads YAML frontmatter of each result file; keeps nodes where `frontmatter.type` or `frontmatter.tags` (array or string) match the given value (case-insensitive, supports hierarchical tags like `"Type/Claim"`)
- **`excludeExisting`** (default `true`): removes distance-1 nodes (already directly linked)

## Siblings — `store.ts:siblings(file, sharedMin)`

SQL join: finds all files that share at least `sharedMin` (default 1) `Up`-category parent links with `file`.

```sql
SELECT e2.src_path, COUNT(*) AS shared_parents
FROM edges e1
JOIN edges e2 ON e1.dst_path = e2.dst_path AND e2.src_path != ?
WHERE e1.src_path = ? AND e1.category = 'Up' AND e2.category = 'Up'
GROUP BY e2.src_path
HAVING shared_parents >= ?
ORDER BY shared_parents DESC
```

## Node Detail — `graph.ts:getNodeDetail(store, path)`

Bundles all node information into a single response:
```typescript
{
  node: NodeRow,
  outgoing: EdgeRow[],
  incoming: EdgeRow[],
  metrics: MetricsRow | null
}
```

Used by CLI `get` command and MCP `get` tool.

## Metrics — `store.ts`

Metrics are computed externally (e.g. via `qnode metrics compute`) and stored in `node_metrics`.

```sql
CREATE TABLE node_metrics (
  path TEXT PRIMARY KEY,
  in_degree INTEGER, out_degree INTEGER,
  pagerank REAL, betweenness REAL, clustering_coeff REAL,
  community INTEGER,
  computed_at INTEGER
);
CREATE INDEX idx_node_metrics_pagerank   ON node_metrics(pagerank DESC);
CREATE INDEX idx_node_metrics_community  ON node_metrics(community);
```

| Method | Purpose |
|--------|---------|
| `upsertMetrics(rows[])` | Batch INSERT OR REPLACE, wrapped in transaction |
| `getMetrics(path)` | Single node lookup |
| `allMetrics(collection?)` | All metrics ordered by `pagerank DESC`; optional collection scope |
| `clearMetrics(collection?)` | Wipe before recomputation |
| `loadResolvedEdges(collection?)` | Edges where both src and dst are in the collection (for PageRank/betweenness input) |
| `loadInCollectionNodes(collection?)` | Node list for metric computation |

`scripts/compute-metrics.ts` implements the actual PageRank, betweenness, clustering, and community algorithms using the edges loaded from `loadResolvedEdges()`.

## CLI Output Formats

All query commands support `--json` for machine-readable output.

| Command | Text columns | Notes |
|---------|-------------|-------|
| `neighbors` | `category direction path title` | grouped by category |
| `distance` | single number or `∞` | |
| `path` | one path per line | |
| `find-by-distance` | `distance  label  path` | label = title or basename |
| `siblings` | `shared_parents  path` | |
| `get` | JSON always | no text mode |
| `metrics show` | `path pagerank betweenness clustering in out community` | |

### `metrics show` Flags

| Flag | Type | Purpose |
|------|------|---------|
| `--sort <key>` | MetricSortKey | Sort by `pagerank`/`betweenness`/`clustering_coeff`/`in_degree`/`out_degree`/`community` |
| `--min-<field> <n>` | number | Lower bound filter (e.g. `--min-in_degree 50`) |
| `--max-<field> <n>` | number | Upper bound filter |
| `--collection <n>` | string | Scope to one collection |
