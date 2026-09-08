// Runs the viewer's own physics over a dataset until it stops moving, and
// writes the result into the document as `x`/`y` per declaration
// (docs/DATA_FORMAT.md).
//
// This exists because settling a graph is slow in a way no tuning fixes. The
// two forces are the 1/d repulsion and the collide core, both node-against-
// node, so a tick costs the whole graph however few edges it has: ~22ms at
// 2,100 nodes, and the deliberately slow `alphaDecay` in site/js/simulation.js
// runs about 2,300 of them. On a 2,600-declaration codebase the layout is
// still visibly moving at 800 ticks and only stops near 2,400 — 86 seconds.
// That is nothing in a build and unacceptable on the machine of whoever opens
// the page, so the bundled datasets carry their layout and the viewer opens
// on it without running anything.
//
// It imports site/js's own modules rather than reimplementing the forces: a
// layout laid out by different physics than the reheat button applies would
// jump the moment anyone pressed it.
import * as d3 from "d3";

// site/js/simulation.js takes d3 from the global, the way the browser loads
// it from site/vendor. Installed with defineProperty rather than
// `globalThis.d3 = d3`, because an assignment to a member of an undeclared
// global is a *binding* (docs/THEORY.md §4.1): it would declare `globalThis.d3`
// as a node of this project's own graph, which nothing then references by
// name — the analyzer cannot see the free `d3` in a module that reads it off
// the global — and test/dead-code.test.mjs would rightly call it unused.
Object.defineProperty(globalThis, "d3", { value: d3, configurable: true });

const { DEFAULT_PHYSICS, VELOCITY_DECAY, createSimulation, seedPositions } = await import("../site/js/simulation.js");
const { applyActiveKinds, buildGraph } = await import("../site/js/model.js");
const { DEFAULT_OFF_KINDS, EDGE_KINDS } = await import("../site/js/kinds.js");

/**
 * Settle `doc` in place. Mirrors what the viewer does on load — build the
 * graph, enable the kinds the panel starts with, seed, then run — so the
 * stored positions are a point this physics would actually have reached.
 */
export function settle(doc) {
  const kinds = new Set(EDGE_KINDS.filter((k) => !DEFAULT_OFF_KINDS.has(k)));
  const graph = buildGraph(doc);
  applyActiveKinds(graph, kinds);
  if (graph.nodes.length === 0) return 0;
  seedPositions(graph);
  const sim = createSimulation(graph, { ...DEFAULT_PHYSICS, springKinds: kinds });
  let ticks = 0;
  // `alphaMin` is d3's default 0.001, the same threshold the viewer's own run
  // stops at, so this ends where a reheat in the page would have ended.
  while (sim.alpha() > sim.alphaMin()) {
    sim.tick();
    ticks++;
  }
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  for (const d of doc.declarations) {
    const n = byId.get(d.id);
    if (!n) continue;
    // One decimal is well past what a layout this size can distinguish on
    // screen, and full doubles would roughly double the file.
    d.x = Math.round(n.x * 10) / 10;
    d.y = Math.round(n.y * 10) / 10;
  }
  return ticks;
}

export { VELOCITY_DECAY };
