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
  `DATA_FORMAT.md`. The first one covers JavaScript / TypeScript using the
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
* **Gravity**: weak `forceX`/`forceY` towards the origin so disconnected
  components stay on screen.
* **Collision**: keeps circles from overlapping.

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
panel is a matrix: for every kind the user chooses independently whether it
is drawn, whether it acts as a spring in the physics, and whether it counts
for degrees, call heights and the diagnostics. Edges found by analysis
rather than written at that spot (dispatched overrides, callbacks resolved
by flow analysis) are dashed.

## Tree-likeness diagnostics

All structural diagnostics, the degrees and the call heights are computed on
the edge kinds ticked under *Diagnostics* in the Edges section. The default
is the *control graph*, the edges of kind `call` and `create`, so passing a
callback or naming a type does not make the graph "less of a tree" unless
the user asks for those kinds to count.

For `n` nodes, `m` control edges and `c` weakly connected components:

| metric              | definition | 1 means |
|---------------------|------------|---------|
| Spanning ratio      | `(n - c) / m` | the edge set is exactly a spanning forest |
| Acyclicity          | `1 - (nodes in a cycle) / n` | no recursion, direct or mutual |
| Single caller ratio | `1 - (nodes with > 1 caller) / n` | every declaration has one parent |
| DAG-ness            | `1 - (edges inside SCCs) / m` | no edge closes a cycle |
| Tree score          | mean of the four | a forest |

Also reported: components, roots (uncalled), leaves (calling nothing), longest
call chain, surplus edges (`m - (n - c)`), number of non-trivial SCCs, self
loops, the declarations with the most callers, and *initialisation cycles*:
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
  (feedback arc set / minimum extra-caller edges).
* Persist panel settings in the URL so a view can be shared.
* Optional WebGL renderer for very large graphs.
