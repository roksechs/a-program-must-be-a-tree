// Motif detection: named structural shapes in the graph, as an alternative
// to inspecting one declaration at a time (selection) or one pair at a time
// (paths.js). Each detector returns `{ nodes: Set, edges: Set }` over
// `graph.activeLinks` — the same edges currently drawn, springing and
// counted, so a switched-off edge kind is invisible to a motif too,
// consistent with the panel's "one switch drives drawing, springs and
// diagnostics together" rule extending here as well.

/** Every node in a nontrivial cycle (its own SCC has more than one member, or a self-loop) and every edge that stays inside one. `computeHeights` (model.js) must already have run — it sets `n.scc`. */
export function cycleMotif(graph) {
  const nodes = new Set();
  const bySCC = new Map();
  for (const n of graph.nodes) {
    if (!n.inCycle) continue;
    nodes.add(n);
    let list = bySCC.get(n.scc);
    if (!list) bySCC.set(n.scc, (list = []));
    list.push(n);
  }
  const edges = new Set();
  for (const l of graph.activeLinks) {
    if (nodes.has(l.source) && nodes.has(l.target) && (l.source === l.target || l.source.scc === l.target.scc)) edges.add(l);
  }
  return { nodes, edges };
}

/**
 * A node whose in-degree or out-degree (over active edges only, not the
 * whole-graph `inDegree`/`outDegree` model.js already tracks) stands out
 * from the rest of the graph: at or above both a fixed floor (so a small or
 * sparse graph doesn't call every node a hub) and a percentile of every
 * other degree in it. Its incident active edges are included too, so the
 * hub reads as a little star rather than a bare dot.
 */
export function hubMotif(graph, { percentile = 0.9, minDegree = 4 } = {}) {
  const degree = new Map();
  for (const n of graph.nodes) degree.set(n, 0);
  for (const l of graph.activeLinks) {
    if (l.source !== l.target) {
      degree.set(l.source, (degree.get(l.source) ?? 0) + 1);
      degree.set(l.target, (degree.get(l.target) ?? 0) + 1);
    }
  }
  const sorted = [...degree.values()].sort((a, b) => a - b);
  const threshold = Math.max(minDegree, sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * percentile))] ?? 0);
  const nodes = new Set([...degree].filter(([, d]) => d >= threshold).map(([n]) => n));
  const edges = new Set(graph.activeLinks.filter((l) => nodes.has(l.source) || nodes.has(l.target)));
  return { nodes, edges };
}

/**
 * A -> B, A -> C, B -> D, C -> D (B != C): two distinct 2-hop routes from
 * one node to another. Found by counting, for every node A, how many of its
 * out-neighbours' out-neighbours land on the same node D; two or more means
 * a diamond from A to D through whichever B/C pairs achieved it.
 */
export function diamondMotif(graph) {
  const outNeighbours = new Map();
  const edgeByPair = new Map(); // "sourceIndex>targetIndex" -> the edge, for O(1) lookup below
  for (const l of graph.activeLinks) {
    if (l.source === l.target) continue;
    let set = outNeighbours.get(l.source);
    if (!set) outNeighbours.set(l.source, (set = new Set()));
    set.add(l.target);
    edgeByPair.set(`${l.source.index}>${l.target.index}`, l);
  }
  const nodes = new Set();
  const edges = new Set();
  for (const [a, bs] of outNeighbours) {
    const viaCount = new Map(); // D -> [B, C, ...] reaching it
    for (const b of bs) {
      for (const d of outNeighbours.get(b) ?? []) {
        if (d === a) continue;
        let via = viaCount.get(d);
        if (!via) viaCount.set(d, (via = []));
        via.push(b);
      }
    }
    for (const [d, via] of viaCount) {
      if (via.length < 2) continue;
      nodes.add(a).add(d);
      for (const b of via) {
        nodes.add(b);
        edges.add(edgeByPair.get(`${a.index}>${b.index}`));
        edges.add(edgeByPair.get(`${b.index}>${d.index}`));
      }
    }
  }
  return { nodes, edges };
}

/**
 * A maximal run of declarations connected one-to-the-next with nothing else
 * attached along the way (every node strictly inside the run has exactly
 * one active in-edge and one active out-edge) — a linear pipeline, the
 * shape a tree-likeness score never penalizes since nothing forks or
 * merges. `minLength` counts nodes, not edges (a 2-node run is just one
 * ordinary edge and not worth calling out as its own shape).
 */
export function chainMotif(graph, { minLength = 4 } = {}) {
  const outEdge = new Map(); // node -> its one active out-edge, if in-degree/out-degree are both 1
  const inDegree = new Map();
  const outDegree = new Map();
  for (const n of graph.nodes) {
    inDegree.set(n, 0);
    outDegree.set(n, 0);
  }
  for (const l of graph.activeLinks) {
    if (l.source === l.target) continue;
    outDegree.set(l.source, (outDegree.get(l.source) ?? 0) + 1);
    inDegree.set(l.target, (inDegree.get(l.target) ?? 0) + 1);
  }
  for (const l of graph.activeLinks) {
    if (l.source !== l.target && outDegree.get(l.source) === 1) outEdge.set(l.source, l);
  }
  const isPassThrough = (n) => inDegree.get(n) === 1 && outDegree.get(n) === 1;
  const nodes = new Set();
  const edges = new Set();
  const visitedStart = new Set();
  for (const n of graph.nodes) {
    if (isPassThrough(n) || !outEdge.has(n) || visitedStart.has(n)) continue; // only start a run from a real start, not its middle
    const run = [n];
    let cur = n;
    while (isPassThrough(outEdge.get(cur)?.target) && outEdge.has(outEdge.get(cur).target)) {
      const next = outEdge.get(cur).target;
      run.push(next);
      cur = next;
    }
    if (outEdge.has(cur)) run.push(outEdge.get(cur).target); // the run's own final, non-pass-through target
    if (run.length >= minLength) {
      for (const r of run) {
        nodes.add(r);
        visitedStart.add(r);
      }
      for (let i = 0; i < run.length - 1; i++) edges.add(outEdge.get(run[i]));
    }
  }
  return { nodes, edges };
}

export const MOTIF_KINDS = ["cycle", "hub", "diamond", "chain"];

export const MOTIF_DETECTORS = {
  cycle: cycleMotif,
  hub: hubMotif,
  diamond: diamondMotif,
  chain: chainMotif,
};

export const MOTIF_COLORS = {
  cycle: "#dc2626",
  hub: "#9333ea",
  diamond: "#f59e0b",
  chain: "#0d9488",
};
