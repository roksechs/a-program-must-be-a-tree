// Copies third-party browser bundles from node_modules into site/vendor so the
// published site has no runtime dependency on a CDN.
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";
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

// analyzers/ts/core.mjs and analyzers/ts/svelte.mjs (our own code, not
// third-party) touch nothing outside the `ts` module (and, for svelte.mjs,
// the `svelte2tsx` function) they are handed, so they run unmodified in the
// browser — but the published site only ever serves site/, so they need a
// copy there too. Copied, not authored, to keep analyzers/ts/*.mjs the
// single source of truth; see site/js/localAnalyzer.js.
copyFileSync(join(root, "analyzers/ts/core.mjs"), join(vendorDir, "analyzer-core.js"));
copyFileSync(join(root, "analyzers/ts/svelte.mjs"), join(vendorDir, "svelte-analyzer.js"));

// svelte2tsx: unlike TypeScript, it ships no browser-ready bundle (an ES
// module importing the Node builtin `path`, `typescript` and `svelte/compiler`
// packages), so it is bundled here with esbuild rather than merely copied.
// `svelte/compiler` (the real Svelte parser its transform runs on) is pulled
// in for real; `path` is given a tiny browser-compatible stand-in (svelte2tsx
// only ever calls `path.basename`/`path.parse` on the filename it's told,
// nothing filesystem-related); `typescript` is left external and reached
// through the vendored typescript.js already loaded as the `ts` global (see
// loadTypeScript() in site/js/browserAnalyzer.js) instead of bundling a
// second copy of a multi-megabyte compiler — esbuild's IIFE output turns an
// external ESM import into a `require("typescript")` call, so the banner
// below supplies a global `require` that resolves exactly that one name.
const svelte2tsxPkg = JSON.parse(readFileSync(join(root, "node_modules/svelte2tsx/package.json"), "utf8"));
const sveltePkg = JSON.parse(readFileSync(join(root, "node_modules/svelte/package.json"), "utf8"));
const pathShim = {
  name: "node-path-shim",
  setup(build) {
    build.onResolve({ filter: /^path$/ }, () => ({ path: "node-path-shim", namespace: "node-path-shim" }));
    build.onLoad({ filter: /.*/, namespace: "node-path-shim" }, () => ({
      contents: `
        export function basename(p, ext) {
          let b = p.split(/[\\\\/]/).pop() || "";
          if (ext && b.endsWith(ext)) b = b.slice(0, -ext.length);
          return b;
        }
        export function dirname(p) {
          const i = p.replace(/[\\\\/]+$/, "").lastIndexOf("/");
          return i < 0 ? "." : p.slice(0, i) || "/";
        }
        export function extname(p) {
          const b = basename(p);
          const i = b.lastIndexOf(".");
          return i <= 0 ? "" : b.slice(i);
        }
        export function join(...parts) { return parts.filter(Boolean).join("/").replace(/\\/+/g, "/"); }
        export function resolve(...parts) { return join(...parts); }
        export function relative(from, to) { return to; }
        export function isAbsolute(p) { return p.startsWith("/"); }
        export function parse(p) {
          const base = basename(p);
          const ext = extname(base);
          return { root: "", dir: dirname(p), base, ext, name: ext ? base.slice(0, -ext.length) : base };
        }
        export default { basename, dirname, extname, join, resolve, relative, isAbsolute, parse };
      `,
      loader: "js",
    }));
  },
};
const svelte2tsxBundle = await esbuild.build({
  stdin: {
    contents: 'export { svelte2tsx } from "svelte2tsx";\n',
    resolveDir: root,
    loader: "js",
  },
  bundle: true,
  format: "iife",
  globalName: "__svelte2tsxExports",
  platform: "browser",
  external: ["typescript"],
  plugins: [pathShim],
  minify: true,
  write: false,
  banner: {
    js: [
      "// Generated by `npm run vendor` from svelte2tsx + svelte/compiler (see scripts/vendor.mjs). Do not edit.",
      'if (typeof require === "undefined") { var require = function(name) {',
      '  if (name === "typescript") return (typeof self !== "undefined" ? self : window).ts;',
      '  throw new Error("vendor/svelte2tsx.js: unexpected require(" + name + ")");',
      "}; }",
    ].join("\n"),
  },
});
writeFileSync(join(vendorDir, "svelte2tsx.js"), svelte2tsxBundle.outputFiles[0].text);

writeFileSync(
  join(vendorDir, "VERSIONS.json"),
  JSON.stringify({ d3: d3Pkg.version, typescript: tsPkg.version, svelte: sveltePkg.version, svelte2tsx: svelte2tsxPkg.version }, null, 2) + "\n",
);
console.log(`vendored d3@${d3Pkg.version} -> site/vendor/d3.min.js`);
console.log(`vendored typescript@${tsPkg.version} -> site/vendor/typescript.js (+ ${libFiles.size} lib files in site/vendor/ts-lib/)`);
console.log(`vendored svelte2tsx@${svelte2tsxPkg.version} (svelte@${sveltePkg.version}) -> site/vendor/svelte2tsx.js`);
console.log("copied analyzers/ts/core.mjs -> site/vendor/analyzer-core.js");
console.log("copied analyzers/ts/svelte.mjs -> site/vendor/svelte-analyzer.js");
