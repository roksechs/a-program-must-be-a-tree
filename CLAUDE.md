# CLAUDE.md

Guidance for AI assistants and contributors working in this repository.

## Project rules (set by the project owner)

1. **This is an open-source tool.** Everything in the repository must be
   publishable as-is.
2. **No credentials, ever.** No API keys, tokens, passwords, private URLs or
   personal data in code, data files, workflows, docs or commit history. The
   GitHub Pages deployment uses only the built-in `GITHUB_TOKEN` / OIDC
   permissions of GitHub Actions; never add secrets to workflows.
3. **Code and documentation are written in English.** This includes comments,
   commit messages, README, docs, data files and the English source strings of
   the UI. Conversation with the owner may happen in Japanese, but nothing
   committed is, except translations inside `site/js/i18n.js` and the
   per-language article content under `site/content/<lang>/`, where the
   Japanese text is content in its own right (drafted first, for review by
   the owner) and every chapter must exist in every language.
4. **The UI is internationalised.** Every user-visible string goes through
   `t()` from `site/js/i18n.js`; never hard-code UI text in components. When
   adding a string, add it to every language (English and Japanese today); the
   unit tests fail when a language misses a key.
5. **The product is a GitHub Pages site** that visualizes declaration graphs
   with D3.js. It must work as a static site without a server or build step;
   d3 is vendored into `site/vendor` so the page has no runtime CDN dependency.
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
* A 3D mode where the z axis is the call height: the deepest callers at the
  top, declarations that are only called at the bottom.

## Repository layout

```
site/            static site (GitHub Pages root)
  js/            ES modules: model, metrics, dominance, simulation, zones, graph2d, graph3d, panel, app, i18n
  data/          generated datasets, listed in index.json
  content/       article chapters: chapters.json, then <lang>/<chapter>.md per language
  vendor/        d3 (copied by `npm run vendor`, do not edit)
analyzers/ts/    JavaScript / TypeScript analyzer (TypeScript compiler API)
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
* Keep dependencies minimal (currently only `d3` and `typescript`, both dev
  dependencies). Pin exact versions.
* Update `docs/DESIGN.md` when physics, zone or metric semantics change, and
  `README.md` when panel controls change.

## Commands

```sh
npm install
npm test               # unit tests (node:test)
npm run vendor         # copy d3 into site/vendor
npm run build:data     # regenerate site/data/*.json (self + d3 packages + samples)
npm run serve          # dev server at http://localhost:8080/
node analyzers/ts/analyze.mjs --name x --root path --include src --out x.json
```

Run `npm test` and `npm run build:data` before committing changes to the
analyzer or the model, and check the page in a browser (2D, 3D, depth slider,
node selection) after changing anything under `site/js`.

## Deployment

`.github/workflows/pages.yml` runs on every push but only deploys from the
repository's default branch: tests, vendoring, data generation, then publishes
`site/` with `actions/deploy-pages`. Pages must be
configured with "GitHub Actions" as the source in the repository settings, and
the `github-pages` environment must allow deployments from the default branch
(its allowed-branch list is pinned when the environment is first created).

The site can equally be served by **Cloudflare Pages** connected to this
repository through its GitHub integration (no tokens in the repository): build
command `npm run build:site` (tests, vendoring, data generation), output
directory `site`, Node version from `.node-version`. Cloudflare then builds
every branch and gives each pull request its own preview URL, which GitHub
Pages cannot do. Nothing in the site depends on which host serves it.

`.github/workflows/release.yml` cuts the tag and the GitHub release for the
version in `package.json` when it reaches the default branch, taking the notes
from the matching `CHANGELOG.md` section. Bumping the version and writing that
section is therefore the whole release procedure. Like the Pages workflow it
uses only the built-in `GITHUB_TOKEN` (`contents: write`) and no third-party
actions.
