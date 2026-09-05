// Zones: directories and files are drawn as padded convex hulls around the
// nodes they contain. Shared by the 2D and 3D renderers.
/* global d3 */

/**
 * Select the containers that should be drawn for a given directory depth.
 * Directories with depth <= `depth` are shown; files are shown when
 * `showFiles` is true. Containers whose parent has the same node set are
 * skipped (a directory holding a single file would otherwise draw two hulls
 * on top of each other).
 */
export function visibleContainers(graph, depth, showFiles) {
  const byId = new Map(graph.containers.map((c) => [c.id, c]));
  const result = [];
  for (const c of graph.containers) {
    if (c.isFile ? !showFiles : c.depth > depth) continue;
    const parent = c.parent ? byId.get(c.parent) : null;
    const parentVisible = parent && (parent.isFile ? showFiles : parent.depth <= depth);
    if (parentVisible && parent.nodes.length === c.nodes.length) {
      c.redundant = true;
      continue;
    }
    c.redundant = false;
    // Deeper containers pull harder in the cohesion force.
    c.weight = c.isFile ? 1 : 0.35 + 0.15 * c.depth;
    result.push(c);
  }
  // Draw shallow (large) zones first so nested zones sit on top.
  result.sort((a, b) => a.depth - b.depth || (a.isFile ? 1 : 0) - (b.isFile ? 1 : 0));
  return result;
}

const roundedClosedLine = d3.line().curve(d3.curveCatmullRomClosed.alpha(0.8));

/**
 * Compute a padded, rounded hull path around a list of [x, y] points.
 * Every point is expanded into a small square of `padding` so that hulls of
 * one or two nodes still have an area.
 */
export function hullPath(points, padding) {
  if (points.length === 0) return null;
  const expanded = [];
  const p = padding;
  for (const [x, y] of points) {
    expanded.push([x - p, y - p], [x + p, y - p], [x + p, y + p], [x - p, y + p]);
    expanded.push([x - p * 1.3, y], [x + p * 1.3, y], [x, y - p * 1.3], [x, y + p * 1.3]);
  }
  const hull = d3.polygonHull(expanded);
  if (!hull) return null;
  return roundedClosedLine(hull);
}

/** Centroid of a list of [x, y] points. */
export function centroid(points) {
  let x = 0;
  let y = 0;
  for (const [px, py] of points) {
    x += px;
    y += py;
  }
  return [x / points.length, y / points.length];
}

/** Topmost point of a hull (used to place the zone label). */
export function topPoint(points) {
  let best = points[0];
  for (const p of points) if (p[1] < best[1]) best = p;
  return best;
}
