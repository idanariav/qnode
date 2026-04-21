/**
 * Thin convenience layer over the Store for the CLI + MCP.
 * Handles path normalization (absolute, CWD-relative, basename suffix) and
 * bundles together "all edges for a file" for the `get` command.
 */

import { existsSync, readFileSync } from "fs";
import { isAbsolute, resolve } from "path";
import matter from "gray-matter";
import type { Category } from "./categories.js";
import type { EdgeRow, MetricsRow, NodeRow, Store } from "./store.js";

export interface NodeDetail {
  node: NodeRow;
  outgoing: EdgeRow[];
  incoming: EdgeRow[];
  metrics: MetricsRow | null;
}

export function resolveFileArg(store: Store, arg: string): string | null {
  if (isAbsolute(arg) && existsSync(arg)) return resolve(arg);
  const abs = resolve(process.cwd(), arg);
  if (existsSync(abs)) return abs;
  // Fallback: find a node whose stored path ends with the given suffix.
  const node = store.findNodeBySuffix(arg);
  return node?.path ?? null;
}

export function getNodeDetail(store: Store, path: string): NodeDetail | null {
  const node = store.getNode(path);
  if (!node) return null;
  return {
    node,
    outgoing: store.outgoing(path),
    incoming: store.incoming(path),
    metrics: store.getMetrics(path),
  };
}

export function neighbors(
  store: Store,
  path: string,
  opts: { category?: Category; direction?: "in" | "out" | "both" } = {},
): EdgeRow[] {
  const dir = opts.direction ?? "both";
  const cat = opts.category;
  const out: EdgeRow[] = [];
  if (dir === "out" || dir === "both") out.push(...store.outgoing(path, cat));
  if (dir === "in" || dir === "both") out.push(...store.incoming(path, cat));
  return out;
}

export function siblings(
  store: Store,
  path: string,
  sharedMin: number = 1,
): { path: string; shared_parents: number }[] {
  return store.siblings(path, sharedMin);
}

export function distance(
  store: Store,
  a: string,
  b: string,
  maxHops: number = 6,
  includeExternal: boolean = false,
): number | null {
  return store.distance(a, b, maxHops, includeExternal);
}

export function path(
  store: Store,
  a: string,
  b: string,
  maxHops: number = 6,
  includeExternal: boolean = false,
): string[] | null {
  return store.path(a, b, maxHops, includeExternal);
}

export interface DistanceResult {
  path: string;
  distance: number;
  collection: string | null;
  title: string | null;
}

function matchesFileType(filePath: string, fileType: string): boolean {
  try {
    const content = readFileSync(filePath, "utf8");
    const { data } = matter(content);
    const lower = fileType.toLowerCase();
    // Check plain `type` field
    if (typeof data.type === "string" && data.type.toLowerCase() === lower) return true;
    // Check `tags` array — supports both exact match and Obsidian hierarchical tags (e.g. "Type/Claim")
    if (Array.isArray(data.tags)) {
      for (const tag of data.tags) {
        if (typeof tag !== "string") continue;
        const t = tag.toLowerCase();
        if (t === lower || t.endsWith("/" + lower)) return true;
      }
    }
    return false;
  } catch {
    return false;
  }
}

export function findByDistance(
  store: Store,
  filePath: string,
  opts: {
    fileType?: string;
    maxDistance?: number;
    excludeExisting?: boolean;
    includeExternal?: boolean;
  } = {},
): DistanceResult[] {
  const { fileType, maxDistance = 2, excludeExisting = true, includeExternal = false } = opts;

  let results = store.findByDistance(filePath, maxDistance, includeExternal);

  if (excludeExisting) {
    results = results.filter((r) => r.distance > 1);
  }

  if (fileType) {
    results = results.filter((r) => matchesFileType(r.path, fileType));
  }

  return results;
}
