import { DirectedGraph, UndirectedGraph } from "graphology";
import * as louvainPkg from "graphology-communities-louvain";
import * as pagerankPkg from "graphology-metrics/centrality/pagerank.js";
import * as betweennessPkg from "graphology-metrics/centrality/betweenness.js";
import type { MetricsRow, Store } from "./store.js";

interface GraphData {
  nodes: string[];
  adjOut: Map<string, string[]>; // directed: src → distinct dsts
  adjIn: Map<string, string[]>;  // directed: dst → distinct srcs
  adjUnd: Map<string, string[]>; // undirected union (no self-loops)
}

function loadGraph(store: Store, collection?: string): GraphData {
  const nodes = store.loadInCollectionNodes(collection);
  const nodeSet = new Set(nodes);

  const adjOutSets = new Map<string, Set<string>>();
  const adjInSets = new Map<string, Set<string>>();
  for (const n of nodes) {
    adjOutSets.set(n, new Set());
    adjInSets.set(n, new Set());
  }

  const edges = store.loadResolvedEdges(collection);
  for (const { src, dst } of edges) {
    if (!nodeSet.has(src) || !nodeSet.has(dst)) continue;
    adjOutSets.get(src)!.add(dst);
    adjInSets.get(dst)!.add(src);
  }

  const adjOut = new Map<string, string[]>();
  const adjIn = new Map<string, string[]>();
  const adjUndSets = new Map<string, Set<string>>();
  for (const n of nodes) {
    const out = [...(adjOutSets.get(n) ?? [])];
    const inn = [...(adjInSets.get(n) ?? [])];
    adjOut.set(n, out);
    adjIn.set(n, inn);
    const undSet = new Set([...out, ...inn]);
    undSet.delete(n);
    adjUndSets.set(n, undSet);
  }

  const adjUnd = new Map<string, string[]>();
  for (const [n, s] of adjUndSets) adjUnd.set(n, [...s]);

  return { nodes, adjOut, adjIn, adjUnd };
}

function buildUndirectedGraph(graph: GraphData): UndirectedGraph {
  const g = new UndirectedGraph({ multi: false });
  for (const n of graph.nodes) g.addNode(n);
  for (const [src, dsts] of graph.adjUnd) {
    for (const dst of dsts) {
      if (!g.hasEdge(src, dst)) g.addEdge(src, dst);
    }
  }
  return g;
}

function computePageRank(graph: GraphData): Map<string, number> {
  if (graph.nodes.length === 0) return new Map();

  const g = new DirectedGraph();
  for (const n of graph.nodes) g.addNode(n);
  for (const [src, dsts] of graph.adjOut) {
    for (const dst of dsts) {
      if (!g.hasEdge(src, dst)) g.addEdge(src, dst);
    }
  }

  const pagerank = pagerankPkg.default as unknown as (
    g: DirectedGraph,
    opts: { getEdgeWeight: null },
  ) => Record<string, number>;
  const result = pagerank(g, { getEdgeWeight: null });
  return new Map(Object.entries(result));
}

function computeBetweenness(g: UndirectedGraph): Map<string, number> {
  const betweennessCentrality = betweennessPkg.default as unknown as (
    g: UndirectedGraph,
    opts: { getEdgeWeight: null; normalized: boolean },
  ) => Record<string, number>;
  // normalized: false to match Brandes' raw values (undirected pairs
  // counted once, via the library's built-in ÷2 for undirected graphs).
  const result = betweennessCentrality(g, { getEdgeWeight: null, normalized: false });
  return new Map(Object.entries(result));
}

function computeClustering(graph: GraphData): Map<string, number> {
  const { nodes, adjUnd } = graph;
  const cc = new Map<string, number>();

  for (const n of nodes) {
    const neighbors = adjUnd.get(n) ?? [];
    const k = neighbors.length;
    if (k < 2) {
      cc.set(n, 0);
      continue;
    }
    const nbrSet = new Set(neighbors);
    let links = 0;
    for (const u of neighbors) {
      for (const w of adjUnd.get(u) ?? []) {
        if (nbrSet.has(w) && w !== n) links++;
      }
    }
    // Each undirected edge counted twice
    cc.set(n, links / (k * (k - 1)));
  }

  return cc;
}

function computeCommunity(g: UndirectedGraph): Map<string, number> {
  if (g.order === 0) return new Map();

  const louvain = louvainPkg.default as unknown as (g: UndirectedGraph, opts: { getEdgeWeight: null }) => Record<string, number>;
  const partition = louvain(g, { getEdgeWeight: null });
  return new Map(Object.entries(partition));
}

export function computeMetrics(store: Store, collection?: string): MetricsRow[] {
  const graph = loadGraph(store, collection);
  if (graph.nodes.length === 0) return [];

  const undirected = buildUndirectedGraph(graph);

  const pr = computePageRank(graph);
  const bc = computeBetweenness(undirected);
  const cc = computeClustering(graph);
  const comm = computeCommunity(undirected);

  const now = Date.now();
  return graph.nodes.map((path) => ({
    path,
    in_degree: graph.adjIn.get(path)?.length ?? 0,
    out_degree: graph.adjOut.get(path)?.length ?? 0,
    pagerank: pr.get(path) ?? 0,
    betweenness: bc.get(path) ?? 0,
    clustering_coeff: cc.get(path) ?? 0,
    community: comm.get(path) ?? 0,
    computed_at: now,
  }));
}
