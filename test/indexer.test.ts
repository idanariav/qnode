import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, utimesSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { Store } from "../src/store.js";
import { indexCollection } from "../src/indexer.js";
import { DEFAULT_CATEGORY_FIELDS } from "../src/categories.js";
import type { NamedCollection } from "../src/collections.js";

let dir: string;
let store: Store;
let col: NamedCollection;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "qnode-indexer-"));
  store = new Store(":memory:");
  col = { name: "t", path: dir, pattern: "**/*.md" };
});

afterEach(() => {
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

function write(name: string, content: string, mtime?: Date) {
  const p = join(dir, name);
  writeFileSync(p, content, "utf-8");
  if (mtime) utimesSync(p, mtime, mtime);
  return p;
}

describe("indexCollection — incremental indexing", () => {
  it("re-running with no changes skips every file", async () => {
    write("A.md", "# A\n\n[[B]]\n");
    write("B.md", "# B\n");
    await indexCollection(store, col, DEFAULT_CATEGORY_FIELDS);
    const second = await indexCollection(store, col, DEFAULT_CATEGORY_FIELDS);
    expect(second.skipped).toBe(2);
    expect(second.in_collection).toBe(2);
  });

  it("reparses a file whose content and mtime changed, but skips the untouched one", async () => {
    write("A.md", "# A\n\n[[B]]\n");
    write("B.md", "# B\n");
    await indexCollection(store, col, DEFAULT_CATEGORY_FIELDS);

    const future = new Date(Date.now() + 60_000);
    write("A.md", "# A\n\n[[B]]\n[[C]]\n", future);
    write("C.md", "# C\n", future);

    const second = await indexCollection(store, col, DEFAULT_CATEGORY_FIELDS);
    expect(second.skipped).toBe(1); // only B.md unchanged
    expect(second.in_collection).toBe(3);
    const edgesFromA = store.outgoing(join(dir, "A.md"));
    expect(edgesFromA).toHaveLength(2);
  });

  it("forces a full reparse when the category-fields config changes", async () => {
    write("A.md", "---\nTopic: \"[[B]]\"\n---\n# A\n");
    write("B.md", "# B\n");
    await indexCollection(store, col, DEFAULT_CATEGORY_FIELDS);

    const changedFields = { ...DEFAULT_CATEGORY_FIELDS, up_frontmatter: [] };
    const second = await indexCollection(store, col, changedFields);
    expect(second.skipped).toBe(0);
  });

  it("--force bypasses the skip logic", async () => {
    write("A.md", "# A\n");
    await indexCollection(store, col, DEFAULT_CATEGORY_FIELDS);
    const second = await indexCollection(store, col, DEFAULT_CATEGORY_FIELDS, undefined, { force: true });
    expect(second.skipped).toBe(0);
  });

  it("removes the node for a file deleted from disk", async () => {
    write("A.md", "# A\n");
    write("B.md", "# B\n");
    await indexCollection(store, col, DEFAULT_CATEGORY_FIELDS);
    rmSync(join(dir, "B.md"));

    const second = await indexCollection(store, col, DEFAULT_CATEGORY_FIELDS);
    expect(second.deleted).toBe(1);
    expect(store.getNode(join(dir, "B.md"))).toBeNull();
  });

  it("unresolves (rather than drops) a skipped file's edge to a deleted node", async () => {
    write("A.md", "# A\n\n[[B]]\n");
    write("B.md", "# B\n");
    await indexCollection(store, col, DEFAULT_CATEGORY_FIELDS);
    expect(store.outgoing(join(dir, "A.md"))[0]!.dst_path).toBe(join(dir, "B.md"));

    // A.md is untouched, so the next run skips reparsing it — its stale
    // A→B edge should only be fixed up via deleteNode()'s inbound-edge sweep.
    rmSync(join(dir, "B.md"));
    const second = await indexCollection(store, col, DEFAULT_CATEGORY_FIELDS);
    expect(second.skipped).toBe(1); // A.md
    expect(second.deleted).toBe(1); // B.md's node

    const edgesFromA = store.outgoing(join(dir, "A.md"));
    expect(edgesFromA).toHaveLength(1);
    expect(edgesFromA[0]!.dst_path).toBeNull();
  });
});
