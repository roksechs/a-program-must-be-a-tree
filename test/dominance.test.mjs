import { test } from "node:test";
import assert from "node:assert/strict";
import { buildGraph } from "../site/js/model.js";
import { dominatorTree } from "../site/js/dominance.js";
import { computeMetrics, linkLift, naturalScope, topSharedNodes } from "../site/js/metrics.js";

const decl = (id) => ({ id, name: id, kind: "function", file: "src/a.js" });
const edge = (source, target, kind = "call") => ({ source, target, kind });
const graph = (ids, edges) => buildGraph({ declarations: ids.map(decl), edges });
const lift = (g, from, to) => linkLift(g, g.links.find((l) => l.source.id === from && l.target.id === to));

test("a chain is its own dominator tree", () => {
  const g = graph(["a", "b", "c"], [edge("a", "b"), edge("b", "c")]);
  const dom = dominatorTree(g.nodes, g.activeLinks);
  assert.deepEqual([...dom.lifts], [0, 0]);
  assert.equal(dom.locality, 1);
  assert.equal(dom.treeEdges, 2);
});

test("two unrelated callers of one declaration are not a tree", () => {
  // The whole point: A -> S <- B is a spanning forest when direction is
  // ignored, so the old (n - components) / m scored it 1.
  const g = graph(["a", "b", "s"], [edge("a", "s"), edge("b", "s")]);
  const m = computeMetrics(g);
  assert.equal(m.treeScore, 0.5); // (3 nodes - 2 roots) / 2 edges
  assert.equal(m.locality, 0.5); // both callers sit one scope below the natural one
  assert.equal(m.surplusEdges, 1);
  assert.equal(lift(g, "a", "s"), 1);
  const scope = naturalScope(g, g.byId.get("s"));
  assert.equal(scope.topLevel, true); // s has to live above both callers
  assert.equal(scope.lift, 1);
});

test("sharing between siblings costs less than sharing across the program", () => {
  const near = graph(["r", "a", "b", "s"], [edge("r", "a"), edge("r", "b"), edge("a", "s"), edge("b", "s")]);
  const far = graph(
    ["r", "a", "a1", "a2", "b", "b1", "b2", "s"],
    [edge("r", "a"), edge("a", "a1"), edge("a1", "a2"), edge("a2", "s"), edge("r", "b"), edge("b", "b1"), edge("b1", "b2"), edge("b2", "s")],
  );
  assert.equal(lift(near, "a", "s"), 1);
  assert.equal(lift(far, "a2", "s"), 3);
  assert.equal(computeMetrics(near).maxLift, 1);
  assert.equal(computeMetrics(far).maxLift, 3);
  // s could still be nested inside r in both graphs, but the second one has to
  // reach three scopes further out for it.
  assert.deepEqual(
    naturalScope(near, near.byId.get("s")).nodes.map((n) => n.id),
    ["r"],
  );
  assert.deepEqual(
    naturalScope(far, far.byId.get("s")).nodes.map((n) => n.id),
    ["r"],
  );
});

test("members of a cycle share one tree position", () => {
  const g = graph(["r", "a", "b", "leaf"], [edge("r", "a"), edge("a", "b"), edge("b", "a"), edge("b", "leaf")]);
  const dom = dominatorTree(g.nodes, g.activeLinks);
  assert.equal(dom.comp[g.byId.get("a").index], dom.comp[g.byId.get("b").index]);
  assert.equal(lift(g, "a", "b"), -1); // inside the component, not an edge of the condensation
  assert.equal(lift(g, "b", "leaf"), 0);
  assert.deepEqual(
    naturalScope(g, g.byId.get("leaf")).nodes.map((n) => n.id).sort(),
    ["a", "b"],
  );
});

test("the most costly sharing is ranked by lift, not by caller count", () => {
  // "near" has three callers one scope away, "far" only two but from the roots
  // of two unrelated chains.
  const g = graph(
    ["r", "x", "y", "z", "near", "p", "p1", "q", "q1", "far"],
    [
      edge("r", "x"),
      edge("r", "y"),
      edge("r", "z"),
      edge("x", "near"),
      edge("y", "near"),
      edge("z", "near"),
      edge("r", "p"),
      edge("p", "p1"),
      edge("p1", "far"),
      edge("r", "q"),
      edge("q", "q1"),
      edge("q1", "far"),
    ],
  );
  const top = topSharedNodes(g);
  assert.deepEqual(
    top.map((s) => s.node.id),
    ["far", "near"],
  );
  assert.equal(top[0].cost, 4); // two callers, two scopes out each
  assert.equal(top[1].cost, 3); // three callers, one scope out each
});
