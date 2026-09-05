// Edge kind vocabulary (docs/THEORY.md). Kept free of d3 so the model and the
// unit tests can import it under node.

export const EDGE_KINDS = ["call", "create", "reference", "type", "extends", "implements", "override"];

/** Edge kinds that transfer control at run time (docs/THEORY.md §7: the control graph). */
export const CONTROL_KINDS = new Set(["call", "create"]);
