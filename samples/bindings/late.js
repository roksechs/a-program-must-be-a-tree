// A late binding: the slot `app.handler` is nameable (`app` is a module-level
// binding), but it exists only once `init` has run. `route` can name it, and
// fails if it runs first.
import { tick } from "./util.js";

export const app = { name: "app" };

export function init() {
  app.handler = function () {
    tick();
  };
}

export function route() {
  return app.handler();
}
