// Diagnostics: where the program is not a tree, and what it costs.
//
// Every figure here is read off the dominator tree of the active graph
// (docs/THEORY.md §7): it is the deepest nesting the program admits, so an
// edge that is not one of its edges is a declaration used from two places
// that neither contains the other. The three metrics are the three questions
// worth asking about that — where control enters (entryPoints), how far the
// sharing reaches (scopeEscapes), and how much of what a declaration uses is
// its own (independence) — and all three are measured on the same per-edge
// quantity, the lift, so they never disagree.
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
 * The edges that had to hoist their target out of their caller's scope,
 * grouped by how far (docs/THEORY.md Definition 11). Lift 0 — the caller is
 * the target's natural parent, so the target could simply be nested inside it
 * — is the tree-shaped case and is reported separately as `nesting` rather
 * than as a bucket. Every other edge is a *sharing* edge: its target is used
 * from two places neither of which contains the other, so it has to live at a
 * common ancestor and everything between that ancestor and the caller can see
 * it. The lift is how many scopes that is, which is why one bucket per lift
 * says much more than a single average: lift 1 is two siblings sharing a
 * helper, lift 5 is a declaration visible across five levels that only one
 * place actually needed.
 */
export function scopeEscapes(graph) {
  const dom = dominance(graph);
  const links = graph.activeLinks ?? graph.links;
  const byLift = new Map();
  let nesting = 0;
  let liftSum = 0;
  for (let i = 0; i < links.length; i++) {
    const lift = dom.lifts[i];
    if (lift < 0) continue;
    if (lift === 0) {
      nesting++;
      continue;
    }
    liftSum += lift;
    let bucket = byLift.get(lift);
    if (!bucket) byLift.set(lift, (bucket = []));
    bucket.push(links[i]);
  }
  const buckets = [...byLift.entries()].sort((a, b) => a[0] - b[0]).map(([lift, edges]) => ({ lift, edges }));
  return { nesting, liftSum, escapes: buckets.reduce((n, b) => n + b.edges.length, 0), buckets };
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
    nodes.push({ node, score: sum / callees.size, callees: callees.size });
  }
  nodes.sort((a, b) => a.score - b.score || b.callees - a.callees || a.node.name.localeCompare(b.node.name));
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
