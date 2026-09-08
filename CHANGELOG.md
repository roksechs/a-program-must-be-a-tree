# Changelog

The section for a version becomes the notes of its GitHub release
(`.github/workflows/release.yml`), which is cut when the version in
`package.json` reaches the default branch.

## Unreleased

### The physics runs only when asked, and datasets carry their layout

* **The camera frames a document when it is installed**, and still never
  moves on its own while a run is going or when one settles — the moments a
  view may already have been framed by hand. This is required by the change
  below, not a taste: a graph used to arrive on the seed, a compact disc
  around the origin the default camera happened to show, and grow into its
  real extent while the user watched. Carrying a settled layout means it
  arrives at that extent — tens of thousands of units across, centred
  wherever the physics left it — and opening a document without the fit
  painted between almost nothing and, for `d3-shape`, nothing at all.
* **A graph opens laid out, having run nothing.** A document may now carry
  `x`/`y` per declaration (`docs/DATA_FORMAT.md`), and `npm run build:data`
  settles every published dataset into one. The viewer opens on it; a document
  without a layout opens on the deterministic seed and says so in the status
  line.
* **"Recompute (reheat)" is the only thing that starts a run.** The
  simulation is created stopped. Opening a document, changing a slider and
  toggling an edge kind no longer set anything in motion — the parameters are
  stored and take effect on the next run.
* Why: a tick costs the whole graph. Both forces are node-against-node, so
  the cost is set by the node count and barely moves with the edges. Measured
  in a browser at 2,138 nodes with positions held fixed so the edge count was
  the only variable, a tick is 21–25ms from 0 edges to 8,000 while drawing
  adds ~1.3µs per edge — and `alphaDecay` runs ~2,300 of them. That was forty
  seconds of an unscrollable page on every open, whether or not the layout
  needed redoing.
* **An analysis the browser ran itself is laid out by the worker that ran
  it**, before it is handed back, behind the progress the analysis was
  already reporting. A folder or a repo has no build step to carry a layout,
  so this is where it comes from; it is off the main thread, and stored with
  the analysis, so a folder pays for it once and never again.
  `site/js/layout.js` is the single copy both producers run, so a dataset and
  a freshly analyzed folder are laid out identically.
* **The layout is annealed repeatedly, until the runs stop improving.** One
  annealing run leaves a layout that "Recompute (reheat)" visibly
  rearranges — on a 2,138-declaration project it moved the arrangement by
  0.45 of its own median radius, half the picture. Pressing it again moved it
  0.17, then 0.10, then 0.05, with the extent converging: the layout was not
  wrong, it was shallow. Annealed to the floor (7 runs, 8,900 ticks on that
  project) a reheat moves it 0.029 and stays there.
* The stop is "the runs stopped improving" and not "the runs got small",
  because that floor is the wander a full-temperature reheat has whatever the
  layout is, and a small graph reaches a high floor immediately — there are
  several comparable arrangements of thirty nodes and reheating picks among
  them. A first attempt used a fixed threshold and eight of the twelve
  published datasets ran to the tick cap; with the improvement test they take
  2 to 6 runs.
* Within a run, the criterion is the change in the *arrangement* — the layout
  centred and scaled by the median distance from its centroid — and not
  absolute displacement, which reads as convergence far too early because it
  falls as much from the layout inflating as from the picture settling. The
  movement left at a fixed temperature is heat, not structure: it is
  proportional to alpha (221e-6 at 0.2 down to 8.6e-6 at 0.002), so only
  cooling removes it.
* **A run that finishes is kept.** Its positions are written back into the
  document, and for an analysis from "Recently opened", back into IndexedDB —
  so reopening a folder is instant and already settled.
* `scripts/settle.mjs` imports `site/js/simulation.js` rather than
  reimplementing the forces, so a stored layout is a point this physics would
  really have reached and pressing reheat does not make the graph jump.
* Removed two dead callbacks: `onDragStart`/`onDragEnd` were wired in `app.js`
  but never called — `graph3d.js`'s drag is the camera, not a node.
* Known analyzer gap, found by this repository's own dead-code check while
  writing the above: a binding destructured out of a dynamic import
  (`const { f } = await import("./m.js")`) is not resolved, though a member
  read off its namespace (`const m = await import("./m.js"); m.f()`) is. The
  two call sites use the namespace form.
* One consequence is now visible immediately rather than after forty seconds
  of drift: a component connected to nothing else has no spring holding it to
  anything, so the unbounded repulsion pushes it away without limit and a
  settled layout has its islands very far out. "Fit to view" frames all of it,
  which makes the main body small. That is the documented physics doing what
  it says; the Islands diagnostic, not the camera, is the way to those pieces.

### Analyzer: two ways a declaration could end up unreachable by construction

`analyzers/ts@0.8.0`. Pointing the new islands diagnostic at a real
application returned hundreds of "islands" that were nothing of the kind, and
both causes were in the analyzer.

* **Declarations could share one id.** A local declaration is
  `<parent>/<name>`, and two object literals inside one declaration can each
  carry an `onclick` — `el("button", { onclick: save })` beside
  `el("input", { onclick: clear })` — with no name of their own to be told
  apart by. The viewer keys nodes by id, so the last declaration won, every
  edge naming that id attached to it, and the earlier ones became nodes no
  edge could ever reach: in-degree and out-degree 0, adrift by construction
  and indistinguishable from dead code. This repository had 12 such nodes,
  `svelte/src` 46. Repeats are now numbered `#2`, `#3`, … in source order,
  leaving every id that never collided as it was.
* **A function written into an object literal had no edge from the
  declaration handing it over.** `f({ m })` has always produced a `reference`
  by resolving the identifier; `f({ m: () => {} })` produced nothing, so the
  two spellings of one thing disagreed about whether the caller depends on
  its own handler — and the inline one, plus whatever only it called, floated
  off. `docs/THEORY.md` §5 recorded the absence as a decision; it was an
  inconsistency. Nothing else could supply the edge either: a local
  declaration exists precisely because the literal has no path of its own, so
  the declaration that built it is the only holder there is, which makes the
  edge exact rather than a guess. It is a `reference`, not a `call` — whoever
  invokes the handler (the DOM, a framework) is a separate matter, so a graph
  restricted to the control kinds still shows such a handler as an entry
  point.

| | this repository | `svelte/src` |
|---|---|---|
| edges | 593 → **690** | 8,514 → **8,943** |
| islands of one | 37 → **0** | 267 → **71** |
| island groups | 1 → 1 | 14 → **4** |
| entry points (every kind) | 73 → **15** | 693 → **332** |
| independence | 0.639 → 0.678 | 0.483 → 0.492 |

The entry-point figure moves the most, and deserves a word: a DOM handler is
now referenced by whoever installed it, so with every edge kind enabled it is
no longer "uncalled". Turning the graph down to the control kinds shows it as
an entry point again, which is the reading that inventories what events run.

### Diagnostics: a lone `module` node is not an island

* A file's own top-level code is never pointed at by anything — the reason
  `unreferencedDeclarations` already skips `module` nodes — so a file whose
  top-level code happens to call nothing is structurally isolated rather than
  adrift, and is left out of the count. Inside a *group* it stays: a file
  whose top-level code reaches only declarations nothing else reaches is
  exactly the finding.

### Diagnostics: islands

* A fourth diagnostic. Every connected piece of the graph but the largest is
  an island: declarations that depend on each other and on nothing else the
  analysis can see, and that nothing else depends on. On `d3-shape` that is
  nine groups — `cardinal, Cardinal, catmullRom, CatmullRom` and its siblings,
  each a curve family reached only by the library's consumers — against a
  mainland of 193.
* It is the one figure not read off the lift. The lift describes an edge, and
  a piece of the program that shares no edge with the rest has none to
  describe, so islands are read off the undirected connected components
  instead. Undirected on purpose: two declarations that only ever call a third
  are still one piece, and asking whether either can *reach* the other would
  split that piece into three.
* Islands of one are counted, not listed — 738 of 761 on a 2,600-declaration
  codebase, and a list of them would bury the groups. The export carries them.
  `mainland` is reported beside the count, so a program that is genuinely two
  halves reads as two comparable numbers rather than as "one island".
* Read on the enabled edge kinds, like every other diagnostic. That matters
  more here than elsewhere: an island is usually visible as a clump drifting
  away on its own, and a count that disagreed with the view would be worse
  than no count.
* `model.js`'s `connectedComponentCount` becomes `connectedComponents`,
  returning the pieces themselves — largest first, members name-ordered, each
  carrying its own links so a row can highlight itself.

### Analyzer: answer a property read by the object, not just by the name

* `analyzers/ts@0.7.0`. Resolving a property purely by its name — which is
  what the previous release did — made a codebase that declares a function
  called `map` or `get` collect an edge from every `xs.map(…)` and
  `cache.get(…)` whose receiver TypeScript could not pin down. In a Svelte
  project, where `any` arrives from every direction, that was **the majority
  of the graph**: 51% of edges inferred, against 29% before properties were
  modelled at all.
* A property read is now answered in three steps: from the receiver's own
  object when one was identified (an object literal, or `this` in a class);
  by nothing at all when the receiver is unknown and the name belongs to the
  standard library; and by name otherwise. The standard-library names are
  collected from the `lib.*.d.ts` files the program already loads, so the
  rule is "the language owns this name", not a hand-written denylist.
* All three steps are needed. Identity alone drops real edges wherever there
  is no identity to follow — a callback spread into a new object, or hung on
  an object a library handed over, both of which this repository does — and
  name alone is what invented the edges above.
* The standard-library step asks the program which files are the default
  library instead of matching the shape of a file name. The name pattern
  required a directory separator before `lib.`, which the Node CLI's absolute
  paths supply and the in-browser host's bare `lib.es2022.d.ts` does not, so
  the step was inoperative in exactly the place the local-folder and GitHub
  features run: analyzing through that host, edges 10,951 → 7,403 and
  inferred 57% → 36%, with the analysis itself 6.9s → 5.7s.
* On `svelte/src` (370 files): edges 12,172 → 8,514, inferred 51% → 30%,
  landing back on the 8,454 of the release before properties were modelled
  plus 60 genuine injected-dependency edges. The viewer feels it more than
  the analyzer does, since it pays per frame rather than once: first render
  880ms → 489ms, and 18fps → 28fps on the same graph.

### Analyzer: an injected dependency is no longer invisible

* The bounded 0-CFA (docs/THEORY.md §3.2) now flows values through object
  properties as well as through bindings, parameters and returns. A
  dependency stored on `this` and called off it (`this.t = deps.t`, then
  `this.t(...)`), a callback in an injected object literal, and the two-hop
  shape in between (`this.callbacks.onSelect?.()`, where the object was built
  somewhere else) all produce the inferred `call` edge they always should
  have. `analyzers/ts@0.6.0`.
* This was a soundness bug, not a missing nicety. Fact 4 requires the CFA
  relation to *contain* the real call relation; modelling no properties left
  it a strict under-approximation, so **a dependency that was injected rather
  than named left no edge at all**. The diagnostics built on top would then
  reward hiding a dependency exactly as much as removing one — converting a
  shared helper to constructor injection would have improved this project's
  own independence score without changing a thing about its coupling.
* It was already happening here: `Graph3D` takes its callbacks by injection
  and calls `this.callbacks.onSelect?.(node)`, and the analyzer recorded zero
  callers for it. 83 of 83 object-literal callbacks and nested helpers had no
  incoming edge; 37 of them now do, and this repository's graph gained 56
  edges (533 → 589).
* Properties are keyed by name alone (field-insensitive: one abstract
  location per property name), which over-approximates — two unrelated
  `.render` properties share a location — and is the direction Fact 4 asks
  for. A declaration reachable only from outside the analyzed code (a DOM
  event handler, a `ts.CompilerHost` method, an esbuild hook) is a separate
  matter and correctly still has no caller: there is none to find.

### Work the independence list down

* Following what the corrected ranking pointed at, two more shared operations
  in `app.js` now exist once instead of at each caller: `applyKindsTo()` (the
  degrees, heights and cycles a graph's *enabled* edge kinds decide, plus the
  two panel sections read off them — installing a graph and toggling a kind
  both arrive there, and CLAUDE.md's "drawing, springs and diagnostics must
  never disagree" is easier to keep true written once) and
  `installAndRemember()` / `analyzeFolder()` (every analysis ends by showing
  the result and remembering it; "Folder…" and "re-analyze" differ only in
  where the handle came from and which cache key it is filed under).
* This repository's own independence is 0.604 → 0.615, its scope escapes 243
  → 237. All four load paths and `applyKinds` have left the ten worst.
* What is left at the top is not fat. Three of the ten are test modules
  importing the API under test; one is `app.js`'s own module-level wiring;
  the rest are panel methods whose shared dependencies are `t()`, `el()` and
  the colour helpers. Those *should* be shared — every visible string going
  through `t()` is a project rule — so the metric has a floor well above 1,
  and pushing past it would mean splitting orchestrators into functions with
  one caller each, which moves the sharing rather than removing it.

### Rank the independence list by what can be acted on

* The Diagnostics section is now just "Diagnostics". It still asked "is it a
  tree?" after the tree score it referred to was gone, and no other section
  carries a subtitle.
* The independence list is ranked by how much a declaration gives up in
  total, not by its score. Running the metric on this repository is what
  found the problem: 88 of 194 scored declarations depend on exactly one
  thing, so their average *is* that one edge, and 16 of the 30 worst-scoring
  were one-line setters whose single dependency was a widely shared
  `draw()`. Nothing can be done about `setLayerGap`, and ranking it above a
  genuinely tangled function aimed the list at what nobody could act on. No
  single-dependency declaration is in the top 30 now.
* Acting on what the corrected list then pointed at: the six load paths in
  `app.js` each spelled out the same "mark the dropdown custom, then install"
  pair, and the folder analysis was written twice. Both are extracted
  (`installCustomGraph`, `runLocalAnalysis`), which moved this repository's
  own independence from 0.604 to 0.609 and dropped `loadGithubRepo` out of
  the ten worst entirely.

### One place to choose a source in the Data section

* "Open JSON" and "Open folder…" are one row of two buttons — a folder or a
  single JSON file — instead of two rows, one of which was a bare file input
  rendering as native "Choose File / no file selected" chrome that matched
  nothing around it and did not fit a narrow panel.
* The GitHub repo field is no longer always on screen. The dataset dropdown
  gained a "GitHub repo…" entry that reveals it, so the dropdown is the one
  place a source is chosen, and the field appears only when it is wanted.
  It stays open (and selected) after a repo loads, so a second one can be
  tried, and closes as soon as anything else is loaded.

### Replace the diagnostics and Patterns with three metrics you can act on

* The tree score and its five ratios (spanning, acyclicity, single-caller,
  DAG-ness, locality), the fifteen counts beside them, the "costliest
  sharing" list and the whole Patterns section (cycles, hubs, diamonds,
  chains) are gone, and so are `motifs.js` and the parts of `metrics.js`
  behind them. The ratios measured real things but could not be acted on —
  they said a graph was 0.78 of a tree without saying which edges made it
  so — and a five-way average let a good ratio hide a bad one. The motifs
  had the opposite problem: they showed exactly where a shape occurred, but
  "this is a diamond" is not by itself a defect.
* In their place, three readings of one measurement — the lift of each
  dependency in the dominator tree (docs/THEORY.md Definition 11):
  * **Entry points**: declarations nothing calls. How many separate trees
    the program actually is, and in an application, what startup and events
    run.
  * **Scope escapes**: the dependencies whose target had to be hoisted out
    of its caller's scope, bucketed by how many scopes that took. Lift 1 is
    two siblings sharing a helper; a high lift is a declaration visible
    across many levels that one place needed.
  * **Independence**: per declaration, the mean of `1 / (1 + lift)` over
    what it depends on — how much of that is its alone. Weighted by lift
    rather than by a count of other users, because a count cannot tell
    "shared with a sibling" from "shared across the program", which is the
    distinction the project's whole claim rests on.
* Each one lists what its number is pointing at: clicking a declaration
  selects it, clicking a lift bucket highlights those dependencies in the
  view, and a button exports the whole set as a JSON report (with the edge
  kinds it was computed on, so it can be reproduced).

### The property panel collapses, resizes, and stops scrolling sideways

* Every section is now collapsible, and which ones are open is remembered
  between visits — Data and View & Physics start open, the rest closed, and
  Selection expands itself when you click a node.
* The panel's width is set by dragging its left edge (or the arrow keys once
  that handle has focus), between 260px and 720px, and is remembered too.
* That same edge is now a visible boundary. The panel was meant to be told
  apart from the graph by tone, but its background token and the stage's
  resolved to the same colour, so there was nothing to see; the panel now
  sits on a genuinely different surface with the drag handle as the rule
  between them.
* The panel no longer scrolls horizontally. Its grid rows refused to shrink
  below their content's natural width (a text input's default size, a long
  identifier, a deep file path), and setting only `overflow-y` leaves the
  other axis at `auto`, so a scrollbar appeared under almost any content.

### Remove the layer planes

* The translucent plane drawn per call height, and its two switches ("Layer
  planes", "Fade layers by focus"), are gone. On any graph with more than a
  handful of layers they read as clutter rather than as a guide, and they
  were the only thing in the renderer needing a second, clamping projection
  (`projectClamped()`) and a radial-gradient fade of their own — a lot of
  machinery for a background shape that mostly got in the way. "Layer gap"
  stays: it still sets how far apart two consecutive heights sit.

### Remove the article page

* `article.html` and everything only it used — `site/js/article.js`,
  `site/js/markdown.js`, `site/article.css`, the chapters under
  `site/content/` and their `article.*` translations — are gone, along with
  the header link to them. The page had been left unmaintained, and it was
  the last consumer of several viewer details (the tree-score readout, four
  design tokens) that the panel is about to be rebuilt around; keeping a
  page nobody was updating as a constraint on that rebuild was the wrong
  trade. The chapters remain in the git history if the article is picked
  back up.

### Analyzer: a reference can flow through a variable to a nested declaration

* The bounded 0-CFA (docs/THEORY.md §3.2) already turned a call through a
  stored callback into a further `call` edge to whatever the flow analysis
  traced it to; it now does the same for a plain (non-call) reference —
  handing a variable to something else, a template prop binding, an event
  handler — producing a further, inferred `reference` edge to whatever the
  variable's value was traced to. This is what lets, say, a template
  binding reach a nested declaration a factory function returned into a
  captor variable, one hop further than the existing direct edge to the
  captor variable itself. It does not, and cannot soundly, resolve a
  binding that names a function declared *only* inside another local
  function with no such value-flow path at all — under real JS/Svelte
  scoping that name was never in scope there to begin with, which is worth
  checking for as a possible bug in the component itself rather than the
  analyzer. `analyzers/ts@0.5.0`.

### Export the currently loaded analysis as JSON

* A new "Export JSON" button in the Data section downloads the raw analyzer
  document exactly as installed (docs/DATA_FORMAT.md), before `buildGraph()`
  merges/drops edges or derives anything — for debugging an analysis that
  looks wrong (a reference that should have connected two declarations but
  didn't, say) without having to reproduce it.

### Drop the GitHub Pages deployment

* `.github/workflows/pages.yml` is removed; Cloudflare (Pages or Workers) is
  now the only documented host. It builds every branch, gives each pull
  request its own preview URL (which GitHub Pages couldn't), and needed no
  separate workflow to begin with.

## v0.3.0

### Lift call heights toward their caller

* Every node with slack above it — its shallowest caller sits higher than
  one more than its own minimal height — is now pulled up as close to that
  caller as possible, all the way to the top plane for one with no caller at
  all, instead of sitting at the minimal height that only its own outgoing
  calls required. This includes a pure sink (nothing called from it): a
  declaration that calls nothing but is only ever reached from high up now
  rises with its caller instead of sitting at the very bottom regardless of
  who calls it. Only the leaf ending the graph's own single longest chain is
  guaranteed to stay at 0, since nothing gives it anywhere higher to go; a
  node with no caller *and* no callee (fully isolated) is left alone too,
  since it has no business at the top just because it technically has no
  caller.

### Highlight structural motifs

* A new "Patterns" panel section highlights four structural shapes anywhere
  they occur in the graph, any number at once: cycles (red), hubs — a
  degree standing out from the rest of the graph (purple), diamonds — two
  distinct routes between the same pair of declarations (amber), and
  chains — a linear run with nothing else attached along the way (teal).
  Unlike the path highlight, this doesn't dim the rest of the graph: a
  coloured ring is drawn per matching node (one ring per motif kind if it
  matches more than one) and a thicker stroke per matching edge, as an
  overlay on top of the ordinary drawing. Only follows currently enabled
  edge kinds, same as everything else in the panel.

### Highlight the path between two declarations

* Ctrl/cmd+click a second node while one is selected to highlight every
  node and edge on some path from the selected one to it — the whole cone
  of influence between the two (an intersection of two BFS reachability
  searches), not just the shortest route, though the shortest one is also
  shown as an ordered list in the Selection panel. Only follows currently
  enabled edge kinds, consistent with the panel's "one switch drives
  drawing, springs and diagnostics together" rule. Selecting a different
  node clears the highlight, since it's only meaningful relative to the
  selection it was asked for.

### Camera, physics, and panel refinements

* Removed the 3D camera's `MIN_PITCH` dead zone around level orientations
  entirely, instead of tuning it: it was fixed to stop the camera getting
  stuck, but a value forced to stay outside a band can only ever skip over
  it, so every crossing became a sudden angular jump. Orbiting through
  exactly level now flattens the layer planes for a single frame — the
  original, purely cosmetic issue the dead zone existed to avoid — which is
  a better trade than a jump on every crossing.
* `call` edges are now blue (`#3b82f6`) instead of a muted grey, which read
  as an undifferentiated tangle once enough of them were on screen at once
  (the majority kind in almost every real codebase).
* Lowered the default repulsion (120 → 90) and the physics decay (weaker
  `alphaDecay` and a new, lower `velocityDecay`), so the initial layout and
  a "Recompute (reheat)" move more freely and settle over a longer run
  instead of damping out quickly.
* Merged the "View" and "Physics" panel sections into one "View & Physics"
  section.
* Layer planes: a plane whose corner would have clipped (as a node or edge
  does) used to make the *whole* plane disappear; it now draws at the
  near-plane's own clamped scale instead (`projectClamped`). Since a plane
  now always draws in full, its fill and stroke fade outward from wherever
  the camera's own focus point projects onto that height (a new "Fade
  layers by focus" toggle), instead of one flat colour covering however much
  of the screen a steep or close-up plane now reaches.
* The Zones depth control is now a two-handled range slider instead of a
  single cutoff, both handles starting at 0 (nothing shown, since no
  container is actually at depth 0). The high handle still reveals outward
  from the top like the old slider did; the low handle can also raise the
  band's outer edge to show an inner level — a directory two levels down,
  say — without any of its enclosing directories drawn at all, which a
  single cutoff could never express.
* "Layer planes" now starts unchecked instead of checked, since a plane per
  layer is more clutter than guide until asked for on a graph with many of
  them.
* The 3D camera can now also be flown with the keyboard, alongside the
  existing mouse controls: W/S pitch, Q/E yaw, and the up/down arrows dolly
  forward/back — an actual move through the scene along the view direction,
  not a rescale like the wheel's zoom. Unlike a mouse-drag orbit, which
  swings the camera around the fixed subject at screen centre, W/S/Q/E
  instead hold the camera's own position fixed and turn it in place, so
  whatever was framed dead ahead drifts off centre as you turn — closer to
  looking around than to orbiting. A/D add a new roll, auto-levelling back
  to 0 once released rather than leaving the horizon tilted. Disabled while
  a text field (the GitHub repo box, say) has focus, so typing doesn't fly
  the camera around.

### Analyze Svelte components

* `.svelte` files are now analyzed like any other source file, in the Node
  CLI, "Open folder…", and "GitHub repo" — a component's script *and*
  template, transformed through the real `svelte2tsx` (the same transform
  Svelte's own language server uses), not just its `<script>` block: a
  template call (`{aFunction()}`), an event handler (`on:click={handler}`)
  and a component-to-component reference (`<Child prop={x}>`, resolved to
  Child's own declarations) all become real edges. See `docs/DESIGN.md`'s
  "Analyzing Svelte components" for the module-resolution and line-number
  remapping this needs, and how svelte2tsx's own generated scaffolding
  (`$$render`, a colliding `variable`/`type` id pair) is turned into one
  clean declaration per component instead of being exposed as-is.
  GitHub search now also matches `language:svelte`, and a bundled
  `sample-svelte` dataset demonstrates the feature. `svelte2tsx` +
  `svelte/compiler` are bundled for the browser by `npm run vendor` (new
  `esbuild` build-time dependency) into `site/vendor/svelte2tsx.js`, loaded
  lazily only when a `.svelte` file is actually being analyzed.

### Fixed a "wall" in the 3D camera's orbit and dropped the Pointer Lock banner

* Orbiting the 3D view's camera toward a level pitch (looking exactly
  horizontal, from above or below) used to stick about 10% short of level
  and refuse to go further, unless the drag moved fast enough to jump clear
  over the dead zone in one step. `clampPitch` now snaps a candidate pitch
  out of that dead zone in the *direction the drag is already moving*,
  instead of toward whichever edge the raw candidate happens to be nearest
  — the latter re-snapped right back where it started on the very next
  small step, which was the wall. Verified with a step-size sweep from
  0.001 to 1.0 radians per step, confirming every size crosses cleanly with
  no size able to get stuck.
* Removed the Pointer Lock request used to extend drag range past the
  screen edge: it unconditionally triggered the browser's own
  non-suppressible "press Esc to exit" notification, which is worse than
  the capped range `setPointerCapture` (already in use) provides on its
  own. A single drag that needs more range than the physical screen allows
  (a full vertical loop, say) now needs release-and-redrag to continue,
  same as most web-based orbit controls. Verified in a real browser that
  `requestPointerLock` is never called, including while dragging past the
  screen edge.

### Search GitHub for a repo to analyze

* The GitHub-repo field now searches as you type (`githubAnalyzer.js`'s
  `searchGithubRepos`, GitHub's search API restricted to
  `language:javascript OR language:typescript`), debounced and never fired
  below two characters — the search API's own rate limit is a much
  stricter 10 requests/minute unauthenticated, versus 60/hour for fetching
  a repo's own contents. An empty field shows `POPULAR_REPOS`, a small
  fixed list of well-known JS/TS projects, instead of spending any of that
  budget on a query GitHub's search API has no "most popular" answer to
  anyway. Selecting a result analyzes it through the same pipeline as
  typing a spec directly.
* Fixed in the same pass: the results dropdown's `hidden` attribute did
  nothing, because `.github-results { display: flex }` (an author style)
  overrides the browser's built-in `[hidden] { display: none }` regardless
  of which one is toggled second — found by end-to-end browser testing,
  not by reading the CSS.

### "Recently opened": a local folder or GitHub repo, remembered

* Analyzing the same local folder or GitHub repo twice used to mean paying
  the full cost again — reading every file (or fetching the whole tree),
  loading the compiler, walking the `ts.Program`. `analysisCache.js` now
  stores each result in IndexedDB, and the panel gets a "Recently opened"
  list (separate from the Dataset dropdown, which only lists the bundled
  `site/data/*.json` examples): clicking an entry installs its graph
  directly, with nothing re-read or re-analyzed. Verified end to end in a
  real browser, including that the list survives a page reload and that
  loading a cached entry makes no network requests at all.
* A GitHub entry is keyed by the *resolved* `owner/repo@ref`, so
  `owner/repo` and `owner/repo@main` (the same default branch) collapse to
  one entry. A local folder has no such stable name, so its entry instead
  keeps the actual `FileSystemDirectoryHandle` (IndexedDB can store these
  directly); an explicit "re-analyze" action re-requests read permission on
  it before rereading — permission is scoped to the directory itself, not
  the specific JS object, so this works regardless of how the handle was
  obtained. Loading the cached graph never touches the handle at all, so it
  stays instant even once permission has lapsed.
* A "remove" action deletes an entry from the cache.

### Finer-grained progress for the local-folder / GitHub-repo analysis

* Past "reading files… N" / "fetching files… N/M" the status line used to go
  silent for the whole analysis (10+ seconds for a large project). It now
  reports "loading the TypeScript compiler…", "loading type definitions… N"
  and "analyzing N files…" as `browserAnalyzer.js`'s `analyzeFiles` moves
  through those stages (an `onPhase` callback threaded through
  `localAnalyzer.js` / `githubAnalyzer.js` / `analyzeWorker.js`). There is no
  finer-grained progress available *within* "analyzing" itself — building
  and walking the `ts.Program` is one call with no internal checkpoints to
  report from.

### The local-folder and GitHub-repo analysis runs off the main thread

* Analyzing a large project froze the page for the whole run — building a
  `ts.Program` and walking it with the type checker is real synchronous
  work; measured against `typescript.js`'s own ~9MB/200,000-line bundle, the
  main thread was unresponsive (not even answering a query from outside the
  page) for the full 10-15 second analysis. `analyzeWorker.js` now runs
  `localAnalyzer.js` / `githubAnalyzer.js` inside a dedicated `Worker`
  instead; the same analysis now runs with the page holding a steady 60fps
  throughout (measured by counting `requestAnimationFrame` callbacks during
  the same 9MB run). See docs/DESIGN.md's "Keeping a large analysis off the
  main thread" for how vendored-asset loading and dynamic-import call
  tracing (`unreferencedDeclarations` stays accurate with no exception
  needed) both had to account for running inside a worker.
* This does not raise the ceiling on how large a project can be analyzed at
  all — a codebase whose total size genuinely exceeds a browser tab's memory
  budget will still fail, and the CLI (`analyzers/ts/analyze.mjs`, no such
  ceiling) remains the right tool for that — but it turns "the tab looks
  crashed" into "the tab stays responsive while it works, or reports a clean
  error," which was the actual problem reported.

### Analyze a local folder or a GitHub repo, live, from the panel

* Two new "Data" controls run the real TypeScript-compiler-based analyzer
  entirely in the browser, no server and no pre-generated JSON: **"Open
  folder…"** picks a local directory with the File System Access API
  (Chrome/Edge only — disabled elsewhere with an explanatory tooltip), and
  the **GitHub repo** field takes `owner/repo`, `owner/repo@ref` or a
  `github.com` URL and fetches the repository's file tree and contents via
  the GitHub REST API and `raw.githubusercontent.com` (subject to GitHub's
  60-requests/hour unauthenticated rate limit — one API request for the file
  tree, unmetered CDN fetches for content).
* Both build a `ts.Program` over a custom `ts.CompilerHost` backed by an
  in-memory file map, instead of the Node CLI's `ts.sys`-backed one, and
  hand it to the exact same `analyzers/ts/core.mjs` the CLI uses — not a
  second implementation. Verified identical output to the Node CLI on the
  same project (`test/local-analyzer.test.mjs`, a custom host built the same
  way over `node:fs`-read files instead of the File System Access API) and,
  in a real browser, against both a mocked local folder and a mocked GitHub
  repo (the actual failure mode of a live GitHub API call in a sandbox is
  the sandbox's own network policy, not the code).
* The TypeScript compiler this needs (`site/vendor/typescript.js`, ~9MB) and
  its `lib.*.d.ts` files load lazily, only when one of these features is
  actually used, so viewing a bundled dataset never fetches them.

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
