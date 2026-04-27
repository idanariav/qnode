/**
 * Markdown → categorized edges.
 *
 * Three-phase parse of a single file:
 *   1. Frontmatter keys (e.g. Topic:) → Up / Down edges.
 *   2. Inline-annotated wikilinks: (Supports:: [[target]]) → Right/Left/In/Out.
 *   3. Residual body wikilinks not consumed by step 2 → Uncategorized.
 *
 * Body parsing uses remark-parse with micromark extensions for [[wikilinks]]
 * and (Key:: [[value]]) inline fields, so code spans and code blocks are
 * automatically excluded from link extraction.
 */

import matter from "gray-matter";
import { unified } from "unified";
import remarkParse from "remark-parse";
import { visit } from "unist-util-visit";
import type { Root } from "mdast";
import type { Category, CategoryFields } from "./categories.js";
import { frontmatterKeyIndex, inlineKeyIndex } from "./categories.js";
import {
  wikilinkSyntax,
  wikilinkFromMarkdown,
  inlineFieldSyntax,
  inlineFieldFromMarkdown,
  type WikilinkNode,
  type InlineFieldNode,
} from "./remark-extensions.js";

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

const CONTEXT_WINDOW = 80;

// Build the processor once and reuse it.
// remark-parse reads micromark/mdast extensions from the processor data store.
const processor = unified().use(remarkParse);
processor.data("micromarkExtensions", [wikilinkSyntax, inlineFieldSyntax]);
processor.data("fromMarkdownExtensions", [wikilinkFromMarkdown, inlineFieldFromMarkdown]);

function splitAlias(raw: string): { target: string; alias: string | null } {
  const pipe = raw.indexOf("|");
  if (pipe === -1) return { target: raw.trim(), alias: null };
  return { target: raw.slice(0, pipe).trim(), alias: raw.slice(pipe + 1).trim() };
}

function contextAround(text: string, startOffset: number, endOffset: number): string {
  const from = Math.max(0, startOffset - CONTEXT_WINDOW);
  const to = Math.min(text.length, endOffset + CONTEXT_WINDOW);
  return text.slice(from, to).replace(/\s+/g, " ").trim();
}

/**
 * Strip section/block suffixes from a wikilink target.
 */
function normalizeTarget(raw: string): string {
  return raw.split("#")[0]!.split("^")[0]!.trim();
}

/**
 * Walk frontmatter values recursively and extract every wikilink string found
 * inside string scalars. Frontmatter is already parsed YAML so we apply the
 * wikilink pattern only to clean string values, not raw markdown.
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

  // Phase 2 + 3 — body (parsed with remark + micromark extensions)
  const body = parsed.content;
  const tree = processor.parse(body) as Root;

  // Phase 2: inline field annotations → categorized edges.
  // The inline field tokenizer handles [[...]] internally, so those wikilinks
  // do NOT appear as separate `wikilink` nodes — no double-counting needed.
  visit(tree, "inlineField", (node) => {
    const fieldNode = node as unknown as InlineFieldNode;
    const target = normalizeTarget(fieldNode.target);
    if (!target) return;

    const startOffset = fieldNode.position?.start.offset ?? 0;
    const endOffset = fieldNode.position?.end.offset ?? 0;
    const category = inlineKeys.get(fieldNode.key);

    edges.push({
      target,
      category: category ?? "Uncategorized",
      fieldKey: category ? fieldNode.key : null,
      line: fieldNode.position?.start.line ?? 1,
      context: contextAround(body, startOffset, endOffset),
      alias: fieldNode.alias,
    });
  });

  // Phase 3: plain wikilinks → Uncategorized edges.
  visit(tree, "wikilink", (node) => {
    const wlNode = node as unknown as WikilinkNode;
    const target = normalizeTarget(wlNode.target);
    if (!target) return;

    const startOffset = wlNode.position?.start.offset ?? 0;
    const endOffset = wlNode.position?.end.offset ?? 0;

    edges.push({
      target,
      category: "Uncategorized",
      fieldKey: null,
      line: wlNode.position?.start.line ?? 1,
      context: contextAround(body, startOffset, endOffset),
      alias: wlNode.alias,
    });
  });

  // Title: first H1 in body, else frontmatter title field.
  let title: string | null = null;
  const h1 = /^#\s+(.+)$/m.exec(body);
  if (h1) title = h1[1]!.trim();
  else if (typeof (parsed.data as { title?: unknown }).title === "string") {
    title = (parsed.data as { title: string }).title.trim();
  }

  return { title, edges };
}
