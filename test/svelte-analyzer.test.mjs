// Svelte support (analyzers/ts/svelte.mjs): a `.svelte` file's script *and*
// template are transformed through the real svelte2tsx (the same transform
// Svelte's own language server uses), then walked by the ordinary
// TypeScript-based core.mjs — not a script-block extraction of our own, so a
// template expression (`{aFunction()}`, `on:click={handler}`,
// `<Child prop={x}>`) resolves exactly like the script code it effectively
// is. These tests exercise that through analyze.mjs's real Node CLI path;
// test/local-analyzer.test.mjs's in-memory-host cross-check pattern is
// repeated here for the browser's equivalent host (site/js/browserAnalyzer.js).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ts from "typescript";
import { svelte2tsx } from "svelte2tsx";
import { analyze } from "../analyzers/ts/analyze.mjs";
import { createCore } from "../analyzers/ts/core.mjs";
import { SVELTE_EXTENSION, cleanupSvelteDocument, createSvelteSupport, resolveSvelteModule } from "../analyzers/ts/svelte.mjs";

const { analyzeProgram } = createCore(ts);

function fixture(files) {
  const dir = mkdtempSync(join(tmpdir(), "apmbat-svelte-"));
  for (const [name, content] of Object.entries(files)) {
    mkdirSync(join(dir, name, ".."), { recursive: true });
    writeFileSync(join(dir, name), content);
  }
  return dir;
}

const PROJECT = {
  "src/App.svelte": `<script lang="ts">
  import Child from "./Child.svelte";
  import { helper } from "./util";
  let count = 0;
  function bump() {
    count += 1;
    helper(count);
  }
</script>

<Child value={count} onBump={bump} />
`,
  "src/Child.svelte": `<script lang="ts">
  export let value: number;
  export let onBump: () => void;
</script>

<button on:click={onBump}>{value}</button>
`,
  "src/util.ts": `export function helper(n: number) { return n + 1; }\n`,
};

test("a .svelte file's own local functions become declarations parented under the component", () => {
  const root = fixture(PROJECT);
  const doc = analyze({ name: "fixture", root, include: ["src"], language: "svelte" });
  const bump = doc.declarations.find((d) => d.id === "src/App.svelte::App/bump");
  assert.ok(bump, "bump should be a declaration");
  assert.equal(bump.parent, "src/App.svelte::App");
  assert.equal(bump.kind, "function");
});

test("a component reference (<Child ...>) resolves to the other file's component declaration", () => {
  const root = fixture(PROJECT);
  const doc = analyze({ name: "fixture", root, include: ["src"], language: "svelte" });
  const edge = doc.edges.find((e) => e.source === "src/App.svelte::App" && e.target === "src/Child.svelte::Child");
  assert.ok(edge, "App should reference Child");
});

test("a call from a component's own function to a plain module resolves like any other cross-file call", () => {
  const root = fixture(PROJECT);
  const doc = analyze({ name: "fixture", root, include: ["src"], language: "svelte" });
  const edge = doc.edges.find((e) => e.source === "src/App.svelte::App/bump" && e.target === "src/util.ts::helper");
  assert.equal(edge?.kind, "call");
});

test("svelte2tsx's own scaffolding ($$render, the duplicate variable/type pair, <module>) is not exposed as declarations", () => {
  const root = fixture(PROJECT);
  const doc = analyze({ name: "fixture", root, include: ["src"], language: "svelte" });
  for (const d of doc.declarations) {
    assert.notEqual(d.name, "$$render");
    assert.ok(!d.name.endsWith("__SvelteComponent_"), `unexpected scaffolding name: ${d.name}`);
    assert.notEqual(d.kind, "module");
  }
});

test("every declaration id is unique, even though svelte2tsx's transform emits a variable and a type of the same name", () => {
  const root = fixture(PROJECT);
  const doc = analyze({ name: "fixture", root, include: ["src"], language: "svelte" });
  const ids = doc.declarations.map((d) => d.id);
  assert.equal(new Set(ids).size, ids.length);
});

test("a component declaration's line is the file's own first line, not wherever svelte2tsx's generated wrapper landed", () => {
  const root = fixture(PROJECT);
  const doc = analyze({ name: "fixture", root, include: ["src"], language: "svelte" });
  const app = doc.declarations.find((d) => d.id === "src/App.svelte::App");
  assert.equal(app.line, 1);
});

test("a declaration's line is remapped from the transformed code back to the original .svelte source", () => {
  const root = fixture(PROJECT);
  const doc = analyze({ name: "fixture", root, include: ["src"], language: "svelte" });
  const bump = doc.declarations.find((d) => d.id === "src/App.svelte::App/bump");
  // `function bump()` is the 5th line of src/App.svelte above.
  assert.equal(bump.line, 5);
});

test("cleanupSvelteDocument drops a merge-induced self-loop but keeps real self-recursion", () => {
  const doc = {
    declarations: [
      { id: "F.svelte::F__SvelteComponent_", name: "F__SvelteComponent_", kind: "variable", file: "F.svelte", line: 9, parent: null, exported: false },
      { id: "F.svelte::F__SvelteComponent_", name: "F__SvelteComponent_", kind: "type", file: "F.svelte", line: 9, parent: null, exported: false },
      { id: "F.svelte::$$render", name: "$$render", kind: "function", file: "F.svelte", line: 1, parent: null, exported: false },
      { id: "F.svelte::<module>", name: "<module>", kind: "module", file: "F.svelte", line: 9, parent: null, exported: false },
      { id: "F.svelte::$$render/recur", name: "recur", kind: "function", file: "F.svelte", line: 3, parent: "F.svelte::$$render", exported: false },
    ],
    edges: [
      // The `type X = InstanceType<typeof X>` artifact: both endpoints share the collided id.
      { source: "F.svelte::F__SvelteComponent_", target: "F.svelte::F__SvelteComponent_", kind: "type", count: 1, time: "use", inferred: true },
      // The component "calling" its own render wrapper: distinct ids that both rewrite onto the same new one.
      { source: "F.svelte::F__SvelteComponent_", target: "F.svelte::$$render", kind: "call", count: 1, time: "use" },
      // Real self-recursion, written by hand inside the component: must survive.
      { source: "F.svelte::$$render/recur", target: "F.svelte::$$render/recur", kind: "call", count: 1, time: "use" },
    ],
  };
  cleanupSvelteDocument(doc);
  assert.equal(doc.declarations.length, 2);
  const component = doc.declarations.find((d) => d.kind === "class");
  assert.equal(component.id, "F.svelte::F");
  const recur = doc.declarations.find((d) => d.name === "recur");
  assert.equal(recur.parent, "F.svelte::F");
  assert.equal(recur.id, "F.svelte::F/recur");
  assert.equal(doc.edges.length, 1);
  assert.deepEqual(doc.edges[0], { source: "F.svelte::F/recur", target: "F.svelte::F/recur", kind: "call", count: 1, time: "use" });
});

test("resolveSvelteModule resolves a relative .svelte import against the known file set", () => {
  const known = new Set(["/src/App.svelte", "/src/Child.svelte", "/src/nested/Grandchild.svelte"]);
  const fileExists = (f) => known.has(f);
  assert.equal(resolveSvelteModule("./Child.svelte", "/src/App.svelte", fileExists), "/src/Child.svelte");
  assert.equal(resolveSvelteModule("./nested/Grandchild.svelte", "/src/App.svelte", fileExists), "/src/nested/Grandchild.svelte");
  assert.equal(resolveSvelteModule("../App.svelte", "/src/nested/Grandchild.svelte", fileExists), "/src/App.svelte");
  assert.equal(resolveSvelteModule("./Missing.svelte", "/src/App.svelte", fileExists), undefined);
  assert.equal(resolveSvelteModule("some-package", "/src/App.svelte", fileExists), undefined);
  assert.equal(resolveSvelteModule("./util", "/src/App.svelte", fileExists), undefined); // not a .svelte specifier
});

// --- Cross-check against the browser's in-memory host (site/js/browserAnalyzer.js's shape) ---

const COMPILER_OPTIONS = {
  allowJs: true,
  checkJs: false,
  noEmit: true,
  noResolve: false,
  skipLibCheck: true,
  target: ts.ScriptTarget.ESNext,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  jsx: ts.JsxEmit.Preserve,
  allowSyntheticDefaultImports: true,
  esModuleInterop: true,
  allowNonTsExtensions: true,
};

const tsLibDir = new URL("../node_modules/typescript/lib/", import.meta.url);
const libTextCache = new Map();
function readLib(fileName) {
  if (!libTextCache.has(fileName)) {
    try {
      libTextCache.set(fileName, readFileSync(new URL(fileName, tsLibDir), "utf8"));
    } catch {
      libTextCache.set(fileName, undefined);
    }
  }
  return libTextCache.get(fileName);
}
function loadLibClosure() {
  const libFiles = new Map();
  const queue = [ts.getDefaultLibFileName(COMPILER_OPTIONS)];
  while (queue.length) {
    const fileName = queue.shift();
    if (libFiles.has(fileName)) continue;
    const text = readLib(fileName);
    libFiles.set(fileName, text);
    if (text === undefined) continue;
    for (const m of text.matchAll(/\/\/\/\s*<reference\s+lib="([^"]+)"/g)) queue.push(`lib.${m[1]}.d.ts`);
  }
  return libFiles;
}

/** Same shape as site/js/browserAnalyzer.js's createHost(), over plain Maps, for the svelte-aware branch. */
function createVirtualHost(files, libFiles, svelte) {
  const sourceFiles = new Map();
  const read = (fileName) => files.get(fileName) ?? libFiles.get(fileName);
  const host = {
    getSourceFile(fileName, languageVersionOrOptions) {
      if (!sourceFiles.has(fileName)) {
        if (fileName.endsWith(SVELTE_EXTENSION)) {
          const raw = files.get(fileName);
          if (raw === undefined) {
            sourceFiles.set(fileName, undefined);
          } else {
            const { code, toOriginalLine } = svelte.transform(fileName, raw);
            svelte.lineMaps.set(fileName, toOriginalLine);
            sourceFiles.set(fileName, ts.createSourceFile(fileName, code, languageVersionOrOptions, true, ts.ScriptKind.TSX));
          }
        } else {
          const text = read(fileName);
          sourceFiles.set(fileName, text === undefined ? undefined : ts.createSourceFile(fileName, text, languageVersionOrOptions, true));
        }
      }
      return sourceFiles.get(fileName);
    },
    getDefaultLibFileName: (options) => ts.getDefaultLibFileName(options),
    writeFile: () => {},
    getCurrentDirectory: () => "/",
    getCanonicalFileName: (f) => f,
    useCaseSensitiveFileNames: () => true,
    getNewLine: () => "\n",
    fileExists: (f) => read(f) !== undefined,
    readFile: (f) => read(f),
    directoryExists: () => true,
    getDirectories: () => [],
  };
  host.resolveModuleNames = (moduleNames, containingFile) =>
    moduleNames.map((name) => {
      const svelteResolved = resolveSvelteModule(name, containingFile, (f) => files.has(f));
      if (svelteResolved) return { resolvedFileName: svelteResolved, extension: ts.Extension.Tsx, isExternalLibraryImport: false };
      return ts.resolveModuleName(name, containingFile, COMPILER_OPTIONS, host).resolvedModule;
    });
  return host;
}

function analyzeVirtual(files, options) {
  const virtualFiles = new Map([...files].map(([path, text]) => [`/${path}`, text]));
  const svelte = { ...createSvelteSupport(svelte2tsx), lineMaps: new Map() };
  const host = createVirtualHost(virtualFiles, loadLibClosure(), svelte);
  const fileNames = [...virtualFiles.keys()];
  const program = ts.createProgram({ rootNames: fileNames, options: COMPILER_OPTIONS, host });
  const doc = analyzeProgram({ program, files: fileNames, stripPrefix: "/", rootLabel: options.name, options, svelteLineMaps: svelte.lineMaps });
  return cleanupSvelteDocument(doc);
}

test("the browser's in-memory host analyzes a Svelte project identically to the Node CLI", () => {
  const root = fixture(PROJECT);
  const nodeDoc = analyze({ name: "fixture", root, include: ["src"], language: "svelte" });

  const files = new Map(Object.entries(PROJECT));
  const virtualDoc = analyzeVirtual(files, { name: "fixture", language: "svelte" });

  assert.deepEqual(virtualDoc.declarations, nodeDoc.declarations);
  assert.deepEqual(virtualDoc.edges, nodeDoc.edges);
});
