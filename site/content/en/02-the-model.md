# The model, briefly

<!-- graph: d3-force; view: 3d; labels: all; pitch: 0.45 -->

Just enough definition of the graph for the chapters that follow. The derivation is in the [theory](https://github.com/roksechs/a-program-must-be-a-tree/blob/main/docs/THEORY.md).

## Nodes and edges

A **declaration** is a node: a function, class, method, variable or type, plus one `module` node per file for code written at top level outside any declaration.

An **occurrence** is an edge. When the body of a declaration `D` contains the name of another declaration `D'` **free**, not captured by any binder inside the body, then `D → D'`. The kind of the edge is decided without reading the name, from two things only.

- **Phase**: does the occurrence sit in a type position or a term position? In a type position it is `type`. Types are erased at run time, so this edge cannot take part in any run-time behaviour.
- **Evaluation context**: in a term position, what does the surroundings do with the value? Apply it: `call`. Construct with it: `create`. Inherit from it: `extends`. None of these, so the value leaves the spot, passed as an argument, stored, returned: `reference`.

The definition of `reference` is the hinge of the system. In `arr.map(f)`, `f` is not called; it is called inside `map`. So `D → f` is a `reference`, not a `call`, and the actual call is found elsewhere by an analysis that follows the flow of values. An edge that asserts a call and an edge that records a flow are never mixed.

Every edge also carries a **time**. An occurrence evaluated while the module loads (a top-level initializer, `extends`, a static field) is **definition** time; one evaluated at run time inside a function body is **use** time. Chapter 2b shows this distinction deciding what counts as a declaration at all.

## Three graphs

Each set of kinds gives a graph.

- **Control graph**, `call` + `create`: who runs whom. The basis for call heights, cycles and the tree diagnostics.
- **Uses graph**, plus `reference` and `extends`: Parnas's *uses* relation, the coupling relation in which the correctness of `D` depends on the correctness of `D'`.
- **Full graph**, plus `type`: everything that is drawn.

The switches in the viewer's Edges section are this choice. An enabled kind is drawn, acts as a spring in the physics and counts for degrees, heights and diagnostics; a disabled kind does none of these. The picture, the layout and the numbers always describe the same graph.

## Call height: the vertical axis of the 3D view

Collapse the graph into its strongly connected components (the members of a cycle fold into one) and take, for each component, the longest path to a sink. That is **call height**. Pure callees that call nothing have height 0 and sit on the floor; the deepest callers sit on top. Declarations in a cycle share one height.

The 3D view on the right uses that height as its vertical axis. x and y are the 2D force layout unchanged; z is height. A translucent plane is drawn per layer so they can be counted. Chapter 10 compares this axis with Clean Architecture's concentric rings.

## Distance from a tree

A graph is a tree when every node but the root has **exactly one** incoming edge. Definition 10 of the theory gives that its operational meaning:

> A program is a forest exactly when every declaration except the roots could be moved into the body of its unique user as a local definition.

The distance from a tree is therefore **the amount of code that has to be visible from outside**. Every metric in this article, surplus edges, the single-caller ratio, and lift, the distance in the dominator tree, is a way of measuring that distance.
