/**
 * Link categories and field mappings.
 *
 * Every edge is classified into one of 7 categories. The mapping from
 * frontmatter keys / inline-annotation keys to a category is config-driven,
 * so users can re-label fields without touching code.
 */

export type Category =
  | "Up"
  | "Down"
  | "Right"
  | "Left"
  | "In"
  | "Out"
  | "Uncategorized";

export const ALL_CATEGORIES: readonly Category[] = [
  "Up",
  "Down",
  "Right",
  "Left",
  "In",
  "Out",
  "Uncategorized",
] as const;

export function isCategory(s: string): s is Category {
  return (ALL_CATEGORIES as readonly string[]).includes(s);
}

export interface CategoryFields {
  up_frontmatter: string[];
  down_frontmatter: string[];
  right_inline: string[];
  left_inline: string[];
  in_inline: string[];
  out_inline: string[];
}

export const DEFAULT_CATEGORY_FIELDS: CategoryFields = {
  up_frontmatter: ["Topic"],
  down_frontmatter: ["Down"],
  right_inline: ["Supports", "Supported"],
  left_inline: ["Opposes", "Weakens"],
  in_inline: ["Jump"],
  out_inline: ["Related", "Reminds", "Aka"],
};

/**
 * Build a case-sensitive lookup from inline-field keys to categories.
 * Later entries win on conflict, matching YAML-merge semantics.
 */
export function inlineKeyIndex(fields: CategoryFields): Map<string, Category> {
  const m = new Map<string, Category>();
  for (const k of fields.right_inline) m.set(k, "Right");
  for (const k of fields.left_inline) m.set(k, "Left");
  for (const k of fields.in_inline) m.set(k, "In");
  for (const k of fields.out_inline) m.set(k, "Out");
  return m;
}

export function frontmatterKeyIndex(fields: CategoryFields): Map<string, Category> {
  const m = new Map<string, Category>();
  for (const k of fields.up_frontmatter) m.set(k, "Up");
  for (const k of fields.down_frontmatter) m.set(k, "Down");
  return m;
}

/** Merge user overrides over defaults. Arrays replace rather than concatenate. */
export function resolveCategoryFields(
  overrides?: Partial<CategoryFields>,
): CategoryFields {
  return {
    up_frontmatter: overrides?.up_frontmatter ?? DEFAULT_CATEGORY_FIELDS.up_frontmatter,
    down_frontmatter: overrides?.down_frontmatter ?? DEFAULT_CATEGORY_FIELDS.down_frontmatter,
    right_inline: overrides?.right_inline ?? DEFAULT_CATEGORY_FIELDS.right_inline,
    left_inline: overrides?.left_inline ?? DEFAULT_CATEGORY_FIELDS.left_inline,
    in_inline: overrides?.in_inline ?? DEFAULT_CATEGORY_FIELDS.in_inline,
    out_inline: overrides?.out_inline ?? DEFAULT_CATEGORY_FIELDS.out_inline,
  };
}
