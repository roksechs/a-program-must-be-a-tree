# Two programs with zero duplication

<!-- graph: sample-tree; view: 3d; labels: none; pitch: 0.45 -->
<!-- graph: sample-tangle; view: 3d; labels: none; pitch: 0.45 -->

On the right are two programs. Each has a few dozen declarations, and in each the duplication is **zero**: there is no place where the same knowledge is written twice. Graded by DRY, both get full marks.

Yet one is a tree and the other is a tangle.

In the upper graph every declaration has exactly one caller. Start from `main` at the top and each declaration sits at the end of one branch, invisible from every other branch. To understand a declaration you read what is below it, and nothing else. If you change it, the only thing to check is the single path back to the root.

In the lower graph some declarations are called from places that have nothing to do with each other. There are shared helpers, and there are cycles. To understand a declaration you have to know everyone who calls it; if you change it, all of them can break.

Look at two numbers. **Tree score** is 1.000 above and far lower below. **Locality** says how far the sharing reaches.

## The vocabulary we have cannot name the difference

DRY says: do not write a piece of knowledge twice. Both programs obey. "Don't reinvent the wheel" is obeyed. So is SSOT. And still, one can be maintained and the other cannot.

The design vocabulary we use every day says **reuse**, and says nothing about **where the reused thing should live**. The claim of this article is that the second question decides legibility, and that it is computable. When a function is used from two places, the place it belongs is determined exactly by the call graph: not by judgement, not by team convention, by calculation.

Programmers, and coding agents, do not run that calculation. They place things by the file in front of them and the habits at hand. Each choice is reasonable on its own. Their sum is the lower graph.

## Where this goes

Part I separates two words, **structure** and **meaning**. The distinction is the spine of the whole piece; everything after it can be written in those two words.

Part II re-reads the familiar principles, DRY, SSOT, SRP, cohesion and coupling, DIP, Clean Architecture, one at a time and from their primary sources. Each has a structural half and a semantic half, and the structural half is one a machine can answer. We will see that all of them land on the same handful of quantities.

Part III asks why codebases tangle anyway, as a story about local and global: there is a class of defect that does not appear in a diff, so review cannot catch it in principle.

At the end, we name the tool that does not exist yet.

The graphs can be handled. Drag to orbit; click a declaration to see where it could live. Every number on this page is computed by the same code as this site's viewer, on the same data.
