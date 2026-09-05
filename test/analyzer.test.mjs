import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { analyze } from "../analyzers/ts/analyze.mjs";

function fixture(files) {
  const dir = mkdtempSync(join(tmpdir(), "apmbat-"));
  for (const [name, content] of Object.entries(files)) {
    mkdirSync(join(dir, name, ".."), { recursive: true });
    writeFileSync(join(dir, name), content);
  }
  return dir;
}

test("analyzer finds declarations and cross-file calls", () => {
  const root = fixture({
    "src/util.js": `
      export function helper(x) { return x + 1; }
      export const twice = (x) => helper(helper(x));
      export class Box {
        constructor(v) { this.v = v; }
        get() { return helper(this.v); }
        static make(v) { return new Box(v); }
      }
      export default function () { return twice(1); }
    `,
    "src/main.js": `
      import { helper, twice, Box } from "./util.js";
      import fallback from "./util.js";
      export function main() {
        const b = Box.make(twice(2));
        return [b.get(), fallback(), helper];
      }
      function recurse(n) { return n > 0 ? recurse(n - 1) : 0; }
      export { recurse };
    `,
  });
  const doc = analyze({ name: "fixture", root, include: ["src"] });
  const ids = doc.declarations.map((d) => d.id);
  assert.deepEqual(
    ids,
    [
      "src/main.js::main",
      "src/main.js::recurse",
      "src/util.js::Box",
      "src/util.js::Box.constructor",
      "src/util.js::Box.get",
      "src/util.js::Box.make",
      "src/util.js::default",
      "src/util.js::helper",
      "src/util.js::twice",
    ],
  );
  const byId = Object.fromEntries(doc.declarations.map((d) => [d.id, d]));
  assert.equal(byId["src/util.js::Box.get"].parent, "src/util.js::Box");
  assert.equal(byId["src/util.js::Box.get"].kind, "method");
  assert.equal(byId["src/util.js::twice"].kind, "function");
  assert.equal(byId["src/util.js::default"].name, "util");
  assert.equal(byId["src/util.js::helper"].exported, true);
  assert.equal(byId["src/main.js::recurse"].exported, false);

  const edge = (s, t) => doc.edges.find((e) => e.source === s && e.target === t);
  assert.equal(edge("src/main.js::main", "src/util.js::Box.make").kind, "call");
  assert.equal(edge("src/main.js::main", "src/util.js::twice").kind, "call");
  assert.equal(edge("src/main.js::main", "src/util.js::Box.get").kind, "call");
  assert.equal(edge("src/main.js::main", "src/util.js::default").kind, "call");
  assert.equal(edge("src/main.js::main", "src/util.js::helper").kind, "reference");
  assert.equal(edge("src/main.js::recurse", "src/main.js::recurse").kind, "call");
  assert.equal(edge("src/util.js::twice", "src/util.js::helper").count, 2);
  // `new Box(v)` is a call of the constructor, not a reference to the class itself.
  assert.equal(edge("src/util.js::Box.make", "src/util.js::Box.constructor").kind, "call");
  assert.equal(edge("src/util.js::Box.make", "src/util.js::Box"), undefined);
  assert.equal(edge("src/util.js::default", "src/util.js::twice").kind, "call");
  // Locals never produce edges.
  assert.equal(doc.edges.some((e) => e.target.endsWith("::b")), false);
});

test("analyzer records heritage and type references in TypeScript", () => {
  const root = fixture({
    "a.ts": `
      export interface Shape { area(): number; }
      export type Pair = [Shape, Shape];
      export class Base { hello() { return 1; } }
      export class Derived extends Base implements Shape {
        constructor() { super(); }
        area(): number { return this.hello(); }
        pair(): Pair { return [this, this]; }
      }
      export class NoCtor {}
      export function make() { return [new Derived(), new NoCtor()]; }
    `,
  });
  const doc = analyze({ name: "ts", root });
  const edge = (s, t) => doc.edges.find((e) => e.source === s && e.target === t);
  assert.equal(edge("a.ts::Derived", "a.ts::Base").kind, "extends");
  assert.equal(edge("a.ts::Derived", "a.ts::Shape").kind, "implements");
  assert.equal(edge("a.ts::Derived.area", "a.ts::Base.hello").kind, "call");
  assert.equal(edge("a.ts::Derived.pair", "a.ts::Pair").kind, "type");
  assert.equal(edge("a.ts::Pair", "a.ts::Shape").kind, "type");
  // super() calls the base constructor; Base has none, so the class itself is the target.
  assert.equal(edge("a.ts::Derived.constructor", "a.ts::Base").kind, "call");
  assert.equal(edge("a.ts::make", "a.ts::Derived.constructor").kind, "call");
  assert.equal(edge("a.ts::make", "a.ts::NoCtor").kind, "call");
});

test("super() resolves to a declared base constructor", () => {
  const root = fixture({
    "b.ts": `
      export class Base { constructor(public n: number) {} }
      export class Child extends Base { constructor() { super(1); } }
    `,
  });
  const doc = analyze({ name: "ts", root });
  const edge = (s, t) => doc.edges.find((e) => e.source === s && e.target === t);
  assert.equal(edge("b.ts::Child.constructor", "b.ts::Base.constructor").kind, "call");
  assert.equal(edge("b.ts::Child", "b.ts::Base").kind, "extends");
});
