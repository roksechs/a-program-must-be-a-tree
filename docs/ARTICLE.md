# Article plan: reading the principles you already believe

Plan for an interactive, long-form page under `site/` that explains the ideas
behind this tool by re-reading familiar design principles (DRY, SSOT, SRP,
cohesion, Clean Architecture, ...) precisely enough to turn them into
measurements. Every chapter pairs prose with a live graph driven by the same
modules as the viewer (`model.js`, `metrics.js`, `dominance.js`), so the
numbers on the page are the real implementation's output.

Working title: *A program must be a tree* (the project name), subtitle
*reading DRY, SRP and Clean Architecture precisely enough to make them tools*.

## Thesis

Reuse is necessary. The problem is that the common vocabulary treats reuse as
an unconditional good ("don't reinvent the wheel") and says nothing about
*where* the reused thing should live. That second question decides whether a
codebase stays legible, and it is a computable question: the dominator tree of
the call graph answers it exactly. Programmers and coding agents answer it
from local context and personal habit instead, review cannot catch the
resulting errors because they are invisible in a diff, and the accumulation
of locally reasonable choices is how a codebase turns into Howl's Moving
Castle.

"A program must be a tree" is the origin of the measurement, not the goal. A
tree is the program in which every declaration could be a local definition of
its only user; the distance from a tree is the amount of the program that has
to be public.

## Spine: structure and meaning

Every claim on the page is labelled as one of:

* **structure** — a question the machine answers exactly (who calls whom,
  where a declaration could live, what is on a cycle, what a change reaches).
  Test: rename every identifier to `a1, a2, ...`; the answer does not change.
* **meaning** — a question only a person can answer (what the code does,
  whether two functions represent the same knowledge, what "the domain" is).
  Test: the renaming makes the question unanswerable.

Two symmetric errors recur through the page: answering a structural question
with meaning (`utils/` is where "where should this live?" was answered by
topic instead of by callers) and answering a semantic question with structure
(merging two functions because they have the same shape).

## Evidence tiers

Each factual claim is also marked by how it is known:

1. **theorem** — graph theory already derived in `THEORY.md`
   (dominator tree = deepest admissible nesting, forest iff in-degree ≤ 1).
2. **measurement** — computed on named datasets, stated with `n` and the
   dataset, never generalised beyond them.
3. **borrowed heuristic** — working-memory limits (Miller 1956, Cowan 2001)
   and the like; used to motivate, never as proof.

## Chapters

Every chapter in Part II follows one template: folk version → primary source
→ structural half / semantic half → small code beside its live graph → the
trace the misuse leaves in the graph.

### Part 0 — Hook

**0. Two programs with zero duplication.** Same node count, both perfectly
DRY, one a tree and one a tangle (`sample-tree.json`, `sample-tangle.json`).
The existing vocabulary cannot tell them apart. Toggle 3D.

### Part I — Structure and meaning

**1. The distinction.** The table above, both error directions, and the
rename-everything button: identifiers vanish, no number on the panel moves.
This repository is itself an example: `THEORY.md` derives the edge kinds
from syntactic phase and evaluation context without reading what any code
means, and its `type` edge (a dependency on the specification, not the
witness) is meaning frozen into structure.

**2. The model, briefly.** Declaration = node, free occurrence = edge, kind
from phase and consumer frame; the control, uses and full graphs; call
height. Tiny code snippet beside a live graph. Links to `THEORY.md` for the
derivation.

**2b. What counts as a declaration: `ns.f = function` versus
`el.onclick = function`.** The two statements have the same shape, and the
words we reach for to separate them ("namespace", "instance", "callback")
are meaning, not structure. The structural facts are two:

* **When does the assignment run?** At module load, once, unconditionally
  (definition-time, §4 of `THEORY.md`: part of the module's `letrec`), or
  during execution, as a consequence of some call, possibly many times or
  never (use-time)?
* **Can other code name the target?** Is the receiver a pure path of names
  rooted in a module-level binding (`d3.scale`, `Moment.prototype`,
  `exports`), so that a call site elsewhere can write `d3.scale.linear(...)`
  and mean exactly this function? Or is it a runtime value — a parameter, a
  local, an element, a call result — that no static name reaches, so the
  function can only be found by following the flow of values?

A node in the graph is something an occurrence can target, and Definition 1
requires a *name*. So: definition-time + nameable is a declaration (`ns.f`,
`X.prototype.m`, `exports.f`; the ES5 spelling of `export` and of a class
method). A runtime-valued receiver is a store: the closure escapes into a
slot, the enclosing declaration gets a `reference` edge, and calls to it are
found by flow analysis, never by name (`el.onclick`). The gray zone is a
nameable slot written at use-time (`app.handler = function` inside
`init()`): a *late binding*, nameable but existing only after `init` runs.
It is recorded as a declaration with a `reference` edge from its installer
and flagged, because it is the initialisation hazard of §4 in another
costume. Which cell a statement falls in survives renaming every identifier;
"namespace" is the name we give to an object whose properties are only ever
written at definition time.

This is also the class/object question of §5 in operational form: what is
put on the prototype (or class, or namespace) is declared once at load; what
is put on the instance (`this.cb = function` in a constructor, one closure
per `new`) is stored at construction.

### Part II — Reading the familiar principles precisely

**3. DRY and "don't reinvent the wheel".** Hunt & Thomas: every piece of
*knowledge* has one authoritative representation *within a system*. Knowledge,
not code; the authors themselves say identical code for different knowledge is
not a violation. Reinventing a wheel is the act whose result is a DRY
violation, so the two are one row — except at the system boundary: a
self-implementation instead of an external library is not a DRY matter at all
(the codebase still has one representation), and that is where the slogan is
usually deployed. Structural half: clone detection (to be added). Semantic
half: whether it is the same knowledge. Critique: one home, silent about where
the home is. Trace: a coincidental merge shows up as one node called from
unrelated places, i.e. high lift.

**4. SSOT.** One node for a piece of knowledge. Structure: in-degree; the
count is fixed, the position is not. Two SSOT-compliant programs, one with the
source at its `idom`, one with it at the far end.

**5. Colocation → `idom`.** The bridge from folk knowledge to the theorem.
"Put it near where it is used" is exactly `idom` for one caller; for two
callers the folk rule falls silent and `idom` still answers. This is the
*natural scope* the selection panel already shows. Interactive: an
"inline into caller" button that is disabled for a shared node, with the
reason.

**6. Rule of Three → lift.** Duplication keeps the tree (two nodes of
in-degree 1); sharing creates a node of in-degree 2 and therefore lift ≥ 1.
The rule silently prices a little duplication below a little sharing; lift
makes the price explicit and replaces the count with a distance: share
between siblings (lift 1), stay duplicated across the codebase (high lift).

**7. SRP → lift × subtree.** Martin: one reason to change, later one actor.
A node called from `k` unrelated dominator subtrees *and* carrying its own
dependencies is coupled to `k` actors. Pure leaves (`max`) are exempt because
nothing gives them a reason to change. Metric to add: sum of lifts weighted by
subtree size.

**8. Cohesion and coupling.** Constantine & Yourdon, older than SOLID.
Cohesion's upper levels are semantic, but it has a structural shadow: a
container is cohesive when its members form a dominator subtree — their
`idom`s are inside it. A file whose members' `idom`s are scattered is a
semantic grouping without structural basis; that is coincidental cohesion,
and `utils/` is its usual name. Metric to add: fraction of members whose
`idom` lies in the same container (precedent: LCOM, Chidamber & Kemerer 1994).
Coupling counts edges across a boundary and is therefore always relative to a
boundary a person drew; lift needs no boundary. Interactive: the depth slider
against the dominator tree.

**9. DIP → `type` edges.** Depend on the specification, not the witness
(`THEORY.md` §2). Toggling `type` off removes every dependency on an
interface and leaves the concrete coupling.

**10. Clean / Onion / DDD → the 3D view.**

* The centre is chosen semantically, from the business's point of view:
  the knowledge it wants to protect. "Detail" is what it is willing to
  replace. Structure knows neither: it has a root (the boot function, or the
  virtual root standing for the outside world that invokes the entry points)
  and several families of sinks.
* The onion is a one-dimensional radial projection. Its rim holds both the
  root (`main`, UI) and the *other* leaves (adapters, drivers): "far from the
  domain" and "close to the outside world" are different quantities drawn at
  one radius. "Frameworks & Drivers" names two structurally opposite
  positions — the framework that calls you (above the root) and the library
  you call (a leaf).
* Infrastructure is not "outside"; it is another floor. A caller of
  `db.query()` depends on the meaning of `query` exactly as deeply as a
  caller of `Order.total()` depends on `total`. Only the vector differs.
* The rule is checkable once the centre is labelled: the labelled set must be
  closed downwards (no edge leaves it), so its sinks sit at height 0 and the
  domain's own internal tree has DDD's aggregate roots at its top. Height 0
  is necessary, not sufficient: adapters that call only external code share
  the floor. A violation is a specific edge.
* Source versus runtime. The dependency rule is about source dependencies:
  judge it with `type` and `implements` on and *inferred* dispatch edges off.
  Turn inferred edges on and the use case reaches the adapter it actually
  bottoms out in. DIP is the difference between the two pictures.
* The 3D view keeps the axis the onion kept (height, i.e. direction) and
  restores the one it threw away: sink families separate in x/y because the
  physics only attracts what is connected. Two floors, side by side.
* Fair note: Clean Architecture is a prescription (a replaceability goal plus
  DIP as mechanism), not a description. The comparison is about the picture.
* Interactive: a small Clean-Architecture sample app (entities, use cases,
  ports, adapters, main) in three pictures — the onion, the 3D view, the
  dominator tree — with a domain label and the inferred-edge switch.

**11. What the tool cannot see.** Separation of concerns, Liskov
substitution, naming, "screaming" (topic-based) folder structure, whether an
abstraction is the right one. These are meaning and remain a person's work.

### Part III — The reveal

**12. Nine names for the same few quantities.** Reading the "structural half"
column downwards, everything lands on `idom` (position), lift (distance),
SCC (indivisibility), reachability (impact) and call height (direction). The
reader already believed in the dominator tree.

### Part IV — Why it becomes a castle anyway

**13. The four costs, measured.** Understanding a declaration costs its
descendants; changing it costs its ancestors (a tree: `log n`; a hub: `O(n)`);
a cycle makes its whole SCC the unit of understanding (against a working
memory of about four items); sharing costs its lift. Distributions from `self`
and the d3 packages, each labelled by tier.

**14. Local view, global property.** People and agents write from the file,
the prompt and their habits; lift, `idom` and SCC membership are defined only
on the whole graph. Locally reasonable choices raise lift systematically.
This is an information asymmetry, not a competence problem.

**15. Lift is invisible in a diff.** A diff is local; lift is global. Review
is `O(diff)`, the damage is `O(graph)`, so review cannot catch this in
principle. Agents did not dig the hole; their volume exposed it.

**16. What is mechanical.** Placement: exact. Cost ranking: exact.
Indivisible groups: exact. Impact radius: exact. Duplicate detection:
structural clones yes, semantic equivalence no (Rice). Recap of the chapter-1
table with a "machine / person" column.

**17. How the castle is built.** (A) A growth simulation with its rules on
screen — declarations added by locally reasonable placement versus by `idom`
— labelled as illustration. (B) Measured history: a castle (moment.js, whose
maintainers call its architecture legacy), a deliberate de-castling (d3 v3 →
v4, the monolith split into modules), and a control (this repository).
Caveats stated: the analyzer on old JavaScript, sampling by release tag, size
normalisation, survivorship.

### Part V — What should exist

**18. Ask `idom` before writing.** A CI gate, a lint ("this import has lift
7"), a tool an agent can call, and semantic labels as the input a person
supplies so the machine can check that the structure serves them. Then:
measure your own repository today — the viewer, and the order of work (edges
with the largest lift, cycles, shared leaves pushed down).

## Production decisions

* **Prose is content, not UI.** Paragraphs live in per-language documents
  (`site/content/article.en.json`, `article.ja.json`), loaded as data; UI
  labels go through `t()` as everywhere else. A unit test checks that both
  documents carry the same section ids, keeping the spirit of the i18n rule.
* **Real numbers only.** Every live graph imports the viewer's own modules;
  no re-implementation of a metric for the page.
* **Datasets to add**: the Clean-Architecture sample app; historical
  snapshots for chapter 17 (needs a `--git` mode in the analyzer).
* **Viewer additions the article requires**: clone detection (ch. 3),
  lift × subtree (ch. 7), structural cohesion per container (ch. 8), semantic
  node labels (ch. 10), a switch for inferred versus syntactic edges (ch. 10).
* **Primary sources to verify before writing**: Hunt & Thomas on DRY; Martin
  on SRP (reason to change, actor) and on the dependency rule; Constantine &
  Yourdon on cohesion and coupling; Fowler (attributing Roberts) on the Rule
  of Three; Chidamber & Kemerer on LCOM; Miller and Cowan on working memory.

## Feasibility of chapter 17 (B): first measurements

The analyzer was run on release tags of moment and d3 (about one second per
tag, so sampling every release is cheap). Control graph = `call` + `create`;
uses graph adds `reference` and `extends`.

| repository | tag | files | declarations | control tree score | control locality | uses tree score | uses locality | surplus edges |
|---|---|---|---|---|---|---|---|---|
| moment | 2.0.0 – 2.9.0 | 1 | 1 | — | — | — | — | — |
| moment | 2.10.6 | 85 | 308 | 0.313 | 0.556 | 0.463 | 0.634 | 215 |
| moment | 2.20.0 | 102 | 381 | 0.286 | 0.550 | 0.441 | 0.613 | 299 |
| moment | 2.29.0 | 107 | 415 | 0.279 | 0.545 | 0.429 | 0.605 | 338 |
| d3 | v3.0.0 | 204 | 609 | 0.507 | 0.650 | 0.450 | 0.644 | 203 |
| d3 | v3.5.17 | 274 | 758 | 0.556 | 0.694 | 0.498 | 0.710 | 183 |

Findings:

* **moment from 2.10 on is usable as the "castle" series** (2015–2020, ES
  module sources under `src/lib`). Every ratio declines monotonically while
  surplus edges grow faster than the declaration count (0.70, 0.78, 0.81
  surplus per declaration). The decline is modest; the article must say so.
* **The moment numbers are contaminated by the same gap.** Of the 143
  functions with no caller in the control graph at 2.29.0, 103 are API
  methods attached by assignment (`proto.add = add` in
  `src/lib/moment/prototype.js`) and called only through dispatch the
  analyzer does not see. Until property-assigned functions are modelled, the
  series above understates connectivity and its decline is not to be quoted.
* **moment before 2.10 is invisible**: the whole library is one IIFE in one
  file, so the analyzer sees one `module` node and no edges. Measuring that
  era needs nested declarations as nodes (an existing roadmap item).
* **d3 v3 parses but is not yet comparable to v4.** Its public API is written
  as property assignments (`d3.scale.linear = function () {...}`), which are
  module-level code rather than declarations, so 176 of 609 nodes are
  `module` nodes and the public surface is not in the graph. Comparing the
  v3 monolith with the v4 packages (all ES module exports) requires the
  analyzer to model property-assigned function expressions as declarations;
  otherwise the two eras are measured with different rulers. The v4 side
  also needs a union analysis across the split `d3-*` repositories.

Analyzer additions this implies: nested declarations as nodes (behind a
flag), and property-assigned functions as declarations under the rule of
chapter 2b — a definition-time assignment through a pure name path is a
binding (`ns.f = function`: a static member; `X.prototype.m = function`: an
instance member; `proto.m = m`: an alias, no new node, `m` gains the member
role), a use-time assignment through a name path is a flagged late binding,
and an assignment to a runtime value is a store. Call sites the checker
cannot type are resolved by literal name path, as ordinary `call` edges.

## Open questions

* Page location and name under `site/`.
* Whether the d3 comparison is worth the two analyzer additions above, or
  whether another documented restructuring (one that stayed in one
  repository and one module style) makes a cleaner chapter 17 (B).
