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
  // `new Box(v)` reads the binding `Box` and runs the constructor it finds.
  assert.equal(edge("src/util.js::Box.make", "src/util.js::Box.constructor").kind, "create");
  assert.equal(edge("src/util.js::Box.make", "src/util.js::Box").kind, "reference");
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
  // The constructor that runs belongs to Base, but the binding that is read is Leaf.
  assert.equal(edge("c.ts::make", "c.ts::Leaf").kind, "reference");
  assert.equal(edge("c.ts::make", "c.ts::Mid"), undefined);
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

test("top-level statements belong to a module node", () => {
  const root = fixture({
    "m.js": `
      export function select() {}
      export function each() {}
      export function Selection() {}
      Selection.prototype = { select, each };
      export function start() {}
      start();
    `,
    "n.js": `
      export function pure() {}
    `,
  });
  const doc = analyze({ name: "js", root });
  const byId = Object.fromEntries(doc.declarations.map((d) => [d.id, d]));
  assert.equal(byId["m.js::<module>"].kind, "module");
  assert.equal(byId["m.js::<module>"].name, "m");
  // `Selection.prototype = { select, each }` is a definition-time binding, so it
  // declares (see the next test); only `start()` is left as module code.
  assert.equal(byId["m.js::<module>"].line, 7);
  assert.equal(byId["n.js::<module>"], undefined); // nothing but declarations: no module node
  const edge = (s, t) => doc.edges.find((e) => e.source === s && e.target === t);
  assert.equal(byId["m.js::select"].parent, "m.js::Selection");
  assert.deepEqual(byId["m.js::each"].aliases, ["Selection.each"]);
  assert.equal(edge("m.js::<module>", "m.js::select"), undefined); // an alias is not an occurrence
  assert.equal(edge("m.js::<module>", "m.js::start").kind, "call");
  assert.equal(edge("m.js::<module>", "m.js::start").time, "definition");
});

test("definition-time property assignments declare members; use-time ones store or bind late", () => {
  const root = fixture({
    "p.js": `
      export function Moment(config) { this.c = config; }
      var proto = Moment.prototype;
      export function add(n) { return this.c + n; }
      proto.add = add;
      proto.isValid = function () { return this.add(0) > 0; };
      Moment.utc = function () { return new Moment(1); };
      export function use(m) { return m.isValid() + m.add(2); }
      export function setup(el) { el.onclick = function () { return add(1); }; }
      export function init() { proto.late = function () { return 1; }; }
    `,
  });
  const doc = analyze({ name: "js", root });
  const byId = Object.fromEntries(doc.declarations.map((d) => [d.id, d]));
  const edge = (s, t) => doc.edges.find((e) => e.source === s && e.target === t);
  // `proto.isValid = function`: an instance member of Moment, spelled the ES5 way.
  assert.equal(byId["p.js::Moment.isValid"].kind, "method");
  assert.equal(byId["p.js::Moment.isValid"].parent, "p.js::Moment");
  assert.equal(byId["p.js::Moment.isValid"].late, undefined);
  // `proto.add = add`: an alias. `add` keeps its node and gains the member role.
  assert.equal(byId["p.js::add"].parent, "p.js::Moment");
  assert.deepEqual(byId["p.js::add"].aliases, ["Moment.add"]);
  assert.equal(byId["p.js::Moment.add"], undefined);
  // `Moment.utc = function`: a static member.
  assert.equal(byId["p.js::Moment.utc"].kind, "method");
  assert.equal(edge("p.js::Moment.utc", "p.js::Moment").kind, "create");
  // `this.add()` inside a member resolves to the member, exactly.
  assert.equal(edge("p.js::Moment.isValid", "p.js::add").kind, "call");
  assert.equal(edge("p.js::Moment.isValid", "p.js::add").inferred, undefined);
  // An untyped receiver: every instance member of that name, inferred.
  assert.equal(edge("p.js::use", "p.js::Moment.isValid").kind, "call");
  assert.equal(edge("p.js::use", "p.js::Moment.isValid").inferred, true);
  assert.equal(edge("p.js::use", "p.js::add").kind, "call");
  // `el.onclick = function` stores a closure in a value: no declaration, and the
  // closure's body belongs to setup.
  assert.equal(doc.declarations.some((d) => d.id.endsWith("onclick")), false);
  assert.equal(edge("p.js::setup", "p.js::add").kind, "call");
  assert.equal(edge("p.js::setup", "p.js::add").time, "use");
  // `proto.late = function` inside init: nameable, but only once init has run.
  assert.equal(byId["p.js::Moment.late"].late, true);
  assert.equal(byId["p.js::Moment.late"].parent, "p.js::Moment");
  assert.equal(edge("p.js::init", "p.js::Moment.late").kind, "reference");
  assert.equal(edge("p.js::init", "p.js::Moment.late").time, "use");
});

test("bindings on an undeclared global keep their qualified name", () => {
  const root = fixture({
    "core.js": `
      d3.version = "3";
      d3.scale = {};
    `,
    "linear.js": `
      d3.scale.linear = function () { return d3_scale_linear(); };
      function d3_scale_linear() { return 1; }
    `,
    "chart.js": `
      export function chart() { return d3.scale.linear(); }
    `,
  });
  const doc = analyze({ name: "js", root });
  const byId = Object.fromEntries(doc.declarations.map((d) => [d.id, d]));
  const edge = (s, t) => doc.edges.find((e) => e.source === s && e.target === t);
  assert.equal(byId["core.js::d3.scale"].kind, "variable");
  assert.equal(byId["core.js::d3.scale"].parent, null);
  assert.equal(byId["core.js::d3.scale.linear"].parent, "core.js::d3.scale");
  assert.equal(byId["core.js::d3.scale.linear"].file, "linear.js");
  assert.equal(byId["core.js::d3.scale.linear"].name, "linear");
  assert.equal(byId["core.js::<module>"], undefined); // everything in core.js declares
  // Resolved by name path: an ordinary call, not an inferred one.
  assert.equal(edge("chart.js::chart", "core.js::d3.scale.linear").kind, "call");
  assert.equal(edge("chart.js::chart", "core.js::d3.scale.linear").inferred, undefined);
  assert.equal(edge("chart.js::chart", "core.js::d3.scale").kind, "reference");
  assert.equal(edge("core.js::d3.scale.linear", "linear.js::d3_scale_linear").kind, "call");
});

test("local functions become declarations behind the nested option", () => {
  const root = fixture({
    "n.js": `
      export function outer(x) {
        const inner = (y) => helper(y);
        function deep() { return inner(1); }
        return deep() + inner(x);
      }
      export function helper(v) { return v; }
    `,
  });
  const flat = analyze({ name: "js", root });
  const flatEdge = (s, t) => flat.edges.find((e) => e.source === s && e.target === t);
  // By default the closures belong to outer: their bodies are its body.
  assert.equal(flat.declarations.some((d) => d.id.includes("/")), false);
  assert.equal(flatEdge("n.js::outer", "n.js::helper").kind, "call");

  const doc = analyze({ name: "js", root, nested: true });
  const byId = Object.fromEntries(doc.declarations.map((d) => [d.id, d]));
  const edge = (s, t) => doc.edges.find((e) => e.source === s && e.target === t);
  assert.equal(byId["n.js::outer/inner"].kind, "function");
  assert.equal(byId["n.js::outer/inner"].parent, "n.js::outer");
  assert.equal(byId["n.js::outer/deep"].parent, "n.js::outer");
  assert.equal(edge("n.js::outer", "n.js::outer/deep").kind, "call");
  assert.equal(edge("n.js::outer", "n.js::outer/inner").kind, "call");
  assert.equal(edge("n.js::outer/deep", "n.js::outer/inner").kind, "call");
  assert.equal(edge("n.js::outer/inner", "n.js::helper").kind, "call");
  // outer no longer reaches helper directly: the call sits in inner's body.
  assert.equal(edge("n.js::outer", "n.js::helper"), undefined);
});

test("CommonJS exports are declarations of the module", () => {
  const root = fixture({
    "cjs.js": `
      function helper() { return 1; }
      exports.run = function () { return helper(); };
      module.exports.helper = helper;
    `,
  });
  const doc = analyze({ name: "js", root });
  const byId = Object.fromEntries(doc.declarations.map((d) => [d.id, d]));
  const edge = (s, t) => doc.edges.find((e) => e.source === s && e.target === t);
  assert.equal(byId["cjs.js::run"].kind, "function");
  assert.equal(byId["cjs.js::run"].exported, true);
  assert.equal(byId["cjs.js::helper"].exported, true);
  assert.deepEqual(byId["cjs.js::helper"].aliases, ["helper"]);
  assert.equal(edge("cjs.js::run", "cjs.js::helper").kind, "call");
  assert.equal(byId["cjs.js::<module>"], undefined);
});

test("a call through a union type or a record index reaches every candidate", () => {
  const root = fixture({
    "e.ts": `
      export class Svg { draw() { return "svg"; } }
      export class Canvas { draw() { return "canvas"; } }
      const renderers = { svg: new Svg(), canvas: new Canvas() };
      export function drawAll() { return Object.values(renderers).map((r) => r.draw()); }
      export function drawOne(view: string) { return renderers[view].draw(); }
    `,
  });
  const doc = analyze({ name: "ts", root });
  const edge = (s, t) => doc.edges.find((e) => e.source === s && e.target === t);
  for (const [source, cls] of [
    ["e.ts::drawAll", "Svg"],
    ["e.ts::drawAll", "Canvas"],
    ["e.ts::drawOne", "Svg"],
    ["e.ts::drawOne", "Canvas"],
  ]) {
    const e = edge(source, `e.ts::${cls}.draw`);
    assert.equal(e.kind, "call", `${source} -> ${cls}.draw`);
    assert.equal(e.inferred, true); // one of them runs; which one is not decided here
  }
});
