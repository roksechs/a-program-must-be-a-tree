// Edge kind vocabulary (docs/THEORY.md). Kept free of d3 so the model and the
// unit tests can import it under node.

export const EDGE_KINDS = ["call", "create", "reference", "write", "type", "extends", "implements", "override"];

/** Off by default: direction reversed (variable to writer), would corrupt the
 * control/uses dominator tree if mixed in unconditionally (THEORY.md §7). */
export const DEFAULT_OFF_KINDS = new Set(["type", "write"]);

/** Edge kinds that transfer control at run time (docs/THEORY.md §7: the control graph). */
export const CONTROL_KINDS = new Set(["call", "create"]);
