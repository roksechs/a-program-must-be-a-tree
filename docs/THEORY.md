# Theory: what a dependency edge is

This document gives a precise definition of the edges the analyzers emit and
the graphs the viewer measures. It fixes the vocabulary (`call`, `create`,
`reference`, `type`, `extends`, ...) by deriving it from a small core
calculus rather than from tool conventions. `DATA_FORMAT.md` is the wire
format; this is its semantics.

The short version: **a dependency is a free occurrence of one declaration's
name inside another declaration's body, and its kind is decided by two
things: the phase the occurrence lives in (type or term) and the evaluation
context that consumes it (application, projection, construction, or none:
the value escapes).**

## 1. Core calculus

We model a TypeScript/JavaScript module as a mutually recursive block of
top-level declarations (a `letrec`). The calculus is deliberately small; the
analyzer maps real syntax onto it (section 6).

```
Program       P  ::= letrec D_1; ...; D_n
Declaration   D  ::= x = e                          (variable, function when e is a λ)
                   | class C extends e { ctor = λȳ.e ; m_i = λȳ.e_i }
                   | type T = τ                     (interface, type alias, enum type)
Term          e  ::= x | c                          (variables, constants)
                   | λy.e | e e                     (functions, application)
                   | { m = e } | e.m                (records, projection)
                   | e.m := e                       (field assignment)
                   | new e (ē) | super (ē)          (construction, base constructor call)
                   | let y = e in e | e : τ         (binding, type ascription)
                   | return e                       (tail position marker inside a λ)
Type          τ  ::= T | C | τ → τ | { m : τ } | ...
Value         v  ::= c | λy.e | { m = v̄ } | class-value | object
```

Notation: `body(D)` is the right-hand side of a declaration (for a class, the
`extends` expression plus every member initializer and method body).
`name(D)` is `x`, `C` or `T`.

**Definition 1 (occurrence).** An *occurrence* of a declaration `D'` in `D` is
a leaf position `p` in the syntax tree of `body(D)` labelled `name(D')` that
is *free*, i.e. not bound by any binder (`λ`, `let`, parameter, pattern)
inside `body(D)`.

**Definition 2 (raw dependency).** `D → D'` iff there is at least one
occurrence of `D'` in `D`. This is the union of every edge kind below; the
kinds partition the occurrences, not the pairs, so one pair `(D, D')` may
carry several edges of different kinds.

Everything else in this document classifies a single occurrence `p`.

## 2. Phase: type-level and term-level occurrences

Types and terms are separate syntactic categories. The erasure function
`⌊·⌋` removes every type: `⌊e : τ⌋ = ⌊e⌋`, `⌊type T = τ⌋ = ∅`, and it
recurses through all other forms. This is the *phase distinction* of Cardelli
(1988) and Harper, Mitchell and Moggi (1990): evaluation is defined on
`⌊P⌋`, so a position inside a `τ` is never reached by evaluation.

**Definition 3 (phase).** `p` is *type-level* iff it lies inside a subterm of
category `τ`; otherwise it is *term-level*.

**Fact 1 (erasure).** If `p` is type-level then `p ∉ ⌊body(D)⌋`. Hence
type-level occurrences cannot participate in any run-time behaviour of `D`.

This yields the first kind:

* `type` := a type-level occurrence (annotations, generics, `implements`,
  `import type`, casts, interface extension).

A type-level dependency is a dependency on a *specification*: by Mitchell
and Plotkin (1988), an abstract type is an existential type `∃t.σ`, and a
user of the interface depends on `σ` but not on the witness. That is why type
edges are excluded from the run-time diagnostics but kept in the graph.

## 3. Evaluation contexts

The term-level classification comes from the reduction semantics. We use
call-by-value reduction with evaluation contexts in the style of Felleisen
and Hieb (1992): a context `E` is a term with one hole `[]`, and the grammar
of `E` fixes where the next reduction step happens.

```
E ::= []                                  (the hole: the term being evaluated)
    | E e            | v E                (operator first, then operand)
    | E.m                                 (receiver of a projection)
    | new E (ē)      | new v (v̄, E, ē)    (class, then constructor arguments)
    | super (v̄, E, ē)
    | let y = E in e
    | E : τ                               (transparent: erased before evaluation)
    | return E
```

Reduction rules (the ones that matter here):

```
(β)      E[(λy.e) v]            → E[e[v/y]]
(proj)   E[{..., m = v, ...}.m] → E[v]
(new)    E[new C (v̄)]           → E[ctor_C v̄ o]     with o = fix(gen_C)
(super)  E[super (v̄)]           → E[ctor_B v̄ this]  where B = parent(C)
```

An evaluation context is the *continuation* of the term in the hole: it says
what the rest of the computation will do with the value once it is produced.
That is exactly the information a dependency kind should record, because it
distinguishes "D runs D'" from "D hands D' to someone else".

**Definition 4 (consumer frame).** Let `p` be a term-level occurrence in
`body(D)`. Walk from `p` upwards through *transparent* nodes (parentheses,
`e : τ`, non-null assertions, `as` casts). The first non-transparent node
reached is the *consumer frame* `F(p)`, together with the position of `p`
within it. The consumer frame is the innermost evaluation-context frame that
will be applied to the value of `p`.

**Definition 5 (role).** The *role* of `p` is determined by `F(p)`:

| consumer frame `F(p)`             | position of `p`  | role        |
|-----------------------------------|------------------|-------------|
| `[] e`                            | operator         | applied     |
| `[].m` followed by `[] e`         | receiver of a projection whose result is applied | receiver of a call |
| `[].m`                            | receiver, result not applied | projected |
| `new [] (ē)`                      | class            | constructed |
| `super (…)`                       | (keyword)        | applied to base constructor |
| `class … extends [] { … }`        | base expression  | extended    |
| `v []`, `e []`, `new v (…, [], …)` | operand          | escapes     |
| `let y = [] in e`, `x = []`, `{ m = [] }`, `return []` | bound, stored, returned | escapes |

"Escapes" is the precise name for "the value leaves the body of `D` without
being consumed there" (escape analysis, Park and Goldberg 1992). Its
consumer frame lies in some *other* declaration, or in the caller of `D`.

**Definition 6 (kinds).** For a term-level occurrence `p` of `D'` in `D`:

* `call` := role *applied*, or the method name in a projection whose result
  is applied (`o.m(ē)`), or *applied to base constructor* (`super`).
* `create` := role *constructed* (`new C(ē)`). Its target is the constructor
  that lookup finds for `C`: `C.constructor` if `C` declares one, otherwise
  the nearest ancestor's constructor, otherwise `C` itself (default
  constructor).
* `extends` := role *extended*.
* `reference` := role *escapes* or *projected* without application.

The analyzer emits `create` for `new` and resolves its target with the
lookup rule above (own constructor, then the nearest ancestor's).

### 3.1 Why the operator position is the right notion

The syntactic role is not a convention: it is the static shadow of the
dynamic call relation.

**Definition 7 (dynamic call relation).** Label every `λ` and every class in
`P` with the declaration whose body contains it. Run `⌊P⌋`. `D ⇝ D'` iff some
reduction step `E[(λy.e) v] → …` fires with the `λ` labelled `D'` while the
innermost enclosing labelled frame on the evaluation context is `D` (the
same for `new` and `super` steps and constructors).

**Fact 2 (operator position realises a call).** If `p` is an occurrence of a
function declaration `D'` in `D` with role *applied*, then whenever
evaluation of `body(D)` reaches `p`, the next reduction of that subterm is a
`(β)` step whose `λ` is the one bound by `D'`. Hence `D ⇝ D'` on every run
that reaches `p`. Syntactic `call` edges are therefore *sound witnesses* of
dynamic calls, up to reachability.

**Fact 3 (escapes defer the call).** If `p` escapes, no reduction inside
`body(D)` applies the value of `p`. If it is ever applied, the `(β)` step
happens under a frame labelled by some other declaration `D''` (the one
whose operator position eventually receives the value). So the dynamic edge,
if any, is `D'' ⇝ D'`, not `D ⇝ D'`. The `reference` edge `D → D'` records
the *flow* that makes `D'' ⇝ D'` possible.

This is the whole callback story: in `arr.map(f)` the occurrence of `f`
escapes; the call happens inside `map`, at the operator position of its
parameter. Recording `D → f` as `call` would assert a control transfer that
never happens in `D`.

### 3.2 From syntax to semantics: control-flow analysis

Finding the `D''` of Fact 3 statically is control-flow analysis. 0-CFA
(Shivers 1991; Nielson, Nielson and Hankin 1999, ch. 3) computes for every
operator position `ℓ` an abstract cache `Ĉ(ℓ)` ⊇ the set of `λ`s that may
be the value at `ℓ` in any run.

**Definition 8 (CFA call relation).** `D ⇝̂ D'` iff some operator position `ℓ`
in `body(D)` has `λ_{D'} ∈ Ĉ(ℓ)`.

**Fact 4 (soundness).** `⇝ ⊆ ⇝̂` (0-CFA is a sound abstraction of the
collecting semantics of the reduction relation), and every syntactic `call`
edge is in `⇝̂` because `λ_{D'} ∈ Ĉ(ℓ)` whenever `D'` occurs syntactically at
`ℓ`.

So the three relations nest: `syntactic calls ⊆ ⇝̂ ⊇ ⇝`. The syntactic
graph is the cheapest sound *lower* description of control transfer plus an
exact description of value flow (`reference`); a CFA pass turns each
`reference` edge into zero or more `call` edges originating elsewhere.

The TypeScript analyzer runs a bounded 0-CFA after the syntactic pass:
abstract values are sets of declared functions, methods and classes, and
they flow through local bindings, through the parameters of declared callees
(including dispatched method targets) and through the return values of
declared functions, to a fixed point. A call whose callee evaluates to a
declared function produces a `call` edge marked `inferred` from the
declaration that contains the operator position. Property stores (§4.1,
Definition 9a) and external callees are not modelled, so a callback stored
into an object that escapes, or handed to a function this analyzer never
sees the body of, keeps its `reference` edge and nothing else. A
function-like value that names a slot — a variable initializer or an object
literal property, escaping or not — is declared (Definition 9a) and enters
the CFA exactly like any other function; only a value that never occupies a
named slot at all, such as a bare `arr.map(x => f(x))` argument, has no
declaration to flow as. The analysis is sound for what it claims and silent
otherwise.

### 3.3 Tail position and the continuation view

The consumer of a value in `return []` position is the evaluation context of
the *call site* of `D`, which is unknown inside `D`. That is why `return f`
is an escape: `function g() { return f }` followed by `g()()` calls `f` from
the declaration containing `g()()`, not from `g`. Reading `E` as a
continuation makes the rule uniform: **the kind of an occurrence is the
first thing its continuation does with the value, and if the continuation
leaves the declaration, the kind is `reference`.**

### 3.4 Members and dispatch

`o.m(ē)` has two occurrences: `o` (role *receiver of a call*) and `m`
(role *applied*). The edge for `m` targets the method declaration; the edge
for `o` targets whatever `o` denotes (usually a local, hence no edge; for a
namespace or class it is a `reference`).

Its target set is a static approximation of dynamic lookup. If the static
type of `o` is `C`, class hierarchy analysis (Dean, Grove and Chambers 1995)
gives `{ C'.m | C' ≤ C, C' declares m }`. The TypeScript checker returns the
member of the static type, i.e. the single most general element of that
set; the analyzer adds one `inferred` `call` edge per overriding
implementation in a declared subclass. A call through an interface member
yields a `type` edge to the interface and `call` edges to the implementing
members. Static members never dispatch. The structural relations are emitted
separately: `override` from a member to the nearest ancestor member it
overrides, `implements` from a member to the interface member it
implements.

### 3.5 Assignment targets: read and write

An occurrence in an ordinary evaluation-context hole has its *value* used
by the consumer frame (Definition 5): the frame reads the occurrence. An
assignment is different: `x = e` does not read `x`, it *replaces* the
binding's contents, and `x` names which binding — a distinct kind of
occurrence the grammar of §3 has no hole for. Extend it with one production:

```
E ::= ... (as in §3)
    | x = E                                  (assignment: the right side is the hole)
```

**Definition 5a (target position).** An occurrence `p` of a variable `x`
in `body(D)` is a *target* when `p` is the left-hand side of `x = e`
(assignment) or `x ⊕= e` for an arithmetic or logical operator `⊕`
(compound assignment: `+=`, `-=`, `*=`, ...), or the operand of `x++` or
`x--`. Plain assignment (`x = e`) *only writes*: the previous value of `x`
plays no part in the new one. Compound assignment and `++`/`--` *read and
write*: `x ⊕= e` reduces to `x = x ⊕ e`, so the occurrence both supplies the
old value and receives the new one.

**Definition 6a (write).** For a target occurrence of `D'` in `D`:

* `write` := the target role, whether plain or compound. Unlike every other
  kind in Definition 6, its edge runs **from `D'` to `D`**, not from `D` to
  `D'`.
* if the target is a compound assignment (or `++`/`--`), the analyzer
  *also* emits the ordinary `reference` edge `D → D'` (Definition 6), since
  the old value is read too.

The direction reverses because a `write` edge records a different
dependency than every other kind. `call`, `create` and `reference` all
point from the side whose *correctness* depends on the other: `D` cannot
run without knowing what `D'` does or currently holds, so `D → D'`. A write
inverts which side is which: `D`'s correctness does not depend on
`total`'s value at all (it only assigns one) — `total`'s *next* value is
determined by what `D` computed. The dependency points at whoever produces
the value, which for a write is `D`, not `D'`. This is the reverse of the
default because assignment is the one construct in the calculus where the
declaration in the hole is a consumer of nothing and a producer of
everything.

A plain function, method or class is the degenerate case of a slot written
exactly once, at definition time, by the declaration itself — which is
exactly why §4.1 already treats it as a `binding` rather than a `write`:
with a single writer, a separate read edge would name the same declaration
every time and add nothing. A mutable variable with more than one writer at
use-time is the case where the distinction starts to carry information: the
value `total` holds at any point depends on which writer last ran, an
ordering the write edges alone do not fix (they say *who can* determine the
value, not *when*).

Worked example:

```js
function addItem(item) { total += item.price; }   // write: total -> addItem
                                                    // reference: addItem -> total (the += also reads)
function checkout()    { return total; }           // reference: checkout -> total (read only, no write)
```

## 4. Time: definition-time and use-time occurrences

Term-level occurrences differ in *when* the consumer frame runs.

**Definition 9 (definition-time).** `p` is *definition-time* iff no `λ` (or
method body) lies between `p` and the root of `body(D)`; otherwise it is
*use-time*. Definition-time occurrences are evaluated once, when the
`letrec` initialises `D`; use-time occurrences run whenever `D` is invoked.

Examples: an `extends` expression, a top-level `const x = f(1)`, a static
field initializer and a decorator are definition-time; anything inside a
function or method body is use-time.

This distinction is what makes some cycles errors and others fine.
Waddell, Sarkar and Dybvig ("Fixing letrec", 2005) formalise `letrec`
initialisation: the graph of definition-time dependencies among bindings
must admit a topological order, otherwise a binding is read before it is
initialised (a temporal dead zone error in JavaScript, `undefined` under the
older `var` semantics). Cycles among use-time occurrences are ordinary
recursion and are always well-defined because `λ` delays evaluation.

Every edge carries `time: "definition" | "use"`. The viewer reports the
declarations caught in a cycle of definition-time term-level edges as
*initialisation cycles*, separately from ordinary recursion.

### 4.1 Field assignment: binding or store

A statement `P.m := e` writes a function (or any value) into a slot. Whether
that *declares* something is not a matter of what `P` is called ("a
namespace", "an instance") but of two structural facts, both invariant under
renaming every identifier:

* **When does it run?** At definition time (no `λ` between the statement and
  the root of the module) or at use time (inside some body)?
* **Can other code name the target?** Is `P` a *path of names* — an
  identifier bound at module level, or an undeclared global, followed by
  projections, `C.prototype` included — so that another declaration can
  write `P.m` and mean exactly this slot? Or does `P` denote a value that
  only exists at run time (a parameter, a local, an element, a call result,
  `this`), which no static name reaches?

Definition 1 requires an occurrence to carry a *name*, so only a nameable slot
can be the target of an edge. Hence:

**Definition 9a (binding, late binding, store).**

* *Binding*: `P.m := e` at definition time with `P` a path of names. The
  statement extends the `letrec` of section 1 with a declaration named `m`
  whose parent is what `P` denotes (a class for `C.prototype`, a namespace
  object or function otherwise, none for an undeclared global, whose
  qualified name is kept). `ns.f = function` is the ES5 spelling of
  `export function f`; `C.prototype.m = function` of a method (section 5).
  When `e` is the name of a declared function, the statement is an *alias*,
  like `import`: no occurrence and no new node, the function gains the
  member role. Any other value is a variable binding; an object literal is a
  namespace whose function-valued properties are bindings in turn.
* *Late binding*: the same statement at use time. The slot is nameable, so
  call sites `P.m(ē)` elsewhere resolve to it, but it exists only after the
  enclosing body has run: the initialisation hazard above in another
  costume. It is a declaration flagged `late`, with a `reference` edge from
  the declaration that installs it.
* *Store*: `P` denotes a value that can escape — a parameter, `this`, a local
  that outlives this statement. Nothing is declared. The closure escapes
  into the slot (Fact 3), the enclosing declaration keeps the closure's
  body and gets the edges its body makes, and whoever eventually applies
  the value is found by control-flow analysis (§3.2), never by name — because
  any code that later gets hold of the same object can read `P.m` back, so no
  single declaration is "the" one that will call it.
* *Local declaration*: `P` denotes a value with no path *and no escape* — a
  bare object literal passed whole, as an argument, straight into a call or
  constructor, never assigned to a name in between (`f({ m: e })`, not
  `const o = { m: e }; f(o)`). Unlike a store, this value has exactly one
  reader, syntactically visible at the call itself: whichever parameter of
  the callee receives it. Its function-valued properties are therefore
  declared after all, named by the property key — ECMAScript's own
  NamedEvaluation already gives them that name at just this position
  (`{ m(){} }.m.name === "m"`, the same rule a variable initializer uses,
  so this was never truly the "anonymous function" §3.2 disclaims) — parented
  to whichever declaration performs the call, id `<parent>/<m>`. This is the
  same shape as a `--nested` local declaration (Definition 10) and, unlike
  it, is not gated behind that option: a `--nested` local never leaves the
  declaration that wrote it, while a value handed to another declaration this
  way is invoked back by *that* declaration, at a genuinely different time —
  folding it into the caller, the module-level `letrec`'s usual
  simplification, would misattribute every call the handler itself makes to
  whoever merely constructed it.

Treating the late case as a declaration rather than a store is a design
decision, not a consequence of the calculus; the flag keeps it visible. The
same is true of local declarations: nothing forces the choice, but leaving a
handed-off closure's calls attributed to its installer is worse than the
inaccuracy `--nested` accepts by default, because the installer is not simply
approximating "this closure's code" the way a flattened module-level view
approximates a function's own internals — it is a different declaration
entirely, doing a different thing, that just happens to run first.

"Namespace" is thus the name we give an object whose slots are only ever
written at definition time, and the class/object distinction of section 5 is
the same split: what is put on the prototype is bound once when the class
statement runs, what is put on the instance (`this.m := λ` in a constructor)
is stored once per construction.

## 5. Classes, generators and inheritance

Following Cook (1989) and Cook and Palsberg (1989), a class is a
*generator* `gen_C = λself. wrap(gen_B self) ⊕ { m_i = λȳ.e_i[self] }` and
an object is a fixed point `fix(gen_C)`. Under this reading:

* `extends B` applies `gen_B` inside `gen_C`: a term-level, definition-time
  control dependency on `B` (the prototype chain is built when the class
  statement runs). Cycles among `extends` edges are initialisation errors
  by section 4.
* `new C(ē)` evaluates `C`, takes the fixed point and applies the
  constructor: a use-time `reference` to the binding `C` (the generator is
  read as a value) together with a `create` whose target is the constructor
  found by lookup. When the lookup lands on `C` itself, because neither `C`
  nor any ancestor declares a constructor, the `create` alone is recorded.
* `super(ē)` inside `C.constructor` applies `ctor_B`: a `call` to the
  nearest ancestor that declares a constructor.
* `implements I` contributes nothing to the generator: it is type-level.
* An overriding method `C.m` is *selected* by dispatch, never named; the
  relation `C.m overrides B.m` is structural and belongs with `extends`,
  not with calls.
* `C.prototype.m = λȳ.e` after the class (or constructor function) statement
  is `m = λȳ.e` of `gen_C` written incrementally: the module's definition-time
  statements assemble the generator, and the member is declared exactly as
  if it stood in the class body (Definition 9a). `C.prototype.m = f` for a
  declared `f` names an existing `λ`: an alias, `f` becomes the member.
  `C.m = λ` is a static field of the class value. `this.m = λ` inside the
  constructor runs once per `fix(gen_C)`: one closure per object, stored,
  not declared.
* When the receiver of `o.m(ē)` has no static type (untyped JavaScript), the
  target set is approximated by name: the slot `P.m` when `o` is a path of
  names, `C.m` when `o` is `this` inside a member of `C`, and otherwise every
  instance member called `m` in the program — the field-based call graph of
  Feldthaus et al. (2013), an over-approximation and therefore `inferred`.

## 6. Mapping real syntax onto the calculus

| TypeScript / JavaScript                     | calculus                        | kind        | target                                  |
|--------------------------------------------|---------------------------------|-------------|-----------------------------------------|
| `f(a)`                                     | `f a`, operator                 | `call`      | `f`                                     |
| `o.m(a)`                                   | `(o.m) a`                       | `call`      | method `m` (static type, or CHA set)    |
| `ns.f(a)`                                  | `(ns.f) a`                      | `call`      | `f`; `ns` is a `reference`              |
| `new C(a)`                                 | `new C (a)`                     | `create` + `reference` | constructor of `C` by lookup, and `C` itself |
| `super(a)`                                 | `super (a)`                     | `call`      | ancestor constructor                    |
| `g(f)`, `arr.map(f)`, `setTimeout(f)`      | operand                         | `reference` | `f`                                     |
| `const h = f`, `obj.x = f`, `return f`     | bound / stored / returned       | `reference` | `f`                                     |
| `f.bind(o)`, `f.call(o)`                   | `(f.bind) o`: `f` is a receiver | `reference` | `f` (the bound function escapes)        |
| `x = e`, `x` a declared variable           | assignment target (§3.5)        | `write`     | `x`, edge reversed: `x → D`             |
| `x += e`, `x++`, `x--`                     | assignment target, compound (§3.5) | `write` + `reference` | `x → D` (write) and `D → x` (the read half) |
| `x: T`, `<T>x`, `x as T`, `Array<T>`       | type position                   | `type`      | `T`                                     |
| `class C extends B`                        | `extends B`                     | `extends`   | `B`                                     |
| `class C implements I`, `interface I extends J` | type position              | `type` (`implements`) | `I`, `J`                      |
| `import { f } from "m"`                    | alias, no occurrence            | none        | (resolved through the alias)            |
| `import type { T } from "m"`               | alias, no occurrence            | none        |                                         |
| `typeof f` in a type                       | type position                   | `type`      | `f`                                     |
| `ns.f = function () {…}` at top level      | binding (Definition 9a)         | none        | declares `f` with parent `ns`           |
| `C.prototype.m = function () {…}`          | `m = λ` of `gen_C` (section 5)  | none        | declares member `m` of `C`              |
| `C.prototype.m = f`, `exports.f = f`       | alias, no occurrence            | none        | `f` gains the member / export role      |
| `d3.scale.linear = …`, `d3` undeclared     | binding on a global             | none        | declares `d3.scale.linear`, parent `d3.scale` once that is bound |
| `app.h = function () {…}` inside a body    | late binding (Definition 9a)    | `reference` | member `h` flagged `late`; installer → `h` |
| `el.cb = function () {…}`, `el` a value    | store: the closure escapes      | none        | no declaration; the body belongs to the enclosing declaration |
| `f({ m: function () {…} })`, argument      | local declaration (Definition 9a) | none      | declares `m`, parent = the declaration calling `f` |
| `o.m(a)`, `o` untyped                      | `(o.m) a`                       | `call`      | `m` by name path or `this`, else every instance member `m` (inferred) |

`f.bind(o)` deserves a note: `f` is the receiver of a projection whose result
is applied, but the function that is applied is `bind`, not `f`; `f` escapes
into the bound closure. So the rule "receiver of a call" produces a
`reference` to `f`, which is the correct classification.

## 7. Graphs and what "a program must be a tree" means

Let `K` be a set of kinds and `G_K` the subgraph of edges whose kind is in
`K`. Three graphs matter:

* **Control graph** `G_ctl = G_{call, create}`: who runs whom. Used for call
  heights (the 3D axis), cycles and the tree score.
* **Uses graph** `G_uses = G_{call, create, reference, extends}`: every
  term-level dependency. This is Parnas's *uses* relation (1979): `D` uses
  `D'` when the correctness of `D` depends on the correctness of `D'`. It is
  the right graph for coupling metrics and for the acyclic dependencies
  principle (Martin 1996).
* **Full graph** `G_all`: adds `type`. It is what the viewer draws.

`write` (§3.5) is deliberately outside all three: its edges run from a
variable to whoever writes it, the reverse of `call`, `create` and
`reference`, so folding it into `G_ctl` or `G_uses` would mix two opposite
notions of dependency into one graph and corrupt the dominator tree built
from it. `write` is its own lens, off by default in the viewer's Edges
section like `type`, toggled and read on its own.

**Definition 10 (tree-likeness).** Take `G_ctl` (or `G_uses`), condense its
strongly connected components (each non-trivial component is a `letrec`
group that cannot be split; Haskell Report §4.5.1), and let `H` be the
resulting DAG.

* `H` is a *forest* iff every node has in-degree ≤ 1.
* The program is a forest iff every declaration except the roots could be
  moved into the body of its unique user as a local definition.

The second statement is the operational meaning of the project name.
Precisely: in a lexically scoped language, `D'` can be nested inside `D` iff
every path from a root (an entry point, a declaration with in-degree 0) to
`D'` passes through `D`, i.e. iff `D` *dominates* `D'` in `H`. The dominator
tree of `H` (Lengauer and Tarjan 1979) is therefore the deepest nesting the
program admits, and `H` is a forest exactly when `H` coincides with its own
dominator tree. Every edge of `H` that is not a dominator-tree edge is a
*sharing* edge: its target is used from two places that neither contains
the other, so it has to live at a common ancestor scope. The diagnostics
count these as surplus edges and list their targets as the most shared
declarations.

**Definition 11 (lift).** For an edge `a -> b` of `H`, let `idom(b)` be the
immediate dominator of `b` and `depth` the depth in the dominator tree. Then

```
lift(a -> b) = depth(a) - depth(idom(b))
```

Since `idom(b)` dominates every predecessor of `b`, the lift is always
defined and non-negative, and it is `0` exactly when `a = idom(b)`, i.e.
when the edge is a nesting edge. Otherwise the lift counts the scopes `b`
had to be hoisted out of `a` to stay reachable from its other users: `1`
when two siblings share `b`, and more when the users sit in unrelated
parts of the tree. Sharing between siblings and sharing across the whole
program are both "one extra caller" to a degree count, but they cost very
different amounts of nesting, and the lift is what tells them apart. The
diagnostics average `1 / (1 + lift)` over the edges of `H` (*locality*) and
rank shared declarations by the sum of the lifts of their incoming edges.

Note also that in-degree alone is direction-blind in a subtler way: `A -> S
<- B` has as many edges as a two-node forest has (`n - c` with `c` the
number of *weakly* connected components), so a spanning ratio built on weak
components calls it a tree. Counting roots instead of components — a
directed forest has exactly one incoming edge per non-root — does not.

`G_ctl` is acyclic iff the program's control structure needs no `letrec`
among functions; `G_uses` restricted to definition-time edges is acyclic iff
module initialisation is well-founded (section 4); `type` edges may form
cycles freely (recursive types) and are ignored by both statements.

## 8. Summary of the classification

```
kind(p) =
  type        if p is type-level                                  (section 2)
  call        if F(p) applies p, or applies the projection p.m,
              or p is super(...)                                  (section 3)
  create      if F(p) is new p (...)                              (section 3, 5)
  extends     if F(p) is a class heritage clause (term-level)     (section 5)
  reference   otherwise: p escapes or is merely projected         (section 3)
  write       if p is the target of x = e, x += e (etc.) or
              x++ / x--; edge reversed to D' -> D; compound
              forms also keep the reference edge D -> D'         (section 3.5)

time(p) =
  definition  if no λ separates p from the root of body(D)        (section 4)
  use         otherwise

declares(P.m := e) =
  binding     if definition-time and P is a path of names          (section 4.1)
  late        if use-time and P is a path of names                 (a declaration flagged late)
  store       if P denotes a value: a reference, no declaration
```

Two facts justify the split. Erasure (Fact 1) separates `type` from the
rest with no approximation. Fact 2 and Fact 3 separate `call` from
`reference`: a `call` edge is realised by a `(β)` step inside `D`, a
`reference` edge is a flow whose `(β)` step, if any, is elsewhere and is
found by control-flow analysis.

## References

* D. L. Parnas, *Designing software for ease of extension and contraction*,
  IEEE TSE 1979 (the "uses" hierarchy).
* L. Cardelli, *Phase distinctions in type theory*, 1988; R. Harper,
  J. C. Mitchell, E. Moggi, *Higher-order modules and the phase
  distinction*, POPL 1990.
* J. C. Mitchell, G. D. Plotkin, *Abstract types have existential type*,
  TOPLAS 1988.
* M. Felleisen, R. Hieb, *The revised report on the syntactic theories of
  sequential control and state*, TCS 1992 (evaluation contexts).
* O. Shivers, *Control-flow analysis of higher-order languages*, PhD 1991;
  F. Nielson, H. R. Nielson, C. Hankin, *Principles of Program Analysis*,
  1999, ch. 3.
* Y. G. Park, B. Goldberg, *Escape analysis on lists*, PLDI 1992.
* J. Dean, D. Grove, C. Chambers, *Optimization of object-oriented programs
  using static class hierarchy analysis*, ECOOP 1995; D. Grove,
  C. Chambers, *A framework for call graph construction algorithms*,
  TOPLAS 2001.
* A. Feldthaus, M. Schäfer, M. Sridharan, J. Dolby, F. Tip, *Efficient
  construction of approximate call graphs for JavaScript*, ICSE 2013 (the
  field-based call graph).
* W. R. Cook, *A denotational semantics of inheritance*, PhD 1989;
  W. R. Cook, J. Palsberg, *A denotational semantics of inheritance and its
  correctness*, OOPSLA 1989.
* O. Waddell, D. Sarkar, R. K. Dybvig, *Fixing letrec: a faithful yet
  efficient implementation of Scheme's recursive binding construct*, HOSC
  2005.
* Haskell 2010 Report, §4.5.1 *Dependency analysis*.
* T. Lengauer, R. E. Tarjan, *A fast algorithm for finding dominators in a
  flowgraph*, TOPLAS 1979.
* R. C. Martin, *Granularity* (the acyclic dependencies principle), 1996.
