// Computing the layout a document opens on, in the one place both producers
// of one share: `npm run build:data` for the published datasets
// (scripts/settle.mjs) and analyzeWorker.js for an analysis the browser just
// ran. Neither can afford to do it differently from the other, or from the
// viewer's own "Recompute (reheat)": the whole point of storing a layout is
// that the graph does not jump when someone reheats it.
//
// Why it is computed here at all rather than by the page: a tick costs the
// whole graph. Both forces are node-against-node, so the cost follows the
// node count and barely moves with the edges — about 22ms a tick at 2,100
// nodes, for the ~2,300 ticks the cooling schedule runs. Doing that on the
// main thread is forty seconds of a page that cannot be scrolled; doing it
// once, here, and storing the result costs the reader nothing.
/* global d3 */
import { DEFAULT_OFF_KINDS, EDGE_KINDS } from "./kinds.js";
import { DEFAULT_PHYSICS, layoutOf, seedPositions, settleLayout } from "./simulation.js";
import { applyActiveKinds, buildGraph } from "./model.js";

/**
 * Settle `doc` and write the result into its declarations as `x`/`y`
 * (docs/DATA_FORMAT.md). Mirrors what the viewer does on load — build the
 * graph, enable the kinds the panel starts with, seed, then run — so the
 * stored positions are a point this physics would really have reached.
 *
 * Returns what it did, for a caller that wants to report it.
 */
export function layOutDocument(doc, { onProgress } = {}) {
  const kinds = new Set(EDGE_KINDS.filter((k) => !DEFAULT_OFF_KINDS.has(k)));
  const graph = buildGraph(doc);
  applyActiveKinds(graph, kinds);
  if (graph.nodes.length === 0) return { ticks: 0, reason: "empty", nodes: 0 };
  seedPositions(graph);
  const { ticks, reason } = settleLayout(graph, { ...DEFAULT_PHYSICS, springKinds: kinds }, { onProgress });
  const byId = new Map(layoutOf(graph).map((p) => [p.id, p]));
  for (const d of doc.declarations) {
    const p = byId.get(d.id);
    if (!p) continue;
    // One decimal is past what a layout this size can distinguish on screen,
    // and full doubles would roughly double the file.
    d.x = Math.round(p.x * 10) / 10;
    d.y = Math.round(p.y * 10) / 10;
  }
  return { ticks, reason, nodes: graph.nodes.length };
}
