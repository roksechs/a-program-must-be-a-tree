// Diagnostics: how tree-like is the call graph?
import { connectedComponentCount, stronglyConnectedComponents } from "./model.js";

/**
 * Compute tree-likeness metrics for a graph. All ratios are in [0, 1] where 1
 * means "perfectly tree-like" for that criterion.
 *
 * - treeScore: (n - c) / m. A forest has exactly n - c edges, so this is 1 for
 *   a forest and decreases as extra (cross/back) edges are added.
 * - acyclicity: fraction of nodes that are not part of any cycle.
 * - singleCallerRatio: fraction of nodes with at most one caller. In a tree every
 *   node has exactly one parent.
 * - dagness: 1 - (edges inside non-trivial SCCs, plus self loops) / m.
 */
export function computeMetrics(graph) {
  const { nodes, links } = graph;
  const n = nodes.length;
  const m = links.length;
  const components = n > 0 ? connectedComponentCount(nodes, links) : 0;
  const { comp, compCount } = stronglyConnectedComponents(nodes, links);

  const sccSize = new Int32Array(compCount);
  for (let i = 0; i < n; i++) sccSize[comp[i]]++;
  let nontrivialSccs = 0;
  let nodesInCycles = 0;
  for (let c = 0; c < compCount; c++) {
    if (sccSize[c] > 1) {
      nontrivialSccs++;
      nodesInCycles += sccSize[c];
    }
  }
  let selfLoops = 0;
  let cycleEdges = 0;
  const selfLoopNodes = new Set();
  for (const l of links) {
    if (l.source === l.target) {
      selfLoops++;
      cycleEdges++;
      selfLoopNodes.add(l.source.index);
    } else if (comp[l.source.index] === comp[l.target.index]) {
      cycleEdges++;
    }
  }
  // A self loop makes its node part of a cycle even though its SCC is trivial.
  for (const i of selfLoopNodes) if (sccSize[comp[i]] === 1) nodesInCycles++;

  const multiCallers = nodes.filter((x) => x.inDegree > 1).length;
  const roots = nodes.filter((x) => x.inDegree === 0).length;
  const leaves = nodes.filter((x) => x.outDegree === 0).length;
  const maxHeight = nodes.reduce((h, x) => Math.max(h, x.height), 0);
  const surplusEdges = Math.max(0, m - (n - components));

  const treeScore = m === 0 ? 1 : Math.min(1, (n - components) / m);
  const acyclicity = n === 0 ? 1 : 1 - nodesInCycles / n;
  const singleCallerRatio = n === 0 ? 1 : 1 - multiCallers / n;
  const dagness = m === 0 ? 1 : 1 - cycleEdges / m;
  const overall = (treeScore + acyclicity + singleCallerRatio + dagness) / 4;

  return {
    nodes: n,
    edges: m,
    components,
    roots,
    leaves,
    maxHeight,
    surplusEdges,
    nontrivialSccs,
    selfLoops,
    nodesInCycles,
    multiCallers,
    treeScore,
    acyclicity,
    singleCallerRatio,
    dagness,
    overall,
    dropped: graph.dropped ?? 0,
  };
}

/** Nodes with the most callers: the usual suspects when a graph is not a tree. */
export function topSharedNodes(graph, limit = 8) {
  return [...graph.nodes]
    .filter((n) => n.inDegree > 1)
    .sort((a, b) => b.inDegree - a.inDegree || a.name.localeCompare(b.name))
    .slice(0, limit);
}
