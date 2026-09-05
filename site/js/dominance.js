// Dominator tree of the condensed graph (docs/THEORY.md §7).
//
// A declaration D' can be nested inside D exactly when every path from a root
// to D' goes through D, i.e. when D dominates D'. The dominator tree is
// therefore the deepest nesting the program admits, and a program is a forest
// exactly when the graph coincides with its own dominator tree.
//
// For an edge a -> b that is not a dominator-tree edge, the *lift* measures how
// far b had to be hoisted out of a to stay reachable from everybody:
//
//   lift(a -> b) = depth(a) - depth(idom(b))
//
// lift 0 means "a is the natural parent of b" (a real nesting edge). lift 1
// means b is shared between siblings and has to live one scope up. A large lift
// means b is called from a place far away in the tree, which is the expensive
// kind of sharing: distance in the dominator tree is what tells "two callers in
// the same subtree" apart from "two callers in unrelated parts of the program".
import { stronglyConnectedComponents } from "./model.js";

/**
 * Dominator tree over the condensation of (nodes, links).
 *
 * Strongly connected components are condensed first: members of a cycle cannot
 * be nested inside one another, so they share a single tree position. A virtual
 * root (id `root`, depth 0) is the parent of every component without incoming
 * edges, which makes every component reachable because a condensation is a DAG.
 *
 * @returns {{comp: Int32Array, compCount: number, root: number,
 *            idom: Int32Array, depth: Int32Array, size: Int32Array,
 *            lifts: number[], crossLinks: number, treeEdges: number,
 *            maxLift: number, locality: number}}
 *          `lifts[i]` is the lift of `links[i]`, or -1 for a link inside a
 *          component (those are not edges of the condensation).
 */
export function dominatorTree(nodes, links) {
  const { comp, compCount } = stronglyConnectedComponents(nodes, links);
  const root = compCount;
  const total = compCount + 1;
  const size = new Int32Array(compCount);
  for (const n of nodes) size[comp[n.index]]++;

  const succ = Array.from({ length: total }, () => []);
  const preds = Array.from({ length: total }, () => []);
  const seen = new Set();
  for (const l of links) {
    const a = comp[l.source.index];
    const b = comp[l.target.index];
    if (a === b) continue;
    const key = a * total + b;
    if (seen.has(key)) continue;
    seen.add(key);
    succ[a].push(b);
    preds[b].push(a);
  }
  for (let c = 0; c < compCount; c++) {
    if (preds[c].length === 0) {
      succ[root].push(c);
      preds[c].push(root);
    }
  }

  // Reverse postorder from the virtual root.
  const postorder = [];
  const visited = new Uint8Array(total);
  const stack = [[root, 0]];
  visited[root] = 1;
  while (stack.length > 0) {
    const frame = stack[stack.length - 1];
    if (frame[1] < succ[frame[0]].length) {
      const w = succ[frame[0]][frame[1]++];
      if (!visited[w]) {
        visited[w] = 1;
        stack.push([w, 0]);
      }
    } else {
      postorder.push(stack.pop()[0]);
    }
  }
  const rpoNum = new Int32Array(total).fill(-1);
  for (let i = 0; i < postorder.length; i++) rpoNum[postorder[i]] = postorder.length - 1 - i;
  const rpo = postorder.slice().reverse();

  // Cooper, Harvey and Kennedy (2001), "A simple, fast dominance algorithm".
  const idom = new Int32Array(total).fill(-1);
  idom[root] = root;
  const intersect = (a, b) => {
    while (a !== b) {
      while (rpoNum[a] > rpoNum[b]) a = idom[a];
      while (rpoNum[b] > rpoNum[a]) b = idom[b];
    }
    return a;
  };
  for (let changed = true; changed; ) {
    changed = false;
    for (const b of rpo) {
      if (b === root) continue;
      let candidate = -1;
      for (const p of preds[b]) {
        if (idom[p] === -1) continue;
        candidate = candidate === -1 ? p : intersect(p, candidate);
      }
      if (candidate !== -1 && idom[b] !== candidate) {
        idom[b] = candidate;
        changed = true;
      }
    }
  }

  // A dominator always precedes its node in reverse postorder, so one pass sets
  // every depth.
  const depth = new Int32Array(total);
  for (const b of rpo) if (b !== root) depth[b] = depth[idom[b]] + 1;

  const lifts = new Array(links.length).fill(-1);
  let crossLinks = 0;
  let treeEdges = 0;
  let maxLift = 0;
  let localitySum = 0;
  for (let i = 0; i < links.length; i++) {
    const a = comp[links[i].source.index];
    const b = comp[links[i].target.index];
    if (a === b) continue;
    const lift = depth[a] - depth[idom[b]];
    lifts[i] = lift;
    crossLinks++;
    if (lift === 0) treeEdges++;
    if (lift > maxLift) maxLift = lift;
    localitySum += 1 / (1 + lift);
  }

  return {
    comp,
    compCount,
    root,
    idom,
    depth,
    size,
    lifts,
    crossLinks,
    treeEdges,
    maxLift,
    locality: crossLinks === 0 ? 1 : localitySum / crossLinks,
  };
}
