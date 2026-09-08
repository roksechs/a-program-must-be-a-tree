import { test } from "node:test";
import assert from "node:assert/strict";
import { buildGraph } from "../site/js/model.js";
import { dominatorTree } from "../site/js/dominance.js";
import { entryPoints, independence, linkLift, naturalScope, scopeEscapes, unreferencedDeclarations } from "../site/js/metrics.js";

const decl = (id) => ({ id, name: id, kind: "function", file: "src/a.js" });
const edge = (source, target, kind = "call") => ({ source, target, kind });
const graph = (ids, edges) => buildGraph({ declarations: ids.map(decl), edges });
const lift = (g, from, to) => linkLift(g, g.links.find((l) => l.source.id === from && l.target.id === to));

test("a chain is its own dominator tree", () => {
  const g = graph(["a", "b", "c"], [edge("a", "b"), edge("b", "c")]);
  const dom = dominatorTree(g.nodes, g.activeLinks);
  assert.deepEqual([...dom.lifts], [0, 0]);
  const escapes = scopeEscapes(g);
  assert.equal(escapes.escapes, 0); // nothing had to be hoisted anywhere
  assert.equal(escapes.nesting, 2);
  assert.equal(independence(g).overall, 1);
});

test("two unrelated callers of one declaration are not a tree", () => {
  // The whole point: A -> S <- B is a spanning forest when direction is
  // ignored, so the old (n - components) / m scored it 1.
  const g = graph(["a", "b", "s"], [edge("a", "s"), edge("b", "s")]);
  const escapes = scopeEscapes(g);
  assert.equal(escapes.escapes, 2); // both callers had to hoist s out of themselves
  assert.equal(escapes.nesting, 0);
  assert.deepEqual(
    escapes.buckets.map((b) => [b.lift, b.edges.length]),
    [[1, 2]],
  );
  assert.equal(independence(g).overall, 0.5); // both callers sit one scope below the natural one
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
  assert.deepEqual(
    scopeEscapes(near).buckets.map((b) => b.lift),
    [1],
  );
  assert.deepEqual(
    scopeEscapes(far).buckets.map((b) => b.lift),
    [3],
  );
  // The same one shared declaration, reached from three scopes further out:
  // the caller that shares it scores as markedly less independent. Compared
  // per node, not through `overall` — that is an edge-weighted mean, so the
  // longer graph's six extra well-nested edges would dilute its two bad ones
  // and make the worse graph look better.
  const nearScore = new Map(independence(near).nodes.map((s) => [s.node.id, s.score]));
  const farScore = new Map(independence(far).nodes.map((s) => [s.node.id, s.score]));
  assert.equal(nearScore.get("a"), 0.5);
  assert.equal(farScore.get("a2"), 0.25);
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

test("independence weights sharing by distance, not by how many others share it", () => {
  // "near" reaches a helper shared with two siblings; "far" reaches one
  // hoisted three scopes up and shared with nobody else at that distance. A
  // count of outside users would rank near as worse; the lift says otherwise.
  const g = graph(
    ["r", "x", "y", "near", "p", "p1", "p2", "far"],
    [
      edge("r", "x"),
      edge("r", "y"),
      edge("x", "near"),
      edge("y", "near"),
      edge("r", "p"),
      edge("p", "p1"),
      edge("p1", "p2"),
      edge("p2", "far"),
      edge("r", "far"),
    ],
  );
  const score = new Map(independence(g).nodes.map((s) => [s.node.id, s.score]));
  assert.equal(score.get("x"), 0.5); // one callee, lift 1
  assert.equal(score.get("p2"), 0.25); // one callee, lift 3 — further out, so worse
  assert.ok(score.get("p2") < score.get("x"));
});

test("independence is 1 for a node that owns everything it calls, and absent for one that calls nothing", () => {
  const g = graph(["r", "a", "b"], [edge("r", "a"), edge("r", "b")]);
  const scores = independence(g).nodes;
  assert.deepEqual(
    scores.map((s) => s.node.id),
    ["r"], // a and b call nothing, so they have nothing to own and get no score
  );
  assert.equal(scores[0].score, 1);
  assert.equal(scores[0].callees, 2);
});

test("entryPoints are the declarations nothing calls", () => {
  const g = graph(["main", "other", "shared"], [edge("main", "shared"), edge("other", "shared")]);
  assert.deepEqual(
    entryPoints(g).map((n) => n.id),
    ["main", "other"],
  );
});

test("a cycle's own edges are neither hoisted nor counted against independence", () => {
  const g = graph(["r", "a", "b"], [edge("r", "a"), edge("a", "b"), edge("b", "a")]);
  const escapes = scopeEscapes(g);
  assert.equal(escapes.escapes, 0);
  assert.equal(escapes.nesting, 1); // only r -> a; a <-> b is inside the component
  assert.deepEqual(
    independence(g).nodes.map((s) => s.node.id),
    ["r"],
  );
});

test("unreferencedDeclarations finds a declaration with no incoming edge, ignoring module nodes and local declarations", () => {
  const g = buildGraph({
    declarations: [
      { id: "src/a.js::main", name: "main", kind: "function", file: "src/a.js" },
      { id: "src/a.js::used", name: "used", kind: "function", file: "src/a.js" },
      { id: "src/a.js::dead", name: "dead", kind: "function", file: "src/a.js" },
      { id: "src/a.js::module", name: "module", kind: "module", file: "src/a.js" }, // never itself a target
      { id: "src/b.js::main/onClick", name: "onClick", kind: "function", file: "src/b.js" }, // local declaration, never counted
    ],
    edges: [{ source: "src/a.js::main", target: "src/a.js::used", kind: "call" }],
  });
  assert.deepEqual(
    unreferencedDeclarations(g).map((n) => n.id),
    ["src/a.js::main", "src/a.js::dead"],
  );
});

test("unreferencedDeclarations counts every edge kind, not just the currently active ones", () => {
  const g = buildGraph({
    declarations: [
      { id: "a", name: "a", kind: "function", file: "src/a.js" },
      { id: "b", name: "b", kind: "function", file: "src/a.js" },
    ],
    edges: [{ source: "a", target: "b", kind: "reference" }], // not in the default control graph (call/create)
  });
  assert.deepEqual(
    unreferencedDeclarations(g).map((n) => n.id),
    ["a"],
  );
});
