import { test } from "node:test";
import assert from "node:assert/strict";
import { buildGraph } from "../site/js/model.js";
import { visibleContainers } from "../site/js/zones.js";
import { DEFAULT_PHYSICS, seedPositions } from "../site/js/simulation.js";

const decl = (id, file) => ({ id, name: id, kind: "function", file });

test("zone depth counts directories and then files", () => {
  const g = buildGraph({
    declarations: [decl("a", "src/core/x.js"), decl("b", "src/core/y.js"), decl("c", "src/util/z.js"), decl("d", "top.js")],
    edges: [],
  });
  const paths = (depth) => visibleContainers(g, depth).map((c) => c.path).sort();
  assert.deepEqual(paths(0), []);
  assert.deepEqual(paths(1), ["src", "top.js"]);
  assert.deepEqual(paths(2), ["src", "src/core", "src/util", "top.js"]);
  // src/util/z.js is not drawn: it would coincide with its parent src/util.
  assert.deepEqual(paths(3), ["src", "src/core", "src/core/x.js", "src/core/y.js", "src/util", "top.js"]);
  assert.equal(g.maxDepth, 3);
});

test("a container identical to its visible parent is not drawn twice", () => {
  const g = buildGraph({ declarations: [decl("a", "lib/only.js"), decl("b", "lib/only.js")], edges: [] });
  assert.deepEqual(visibleContainers(g, 2).map((c) => c.path), ["lib"]);
  // With the directory hidden the file itself is the outermost visible container.
  assert.deepEqual(visibleContainers(g, 1).map((c) => c.path), ["lib"]);
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
