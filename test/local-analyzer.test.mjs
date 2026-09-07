// The browser's local-folder feature (site/js/localAnalyzer.js) analyzes a
// ts.Program built over a custom ts.CompilerHost backed by an in-memory file
// map, instead of the Node CLI's ts.sys-backed one. site/js/localAnalyzer.js
// itself needs real browser APIs (showDirectoryPicker, fetch, <script>
// injection) this test can't exercise headlessly, but the part that actually
// carries the correctness risk — a custom host feeding analyzers/ts/core.mjs
// — does not: it is plain object-shaped code, testable by building the exact
// same shape of host here, over files read with node:fs instead of the File
// System Access API and lib text read from node_modules/typescript/lib
// instead of fetch. This test asserts that host and the Node CLI's own
// ts.sys-backed one analyze the same project identically.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ts from "typescript";
import { analyze } from "../analyzers/ts/analyze.mjs";
import { createCore } from "../analyzers/ts/core.mjs";

const { analyzeProgram } = createCore(ts);

function fixture(files) {
  const dir = mkdtempSync(join(tmpdir(), "apmbat-"));
  for (const [name, content] of Object.entries(files)) {
    mkdirSync(join(dir, name, ".."), { recursive: true });
    writeFileSync(join(dir, name), content);
  }
  return dir;
}

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

/** Same shape as site/js/localAnalyzer.js's createHost(), over plain Maps. */
function createVirtualHost(files, libFiles) {
  const sourceFiles = new Map();
  const read = (fileName) => files.get(fileName) ?? libFiles.get(fileName);
  return {
    getSourceFile(fileName, languageVersionOrOptions) {
      if (!sourceFiles.has(fileName)) {
        const text = read(fileName);
        sourceFiles.set(fileName, text === undefined ? undefined : ts.createSourceFile(fileName, text, languageVersionOrOptions, true));
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
}

/** Analyze `files` (relative path -> text) the way the browser would: a virtual host, absolute-style paths. */
function analyzeVirtual(files, options) {
  const virtualFiles = new Map([...files].map(([path, text]) => [`/${path}`, text]));
  const host = createVirtualHost(virtualFiles, loadLibClosure());
  const fileNames = [...virtualFiles.keys()];
  const program = ts.createProgram({ rootNames: fileNames, options: COMPILER_OPTIONS, host });
  return analyzeProgram({ program, files: fileNames, stripPrefix: "/", rootLabel: options.name, options });
}

const PROJECT = {
  "src/util.js": `
    export function helper(x) { return x + 1; }
    export class Box {
      constructor(v) { this.v = v; }
      get() { return helper(this.v); }
    }
  `,
  "src/main.js": `
    import { helper, Box } from "./util.js";
    export function main() {
      const b = new Box(1);
      return [b.get(), helper(2), { onFit: () => b.get() }];
    }
  `,
};

test("a custom in-memory ts.CompilerHost analyzes a project identically to the Node CLI's ts.sys-backed one", () => {
  const root = fixture(PROJECT);
  const nodeDoc = analyze({ name: "fixture", root, include: ["src"], language: "javascript" });

  const files = new Map(Object.entries(PROJECT));
  const virtualDoc = analyzeVirtual(files, { name: "fixture", language: "javascript" });

  // meta differs by construction (root label, generatedAt); everything the
  // graph actually consists of must not.
  assert.deepEqual(virtualDoc.declarations, nodeDoc.declarations);
  assert.deepEqual(virtualDoc.edges, nodeDoc.edges);
  assert.equal(virtualDoc.meta.files, nodeDoc.meta.files);
});

test("a custom in-memory ts.CompilerHost resolves relative imports across virtual files", () => {
  const files = new Map(Object.entries(PROJECT));
  const doc = analyzeVirtual(files, { name: "fixture", language: "javascript" });
  const edge = doc.edges.find((e) => e.source === "src/main.js::main" && e.target === "src/util.js::helper");
  assert.equal(edge?.kind, "call");
});
