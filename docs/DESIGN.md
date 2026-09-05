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
  code outside any declaration (`X.prototype = {...}`, a call at load time), so
  references made by such code are not lost. The first one covers JavaScript / TypeScript using the
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
| `graph2d.js`    | SVG renderer: zoom/pan, drag, arrows, hulls, labels, selection. |
| `graph3d.js`    | Canvas renderer: same x/y, z = call height, orbit camera, layer planes. |
| `panel.js`      | Property panel (controls + diagnostics + selection details). |
| `app.js`        | Data loading and wiring. |

Both renderers read the same node objects, so switching between 2D and 3D does
not restart the simulation and the user does not lose the layout.

## Physics

d3-force is used as the integrator. The forces are:

* **Repulsion**: `d3.forceManyBody` with negative strength. Its magnitude is
  `strength / distance`, i.e. inversely proportional to distance, as required.
* **Springs**: a custom force (`forceSpring`) applying Hooke's law along every
  edge, `F = k * (d - restLength)`, split between the endpoints by their degree
  so a hub is not thrown around by one neighbour. `d3.forceLink` is close, but
  the custom force keeps the parameters (stiffness, rest length) explicit.
* **Collision**: keeps circles from overlapping.

That is all. A spring along an edge is the only attraction in the layout, so
two declarations end up next to each other only when something connects them.
Two entries in the simulation look like extra forces but are not:

* **Repulsion range** (`distanceMax` on the charge): past that distance the
  repulsion is simply cut off. Without a cut-off every node presses on every
  other node from any distance, and the accumulated far field inflates the
  whole graph until something holds it back.
* **Centring** (`d3.forceCenter`): translates all nodes so their centroid sits
  at the origin. A rigid translation deforms nothing.

There used to be a third force, a weak `forceX`/`forceY` pull towards the
origin, meant to keep disconnected components on screen. It was removed: with a
`1/d` repulsion and a linear pull, the equilibrium is a disc of the radius where
the two balance and the nodes spread through it almost uniformly, so the picture
became a circle whatever the graph looked like. Measured on the `self` dataset,
that pull (strength 0.05) put the median node at 0.59 of the outer radius, close
to the 0.707 of a uniformly filled disc; without it the median sits at 0.44 at
the same outer radius, i.e. a dense core and real branches. The repulsion
cut-off does the job the pull was there for, without shaping anything.

Directories and files have no influence on the physics: no force reads the
containers, and the initial positions are seeded on a spiral in declaration
order without looking at file paths. The layout therefore reflects the call
graph alone, and the zones merely show where the declarations of a file or
directory ended up.

"Recompute" resets the simulation alpha to 1 (reheat), "Reset positions"
re-seeds the coordinates first. Dragging a node pins it while the pointer is
down.

## Zones

Containers are derived from file paths: every directory prefix is a container,
the file itself is the innermost one. A single depth slider chooses how many
levels are drawn: 0 draws nothing, 1 the top-level directories, and so on down
to the files, which count as one level below their directory (a file at the
repository root has depth 1). A container whose node set is identical to its
visible parent is skipped so a directory with a single file does not produce
two identical hulls.

Each zone is the convex hull of its members' positions, padded by expanding
every point into a small polygon before hulling, and rendered with a closed
Catmull-Rom curve so it looks rounded. Directories and files use the same
style; nesting is visible from the hulls themselves. The same code produces the 3D zones by
hulling the projected screen coordinates.

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
on a 2D canvas; no WebGL dependency is needed for a few thousand nodes.

## Edge kinds

The meaning of `call`, `create`, `reference`, `type`, `extends`,
`implements` and `override`, and why the split follows from erasure and
evaluation contexts, is derived in `THEORY.md`. The Edges section of the
panel has one switch per kind: an enabled kind is drawn, acts as a spring in
the physics and counts for degrees, call heights and the diagnostics; a
disabled kind does none of these, so the picture, the layout and the numbers
always describe the same graph. Type-level edges are off by default. Edges
found by analysis rather than written at that spot (dispatched overrides,
callbacks resolved by flow analysis, and the candidates of a call through a
union type or a record indexed at run time) are dashed.

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
(`call` + `create`) of `THEORY.md` §7.

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

## Roadmap

* Analyzers for Python, Go and Rust (tree-sitter based) and a `--git` mode that
  records the commit the graph was taken from.
* Model property stores and anonymous functions in the flow analysis
  (objects of callbacks, event maps).
* Nested declarations (inner functions) as their own nodes, behind a flag.
* Collapse a zone into a single node (module-level graph) and expand it again.
* Highlight the edges that would have to be removed to make the graph a tree
  (the edges with a lift above 0 are already known; draw them apart).
* Persist panel settings in the URL so a view can be shared.
* Optional WebGL renderer for very large graphs.
