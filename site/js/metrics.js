// Diagnostics: where the program is not a tree, and what it costs.
//
// entryPoints and independence are read off the dominator tree of the active
// graph (docs/THEORY.md §7): it is the deepest nesting the program admits, so
// an edge that is not one of its edges is a declaration used from two places
// that neither contains the other, and the lift of that edge is how far
// apart. elevationGaps reads a different axis instead — call height
// (model.js's computeHeights, the same quantity the 3D view's vertical axis
// draws) — so a bucket there is a jump already visible in the graph: a caller
// reaching straight down past several layers instead of into the one right
// below it.
//
// `islands` asks a question neither axis can: a piece of the program that
// shares no edge with the rest has no lift and no height gap to describe. It
// is read off the connected components instead.
import { dominatorTree } from "./dominance.js";
import { connectedComponents } from "./model.js";

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
 * Every distinct declaration a node depends on, with the lift of that
 * dependency (docs/THEORY.md Definition 11). Parallel links — the same pair
 * joined by both a `call` and a `reference`, say — are one entry: the lift
 * depends only on where the two sit in the dominator tree, so both links
 * carry the same value and counting them twice would weight that one callee
 * twice in every average below. Links inside a cycle (lift -1) are left out
 * entirely; they are not edges of the condensation and have no lift.
 */
function calleesWithLift(graph) {
  const dom = dominance(graph);
  const links = graph.activeLinks ?? graph.links;
  const perSource = new Map();
  for (let i = 0; i < links.length; i++) {
    const lift = dom.lifts[i];
    if (lift < 0) continue;
    const { source, target } = links[i];
    let callees = perSource.get(source);
    if (!callees) perSource.set(source, (callees = new Map()));
    callees.set(target, lift);
  }
  return perSource;
}

/**
 * Declarations nothing calls: where control enters the program at all. In a
 * forest these are exactly the roots (docs/THEORY.md Definition 10), so their
 * number is the number of separate trees the program actually is — and in an
 * application they are what runs on startup or in response to an event, which
 * makes the list a rough inventory of the states the UI can be driven into.
 * Counted over the enabled edge kinds, like everything else here.
 */
export function entryPoints(graph) {
  return graph.nodes.filter((n) => n.inDegree === 0).sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Every call edge's elevation gap: how many layers of call height
 * (model.js's `computeHeights`, `n.height`) it skips beyond the one layer a
 * call always crosses. Gap 0 is the edge that actually set the callee's
 * height — its shallowest caller, one layer up — or any other edge that
 * happens to land exactly one layer up too; that is the tree-shaped case and
 * is reported separately as `flat` rather than as a bucket. A positive gap is
 * a caller reaching past intermediate layers straight down to something
 * several levels below it: 1 is a caller one layer higher than it needed to
 * be, a large gap is a top-of-the-graph declaration reaching all the way to
 * the bottom. Always ≥ 0 for an edge between two different components,
 * because `computeHeights` places every declaration exactly one layer below
 * its *shallowest* caller — a steeper caller can only be higher still, never
 * lower.
 *
 * An edge inside a cycle (its two ends share a `scc`, including a self-loop)
 * has no gap to report: cycle members share one call height, so neither end
 * is "above" the other for this to measure.
 *
 * Unlike `entryPoints`/`independence`, this is not read off the dominator
 * tree at all — it is the same axis the 3D view already draws, so a bucket
 * here is a jump you can see, not one that has to be looked up.
 */
export function elevationGaps(graph) {
  const links = graph.activeLinks ?? graph.links;
  const byGap = new Map();
  let flat = 0;
  let gapSum = 0;
  for (const l of links) {
    if (l.source.scc === l.target.scc) continue;
    const gap = l.source.height - l.target.height - 1;
    if (gap === 0) {
      flat++;
      continue;
    }
    gapSum += gap;
    let bucket = byGap.get(gap);
    if (!bucket) byGap.set(gap, (bucket = []));
    bucket.push(l);
  }
  const buckets = [...byGap.entries()].sort((a, b) => a[0] - b[0]).map(([gap, edges]) => ({ gap, edges }));
  return { flat, gapSum, total: buckets.reduce((n, b) => n + b.edges.length, 0), buckets };
}

/**
 * How much of what a declaration depends on is its alone.
 *
 *     independence(n) = mean over n's callees c of 1 / (1 + lift(n -> c))
 *
 * A callee the node is the natural parent of (lift 0) could be nested inside
 * it and scores 1; one shared with a sibling scores 1/2; one hoisted five
 * scopes up scores 1/6. So the score is 1 exactly when everything the node
 * depends on could live inside it, and falls as its dependencies turn out to
 * be shared — the further away the users it is shared with, the further it
 * falls. Weighting by lift rather than by a count of outside users is what
 * distinguishes "shared with a sibling" from "shared across the program",
 * which a count cannot: both are simply "used elsewhere".
 *
 * The list is ranked by `shared` — `callees - Σ 1/(1 + lift)`, how many
 * whole dependencies' worth of ownership the node does not have — and not by
 * the score. Running this on its own repository is what settled that: 88 of
 * 194 scored declarations there depend on exactly one thing, so their
 * "average" is that single edge and can only ever be one of 1, ½, ⅓, ¼…, and
 * 16 of the 30 worst-scoring were one-line setters whose one dependency was
 * a widely shared `draw()`. Nothing can be done about `setLayerGap`; ranking
 * it above an 18-dependency function that is genuinely tangled pointed the
 * list at the one thing in it nobody can act on. Multiplying by how much
 * there was to own fixes that, and matches what `elevationGaps` already
 * reports alongside its buckets: a total, not only a ratio.
 *
 * `overall` is the same quantity over every dependency in the graph, so the
 * headline figure and the per-node figures never disagree about what they
 * measure. It is an average over edges, though, so it says how a graph is
 * doing against itself and not how two graphs compare: a program with plenty
 * of well-nested dependencies dilutes its badly shared ones and can score
 * above a smaller program whose sharing is far more local. The ranked list is
 * what to read across codebases. Nodes that depend on nothing (or only on
 * their own cycle) have no callees to own and get no score at all rather than
 * a misleading 1 or 0.
 */
export function independence(graph) {
  const perSource = calleesWithLift(graph);
  const nodes = [];
  let total = 0;
  let count = 0;
  for (const [node, callees] of perSource) {
    let sum = 0;
    for (const lift of callees.values()) sum += 1 / (1 + lift);
    total += sum;
    count += callees.size;
    // `shared` is what the ranking uses: how many of this node's dependencies
    // it does not get to keep, in whole-dependency terms. See the note on
    // ranking above for why the score alone is the wrong sort key.
    nodes.push({ node, score: sum / callees.size, callees: callees.size, shared: callees.size - sum });
  }
  nodes.sort((a, b) => b.shared - a.shared || a.score - b.score || a.node.name.localeCompare(b.node.name));
  return { overall: count === 0 ? 1 : total / count, nodes };
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
 * The pieces of the graph that stand apart from the rest of it.
 *
 * Every connected component but the largest is an island: a set of
 * declarations that depend on each other and on nothing else the analysis can
 * see, and that nothing else depends on. Read on the enabled edge kinds, like
 * every other diagnostic here, so what the panel counts is what the view
 * draws — an island is usually visible as a clump drifting away on its own,
 * and a figure that disagreed with that would be worse than no figure.
 *
 * Islands of one are counted but not listed. They are the common case by far
 * (738 of 761 on a 2,600-declaration codebase), a list of them would bury the
 * groups, and a declaration that neither calls nor is called is already what
 * `entryPoints` and `unreferencedDeclarations` report. A *group* adrift is the
 * finding: several declarations that clearly belong together, and together
 * belong to nothing.
 *
 * A `module` node alone — a file's own top-level code — is not an island at
 * all and is left out of the count, for the reason
 * `unreferencedDeclarations` already gives: nothing is ever expected to point
 * at one, so a file whose top-level code happens to call nothing is
 * structurally isolated rather than adrift. Inside a *group* it stays: a file
 * whose top-level code only reaches declarations that nothing else reaches is
 * exactly the finding. So `mainland + adrift` is a count of findings, not a
 * partition of the graph.
 *
 * The largest component is taken to be the mainland. On a program that is
 * genuinely two halves that is an arbitrary choice between them, which is why
 * `mainland` is reported alongside: two comparable numbers say "two halves"
 * where the count of islands alone would not.
 */
export function islands(graph) {
  const links = graph.activeLinks ?? graph.links;
  const components = connectedComponents(graph.nodes, links);
  const [mainland, ...rest] = components;
  const adrift = rest.filter((c) => c.nodes.length > 1 || c.nodes[0].kind !== "module");
  const groups = adrift.filter((c) => c.nodes.length > 1);
  const singles = adrift.filter((c) => c.nodes.length === 1).map((c) => c.nodes[0]);
  return {
    mainland: mainland?.nodes.length ?? 0,
    // The mainland component itself, not just its size: framing a single
    // island in the view (panel.js) needs the same {nodes, links} shape the
    // camera's fit() takes for a group, and the mainland is one too — just
    // the one nothing else stands apart from.
    mainlandGroup: mainland ?? { nodes: [], links: [] },
    groups,
    singles,
    // Everything reported adrift, groups and singles alike.
    adrift: adrift.reduce((sum, c) => sum + c.nodes.length, 0),
  };
}
