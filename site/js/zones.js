// Zones: directories and files are drawn as padded convex hulls around the
// nodes they contain. Shared by the 2D and 3D renderers.
/* global d3 */

/**
 * Select the containers that should be drawn for a given depth. Depth counts
 * directories from the root (1 = top-level directory) and the file itself as
 * one more level, so 0 draws nothing and the maximum draws every directory and
 * every file. Containers whose parent has the same node set are skipped (a
 * directory holding a single file would otherwise draw two hulls on top of
 * each other).
 */
export function visibleContainers(graph, depth) {
  const byId = new Map(graph.containers.map((c) => [c.id, c]));
  const result = [];
  for (const c of graph.containers) {
    if (c.depth > depth) continue;
    const parent = c.parent ? byId.get(c.parent) : null;
    if (parent && parent.depth <= depth && parent.nodes.length === c.nodes.length) continue;
    result.push(c);
  }
  // Draw shallow (large) zones first so nested zones sit on top.
  result.sort((a, b) => a.depth - b.depth);
  return result;
}

let closedLine = null;

/**
 * Compute a padded hull path around a list of [x, y] points. Every point of
 * the hull is expanded into a small octagon of `padding` so that hulls of
 * one or two nodes still have an area and corners look eased rather than
 * sharp, without the cost of an actual curve fit. Recomputed from scratch on
 * every physics tick, so member points are hulled first and only *those*
 * vertices (typically far fewer than the membership) get expanded and hulled
 * again, rather than expanding every member: a zone with hundreds of nodes
 * still pads a handful of hull corners. The outline itself is drawn as plain
 * straight segments (curveLinearClosed): the octagon expansion already
 * softens corners, so a spline fit over it would cost more per tick for
 * curvature nobody asked for.
 */
export function hullPath(points, padding) {
  if (points.length === 0) return null;
  const base = points.length > 2 ? (d3.polygonHull(points) ?? points) : points;
  const expanded = [];
  const p = padding;
  for (const [x, y] of base) {
    expanded.push([x - p, y - p], [x + p, y - p], [x + p, y + p], [x - p, y + p]);
    expanded.push([x - p * 1.3, y], [x + p * 1.3, y], [x, y - p * 1.3], [x, y + p * 1.3]);
  }
  const hull = d3.polygonHull(expanded);
  if (!hull) return null;
  closedLine ??= d3.line().curve(d3.curveLinearClosed);
  return closedLine(hull);
}
/** Topmost point of a hull (used to place the zone label). */
export function topPoint(points) {
  let best = points[0];
  for (const p of points) if (p[1] < best[1]) best = p;
  return best;
}
