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
| `id`       | string          | Unique within the document. Convention: `<file>::<qualified name>`; a member is `<parent id>.<name>`, so a member bound by assignment in another file carries its parent's file in its id while `file` says where it was written. A binding on an undeclared global (`d3.scale = {}`) is `<file>::<full path>`. A local function emitted with the analyzer's `--nested` option is `<parent id>/<name>` (`/` marks lexical nesting, `.` membership). |
| `name`     | string          | Display name (unqualified). |
| `kind`     | string          | One of `function`, `method`, `class`, `variable`, `interface`, `type`, `enum`, `module`, or any other string. Unknown kinds are rendered with a neutral colour. A `module` declaration stands for the top-level code of a file (statements outside any declaration, e.g. `X.prototype = {...}` or a call at load time); the TypeScript analyzer emits one per file that has such code, with id `<file>::<module>`. |
| `file`     | string          | Path relative to `meta.root`, using `/` separators. The directory hierarchy is derived from this path and drawn as nested zones. |
| `line`     | number          | 1-based line of the declaration (optional). |
| `parent`   | string or null  | Id of the enclosing declaration: the class of a method, or the class, namespace object or function a member was bound to by assignment (`C.prototype.m = …`, `ns.f = …`; `THEORY.md` §4.1). A function aliased into a slot (`proto.add = add`) keeps its own id and gets the slot's owner as parent. Optional. |
| `exported` | boolean         | Whether the declaration is visible outside its file. Optional. |
| `late`     | boolean         | `true` for a *late binding*: a slot assigned inside a function body (`app.handler = function` in `init()`), which other code can name but which exists only after that body has run. Optional. |
| `aliases`  | string[]        | Qualified slot names this declaration was aliased into (`["Moment.add"]` for `proto.add = add`). Optional. |

## `edges[]`

| field    | type   | notes |
|----------|--------|-------|
| `source` | string | Id of the declaration whose body contains the reference (the caller). |
| `target` | string | Id of the referenced declaration (the callee). |
| `kind`   | string | `call` (application of a function or method, including `super()`), `create` (`new X()`: the constructor that lookup finds for `X`, or `X` itself when no ancestor declares one), `reference` (value used without being applied, e.g. passed as a callback, stored or returned), `type` (type-only use, including a call through an interface member), `extends`, `implements` (class to interface, or member to the interface member it implements), `override` (member to the member it overrides). Optional, defaults to `call`. See `THEORY.md`. |
| `count`  | number | Number of occurrences. Optional, defaults to 1. |
| `time`   | string | `definition` when the occurrence is evaluated while the module initialises (top-level initializers, `extends`, static fields), `use` when it runs inside a function or method body. Optional, defaults to `use`. |
| `inferred` | boolean | `true` when the edge was not written at that place in the source but derived by analysis: a dispatched call to an overriding method, a callback resolved by flow analysis at the declaration that actually invokes it, or a call on a receiver the type checker cannot type, resolved to every instance member of that name. Optional. |

The precise meaning of each kind (phase, evaluation context, lookup rules) is
derived in `THEORY.md`.

Rules:

* Both ends of every edge must exist in `declarations`. The viewer drops
  dangling edges and reports them in the diagnostics panel.
* Self edges (direct recursion) are allowed.
* Duplicate `(source, target, kind, time)` tuples are merged by summing `count`.
* The viewer computes degrees, call heights and the tree diagnostics on the
  *control graph*: edges of kind `call` and `create`. Every other kind is
  drawn and listed but does not make a declaration a caller.

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
