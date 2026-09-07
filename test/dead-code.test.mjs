// Catches exactly the kind of leftover a refactor forgets to remove: a
// method, function or CSS custom property whose only caller/user was
// deleted along with the code that called it (e.g. graph2d.js's removal
// left Graph3D.show(), zones.js's topPoint and two CSS tokens behind). The
// declaration check is the viewer's own model (model.js, metrics.js) run on
// the project's own source: this is a graph-shape question, so the graph
// model already answers it — nothing here is reimplemented.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { analyze } from "../analyzers/ts/analyze.mjs";
import { buildGraph } from "../site/js/model.js";
import { unreferencedDeclarations } from "../site/js/metrics.js";

const root = new URL("..", import.meta.url).pathname;

test("no unused top-level declaration or class member in the viewer or analyzer", () => {
  const doc = analyze({ name: "self", root, include: ["site/js", "analyzers", "scripts", "test"], language: "javascript" });
  const graph = buildGraph(doc);
  const dead = unreferencedDeclarations(graph);
  assert.deepEqual(
    dead.map((n) => n.id),
    [],
    "unused declaration(s) — delete them, or if this is a false positive (called only through a dynamic/stored reference the analyzer can't trace), extend unreferencedDeclarations in metrics.js",
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
