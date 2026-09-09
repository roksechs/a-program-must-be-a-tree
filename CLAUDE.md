# CLAUDE.md

Guidance for AI assistants and contributors working in this repository.

## Project rules (set by the project owner)

1. **This is an open-source tool.** Everything in the repository must be
   publishable as-is.
2. **No credentials, ever.** No API keys, tokens, passwords, private URLs or
   personal data in code, data files, workflows, docs or commit history. The
   release workflow uses only the built-in `GITHUB_TOKEN` permissions of
   GitHub Actions; never add secrets to workflows.
3. **Code and documentation are written in English.** This includes comments,
   commit messages, README, docs, data files and the English source strings of
   the UI. Conversation with the owner may happen in Japanese, but nothing
   committed is, except the translations inside `site/js/i18n.js`.
4. **The UI is internationalised.** Every user-visible string goes through
   `t()` from `site/js/i18n.js`; never hard-code UI text in components. When
   adding a string, add it to every language (English and Japanese today); the
   unit tests fail when a language misses a key.
5. **The product is a static site** that visualizes declaration graphs with
   D3.js, hosted on Cloudflare (see Deployment). It must work without a
   server or build step; d3 and TypeScript (for the local-folder feature,
   which runs the analyzer in-browser) are vendored into `site/vendor` so
   the page has no runtime CDN dependency.
6. **The viewer must be able to analyze this project itself** as well as
   well-known open-source projects. Keep `npm run build:data` producing the
   `self` dataset and keep example datasets working.

## What the tool does

Declarations are nodes, calls/references between declarations are directed
edges. Required features, all of which must keep working:

* D3 force-directed graph: repulsion inversely proportional to distance,
  edges act as springs whose attraction is proportional to length. Those two
  are the only forces. The repulsion has no range limit, a spring along an edge
  is the only attraction, and nothing defines a centre or pulls towards one
  (such a pull packs any graph into a disc). Framing is the camera's job.
* Directories and files are drawn as zones (hulls) around their declarations.
  Zones are purely visual: directories and files must never influence the
  physics (no forces, no container-aware seeding).
* A property panel on the right with: recompute/reheat physics, repulsion
  strength, a single directory / file depth slider (0 = no zones, then one
  directory level per step, the maximum also showing files), and diagnostics
  that quantify how tree-like the graph is (directed: being called from two
  unrelated places must score worse than being called once, and worse than
  being shared between siblings), and one switch per edge kind that
  drives drawing, springs and diagnostics together (the three must never
  disagree, and a change must take effect immediately).
* A 3D mode where the z axis is the call height: a declaration sits as close
  to its shallowest caller as the rest of the graph allows, the deepest
  callers (or anything nobody calls) reaching the top; only the leaf ending
  the graph's own single longest call chain is guaranteed to sit at the
  bottom.

## Repository layout

```
site/            static site (deployment root)
  js/            ES modules: model, metrics, dominance, simulation, zones, graph3d, panel, app, i18n,
                 browserAnalyzer/localAnalyzer/githubAnalyzer/analyzeWorker (analyzer running in-browser),
                 analysisCache ("Recently opened", IndexedDB),
                 reports (the four diagnostics as data) and agentTools (those tools over WebMCP / window.programTree)
  data/          generated datasets, listed in index.json
  vendor/        d3 and TypeScript (copied by `npm run vendor`, do not edit; TypeScript is regenerated on every build, not committed)
analyzers/ts/    JavaScript / TypeScript / Svelte analyzer (TypeScript compiler API, svelte2tsx for `.svelte`); core.mjs is the portable half shared with the browser's local-folder feature
samples/         small source programs analyzed into the bundled sample datasets
scripts/         vendoring, dataset generation, dev server
test/            node:test unit tests
docs/            DESIGN.md (architecture, physics, metrics), DATA_FORMAT.md, THEORY.md (edge semantics)
```

## Conventions

* Plain ES modules in the browser, no bundler, no framework. `d3` is a global
  loaded from `site/vendor/d3.min.js`; modules that use it carry
  `/* global d3 */`.
* The JSON data format in `docs/DATA_FORMAT.md` is the contract between
  analyzers and the viewer. Extend it additively; the viewer must keep
  loading older documents.
* New languages are supported by adding an analyzer under `analyzers/<lang>/`
  that emits that JSON, not by changing the viewer.
* Keep dependencies minimal (currently `d3`, `typescript`, `svelte`,
  `svelte2tsx` and `esbuild` — the last three only for Svelte support, `svelte`
  and `svelte2tsx` vendored into `site/vendor/svelte2tsx.js` by `npm run
  vendor` with `esbuild`; all dev dependencies). Pin exact versions.
* Update `docs/DESIGN.md` when physics, zone or metric semantics change, and
  `README.md` when panel controls change.

## Commands

```sh
npm install
npm test               # unit tests (node:test)
npm run vendor         # copy d3 and TypeScript into site/vendor
npm run build:data     # regenerate site/data/*.json (self + d3 packages + samples)
npm run serve          # dev server at http://localhost:8080/
node analyzers/ts/analyze.mjs --name x --root path --include src --out x.json
```

Run `npm test` and `npm run build:data` before committing changes to the
analyzer or the model, and check the page in a browser (2D, 3D, depth slider,
node selection) after changing anything under `site/js`.

## Deployment

The site is served by **Cloudflare** (Pages or Workers) connected to this
repository through its GitHub integration (no tokens in the repository):
build command `npm test && npm run vendor && npm run build:data` (spelled
out so it works on every branch; `npm run build:site` is its shorthand),
output directory `site`, Node version from `.node-version`. Cloudflare
builds every branch and gives each pull request its own preview URL. If the
project is set up as a Workers project instead of Pages, `wrangler.jsonc`
serves `site/` as static assets with the same build.

`.github/workflows/release.yml` cuts the tag and the GitHub release for the
version in `package.json` when it reaches the default branch, taking the notes
from the matching `CHANGELOG.md` section. Bumping the version and writing that
section is therefore the whole release procedure. It uses only the built-in
`GITHUB_TOKEN` (`contents: write`) and no third-party actions.
