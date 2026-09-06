# Changelog

The section for a version becomes the notes of its GitHub release
(`.github/workflows/release.yml`), which is cut when the version in
`package.json` reaches the default branch.

## Unreleased

### Analyzer split into a portable core, to run in the browser next

* `analyzers/ts/analyze.mjs` used to both find source files on disk and walk
  the resulting `ts.Program`. Split into `analyzers/ts/core.mjs` (the
  `ts.Program` walk, touching nothing outside the `ts` module it is handed —
  no `node:fs`, `node:path`, `node:url`) and a thinner `analyze.mjs` that
  keeps only the Node-specific half (`listSourceFiles`, building the Program
  via `ts.sys`, the CLI). Same public `analyze(options)` signature, same
  output; this is what lets a second front end (the local-folder feature
  being added next, running the same analysis on a Program built in-browser
  over files read with the File System Access API) reuse the real analyzer
  instead of a reimplementation.
* Doing this exposed a real, previously-latent analyzer bug: a top-level
  destructuring declaration (`const { helper } = make();`) named no
  declaration of its own (correct — a destructured local isn't nameable) but
  also never fell back to being counted as module code, so `make()`'s call
  was silently dropped from the graph entirely. Nothing in the codebase had
  ever written a top-level destructuring declaration before `core.mjs`
  itself did (`const { analyzeProgram } = createCore(ts);`), and `metrics.js`'s
  `unreferencedDeclarations` (above) caught it on the first run against the
  refactored source. Fixed: such a declaration's initializer is now pushed
  onto the file's module-code list, same as a bare expression statement.

### `metrics.js` can tell you what nothing calls, and removes what it found

* "Is anything unreferenced" is a question about the graph, so the graph
  model answers it: `unreferencedDeclarations(graph)` (`metrics.js`) returns
  every top-level function/class or class member with zero incoming edges of
  any kind — a `module` node and a local declaration (an options-object
  callback such as `{ onFit: () => {…} }`) are excluded, since the analyzer
  cannot trace a call reaching the latter through a stored reference.
  `test/dead-code.test.mjs` runs it against the viewer, the analyzer and the
  scripts/tests themselves; a second check in the same file flags a CSS
  custom property declared in `site/*.css` but never read with `var(...)`.
* Written after two rounds of hand-hunting turned up leftovers from the
  `graph2d.js` removal below: `Graph3D.show()`, `zones.js`'s `topPoint`, and
  14 unused CSS custom properties (2 orphaned by that removal, 12
  pre-existing — most of a Material Design 3 color-role/shape/elevation/state
  set that was never fully consumed). The first version of the check lived
  only in the test and excluded local declarations by checking `id.includes
  ("/")` on the *whole* id — wrong, since every id under a subdirectory
  already has one from its file path; the test itself (using a fixture file
  under `src/a.js`) caught the bug once the check moved to `metrics.js` and
  got real unit tests of its own.

### Analyzer: a function-valued object literal property is a declaration

* `f({ onFit: () => {…}, onLabels(mode) {…} })` — a handler/options object
  built inline and passed straight into a call, never assigned to a name in
  between — used to have its properties' bodies silently folded into
  whichever declaration made the call, because the analyzer only recognised
  a function value as nameable when it was the initializer of a variable
  declaration. `onFit` and `onLabels` here are exactly as named as that
  case: ECMAScript's own NamedEvaluation gives an object literal's
  function-valued property the property key as its name
  (`{ m(){} }.m.name === "m"`), the same rule a `const m = () => {}` relies
  on, so they were never truly anonymous. And unlike a genuine property
  *store* (`el.cb = fn` where `el` is a value that can escape and be read
  back by anyone who later holds it), a bare object literal passed as an
  argument has exactly one reader, syntactically visible at the call site —
  so nothing is lost by declaring it. `onFit`/`onLabels` are now their own
  declarations, `<calling declaration>/<property name>`, the same shape as a
  `--nested` local declaration and — because the value is handed to another
  declaration entirely and invoked back by it later, not merely more of the
  caller's own code — unconditional rather than gated behind `--nested`
  (docs/THEORY.md §4.1, Definition 9a).
* This was not a cosmetic fix: on this project's own `self` dataset it
  changes 203 declarations/431 edges to 243/459, and it changes real
  third-party code too — analyzing bundled d3 packages picks up 12 more
  declarations in `d3-force` alone (22 → 34) and 5 more in `d3-zoom`, all
  previously-invisible event-handler bodies. `analyzers/ts@0.4.0`.
* Directly fixes the false positive `convergentOperations` (below) found in
  this project's own property panel wiring: `panel -> {onFit, onLabels,
  onColorBy, …} -> draw` no longer appears, because those handlers are no
  longer folded into the `panel` variable that merely constructs them.

### Diagnostics: `convergentOperations`, a new shared-declaration finding

* `metrics.js` gains `convergentOperations(graph, minWidth = 2)`: finds a
  declaration that directly calls several distinct declarations which all
  independently call the same shared node — the shape a single logical
  operation takes once it has been decomposed into several steps instead of
  one, rather than a coincidence of unrelated code needing the same thing.
  Running it on this project found `installGraph()` calling five setters
  that each separately trigger `Graph3D#draw` (and the article page's
  `createFigure()` doing the same, worse, across nine) — real, previously
  unnoticed instances of exactly the pattern `nodeRadius()` turned out to be
  a different kind of. Like every other shared-declaration finding this tool
  surfaces, it only narrows down where to look: it cannot tell a costly,
  stateful convergence worth collapsing into one operation from a cheap,
  pure one that is completely harmless to reach from several siblings — that
  judgement is still a person's to make. Running it also turned up a real
  false positive of a different kind, from the analyzer misattributing an
  object literal's callback properties (`panel -> {onFit, onLabels, …} ->
  draw`) rather than from any ambiguity `convergentOperations` itself has to
  weigh; see the analyzer fix above, which removes it.

### Viewer: node radius is a model field, not a borrowed function

* `nodeRadius()` lived in `simulation.js` — a physics concern — and both
  renderers imported it purely because it happened to be exported from
  there, not because rendering has anything to do with physics. It is now
  `n.radius`, computed in `model.js` alongside `inDegree`/`outDegree`/
  `height` whenever the active edge kinds change, the same place that
  already owns every other number derived from a node's degree. This is not
  a cosmetic move: analyzing this project on itself, the 5-7 calls to
  `nodeRadius()` were real edges in its own call graph (`multiCallers` and
  `surplusEdges` both drop, `treeScore` rises slightly) — sharing a
  low-level formula across unrelated modules because it was convenient to
  import, rather than because those modules had a common concept to depend
  on, was exactly the kind of exposure the project's own diagnostics exist
  to surface.

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
* `write` is a new toggle in the Edges section, alongside every other kind
  (every kind, including `write` and `type`, starts enabled — see "Every edge
  kind enabled by default", below): mixing a reversed edge into the control
  or uses graph without noticing would misread the dominator tree, so a graph
  where that matters can turn `write` back off as its own lens.
* Every edge kind now bows into its own quadratic curve instead of running
  straight, through one shared function (`colors.js`'s `edgeBowOffset`) both
  renderers call: the perpendicular obtained by rotating a seed vector around
  the segment's own axis, which has no height component regardless of the two
  ends' heights, so 2D (no height axis at all) and 3D bow through the same
  offset. Originally just `reference` and `write`, so the read and write
  halves of a compound assignment would fan out instead of overlapping; now
  every kind gets its own offset (see below), for the same reason applied to
  every pair of kinds that can share two nodes.

### Viewer: 3D camera fixes, double-click focus, Material Design 3

* Double-clicking a node selects and focuses it, in both the 2D and the 3D
  renderer.
* Shift-drag panning in 3D used to add a screen-space offset, so the orbit
  pivot drifted away from screen centre after panning. Panning now moves the
  orbit target itself, in world space, so orbiting still pivots exactly on
  screen centre no matter how far the view has been panned.
* Orbit dragging in 3D now uses the Pointer Lock API instead of tracking the
  cursor's absolute position, so rotating past a physical screen or trackpad
  edge no longer stops the drag — a full rotation, including viewing the
  graph from underneath, is always reachable.
* The whole site is restyled to Material Design 3: colour roles, shape
  scale, elevation and state-layer tokens in `site/styles.css`, with a
  `prefers-color-scheme: dark` palette. `article.css` follows the same
  tokens for code blocks, tables and the live-graph figures.

### Viewer: main view is 3D-only, physics tuning, less eager auto-behaviour

* The main viewer no longer has a 2D/3D switch: it always renders in 3D, with
  a new "Top view" camera preset (orthographic, looking straight down the
  height axis) for the case a 2D rendering used to cover — a plain top-down
  x/y layout is what 3D looks like without perspective, so the SVG renderer
  was drawing the same picture a second, heavier way. `graph2d.js` is
  removed: the article's live figures now render with `graph3d.js` too, and
  a figure that wants the flat top-down layout asks for it with the
  directive `view: top` instead of `view: 2d`.
* Every edge kind starts enabled (`kinds.js`'s `DEFAULT_OFF_KINDS` is now
  empty, was `{type, write}`), so the viewer opens showing the full graph.
* Orbit dragging only engages Pointer Lock once the cursor actually reaches
  the window edge, not on the first pixel of every drag: acquiring the lock
  hides the system cursor, which the browser announces with its own "press
  Esc to exit" banner, and showing that for every ordinary small orbit made
  it far too naggy. Large drags (viewing the graph from underneath, say)
  still reach past the screen's edge exactly as before.
* Toggling an edge kind or changing a physics slider no longer forces a
  reheat (`alpha` up to 0.3): the new spring set or parameter still applies
  immediately, but a layout the user has been looking at is no longer flung
  back into motion just for exploring which edges to look at. "Recompute
  (reheat)" remains the explicit way to ask for a fresh layout.
* `alphaDecay` is tuned down (0.0228 → 0.006, d3's default of ~300 ticks per
  run to roughly 1200), so a layout of any size has time to actually settle
  under every edge kind's springs and the repulsion, instead of cooling on
  top of one that is still rearranging itself.
* "Fit to view" no longer fires on its own — not after a fresh load, not
  once a run settles. It used to do both, which meant the camera could jump
  back to the overview by itself at any moment a run happened to finish
  settling (now a while off, see `alphaDecay` above), overriding a view the
  user had already framed by hand in the meantime. Framing the camera is
  the "Fit to view" button's job alone now; nothing calls it automatically.
* Spring stiffness's default is raised (0.03 → 0.05).
* Edges rendered at a permanent 55% opacity even with nothing selected —
  `dimmed`/`active` already covered every case where a *selected* node
  should mute or highlight an edge, so the 0.55 in between them only ever
  applied when no node was selected at all, muting every kind's colour well
  below its legend swatch (the paler kinds, `reference` especially, nearly
  vanished). Both renderers now default to full opacity and only dim an
  edge once some other node is selected.
* `reference`'s colour was a light grey almost identical to `call`'s. `call`
  is deliberately a muted, low-saturation grey — it is the majority kind in
  almost every real codebase, and the most common edge kind also being the
  loudest colour would drown out everything else — but `reference` is
  typically the *second* most common kind by a wide margin, so the two greys
  together could be nearly the whole graph, reading as one undifferentiated
  colour no matter how the opacity above was fixed. `reference` is now green.

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
