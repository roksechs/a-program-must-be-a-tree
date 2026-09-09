// The build step's half of "a dataset ships with its layout": loads d3 the
// way the browser does and hands the document to site/js/layout.js, which is
// the same code analyzeWorker.js runs after an in-browser analysis. Nothing
// about the layout is decided here — see site/js/layout.js for why it is
// precomputed at all.
import * as d3 from "d3";

// site/js/simulation.js takes d3 from the global, the way the browser loads
// it from site/vendor. Installed with defineProperty rather than
// `globalThis.d3 = d3`, because an assignment to a member of an undeclared
// global is a *binding* (docs/THEORY.md §4.1): it would declare `globalThis.d3`
// as a node of this project's own graph, which nothing then references by
// name — the analyzer cannot see the free `d3` in a module that reads it off
// the global — and test/dead-code.test.mjs would rightly call it unused.
Object.defineProperty(globalThis, "d3", { value: d3, configurable: true });

// A namespace rather than a destructured binding, for the reason
// analyzeWorker.js gives at its own import of this module.
const layout = await import("../site/js/layout.js");

/** Settle `doc` in place; returns `{ ticks, reason, nodes }`. */
export function settle(doc) {
  return layout.layOutDocument(doc);
}
