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

function computePageRank(graph: GraphData, damping = 0.85, maxIter = 100, epsilon = 1e-6): Map<string, number> {
  const { nodes, adjOut, adjIn } = graph;
  const N = nodes.length;
  if (N === 0) return new Map();

  const pr = new Map<string, number>();
  for (const n of nodes) pr.set(n, 1 / N);

  const outDeg = new Map<string, number>();
  for (const n of nodes) outDeg.set(n, adjOut.get(n)?.length ?? 0);

  for (let iter = 0; iter < maxIter; iter++) {
    const danglingSum = nodes.reduce((sum, n) => {
      return outDeg.get(n) === 0 ? sum + (pr.get(n) ?? 0) : sum;
    }, 0);
    const base = (1 - damping) / N + damping * danglingSum / N;

    let delta = 0;
    const newPr = new Map<string, number>();
    for (const n of nodes) {
      const srcs = adjIn.get(n) ?? [];
      let rank = base;
      for (const src of srcs) {
        const deg = outDeg.get(src) ?? 0;
        if (deg > 0) rank += damping * (pr.get(src) ?? 0) / deg;
      }
      newPr.set(n, rank);
      delta += Math.abs(rank - (pr.get(n) ?? 0));
    }
    for (const [n, v] of newPr) pr.set(n, v);
    if (delta < epsilon) break;
  }

  // Normalize
  const total = nodes.reduce((s, n) => s + (pr.get(n) ?? 0), 0);
  if (total > 0) for (const n of nodes) pr.set(n, (pr.get(n) ?? 0) / total);

  return pr;
}

function computeBetweenness(graph: GraphData): Map<string, number> {
  const { nodes, adjUnd } = graph;
  const bc = new Map<string, number>();
  for (const n of nodes) bc.set(n, 0);

  for (const s of nodes) {
    const stack: string[] = [];
    const pred = new Map<string, string[]>();
    const sigma = new Map<string, number>();
    const dist = new Map<string, number>();
    for (const n of nodes) {
      pred.set(n, []);
      sigma.set(n, 0);
      dist.set(n, -1);
    }
    sigma.set(s, 1);
    dist.set(s, 0);

    const queue: string[] = [s];
    let qi = 0;
    while (qi < queue.length) {
      const v = queue[qi++]!;
      stack.push(v);
      const dv = dist.get(v) ?? 0;
      const sv = sigma.get(v) ?? 0;
      for (const w of adjUnd.get(v) ?? []) {
        if ((dist.get(w) ?? -1) < 0) {
          queue.push(w);
          dist.set(w, dv + 1);
        }
        if ((dist.get(w) ?? 0) === dv + 1) {
          sigma.set(w, (sigma.get(w) ?? 0) + sv);
          pred.get(w)!.push(v);
        }
      }
    }

    const delta = new Map<string, number>();
    for (const n of nodes) delta.set(n, 0);
    while (stack.length > 0) {
      const w = stack.pop()!;
      const sw = sigma.get(w) ?? 1;
      const dw = delta.get(w) ?? 0;
      for (const v of pred.get(w) ?? []) {
        const sv = sigma.get(v) ?? 0;
        delta.set(v, (delta.get(v) ?? 0) + (sv / sw) * (1 + dw));
      }
      if (w !== s) bc.set(w, (bc.get(w) ?? 0) + dw);
    }
  }

  // Undirected: each pair counted twice
  for (const n of nodes) bc.set(n, (bc.get(n) ?? 0) / 2);
  return bc;
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

function computeCommunity(graph: GraphData, maxIter = 50): Map<string, number> {
  const { nodes, adjUnd } = graph;
  if (nodes.length === 0) return new Map();

  // Initialize: each node gets its index as label
  const label = new Map<string, number>();
  nodes.forEach((n, i) => label.set(n, i));

  // Deterministic order (sorted) to avoid non-determinism
  const order = [...nodes].sort();

  for (let iter = 0; iter < maxIter; iter++) {
    let stable = true;
    for (const n of order) {
      const neighbors = adjUnd.get(n) ?? [];
      if (neighbors.length === 0) continue;

      // Count neighbor label frequencies
      const freq = new Map<number, number>();
      for (const nb of neighbors) {
        const l = label.get(nb) ?? 0;
        freq.set(l, (freq.get(l) ?? 0) + 1);
      }

      // Find most frequent label (ties broken by lowest label value)
      let bestLabel = label.get(n) ?? 0;
      let bestCount = 0;
      for (const [l, count] of freq) {
        if (count > bestCount || (count === bestCount && l < bestLabel)) {
          bestLabel = l;
          bestCount = count;
        }
      }

      if (bestLabel !== (label.get(n) ?? 0)) {
        label.set(n, bestLabel);
        stable = false;
      }
    }
    if (stable) break;
  }

  // Re-index to dense 0-based integers
  const unique = [...new Set(label.values())].sort((a, b) => a - b);
  const remap = new Map<number, number>();
  unique.forEach((l, i) => remap.set(l, i));

  const community = new Map<string, number>();
  for (const n of nodes) {
    community.set(n, remap.get(label.get(n) ?? 0) ?? 0);
  }
  return community;
}

export function computeMetrics(store: Store, collection?: string): MetricsRow[] {
  const graph = loadGraph(store, collection);
  if (graph.nodes.length === 0) return [];

  const pr = computePageRank(graph);
  const bc = computeBetweenness(graph);
  const cc = computeClustering(graph);
  const comm = computeCommunity(graph);

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
