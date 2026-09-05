// Diagnostics: how tree-like is the call graph?
import { connectedComponentCount, stronglyConnectedComponents } from "./model.js";
import { dominatorTree } from "./dominance.js";

/**
 * Dominator tree of the active graph, memoised per link set (see dominance.js).
 */
export function dominance(graph) {
  const links = graph.activeLinks ?? graph.links;
  if (graph.dominanceCache?.links !== links) {
    graph.dominanceCache = { links, value: dominatorTree(graph.nodes, links) };
  }
  return graph.dominanceCache.value;
}

/**
 * Where a declaration would live if the program were a tree: the nodes of its
 * immediate dominator component, or null when its natural scope is the top
 * level. `lift` is how many scopes it had to be hoisted out of its deepest
 * caller (0 = it already sits in its only caller).
 */
export function naturalScope(graph, node) {
  const dom = dominance(graph);
  const parent = dom.idom[dom.comp[node.index]];
  const links = graph.activeLinks ?? graph.links;
  let lift = 0;
  for (let i = 0; i < links.length; i++) {
    if (links[i].target === node && dom.lifts[i] > lift) lift = dom.lifts[i];
  }
  if (parent === -1 || parent === dom.root) return { nodes: [], lift, topLevel: true };
  return { nodes: graph.nodes.filter((n) => dom.comp[n.index] === parent), lift, topLevel: false };
}

/** Lift of a link (docs/THEORY.md §7): 0 for a nesting edge, -1 inside a cycle. */
export function linkLift(graph, link) {
  const dom = dominance(graph);
  const links = graph.activeLinks ?? graph.links;
  const i = links.indexOf(link);
  return i === -1 ? -1 : dom.lifts[i];
}

/**
 * Compute tree-likeness metrics for a graph. All ratios are in [0, 1] where 1
 * means "perfectly tree-like" for that criterion.
 *
 * - treeScore (spanning ratio): (n - roots) / m. A directed forest has exactly
 *   one incoming edge per non-root, so this is 1 iff no declaration has two
 *   callers. Counting weakly connected components instead would be blind to
 *   direction: two unrelated callers of one shared node would still score 1.
 * - acyclicity: fraction of nodes that are not part of any cycle.
 * - singleCallerRatio: fraction of nodes with at most one caller. In a tree every
 *   node has exactly one parent.
 * - dagness: 1 - (edges inside non-trivial SCCs, plus self loops) / m.
 * - locality: mean of 1 / (1 + lift) over the edges of the condensation. An
 *   edge whose caller is the natural parent of its target has lift 0 and scores
 *   1; sharing between two siblings scores 1/2; a caller ten levels away from
 *   the target's natural scope scores 1/11.
 */
export function computeMetrics(graph) {
  const { nodes } = graph;
  // Structural metrics are defined on the active edge kinds (see applyActiveKinds).
  const links = graph.activeLinks ?? graph.links;
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
  // Edges that would have to go for every declaration to have a single caller.
  const surplusEdges = nodes.reduce((s, x) => s + Math.max(0, x.inDegree - 1), 0);
  const dom = dominance(graph);

  const treeScore = m === 0 ? 1 : Math.min(1, (n - roots) / m);
  const acyclicity = n === 0 ? 1 : 1 - nodesInCycles / n;
  const singleCallerRatio = n === 0 ? 1 : 1 - multiCallers / n;
  const dagness = m === 0 ? 1 : 1 - cycleEdges / m;
  const locality = dom.locality;
  const overall = (treeScore + acyclicity + singleCallerRatio + dagness + locality) / 5;

  return {
    nodes: n,
    edges: graph.links.length,
    activeEdges: m,
    initCycles: initializationCycles(graph),
    components,
    roots,
    leaves,
    maxHeight,
    surplusEdges,
    nontrivialSccs,
    selfLoops,
    nodesInCycles,
    multiCallers,
    nestingEdges: dom.treeEdges,
    maxLift: dom.maxLift,
    treeScore,
    acyclicity,
    singleCallerRatio,
    dagness,
    locality,
    overall,
    dropped: graph.dropped ?? 0,
  };
}

/**
 * The declarations that cost the most tree-likeness: many callers, and callers
 * far from the declaration's natural scope. The cost of a node is the sum of
 * the lifts of its incoming edges, so being called twice from the same scope
 * ranks below being called twice from unrelated parts of the program.
 */
export function topSharedNodes(graph, limit = 8) {
  const dom = dominance(graph);
  const links = graph.activeLinks ?? graph.links;
  const cost = new Map();
  for (let i = 0; i < links.length; i++) {
    if (dom.lifts[i] <= 0) continue;
    const t = links[i].target;
    cost.set(t, (cost.get(t) ?? 0) + dom.lifts[i]);
  }
  return [...graph.nodes]
    .filter((n) => n.inDegree > 1)
    .map((n) => ({ node: n, cost: cost.get(n) ?? 0 }))
    .sort((a, b) => b.cost - a.cost || b.node.inDegree - a.node.inDegree || a.node.name.localeCompare(b.node.name))
    .slice(0, limit);
}

/**
 * Cycles among definition-time term-level edges. These are evaluated while the
 * module initialises, so a cycle means a declaration is read before it exists
 * (docs/THEORY.md §4). Returns the number of declarations involved.
 */
export function initializationCycles(graph) {
  const links = graph.links.filter((l) => l.time === "definition" && l.kind !== "type" && l.kind !== "implements" && l.kind !== "override");
  if (links.length === 0) return 0;
  const { comp, compCount } = stronglyConnectedComponents(graph.nodes, links);
  const size = new Int32Array(compCount);
  for (const n of graph.nodes) size[comp[n.index]]++;
  const involved = new Set();
  for (const n of graph.nodes) if (size[comp[n.index]] > 1) involved.add(n.index);
  for (const l of links) if (l.source === l.target) involved.add(l.source.index);
  return involved.size;
}
