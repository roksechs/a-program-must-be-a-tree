# Declaration graph data format

Every analyzer emits one JSON document with the shape below. The viewer only
depends on this document, so a new language can be supported by writing an
analyzer that produces it (in any language, with any parser).

```json
{
  "meta": {
    "name": "self",
    "root": ".",
    "language": "typescript",
    "generatedAt": "2026-09-05T00:00:00.000Z",
    "analyzer": "analyzers/ts@0.1.0"
  },
  "declarations": [
    { "id": "site/js/model.js::buildGraph", "name": "buildGraph", "kind": "function",
      "file": "site/js/model.js", "line": 12, "parent": null, "exported": true }
  ],
  "edges": [
    { "source": "site/js/app.js::main", "target": "site/js/model.js::buildGraph", "kind": "call" }
  ]
}
```

## `declarations[]`

| field      | type            | notes |
|------------|-----------------|-------|
| `id`       | string          | Unique within the document. Convention: `<file>::<qualified name>`. |
| `name`     | string          | Display name (unqualified). |
| `kind`     | string          | One of `function`, `method`, `class`, `variable`, `interface`, `type`, `enum`, `module`, or any other string. Unknown kinds are rendered with a neutral colour. |
| `file`     | string          | Path relative to `meta.root`, using `/` separators. The directory hierarchy is derived from this path and drawn as nested zones. |
| `line`     | number          | 1-based line of the declaration (optional). |
| `parent`   | string or null  | Id of the enclosing declaration (e.g. the class of a method). Optional. |
| `exported` | boolean         | Whether the declaration is visible outside its file. Optional. |

## `edges[]`

| field    | type   | notes |
|----------|--------|-------|
| `source` | string | Id of the declaration whose body contains the reference (the caller). |
| `target` | string | Id of the referenced declaration (the callee). |
| `kind`   | string | `call` (call, `new` or `super()` expression; `new X()` and `super()` target `X.constructor` when the class declares one, otherwise the class itself), `reference` (value used without calling, e.g. passed as a callback), `extends`, `implements`, `type` (type-only reference). Optional, defaults to `call`. |
| `count`  | number | Number of occurrences. Optional, defaults to 1. |

Rules:

* Both ends of every edge must exist in `declarations`. The viewer drops
  dangling edges and reports them in the diagnostics panel.
* Self edges (direct recursion) are allowed.
* Duplicate `(source, target, kind)` triples are merged by summing `count`.

## Derived properties (computed by the viewer)

* **Containers.** Every directory prefix of `file`, plus the file itself, is a
  container. A top-level directory has depth 1 and a file sits one level below
  its directory; the viewer lets the user choose up to which depth containers
  are drawn as zones. Containers are never used by the physics.
* **Call height.** The graph is condensed into strongly connected components
  (SCCs); the height of a node is the longest path from its SCC to a sink SCC in
  the condensation DAG. Leaves (callees only) have height 0 and sit at the
  bottom of the 3D view; the deepest callers have the largest height and sit at
  the top.
