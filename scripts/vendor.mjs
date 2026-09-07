// Copies third-party browser bundles from node_modules into site/vendor so the
// published site has no runtime dependency on a CDN.
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const vendorDir = join(root, "site", "vendor");
mkdirSync(vendorDir, { recursive: true });

const d3Pkg = JSON.parse(readFileSync(join(root, "node_modules/d3/package.json"), "utf8"));
copyFileSync(join(root, "node_modules/d3/dist/d3.min.js"), join(vendorDir, "d3.min.js"));
copyFileSync(join(root, "node_modules/d3/LICENSE"), join(vendorDir, "d3.LICENSE"));

// TypeScript: the compiler itself, plus the lib.*.d.ts files it needs for the
// exact compiler options analyzers/ts uses (target/module ESNext, no
// explicit `lib`) — the local-folder feature (site/js/localAnalyzer.js) runs
// the same analyzer in-browser and must see the same globals the Node CLI
// does. `typescript.js` sets a plain top-level `var ts`, so loaded as a
// classic (non-module) <script> it becomes the `ts` global, the same way
// `d3.min.js` becomes the `d3` global.
const tsPkg = JSON.parse(readFileSync(join(root, "node_modules/typescript/package.json"), "utf8"));
const tsLibDir = join(root, "node_modules/typescript/lib");
const vendorLibDir = join(vendorDir, "ts-lib");
mkdirSync(vendorLibDir, { recursive: true });
copyFileSync(join(tsLibDir, "typescript.js"), join(vendorDir, "typescript.js"));
copyFileSync(join(root, "node_modules/typescript/LICENSE.txt"), join(vendorDir, "typescript.LICENSE"));

// Follow `/// <reference lib="..." />` and `/// <reference path="..." />`
// from the default lib file for our compiler options, so exactly the files
// that would load in Node are vendored — no more, no less.
const defaultLib = ts.getDefaultLibFileName({ target: ts.ScriptTarget.ESNext });
const libFiles = new Set();
const queue = [defaultLib];
while (queue.length) {
  const name = queue.shift();
  if (libFiles.has(name)) continue;
  libFiles.add(name);
  const text = readFileSync(join(tsLibDir, name), "utf8");
  for (const m of text.matchAll(/\/\/\/\s*<reference\s+lib="([^"]+)"/g)) queue.push(`lib.${m[1]}.d.ts`);
  for (const m of text.matchAll(/\/\/\/\s*<reference\s+path="([^"]+)"/g)) queue.push(m[1]);
}
for (const name of libFiles) copyFileSync(join(tsLibDir, name), join(vendorLibDir, name));

// analyzers/ts/core.mjs (our own code, not third-party) touches nothing
// outside the `ts` module it is handed, so it runs unmodified in the
// browser — but the published site only ever serves site/, so it needs a
// copy there too. Copied, not authored, to keep analyzers/ts/core.mjs the
// single source of truth; see site/js/localAnalyzer.js.
copyFileSync(join(root, "analyzers/ts/core.mjs"), join(vendorDir, "analyzer-core.js"));

writeFileSync(
  join(vendorDir, "VERSIONS.json"),
  JSON.stringify({ d3: d3Pkg.version, typescript: tsPkg.version }, null, 2) + "\n",
);
console.log(`vendored d3@${d3Pkg.version} -> site/vendor/d3.min.js`);
console.log(`vendored typescript@${tsPkg.version} -> site/vendor/typescript.js (+ ${libFiles.size} lib files in site/vendor/ts-lib/)`);
console.log("copied analyzers/ts/core.mjs -> site/vendor/analyzer-core.js");
