// Stores: the receiver is a value, so no static name reaches the function.
// Nothing is declared; the closure's body belongs to the enclosing declaration
// (`setup`, or the module for the top-level store) and whoever calls the
// closure is found by following values, never by name.
import { save } from "./util.js";

export function setup(el) {
  el.onclick = function () {
    save();
  };
}

// Even at load time: `list[0]` is an element, not a name.
const list = build();
list[0].f = function () {
  save();
};

function build() {
  return [{}];
}
