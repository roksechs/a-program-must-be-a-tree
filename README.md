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
  their distance; every edge is a spring whose pull is proportional to its
  length.
* **3D mode** lifts the same layout into three dimensions where the vertical
  axis is the call height: declarations that only get called sit at the
  bottom, the deepest callers sit at the top.
* **Diagnostics** quantify tree-likeness: spanning ratio, acyclicity,
  single-caller ratio and DAG-ness, plus the usual counts (components, cycles,
  roots, leaves, longest call chain) and a list of the most shared declarations.

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
| Physics     | recompute (reheat) when the layout got stuck, reset positions, repulsion, spring stiffness, rest length, gravity |
| Zones       | directory / file depth from 0 (none) through every directory level down to the files |
| Diagnostics | tree score and its components, counts, most shared declarations |
| Selection   | callers and callees of the clicked node |

## Repository layout

```
site/            static site published to GitHub Pages
  js/            ES modules: model, metrics, simulation, zones, renderers, panel, app
  data/          generated datasets (index.json lists them)
  vendor/        d3 (copied by `npm run vendor`)
analyzers/ts/    JavaScript / TypeScript analyzer
scripts/         data generation, vendoring, dev server
test/            node:test unit tests
docs/            design notes, the data format and the theory behind the edge kinds
```

## Development

```sh
npm test
```

The GitHub Pages workflow (`.github/workflows/pages.yml`) runs the tests,
vendors d3, regenerates the datasets and publishes `site/` on every push to
the repository's default branch. Enable Pages with "GitHub Actions" as the
source in the repository settings.

## License

MIT. D3 is distributed under its own ISC license (see `site/vendor/d3.LICENSE`).
