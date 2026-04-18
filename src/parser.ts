/**
 * Markdown → categorized edges.
 *
 * Three-phase parse of a single file:
 *   1. Frontmatter keys (e.g. Topic:) → Up / Down edges.
 *   2. Inline-annotated wikilinks: (Supports:: [[target]]) → Right/Left/In/Out.
 *   3. Residual body wikilinks not consumed by step 2 → Uncategorized.
 */

import matter from "gray-matter";
import type { Category, CategoryFields } from "./categories.js";
import { frontmatterKeyIndex, inlineKeyIndex } from "./categories.js";

export interface ParsedEdge {
  /** Raw wikilink target as written (without the [[ ]] brackets). */
  target: string;
  category: Category;
  /** Which field produced this edge; null for plain wikilinks. */
  fieldKey: string | null;
  /** 1-indexed line number. */
  line: number;
  /** ±80 chars of surrounding text, or the frontmatter key path for YAML edges. */
  context: string;
  alias: string | null;
}

export interface ParsedFile {
  title: string | null;
  edges: ParsedEdge[];
}

const WIKILINK_RE = /\[\[([^\[\]\n]+?)\]\]/g;
/**
 * Matches an inline-annotated wikilink with optional closing paren:
 *   (Supports:: [[target]])
 *   (Supports:: [[target|alias]])
 * Also tolerates no leading paren when followed by the `::` pattern.
 */
const INLINE_ANNOTATION_RE =
  /\(([A-Za-z][A-Za-z_-]*)::\s*\[\[([^\[\]\n]+?)\]\]\s*\)?/g;

const CONTEXT_WINDOW = 80;

function splitAlias(raw: string): { target: string; alias: string | null } {
  const pipe = raw.indexOf("|");
  if (pipe === -1) return { target: raw.trim(), alias: null };
  return { target: raw.slice(0, pipe).trim(), alias: raw.slice(pipe + 1).trim() };
}

function contextAround(text: string, start: number, end: number): string {
  const from = Math.max(0, start - CONTEXT_WINDOW);
  const to = Math.min(text.length, end + CONTEXT_WINDOW);
  return text.slice(from, to).replace(/\s+/g, " ").trim();
}

function lineAt(text: string, offset: number): number {
  let line = 1;
  for (let i = 0; i < offset && i < text.length; i++) {
    if (text.charCodeAt(i) === 10) line++;
  }
  return line;
}

/**
 * Walk frontmatter values recursively and extract every wikilink string found
 * inside string scalars. Yields [keyPath, rawWikilink].
 */
function* frontmatterWikilinks(
  data: unknown,
  keyPath: string[] = [],
): Generator<{ key: string; target: string; alias: string | null; context: string }> {
  if (typeof data === "string") {
    const key = keyPath.join(".");
    const re = /\[\[([^\[\]\n]+?)\]\]/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(data)) !== null) {
      const { target, alias } = splitAlias(m[1]!);
      yield { key, target, alias, context: `frontmatter:${key}` };
    }
  } else if (Array.isArray(data)) {
    for (const item of data) yield* frontmatterWikilinks(item, keyPath);
  } else if (data && typeof data === "object") {
    for (const [k, v] of Object.entries(data as Record<string, unknown>)) {
      yield* frontmatterWikilinks(v, [...keyPath, k]);
    }
  }
}

/**
 * Strip the wikilink target of section/block suffixes for storage as dst_target.
 * We keep the alias separately — it's not part of the target identity.
 */
function normalizeTarget(raw: string): string {
  const base = raw.split("#")[0]!.split("^")[0]!.trim();
  return base;
}

export function parse(
  content: string,
  fields: CategoryFields,
): ParsedFile {
  const parsed = matter(content);
  const fmKeys = frontmatterKeyIndex(fields);
  const inlineKeys = inlineKeyIndex(fields);
  const edges: ParsedEdge[] = [];

  // Phase 1 — frontmatter
  for (const hit of frontmatterWikilinks(parsed.data)) {
    // Match top-level key (or first segment of a nested key path).
    const topKey = hit.key.split(".")[0]!;
    const category = fmKeys.get(topKey);
    if (!category) continue;
    const { target, alias } = splitAlias(hit.target);
    if (!target) continue;
    edges.push({
      target: normalizeTarget(target),
      category,
      fieldKey: topKey,
      line: 1,
      context: hit.context,
      alias,
    });
  }

  // Phase 2 + 3 — body pass. The body starts after the frontmatter block;
  // gray-matter gives us `content` which is exactly the body.
  const body = parsed.content;

  // Track [startOffset, endOffset] of annotated wikilinks so plain-wikilink
  // pass can skip them.
  const consumed: Array<[number, number]> = [];

  INLINE_ANNOTATION_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = INLINE_ANNOTATION_RE.exec(body)) !== null) {
    const fieldKey = m[1]!;
    const category = inlineKeys.get(fieldKey);
    if (!category) continue; // Unknown inline-field key: leave for plain-wikilink pass.
    const rawTarget = m[2]!;
    const { target, alias } = splitAlias(rawTarget);
    if (!target) continue;
    const start = m.index;
    const end = start + m[0].length;
    consumed.push([start, end]);
    edges.push({
      target: normalizeTarget(target),
      category,
      fieldKey,
      line: lineAt(body, start),
      context: contextAround(body, start, end),
      alias,
    });
  }

  // Sort consumed ranges once so we can binary-skip.
  consumed.sort((a, b) => a[0] - b[0]);

  WIKILINK_RE.lastIndex = 0;
  let w: RegExpExecArray | null;
  while ((w = WIKILINK_RE.exec(body)) !== null) {
    const start = w.index;
    const end = start + w[0].length;
    // Skip if fully inside a consumed annotation range.
    const inside = consumed.some(([a, b]) => start >= a && end <= b);
    if (inside) continue;
    const { target, alias } = splitAlias(w[1]!);
    if (!target) continue;
    edges.push({
      target: normalizeTarget(target),
      category: "Uncategorized",
      fieldKey: null,
      line: lineAt(body, start),
      context: contextAround(body, start, end),
      alias,
    });
  }

  // Title fallback: first ATX heading in body, else frontmatter title.
  let title: string | null = null;
  const h1 = /^#\s+(.+)$/m.exec(body);
  if (h1) title = h1[1]!.trim();
  else if (typeof (parsed.data as { title?: unknown }).title === "string") {
    title = (parsed.data as { title: string }).title.trim();
  }

  return { title, edges };
}
