# Design notes

## Goals

1. Show the call / dependency graph of a codebase at declaration granularity.
2. Make the shape of the graph legible: containers (files, directories) as
   zones, callers above callees in 3D.
3. Put a number on the question in the project name: how far is this program
   from being a tree?
4. Stay a static site. Anyone can publish the viewer on GitHub Pages with
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
  The first one covers JavaScript / TypeScript using the
  TypeScript compiler API, which resolves imports, `this.method()` calls and
  aliases for free. Other languages (Python `ast`, tree-sitter, Go `go/types`,
  ...) can be added without touching the viewer.
* **Viewer** (`site/`) is plain ES modules plus a vendored copy of d3. There is
  no bundler so the page can be opened from any static host.

### Viewer modules

| module          | role |
|-----------------|------|
| `model.js`      | Normalises the document: nodes, merged links, containers (directory tree derived from file paths), SCCs and call heights. |
| `metrics.js`    | Tree-likeness diagnostics. |
| `dominance.js`  | Dominator tree of the condensed graph: the deepest nesting the program admits, and the lift of every edge. |
| `simulation.js` | d3-force setup, the spring force, seeding of initial positions (containers are never consulted). |
| `zones.js`      | Which containers are visible for a chosen depth, padded hull geometry. |
| `graph3d.js`    | Canvas renderer: x/y from the simulation, z = call height, orbit camera, layer planes, an orthographic "Top view" preset. The only renderer, used by both the main viewer and the article's live figures. |
| `panel.js`      | Property panel (controls + diagnostics + selection details). |
| `app.js`        | Data loading and wiring. |
| `markdown.js`   | Small Markdown renderer for the article chapters (escaped, no raw HTML; `<!-- key: value -->` comments are page directives). |
| `article.js`    | The article page (`article.html`): chapters from `content/<lang>/`, each with the live graphs its directives ask for, rendered by the same modules on the same datasets as the viewer. |

Both the main viewer (`index.html`) and the article's live figures render
only in 3D. A 2D renderer without perspective is exactly `graph3d.js`'s own
Top view (`viewTop()`), so a separate SVG renderer (`graph2d.js`, removed)
would only have been a second, heavier way to draw the same picture; a
figure that wants a flat, label-readable layout asks for `view: top`
instead and gets `graph3d.js`'s Top view.

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
the file itself is the innermost one. A single depth slider chooses how many
levels are drawn: 0 draws nothing, 1 the top-level directories, and so on down
to the files, which count as one level below their directory (a file at the
repository root has depth 1). A container whose node set is identical to its
visible parent is skipped so a directory with a single file does not produce
two identical hulls.

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
into strongly connected components and the height of a component is the
longest path from it to a sink in the condensation DAG. Pure callees have
height 0 and sit on the bottom plane; the deepest callers sit on the top plane.
Members of a cycle share one height. The x/y coordinates are the ones computed
by the 2D simulation, so the 3D view is a lift of the 2D layout rather than a
different layout. A translucent plane is drawn per height so the layers are
easy to count.

The projection is a small hand-written orbit camera (yaw, pitch, perspective)
on a 2D canvas; no WebGL dependency is needed for a few thousand nodes. Pitch
is unbounded, not clamped to a single hemisphere: dragging past straight
up/down continues the orbit into a full vertical loop rather than stopping,
the same way yaw already spins all the way around. It is kept away from
every *level* orientation (pitch a multiple of `PI`, not just 0): at those
elevations the camera's forward axis is horizontal, so height never
contributes to the perspective divide and the call-height axis would render
with no depth cue at all (true of any look-at camera, not just this one). A
minimum elevation keeps that axis visibly foreshortened everywhere else on
the loop.

The camera's focal length is set from the graph's own extent (in `fit()`)
rather than a fixed world-unit constant. A focal length small next to the
layout's actual size lets ordinary orbiting bring some node's depth close
enough to `-focal` that its perspective scale blows up, stretching it the
way a very wide-angle lens stretches whatever is closest to it; tying focal
to extent keeps the lens "normal" regardless of how far the `1/d` repulsion
happens to spread a given graph. Points whose scale would still exceed
`MAX_MAGNIFICATION` are left undrawn rather than magnified without bound —
a real camera doesn't render what's pressed against the lens, it just falls
out of frame.

The orbit camera doesn't pivot on the world origin; it pivots on an explicit
`target` point that always projects to screen centre regardless of yaw or
pitch. Nothing in the physics keeps the layout's own bounding box anywhere
near the origin (see "Nothing defines a centre" above), so `fit()` points
`target` at the box's own centre instead of assuming the origin already
coincides with it, and `focusOn()` points it at a node instead. Because
rotation is relative to `target`, dragging to orbit never drifts whatever
it's aimed at away from screen centre — only an explicit pan (shift-drag)
moves it, as a screen-space offset on top of the orbit. Zooming (mouse
wheel) rescales that offset by the same factor as the zoom, so whatever
point sits at screen centre stays there through further zooming instead of
sliding away from it — the per-node perspective factor cancels out of the
ratio, so this holds regardless of a node's depth.

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

## Roadmap

* Analyzers for Python, Go and Rust (tree-sitter based) and a `--git` mode that
  records the commit the graph was taken from.
* Collapse a zone into a single node (module-level graph) and expand it again.
* Highlight the edges that would have to be removed to make the graph a tree
  (the edges with a lift above 0 are already known; draw them apart).
* Persist panel settings in the URL so a view can be shared.
* Optional WebGL renderer for very large graphs.
