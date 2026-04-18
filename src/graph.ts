/**
 * Thin convenience layer over the Store for the CLI + MCP.
 * Handles path normalization (absolute, CWD-relative, basename suffix) and
 * bundles together "all edges for a file" for the `get` command.
 */

import { existsSync } from "fs";
import { isAbsolute, resolve } from "path";
import type { Category } from "./categories.js";
import type { EdgeRow, NodeRow, Store } from "./store.js";

export interface NodeDetail {
  node: NodeRow;
  outgoing: EdgeRow[];
  incoming: EdgeRow[];
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
