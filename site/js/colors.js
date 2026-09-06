// Colour scales shared by the renderers and the legend.
/* global d3 */
import { EDGE_KINDS } from "./kinds.js";

export { EDGE_KINDS, CONTROL_KINDS } from "./kinds.js";

export const KIND_COLORS = {
  function: "#4c78a8",
  method: "#72b7b2",
  class: "#e45756",
  variable: "#f58518",
  interface: "#b279a2",
  type: "#b279a2",
  enum: "#eeca3b",
  module: "#9d755d",
  unknown: "#8c8c8c",
};

export function kindColor(kind) {
  return KIND_COLORS[kind] ?? KIND_COLORS.unknown;
}

const zoneScale = d3.scaleOrdinal(d3.schemeTableau10);

/** Zone fill colour: keyed by the top-level directory so siblings share a hue. */
export function zoneColor(container) {
  const top = container.path.split("/")[0];
  return zoneScale(top);
}

export const EDGE_COLORS = {
  call: "#6b7280",
  create: "#d97706",
  reference: "#a1a1aa",
  write: "#db2777",
  extends: "#e45756",
  implements: "#b279a2",
  override: "#0e7490",
  type: "#c4b5fd",
};

export function edgeColor(kind) {
  return EDGE_COLORS[kind] ?? EDGE_COLORS.call;
}

// How far each kind bows away from the straight line, so two edges of
// different kinds between the same pair of nodes (e.g. the `write` and
// `reference` halves of a compound assignment, or a `call` and an
// `override` between the same two declarations) fan out instead of drawing
// on top of each other — which, at the renderers' partial edge opacity,
// would blend into a colour that matches neither kind and looks like it
// doesn't match the legend at all. Every kind gets its own offset, evenly
// spread and centred on 0 (so no kind is left running straight through
// both centres, indistinguishable from a kind that overlaps it).
const BOW_STEP = 6;
const EDGE_BOW = Object.fromEntries(EDGE_KINDS.map((kind, i) => [kind, (i - (EDGE_KINDS.length - 1) / 2) * BOW_STEP]));

/**
 * The bow's control point offset (world units, x/y only): the perpendicular
 * you get by rotating a seed vector around the segment's own axis by a
 * quarter turn. That perpendicular never has a height component — rotating
 * around an axis keeps you perpendicular to it, and a segment's height
 * difference lies *along* the axis, not across it — so this one formula
 * is exactly right for a 2D node pair (no height axis at all) and for a 3D
 * pair at any two heights alike; both renderers bow through it instead of
 * each keeping its own copy.
 */
export function edgeBowOffset(source, target, kind) {
  const bow = EDGE_BOW[kind];
  if (!bow) return null;
  const dx = target.x - source.x;
  const dy = target.y - source.y;
  const d = Math.hypot(dx, dy) || 1;
  return { x: (-dy / d) * bow, y: (dx / d) * bow };
}

/** Height (call depth) colour, used in 3D mode. */
export function heightColor(height, maxHeight) {
  const t = maxHeight > 0 ? height / maxHeight : 0;
  return d3.interpolateViridis(0.15 + 0.75 * t);
}
