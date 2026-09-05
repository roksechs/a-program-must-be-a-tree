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
  assert.equal(edge("src/util.js::Box.make", "src/util.js::Box.constructor").kind, "create");
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
  assert.equal(edge("a.ts::make", "a.ts::Derived.constructor").kind, "create");
  assert.equal(edge("a.ts::make", "a.ts::NoCtor").kind, "create");
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

test("constructor lookup follows the inheritance chain", () => {
  const root = fixture({
    "c.ts": `
      export class Base { constructor(public n: number) {} }
      export class Mid extends Base {}
      export class Leaf extends Mid {}
      export function make() { return new Leaf(1); }
    `,
  });
  const doc = analyze({ name: "ts", root });
  const edge = (s, t) => doc.edges.find((e) => e.source === s && e.target === t);
  assert.equal(edge("c.ts::make", "c.ts::Base.constructor").kind, "create");
  assert.equal(edge("c.ts::make", "c.ts::Leaf"), undefined);
});

test("method calls are dispatched to overriding implementations (CHA)", () => {
  const root = fixture({
    "d.ts": `
      export interface Shape { area(): number; }
      export class Base implements Shape { area() { return 0; } static make() { return new Base(); } }
      export class Square extends Base { area() { return 4; } }
      export class Circle extends Base { area() { return 3; } }
      export function total(shapes: Base[]) { return shapes.reduce((s, x) => s + x.area(), 0); }
      export function viaInterface(s: Shape) { return s.area(); }
      export function direct() { return Base.make(); }
    `,
  });
  const doc = analyze({ name: "ts", root });
  const edge = (s, t) => doc.edges.find((e) => e.source === s && e.target === t);
  // Static type Base: the declared member plus every override.
  assert.equal(edge("d.ts::total", "d.ts::Base.area").kind, "call");
  assert.equal(edge("d.ts::total", "d.ts::Base.area").inferred, undefined);
  assert.equal(edge("d.ts::total", "d.ts::Square.area").kind, "call");
  assert.equal(edge("d.ts::total", "d.ts::Square.area").inferred, true);
  assert.equal(edge("d.ts::total", "d.ts::Circle.area").kind, "call");
  // Through an interface: type edge to the interface, calls to the implementations.
  assert.equal(edge("d.ts::viaInterface", "d.ts::Shape").kind, "type");
  assert.equal(edge("d.ts::viaInterface", "d.ts::Base.area").kind, "call");
  assert.equal(edge("d.ts::viaInterface", "d.ts::Square.area").kind, "call");
  // Static members never dispatch.
  assert.equal(edge("d.ts::direct", "d.ts::Base.make").kind, "call");
  assert.equal(edge("d.ts::direct", "d.ts::Base").kind, "reference"); // the receiver of a static call
  assert.equal(doc.edges.filter((e) => e.source === "d.ts::direct").length, 2);
  // A parameter that is called is not a self call.
  assert.equal(edge("d.ts::Base.make", "d.ts::Base.make"), undefined);
  // Structural member-level edges.
  assert.equal(edge("d.ts::Square.area", "d.ts::Base.area").kind, "override");
  assert.equal(edge("d.ts::Square.area", "d.ts::Base.area").time, "definition");
  assert.equal(edge("d.ts::Base", "d.ts::Shape").kind, "implements");
  assert.equal(edge("d.ts::Square", "d.ts::Base").kind, "extends");
});

test("edges record definition-time versus use-time", () => {
  const root = fixture({
    "e.js": `
      export function helper() { return 1; }
      export const eager = helper();
      export const lazy = () => helper();
      export class Base {}
      export class Derived extends Base {
        static registry = helper();
        field = helper();
        method() { return helper(); }
      }
    `,
  });
  const doc = analyze({ name: "js", root });
  const edge = (s, t) => doc.edges.find((e) => e.source === s && e.target === t);
  assert.equal(edge("e.js::eager", "e.js::helper").time, "definition");
  assert.equal(edge("e.js::lazy", "e.js::helper").time, "use");
  assert.equal(edge("e.js::Derived", "e.js::Base").time, "definition");
  assert.equal(edge("e.js::Derived.method", "e.js::helper").time, "use");
  // A static initializer runs when the class statement runs; an instance field runs per construction.
  const derivedToHelper = doc.edges.filter((e) => e.source === "e.js::Derived" && e.target === "e.js::helper");
  assert.deepEqual(derivedToHelper.map((e) => e.time).sort(), ["definition", "use"]);
});

test("flow analysis lifts callbacks into calls at the place they are invoked", () => {
  const root = fixture({
    "f.js": `
      export function helper(x) { return x + 1; }
      export function other(x) { return x - 1; }
      export function apply(cb, x) { return cb(x); }
      export function main() { return apply(helper, 1) + apply(other, 2); }
      export function alias() { const h = helper; return h(3); }
      export function pick() { return helper; }
      export function usePick() { return pick()(4); }
      export function external(list) { return list.map(helper); }
      export class Runner { run(cb) { return cb(); } }
      export function viaMethod() { return new Runner().run(other); }
    `,
  });
  const doc = analyze({ name: "js", root });
  const edge = (s, t) => doc.edges.find((e) => e.source === s && e.target === t);
  // main only passes helper/other along: references from main, calls from apply.
  assert.equal(edge("f.js::main", "f.js::apply").kind, "call");
  assert.equal(edge("f.js::main", "f.js::helper").kind, "reference");
  assert.equal(doc.edges.some((e) => e.source === "f.js::main" && e.target === "f.js::helper" && e.kind === "call"), false);
  assert.equal(edge("f.js::apply", "f.js::helper").kind, "call");
  assert.equal(edge("f.js::apply", "f.js::helper").inferred, true);
  assert.equal(edge("f.js::apply", "f.js::other").kind, "call");
  // Local alias and returned function.
  assert.equal(doc.edges.some((e) => e.source === "f.js::alias" && e.target === "f.js::helper" && e.kind === "call"), true);
  assert.equal(doc.edges.some((e) => e.source === "f.js::usePick" && e.target === "f.js::helper" && e.kind === "call"), true);
  assert.equal(edge("f.js::usePick", "f.js::pick").kind, "call");
  // A callback handed to an external function stays a reference.
  assert.deepEqual(doc.edges.filter((e) => e.source === "f.js::external").map((e) => e.kind), ["reference"]);
  // Parameters of methods receive flows too.
  assert.equal(edge("f.js::Runner.run", "f.js::other").kind, "call");
  assert.equal(edge("f.js::viaMethod", "f.js::Runner.run").kind, "call");
  assert.equal(edge("f.js::viaMethod", "f.js::Runner").kind, "create");
});
