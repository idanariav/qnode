/**
 * Wikilink → absolute file-path resolution.
 *
 * Obsidian's shortest-path convention: a bare basename [[foo]] resolves to
 * any file named foo.md anywhere in the vault, as long as the match is
 * unambiguous. We support exact paths, unique basename, and case-insensitive
 * basename in that order. Ambiguous or missing targets return null.
 */

import { basename, resolve, sep } from "path";

export interface ResolverIndex {
  /** Lower-case basename (without .md) → list of absolute paths. */
  byBasename: Map<string, string[]>;
  /** Exact relative path (lower-case, without .md) → absolute path. */
  byRelpath: Map<string, string>;
  /** The root all relative paths are computed against. */
  root: string;
}

/**
 * Build an index from a flat list of absolute markdown file paths.
 */
export function buildIndex(files: string[], root: string): ResolverIndex {
  const byBasename = new Map<string, string[]>();
  const byRelpath = new Map<string, string>();
  const absRoot = resolve(root);
  for (const f of files) {
    const abs = resolve(f);
    const b = basename(abs).replace(/\.md$/i, "").toLowerCase();
    const list = byBasename.get(b);
    if (list) list.push(abs);
    else byBasename.set(b, [abs]);

    if (abs.startsWith(absRoot + sep) || abs === absRoot) {
      const rel = abs.slice(absRoot.length + 1).replace(/\.md$/i, "").toLowerCase();
      byRelpath.set(rel, abs);
    }
  }
  return { byBasename, byRelpath, root: absRoot };
}

/**
 * Parse a wikilink target string like "folder/Name#section|alias" into parts.
 */
export function parseTarget(target: string): {
  path: string;
  section: string | null;
  block: string | null;
  alias: string | null;
} {
  let rest = target;
  let alias: string | null = null;
  const pipe = rest.indexOf("|");
  if (pipe !== -1) {
    alias = rest.slice(pipe + 1).trim();
    rest = rest.slice(0, pipe);
  }
  let block: string | null = null;
  const caret = rest.indexOf("^");
  if (caret !== -1) {
    block = rest.slice(caret + 1).trim();
    rest = rest.slice(0, caret);
  }
  let section: string | null = null;
  const hash = rest.indexOf("#");
  if (hash !== -1) {
    section = rest.slice(hash + 1).trim();
    rest = rest.slice(0, hash);
  }
  return { path: rest.trim(), section, block, alias };
}

/**
 * Resolve a wikilink target to an absolute path. Returns null if missing
 * or ambiguous.
 */
export function resolveTarget(target: string, idx: ResolverIndex): string | null {
  const { path } = parseTarget(target);
  if (!path) return null;
  const norm = path.toLowerCase().replace(/\.md$/i, "").replace(/\\/g, "/");
  const exact = idx.byRelpath.get(norm);
  if (exact) return exact;
  const base = norm.split("/").pop() ?? norm;
  const candidates = idx.byBasename.get(base);
  if (candidates && candidates.length === 1) return candidates[0]!;
  return null;
}
