// Path / reachability queries between two declarations: "how does A affect
// B" as a graph-exploration aid, distinct from the diagnostics section's
// aggregate scores. Follows only `graph.activeLinks` (docs/DESIGN.md), the
// same edges that are currently drawn, spring and counted — so a disabled
// edge kind is invisible here too, consistent with the panel's "one switch
// drives drawing, springs and diagnostics together" rule.

/** Adjacency list for `graph.activeLinks`, in the given direction. */
function buildAdjacency(links, direction) {
  const map = new Map();
  for (const l of links) {
    const from = direction === "forward" ? l.source : l.target;
    const to = direction === "forward" ? l.target : l.source;
    let list = map.get(from);
    if (!list) map.set(from, (list = []));
    list.push(to);
  }
  return map;
}

/** BFS from `start` following `adjacency`; returns { seen, parent } (`parent` for shortest-path reconstruction). */
function bfs(start, adjacency) {
  const seen = new Set([start]);
  const parent = new Map();
  const queue = [start];
  for (let i = 0; i < queue.length; i++) {
    const n = queue[i];
    for (const next of adjacency.get(n) ?? []) {
      if (seen.has(next)) continue;
      seen.add(next);
      parent.set(next, n);
      queue.push(next);
    }
  }
  return { seen, parent };
}

/**
 * Every node and edge that lies on *some* directed path from `from` to `to`
 * (through `graph.activeLinks`), plus the shortest one as an ordered node
 * list for display. Not just the shortest path itself: the node set is the
 * intersection of "reachable from `from`" and "can reach `to`" — the whole
 * cone of influence between the two, which a single shortest path alone
 * would understate whenever more than one route exists.
 * @returns { reachable: boolean, nodes: Set, edges: Set, shortestPath: object[] | null }
 */
export function pathBetween(graph, from, to) {
  if (from === to) return { reachable: true, nodes: new Set([from]), edges: new Set(), shortestPath: [from] };
  const forwardAdjacency = buildAdjacency(graph.activeLinks, "forward");
  const backwardAdjacency = buildAdjacency(graph.activeLinks, "backward");
  const { seen: forward, parent } = bfs(from, forwardAdjacency);
  if (!forward.has(to)) return { reachable: false, nodes: new Set(), edges: new Set(), shortestPath: null };
  const { seen: backward } = bfs(to, backwardAdjacency);
  const nodes = new Set([...forward].filter((n) => backward.has(n)));
  const edges = new Set(graph.activeLinks.filter((l) => nodes.has(l.source) && nodes.has(l.target)));
  const shortestPath = [];
  for (let n = to; n !== undefined; n = parent.get(n)) shortestPath.unshift(n);
  return { reachable: true, nodes, edges, shortestPath };
}
