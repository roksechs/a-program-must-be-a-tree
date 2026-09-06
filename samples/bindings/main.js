// The entry point: reaches every pattern so their call heights are visible.
import { Moment } from "./prototype.js";
import { init, route } from "./late.js";
import { setup } from "./store.js";

export function main() {
  const m = Moment.utc();
  m.isValid();
  init();
  route();
  setup(globalThis.document);
  return chart.scale.linear();
}
