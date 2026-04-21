import { describe, expect, it, beforeEach } from "vitest";
import { Store } from "../src/store.js";
import { computeMetrics } from "../src/metrics.js";
import { getNodeDetail } from "../src/graph.js";
import type { NewEdge } from "../src/store.js";

/**
 * Hand-drawn graph (7 in-collection nodes + 1 external):
 *
 *   A → L  (Up)
 *   B → L  (Up)
 *   A → C  (Up)
 *   A → D  (Right)   ← A is a hub
 *   E → A  (Left)    ← E opposes A
 *   F → G  (Right)   ← isolated component
 *   /ext/X.md         ← external (collection=null), must be excluded
 *
 * Undirected adjacency:
 *   A: {L, C, D, E}
 *   B: {L}
 *   L: {A, B}
 *   C: {A}
 *   D: {A}
 *   E: {A}
 *   F: {G}
 *   G: {F}
 */

function edge(src: string, dst: string, cat = "Up"): NewEdge {
  return {
    src_path: src,
    dst_target: dst.replace("/v/", ""),
    dst_path: dst,
    category: cat as NewEdge["category"],
    field_key: null,
    line: 1,
    context: null,
    alias: null,
  };
}

function setup(): Store {
  const store = new Store(":memory:");
  const now = Date.now();
  store.upsertCollection({ name: "v", path: "/v", pattern: "**/*.md", vault_root: "/v" });

  const inColl = ["/v/A.md", "/v/B.md", "/v/C.md", "/v/D.md", "/v/E.md", "/v/F.md", "/v/G.md"];
  for (const p of inColl) {
    store.upsertNode({ path: p, collection: "v", title: null, mtime: now, indexed_at: now });
  }
  // External node — must be excluded from metrics
  store.upsertNode({ path: "/ext/X.md", collection: null, title: null, mtime: now, indexed_at: now });

  store.insertEdges([
    edge("/v/A.md", "/v/L.md", "Up"),   // L is not in-collection so this edge is dropped
    edge("/v/A.md", "/v/C.md", "Up"),
    edge("/v/A.md", "/v/D.md", "Right"),
    edge("/v/B.md", "/v/C.md", "Up"),   // B→C makes C a shared parent of A and B
    edge("/v/E.md", "/v/A.md", "Left"),
    edge("/v/F.md", "/v/G.md", "Right"),
    // Edge to external node — must be ignored
    edge("/v/A.md", "/ext/X.md", "Out"),
  ]);

  return store;
}

/**
 * Simpler graph where we can verify triangle counts for clustering coefficient:
 *
 *   A → B, A → C, B → C (so A, B, C form a triangle)
 *   D is isolated
 */
function setupTriangle(): Store {
  const store = new Store(":memory:");
  const now = Date.now();
  store.upsertCollection({ name: "v", path: "/v", pattern: "**/*.md", vault_root: "/v" });
  for (const p of ["/v/A.md", "/v/B.md", "/v/C.md", "/v/D.md"]) {
    store.upsertNode({ path: p, collection: "v", title: null, mtime: now, indexed_at: now });
  }
  store.insertEdges([
    edge("/v/A.md", "/v/B.md", "Right"),
    edge("/v/A.md", "/v/C.md", "Right"),
    edge("/v/B.md", "/v/C.md", "Right"),
  ]);
  return store;
}

describe("computeMetrics — basic graph", () => {
  let store: Store;
  beforeEach(() => {
    store = setup();
  });

  it("returns only in-collection nodes", () => {
    const rows = computeMetrics(store);
    const paths = rows.map((r) => r.path).sort();
    expect(paths).toEqual(["/v/A.md", "/v/B.md", "/v/C.md", "/v/D.md", "/v/E.md", "/v/F.md", "/v/G.md"].sort());
    expect(paths).not.toContain("/ext/X.md");
  });

  it("scopes to a single collection", () => {
    // Add a second collection with its own node
    const now = Date.now();
    store.upsertCollection({ name: "other", path: "/other", pattern: "**/*.md", vault_root: null });
    store.upsertNode({ path: "/other/Z.md", collection: "other", title: null, mtime: now, indexed_at: now });
    const rows = computeMetrics(store, "v");
    expect(rows.every((r) => r.path.startsWith("/v/"))).toBe(true);
  });

  it("in_degree counts distinct resolved sources (no external edges)", () => {
    const rows = computeMetrics(store);
    const byPath = new Map(rows.map((r) => [r.path, r]));
    // A is targeted by E only (A→L edge goes to non-collection, A→C is outgoing)
    expect(byPath.get("/v/A.md")?.in_degree).toBe(1); // E → A
    // C is targeted by A and B
    expect(byPath.get("/v/C.md")?.in_degree).toBe(2);
    // D targeted by A only
    expect(byPath.get("/v/D.md")?.in_degree).toBe(1);
    // F and G each have 1 (F→G)
    expect(byPath.get("/v/G.md")?.in_degree).toBe(1);
    expect(byPath.get("/v/F.md")?.in_degree).toBe(0);
  });

  it("out_degree counts distinct resolved destinations (no external edges)", () => {
    const rows = computeMetrics(store);
    const byPath = new Map(rows.map((r) => [r.path, r]));
    // A → C, D (L and X are filtered out)
    expect(byPath.get("/v/A.md")?.out_degree).toBe(2);
    // B → C
    expect(byPath.get("/v/B.md")?.out_degree).toBe(1);
    // E → A
    expect(byPath.get("/v/E.md")?.out_degree).toBe(1);
    // C, D have no out edges
    expect(byPath.get("/v/C.md")?.out_degree).toBe(0);
    expect(byPath.get("/v/D.md")?.out_degree).toBe(0);
  });

  it("pagerank sums to approximately 1", () => {
    const rows = computeMetrics(store);
    const total = rows.reduce((s, r) => s + r.pagerank, 0);
    expect(total).toBeCloseTo(1.0, 5);
  });

  it("pagerank: nodes with more in-links rank higher", () => {
    const rows = computeMetrics(store);
    const byPath = new Map(rows.map((r) => [r.path, r]));
    // C has 2 in-links (A, B); D has 1 in-link (A)
    const prC = byPath.get("/v/C.md")?.pagerank ?? 0;
    const prD = byPath.get("/v/D.md")?.pagerank ?? 0;
    expect(prC).toBeGreaterThan(prD);
  });

  it("betweenness: A is a bridge and has higher betweenness than B", () => {
    const rows = computeMetrics(store);
    const byPath = new Map(rows.map((r) => [r.path, r]));
    const bcA = byPath.get("/v/A.md")?.betweenness ?? 0;
    const bcB = byPath.get("/v/B.md")?.betweenness ?? 0;
    expect(bcA).toBeGreaterThan(bcB);
  });

  it("betweenness: isolated component F-G has zero betweenness each", () => {
    const rows = computeMetrics(store);
    const byPath = new Map(rows.map((r) => [r.path, r]));
    expect(byPath.get("/v/F.md")?.betweenness).toBe(0);
    expect(byPath.get("/v/G.md")?.betweenness).toBe(0);
  });

  it("clustering: no triangles → cc = 0 for all nodes in basic graph", () => {
    const rows = computeMetrics(store);
    for (const r of rows) {
      expect(r.clustering_coeff).toBe(0);
    }
  });

  it("community: F and G are in a different community from the main cluster", () => {
    const rows = computeMetrics(store);
    const byPath = new Map(rows.map((r) => [r.path, r]));
    const commA = byPath.get("/v/A.md")?.community;
    const commF = byPath.get("/v/F.md")?.community;
    const commG = byPath.get("/v/G.md")?.community;
    expect(commF).toBe(commG); // F and G same component
    expect(commF).not.toBe(commA); // different from main cluster
  });

  it("community IDs are non-negative integers", () => {
    const rows = computeMetrics(store);
    for (const r of rows) {
      expect(r.community).toBeGreaterThanOrEqual(0);
      expect(Number.isInteger(r.community)).toBe(true);
    }
  });
});

describe("computeMetrics — triangle graph (clustering)", () => {
  it("clustering coefficient is 1 for all triangle nodes", () => {
    const store = setupTriangle();
    const rows = computeMetrics(store);
    const byPath = new Map(rows.map((r) => [r.path, r]));
    // In a complete undirected triangle, every node's neighbors are connected
    expect(byPath.get("/v/A.md")?.clustering_coeff).toBeCloseTo(1, 5);
    expect(byPath.get("/v/B.md")?.clustering_coeff).toBeCloseTo(1, 5);
    expect(byPath.get("/v/C.md")?.clustering_coeff).toBeCloseTo(1, 5);
    // D is isolated, cc = 0
    expect(byPath.get("/v/D.md")?.clustering_coeff).toBe(0);
  });
});

describe("Store metrics persistence", () => {
  it("upsert → getMetrics round-trip", () => {
    const store = new Store(":memory:");
    const now = Date.now();
    const row = {
      path: "/v/A.md",
      in_degree: 2,
      out_degree: 3,
      pagerank: 0.5,
      betweenness: 1.2,
      clustering_coeff: 0.33,
      community: 0,
      computed_at: now,
    };
    store.upsertMetrics([row]);
    const got = store.getMetrics("/v/A.md");
    expect(got).not.toBeNull();
    expect(got?.in_degree).toBe(2);
    expect(got?.pagerank).toBeCloseTo(0.5, 5);
    expect(got?.community).toBe(0);
  });

  it("allMetrics returns all persisted rows", () => {
    const store = new Store(":memory:");
    const now = Date.now();
    store.upsertCollection({ name: "v", path: "/v", pattern: "**/*.md", vault_root: null });
    store.upsertNode({ path: "/v/A.md", collection: "v", title: null, mtime: now, indexed_at: now });
    store.upsertNode({ path: "/v/B.md", collection: "v", title: null, mtime: now, indexed_at: now });
    store.upsertMetrics([
      { path: "/v/A.md", in_degree: 0, out_degree: 1, pagerank: 0.6, betweenness: 0, clustering_coeff: 0, community: 0, computed_at: now },
      { path: "/v/B.md", in_degree: 1, out_degree: 0, pagerank: 0.4, betweenness: 0, clustering_coeff: 0, community: 0, computed_at: now },
    ]);
    const all = store.allMetrics();
    expect(all.length).toBe(2);
    // Ordered by pagerank DESC
    expect(all[0]?.path).toBe("/v/A.md");
  });

  it("clearMetrics removes all rows", () => {
    const store = new Store(":memory:");
    const now = Date.now();
    store.upsertMetrics([
      { path: "/v/A.md", in_degree: 0, out_degree: 0, pagerank: 0, betweenness: 0, clustering_coeff: 0, community: 0, computed_at: now },
    ]);
    store.clearMetrics();
    expect(store.getMetrics("/v/A.md")).toBeNull();
  });

  it("clearMetrics with collection removes only that collection's rows", () => {
    const store = new Store(":memory:");
    const now = Date.now();
    store.upsertCollection({ name: "v", path: "/v", pattern: "**/*.md", vault_root: null });
    store.upsertCollection({ name: "w", path: "/w", pattern: "**/*.md", vault_root: null });
    store.upsertNode({ path: "/v/A.md", collection: "v", title: null, mtime: now, indexed_at: now });
    store.upsertNode({ path: "/w/B.md", collection: "w", title: null, mtime: now, indexed_at: now });
    store.upsertMetrics([
      { path: "/v/A.md", in_degree: 0, out_degree: 0, pagerank: 0, betweenness: 0, clustering_coeff: 0, community: 0, computed_at: now },
      { path: "/w/B.md", in_degree: 0, out_degree: 0, pagerank: 0, betweenness: 0, clustering_coeff: 0, community: 0, computed_at: now },
    ]);
    store.clearMetrics("v");
    expect(store.getMetrics("/v/A.md")).toBeNull();
    expect(store.getMetrics("/w/B.md")).not.toBeNull();
  });
});

describe("getNodeDetail includes metrics", () => {
  it("returns null metrics when not yet computed", () => {
    const store = setup();
    const d = getNodeDetail(store, "/v/A.md");
    expect(d).not.toBeNull();
    expect(d?.metrics).toBeNull();
  });

  it("returns metrics after upsert", () => {
    const store = setup();
    const now = Date.now();
    store.upsertMetrics([
      { path: "/v/A.md", in_degree: 1, out_degree: 2, pagerank: 0.42, betweenness: 3.1, clustering_coeff: 0, community: 0, computed_at: now },
    ]);
    const d = getNodeDetail(store, "/v/A.md");
    expect(d?.metrics?.pagerank).toBeCloseTo(0.42, 5);
    expect(d?.metrics?.in_degree).toBe(1);
  });
});
