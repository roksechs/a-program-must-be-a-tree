import { test } from "node:test";
import assert from "node:assert/strict";
import { buildGraph } from "../site/js/model.js";
import { visibleContainers } from "../site/js/zones.js";
import { DEFAULT_PHYSICS, applyStoredLayout, layoutOf, seedPositions } from "../site/js/simulation.js";

const decl = (id, file) => ({ id, name: id, kind: "function", file });

test("zone depth counts directories and then files", () => {
  const g = buildGraph({
    declarations: [decl("a", "src/core/x.js"), decl("b", "src/core/y.js"), decl("c", "src/util/z.js"), decl("d", "top.js")],
    edges: [],
  });
  const paths = (depth) => visibleContainers(g, 0, depth).map((c) => c.path).sort();
  assert.deepEqual(paths(0), []);
  assert.deepEqual(paths(1), ["src", "top.js"]);
  assert.deepEqual(paths(2), ["src", "src/core", "src/util", "top.js"]);
  // src/util/z.js is not drawn: it would coincide with its parent src/util.
  assert.deepEqual(paths(3), ["src", "src/core", "src/core/x.js", "src/core/y.js", "src/util", "top.js"]);
  assert.equal(g.maxDepth, 3);
});

test("a depth range shows only that band, an inner zone visible without its outer one", () => {
  const g = buildGraph({
    declarations: [decl("a", "src/core/x.js"), decl("b", "src/core/y.js"), decl("c", "src/util/z.js"), decl("d", "top.js")],
    edges: [],
  });
  const paths = (min, max) => visibleContainers(g, min, max).map((c) => c.path).sort();
  // Depth 2 only: the subdirectories, without "src" (depth 1) or the files (depth 3).
  assert.deepEqual(paths(2, 2), ["src/core", "src/util"]);
  // Depth 3 only: just the files (top.js is depth 1, so it drops out of this
  // band). src/util/z.js is its directory's only file, so the two would
  // ordinarily coincide (see the next test) — but with src/util (depth 2)
  // itself out of this range, there is nothing for it to coincide with.
  assert.deepEqual(paths(3, 3), ["src/core/x.js", "src/core/y.js", "src/util/z.js"]);
  // An empty band (both ends at 0, the default) shows nothing at all.
  assert.deepEqual(paths(0, 0), []);
});

test("a container identical to its visible parent is not drawn twice, but only once its parent is also in range", () => {
  const g = buildGraph({ declarations: [decl("a", "lib/only.js"), decl("b", "lib/only.js")], edges: [] });
  assert.deepEqual(visibleContainers(g, 0, 2).map((c) => c.path), ["lib"]);
  // With the directory hidden the file itself is the outermost visible container.
  assert.deepEqual(visibleContainers(g, 0, 1).map((c) => c.path), ["lib"]);
  // The file's own depth (2) alone, without the directory (1) in range at
  // all: nothing to coincide with, so the file itself is shown.
  assert.deepEqual(visibleContainers(g, 2, 2).map((c) => c.path), ["lib/only.js"]);
});

test("physics has no container-dependent parameters and seeding ignores files", () => {
  assert.equal("cohesion" in DEFAULT_PHYSICS, false);
  const a = buildGraph({ declarations: [decl("a", "x/one.js"), decl("b", "y/two.js")], edges: [] });
  const b = buildGraph({ declarations: [decl("a", "same.js"), decl("b", "same.js")], edges: [] });
  seedPositions(a);
  seedPositions(b);
  assert.deepEqual(
    a.nodes.map((n) => [n.x, n.y]),
    b.nodes.map((n) => [n.x, n.y]),
  );
});

test("a document's stored layout is used when it is complete, and ignored when it is not", () => {
  const doc = (positions) => ({
    declarations: [
      { id: "a", name: "a", kind: "function", file: "src/a.js", ...(positions[0] ?? {}) },
      { id: "b", name: "b", kind: "function", file: "src/a.js", ...(positions[1] ?? {}) },
    ],
    edges: [{ source: "a", target: "b", kind: "call" }],
  });

  const full = buildGraph(doc([{ x: 10, y: -20 }, { x: 30, y: 40 }]));
  assert.equal(applyStoredLayout(full), true);
  assert.deepEqual(
    full.nodes.map((n) => [n.x, n.y]),
    [
      [10, -20],
      [30, 40],
    ],
  );

  // Half a layout is worse than none: settled nodes beside nodes at the
  // origin read as a bug, so the caller falls back to the seed instead.
  const partial = buildGraph(doc([{ x: 10, y: -20 }]));
  assert.equal(applyStoredLayout(partial), false);
  const none = buildGraph(doc([]));
  assert.equal(applyStoredLayout(none), false);

  // And what it hands back is what the format stores.
  seedPositions(none);
  assert.deepEqual(
    layoutOf(none).map((p) => p.id),
    ["a", "b"],
  );
  assert.ok(layoutOf(none).every((p) => Number.isFinite(p.x) && Number.isFinite(p.y)));
});

test("laying a document out fills in every position, and anneals until the runs stop improving", async () => {
  // The layout is what the build step writes into a dataset and what the
  // worker computes after an in-browser analysis (site/js/layout.js is the
  // single copy both run). d3 is a global there, the way the browser loads it.
  const d3 = await import("d3");
  Object.defineProperty(globalThis, "d3", { value: d3, configurable: true });
  const { layOutDocument } = await import("../site/js/layout.js");

  const doc = {
    declarations: ["a", "b", "c", "d", "e"].map((id) => ({ id, name: id, kind: "function", file: "src/a.js" })),
    edges: [
      { source: "a", target: "b", kind: "call" },
      { source: "b", target: "c", kind: "call" },
      { source: "a", target: "d", kind: "call" },
      { source: "d", target: "e", kind: "call" },
    ],
  };
  const result = layOutDocument(doc);
  assert.equal(result.nodes, 5);
  assert.ok(doc.declarations.every((d) => Number.isFinite(d.x) && Number.isFinite(d.y)), "every declaration gets a position");
  // "settled" = successive annealing runs agreed; "floor" = they stopped
  // improving. Either is a measured stop; "capped"/"runs" would mean it gave
  // up against a backstop, which on a graph this small would be a bug.
  assert.ok(["settled", "floor"].includes(result.reason), `stopped on a measured criterion, not a backstop (got ${result.reason})`);
  assert.ok(result.runs >= 1, "it anneals at least once");
  assert.ok(result.ticks > 0 && result.ticks < 40000);

  // And what it wrote is what the viewer opens on.
  const laid = buildGraph(doc);
  assert.equal(applyStoredLayout(laid), true);

  // An empty document is not an error.
  assert.deepEqual(layOutDocument({ declarations: [], edges: [] }), { ticks: 0, runs: 0, reason: "empty", nodes: 0 });
});
