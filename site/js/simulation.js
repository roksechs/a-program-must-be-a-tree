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
  repulsion: 120, // magnitude of the 1/d repulsion
  stiffness: 0.05, // spring constant k in F = k * (d - restLength)
  restLength: 30, // spring rest length in pixels
  // d3's default (0.0228, ~300 ticks per run) cools before a graph of any
  // size has actually settled, especially once every edge kind's springs and
  // a larger repulsion (above) are all pulling and pushing at once. A slower
  // decay keeps the layout warm for roughly 1200 ticks instead, long enough
  // to reach a stable shape rather than freezing a half-arranged one.
  alphaDecay: 0.006,
});

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
    .force("collide", d3.forceCollide().radius((n) => nodeRadius(n) + 2).iterations(1))
    .alphaDecay(physics.alphaDecay)
    .velocityDecay(0.4);
  return sim;
}

/** Push the current physics parameters into an existing simulation. */
export function applyPhysics(sim, physics) {
  sim.force("charge").strength(-physics.repulsion);
  // Re-read node radii (degrees may have changed with the active edge kinds).
  sim.force("collide").radius((n) => nodeRadius(n) + 2);
  sim.alphaDecay(physics.alphaDecay);
}

/** Node radius grows slowly with the number of callers so hubs stand out. */
export function nodeRadius(n) {
  return 4 + Math.sqrt(n.inDegree + n.outDegree) * 1.2;
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
