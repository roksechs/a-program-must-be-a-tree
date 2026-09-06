// Catches exactly the kind of leftover a refactor forgets to remove: a
// method, function or CSS custom property whose only caller/user was
// deleted along with the code that called it (e.g. graph2d.js's removal
// left Graph3D.show(), zones.js's topPoint and two CSS tokens behind).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { analyze } from "../analyzers/ts/analyze.mjs";

const root = new URL("..", import.meta.url).pathname;

test("no unused top-level declaration or class member in the viewer or analyzer", () => {
  const doc = analyze({ name: "self", root, include: ["site/js", "analyzers", "scripts", "test"], language: "javascript" });
  const inDegree = new Map(doc.declarations.map((d) => [d.id, 0]));
  for (const e of doc.edges) if (inDegree.has(e.target)) inDegree.set(e.target, inDegree.get(e.target) + 1);
  // A "module" declaration (a file's top-level code) is never itself called.
  // A local declaration (id contains "/", docs/THEORY.md Definition 9a/10 —
  // e.g. an options-object callback such as `{ onFit: () => {...} }`) is
  // excluded too: the analyzer does not trace a call that reaches it through
  // a stored reference (`this.callbacks.onFit()`), so it shows as unused
  // even when something invokes it dynamically. Everything else — a
  // top-level function/class or a class member (`.`-parented) — has no such
  // excuse: something must call, construct, reference or write to it.
  const dead = doc.declarations.filter((d) => d.kind !== "module" && !d.id.includes("/") && inDegree.get(d.id) === 0);
  assert.deepEqual(
    dead.map((d) => d.id),
    [],
    "unused declaration(s) — delete them, or if this is a false positive (called only through a dynamic/stored reference the analyzer can't trace), extend the exclusion above",
  );
});

const CSS_DECL = /(--[a-zA-Z0-9-]+)\s*:/g;
const CSS_USE = /var\(\s*(--[a-zA-Z0-9-]+)/g;

test("no unused CSS custom property", () => {
  const cssFiles = readdirSync(new URL("../site/", import.meta.url)).filter((f) => f.endsWith(".css"));
  const declared = new Map(); // name -> file it was first declared in
  const used = new Set();
  for (const file of cssFiles) {
    const css = readFileSync(new URL(`../site/${file}`, import.meta.url), "utf8");
    for (const m of css.matchAll(CSS_DECL)) if (!declared.has(m[1])) declared.set(m[1], file);
    for (const m of css.matchAll(CSS_USE)) used.add(m[1]);
  }
  const unused = [...declared.keys()].filter((name) => !used.has(name));
  assert.deepEqual(unused, [], "unused custom propert(y/ies) — delete the declaration, in the file(s) named above");
});
