# A program must be a tree

Visualize the declarations of a codebase and the calls between them as a
force-directed graph, and measure how close that graph is to a tree.

* **Nodes** are declarations (functions, methods, classes, variables, types).
* **Edges** are directed references: `A -> B` means the body of `A` calls or
  uses `B`.
* **Zones** are the files and directories that contain the declarations, drawn
  as nested hulls around their members. They are purely visual and never
  influence the layout.
* **Physics**: every pair of nodes repels with a force inversely proportional to
  their distance, at any distance; every edge is a spring whose pull is
  proportional to its length. Those are the only two forces. No point is a
  centre and nothing pulls towards one, so declarations sit close together only
  when edges hold them there.
* **3D mode** lifts the same layout into three dimensions where the vertical
  axis is the call height: declarations that only get called sit at the
  bottom, the deepest callers sit at the top.
* **Diagnostics** quantify tree-likeness on the enabled edge kinds: spanning
  ratio, acyclicity, single-caller ratio, DAG-ness and locality. They are
  directed: `A -> S <- B` is not a tree, and sharing a declaration between two
  siblings costs less than calling it from an unrelated part of the program.
  The distance is measured in the dominator tree — the deepest nesting the
  program admits — which also gives every declaration a *natural scope*: where
  it could live if the program were a tree. Plus the usual counts (components,
  cycles, roots, leaves, longest call chain, initialisation cycles) and a list
  of the declarations whose sharing costs the most.
* **Edge kinds** follow a small theory (`docs/THEORY.md`): calls, constructions,
  references (callbacks and other value flows), type-only uses, inheritance,
  interface implementation and overriding. The analyzer resolves `new` to the
  constructor that actually runs, dispatches method calls to overriding
  implementations, and lifts callbacks into calls at the declaration that
  invokes them with a bounded control-flow analysis.

The viewer is a static page (D3.js, no build step) meant to be served from
GitHub Pages. Analyzers turn a codebase into a small JSON document
(see [docs/DATA_FORMAT.md](docs/DATA_FORMAT.md)) that the viewer loads.

## Quick start

```sh
npm install
npm run vendor       # copy d3 into site/vendor
npm run build:data   # analyze this repository and a few d3 packages into site/data
npm run serve        # http://localhost:8080/
```

Open the page, pick a dataset from the panel on the right, or open any JSON
file that follows the data format. `?data=<id>` selects a bundled dataset and
`?data=https://...` loads a remote one.

The interface is available in English and Japanese. The language follows
`?lang=en|ja`, then the saved preference, then the browser locale; the selector
in the header switches it at any time. Translations live in `site/js/i18n.js`.

## Analyzing your own project

The bundled analyzer handles JavaScript and TypeScript with the TypeScript
compiler API:

```sh
node analyzers/ts/analyze.mjs --name my-app --root path/to/my-app \
     --include src --exclude "**/*.test.ts" --out my-app.json
```

Then open `my-app.json` from the panel. Other languages only need an analyzer
that writes the same JSON; see the data format document.

## Property panel

| Section     | Controls |
|-------------|----------|
| Data        | bundled datasets, open a local JSON file |
| Header      | language selector (English / Japanese) |
| View        | 2D / 3D, label mode, colour by kind or call height, 3D layer gap and planes, auto-rotate, fit |
| Edges       | one switch per edge kind; an enabled kind is drawn, acts as a spring and counts in the diagnostics (type-level edges are off by default) |
| Physics     | recompute (reheat) when the layout got stuck, reset positions, repulsion, spring stiffness, rest length |
| Zones       | directory / file depth from 0 (none) through every directory level down to the files |
| Diagnostics | tree score and its five components, counts, costliest sharing |
| Selection   | callers and callees of the clicked node, with the lift of each edge, the declaration's natural scope, and a Focus button that centres the camera on it |

## Repository layout

```
site/            static site published to GitHub Pages
  js/            ES modules: model, metrics, dominance, simulation, zones, renderers, panel, app
  data/          generated datasets (index.json lists them)
  vendor/        d3 (copied by `npm run vendor`)
analyzers/ts/    JavaScript / TypeScript analyzer
samples/         small source programs analyzed into the bundled `sample-*` datasets
scripts/         data generation, vendoring, dev server
test/            node:test unit tests
docs/            design notes, the data format and the theory behind the edge kinds
CHANGELOG.md     release notes, one section per version
```

## Development

```sh
npm test
```

The GitHub Pages workflow (`.github/workflows/pages.yml`) runs the tests,
vendors d3, regenerates the datasets and publishes `site/` on every push to
the repository's default branch. Enable Pages with "GitHub Actions" as the
source in the repository settings.

Releasing is a version bump. `.github/workflows/release.yml` reads the version
in `package.json` on every push to the default branch and, when no release
carries that tag yet, creates the tag and the GitHub release from the matching
`CHANGELOG.md` section (falling back to GitHub's generated notes). So:

```sh
npm version minor --no-git-tag-version   # write the CHANGELOG section too
```

and merge. It uses only the built-in `GITHUB_TOKEN`; no secrets are involved. GitHub creates a `github-pages` environment
on the first deployment whose allowed deployment branch is pinned to the
default branch *at that time*; if you rename or switch the default branch
later, add the new branch under Settings → Environments → github-pages →
Deployment branches, otherwise the deploy job is rejected without running.

## License

MIT. D3 is distributed under its own ISC license (see `site/vendor/d3.LICENSE`).
