import { test } from "node:test";
import assert from "node:assert/strict";
import { buildGraph, applyActiveKinds } from "../site/js/model.js";
import { pathBetween } from "../site/js/paths.js";

const decl = (id, kind = "function") => ({ id, name: id, kind, file: `${id}.js` });
const edge = (source, target, kind = "call") => ({ source, target, kind });

function graphOf(declarations, edges) {
  const g = buildGraph({ declarations, edges });
  applyActiveKinds(g, new Set(edges.map((e) => e.kind)));
  return g;
}

test("pathBetween finds every node/edge on any route between two nodes, not just the shortest one", () => {
  // a -> b -> d, a -> c -> d: two disjoint routes of the same length.
  const g = graphOf(
    [decl("a"), decl("b"), decl("c"), decl("d")],
    [edge("a", "b"), edge("b", "d"), edge("a", "c"), edge("c", "d")],
  );
  const [a, b, c, d] = g.nodes;
  const result = pathBetween(g, a, d);
  assert.equal(result.reachable, true);
  assert.deepEqual([...result.nodes].map((n) => n.id).sort(), ["a", "b", "c", "d"]);
  assert.equal(result.edges.size, 4);
  assert.equal(result.shortestPath.length, 3); // a -> (b or c) -> d
});

test("pathBetween reports unreachable when there is no directed route", () => {
  const g = graphOf([decl("a"), decl("b")], [edge("b", "a")]); // only b -> a, not a -> b
  const [a, b] = g.nodes;
  const result = pathBetween(g, a, b);
  assert.equal(result.reachable, false);
  assert.equal(result.nodes.size, 0);
  assert.equal(result.shortestPath, null);
});

test("pathBetween excludes a node reachable from the source that cannot itself reach the target", () => {
  // a -> b -> c (target), and separately a -> x (a dead end that never reaches c).
  const g = graphOf(
    [decl("a"), decl("b"), decl("c"), decl("x")],
    [edge("a", "b"), edge("b", "c"), edge("a", "x")],
  );
  const [a, b, c] = g.nodes;
  const result = pathBetween(g, a, c);
  assert.deepEqual([...result.nodes].map((n) => n.id).sort(), ["a", "b", "c"]);
});

test("pathBetween only follows currently active edge kinds", () => {
  const g = buildGraph({
    declarations: [decl("a"), decl("b")],
    edges: [edge("a", "b", "type")],
  });
  applyActiveKinds(g, new Set(["call"])); // "type" is switched off
  const [a, b] = g.nodes;
  assert.equal(pathBetween(g, a, b).reachable, false);
  applyActiveKinds(g, new Set(["call", "type"]));
  assert.equal(pathBetween(g, a, b).reachable, true);
});

test("pathBetween(g, n, n) is trivially reachable with just that one node", () => {
  const g = graphOf([decl("a")], []);
  const [a] = g.nodes;
  const result = pathBetween(g, a, a);
  assert.equal(result.reachable, true);
  assert.deepEqual([...result.nodes], [a]);
  assert.equal(result.edges.size, 0);
  assert.deepEqual(result.shortestPath, [a]);
});
