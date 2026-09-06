// Generates the example datasets published with the site:
//  - this repository itself,
//  - a few d3 packages (their sources ship inside node_modules), and
//  - two synthetic graphs that anchor the diagnostics (a perfect tree and a tangle).
// Writes site/data/*.json and site/data/index.json.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { analyze } from "../analyzers/ts/analyze.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = join(root, "site", "data");
mkdirSync(dataDir, { recursive: true });

const index = [];
const write = (id, name, description, doc) => {
  const file = `${id}.json`;
  writeFileSync(join(dataDir, file), JSON.stringify(doc, null, 1) + "\n");
  index.push({ id, name, description, file: `data/${file}` });
  console.error(`${name}: ${doc.declarations.length} declarations, ${doc.edges.length} edges -> site/data/${file}`);
};

// 1. Self.
write(
  "self",
  "a-program-must-be-a-tree",
  "this viewer and its analyzer",
  analyze({ name: "a-program-must-be-a-tree", root, include: ["site/js", "analyzers", "scripts", "test"], language: "javascript" }),
);

// 1b. Self again, with local functions as nodes: the analyzer is one large
// function made of closures, and this is the only view in which its own
// structure can be diagnosed.
write(
  "self-nested",
  "a-program-must-be-a-tree (nested declarations)",
  "this viewer and its analyzer, local functions as nodes",
  analyze({ name: "a-program-must-be-a-tree", root, include: ["site/js", "analyzers", "scripts", "test"], language: "javascript", nested: true }),
);

// 2. d3 packages. Each package ships its ES module sources in src/.
const d3Packages = ["d3-force", "d3-selection", "d3-scale", "d3-shape", "d3-hierarchy", "d3-zoom"];
for (const pkg of d3Packages) {
  const pkgRoot = join(root, "node_modules", pkg);
  if (!existsSync(join(pkgRoot, "src"))) {
    console.error(`skipping ${pkg}: node_modules/${pkg}/src not found (run npm install)`);
    continue;
  }
  const version = JSON.parse(readFileSync(join(pkgRoot, "package.json"), "utf8")).version;
  write(pkg, `${pkg}@${version}`, "D3 module sources", analyze({ name: pkg, root: pkgRoot, include: ["src"], language: "javascript" }));
}

// 2b. Sample sources: one small program per idea the docs explain, analyzed for
// real so the picture is the analyzer's own output.
write(
  "sample-bindings",
  "sample: bindings, aliases, late bindings and stores",
  "one file per way a property assignment is read (docs/THEORY.md §4.1)",
  analyze({ name: "sample-bindings", root: join(root, "samples", "bindings"), include: ["."], language: "javascript" }),
);

// 3. Synthetic graphs.
write("sample-tree", "sample: perfect tree", "synthetic, 40 declarations", syntheticTree(3, 3));
write("sample-tangle", "sample: tangled graph", "synthetic, 60 declarations with cycles and shared helpers", syntheticTangle(60, 7));

function syntheticTree(branching, depth) {
  const declarations = [];
  const edges = [];
  const build = (id, level, dir) => {
    const file = `${dir}/${id}.js`;
    declarations.push({ id, name: id, kind: level === 0 ? "function" : level === depth ? "variable" : "function", file, line: 1 });
    if (level === depth) return;
    for (let i = 0; i < branching; i++) {
      const child = `${id}_${i}`;
      edges.push({ source: id, target: child, kind: "call" });
      build(child, level + 1, level === 0 ? `${dir}/${"module" + i}` : dir);
    }
  };
  build("main", 0, "src");
  return { meta: { name: "sample-tree", root: ".", language: "synthetic", generatedAt: new Date().toISOString(), analyzer: "synthetic" }, declarations, edges };
}

function syntheticTangle(n, files) {
  // Deterministic pseudo random generator so the dataset is reproducible.
  let seed = 42;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
  const declarations = [];
  const edges = [];
  const kinds = ["function", "function", "function", "method", "class", "variable"];
  for (let i = 0; i < n; i++) {
    const f = i % files;
    const dir = f < files / 2 ? "src/core" : "src/util";
    declarations.push({ id: `d${i}`, name: `decl${i}`, kind: kinds[Math.floor(rand() * kinds.length)], file: `${dir}/file${f}.js`, line: i + 1 });
  }
  const seen = new Set();
  const addEdge = (a, b, kind = "call") => {
    const key = `${a}->${b}`;
    if (seen.has(key)) return;
    seen.add(key);
    edges.push({ source: `d${a}`, target: `d${b}`, kind });
  };
  // A backbone that is mostly a tree plus extra cross edges and a few cycles.
  for (let i = 1; i < n; i++) addEdge(Math.floor(rand() * i), i);
  for (let k = 0; k < n; k++) addEdge(Math.floor(rand() * n), Math.floor(rand() * n), rand() < 0.3 ? "reference" : "call");
  for (let k = 0; k < 4; k++) {
    const a = Math.floor(rand() * n);
    const b = Math.floor(rand() * n);
    addEdge(a, b);
    addEdge(b, a);
  }
  addEdge(5, 5); // direct recursion
  return { meta: { name: "sample-tangle", root: ".", language: "synthetic", generatedAt: new Date().toISOString(), analyzer: "synthetic" }, declarations, edges };
}

index.sort((a, b) => (a.id === "self" ? -1 : b.id === "self" ? 1 : a.id.localeCompare(b.id)));
writeFileSync(join(dataDir, "index.json"), JSON.stringify(index, null, 2) + "\n");
console.error(`wrote site/data/index.json with ${index.length} datasets`);
