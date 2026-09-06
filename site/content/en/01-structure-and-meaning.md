# Structure and meaning

<!-- graph: d3-force; view: 2d; labels: all; zones: 1 -->

This article uses one distinction over and over. It is rarely made explicit, and I mixed the two sides up for a long time myself.

| | Structure | Meaning |
|---|---|---|
| The question | Who calls whom. Where a thing is placed | What it does. Whether it is correct. Whether two things are the same |
| Computable? | **Yes.** Fixed by syntax and type resolution | **In general, no** (Rice's theorem) |
| Who decides | The machine | A person |

## The test

Telling them apart is easy.

> **Rename every identifier to `a1, a2, a3, …`. If the answer does not change, it was a question about structure. If it does, it was a question about meaning.**

Try it on the graph to the right. Press "Rename every identifier to nonsense" and every name disappears. The numbers under the graph **do not move**: not the tree score, not the locality, not the number of cycles. They were never computed from the names.

Conversely, "is this the right abstraction?" and "do these two functions represent the same knowledge?" become unanswerable the moment the names are gone. Those are questions about meaning.

## Why they get mixed

Because the everyday vocabulary is mixed. In one review we say:

- "This function is long" — structure; lines can be counted.
- "This function does too many things" — meaning; you cannot count "things" without knowing how to cut them.
- "This should be extracted" — extracting is structure; what to extract is meaning.

We move back and forth within one conversation, so nobody notices which kind of claim they are making. Often that is harmless. It stops being harmless when **a structural question is answered with meaning**.

## Two errors

**Answering a structural question with meaning.** Ask an engineer "where should this function go?" and they reach for a semantic classification: it is a utility, so `utils/`; it is about users, so `user/`. But "where should it go" is a structural question, and its answer is fixed by the call graph: directly above everyone who calls it. Classification by meaning (folders by topic) and placement by structure disagree all the time, and when they disagree, in practice meaning wins. `utils/` is the place where a structural question was answered with meaning.

**Answering a semantic question with structure.** Two functions have the same shape: "duplication, merge them." Whether they represent the same knowledge is a question about meaning, and the shape does not settle it. Merge two things that merely happened to look alike and you have invented a coupling that did not exist.

The errors run both ways, so the lesson is not "think structurally." It is only this: **know which kind of question you are answering.**

## This tool stands on the distinction

The kinds this site's viewer puts on its edges, `call`, `create`, `reference`, `type`, are derived without reading what any code means. The [theory](https://github.com/roksechs/a-program-must-be-a-tree/blob/main/docs/THEORY.md) decides a kind from whether an occurrence sits in a type position or a term position (its phase) and from how the surrounding evaluation context consumes the value (applies it, constructs with it, or lets it escape). It never reads a name.

And the definition of the `type` edge, "a dependency on the specification, not on the witness", is the type system seen as **a device for freezing meaning into structure**. An interface is a person's intent written down in a form a machine can check. One could say that good design is the work of pushing meaning into structure. This tool only shows you the structure your meaning actually produced.
