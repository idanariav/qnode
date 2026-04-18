/**
 * SQLite store for qnode.
 *
 * Tables:
 *   collections     registered vaults/folders with optional category overrides
 *   nodes           one row per indexed file (in-collection or external endpoint)
 *   edges           one row per (src_path, dst_target, category, line) tuple
 *
 * The schema is optimized for graph traversal: src/dst indexes support fast
 * neighbor lookups, and recursive CTEs work directly over the edges table.
 */

import Database from "better-sqlite3";
import { existsSync, mkdirSync, statSync } from "fs";
import { dirname, join } from "path";
import { homedir } from "os";
import type { Category } from "./categories.js";

export interface CollectionRow {
  name: string;
  path: string;
  pattern: string;
  vault_root: string | null;
  updated_at: number;
}

export interface NodeRow {
  path: string;
  collection: string | null;
  title: string | null;
  mtime: number;
  indexed_at: number;
}

export interface EdgeRow {
  id: number;
  src_path: string;
  dst_target: string;
  dst_path: string | null;
  category: Category;
  field_key: string | null;
  line: number | null;
  context: string | null;
  alias: string | null;
}

export interface NewEdge {
  src_path: string;
  dst_target: string;
  dst_path: string | null;
  category: Category;
  field_key: string | null;
  line: number | null;
  context: string | null;
  alias: string | null;
}

function getCacheDir(): string {
  if (process.env.QNODE_CACHE_DIR) return process.env.QNODE_CACHE_DIR;
  if (process.env.XDG_CACHE_HOME) return join(process.env.XDG_CACHE_HOME, "qnode");
  return join(homedir(), ".cache", "qnode");
}

export function getDefaultDbPath(): string {
  return join(getCacheDir(), "index.sqlite");
}

export function fileMtime(path: string): number {
  return Math.floor(statSync(path).mtimeMs);
}

export class Store {
  db: Database.Database;

  constructor(dbPath: string = getDefaultDbPath()) {
    if (dbPath !== ":memory:") {
      const dir = dirname(dbPath);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    }
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.migrate();
  }

  close(): void {
    this.db.close();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS collections (
        name TEXT PRIMARY KEY,
        path TEXT NOT NULL,
        pattern TEXT NOT NULL,
        vault_root TEXT,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS nodes (
        path TEXT PRIMARY KEY,
        collection TEXT,
        title TEXT,
        mtime INTEGER NOT NULL,
        indexed_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_nodes_collection ON nodes(collection);

      CREATE TABLE IF NOT EXISTS edges (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        src_path TEXT NOT NULL,
        dst_target TEXT NOT NULL,
        dst_path TEXT,
        category TEXT NOT NULL,
        field_key TEXT,
        line INTEGER,
        context TEXT,
        alias TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_edges_src ON edges(src_path, category);
      CREATE INDEX IF NOT EXISTS idx_edges_dst ON edges(dst_path, category);
      CREATE INDEX IF NOT EXISTS idx_edges_dst_target ON edges(dst_target);
    `);
  }

  // -------- Collections --------

  upsertCollection(row: Omit<CollectionRow, "updated_at">): void {
    this.db
      .prepare(
        `INSERT INTO collections (name, path, pattern, vault_root, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(name) DO UPDATE SET
           path = excluded.path,
           pattern = excluded.pattern,
           vault_root = excluded.vault_root,
           updated_at = excluded.updated_at`,
      )
      .run(row.name, row.path, row.pattern, row.vault_root, Date.now());
  }

  // -------- Nodes --------

  upsertNode(row: NodeRow): void {
    this.db
      .prepare(
        `INSERT INTO nodes (path, collection, title, mtime, indexed_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(path) DO UPDATE SET
           collection = excluded.collection,
           title = excluded.title,
           mtime = excluded.mtime,
           indexed_at = excluded.indexed_at`,
      )
      .run(row.path, row.collection, row.title, row.mtime, row.indexed_at);
  }

  getNode(path: string): NodeRow | null {
    const row = this.db
      .prepare(`SELECT path, collection, title, mtime, indexed_at FROM nodes WHERE path = ?`)
      .get(path) as NodeRow | undefined;
    return row ?? null;
  }

  /** Find a node whose absolute path ends with the given suffix (forgiving lookup). */
  findNodeBySuffix(suffix: string): NodeRow | null {
    const row = this.db
      .prepare(
        `SELECT path, collection, title, mtime, indexed_at FROM nodes
         WHERE path = ? OR path LIKE '%/' || ?
         ORDER BY length(path) ASC LIMIT 1`,
      )
      .get(suffix, suffix) as NodeRow | undefined;
    return row ?? null;
  }

  // -------- Edges --------

  /** Wipe all outgoing edges from a given file before re-inserting fresh ones. */
  clearEdgesFrom(src: string): void {
    this.db.prepare(`DELETE FROM edges WHERE src_path = ?`).run(src);
  }

  insertEdges(edges: NewEdge[]): void {
    if (edges.length === 0) return;
    const stmt = this.db.prepare(
      `INSERT INTO edges (src_path, dst_target, dst_path, category, field_key, line, context, alias)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const txn = this.db.transaction((rows: NewEdge[]) => {
      for (const e of rows) {
        stmt.run(
          e.src_path,
          e.dst_target,
          e.dst_path,
          e.category,
          e.field_key,
          e.line,
          e.context,
          e.alias,
        );
      }
    });
    txn(edges);
  }

  /**
   * Re-resolve any edges whose dst_path is NULL but whose dst_target now
   * matches a node. Useful after a full index pass when later-walked files
   * could not be resolved yet.
   */
  relinkUnresolved(basenameIndex: Map<string, string[]>): number {
    const unresolved = this.db
      .prepare(`SELECT id, dst_target FROM edges WHERE dst_path IS NULL`)
      .all() as { id: number; dst_target: string }[];
    const update = this.db.prepare(`UPDATE edges SET dst_path = ? WHERE id = ?`);
    let fixed = 0;
    const txn = this.db.transaction(() => {
      for (const row of unresolved) {
        const base = row.dst_target.split("#")[0]!.split("^")[0]!.split("|")[0]!.trim();
        const candidates = basenameIndex.get(base.toLowerCase());
        if (candidates && candidates.length === 1) {
          update.run(candidates[0], row.id);
          fixed++;
        }
      }
    });
    txn();
    return fixed;
  }

  outgoing(src: string, category?: Category): EdgeRow[] {
    if (category) {
      return this.db
        .prepare(
          `SELECT id, src_path, dst_target, dst_path, category, field_key, line, context, alias
           FROM edges WHERE src_path = ? AND category = ?`,
        )
        .all(src, category) as EdgeRow[];
    }
    return this.db
      .prepare(
        `SELECT id, src_path, dst_target, dst_path, category, field_key, line, context, alias
         FROM edges WHERE src_path = ?`,
      )
      .all(src) as EdgeRow[];
  }

  incoming(dst: string, category?: Category): EdgeRow[] {
    if (category) {
      return this.db
        .prepare(
          `SELECT id, src_path, dst_target, dst_path, category, field_key, line, context, alias
           FROM edges WHERE dst_path = ? AND category = ?`,
        )
        .all(dst, category) as EdgeRow[];
    }
    return this.db
      .prepare(
        `SELECT id, src_path, dst_target, dst_path, category, field_key, line, context, alias
         FROM edges WHERE dst_path = ?`,
      )
      .all(dst) as EdgeRow[];
  }

  // -------- Stats --------

  status(collection?: string): {
    nodes: number;
    external_nodes: number;
    edges: number;
    by_category: Record<string, number>;
    by_collection: { name: string; nodes: number }[];
  } {
    const nodesStmt = collection
      ? this.db.prepare(`SELECT COUNT(*) AS n FROM nodes WHERE collection = ?`)
      : this.db.prepare(`SELECT COUNT(*) AS n FROM nodes WHERE collection IS NOT NULL`);
    const nodes = (
      (collection ? nodesStmt.get(collection) : nodesStmt.get()) as { n: number }
    ).n;
    const externalNodes = (
      this.db.prepare(`SELECT COUNT(*) AS n FROM nodes WHERE collection IS NULL`).get() as {
        n: number;
      }
    ).n;
    const edges = (
      (collection
        ? this.db
            .prepare(
              `SELECT COUNT(*) AS n FROM edges e
               JOIN nodes n ON n.path = e.src_path
               WHERE n.collection = ?`,
            )
            .get(collection)
        : this.db.prepare(`SELECT COUNT(*) AS n FROM edges`).get()) as { n: number }
    ).n;

    const catRows = (
      collection
        ? this.db
            .prepare(
              `SELECT e.category AS category, COUNT(*) AS n
               FROM edges e JOIN nodes n ON n.path = e.src_path
               WHERE n.collection = ?
               GROUP BY e.category`,
            )
            .all(collection)
        : this.db
            .prepare(`SELECT category, COUNT(*) AS n FROM edges GROUP BY category`)
            .all()
    ) as { category: string; n: number }[];
    const by_category: Record<string, number> = {};
    for (const r of catRows) by_category[r.category] = r.n;

    const colRows = this.db
      .prepare(
        `SELECT collection AS name, COUNT(*) AS nodes FROM nodes
         WHERE collection IS NOT NULL GROUP BY collection`,
      )
      .all() as { name: string; nodes: number }[];

    return { nodes, external_nodes: externalNodes, edges, by_category, by_collection: colRows };
  }

  // -------- Graph queries --------

  /** Files that share ≥ sharedMin Up parents with the given file. */
  siblings(file: string, sharedMin: number = 1): { path: string; shared_parents: number }[] {
    return this.db
      .prepare(
        `SELECT b.src_path AS path, COUNT(*) AS shared_parents
         FROM edges a JOIN edges b ON a.dst_path = b.dst_path
         WHERE a.src_path = ?
           AND a.category = 'Up' AND b.category = 'Up'
           AND a.dst_path IS NOT NULL
           AND b.src_path != ?
         GROUP BY b.src_path
         HAVING shared_parents >= ?
         ORDER BY shared_parents DESC, b.src_path ASC`,
      )
      .all(file, file, sharedMin) as { path: string; shared_parents: number }[];
  }

  /**
   * BFS distance between two nodes (undirected). Returns null if no path
   * is found within maxHops. Delegates to `path()` to avoid two BFS impls.
   */
  distance(
    start: string,
    end: string,
    maxHops: number = 6,
    includeExternal: boolean = false,
  ): number | null {
    if (start === end) return 0;
    const p = this.path(start, end, maxHops, includeExternal);
    return p ? p.length - 1 : null;
  }

  /**
   * Shortest path between two nodes, computed with a JS-side BFS. We load
   * adjacency lazily one node at a time to avoid materializing the full graph.
   * Recursive CTEs are a poor fit here — with per-trail state they explode,
   * and without per-trail state you can't reconstruct the route.
   */
  path(
    start: string,
    end: string,
    maxHops: number = 6,
    includeExternal: boolean = false,
  ): string[] | null {
    if (start === end) return [start];

    const neighborStmt = includeExternal
      ? this.db.prepare(
          `SELECT DISTINCT other FROM (
             SELECT dst_path AS other FROM edges WHERE src_path = ? AND dst_path IS NOT NULL
             UNION
             SELECT src_path AS other FROM edges WHERE dst_path = ?
           ) WHERE other IS NOT NULL`,
        )
      : this.db.prepare(
          `SELECT DISTINCT other FROM (
             SELECT dst_path AS other FROM edges WHERE src_path = ? AND dst_path IS NOT NULL
             UNION
             SELECT src_path AS other FROM edges WHERE dst_path = ?
           ) WHERE other IS NOT NULL
             AND EXISTS (SELECT 1 FROM nodes n WHERE n.path = other AND n.collection IS NOT NULL)`,
        );

    const parent = new Map<string, string | null>();
    parent.set(start, null);
    let frontier: string[] = [start];
    for (let depth = 0; depth < maxHops; depth++) {
      const next: string[] = [];
      for (const node of frontier) {
        const rows = neighborStmt.all(node, node) as { other: string }[];
        for (const r of rows) {
          if (parent.has(r.other)) continue;
          parent.set(r.other, node);
          if (r.other === end) {
            const route: string[] = [];
            let cur: string | null = end;
            while (cur !== null) {
              route.push(cur);
              cur = parent.get(cur) ?? null;
            }
            return route.reverse();
          }
          next.push(r.other);
        }
      }
      if (next.length === 0) break;
      frontier = next;
    }
    return null;
  }
}
