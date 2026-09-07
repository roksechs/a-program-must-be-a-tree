import { test } from "node:test";
import assert from "node:assert/strict";
import { buildGraph, applyActiveKinds } from "../site/js/model.js";
import { cycleMotif, hubMotif, diamondMotif, chainMotif } from "../site/js/motifs.js";

const decl = (id) => ({ id, name: id, kind: "function", file: `${id}.js` });
const edge = (source, target, kind = "call") => ({ source, target, kind });

function graphOf(declarations, edges) {
  const g = buildGraph({ declarations, edges });
  applyActiveKinds(g, new Set(edges.map((e) => e.kind)));
  return g;
}

function names(set) {
  return [...set].map((n) => n.id).sort();
}

test("cycleMotif finds a nontrivial cycle's nodes and the edges that stay inside it", () => {
  // a -> b -> c -> a (a cycle), plus a -> d (outside it).
  const g = graphOf(
    [decl("a"), decl("b"), decl("c"), decl("d")],
    [edge("a", "b"), edge("b", "c"), edge("c", "a"), edge("a", "d")],
  );
  const { nodes, edges } = cycleMotif(g);
  assert.deepEqual(names(nodes), ["a", "b", "c"]);
  assert.equal(edges.size, 3);
  for (const e of edges) assert.notEqual(e.target.id, "d");
});

test("cycleMotif finds nothing in an acyclic graph", () => {
  const g = graphOf([decl("a"), decl("b")], [edge("a", "b")]);
  const { nodes, edges } = cycleMotif(g);
  assert.equal(nodes.size, 0);
  assert.equal(edges.size, 0);
});

test("hubMotif flags a node whose degree stands out from the rest", () => {
  // hub calls 5 leaves; every leaf has degree 1, the hub has degree 5.
  const leaves = ["l1", "l2", "l3", "l4", "l5"];
  const g = graphOf(
    [decl("hub"), ...leaves.map(decl)],
    leaves.map((l) => edge("hub", l)),
  );
  const { nodes } = hubMotif(g, { minDegree: 3 });
  assert.ok([...nodes].some((n) => n.id === "hub"));
  assert.ok(![...nodes].some((n) => n.id === "l1"));
});

test("hubMotif finds nothing when every node has the same low degree", () => {
  const g = graphOf([decl("a"), decl("b"), decl("c")], [edge("a", "b"), edge("b", "c")]);
  const { nodes } = hubMotif(g, { minDegree: 3 });
  assert.equal(nodes.size, 0);
});

test("diamondMotif finds A -> {B,C} -> D but not a plain single route", () => {
  const g = graphOf(
    [decl("a"), decl("b"), decl("c"), decl("d"), decl("e")],
    [edge("a", "b"), edge("a", "c"), edge("b", "d"), edge("c", "d"), edge("a", "e")],
  );
  const { nodes, edges } = diamondMotif(g);
  assert.deepEqual(names(nodes), ["a", "b", "c", "d"]);
  assert.equal(edges.size, 4);
});

test("diamondMotif requires at least two distinct intermediate routes", () => {
  const g = graphOf([decl("a"), decl("b"), decl("c")], [edge("a", "b"), edge("b", "c")]);
  const { nodes } = diamondMotif(g);
  assert.equal(nodes.size, 0);
});

test("chainMotif finds a linear pipeline with no branching, long enough to count", () => {
  // a -> b -> c -> d -> e, every intermediate node in-degree 1 / out-degree 1.
  const g = graphOf(
    [decl("a"), decl("b"), decl("c"), decl("d"), decl("e")],
    [edge("a", "b"), edge("b", "c"), edge("c", "d"), edge("d", "e")],
  );
  const { nodes, edges } = chainMotif(g, { minLength: 4 });
  assert.deepEqual(names(nodes), ["a", "b", "c", "d", "e"]);
  assert.equal(edges.size, 4);
});

test("chainMotif stops at a branch and excludes a run shorter than minLength", () => {
  // a -> b -> c, but c also has another caller x -> c: c is not pass-through (in-degree 2).
  const g = graphOf(
    [decl("a"), decl("b"), decl("c"), decl("x")],
    [edge("a", "b"), edge("b", "c"), edge("x", "c")],
  );
  const { nodes } = chainMotif(g, { minLength: 3 });
  // a -> b -> c is only 3 nodes and the middle (b) is pass-through, but the
  // walk still correctly stops at c (not pass-through) rather than merging
  // in x's edge; the whole run is exactly 3 nodes, meeting minLength here.
  assert.deepEqual(names(nodes), ["a", "b", "c"]);
});

test("motifs only follow currently active edge kinds", () => {
  const g = buildGraph({
    declarations: [decl("a"), decl("b"), decl("c")],
    edges: [edge("a", "b", "type"), edge("b", "c", "type"), edge("c", "a", "type")],
  });
  applyActiveKinds(g, new Set(["call"])); // "type" switched off
  assert.equal(cycleMotif(g).nodes.size, 0);
  applyActiveKinds(g, new Set(["call", "type"]));
  assert.equal(cycleMotif(g).nodes.size, 3);
});
