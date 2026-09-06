// Colour scales shared by the renderers and the legend.
/* global d3 */
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

// Angle (radians) an edge kind's line is rotated by around its own midpoint,
// so a `write` edge (variable -> writer) and the `reference` edge for the
// same pair (writer -> variable, the read half of a compound assignment)
// fan out instead of drawing on top of each other. Everything else (angle 0)
// stays the plain straight line through both node centres.
const EDGE_SPREAD = { reference: 0.12, write: -0.22 };

export function edgeSpreadAngle(kind) {
  return EDGE_SPREAD[kind] ?? 0;
}

/** Height (call depth) colour, used in 3D mode. */
export function heightColor(height, maxHeight) {
  const t = maxHeight > 0 ? height / maxHeight : 0;
  return d3.interpolateViridis(0.15 + 0.75 * t);
}
