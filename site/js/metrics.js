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
 * Convergent operations: a declaration `x` that directly calls several
 * distinct declarations (`via`), all of which independently call the same
 * shared node `y`. This is the shape a single logical operation takes when
 * it has been decomposed into several independent steps instead of one: `x`
 * calling five setters that each separately trigger a shared re-render is
 * indistinguishable, structurally, from `x` genuinely needing five unrelated
 * things done. The pattern is found from call-graph topology alone (`x` ->
 * `via[i]` -> `y` for every `i`) and says nothing about whether `y` is worth
 * consolidating: an expensive, stateful `y` (a full re-render) converged on
 * this way is the redundant-work pattern worth collapsing into one operation
 * at `x`'s level; a cheap, pure `y` (a translation lookup) converged on the
 * same way is harmless. Telling those two apart needs the same reading a
 * person already gives any shared declaration — this only narrows down
 * where to look, and at which caller the fix belongs (the highest point
 * that actually causes the convergence, not `y` itself and not `via`'s
 * members individually).
 */
export function convergentOperations(graph, minWidth = 2) {
  const links = graph.activeLinks ?? graph.links;
  const callersOf = new Map();
  const calleesOf = new Map();
  for (const l of links) {
    if (l.source === l.target) continue;
    if (!callersOf.has(l.target)) callersOf.set(l.target, new Set());
    callersOf.get(l.target).add(l.source);
    if (!calleesOf.has(l.source)) calleesOf.set(l.source, new Set());
    calleesOf.get(l.source).add(l.target);
  }
  const results = [];
  for (const [y, callers] of callersOf) {
    if (callers.size < minWidth) continue;
    for (const [x, callees] of calleesOf) {
      if (x === y) continue;
      const via = [...callers].filter((c) => c !== x && callees.has(c));
      if (via.length >= minWidth) results.push({ x, y, via });
    }
  }
  return results.sort((a, b) => b.via.length - a.via.length || a.x.name.localeCompare(b.x.name));
}

/**
 * Declarations nothing calls, constructs, references, writes to or depends
 * on the type of. Counted over every edge kind regardless of which ones are
 * currently toggled on (`graph.links`, not `graph.activeLinks`): a
 * declaration only reached through a kind the user has hidden is still
 * used. A `module` node (a file's own top-level code) is excluded — nothing
 * is ever expected to point at one. A local declaration (docs/THEORY.md
 * Definition 9a/10 — an options-object callback such as
 * `{ onFit: () => {…} }`, or a named local under `--nested`) is excluded
 * too: its id is `<parent id>/<name>` (docs/DATA_FORMAT.md), i.e. a "/"
 * *after* the file's `::` — not the "/" every nested file path already has
 * before it — and bounded 0-CFA (docs/THEORY.md §3.2) does not trace a call
 * reaching such a declaration through a stored reference
 * (`this.callbacks.onFit()`), so it reads as unused even when something
 * invokes it dynamically.
 */
export function unreferencedDeclarations(graph) {
  const inDegree = new Map(graph.nodes.map((n) => [n, 0]));
  for (const l of graph.links) inDegree.set(l.target, (inDegree.get(l.target) ?? 0) + 1);
  const isLocal = (id) => (id.split("::")[1] ?? "").includes("/");
  return graph.nodes.filter((n) => n.kind !== "module" && !isLocal(n.id) && inDegree.get(n) === 0);
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
