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
declaration that contains the operator position. Property stores, anonymous
functions and external callees are not modelled, so a callback handed to a
library function keeps its `reference` edge and nothing else: the analysis
is sound for what it claims and silent otherwise.

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
| `x: T`, `<T>x`, `x as T`, `Array<T>`       | type position                   | `type`      | `T`                                     |
| `class C extends B`                        | `extends B`                     | `extends`   | `B`                                     |
| `class C implements I`, `interface I extends J` | type position              | `type` (`implements`) | `I`, `J`                      |
| `import { f } from "m"`                    | alias, no occurrence            | none        | (resolved through the alias)            |
| `import type { T } from "m"`               | alias, no occurrence            | none        |                                         |
| `typeof f` in a type                       | type position                   | `type`      | `f`                                     |

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

time(p) =
  definition  if no λ separates p from the root of body(D)        (section 4)
  use         otherwise
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
