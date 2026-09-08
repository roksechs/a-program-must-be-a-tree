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

/**
 * The layout as a *shape*: centred on its centroid and scaled so the median
 * distance from it is 1.
 *
 * Comparing two of these says how much the arrangement changed, ignoring how
 * much the whole thing grew — which is the only useful question here, because
 * under this physics the growth never stops. A piece connected to nothing has
 * no spring holding it to anything, so the unbounded repulsion pushes it away
 * without limit: measured on a 2,138-declaration project with the cooling
 * schedule slowed down, the layout was 80,000 units across and still
 * expanding after 2,800 ticks. Absolute displacement shrinks partly *because*
 * of that expansion and so reads as convergence too early.
 *
 * The scale is the median distance and not the mean or the bounding box for
 * the same reason: a handful of islands heading for infinity would otherwise
 * set it, and everything else would look like it was converging by shrinking.
 */
function shapeOf(nodes) {
  let cx = 0;
  let cy = 0;
  for (const n of nodes) {
    cx += n.x;
    cy += n.y;
  }
  cx /= nodes.length;
  cy /= nodes.length;
  const radii = nodes.map((n) => Math.hypot(n.x - cx, n.y - cy)).sort((a, b) => a - b);
  const scale = radii[Math.floor(radii.length / 2)] || 1;
  return nodes.map((n) => ({ x: (n.x - cx) / scale, y: (n.y - cy) / scale }));
}

/**
 * Coordinates a layout can still be one at. A diverging run leaves the graph
 * spread over distances no camera frames and no quadtree survives, so this is
 * the line between "expanded" and "thrown apart".
 */
const RUNAWAY = 1e7;
function withinBounds(nodes) {
  for (const n of nodes) {
    if (!Number.isFinite(n.x) || !Number.isFinite(n.y) || Math.abs(n.x) > RUNAWAY || Math.abs(n.y) > RUNAWAY) return false;
  }
  return true;
}

/**
 * Run the layout to a stop, off any animation frame, and report progress.
 *
 * Used by the build step and by the worker that runs an in-browser analysis,
 * so a layout is produced by exactly the physics the reheat button applies —
 * a layout laid out by anything else would make the graph jump the moment
 * anyone pressed it.
 *
 * *Runs*, plural: it anneals repeatedly until two in a row land in the same
 * place. One run is not enough, and that is measurable rather than a matter
 * of taste. On a 2,138-declaration project, pressing "Recompute (reheat)" on
 * the layout a single run produced moved the arrangement by 0.45 of its own
 * median radius — half the picture. Pressing it again moved it 0.17, then
 * 0.10, then 0.05, while the extent converged on a limit; the layout was not
 * wrong, it was shallow, and each further anneal found a better arrangement
 * than the last. A layout the reheat button visibly rearranges is not one to
 * ship, so this keeps going until a run changes the shape by less than
 * `settled`.
 *
 * Within one run it stops on whichever comes first:
 *
 *  - the cooling schedule reaching `alphaMin`, the same threshold a run in
 *    the page stops at, or
 *  - the *arrangement* having stopped changing: the per-tick change in
 *    `shapeOf` under `quiet`, twice in a row.
 *
 * The arrangement, not the positions. Absolute displacement stops too early,
 * because it falls as much from the layout inflating as from the picture
 * settling: on that same project, a threshold of 1e-5 on absolute
 * displacement fires around tick 1,300, where the shape is still changing at
 * 87e-6 per tick — eight times the same threshold. By tick 1,900 the shape is
 * down to 12e-6 and by 2,300 to 6e-6.
 *
 * Cooling is what settles a shape, and the residual movement at a *fixed*
 * temperature is heat rather than structure: held at a constant alpha, the
 * per-tick change is proportional to that alpha (221e-6 at 0.2, 115e-6 at
 * 0.05, 32e-6 at 0.01, 8.6e-6 at 0.002), so it goes to zero only as the
 * temperature does. That is why a run has to be annealed to its end, and why
 * a settled layout genuinely does not move on its own.
 *
 * Twice in a row because the measure is noisy from chunk to chunk (86 then 90
 * then 42, on the run above), and one dip below the line is not a layout that
 * has come to rest.
 *
 * `maxTicks` is only a backstop against a graph that never settles at all.
 */
export function settleLayout(graph, physics, { onProgress, quiet = 1e-5, settled = 0.02, heat = 16, improve = 0.9, maxRuns = 12, maxTicks = 40000, chunk = 50 } = {}) {
  if (graph.nodes.length === 0) return { ticks: 0, runs: 0, reason: "empty" };
  const sim = createSimulation(graph, physics);
  let ticks = 0;
  let runs = 0;
  let reason = "settled";
  let beforeRun = shapeOf(graph.nodes);
  let bestDrift = Infinity;
  let temperature = heat;
  while (ticks < maxTicks && runs < maxRuns) {
    // One annealing run, from `temperature` down to alphaMin. A snapshot
    // first: a run hot enough to diverge has to be undoable.
    const snapshot = graph.nodes.map((n) => ({ x: n.x, y: n.y }));
    sim.alpha(temperature);
    runs++;
    let diverged = false;
    let previous = shapeOf(graph.nodes);
    let quietChunks = 0;
    while (ticks < maxTicks && sim.alpha() > sim.alphaMin()) {
      const before = ticks;
      for (let i = 0; i < chunk && ticks < maxTicks && sim.alpha() > sim.alphaMin(); i++) {
        sim.tick();
        ticks++;
      }
      if (!withinBounds(graph.nodes)) {
        diverged = true;
        break;
      }
      const now = shapeOf(graph.nodes);
      let moved = 0;
      for (let i = 0; i < now.length; i++) moved += Math.hypot(now[i].x - previous[i].x, now[i].y - previous[i].y);
      const perTick = moved / now.length / Math.max(ticks - before, 1);
      previous = now;
      onProgress?.({ ticks, runs, maxTicks, alpha: sim.alpha() });
      quietChunks = perTick < quiet ? quietChunks + 1 : 0;
      if (quietChunks >= 2) break;
    }
    if (diverged) {
      // Put the layout back and try again cooler. Explicit Euler with a big
      // enough step does not settle, it throws the graph apart: measured on
      // this repository, a run starting at 48 was past any usable extent
      // within 50 ticks, and the quadtree the repulsion builds subdivides
      // until it exhausts memory. 16 diverged on none of the twelve datasets
      // here, but "none of twelve" is not "none", so this is the way out.
      graph.nodes.forEach((n, i) => {
        n.x = snapshot[i].x;
        n.y = snapshot[i].y;
        n.vx = 0;
        n.vy = 0;
      });
      beforeRun = shapeOf(graph.nodes);
      if (temperature <= 1) {
        reason = "diverged";
        break;
      }
      temperature = Math.max(1, temperature / 4);
      continue;
    }
    // How much did this run change the picture?
    const afterRun = shapeOf(graph.nodes);
    let drift = 0;
    for (let i = 0; i < afterRun.length; i++) drift += Math.hypot(afterRun[i].x - beforeRun[i].x, afterRun[i].y - beforeRun[i].y);
    drift /= afterRun.length;
    beforeRun = afterRun;
    if (drift < settled) {
      reason = "settled";
      break;
    }
    // Stop when the runs stop *improving*, not only when they are small.
    // The sequence on a large graph falls steeply and then flattens out
    // (0.45, 0.17, 0.10, 0.05, then a floor near 0.03), and the floor is the
    // wander a full-temperature reheat has no matter how good the layout is.
    // A small graph reaches its floor almost immediately and high: there are
    // simply several comparable arrangements of thirty nodes, and reheating
    // picks among them. Waiting for such a graph to fall under a fixed
    // threshold means waiting forever, which is exactly what a first attempt
    // at this did — eight of twelve datasets ran to the tick cap.
    //
    // On `heat`: alpha is d3's cooling parameter and by convention runs from
    // 1, but nothing clamps it — it is only the multiplier on each tick's
    // displacement, so a larger one explores further before the schedule
    // brings it down. Starting each run at 16 rather than 1 was measured
    // across the ten datasets here by the thing that actually bothered
    // someone: how far a subsequent press of "Recompute (reheat)" moves the
    // picture. Starting at 1 was the worst of the temperatures tried on nine
    // of the ten; on this repository's own graph a single run from 16 reached
    // 0.008 in 3,200 ticks where repeated runs from 1 reached only 0.048 in
    // 5,800. It is not a trick of scale — a hot run does leave the layout
    // several times larger, but uniformly scaling a cold layout up to the
    // same size makes it *worse* (0.13 to 0.27), because that pulls every
    // spring off its rest length.
    if (drift > bestDrift * improve) {
      reason = "floor";
      break;
    }
    bestDrift = Math.min(bestDrift, drift);
  }
  if (ticks >= maxTicks) reason = "capped";
  else if (runs >= maxRuns) reason = "runs";
  sim.stop();
  return { ticks, runs, reason };
}
