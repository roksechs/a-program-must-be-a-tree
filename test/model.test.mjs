import { test } from "node:test";
import assert from "node:assert/strict";
import { applyActiveKinds, buildGraph, computeHeights, connectedComponentCount, stronglyConnectedComponents } from "../site/js/model.js";
import { computeMetrics, topSharedNodes } from "../site/js/metrics.js";

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
  assert.equal(h("c"), 0);
  assert.equal(h("b"), 1);
  assert.equal(h("a"), 2);
  assert.equal(h("main"), 3);
  assert.equal(h("x"), h("y"));
  assert.equal(h("x"), 1);
  assert.equal(g.byId.get("x").inCycle, true);
  assert.equal(g.byId.get("main").inCycle, false);
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
  assert.equal(connectedComponentCount(g.nodes, g.links), 1);
  assert.equal(computeHeights(g.nodes, g.links).maxHeight, 1);
});

test("metrics of a perfect tree are all 1", () => {
  const g = buildGraph({
    declarations: ["r", "a", "b", "c", "d"].map((id) => decl(id)),
    edges: [edge("r", "a"), edge("r", "b"), edge("a", "c"), edge("a", "d")],
  });
  const m = computeMetrics(g);
  assert.equal(m.treeScore, 1);
  assert.equal(m.acyclicity, 1);
  assert.equal(m.singleCallerRatio, 1);
  assert.equal(m.dagness, 1);
  assert.equal(m.overall, 1);
  assert.equal(m.roots, 1);
  assert.equal(m.leaves, 3);
  assert.equal(m.maxHeight, 2);
  assert.equal(m.surplusEdges, 0);
  assert.deepEqual(topSharedNodes(g), []);
});

test("metrics degrade with shared callees and cycles", () => {
  const g = buildGraph({
    declarations: ["r", "a", "b", "shared"].map((id) => decl(id)),
    edges: [edge("r", "a"), edge("r", "b"), edge("a", "shared"), edge("b", "shared"), edge("shared", "a")],
  });
  const m = computeMetrics(g);
  assert.equal(m.nodes, 4);
  assert.equal(m.edges, 5);
  assert.equal(m.components, 1);
  assert.equal(m.surplusEdges, 2);
  assert.ok(m.treeScore < 1);
  assert.equal(m.treeScore, 3 / 5);
  assert.equal(m.nontrivialSccs, 1);
  assert.equal(m.nodesInCycles, 2);
  assert.equal(m.acyclicity, 0.5);
  // Both "a" (called by r and shared) and "shared" (called by a and b) have two callers.
  assert.equal(m.multiCallers, 2);
  assert.equal(m.singleCallerRatio, 0.5);
  assert.equal(m.dagness, 1 - 2 / 5);
  assert.deepEqual(
    topSharedNodes(g).map((n) => n.id),
    ["a", "shared"],
  );
});

test("empty graph does not divide by zero", () => {
  const m = computeMetrics(buildGraph({ declarations: [], edges: [] }));
  assert.equal(m.overall, 1);
  assert.equal(m.components, 0);
});

test("heights, degrees and metrics use the control graph only", () => {
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
  const m = computeMetrics(g);
  assert.equal(m.edges, 5);
  assert.equal(m.activeEdges, 2);
  assert.equal(m.treeScore, 1);
  assert.equal(m.nontrivialSccs, 0);
  // Switching the diagnosed kinds recomputes degrees, heights and cycles.
  applyActiveKinds(g, new Set(["call", "reference"]));
  assert.equal(g.activeLinks.length, 2);
  assert.equal(g.byId.get("main").inCycle, true);
  assert.equal(g.byId.get("main").inDegree, 1);
  assert.equal(g.byId.get("Impl").inDegree, 0);
  assert.ok(computeMetrics(g).treeScore < 1);
  applyActiveKinds(g, new Set(["call", "create"]));
  assert.equal(g.byId.get("main").inCycle, false);
});

test("initialisation cycles count definition-time dependencies only", () => {
  const time = (e, t) => ({ ...e, time: t });
  const g = buildGraph({
    declarations: ["a", "b", "f", "g", "T"].map((id) => decl(id)),
    edges: [
      time(edge("a", "b", "call"), "definition"),
      time(edge("b", "a", "reference"), "definition"),
      time(edge("f", "g", "call"), "use"),
      time(edge("g", "f", "call"), "use"),
      time(edge("T", "T", "type"), "definition"),
    ],
  });
  const m = computeMetrics(g);
  assert.equal(m.initCycles, 2); // a and b are read before they are initialised
  assert.equal(m.nontrivialSccs, 1); // f and g: ordinary mutual recursion on the control graph
  assert.equal(g.links.find((l) => l.source.id === "a").time, "definition");
  assert.equal(g.links.find((l) => l.source.id === "f").time, "use");
});
