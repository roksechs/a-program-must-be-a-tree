// Edge kind vocabulary (docs/THEORY.md). Kept free of d3 so the model and the
// unit tests can import it under node.

export const EDGE_KINDS = ["call", "create", "reference", "write", "type", "extends", "implements", "override"];

/** Kinds excluded from the initial default. Empty: every kind starts enabled,
 * including `type` and `write` (the latter's direction is reversed, THEORY.md
 * §7) — each is still its own toggle, so a graph whose dominator tree the
 * reversed edge would confuse can turn it back off. */
export const DEFAULT_OFF_KINDS = new Set();

/** Edge kinds that transfer control at run time (docs/THEORY.md §7: the control graph). */
export const CONTROL_KINDS = new Set(["call", "create"]);
