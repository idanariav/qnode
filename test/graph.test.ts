import { describe, expect, it, beforeEach } from "vitest";
import { Store } from "../src/store.js";

/**
 * Hand-drawn graph:
 *
 *   concept/L  ←── up ── claim/A
 *   concept/L  ←── up ── claim/B    (so A and B are siblings under L)
 *   concept/C  ←── up ── claim/A    (A also under C)
 *   claim/A  ── right ──→ claim/D   (D is supported by A)
 *   claim/E  ── left  ──→ claim/A   (E opposes A)
 *
 * Distance checks:
 *   dist(A, B) = 2 (A → L ← B via Up edges)
 *   dist(A, D) = 1 (direct Right edge)
 *   dist(E, D) = 2 (E → A → D)
 */

function setup(): Store {
  const store = new Store(":memory:");
  const now = Date.now();
  const nodes = [
    { path: "/v/claim/A.md", collection: "v" },
    { path: "/v/claim/B.md", collection: "v" },
    { path: "/v/claim/D.md", collection: "v" },
    { path: "/v/claim/E.md", collection: "v" },
    { path: "/v/concept/L.md", collection: "v" },
    { path: "/v/concept/C.md", collection: "v" },
    { path: "/ext/outside.md", collection: null },
  ];
  store.upsertCollection({ name: "v", path: "/v", pattern: "**/*.md", vault_root: "/v" });
  for (const n of nodes) {
    store.upsertNode({ path: n.path, collection: n.collection, title: null, mtime: now, indexed_at: now });
  }
  store.insertEdges([
    {
      src_path: "/v/claim/A.md",
      dst_target: "L",
      dst_path: "/v/concept/L.md",
      category: "Up",
      field_key: "Topic",
      line: 1,
      context: "frontmatter:Topic",
      alias: null,
    },
    {
      src_path: "/v/claim/B.md",
      dst_target: "L",
      dst_path: "/v/concept/L.md",
      category: "Up",
      field_key: "Topic",
      line: 1,
      context: "frontmatter:Topic",
      alias: null,
    },
    {
      src_path: "/v/claim/A.md",
      dst_target: "C",
      dst_path: "/v/concept/C.md",
      category: "Up",
      field_key: "Topic",
      line: 1,
      context: "frontmatter:Topic",
      alias: null,
    },
    {
      src_path: "/v/claim/A.md",
      dst_target: "D",
      dst_path: "/v/claim/D.md",
      category: "Right",
      field_key: "Supports",
      line: 5,
      context: "...",
      alias: null,
    },
    {
      src_path: "/v/claim/E.md",
      dst_target: "A",
      dst_path: "/v/claim/A.md",
      category: "Left",
      field_key: "Opposes",
      line: 3,
      context: "...",
      alias: null,
    },
  ]);
  return store;
}

describe("siblings", () => {
  let store: Store;
  beforeEach(() => {
    store = setup();
  });

  it("B is a sibling of A under L", () => {
    const sibs = store.siblings("/v/claim/A.md");
    expect(sibs).toEqual([{ path: "/v/claim/B.md", shared_parents: 1 }]);
  });

  it("excludes the file itself", () => {
    const sibs = store.siblings("/v/claim/A.md");
    expect(sibs.find((s) => s.path === "/v/claim/A.md")).toBeUndefined();
  });

  it("respects shared_min", () => {
    expect(store.siblings("/v/claim/A.md", 2)).toEqual([]);
  });
});

describe("incoming/outgoing", () => {
  let store: Store;
  beforeEach(() => {
    store = setup();
  });

  it("finds supporters (incoming Right)", () => {
    const inEdges = store.incoming("/v/claim/D.md", "Right");
    expect(inEdges).toHaveLength(1);
    expect(inEdges[0]!.src_path).toBe("/v/claim/A.md");
  });

  it("finds opposers (incoming Left)", () => {
    const inEdges = store.incoming("/v/claim/A.md", "Left");
    expect(inEdges).toHaveLength(1);
    expect(inEdges[0]!.src_path).toBe("/v/claim/E.md");
  });
});

describe("distance", () => {
  let store: Store;
  beforeEach(() => {
    store = setup();
  });

  it("zero for same node", () => {
    expect(store.distance("/v/claim/A.md", "/v/claim/A.md")).toBe(0);
  });

  it("A → D direct", () => {
    expect(store.distance("/v/claim/A.md", "/v/claim/D.md")).toBe(1);
  });

  it("A ↔ B via L", () => {
    expect(store.distance("/v/claim/A.md", "/v/claim/B.md")).toBe(2);
  });

  it("E → D via A", () => {
    expect(store.distance("/v/claim/E.md", "/v/claim/D.md")).toBe(2);
  });

  it("returns null when maxHops too low", () => {
    expect(store.distance("/v/claim/E.md", "/v/claim/D.md", 1)).toBeNull();
  });
});

describe("path", () => {
  let store: Store;
  beforeEach(() => {
    store = setup();
  });

  it("returns the route A → L → B", () => {
    const p = store.path("/v/claim/A.md", "/v/claim/B.md");
    expect(p).not.toBeNull();
    expect(p!.length).toBe(3);
    expect(p![0]).toBe("/v/claim/A.md");
    expect(p![p!.length - 1]).toBe("/v/claim/B.md");
    expect(p).toContain("/v/concept/L.md");
  });

  it("returns single-step A → D", () => {
    expect(store.path("/v/claim/A.md", "/v/claim/D.md")).toEqual([
      "/v/claim/A.md",
      "/v/claim/D.md",
    ]);
  });
});
