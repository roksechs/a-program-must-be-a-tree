# Changelog

The section for a version becomes the notes of its GitHub release
(`.github/workflows/release.yml`), which is cut when the version in
`package.json` reaches the default branch.

## Unreleased

### Analyzer and viewer: `write` edges

* An occurrence that is the target of an assignment (`x = e`), a compound
  assignment (`x += e`, ...) or `x++` / `x--` is a **write**, recorded with
  the edge **reversed** — from the variable to whoever writes it — since the
  variable's next value depends on the writer, not the other way around
  (`THEORY.md` §3.5). Compound assignment and `++`/`--` also read the old
  value, so they keep the ordinary `reference` edge for that half; plain
  `x = e` does not. A plain function or class stays a `binding` (`THEORY.md`
  §4.1), the degenerate case of a slot with exactly one writer, at
  definition time — `write` is what a variable with more than one becomes.
* `write` is a new toggle in the Edges section, off by default like `type`:
  mixing a reversed edge into the control or uses graph without noticing
  would misread the dominator tree, so it stays its own lens.
* `reference` and `write` edges are now rotated a small angle around their
  own midpoint (2D and 3D) instead of running straight through both node
  centres, so the read and write halves of a compound assignment fan out
  instead of overlapping.

### The article

* `article.html`: a long-form page that re-reads familiar design principles
  as measurements on the call graph. Chapters are Markdown files under
  `site/content/<lang>/`, listed in `chapters.json`, and every chapter must
  exist in every language (the tests check). A chapter's
  `<!-- graph: … -->` directives mount live graphs beside it, rendered by the
  viewer's own modules on the bundled datasets, with a 2D/3D switch, the
  diagnostics readout, node selection with its natural scope, and a "rename
  every identifier" experiment that shows the numbers do not depend on names.
  First chapters: the hook, structure and meaning, the model, and binding
  versus store.

### Hosting

* `npm run build:site` runs the tests, vendors d3 and regenerates the
  datasets: the one build command a static host needs. `.node-version` pins
  Node 22 for hosts that read it. The README documents the Cloudflare Pages
  settings (build command, output directory `site`), which gives every pull
  request a preview URL, and `wrangler.jsonc` lets a Cloudflare Workers
  project serve `site/` as static assets with the same build.

### Analyzer: assignments that declare

* A top-level assignment through a path of names is a **declaration**, not
  module code: `ns.f = function` a static member, `C.prototype.m = function`
  an instance member, `proto.m = m` an alias (`m` gains the member role, no
  new node), `exports.f = …` an export, `d3.scale = {}` a binding on an
  undeclared global with its qualified name. The same assignment inside a
  function body is a flagged **late binding** when the receiver is a
  module-level name and a plain store when it is a value (`THEORY.md` §4.1).
* Calls on receivers the type checker cannot type are resolved by name
  path (`d3.scale.linear()`), by `this` inside a member, or to every
  instance member of that name (field-based, marked `inferred`).
* Declarations gain optional `late` and `aliases` fields (`DATA_FORMAT.md`).
* `--nested`: named local functions become declarations of their own
  (`<parent>/<name>`), so a function made of closures can be diagnosed like a
  module. Off by default. The bundled `self-nested` dataset is this
  repository in that view.
* Measured effect: moment 2.29.0 goes from 313 to 807 control edges; d3
  v3.5.17 from 203 `module` nodes to 25.
* One name resolver inside the analyzer instead of two; `class C extends
  ns.Base` now resolves through the path `ns.Base` like any other name.
* New bundled dataset `sample-bindings`, analyzed from `samples/bindings/`:
  one file per way a property assignment is read (a binding on an undeclared
  global, prototype members and an alias, a late binding, stores, CommonJS
  exports), so each can be looked at in the viewer.

## v0.2.0

### Diagnostics: directed, and aware of distance

* The spanning ratio counts **roots** instead of weakly connected components.
  Counting components is the undirected notion, so `A -> S <- B` used to score
  1.0 although `S` has two callers; it now scores 0.5.
* New **locality** metric. The graph is condensed, the dominator tree is
  computed, and every edge gets a **lift**

  ```
  lift(a -> b) = depth(a) - depth(idom(b))
  ```

  the number of scopes `b` had to be hoisted out of `a` to stay reachable from
  its other users. 0 is a nesting edge, 1 is two siblings sharing a helper,
  more means the callers sit in unrelated parts of the program. Locality is the
  mean of `1 / (1 + lift)` and joins the tree score, which is now the mean of
  five ratios.
* **Most costly sharing** ranks by summed lift instead of caller count: in the
  self dataset `nodeRadius` (7 callers, lift 16) outranks `state` (13 callers,
  lift 13).
* The selection panel names each declaration's **natural scope** — its
  immediate dominator, where it could live if the program were a tree — and the
  lift of every edge into it.
* Surplus edges is now the number of extra incoming edges,
  `sum of max(0, indeg - 1)`.

### Physics: two forces and nothing else

* The layout is the `1/d` repulsion, with no range limit, and the edge springs.
  A spring is the only attraction, so two declarations sit next to each other
  only when something connects them.
* Removed: the gravity pull towards the origin (its equilibrium against a `1/d`
  repulsion is a uniformly filled disc, which is why every graph came out as a
  circle), the repulsion range cut-off, and `forceCenter`. No point in the
  plane is privileged; framing is the camera's job.

### Analyzer

* Calls through a **union type** (`Object.values(renderers)`) and through a
  **record indexed at run time** (`renderers[view].fit()`) now reach every
  candidate, marked inferred and drawn dashed. Nine live `Graph3D` methods used
  to look uncalled.
* `new C()` records the read of the class binding alongside the `create` edge
  to the constructor it runs, so classes are no longer roots.
* Roots in the self dataset go from 20 to 10, and all ten are module entry
  points.

### Also

* English and Japanese UI, every string through `t()`.
* Edge kinds derived from the calculus in `docs/THEORY.md`: `create`, dynamic
  dispatch, `override` / `implements`, definition time vs use time, and a
  bounded 0-CFA that lifts callbacks into calls.
* Module nodes for top-level code, a unified directory / file depth slider,
  zones fully decoupled from the physics, and a fixed 3D camera.

Still 0.x on purpose: `docs/DATA_FORMAT.md` is free to move.

## v0.1.0

First release: the D3 force-directed declaration graph, directory and file
zones, the property panel with the physics controls and the tree-likeness
diagnostics, the 3D call-height view, the TypeScript / JavaScript analyzer and
the GitHub Pages deployment.
