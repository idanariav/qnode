/**
 * Indexer: walk a collection (and its vault_root for cross-folder resolution),
 * parse every markdown file, upsert nodes and edges.
 *
 * Scope semantics:
 *   - Files inside `collection.path` → nodes with collection = <name>.
 *   - Files inside `vault_root` but outside `collection.path` → walked so
 *     their outgoing edges into the collection can be captured. Stored as
 *     nodes with collection = NULL ("external endpoints").
 *   - Files outside `vault_root` are invisible.
 *
 * Edges are always wiped and re-derived per file, keyed by src_path.
 */

import fg from "fast-glob";
import { existsSync, readFileSync } from "fs";
import { createHash } from "crypto";
import { resolve, sep } from "path";
import type { NamedCollection } from "./collections.js";
import type { CategoryFields } from "./categories.js";
import { Store, fileMtime, type NewEdge } from "./store.js";
import { parse } from "./parser.js";
import { buildIndex, resolveTarget, type ResolverIndex } from "./resolver.js";

export interface IndexReport {
  collection: string;
  scanned: number;
  in_collection: number;
  external: number;
  edges: number;
  resolved: number;
  unresolved: number;
  relinked: number;
  /** Files whose mtime and category-field config were unchanged since last index — reparsing was skipped. */
  skipped: number;
  /** In-collection nodes removed because their file no longer exists on disk. */
  deleted: number;
  /** External nodes (from any collection) removed because their file no longer exists on disk. */
  external_deleted: number;
}

/** Stable hash of the resolved CategoryFields — a change forces a full reparse. */
function hashFields(fields: CategoryFields): string {
  return createHash("sha256").update(JSON.stringify(fields)).digest("hex");
}

function isUnder(file: string, dir: string): boolean {
  const f = resolve(file);
  const d = resolve(dir);
  return f === d || f.startsWith(d + sep);
}

async function collectMarkdownFiles(root: string, pattern: string, ignore?: string[]): Promise<string[]> {
  const matches = await fg(pattern, {
    cwd: root,
    ignore,
    absolute: true,
    onlyFiles: true,
    suppressErrors: true,
  });
  return matches;
}

export async function indexCollection(
  store: Store,
  col: NamedCollection,
  fields: CategoryFields,
  log?: (msg: string) => void,
  options?: { force?: boolean },
): Promise<IndexReport> {
  const report: IndexReport = {
    collection: col.name,
    scanned: 0,
    in_collection: 0,
    external: 0,
    edges: 0,
    resolved: 0,
    unresolved: 0,
    relinked: 0,
    skipped: 0,
    deleted: 0,
    external_deleted: 0,
  };
  log?.(`[${col.name}] scanning ${col.path}...`);
  const colAbs = resolve(col.path);
  const scanRoot = col.vault_root ? resolve(col.vault_root) : colAbs;

  // 1. Build filesystem index once for resolution.
  const allFiles = await collectMarkdownFiles(scanRoot, col.pattern || "**/*.md", col.ignore);
  const resolverIdx: ResolverIndex = buildIndex(allFiles, scanRoot);
  log?.(`[${col.name}] found ${allFiles.length} markdown files under ${scanRoot}`);

  // A change to field→category mappings can change a file's edges even
  // when its content (and thus mtime) hasn't changed, so it forces a full
  // reparse of the collection regardless of per-file mtime comparisons.
  const fieldsHash = hashFields(fields);
  const existingCol = store.getCollectionRow(col.name);
  const configChanged = (options?.force ?? false) || !existingCol || existingCol.fields_hash !== fieldsHash;

  // 2. Register the collection in the DB.
  store.upsertCollection({
    name: col.name,
    path: colAbs,
    pattern: col.pattern || "**/*.md",
    vault_root: col.vault_root ? resolve(col.vault_root) : null,
    fields_hash: fieldsHash,
  });

  const now = Date.now();

  // Skip re-parsing a file whose on-disk mtime and collection slot match
  // what's already stored, unless the config change above forces a reparse.
  // `expectedCollection` is the collection name for in-collection files, or
  // null for external files (which are only ever stored once they resolve
  // into the collection — see the external pass below).
  function shouldSkip(file: string, expectedCollection: string | null): boolean {
    if (configChanged) return false;
    const existing = store.getNode(file);
    if (!existing) return false;
    if (existing.collection !== expectedCollection) return false;
    if (existing.mtime !== fileMtime(file)) return false;
    return true;
  }

  function countExistingEdges(file: string): void {
    const rows = store.outgoing(file);
    report.edges += rows.length;
    for (const r of rows) {
      if (r.dst_path !== null) report.resolved++;
      else report.unresolved++;
    }
  }

  // 3. First pass: parse in-collection files, record outgoing edges.
  // External files (inside vault_root but outside colAbs) are parsed only
  // if they contain wikilinks resolving into the collection — we detect
  // that in a second pass to avoid double I/O.
  const inCollection: string[] = [];
  const external: string[] = [];
  for (const f of allFiles) {
    if (isUnder(f, colAbs)) inCollection.push(f);
    else external.push(f);
  }

  // 3a. Parse in-collection.
  for (const f of inCollection) {
    if (shouldSkip(f, col.name)) {
      countExistingEdges(f);
      report.in_collection++;
      report.skipped++;
      report.scanned++;
      continue;
    }
    try {
      const { edgesInserted, title } = parseAndWrite(store, f, fields, resolverIdx, col.name);
      store.upsertNode({
        path: f,
        collection: col.name,
        title,
        mtime: fileMtime(f),
        indexed_at: now,
      });
      report.in_collection++;
      report.edges += edgesInserted.total;
      report.resolved += edgesInserted.resolved;
      report.unresolved += edgesInserted.unresolved;
    } catch (e) {
      log?.(`[${col.name}] skip ${f}: ${(e as Error).message}`);
    }
    report.scanned++;
  }

  // 3b. Parse external files but only keep edges whose resolved destination
  // is an in-collection node. We also register such external files as nodes
  // (collection = NULL) so they can appear as endpoints in queries. A file
  // with no existing node has never been seen touching this collection, so
  // it's always parsed — only previously-touching externals can be skipped.
  for (const f of external) {
    if (shouldSkip(f, null)) {
      countExistingEdges(f);
      report.external++;
      report.skipped++;
      report.scanned++;
      continue;
    }
    try {
      const { edgesInserted, title, touchesCollection } = parseAndWrite(
        store,
        f,
        fields,
        resolverIdx,
        null,
        colAbs,
      );
      if (touchesCollection) {
        store.upsertNode({
          path: f,
          collection: null,
          title,
          mtime: fileMtime(f),
          indexed_at: now,
        });
        report.external++;
        report.edges += edgesInserted.total;
        report.resolved += edgesInserted.resolved;
        report.unresolved += edgesInserted.unresolved;
      }
    } catch (e) {
      log?.(`[${col.name}] skip ${f}: ${(e as Error).message}`);
    }
    report.scanned++;
  }

  // 4. Post-pass: try to relink any still-unresolved edges whose basename
  //    now has a unique match.
  const basenameIdx = new Map<string, string[]>();
  for (const [k, v] of resolverIdx.byBasename) basenameIdx.set(k, v);
  report.relinked = store.relinkUnresolved(basenameIdx);

  // 5. Remove in-collection nodes whose file no longer exists on disk.
  const currentPaths = new Set(inCollection);
  for (const p of store.loadInCollectionNodes(col.name)) {
    if (!currentPaths.has(p)) {
      store.deleteNode(p);
      report.deleted++;
    }
  }

  // 6. Remove external nodes (across all collections, not just this one)
  // whose file no longer exists on disk. A node's path is always absolute,
  // so existence on disk is a global fact — no collection could ever
  // rediscover a file that's gone, regardless of which collection's
  // vault_root previously found it.
  for (const p of store.loadExternalNodes()) {
    if (!existsSync(p)) {
      store.deleteNode(p);
      report.external_deleted++;
    }
  }

  log?.(
    `[${col.name}] ${report.scanned} scanned, ${report.in_collection} in-collection, ` +
      `${report.external} external-with-inbound, ${report.edges} edges ` +
      `(${report.resolved} resolved, ${report.unresolved} unresolved, ${report.relinked} relinked, ` +
      `${report.skipped} skipped, ${report.deleted} deleted, ${report.external_deleted} external deleted)`,
  );
  return report;
}

function parseAndWrite(
  store: Store,
  file: string,
  fields: CategoryFields,
  resolverIdx: ResolverIndex,
  collectionName: string | null,
  collectionAbsFilter?: string,
): {
  edgesInserted: { total: number; resolved: number; unresolved: number };
  title: string | null;
  touchesCollection: boolean;
} {
  const content = readFileSync(file, "utf-8");
  const parsed = parse(content, fields);
  store.clearEdgesFrom(file);

  const edges: NewEdge[] = [];
  let resolvedCount = 0;
  let unresolvedCount = 0;
  let touches = collectionName !== null;

  for (const e of parsed.edges) {
    const dst = resolveTarget(e.target, resolverIdx);
    if (dst) resolvedCount++;
    else unresolvedCount++;

    if (collectionAbsFilter) {
      if (!dst || !(dst === collectionAbsFilter || dst.startsWith(collectionAbsFilter + sep))) {
        continue; // external file with edge not pointing into collection — drop
      }
      touches = true;
    }

    edges.push({
      src_path: file,
      dst_target: e.target,
      dst_path: dst,
      category: e.category,
      field_key: e.fieldKey,
      line: e.line,
      context: e.context,
      alias: e.alias,
    });
  }
  store.insertEdges(edges);
  return {
    edgesInserted: { total: edges.length, resolved: resolvedCount, unresolved: unresolvedCount },
    title: parsed.title,
    touchesCollection: touches,
  };
}
