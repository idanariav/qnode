# qnode — MCP Server

**When to read this:** You're adding a new MCP tool, changing an existing tool's schema, debugging MCP requests, or wiring qnode into an LLM client.

See [ARCHITECTURE.md](ARCHITECTURE.md) for key types. See [QUERYING.md](QUERYING.md) for the graph algorithms these tools call.

## Server Setup — `src/mcp/server.ts`

- Transport: `StdioServerTransport` (stdin/stdout)
- A single `Store` instance is created at startup and reused for the lifetime of the MCP session
- Capabilities: `{ tools: {} }`
- Start via: `qnode mcp`

## Tool Inventory

| Tool | Required Input | Optional Input | Returns |
|------|---------------|----------------|---------|
| `get` | `path: string` | — | `NodeDetail` (node + outgoing + incoming + metrics) |
| `neighbors` | `path: string` | `category: Category`, `direction: "in"\|"out"\|"both"` | `EdgeRow[]` |
| `siblings` | `path: string` | `shared_min: number` (default 1) | `{path, shared_parents}[]` |
| `distance` | `from: string`, `to: string` | `max: number` (default 6), `include_external: boolean` | `{distance: number \| null}` |
| `path` | `from: string`, `to: string` | `max: number` (default 6), `include_external: boolean` | `{path: string[] \| null}` |
| `find_by_distance` | `path: string` | `file_type: string`, `max_distance: number` (default 2), `exclude_existing: boolean`, `include_external: boolean` | `DistanceResult[]` |
| `status` | — | `collection: string` | `{nodes, external_nodes, edges, by_category, by_collection}` |
| `metrics` | `path: string` | — | `MetricsRow` or `{path, message}` if not found |

`path` inputs accept absolute paths, CWD-relative paths, or basename suffixes — `resolveFileArg()` normalizes them.

## Request Handler Pattern

Every tool handler in `mcp/server.ts` follows this structure:

```
1. Extract args from req.params.arguments
2. Validate required fields → errText() if missing
3. Validate enum values (category, direction) → errText() if invalid
4. resolveFileArg(store, path) → errText() if file not found
5. Call graph.ts function with resolved path
6. Return jsonText(result)
```

Helper functions:
- `jsonText(data)` — wraps result as `{ content: [{ type: "text", text: JSON.stringify(data, null, 2) }] }`
- `errText(msg)` — wraps as `{ isError: true, content: [...] }`

## Tool → Function → Store Mapping

| Tool | `graph.ts` function | `store.ts` method | Algorithm |
|------|--------------------|--------------------|-----------|
| `get` | `getNodeDetail()` | `getNode()` + `outgoing()` + `incoming()` + `getMetrics()` | Point lookups |
| `neighbors` | `neighbors()` | `outgoing()` / `incoming()` | SQL filter |
| `siblings` | `siblings()` | `siblings()` | SQL join on Up edges |
| `distance` | `distance()` | `path()` → length | JS BFS |
| `path` | `path()` | `path()` | JS BFS + backtrack |
| `find_by_distance` | `findByDistance()` | `findByDistance()` | JS BFS + frontmatter filter |
| `status` | (direct) | `status()` | COUNT aggregates |
| `metrics` | (direct) | `getMetrics()` | Point lookup |

## Error Handling

- Invalid `category` string: validated against `ALL_CATEGORIES` array → `errText()`
- Invalid `direction` string: checked against `["in", "out", "both"]` → `errText()`
- Unresolvable path: `resolveFileArg()` returns null → `errText("File not found: ...")`
- All errors return `isError: true` — MCP clients surface these as tool errors, not exceptions

## Adding a New Tool

1. **Register in `ListToolsRequestSchema` handler** — add a tool descriptor object with `name`, `description`, `inputSchema`
2. **Add handler in `CallToolRequestSchema` switch** — add a case for the tool name
3. **Validate and resolve:**
   ```typescript
   const p = resolveFileArg(store, String(args.path ?? ""));
   if (!p) return errText(`File not found: ${args.path}`);
   ```
4. **Delegate to `graph.ts`** (preferred) or `store.ts` directly for simple lookups
5. **Return** `jsonText(result)` on success, `errText(msg)` on failure

Keep handlers thin — business logic belongs in `graph.ts` or `store.ts`, not in the MCP server.
