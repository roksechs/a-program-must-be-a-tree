# Design notes

## Goals

1. Show the call / dependency graph of a codebase at declaration granularity.
2. Make the shape of the graph legible: containers (files, directories) as
   zones, callers above callees in 3D.
3. Put a number on the question in the project name: how far is this program
   from being a tree?
4. Stay a static site. Anyone can publish the viewer on any static host with
   their own datasets, and no secrets are needed anywhere.

## Architecture

```
codebase --(analyzer)--> graph.json --(viewer)--> layout + diagnostics
```

* **Analyzers** are independent programs that emit the JSON described in
  `DATA_FORMAT.md`. Besides functions, classes, members, variables and types,
  the TypeScript analyzer emits one `module` node per file that has top-level
  code outside any declaration (a call at load time), so references made by
  such code are not lost. A top-level assignment through a path of names
  (`ns.f = function`, `C.prototype.m = f`, `exports.f = …`, `d3.scale = {}`)
  is not module code but a declaration — the ES5 spelling of an export or a
  method — while the same assignment inside a function body is a flagged
  *late binding* when the receiver is a module-level name and a mere store
  when it is a value (`THEORY.md` §4.1). With `--nested`, named local
  functions become nodes of their own (`<parent>/<name>`), which is the only
  view in which a large function made of closures — this analyzer, for one —
  can be diagnosed; the `self-nested` dataset is that view of this repository.
  The first one covers JavaScript / TypeScript (and Svelte, via a
  `svelte2tsx` transform — see "Analyzing Svelte components") using the
  TypeScript compiler API, which resolves imports, `this.method()` calls and
  aliases for free. Other languages (Python `ast`, tree-sitter, Go `go/types`,
  ...) can be added without touching the viewer. The TypeScript analyzer
  itself has three front ends over one shared core (`analyzers/ts/core.mjs`,
  which touches nothing outside the `ts` module it is handed): `analyze.mjs`
  builds a `ts.Program` from files read off disk (the CLI, `npm run
  build:data`); the viewer's "Folder…" button and its "GitHub repo…" dropdown entry
  each build one from files read a different way (the File System Access API,
  the GitHub REST API plus `raw.githubusercontent.com`) over a custom
  `ts.CompilerHost` backed by an in-memory map — so analyzing a project needs
  no server-side step and works from the static site alone. `core.mjs` is
  copied into `site/vendor/analyzer-core.js` by `npm run vendor` (gitignored:
  `analyzers/ts/core.mjs` stays the single source of truth) since the
  published site only ever serves `site/`. Both run inside a dedicated worker
  (`analyzeWorker.js`), not the main thread — see below.
* **Viewer** (`site/`) is plain ES modules plus a vendored copy of d3. There is
  no bundler so the page can be opened from any static host.

### Viewer modules

| module          | role |
|-----------------|------|
| `model.js`      | Normalises the document: nodes, merged links, containers (directory tree derived from file paths), SCCs and call heights. |
| `metrics.js`    | The four diagnostics — entry points, scope escapes, independence (all read off the dominator tree) and islands (read off the connected components). |
| `dominance.js`  | Dominator tree of the condensed graph: the deepest nesting the program admits, and the lift of every edge. |
| `paths.js`      | "How does A reach B": every node/edge on some path between two declarations, plus the shortest one — see "Path highlighting". |
| `simulation.js` | d3-force setup, the spring force, seeding of initial positions (containers are never consulted). |
| `zones.js`      | Which containers are visible for a chosen depth, padded hull geometry. |
| `graph3d.js`    | Canvas renderer: x/y from the simulation, z = call height, orbit camera, an orthographic "Top view" preset. The only renderer. |
| `panel.js`      | Property panel (controls + diagnostics + selection details). |
| `app.js`        | Data loading and wiring. |
| `browserAnalyzer.js` | The part of the in-browser analyzer shared by `localAnalyzer.js` and `githubAnalyzer.js`: a custom `ts.CompilerHost` over an in-memory file map, fed to `analyzers/ts/core.mjs`, with a `.svelte` file transformed through `vendor/svelte2tsx.js` first (see "Analyzing Svelte components"). Loads `vendor/typescript.js` (~9MB) and, only when a `.svelte` file is present, `vendor/svelte2tsx.js` lazily, on first use; every vendored asset is addressed by a URL resolved against `import.meta.url`, so the same code works whether it runs on the main thread or inside `analyzeWorker.js`. |
| `localAnalyzer.js` | Reads a directory picked with `showDirectoryPicker()` into the file map `browserAnalyzer.js` needs. |
| `githubAnalyzer.js` | Fetches a public GitHub repository's file tree and contents into the same file map. |
| `analyzeWorker.js`  | Runs `localAnalyzer.js` / `githubAnalyzer.js` inside a dedicated worker so the page stays responsive during the analysis itself — see below. |
| `analysisCache.js`  | Persists local-folder / GitHub-repo analysis results in IndexedDB, so the panel's "Recently opened" list can show a graph again without re-reading or re-analyzing — see below. |

The viewer renders only in 3D. A 2D renderer without perspective is exactly
`graph3d.js`'s own Top view (`viewTop()`), so a separate SVG renderer
(`graph2d.js`, removed) would only have been a second, heavier way to draw
the same picture.

### The panel's shape

Each section is a native `<details>`/`<summary>` rather than a hand-rolled
toggle, so the keyboard behaviour, the ARIA semantics and the open state
come from the element instead of from code that would have to reimplement
all three. `Panel#section()` takes a stable id alongside the translated
title, and the set of expanded ids lives on the Panel instance and in
`localStorage`: `render()` rebuilds every section from scratch on a language
change, and a freshly built `<details>` would otherwise silently discard
whatever the user had opened. Selection expands itself when a node is
selected — a click on a node is a request to see what it is, and answering
that shouldn't take two steps — but a *de*selection leaves it alone, since
collapsing a section someone is reading is worse than leaving an empty one
they can close.

The panel's width is a drag handle (`#panel-resize`, wired in `app.js`)
writing straight to the `--panel-width` custom property the stylesheet
already read, clamped to 260px…720px and remembered in `localStorage`. It
sits between the stage and the panel as a flex item of its own, which makes
it the boundary between the two as well as the control for it: before this
the panel was meant to be told apart from the graph "by tone and elevation
instead of a hard border", but `--bg` and the panel's background resolved to
the *same* token, so there was nothing to see. The panel now sits on
`--panel-bg`, a genuinely different surface, with the handle as the rule.
Because only the flex sizes change and the window never resizes, the drag
has to call `renderer.resize()` itself — nothing else would tell the canvas
its box moved.

The Data section keeps one place to choose what to look at: a single
`<select>`, in three `<optgroup>`s — bundled datasets, "Recently opened"
entries (`recentOptionValue()` turns an `analysisCache.js` row into an
option value; `Panel.recentByValue` turns it back), and "Load new" for
"Folder…"/"JSON file…"/"GitHub repo…". Those three are commands, not
selections: nothing about what is loaded has changed by picking one (a
native picker can be cancelled, and the repo field is not itself a load), so
Folder…/JSON file… put the select's value straight back with `currentValue()`
the moment they fire their picker, and only GitHub repo… stays selected
while its field is showing (Panel state, `githubMode`, not read off the
dropdown — `render()` would lose which sentinel to reselect on a language
change otherwise). A disabled `CUSTOM_OPTION`, outside every optgroup, is
selected whenever what is on screen came from somewhere with no option of
its own to point at — a JSON file opened from disk, which
`analysisCache.js` never remembers, or a `?data=<url>`; a folder or GitHub
repo has its own "Recently opened" entry to select instead once the analysis
finishes and gets saved. Anything that starts a load from elsewhere clears
`githubMode`, so two sources are never offered at once. `applySelectValue()`
is the one place that reconciles the select's displayed value (and the
re-analyze/remove row beneath it) with this state; `setDatasets()` and
`setRecent()` both end by calling it; because rebuilding one optgroup's
`<option>`s resets what the whole `<select>` shows as chosen, calling
either without it would visibly deselect whatever the other optgroup holds
current.

Opening something off this machine is one row of two buttons, because no one
native dialog can offer both — `showDirectoryPicker()` takes a directory,
`<input type=file>` takes a file. The file input is hidden and clicked by its
button: bare, it renders as native "Choose File / no file selected" chrome
that matches nothing around it and does not fit a narrow panel, and
`.click()` from a button handler still counts as the user gesture the picker
requires. The row has no visible label — a `.control`'s label column is
110px, a third of a narrow panel, for a word that adds nothing beside
"Folder…" and "JSON file…" — but it is a `role="group"` with that word as its
accessible name.

Widths from the analysed source (a long camelCase identifier, a deep file
path) used to decide how wide the panel wanted to be, and `overflow-y: auto`
with no `overflow-x` computes the other axis to `auto`, so the panel carried
a horizontal scrollbar at almost any content. The fix is on the content: the
grid tracks in `.control`, `.kind-list` and the diagnostics' own rows
are `minmax(0, …)` so they may actually shrink to the panel they are in
(a track's default floor is its content's min-content width), and the node
lists wrap with `overflow-wrap: anywhere`. `overflow-x: hidden` on `#panel`
is the backstop behind that, not the fix.

### Keeping a large analysis off the main thread

Building a `ts.Program` and walking it with the type checker is real,
synchronous CPU work: analyzing a single ~9MB/200,000-line file in-browser
(measured against `typescript.js`'s own compiled bundle) took the main
thread itself out of commission — even reading a DOM property from outside
the page timed out — for the full ~10-15 seconds the analysis ran. A
codebase that size is not a contrived case for a tool whose whole premise is
analyzing other codebases, so `analyzeWorker.js` runs `localAnalyzer.js` and
`githubAnalyzer.js` inside a dedicated `Worker` instead: the same code
(`browserAnalyzer.js`'s `loadTypeScript`/`readLib` detect the worker
environment via `typeof importScripts`, since a worker has no `document` to
append a `<script>` tag to) now runs off the main thread, which stays at a
steady 60fps throughout — verified by counting `requestAnimationFrame`
callbacks during the same 9MB analysis, before and after this change.

The worker is a classic (non-module) one on purpose: `importScripts()` —
the only way to turn `vendor/typescript.js`'s plain `var ts = {}` into a
usable value, short of `eval`, since it is not itself an ES module — does
not work inside a module worker. Dynamic `import()` of the real ES modules
that do the work is available in a classic script too, so nothing is
duplicated for the worker's sake. One thing to get right: a value pulled out
of a dynamic import by destructuring (`const { analyzeLocalFolder } =
await import(...)`) becomes, to the analyzer, a local binding with no
traceable path back to the function it names — the same blind spot as any
other value that escapes through a stored reference (docs/DATA_FORMAT.md's
local declarations) — so `analyzeWorker.js` calls
`(await import(...)).analyzeLocalFolder(...)` instead: a plain property
access, which the checker resolves back to the real declaration, keeping the
call graph (and `metrics.js`'s `unreferencedDeclarations`) accurate with no
exception needed.

### Remembering an analysis: "Recently opened"

Opening the same local folder or GitHub repo a second time should not mean
paying the whole cost again — reading every file, fetching the whole tree,
loading the compiler and its `lib.*.d.ts` closure, walking the `ts.Program`.
`analysisCache.js` stores the result of each local-folder / GitHub-repo
analysis in IndexedDB (`{ kind, key, label, doc, dirHandle?, analyzedAt }`),
and the panel's "Recently opened" list reads it back: clicking an entry
installs its `doc` directly, with none of that work repeated. This list is
separate from the Dataset dropdown above it, which only ever lists the
bundled `site/data/*.json` examples — an entry here exists because the
browser itself analyzed something, not because it shipped with the site.

A GitHub entry is keyed by the *resolved* `owner/repo@ref` (the analysis
document's own `meta.root`, not the raw text the user typed), so typing
`owner/repo` and `owner/repo@main` for the same default branch collapse to
one entry once the ref is known. A local folder has no such stable, unique
name to key by, so its entry instead keeps the actual
`FileSystemDirectoryHandle` — itself a value IndexedDB can store — and an
explicit "re-analyze" action re-requests read permission on it
(`handle.requestPermission()`, which needs the user-gesture context a
button click already provides) before rereading it; permission is scoped to
the underlying directory, not to the specific JS object, so this works
regardless of how the handle was obtained. Loading the cached graph itself
never touches the handle at all — only "re-analyze" needs permission, so
revisiting an old result stays instant even if permission has since lapsed.

### Finding a GitHub repo to analyze

The GitHub-repo field searches as you type, against GitHub's search API —
a different endpoint from the one `githubAnalyzer.js`'s `analyzeGithubRepo`
uses to fetch a repo's own contents, with a much stricter rate limit (10
requests/minute unauthenticated, vs. 60/hour) — so `panel.js` debounces
input and never searches below two characters. The query is restricted to
`language:javascript OR language:typescript OR language:svelte`, the kinds
of repository this analyzer can read. An empty field shows `POPULAR_REPOS`
(`githubAnalyzer.js`), a small fixed list — there is no "most popular" query
to send the search API for an empty string, and showing suggestions this
way costs none of that budget.

### Analyzing Svelte components

A `.svelte` file is not TypeScript, so it cannot go straight into a
`ts.Program` the way every other source file here does. `analyzers/ts/svelte.mjs`
bridges that gap with `svelte2tsx` — the same transform Svelte's own
language server and `svelte-check` use, run for real rather than
reimplemented — which turns a component's script *and* template into TSX
text: `on:click={someHandler}` becomes a reference to `someHandler`,
`{aFunction()}` becomes a real call, and `<Child prop={x}>` becomes a
reference to whatever `Child` resolves to. That last one is the reason this
uses the real transform instead of only reading each file's `<script>`
block on its own: a script-only extraction can trace what a component's own
code calls, but never which *other components* a template instantiates —
exactly the edges that make a Svelte codebase's graph worth looking at.

A template binding can only ever denote whatever is actually in scope at
the point svelte2tsx places it — the whole script and template compile into
one function body (`$$render`, below), so `on:keydown={onkeydown}` binds to
whatever `onkeydown` resolves to right there, by ordinary lexical scoping,
the same as any other TSX code would. A function declared only inside
*another* local function — two scopes deeper than the template can see —
is genuinely not reachable from a bare identifier like that; nothing here
special-cases it, because nothing sound could (§3.2's 0-CFA extension below
still requires an actual value-flow path, e.g. through a variable the
factory that built the nested function assigned it to — a bare name with
no such path is either a mistake in the component itself or, in a real
Svelte app, resolves to something the developer didn't intend).

Both front ends feed the transformed text in under the file's own,
unchanged name (`Foo.svelte`, not a virtual `Foo.svelte.tsx`) with an
explicit `ts.ScriptKind.TSX`, so every other part of the pipeline — file
attribution, zones, "Recently opened" keys — needs no Svelte-specific case
at all; only three things do:

* **The compiler's own root-file check.** TypeScript hard-errors a root file
  whose extension it doesn't recognize (a real error, not a diagnostic to
  ignore) unless `allowNonTsExtensions` is set — scoped to a project that
  actually has a `.svelte` file, so it changes nothing about how every other
  project here has always been analyzed.
* **Module resolution.** `import Child from "./Child.svelte"` has no
  extension TypeScript's resolver knows to try, so `resolveSvelteModule`
  resolves a relative `.svelte` specifier against the known file set itself
  and reports it with `extension: ts.Extension.Tsx`, telling the checker to
  treat whatever it loads as TSX regardless of the file's real name. This is
  the mechanism that makes `<Child />` in a template resolve to *Child's
  own* declarations rather than dead-ending at the import statement.
* **Line numbers.** svelte2tsx moves and rewrites code enough that a
  declaration's line in the generated TSX is rarely its line in the
  original file. Its sourcemap (a standard V3 map from `MagicString`) says
  which original line a generated one came from; `svelte.mjs` decodes the
  VLQ-encoded `mappings` string itself (a few dozen lines of arithmetic)
  rather than adding another vendored dependency for it, and `core.mjs`'s
  `analyzeProgram` takes an optional per-file line-remapping function
  (`svelteLineMaps`) it applies wherever it would otherwise read a
  `SourceFile`'s line directly.

Every `.svelte` file's transform produces the same fixed scaffolding around
a component's actual code: a `$$render` function wrapping the whole script
and template, a `const Foo__SvelteComponent_ = …` and a
`type Foo__SvelteComponent_ = …` describing its shape, and a trailing
`export default Foo__SvelteComponent_`. Left as emitted, this is actively
wrong, not just noisy: the `variable` and the `type` declaration share one
name and therefore one id (`<file>::Foo__SvelteComponent_`,
docs/DATA_FORMAT.md's "unique within the document" broken by construction),
and a component's own functions — promoted into visible declarations at all
only because `.svelte` files always get the `nested`-option treatment
regardless of the project's own choice, the same reasoning `nested` itself
documents for a named local function — end up parented under the
meaningless `$$render` rather than under the component. `svelte.mjs`'s
`cleanupSvelteDocument`, run once after `analyzeProgram`, turns that into
one clean declaration per component — named and ided after the file itself
(`Foo.svelte::Foo`, kind `class`, since a component is exactly that: a
named, instantiable, importable unit) — reparents the component's own
functions onto it, drops the scaffolding nodes entirely, and drops the
edges that only existed because of it (a `type X -> type X` self-reference
from the id collision, and "the component calls its own `$$render`") while
leaving real self-recursion written by hand untouched.

Not modeled: a prop passed at a component's own use site
(`<Child onBump={bump} />`) is a runtime data flow into Child's
`export let onBump`, not a lexical binding either file's `.svelte`
independently exposes — connecting that specific use of `bump` to Child's
internal call to whatever `onBump` holds would need Svelte-specific
cross-component modeling this analyzer does not attempt, the same kind of
gap the project already documents for other dynamic bindings, and a
different limitation from the case the transform *does* handle: what a
component's own script and template themselves reference and call.

### Keeping the codebase itself tidy

"Is anything unreferenced" is a question about the graph's shape, so it is
answered by the graph model, not by a one-off script: `metrics.js`'s
`unreferencedDeclarations(graph)` returns every node with zero incoming
edges of any kind — exactly what a removed caller leaves behind (deleting
`graph2d.js` orphaned `Graph3D.show()` and `zones.js`'s `topPoint`, both
found this way). A `module` node (a file's own top-level code) and a local
declaration (`<parent id>/<name>`, docs/DATA_FORMAT.md — an options-object
callback such as `{ onFit: () => {…} }`) are excluded: the analyzer does not
trace a call reaching a local declaration through a stored reference
(`this.callbacks.onFit()`), so it reads as unused even when something
invokes it dynamically. `test/dead-code.test.mjs` runs the analyzer on
`site/js`, `analyzers`, `scripts` and `test` themselves, builds the graph the
same way the viewer does, and asserts `unreferencedDeclarations` finds
nothing; a second check in the same file flags a CSS custom property that is
declared in `site/*.css` but never read with `var(...)` anywhere in
`site/*.css`.

## Physics

d3-force is used as the integrator. The forces are:

* **Repulsion**: `d3.forceManyBody` with negative strength. Its magnitude is
  `strength / distance`, i.e. inversely proportional to distance, as required.
* **Springs**: a custom force (`forceSpring`) applying Hooke's law along every
  edge, `F = k * (d - restLength)`, split between the endpoints by their degree
  so a hub is not thrown around by one neighbour. `d3.forceLink` is close, but
  the custom force keeps the parameters (stiffness, rest length) explicit.
* **Collision**: keeps circles from overlapping, using each node's `radius`.

That is all. The repulsion has no range limit — every pair of nodes feels it at
any distance — and a spring along an edge is the only attraction, so two
declarations end up next to each other only when something connects them.
`forceCollide` is not a third force but the hard core of the repulsion, keeping
circles from overlapping.

A node's `radius` (`4 + sqrt(inDegree + outDegree) * 1.2`, so busier
declarations stand out) is a field on the node itself, set in `model.js`
alongside `inDegree`/`outDegree`/`height` whenever the active edge kinds
change — not a function either renderer or the physics calls. All three need
the exact same number (the physics so its collision radius matches what gets
drawn, both renderers so a node's circle, its label offset and where an edge
stops before it all agree), so it belongs to whichever module already owns a
node's other derived numbers, not to whichever of the three happened to
declare a `nodeRadius()` function first and have the other two import it.

Nothing defines a centre. Two attempts at one were removed:

* A weak `forceX`/`forceY` pull towards the origin, meant to keep disconnected
  components on screen. With a `1/d` repulsion and a linear pull, the
  equilibrium is a disc of the radius where the two balance and the nodes
  spread through it almost uniformly, so the picture became a circle whatever
  the graph looked like. Measured on the `self` dataset, that pull (strength
  0.05) put the median node at 0.59 of the outer radius, against 0.707 for a
  uniformly filled disc; without it the median sits at 0.36.
* `d3.forceCenter`, which translates all nodes each tick so their centroid sits
  at the origin. It deforms nothing, but it still singles out a point in a
  plane where no point should be special.

Where the graph sits is therefore a question for the camera, not the physics:
"Fit to view" frames whatever the simulation produced. It runs once, when a
document is installed, and never again on the app's own initiative — not
while a run is going, not when one settles. Those are the moments the user
may already have framed a view by hand, and an automatic fit firing at
whatever moment a run happens to end would take that view away from them. A
document being installed is not one of them: nobody can have framed a graph
that did not exist a moment ago.

The fit at install is not a convenience. A graph used to arrive on the
phyllotaxis seed — a compact disc around the origin that the default camera
happened to show — and to grow into its real extent while the user watched.
Now that documents carry a settled layout (below) it arrives at that extent:
tens of thousands of units across, centred wherever the physics left it,
since nothing pulls it toward the origin. Measured across the datasets in
this repository, opening one without the fit painted between almost nothing
and, for `d3-shape`, nothing at all.

`fit()`'s zoom has an upper bound (2, so a small graph is not blown up past a
sane scale) but no lower one, and the wheel's own zoom gesture — a relative
`zoomK *= f` per tick, clamped to `[?, 8]` — must not reintroduce one either.
A floor here used to be shared with the wheel's `0.05`, on the assumption
that no real graph would need less; a 2,139-declaration project measured at
236,714 units across needed 0.003, sixteen times past that floor, and with
it "Fit to view" projected the whole graph to roughly 11,800px across —
painting nothing at all inside the viewport, not merely small. Nothing in
`project()` divides by `zoomK`, so an arbitrarily small one is just an
arbitrarily wide view and never a numerical problem; the only real ceiling
on how far a layout's extent can grow is the physics itself (above), which
already has none.

`fit()` takes an optional node subset (`this.graph.nodes` by default) and
frames just that subset's bounding box — the mechanism panel.js's Islands
section uses to jump the camera to one island, or back to the mainland,
without a second way of computing an extent. The install-time fit and the
"Fit to view" button both call it with the mainland (the largest connected
component of the enabled edge kinds, `metrics.js`'s `islands()`) rather than
every node, for the same reason the zoom floor above had to go: an island
can sit arbitrarily far from the mainland, since nothing bounds how far the
physics lets one drift, and a fit that had to include one would zoom out far
enough to leave the connected majority — what opening a graph is usually
for — tiny in the middle of the view. A graph with no islands has a single
component, so this is exactly the old behaviour there.

Directories and files have no influence on the physics: no force reads the
containers, and the initial positions are seeded on a spiral in declaration
order without looking at file paths. The layout therefore reflects the call
graph alone, and the zones merely show where the declarations of a file or
directory ended up.

### Nothing runs until asked

The simulation is created stopped, and "Recompute (reheat)" is the only thing
that starts it. ("Reset positions" re-seeds the coordinates and then starts it
too, being the same request with a blank slate.)

This is not a preference about idleness. A tick costs the whole graph: the two
forces are the 1/d repulsion and the collide core, both node-against-node, so
the cost is set by the node count and barely moves with the edges. Measured in
a browser at 2,138 nodes with positions held fixed so the edge count was the
only variable, a tick is 21-25ms from 0 edges to 8,000, while drawing adds
about 1.3µs per edge — so at 3,365 edges the nodes are ~79% of a 30ms frame.
With the `alphaDecay` below that is ~2,300 such frames: forty seconds of a
page that cannot be scrolled smoothly, every time a document is opened,
whether or not its layout needed redoing.

So a document may carry the layout instead (`x`/`y` per declaration,
docs/DATA_FORMAT.md). `npm run build:data` settles every published dataset
through this very module (`scripts/settle.mjs` imports `site/js/simulation.js`
rather than reimplementing the forces, so a layout is a point this physics
would really have reached and pressing reheat does not make the graph jump),
and the viewer opens on it having run nothing. A document without one opens on
the deterministic seed and says so in the status line. When a run does reach
its end, the positions are written back into the document — and, for an
analysis that came from the "Recently opened" cache, back into IndexedDB — so
reopening a folder is instant and already settled.

An analysis the browser ran itself has no build step to carry a layout, so
the worker that ran it lays the result out before handing it back
(`analyzeWorker.js`), behind the progress the analysis was already reporting.
That is the same work — it is off the main thread, so the page stays
responsive while it happens, and it is stored with the analysis, so a folder
pays for it once and never again. `site/js/layout.js` is the single copy both
producers run; `scripts/settle.mjs` is only the build step's way of loading
d3 before calling it.

It anneals *repeatedly*, until the runs stop finding anything better. One
run is not enough, and that is measurable rather than a matter of taste: on a
2,138-declaration project, pressing "Recompute (reheat)" on the layout one
run produced moved the arrangement by 0.45 of its own median radius — half
the picture, which is exactly what a reader notices. Pressing it again moved
it 0.17, then 0.10, then 0.05, while the extent converged on a limit. The
layout was not wrong, it was shallow. After annealing to the floor (7 runs,
8,900 ticks on that project) a reheat moves it 0.029, and stays there.

That floor is the wander a full-temperature reheat has whatever the layout,
so the stop is "the runs stopped improving" and not "the runs got small". A
small graph hits its floor immediately and high — there are simply several
comparable arrangements of thirty nodes, and reheating picks among them — so
a fixed threshold never fires for one. A first attempt used one, and eight of
the twelve published datasets ran to the tick cap; with the improvement test
they take 2 to 6 runs.

Each individual run stops on whichever comes first: the cooling schedule
reaching `alphaMin`, the same threshold a run in the page stops at, or the
*arrangement* having stopped changing — the per-tick change in the layout
taken as a shape (centred on its centroid, scaled so the median distance from
it is 1) falling under 1e-5, twice in a row.

The arrangement, and not the positions, because absolute displacement reads
as convergence far too early. It falls as much from the layout inflating as
from the picture settling, and the inflation never stops: an island has no
spring holding it to anything, so the unbounded repulsion pushes it away
without limit. On a 2,138-declaration project, a threshold of 1e-5 on
absolute displacement fires at tick 1,300, where the shape is still changing
at 87e-6 per tick — eight times the same threshold. By 1,900 the shape is at
12e-6 and by 2,300 at 6e-6. The median distance is the scale for the same
reason the criterion exists at all: a handful of islands heading for infinity
would otherwise set it, and everything else would look like it was converging
by shrinking.

Cooling is what settles a shape, and the movement left at a *fixed*
temperature is heat rather than structure: held at a constant alpha, the
per-tick change is proportional to that alpha (221e-6 at 0.2, 115e-6 at 0.05,
32e-6 at 0.01, 8.6e-6 at 0.002), so it reaches zero only as the temperature
does. That is why a run has to be annealed to its end, and why a settled
layout genuinely does not move on its own — what moves it is the reheat
button, which is the whole reason for annealing more than once above.

Twice in a row because the measure is noisy from chunk to chunk, and one dip
below the line is not a layout that has come to rest.

Each run starts at an alpha of 16, not 1. Alpha is d3's cooling parameter and
by convention runs from 1, but nothing clamps it — it is only the multiplier
on each tick's displacement, so a larger one explores further before the
schedule brings it down. The value was measured across the ten datasets here
by the thing that actually goes wrong without it: how far a subsequent press
of "Recompute (reheat)" moves the picture. Starting at 1 was the worst of the
temperatures tried on nine of the ten, and on this repository's own graph a
single run from 16 reached 0.008 in 3,200 ticks where repeated runs from 1
reached only 0.048 in 5,800.

It is not a trick of scale. A hot run does leave the layout several times
larger, but uniformly scaling a cold layout up to the same size makes it
*worse* — 0.13 to 0.27 — because that pulls every spring off its rest length.

There is an upper limit: this is explicit Euler integration, and with a big
enough step it does not settle but throws the graph apart. A run starting at
48 was past any usable extent within 50 ticks, and the quadtree the repulsion
builds then subdivides until it exhausts memory. So a run that leaves the
bounds is undone, the temperature quartered, and the run retried; 16 diverged
on none of the twelve datasets here, but "none of twelve" is not "none".

Two runs from a hot start reach the floor. On a 2,138-declaration project,
forcing six runs instead of two costs 12,000 ticks against 4,150 and buys
0.0009 — the remaining 0.07 is the wander a full-temperature reheat has
however good the layout is, not something more settling can remove.

One consequence is worth stating because it is now visible immediately rather
than after forty seconds of drift: a component connected to nothing else has
no spring holding it to anything, so the unbounded repulsion pushes it away
without limit, and a settled layout has its islands very far out. "Fit to
view" frames all of it, which makes the main body small. That is the physics
above doing exactly what it says; the Islands diagnostic is the way to find
those pieces, not the camera.

Dragging a node pins it while the pointer is down.

Changing a physics parameter or an edge kind's toggle applies immediately —
the spring set and the force strengths are updated right away — but does not
itself reheat: a layout the user has been looking at should not be flung back
into motion just for touching a slider or a checkbox while exploring which
edge kinds to look at. The values are stored and take effect on the next run;
the explicit "Recompute (reheat)" button is how to ask for one under the
current parameters. `alphaDecay` is also tuned well below d3's own default
(0.0228, ~300 ticks) so a run stays warm for roughly 1200 ticks instead —
long enough, on a graph of any size, for repulsion and every edge kind's
springs to actually settle into a stable shape rather than cooling on top of
one that is still rearranging itself.

## Zones

Containers are derived from file paths: every directory prefix is a container,
the file itself is the innermost one, one level below its directory (a file
at the repository root has depth 1). A two-handled range slider (`Panel`'s
`rangeSlider`) chooses which *band* of levels is drawn, not just a single
cutoff: both handles start at 0, showing nothing, since no container is
actually at depth 0; dragging only the high handle reveals outward from the
top the way a single depth slider always did (1 the top-level directories,
and so on down to the files at the maximum), but the low handle can also
raise the *outer* edge of the band — showing, say, only the directories two
levels down, with nothing enclosing them drawn at all, which a single cutoff
could never express. A container whose node set is identical to its visible
parent is skipped so a directory with a single file does not produce two
identical hulls, but only when that parent is *also* inside the chosen band;
outside it there is no second hull to collide with, so the container draws.

Each zone is the convex hull of its members' positions, padded by expanding
every point into a small octagon before hulling and drawn as a plain closed
polygon (straight segments); the octagon expansion is what keeps corners from
looking sharp; no curve fit runs on top of it. Directories and files use the
same style; nesting is visible from the hulls themselves. The same code
produces the 3D zones by hulling the projected screen coordinates.

This is recomputed every physics tick, so `hullPath` hulls the raw member
points first and only expands *that* hull's vertices into padded polygons
before hulling again, instead of padding every member: a directory with
hundreds of declarations still pads a handful of hull corners, not hundreds
of points. The result is the same shape (padding an interior point can never
push it outside the padded hull of the boundary), just cheaper for large
zones.

## 3D mode

The vertical axis is the **call height** of a node: the graph is condensed
into strongly connected components, and a component's height is as close to
its shallowest caller as the rest of the graph allows — all the way to the
top plane for one with no caller at all — rather than only however far it
happens to sit above its own deepest callee. Members of a cycle share one
height. The x/y coordinates are the ones computed by the 2D simulation, so
the 3D view is a lift of the 2D layout rather than a different layout. The
"Layer gap" control (View & Physics) sets how far apart two consecutive
heights sit; nothing else is drawn at a height of its own. A translucent
plane per height used to be, as a way to count the layers, but on any graph
with more than a handful it read as clutter rather than as a guide, and it
was the only thing in the renderer that needed a second, clamping
projection and a radial-gradient fade of its own — a lot of machinery for a
background shape that mostly got in the way.

`computeHeights()` (`model.js`) gets there in two passes over the same
condensation DAG. First, bottom-up (ascending component id — Tarjan emits
SCCs in reverse topological order, so this is a single sweep from the
sinks): each component's *minimal* height, one more than its deepest
callee's, 0 for a pure sink. This pins `maxHeight` — the top plane — at the
graph's own single longest chain. Second, top-down (descending id, a sweep
from the sources, so every caller is finalized before the callees its
height feeds into are computed): each component is pulled up from that
floor to one less than its *shallowest* caller's already-finalized height —
or to `maxHeight` itself if it has no caller — rather than left at whatever
the first pass gave it. A pure sink is no exception: a declaration that
calls nothing but is itself only ever reached from high up still rises with
its caller, rather than sitting at the very bottom regardless of who calls
it. Only the leaf that ends the graph's own single longest chain is
guaranteed to stay at 0, because nothing gives it anywhere higher to go; a
component with no caller *and* no callee (calls nothing, is called by
nothing) is the one deliberate exception to the lift itself — nothing pulls
it toward the top just because it technically has no caller, when it has no
business up there either.

A caller can still sit far above one of its own direct callees — that
callee's *other* caller may have far less headroom — and that is not a bug,
it means the gap is real slack rather than a fact about the chain between
them.

The projection is a small hand-written orbit camera (yaw, pitch, perspective)
on a 2D canvas; no WebGL dependency is needed for a few thousand nodes. Pitch
is unbounded, not clamped to a single hemisphere: dragging past straight
up/down continues the orbit into a full vertical loop rather than stopping,
the same way yaw already spins all the way around, and it is never pushed
away from a *level* orientation either (pitch a multiple of `PI`): at those
elevations the camera's forward axis is horizontal, so height stops
contributing to the perspective divide, so the scene flattens for that one
instant (true of any look-at camera, not just this one). An earlier version kept pitch a fixed distance away from every
such point to avoid that, which traded a momentary, purely cosmetic flattening
for a real interaction bug: since an orbit drag can only land on discrete
steps, a value that must stay outside a band has to skip over it however
small the step is, so every crossing became a sudden angular jump — worse
than the flattening it was avoiding, and for something a continuous orbit
only ever shows for a single frame anyway.

Orbiting reads `pointermove` while a drag is down, letting `setPointerCapture`
(acquired on `pointerdown`) keep delivering events once the cursor leaves the
canvas, up to the edge of the screen. That is enough range for an ordinary
orbit; a single drag large enough to need more (a full vertical loop, say)
needs release-and-redrag to continue. The alternative, the Pointer Lock API,
gives uncapped relative movement past the screen edge, but unconditionally
shows the browser's own "press Esc to exit" banner the moment it activates —
worse than the capped range it would buy back — so this renderer never
requests it.

The camera's focal length is set from the graph's own extent (in `fit()`)
rather than a fixed world-unit constant. A focal length small next to the
layout's actual size lets ordinary orbiting bring some node's depth close
enough to `-focal` that its perspective scale blows up, stretching it the
way a very wide-angle lens stretches whatever is closest to it; tying focal
to extent keeps the lens "normal" regardless of how far the `1/d` repulsion
happens to spread a given graph. Points whose scale would still exceed
`MAX_MAGNIFICATION` are left undrawn rather than magnified without bound —
a real camera doesn't render what's pressed against the lens, it just falls
out of frame. Everything the renderer draws is a node, an edge or a zone
hull, and clipping is the right answer for all three; the one shape that
wanted the opposite treatment — a layer plane's corner, drawn at the
boundary's own scale rather than dropped, through a `projectClamped()` and
a radial-gradient fade that existed only for it — went away with the layer
planes themselves.

The orbit camera doesn't pivot on the world origin; it pivots on an explicit
`target` point that always projects to screen centre regardless of yaw or
pitch. Nothing in the physics keeps the layout's own bounding box anywhere
near the origin (see "Nothing defines a centre" above), so `fit()` points
`target` at the box's own centre instead of assuming the origin already
coincides with it, and `focusOn()` points it at a node instead. Because
rotation is relative to `target`, dragging to orbit never drifts whatever
it's aimed at away from screen centre — only an explicit pan (shift-drag,
`panScreen()`) moves it, as a screen-space offset on top of the orbit.
Zooming (mouse wheel) rescales that offset by the same factor as the zoom, so
whatever point sits at screen centre stays there through further zooming
instead of sliding away from it — the per-node perspective factor cancels
out of the ratio, so this holds regardless of a node's depth.

The keyboard offers the same three rotations as a flight camera, plus a
dolly, as an alternative to the mouse — but the mouse and W/S/Q/E disagree
about what a rotation pivots on. Dragging to orbit changes yaw/pitch without
touching `target`, so it swings the camera's own (implicit) position around
that fixed subject — the arcball behaviour described above. W/S/Q/E instead
call `rotateInPlace(dYaw, dPitch)`, which holds the *camera's* position
fixed and swings `target` around instead, the way turning your head does
rather than orbiting a subject: it recovers that implicit camera position as
`target` minus `focal` world units along the current `forwardVector(yaw,
pitch)` (the inverse of `viewSpace()`'s yaw-then-pitch rotation applied to
"straight ahead", also shared by `dolly()` below), applies the yaw/pitch
change, then re-derives `target` as `focal` units ahead of that same fixed
point along the *new* view direction — so whatever was framed dead ahead
drifts off screen centre as you turn, rather than staying put the way
orbiting keeps it. The up/down arrows call `dolly()`, moving `target` itself
a world-space step along `forwardVector()` rather than rescaling `zoomK` the
way the wheel does: an actual move through the scene, not a bigger picture
of the same vantage point. A/D adjust a fourth field, `roll`,
that orbiting and the wheel never touch: there is no pointer gesture for it,
and unlike pitch/yaw it auto-levels back to 0 once A/D stop being held
(eased by a multiplicative decay each frame) rather than staying wherever it
was left, since an accidentally tilted horizon has no way back other than
rolling the exact opposite amount by hand. `viewSpace()` applies roll last,
as a plain 2D rotation of the already-projected `X`/`screenUp` pair around
`target`'s own screen position (always screen centre) — equivalent to
rolling the camera around its forward axis, and why nothing about the
X/Y/depth computation that precedes it needs to know roll exists.
`panScreen()` undoes that same rotation on its screen-space input first,
since a shift-drag's `dx`/`dy` arrive in final (rolled) screen pixels but
its own yaw/pitch math is written in the frame `viewSpace()` computes before
roll is applied.

All of this listens on `window` rather than the canvas, since the canvas
never takes keyboard focus, and is skipped while a text input is focused
(the GitHub repo box, say) so that typing doesn't fly the camera around;
each held key re-arms itself on `requestAnimationFrame` rather than relying
on the browser's own key-repeat timing, so the response is the same
regardless of OS repeat-rate settings, and the same loop keeps running past
the last keyup for as long as roll still has ground to give back.

A node focused with `focusOn()` keeps its own position re-read into `target`
on every frame rather than a one-off snapshot: node positions keep changing
under the physics (settling, or reheated by dragging a different node or
changing a physics parameter), so a snapshot would go stale within a tick
or two and orbiting would end up pivoting on where the node used to be. An
explicit pan releases this following, since it means the viewer wants to
move away from the focused node on purpose.

## Edge kinds

The meaning of `call`, `create`, `reference`, `type`, `extends`,
`implements` and `override`, and why the split follows from erasure and
evaluation contexts, is derived in `THEORY.md`. The Edges section of the
panel has one switch per kind: an enabled kind is drawn, acts as a spring in
the physics and counts for degrees, call heights and the diagnostics; a
disabled kind does none of these, so the picture, the layout and the numbers
always describe the same graph. Every kind starts enabled (see `write`,
below, for the one worth turning back off on some graphs). Edges found by
analysis rather than written at that spot (dispatched overrides, callbacks
resolved by flow analysis, and the candidates of a call through a union type
or a record indexed at run time) are dashed.

Two edges of different kinds between the same pair of nodes never draw on
top of each other: every kind bows a different amount away from the straight
line between its endpoints (`colors.js`'s `edgeBowOffset`, evenly spread and
centred on zero across `EDGE_KINDS`), a generalisation of the read/write bow
described below. Left overlapping, two differently-coloured, semi-transparent
strokes on the same pixels blend into a colour that matches neither kind's
legend swatch — which is what an edge kind sharing a pair with a much more
common one (`call`, typically) used to look like before every kind got its
own offset.

A declaration counts as a root only when nothing reaches it, so the analyzer
has to resolve the indirect calls a codebase actually uses, or perfectly live
code shows up as dead. Two cases matter in practice: `obj.m()` where `obj` has
a union type resolves to one member per constituent, and `map[key].m()`, where
the checker gives up entirely, is resolved against the property types of
`map`. Both emit an edge to every candidate, marked inferred.

## Diagnostics

All structural diagnostics, the degrees and the call heights are computed on
the edge kinds enabled in the Edges section, the same set that is drawn and
that pulls in the physics. Disable `reference` to diagnose the control graph
(`call` + `create`) of `THEORY.md` §7. `write` edges run backwards (a
variable to whoever assigns it), which starts enabled like every other kind
but is the one worth turning back off if it confuses a dominator-tree-based
reading of the diagnostics: mixing a reversed edge into these numbers without
noticing would misread the tree, so `write` is its own lens (`THEORY.md`
§3.5, §7) that the toggle makes it easy to set aside.

Everything below is read off one array. `dominance.js` condenses the active
graph, builds the dominator tree of the condensation — the deepest nesting
the program admits (`THEORY.md` Definition 10) — and returns `lifts[i]`, the
lift of `links[i]` (Definition 11): how many scopes that edge's target had to
be hoisted out of its caller to stay reachable from its other users, or `-1`
for a link inside a cycle, which is not an edge of the condensation and has
no lift. Lift 0 means the caller *is* the target's natural parent, so the
target could simply be nested inside it. Every other value is a *sharing*
edge.

| metric | what it is | read it as |
|---|---|---|
| Entry points | declarations with in-degree 0 | how many separate trees the program actually is; in an application, what startup and events run |
| Scope escapes | edges with lift > 0, bucketed by lift | how far the sharing reaches — lift 1 is two siblings sharing a helper, a high lift is a declaration visible across many levels that one place needed |
| Independence | per node, the mean of `1 / (1 + lift)` over its distinct callees | how much of what a declaration depends on is its alone: 1 when everything it uses could live inside it |
| Islands | connected components other than the largest | the pieces that share no dependency at all with the main body: a family reached only from outside, or code nothing reaches any more |

The independence list is ranked by `shared` (`callees - Σ 1/(1 + lift)`, how
many whole dependencies' worth of ownership the node does not have) and not
by the score. Running the metric on this repository is what settled that: 88
of 194 scored declarations depend on exactly one thing, so their "average" is
that single edge and can only ever be one of 1, ½, ⅓, ¼…, and **16 of the 30
worst-scoring were one-line setters** (`setLayerGap`, `setZones`, `restyle`)
whose one dependency was a widely shared `draw()`. Nothing can be done about
`setLayerGap`; ranking it above a genuinely tangled 18-dependency function
aimed the list at the one thing in it nobody could act on. Weighting by how
much there was to own puts no single-dependency node in the top 30 at all,
and matches what `scopeEscapes` already reports beside its buckets: a total,
not only a ratio.

Islands are the one figure here not read off the lift. The lift describes an
edge, and the pieces of a program that share no edge with the rest have none
to describe, so they are read off the undirected connected components
instead (`connectedComponents` in `model.js`). Undirected on purpose: two
declarations that only ever call a third are still one piece of program, and
asking whether either can *reach* the other would split that piece into
three. The largest component is taken to be the mainland — on a program that
is genuinely two halves that is an arbitrary choice between them, which is
why `mainland` is reported beside the count: two comparable numbers say "two
halves" where a count of islands alone would not. Islands of one are counted
but not listed; they are the common case by far (738 of 761 on a
2,600-declaration codebase), a list of them would bury the groups, and a
declaration that neither calls nor is called is already what entry points
reports. The export carries them.

Like every other diagnostic here, islands are read on the enabled edge
kinds, so the panel counts what the view draws. That matters more here than
elsewhere: an island is usually *visible* as a clump drifting away on its
own, and a figure that disagreed with what is on screen would be worse than
no figure.

Each row the panel lists for it — the mainland included — is also a button:
clicking one highlights that piece and points the camera's `fit()` (above)
at just its nodes, so "which piece is this" and "let me look at only that
piece" are the same click.

The first three are deliberately one quantity at three granularities rather
than five independent ratios averaged into a score. A score compresses away the
thing worth acting on: "0.62" does not say which dependencies to look at,
and a five-way average lets a good ratio hide a bad one. A bucketed
histogram and a ranked list do, and every row in either is clickable
(selecting the node, or highlighting the bucket's edges through the path
overlay — see below) and exportable as a report, so what the number is
pointing at can be worked through outside the viewer.

Two properties are worth stating because they are easy to misread:

* **Weighting by lift, not by how many others share it.** A count of outside
  users cannot tell "shared with a sibling" from "shared across the whole
  program" — both are simply "used elsewhere". The lift can, and the
  project's own claim depends on the difference (`THEORY.md` §7): sharing
  between siblings costs one scope of nesting, sharing across unrelated parts
  of the program costs many.
* **`overall` independence is an average over edges, so it does not compare
  two codebases.** A large program with plenty of well-nested dependencies
  dilutes its badly shared ones and can score above a small one whose sharing
  is far more local. It says how a graph is doing against itself; the ranked
  list is what to read across codebases.

Nodes that depend on nothing — or only on their own cycle — get no
independence score rather than a misleading 1 or 0: there is nothing for them
to own. Parallel links between the same pair (a `call` *and* a `reference`,
say) count once, since the lift depends only on where the two sit in the
dominator tree and both links carry the same value.

An earlier version of this section scored tree-likeness five ways (spanning
ratio, acyclicity, single-caller ratio, DAG-ness, locality) and averaged them
into one "tree score", alongside a Patterns section highlighting four
structural motifs (cycles, hubs, diamonds, chains). Both are gone. The
ratios measured real things, but a program's owner could not do anything
with them: they said a graph was 0.78 of a tree without saying which edges
made it so. The motifs had the opposite problem — they showed exactly where
a shape occurred, but "this is a diamond" is not by itself a defect.

## Path highlighting

"How does A reach B" is a different question from anything the diagnostics
answer: those score the graph's shape as a whole, not one declaration's
route to another. Ctrl/cmd+clicking a second node while one is already
selected (`graph3d.js`'s `bindEvents`) asks exactly that, and `paths.js`'s
`pathBetween(graph, from, to)` answers it over `graph.activeLinks` — the
same edges currently drawn, springing and counted, so a switched-off edge
kind is invisible to a path query too, consistent with the panel's "one
switch drives drawing, springs and diagnostics together" rule extending to
this as well.

The result is not just the shortest route: it is every node and edge that
lies on *some* directed path from `from` to `to` — the intersection of
"reachable from `from`" and "can reach `to`", each its own BFS over an
adjacency list built for the query (no persistent graph-wide index; a query
is one-off and the graph can change between queries as edge kinds toggle).
A single shortest path would understate a node's influence whenever more
than one route exists; the full intersection is the whole cone between the
two, with the shortest path kept alongside it only as an ordered list for
the panel's textual summary. A node BFS-reachable from `from` that can
never itself reach `to` (a dead end down some other branch) is correctly
excluded — reachability in one direction alone is not enough to belong to
a path between the two.

Drawing it reuses the exact dimming mechanism `sel` (an ordinary selection)
already uses, generalized: `graph3d.js`'s `draw()` computes `edgeActive`/
`nodeDimmed` from `pathNodes`/`pathEdges` when a path is set, falling back
to the plain selection/neighbour test otherwise, rather than the path
highlight being a separate rendering pass layered on top. Selecting a
different node (including clearing the selection) drops the path instead
of drawing one whose endpoint no longer matches what's selected, since a
path is only ever meaningful relative to the selection it was asked for.

## Roadmap

* Analyzers for Python, Go and Rust (tree-sitter based) and a `--git` mode that
  records the commit the graph was taken from.
* Collapse a zone into a single node (module-level graph) and expand it again.
* Highlight the edges that would have to be removed to make the graph a tree
  (the edges with a lift above 0 are already known; draw them apart).
* Persist panel settings in the URL so a view can be shared.
* Optional WebGL renderer for very large graphs.
