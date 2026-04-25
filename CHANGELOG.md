# Changelog

## [Unreleased]

## [0.2.0] - 2026-04-25

### Added
- **Network metrics** — `qnode metrics` command exposes PageRank, in-degree, out-degree, and total-degree for nodes in the graph
- **Metrics filtering** — `--collection` and `--top N` filters on the `metrics` command to scope results per collection or limit output
- **Claude Code marketplace** — Added `.claude-plugin/marketplace.json` so qnode is installable directly via the Claude Code plugin marketplace

### Changed
- Metrics output splits computation from display for cleaner separation of concerns

## [0.1.0] - 2026-04-19

Initial release.

### Features

- **Link-graph indexing** — Parses wikilinks (frontmatter + Dataview inline fields + plain body links) and builds a typed, directional SQLite graph via `qnode index`
- **7 link categories** — Up, Down, Right, Left, In, Out, Uncategorized; configurable field→category mappings per collection or globally
- **Siblings** — Files sharing ≥N Up-category parents with a given note via `qnode siblings`
- **Neighbors** — Incoming/outgoing edges filtered by category and direction via `qnode neighbors`
- **Distance** — Shortest hop count between two notes via `qnode distance`
- **Path** — Actual link path between two notes via `qnode path`
- **Find by distance** — All notes within N hops, with optional `--file-type`, `--include-existing`, and `--include-external` filters via `qnode find-by-distance`
- **MCP server** — Exposes `siblings`, `neighbors`, `distance`, `path`, `find_by_distance`, `get`, and `status` tools over stdio transport for Claude Code and other MCP clients
- **Collection management** — Add, list, remove, and rename note collections with configurable glob patterns and vault roots
- **Field configuration** — Set and reset field→category mappings globally or per collection via `qnode fields`
- **Config** — YAML config at `~/.config/qnode/index.yml`; override path via `QNODE_CONFIG_DIR`
