# What is the difference between `ns.f = function` and `obj.cb = function`?

<!-- graph: sample-bindings; view: 3d; labels: all; highlight: namespace.js -->

They have the same shape.

```js
d3.scale.linear = function () { … };   // this one declares
el.onclick      = function () { … };   // this one does not
```

We tell them apart at once: one "defines a function in a namespace", the other "registers a callback". But the words we used, namespace, instance, callback, are all words about **meaning**. Run the test from chapter 1. Rename every identifier to `a1`, `a2`, and you can no longer say which of `a1.a2.a3 = function` and `a4.a5 = function` is the namespace.

So we have to look on the structural side for facts that are decided without reading names. There are two.

## Fact 1: when does the assignment run?

`d3.scale.linear = …` runs the moment the module is loaded, once, unconditionally. In the words of §4 of the theory it is **definition time**: part of the `letrec` that a module is.

`el.onclick = …` runs when `setup(el)` is called. Perhaps many times, perhaps never. **Use time**.

The test is mechanical. If there is a λ, a function boundary, anywhere between the statement and the root of the module, it is use time; otherwise definition time.

## Fact 2: can other code name the target?

Write `d3.scale.linear(...)` in another file and you have called this function **by name**. The receiver `d3.scale` is a **path** of names that can be followed from a module-level binding, or from an undeclared global, using nothing but names.

`el.onclick` cannot be named. `el` is a parameter, a value that arrives at run time. No static name anywhere in the program reaches this function. The browser gets to it by following a value, not by a name.

This fact is decisive because a node in the graph is something an occurrence can target, and Definition 1 of the theory requires an occurrence to carry a **name**. What has no name cannot be the end of an edge.

## Two facts, four cells

| | Receiver reachable by name | Receiver is a run-time value |
|---|---|---|
| **Definition time** | **Declaration.** `ns.f`, `X.prototype.m`, `exports.f`: the ES5 spelling of `export` and of a class method | Rare. A store |
| **Use time** | **Late binding.** `app.handler = function` inside `init()`: nameable, but absent until `init` has run | **Store.** `el.onclick`. The closure escapes into a slot; its callers are found only by following values |

Which cell a statement lands in does not move when every identifier is made meaningless. When it runs is a matter of syntactic position, and whether the receiver is reachable by name is a matter of binding structure; neither reads the spelling.

> **"Namespace" is just the name we give, after the fact, to an object whose properties are only ever written at definition time.**

A word about meaning, derived from a fact about structure. That order is the pattern this whole article keeps using.

## The four cells in a real graph

The graph on the right is a small program with one file per cell (`samples/bindings/`), run through the real analyzer. It is not a drawing.

**Declaration (`namespace.js`).**
`chart` is a global declared nowhere in the program. Still, `chart.scale = {}` and `chart.scale.linear = function` bind named slots at load time, so they become nodes: `chart.scale` (a variable) and `chart.scale.linear` (a function whose parent is `chart.scale`). The solid edge from `main` to `linear` is a `call`; the edge to `chart.scale` is a `reference`. d3 v3 defined 146 public API functions this way, and before the analyzer had this rule, every one of them dissolved into "miscellaneous module code" and was invisible.

**Declaration, the ES5 class (`prototype.js`).**
`proto.isValid = function` is a method written outside the class body, and becomes the node `Moment.isValid`. `Moment.utc = function` is a static member. And `proto.add = add` is an **alias**: it adds one more name for the already declared function `add`, so no new node is made and `add` gains the member role on `Moment`. In the graph `add` sits alone on the floor, with the `call` from `isValid → add` pointing at it. The same treatment as `import`.

**Late binding (`late.js`).**
`app.handler` exists as a node and calls `tick`. But the edges differ in kind. `init → handler` is a `reference`: `init` does not call `handler`, it **installs** it. `route → handler` is the `call`. And if `route` runs before `init`, `app.handler` is undefined. The initialisation hazard of §4 of the theory, in another costume.

**Store (`store.js`).**
Neither `el.onclick = function` nor the top-level `list[0].f = function` has a node, because neither `onclick` nor `f` is a name. What the closure's body refers to, here `save`, becomes an edge of the enclosing declaration: `setup → save`, and for the top-level store, an edge from the brown `module` node to `save`. The function escapes into a slot, and who calls it is known only by following values (control-flow analysis).

One edge is **dashed**: the one from `main` to `isValid`. The `m` in `m.isValid()` has no type, so the analyzer resolved it to "every instance member of that name". That is an over-approximation, so the edge is marked `inferred` and drawn dashed. The picture distinguishes the edges the analyzer inferred from the edges written in the source.

## The same distinction separates classes from objects

```js
class Moment {
  constructor() {
    this.onChange = () => {};              // store — a fresh closure per new
  }
  add(n) { /* … */ }                        // declaration — once, when the class statement runs
}
Moment.prototype.subtract = function () {}; // declaration — the same cell as add
proto.abs = abs;                             // alias — abs gains the member role
```

What is put on the prototype (the class, the namespace) is declared once, at load time; in Cook's terms, it is the body of the generator `gen_C`. What is put on the instance is stored once per construction: written after the fact onto the result of `fix(gen_C)`. What chapter 1 called "the relation between classes and objects" is, operationally, this one distinction.

## Two honest notes

Treating the gray zone, a late binding into a named slot at use time, as a *declaration* is a **design decision**, not a consequence of the calculus. Treating it as a store would have been possible too. We took the view that whatever can be named should be able to be the end of an edge, and put it on the declaration side, flagged so it can be told apart.

"Renaming every identifier moves no cell" holds for **the identifiers you wrote**. Four words, `prototype`, `exports`, `module.exports` and `Object.assign`, are conventions of the language and the platform, and the analyzer does treat them specially by spelling. The precise statement is not that the structural test is free of names, but that it depends only on names fixed by convention.
