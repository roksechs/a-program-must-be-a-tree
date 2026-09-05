// Physics: a d3-force simulation with
//  - a repulsive force whose magnitude is inversely proportional to distance
//    (d3.forceManyBody with negative strength behaves exactly like that), and
//  - a spring attraction along every edge whose magnitude is proportional to the
//    distance between the endpoints (Hooke's law with configurable rest length).
// Directories and files (zones) are purely visual: nothing here reads them, so
// the layout is determined by the call graph alone.
/* global d3 */

export const DEFAULT_PHYSICS = Object.freeze({
  repulsion: 120, // magnitude of the 1/d repulsion
  stiffness: 0.03, // spring constant k in F = k * (d - restLength)
  restLength: 30, // spring rest length in pixels
  gravity: 0.05, // weak pull towards the origin so disconnected components stay together
  alphaDecay: 0.0228, // d3 default: ~300 ticks per run
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
    for (let i = 0; i < links.length; i++) {
      const l = links[i];
      const s = l.source;
      const t = l.target;
      if (s === t) continue;
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

/** Create the simulation for a graph. */
export function createSimulation(graph, physics) {
  const sim = d3
    .forceSimulation(graph.nodes)
    .force("charge", d3.forceManyBody().strength(-physics.repulsion).theta(0.9))
    .force("spring", forceSpring(graph.links, physics))
    .force("x", d3.forceX(0).strength(physics.gravity))
    .force("y", d3.forceY(0).strength(physics.gravity))
    .force("collide", d3.forceCollide().radius((n) => nodeRadius(n) + 2).iterations(1))
    .alphaDecay(physics.alphaDecay)
    .velocityDecay(0.4);
  return sim;
}

/** Push the current physics parameters into an existing simulation. */
export function applyPhysics(sim, physics) {
  sim.force("charge").strength(-physics.repulsion);
  sim.force("x").strength(physics.gravity);
  sim.force("y").strength(physics.gravity);
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
