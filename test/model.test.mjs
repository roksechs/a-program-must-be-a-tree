import { test } from "node:test";
import assert from "node:assert/strict";
import { applyActiveKinds, buildGraph, computeHeights, connectedComponents, stronglyConnectedComponents } from "../site/js/model.js";
import { elevationGaps, entryPoints, independence } from "../site/js/metrics.js";

const decl = (id, file = "src/a.js", kind = "function") => ({ id, name: id, kind, file });
const edge = (source, target, kind = "call") => ({ source, target, kind });

test("buildGraph merges duplicate edges and drops dangling ones", () => {
  const g = buildGraph({
    declarations: [decl("a"), decl("b")],
    edges: [edge("a", "b"), edge("a", "b"), edge("a", "missing")],
  });
  assert.equal(g.links.length, 1);
  assert.equal(g.links[0].count, 2);
  assert.equal(g.dropped, 1);
  assert.equal(g.byId.get("a").outDegree, 1);
  assert.equal(g.byId.get("b").inDegree, 1);
});

test("containers follow the directory hierarchy", () => {
  const g = buildGraph({
    declarations: [decl("a", "src/core/x.js"), decl("b", "src/core/y.js"), decl("c", "src/util/z.js"), decl("d", "root.js")],
    edges: [],
  });
  const paths = g.containers.map((c) => c.path).sort();
  assert.deepEqual(paths, ["root.js", "src", "src/core", "src/core/x.js", "src/core/y.js", "src/util", "src/util/z.js"]);
  assert.equal(g.maxDepth, 3); // src / core / x.js
  const src = g.containers.find((c) => c.path === "src");
  assert.equal(src.nodes.length, 3);
  assert.equal(src.depth, 1);
  assert.equal(src.isFile, false);
  const file = g.containers.find((c) => c.path === "src/core/x.js");
  assert.equal(file.isFile, true);
  assert.equal(file.depth, 3);
  assert.equal(file.parent, "src/core");
});

test("call heights: leaves are 0, callers stack above, cycles share a height", () => {
  const g = buildGraph({
    declarations: ["main", "a", "b", "c", "leaf", "x", "y"].map((id) => decl(id)),
    edges: [edge("main", "a"), edge("a", "b"), edge("b", "leaf"), edge("main", "c"), edge("x", "y"), edge("y", "x"), edge("y", "leaf")],
  });
  const h = (id) => g.byId.get(id).height;
  assert.equal(h("leaf"), 0);
  // "c" is a pure sink too (calls nothing), but its only caller, "main", has
  // slack above it (main's other branch is the graph's longest chain), so
  // "c" is pulled up to sit right below main instead of left at the bottom.
  assert.equal(h("c"), 2);
  assert.equal(h("b"), 1);
  assert.equal(h("a"), 2);
  assert.equal(h("main"), 3);
  assert.equal(h("x"), h("y"));
  // Nothing calls into the {x, y} cycle, so it is lifted all the way to the
  // top plane instead of sitting at its minimal (ASAP) height of 1.
  assert.equal(h("x"), 3);
  assert.equal(g.byId.get("x").inCycle, true);
  assert.equal(g.byId.get("main").inCycle, false);
});

test("call heights: every node is pulled up toward its caller, even a pure sink — only the leaf on the longest chain stays at 0", () => {
  const g = buildGraph({
    declarations: ["root", "x", "leafX", "y", "z", "leafZ"].map((id) => decl(id)),
    edges: [edge("root", "x"), edge("x", "leafX"), edge("root", "y"), edge("y", "z"), edge("z", "leafZ")],
  });
  const h = (id) => g.byId.get(id).height;
  // root -> y -> z -> leafZ is the longest chain, fixing maxHeight at 3; the
  // shallower root -> x -> leafX branch has slack.
  assert.equal(h("root"), 3);
  assert.equal(h("y"), 2);
  assert.equal(h("z"), 1);
  // leafZ sits on the graph's own longest chain, so it has nowhere higher to
  // go: maxHeight (3) minus its distance from root (3) is exactly 0.
  assert.equal(h("leafZ"), 0);
  // x's own ASAP height is 1 (one hop to a leaf), but it is pulled up to sit
  // right below its only caller, root, instead of being left at its
  // minimal height...
  assert.equal(h("x"), 2);
  // ...and leafX — a pure sink, calling nothing — follows it up to sit right
  // below x in turn, rather than being pinned to the bottom regardless of
  // where its caller ended up.
  assert.equal(h("leafX"), 1);
});

test("self loops mark a node as cyclic", () => {
  const g = buildGraph({ declarations: [decl("r")], edges: [edge("r", "r")] });
  assert.equal(g.byId.get("r").inCycle, true);
  assert.equal(g.byId.get("r").height, 0);
});

test("strongly connected components", () => {
  const g = buildGraph({
    declarations: ["a", "b", "c", "d"].map((id) => decl(id)),
    edges: [edge("a", "b"), edge("b", "c"), edge("c", "a"), edge("c", "d")],
  });
  const { comp, compCount } = stronglyConnectedComponents(g.nodes, g.links);
  assert.equal(compCount, 2);
  const id = (name) => comp[g.byId.get(name).index];
  assert.equal(id("a"), id("b"));
  assert.equal(id("b"), id("c"));
  assert.notEqual(id("c"), id("d"));
  assert.equal(connectedComponents(g.nodes, g.links).length, 1);
  assert.equal(computeHeights(g.nodes, g.links).maxHeight, 1);
});

test("a perfect tree needs no hoisting and every node owns what it calls", () => {
  const g = buildGraph({
    declarations: ["r", "a", "b", "c", "d"].map((id) => decl(id)),
    edges: [edge("r", "a"), edge("r", "b"), edge("a", "c"), edge("a", "d")],
  });
  const gaps = elevationGaps(g);
  assert.equal(gaps.total, 0);
  assert.equal(gaps.flat, 4);
  assert.equal(gaps.gapSum, 0);
  assert.equal(independence(g).overall, 1);
  assert.deepEqual(
    entryPoints(g).map((n) => n.id),
    ["r"],
  );
});

test("sharing and cycles show up as hoisting and lost independence", () => {
  const g = buildGraph({
    declarations: ["r", "a", "b", "shared"].map((id) => decl(id)),
    edges: [edge("r", "a"), edge("r", "b"), edge("a", "shared"), edge("b", "shared"), edge("shared", "a")],
  });
  // "a" and "shared" are mutually reachable, so they share one tree position
  // and the edges between them have no lift at all. What is left is r's two
  // dependencies (lift 0) and b -> shared, one scope below where it must live.
  //
  // On the height axis it plays out differently: the {a, shared} cycle calls
  // nothing outside itself, so as a unit it sits at the very bottom — while
  // r, two calls above it, reaches straight down to `a` in one hop. That is
  // a real gap of 1, even though r->b and b->shared are each a clean single
  // layer.
  const gaps = elevationGaps(g);
  assert.deepEqual(
    gaps.buckets.map((bucket) => [bucket.gap, bucket.edges.length]),
    [[1, 1]],
  );
  assert.equal(gaps.flat, 2);
  assert.equal(independence(g).overall, (1 + 1 + 1 / 2) / 3);
  const score = new Map(independence(g).nodes.map((entry) => [entry.node.id, entry.score]));
  assert.equal(score.get("r"), 1); // owns both of its dependencies outright
  assert.equal(score.get("b"), 0.5); // its one dependency is shared with a sibling
  assert.deepEqual(
    entryPoints(g).map((n) => n.id),
    ["r"],
  );
});

test("empty graph does not divide by zero", () => {
  const g = buildGraph({ declarations: [], edges: [] });
  assert.equal(independence(g).overall, 1);
  assert.deepEqual(independence(g).nodes, []);
  assert.equal(elevationGaps(g).total, 0);
  assert.deepEqual(entryPoints(g), []);
});

test("heights, degrees and diagnostics use the control graph only", () => {
  const g = buildGraph({
    declarations: ["main", "helper", "T", "Base", "Impl"].map((id) => decl(id)),
    edges: [
      edge("main", "helper", "call"),
      edge("main", "T", "type"),
      edge("main", "Impl", "create"),
      edge("Impl", "Base", "extends"),
      edge("helper", "main", "reference"), // value flow, not a call: no cycle
    ],
  });
  assert.equal(g.links.length, 5);
  assert.equal(g.activeLinks.length, 2);
  assert.equal(g.byId.get("main").outDegree, 2);
  assert.equal(g.byId.get("T").inDegree, 0);
  assert.equal(g.byId.get("main").height, 1);
  assert.equal(g.byId.get("Base").height, 0);
  assert.equal(g.byId.get("main").inCycle, false);
  assert.equal(elevationGaps(g).flat, 2); // both active edges reach exactly the layer below main
  // A type-only target nothing calls is still an entry point of the control
  // graph, which is what the diagnostics are computed on. Sorted by name the
  // way the panel lists them, so the order is a collation, not the id order.
  assert.deepEqual(
    entryPoints(g).map((n) => n.id),
    ["Base", "main", "T"],
  );
  // Switching the diagnosed kinds recomputes degrees, heights and cycles.
  applyActiveKinds(g, new Set(["call", "reference"]));
  assert.equal(g.activeLinks.length, 2);
  assert.equal(g.byId.get("main").inCycle, true);
  assert.equal(g.byId.get("main").inDegree, 1);
  assert.equal(g.byId.get("Impl").inDegree, 0);
  // main and helper are now one cycle, so they share one call height: both
  // edges between them have no direction to measure a drop across, and
  // neither counts even as flat.
  const cyclic = elevationGaps(g);
  assert.equal(cyclic.total, 0);
  assert.equal(cyclic.flat, 0);
  assert.deepEqual(independence(g).nodes, []);
  applyActiveKinds(g, new Set(["call", "create"]));
  assert.equal(g.byId.get("main").inCycle, false);
});

test("connectedComponents returns the pieces themselves, largest first, with their own links", () => {
  const g = buildGraph({
    declarations: ["m", "a", "b", "x", "y", "alone"].map((id) => decl(id)),
    edges: [edge("m", "a"), edge("a", "b"), edge("x", "y")],
  });
  const comps = connectedComponents(g.nodes, g.links);
  assert.deepEqual(
    comps.map((c) => c.nodes.map((n) => n.name)),
    [
      ["a", "b", "m"],
      ["x", "y"],
      ["alone"],
    ],
    "largest first, members name-ordered inside each",
  );
  assert.deepEqual(
    comps.map((c) => c.links.length),
    [2, 1, 0],
    "every link lands in the component holding both its endpoints",
  );
});
