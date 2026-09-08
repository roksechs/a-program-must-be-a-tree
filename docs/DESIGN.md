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
  build:data`); the viewer's "Open folder…" and "GitHub repo" panel controls
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
| `metrics.js`    | Tree-likeness diagnostics. |
| `dominance.js`  | Dominator tree of the condensed graph: the deepest nesting the program admits, and the lift of every edge. |
| `paths.js`      | "How does A reach B": every node/edge on some path between two declarations, plus the shortest one — see "Path highlighting". |
| `motifs.js`     | Structural motif detectors (cycle, hub, diamond, chain) — see "Motif highlighting". |
| `simulation.js` | d3-force setup, the spring force, seeding of initial positions (containers are never consulted). |
| `zones.js`      | Which containers are visible for a chosen depth, padded hull geometry. |
| `graph3d.js`    | Canvas renderer: x/y from the simulation, z = call height, orbit camera, layer planes, an orthographic "Top view" preset. The only renderer, used by both the main viewer and the article's live figures. |
| `panel.js`      | Property panel (controls + diagnostics + selection details). |
| `app.js`        | Data loading and wiring. |
| `browserAnalyzer.js` | The part of the in-browser analyzer shared by `localAnalyzer.js` and `githubAnalyzer.js`: a custom `ts.CompilerHost` over an in-memory file map, fed to `analyzers/ts/core.mjs`, with a `.svelte` file transformed through `vendor/svelte2tsx.js` first (see "Analyzing Svelte components"). Loads `vendor/typescript.js` (~9MB) and, only when a `.svelte` file is present, `vendor/svelte2tsx.js` lazily, on first use; every vendored asset is addressed by a URL resolved against `import.meta.url`, so the same code works whether it runs on the main thread or inside `analyzeWorker.js`. |
| `localAnalyzer.js` | Reads a directory picked with `showDirectoryPicker()` into the file map `browserAnalyzer.js` needs. |
| `githubAnalyzer.js` | Fetches a public GitHub repository's file tree and contents into the same file map. |
| `analyzeWorker.js`  | Runs `localAnalyzer.js` / `githubAnalyzer.js` inside a dedicated worker so the page stays responsive during the analysis itself — see below. |
| `analysisCache.js`  | Persists local-folder / GitHub-repo analysis results in IndexedDB, so the panel's "Recently opened" list can show a graph again without re-reading or re-analyzing — see below. |
| `markdown.js`   | Small Markdown renderer for the article chapters (escaped, no raw HTML; `<!-- key: value -->` comments are page directives). |
| `article.js`    | The article page (`article.html`): chapters from `content/<lang>/`, each with the live graphs its directives ask for, rendered by the same modules on the same datasets as the viewer. |

Both the main viewer (`index.html`) and the article's live figures render
only in 3D. A 2D renderer without perspective is exactly `graph3d.js`'s own
Top view (`viewTop()`), so a separate SVG renderer (`graph2d.js`, removed)
would only have been a second, heavier way to draw the same picture; a
figure that wants a flat, label-readable layout asks for `view: top`
instead and gets `graph3d.js`'s Top view.

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
"Fit to view" frames whatever the simulation produced. Nothing calls it on the
app's own initiative — not a fresh load, not a run settling — only the button
itself, Top view, and orbiting away from Top view ever move the camera. A run
can take a while to settle (see `alphaDecay` above), long enough for the user
to have framed their own view of it by hand in the meantime; an automatic fit
firing at whatever moment that happens to end would override a camera they
already took hold of, so there is no automatic fit to fire.

Directories and files have no influence on the physics: no force reads the
containers, and the initial positions are seeded on a spiral in declaration
order without looking at file paths. The layout therefore reflects the call
graph alone, and the zones merely show where the declarations of a file or
directory ended up.

"Recompute" resets the simulation alpha to 1 (reheat), "Reset positions"
re-seeds the coordinates first. Dragging a node pins it while the pointer is
down.

Changing a physics parameter or an edge kind's toggle applies immediately —
the spring set and the force strengths are updated right away — but does not
itself reheat: a layout the user has been looking at should not be flung back
into motion just for touching a slider or a checkbox while exploring which
edge kinds to look at. If the simulation is still cooling from a previous run
the new values simply take effect on its very next tick; the explicit
"Recompute (reheat)" button is how to ask for a fresh layout under the
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
the 3D view is a lift of the 2D layout rather than a different layout. A
translucent plane is drawn per height so the layers are easy to count;
"Layer planes" (View & Physics) starts unchecked, since a plane per layer on
a graph with many of them is more clutter than guide until asked for.

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
contributing to the perspective divide and the layer planes (drawn edge-on)
flatten to lines for that one instant (true of any look-at camera, not just
this one). An earlier version kept pitch a fixed distance away from every
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
out of frame. A layer plane's own corners use `projectClamped()` instead,
which clamps to that same boundary scale rather than leaving a corner out:
dropping an entire plane because one corner alone would have clipped made a
layer disappear far more often than any single node would, so a background
shape like this is drawn at whatever scale the near plane allows rather than
not at all. Always drawing the full plane this way means it can now cover
much of the screen at a steep angle or up close, so its fill and stroke fade
outward (a radial gradient) from wherever the camera's own `target` projects
onto that height instead of one flat colour throughout — what the camera is
actually looking at stays crisp, the rest recedes like fog, rather than
every pixel of a plane that might span the whole view competing at the same
strength regardless of how far off-focus it is. `layerFade` (View & Physics)
turns this off in favour of the older flat fill.

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

## Tree-likeness diagnostics

All structural diagnostics, the degrees and the call heights are computed on
the edge kinds enabled in the Edges section, the same set that is drawn and
that pulls in the physics. Disable `reference` to diagnose the control graph
(`call` + `create`) of `THEORY.md` §7. `write` edges run backwards (a
variable to whoever assigns it), which starts enabled like every other kind
but is the one worth turning back off if it confuses a dominator-tree-based
reading of the diagnostics: mixing a reversed edge into these numbers without
noticing would misread the tree, so `write` is its own lens (`THEORY.md`
§3.5, §7) that the toggle makes it easy to set aside.

For `n` nodes, `m` control edges and `c` weakly connected components:

| metric              | definition | 1 means |
|---------------------|------------|---------|
| Spanning ratio      | `(n - r) / m`, `r` = roots | no declaration has a second caller |
| Acyclicity          | `1 - (nodes in a cycle) / n` | no recursion, direct or mutual |
| Single caller ratio | `1 - (nodes with > 1 caller) / n` | every declaration has one parent |
| DAG-ness            | `1 - (edges inside SCCs) / m` | no edge closes a cycle |
| Locality            | mean of `1 / (1 + lift)` over the edges of the condensation | every edge is a nesting edge |
| Tree score          | mean of the five | a forest |

The spanning ratio counts *roots*, not weakly connected components. With
components it would be blind to direction: `A -> S <- B` has `n - c = 2 = m`
and would score 1 although `S` has two callers. A directed forest has exactly
one incoming edge per non-root, so `(n - r) / m` is 1 only when no declaration
is shared.

Locality answers the other half of the question — *who* shares a declaration.
The graph is condensed, a virtual root is made the parent of every component
without callers, and the dominator tree of the result is computed (Cooper,
Harvey and Kennedy 2001). For an edge `a -> b`, the lift
`depth(a) - depth(idom(b))` is the number of scopes `b` had to be hoisted out
of `a` to remain reachable from its other users (Definition 11 in
`THEORY.md`): 0 for a nesting edge, 1 when two siblings share `b`, more when
the callers sit in unrelated parts of the program. Being called twice from the
same scope and being called twice from opposite ends of the codebase are the
same number of extra callers but very different amounts of tangle, and the
lift is what separates them. The same numbers drive the "most costly sharing"
list, which ranks declarations by the sum of the lifts of their incoming
edges, and the selection panel, which names the *natural scope* of a
declaration: the immediate dominator, i.e. where it could live if the program
were a tree.

Also reported: components, roots (uncalled), leaves (calling nothing), longest
call chain, surplus edges (extra incoming edges, `sum of max(0, indeg - 1)`),
nesting edges (lift 0), the largest lift, the number of non-trivial SCCs, self
loops, the costliest shared declarations, and *initialisation cycles*:
declarations on a cycle of definition-time dependencies (evaluated while the
module loads), which are genuine errors rather than recursion.

`convergentOperations(graph, minWidth = 2)` finds a different shape than lift
does: a declaration `x` that directly calls several distinct declarations
(`via`), every one of which independently calls the same shared node `y` —
`x -> via[i] -> y` for every `i`. This is what a single logical operation
looks like once it has been decomposed into several independent steps instead
of one, e.g. `installGraph()` calling five setters that each separately
trigger `Graph3D#draw`, where one call to a single `load()`-shaped method
would do; the pattern was found this way (by running the analyzer on this
project itself) before the fix that collapsed it existed. It is read straight
off call-graph topology and knows nothing about `y` itself, so it cannot tell
a genuinely costly, stateful `y` (worth consolidating at `x`) from a cheap,
pure one (harmless to reach from several siblings, same as any other shared
utility) — that judgement is the same one every shared declaration already
needs (see "Edge kinds" above on `nodeRadius`). That is a read error for a
person to make, same as any other finding this tool surfaces, not something
the metric resolves on its own.

A different, sharper false positive this same finder turned up while running
on this project itself: a handler object's several one-line arrow functions
(each firing on a different, unrelated user action, e.g. a property panel's
`{ onFit, onLabels, onColorBy, … }`) used to be attributed to whichever named
declaration merely constructed the object literal, making genuinely
independent handlers look like one converging operation. That was not a
judgement call left to a person — it was the analyzer failing to name
something that has a name (docs/THEORY.md §4.1, Definition 9a's "local
declaration": a function-valued object literal property, passed straight
into a call with no name of its own in between, is declared and parented to
the calling declaration, the same as a `--nested` local, because ECMAScript
already names it by NamedEvaluation and the value never escapes anywhere
else to be found by control-flow analysis instead). Fixed at the analyzer
level, not by the metric: `panel -> {onFit, onLabels, …} -> draw` no longer
appears, because `onFit` and friends are now their own declarations with
their own, correctly separate, calls to `draw`.

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

## Motif highlighting

A path highlight isolates one relationship; a motif is a *category* to spot
across the whole graph instead, so `motifs.js`'s four detectors — `cycleMotif`,
`hubMotif`, `diamondMotif`, `chainMotif` — and their panel toggles (any
number on at once, off by default) draw as an additive overlay rather than
dimming everything that doesn't match. Each returns the same `{ nodes, edges }`
shape over `graph.activeLinks` as `pathBetween` does, for the same reason:
a switched-off edge kind should be invisible to a motif query too.

* **Cycle**: every node in a nontrivial SCC (`n.inCycle`, already computed by
  `computeHeights` for the diagnostics) and every edge that stays inside one
  — the same underlying fact the diagnostics' acyclicity score and each
  node's always-on red stroke already reflect, made an explicit, toggleable
  overlay instead of a fixed part of the node's own outline.
* **Hub**: a node whose in+out degree (over active edges, recomputed here
  rather than reusing the model's whole-graph `inDegree`/`outDegree`, which
  do not shrink when a kind is switched off) sits at or above both a fixed
  floor and a percentile of every other degree in the *current* graph — so
  "stands out" adapts to how connected the graph as a whole happens to be,
  rather than a single absolute number that reads very differently on a
  sparse graph than a dense one.
* **Diamond**: `A -> B, A -> C, B -> D, C -> D` — two distinct 2-hop routes
  between the same pair. Found by counting, per node `A`, how many of its
  out-neighbours' own out-neighbours land on the same node `D`; two or more
  distinct intermediates means a diamond.
* **Chain**: a maximal run of declarations connected one to the next with
  nothing else attached along the way — every node strictly inside the run
  has exactly one active in-edge and one active out-edge — long enough
  (`minLength`, node count) to be worth calling out. This is exactly the
  shape a tree-likeness score never penalizes, since nothing forks or
  merges along it; the motif exists to make that "boring but blameless"
  shape visible on request rather than implicit in a good score.

Rendering draws a coloured ring per matching node (one motif kind, one
colour) and a thicker stroke over matching edges, layered on top of the
ordinary node/edge/label passes rather than folded into their own dimming
logic — unlike the path highlight, a node can and often does belong to more
than one motif at once (a hub that is also in a cycle, say), so it can carry
one ring per kind rather than one motif "winning" over the others.

## Roadmap

* Analyzers for Python, Go and Rust (tree-sitter based) and a `--git` mode that
  records the commit the graph was taken from.
* Collapse a zone into a single node (module-level graph) and expand it again.
* Highlight the edges that would have to be removed to make the graph a tree
  (the edges with a lift above 0 are already known; draw them apart).
* Persist panel settings in the URL so a view can be shared.
* Optional WebGL renderer for very large graphs.
