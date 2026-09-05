// Physics: a d3-force simulation with
//  - a repulsive force whose magnitude is inversely proportional to distance
//    (d3.forceManyBody with negative strength behaves exactly like that), and
//  - a spring attraction along every edge whose magnitude is proportional to the
//    distance between the endpoints (Hooke's law with configurable rest length),
//  - an optional cohesion force that pulls declarations towards the centroid of
//    their file / directory so the zones stay compact.
/* global d3 */

export const DEFAULT_PHYSICS = Object.freeze({
  repulsion: 120, // magnitude of the 1/d repulsion
  stiffness: 0.03, // spring constant k in F = k * (d - restLength)
  restLength: 30, // spring rest length in pixels
  cohesion: 0.15, // pull towards the container centroid
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

/**
 * Cohesion force: every node is pulled towards the centroid of the containers
 * it belongs to (its file, and each directory up to `depth`). Deeper containers
 * pull harder so files form tight clusters inside looser directory clusters.
 */
export function forceCohesion(containersRef, opts) {
  const force = (alpha) => {
    const containers = containersRef.current;
    if (!containers || containers.length === 0) return;
    const k = opts.cohesion * alpha;
    for (const c of containers) {
      if (c.nodes.length < 2) continue;
      let cx = 0;
      let cy = 0;
      for (const n of c.nodes) {
        cx += n.x;
        cy += n.y;
      }
      cx /= c.nodes.length;
      cy /= c.nodes.length;
      const w = k * c.weight;
      for (const n of c.nodes) {
        n.vx += (cx - n.x) * w;
        n.vy += (cy - n.y) * w;
      }
    }
  };
  force.initialize = () => {};
  return force;
}

/** Create the simulation for a graph. `containersRef.current` is updated by the app when the depth changes. */
export function createSimulation(graph, physics, containersRef) {
  const sim = d3
    .forceSimulation(graph.nodes)
    .force("charge", d3.forceManyBody().strength(-physics.repulsion).theta(0.9))
    .force("spring", forceSpring(graph.links, physics))
    .force("cohesion", forceCohesion(containersRef, physics))
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
 * Seed initial positions from the containers so the first iterations start
 * near a sensible layout: each file gets a slot on a spiral, its nodes jitter
 * around it. Called before the first run and when the user asks for a reset.
 */
export function seedPositions(graph) {
  const files = graph.containers.filter((c) => c.isFile);
  const golden = Math.PI * (3 - Math.sqrt(5));
  const spacing = 40 * Math.sqrt(Math.max(1, graph.nodes.length) / Math.max(1, files.length));
  files.forEach((f, i) => {
    const r = spacing * Math.sqrt(i + 1);
    const a = i * golden;
    const fx = r * Math.cos(a);
    const fy = r * Math.sin(a);
    f.nodes.forEach((n, j) => {
      const rr = 6 * Math.sqrt(j + 1);
      const aa = j * golden;
      n.x = fx + rr * Math.cos(aa);
      n.y = fy + rr * Math.sin(aa);
      n.vx = 0;
      n.vy = 0;
      n.fx = null;
      n.fy = null;
    });
  });
}
