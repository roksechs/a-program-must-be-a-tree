// Physics: a d3-force simulation with
//  - a repulsive force whose magnitude is inversely proportional to distance
//    (d3.forceManyBody with negative strength behaves exactly like that), and
//  - a spring attraction along every edge whose magnitude is proportional to the
//    distance between the endpoints (Hooke's law with configurable rest length).
// Directories and files (zones) are purely visual: nothing here reads them, so
// the layout is determined by the call graph alone.
/* global d3 */

export const DEFAULT_PHYSICS = Object.freeze({
  springKinds: null, // Set of edge kinds that act as springs; null = every kind
  repulsion: 90, // magnitude of the 1/d repulsion
  stiffness: 0.05, // spring constant k in F = k * (d - restLength)
  restLength: 30, // spring rest length in pixels
  // d3's default (0.0228, ~300 ticks per run) cools before a graph of any
  // size has actually settled, especially once every edge kind's springs and
  // a larger repulsion (above) are all pulling and pushing at once. A slower
  // decay keeps the layout warm for roughly 2400 ticks instead, long enough
  // to reach a stable shape rather than freezing a half-arranged one.
  alphaDecay: 0.003,
});

// d3's own default (0.4) damps velocity fairly hard every tick; a lower
// value lets the initial layout and a "Recompute (reheat)" swing through
// more dramatic motion on the way to settling, instead of creeping there.
export const VELOCITY_DECAY = 0.25;

/**
 * Spring force along edges. Every edge applies a displacement proportional to
 * (distance - restLength) to both endpoints, split by degree so that hubs are
 * not dragged around by a single neighbour (same weighting as d3.forceLink).
 */
export function forceSpring(links, opts) {
  let nodes;
  let bias = [];
  const force = (alpha) => {
    const k = opts.stiffness * alpha;
    const kinds = opts.springKinds;
    for (let i = 0; i < links.length; i++) {
      const l = links[i];
      const s = l.source;
      const t = l.target;
      if (s === t || (kinds && !kinds.has(l.kind))) continue;
      let dx = t.x + t.vx - s.x - s.vx;
      let dy = t.y + t.vy - s.y - s.vy;
      let d = Math.hypot(dx, dy);
      if (d === 0) {
        dx = (Math.random() - 0.5) * 1e-6;
        dy = (Math.random() - 0.5) * 1e-6;
        d = Math.hypot(dx, dy);
      }
      const f = (k * (d - opts.restLength)) / d;
      const b = bias[i];
      t.vx -= dx * f * b;
      t.vy -= dy * f * b;
      s.vx += dx * f * (1 - b);
      s.vy += dy * f * (1 - b);
    }
  };
  force.initialize = (n) => {
    nodes = n;
    const degree = new Map();
    for (const l of links) {
      degree.set(l.source, (degree.get(l.source) ?? 0) + 1);
      degree.set(l.target, (degree.get(l.target) ?? 0) + 1);
    }
    bias = links.map((l) => {
      const ds = degree.get(l.source) ?? 1;
      const dt = degree.get(l.target) ?? 1;
      return ds / (ds + dt);
    });
    void nodes;
  };
  return force;
}

/**
 * Create the simulation for a graph.
 *
 * Two forces, and nothing else: the 1/d repulsion and the springs. The
 * repulsion has no range limit, every pair of nodes feels it however far apart
 * they are, and the only attraction is a spring along an edge, so where two
 * declarations end up next to each other, it is because they are related.
 *
 * Nothing defines a centre either: no point in the plane is privileged, and
 * where the graph as a whole sits is a question for the camera ("Fit to view"),
 * not for the physics. The one remaining entry is `forceCollide`, the hard core
 * of the repulsion, which keeps circles from overlapping.
 */
export function createSimulation(graph, physics) {
  const sim = d3
    .forceSimulation(graph.nodes)
    .force("charge", d3.forceManyBody().strength(-physics.repulsion).theta(0.9))
    .force("spring", forceSpring(graph.links, physics))
    .force("collide", d3.forceCollide().radius((n) => n.radius + 2).iterations(1))
    .alphaDecay(physics.alphaDecay)
    .velocityDecay(VELOCITY_DECAY);
  // Created cold. d3 starts a simulation the moment it is made, and every
  // tick of it costs the whole graph: the two forces are the repulsion and
  // the collide core, both of which are node-against-node, so a 2,138-node
  // graph spends ~22ms per tick before anything is drawn and keeps that up
  // for the ~2,300 ticks the slow `alphaDecay` above buys — 40 seconds of a
  // page that cannot be scrolled smoothly, whether or not the layout needed
  // redoing. Nothing here starts on its own; "Recompute (reheat)" is the one
  // thing that does.
  sim.stop();
  return sim;
}

/** Push the current physics parameters into an existing simulation. */
export function applyPhysics(sim, physics) {
  sim.force("charge").strength(-physics.repulsion);
  // Re-read node radii (degrees, and so radius, may have changed with the
  // active edge kinds - see model.js's applyActiveKinds).
  sim.force("collide").radius((n) => n.radius + 2);
  sim.alphaDecay(physics.alphaDecay);
}

/**
 * Seed initial positions on a phyllotaxis spiral in declaration order so the
 * first iterations start from a compact, deterministic layout. Containers are
 * deliberately not consulted: zones must never influence the physics.
 * Called before the first run and when the user asks for a reset.
 */
export function seedPositions(graph) {
  const golden = Math.PI * (3 - Math.sqrt(5));
  const spacing = 12;
  graph.nodes.forEach((n, i) => {
    const r = spacing * Math.sqrt(i + 1);
    const a = i * golden;
    n.x = r * Math.cos(a);
    n.y = r * Math.sin(a);
    n.vx = 0;
    n.vy = 0;
    n.fx = null;
    n.fy = null;
  });
}

/**
 * Start from the layout the document carried, if it carried one.
 *
 * Settling a graph is slow in a way no amount of tuning fixes: on a
 * 2,600-declaration codebase the layout is still visibly moving after 800
 * ticks and only stops near 2,400, which is 86 seconds of physics. That is
 * affordable once, in a build step, and not at all on the machine of whoever
 * opens the page. So a document may carry `x`/`y` per declaration
 * (docs/DATA_FORMAT.md) and the viewer opens on it without running anything.
 *
 * Returns false when there is nothing to apply, so the caller can fall back
 * to `seedPositions`. Partial layouts are refused rather than half-applied:
 * a few nodes at the origin among settled ones reads as a bug, and the seed
 * is a better starting point than that.
 */
export function applyStoredLayout(graph) {
  if (graph.nodes.length === 0 || !graph.nodes.every((n) => Number.isFinite(n.storedX) && Number.isFinite(n.storedY))) return false;
  for (const n of graph.nodes) {
    n.x = n.storedX;
    n.y = n.storedY;
    n.vx = 0;
    n.vy = 0;
    n.fx = null;
    n.fy = null;
  }
  return true;
}

/** The current layout, in the shape docs/DATA_FORMAT.md stores it. */
export function layoutOf(graph) {
  return graph.nodes.map((n) => ({ id: n.id, x: n.x, y: n.y }));
}
