// Colour scales shared by the renderers and the legend.
/* global d3 */

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
  reference: "#a1a1aa",
  extends: "#e45756",
  implements: "#b279a2",
  type: "#c4b5fd",
};

export function edgeColor(kind) {
  return EDGE_COLORS[kind] ?? EDGE_COLORS.call;
}

/** Height (call depth) colour, used in 3D mode. */
export function heightColor(height, maxHeight) {
  const t = maxHeight > 0 ? height / maxHeight : 0;
  return d3.interpolateViridis(0.15 + 0.75 * t);
}
