// Svelte support: turns a `.svelte` file's real source (script block(s) *and*
// template) into TSX text that `core.mjs`'s ordinary TypeScript-based walk
// already knows how to analyze, using `svelte2tsx` — the same transform
// Svelte's own language server and `svelte-check` use, not a script-block
// extraction of our own. `on:click={someHandler}` becomes a reference to
// `someHandler`, `{aFunction()}` becomes a real call, and `<Child prop={x}>`
// becomes a reference to whatever `Child` resolves to (including another
// `.svelte` file, see `resolveSvelteModule` below) — the whole point of using
// the real transform instead of only extracting `<script>` contents.
//
// Portable like core.mjs itself: no `node:fs`/`node:path`, so the same code
// runs the Node CLI (`analyze.mjs`, real `svelte2tsx` package) and the
// browser's local-folder/GitHub features (`browserAnalyzer.js`, the vendored
// `site/vendor/svelte2tsx.js` bundle) — one transform, two front ends, same
// pattern as `createCore(ts)`.
export const SVELTE_EXTENSION = ".svelte";

/** The final path segment, `node:path`'s `basename` without the dependency (see core.mjs's stripRoot for the same reasoning). */
function basename(fileName) {
  return fileName.slice(fileName.lastIndexOf("/") + 1);
}

// -- Source-map decoding (V3 "mappings" VLQ, base64) --------------------
// svelte2tsx's transform moves and rewrites code enough that a declaration's
// line in the generated TSX is rarely its line in the original `.svelte`
// file; the sourcemap it returns (a standard MagicString-produced V3 map)
// is how to recover the original one. Decoding it ourselves avoids another
// vendored dependency (`@jridgewell/trace-mapping` et al.) for what is, for
// our purposes, a small amount of pure arithmetic.
const BASE64_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const BASE64_VALUE = Object.fromEntries([...BASE64_CHARS].map((c, i) => [c, i]));

/** Decode one VLQ-encoded mapping segment into its (typically 1 or 4) field deltas. */
function decodeVLQSegment(segment) {
  const fields = [];
  let shift = 0;
  let value = 0;
  for (const char of segment) {
    const digit = BASE64_VALUE[char];
    value += (digit & 31) << shift;
    if (digit & 32) {
      shift += 5;
      continue;
    }
    const negative = value & 1;
    value >>= 1;
    fields.push(negative ? -value : value);
    shift = 0;
    value = 0;
  }
  return fields;
}

/**
 * Build a generated-line (1-based) -> original-line (1-based) function from a
 * V3 sourcemap's `mappings` string. Only line granularity is needed (that is
 * all `docs/DATA_FORMAT.md`'s `line` field carries), so this reads just the
 * first mapped source line of each generated line and, for a generated line
 * with no mapping of its own (blank lines, lines the transform introduced
 * wholesale), falls back to the nearest mapped line before it.
 */
function buildLineMap(map) {
  if (!map?.mappings) return (line) => line;
  const lineStrings = map.mappings.split(";");
  const originalLineByGeneratedLine = [];
  let sourceLine = 0;
  for (const lineString of lineStrings) {
    let firstOnThisLine;
    let runningSourceLine = sourceLine;
    for (const segment of lineString ? lineString.split(",") : []) {
      const fields = decodeVLQSegment(segment);
      if (fields.length < 4) continue; // no source position (rare; e.g. a pure column-only segment)
      runningSourceLine += fields[2];
      if (firstOnThisLine === undefined) firstOnThisLine = runningSourceLine;
    }
    sourceLine = runningSourceLine;
    originalLineByGeneratedLine.push(firstOnThisLine);
  }
  return (generatedLine1) => {
    for (let i = generatedLine1 - 1; i >= 0; i--) {
      if (originalLineByGeneratedLine[i] !== undefined) return originalLineByGeneratedLine[i] + 1;
    }
    return generatedLine1;
  };
}

/**
 * Wrap a `svelte2tsx` function (the real `svelte2tsx` package in Node, the
 * vendored browser bundle's export in the browser) into `{ transform }`.
 * `transform(fileName, source)` returns `{ code, toOriginalLine }`: `code` is
 * TSX text ready for `ts.createSourceFile(fileName, code, ..., ts.ScriptKind.TSX)`
 * — kept under the *original* `.svelte` file name, so every other part of the
 * pipeline (file attribution, zones, "Recently opened" keys) needs no change
 * — and `toOriginalLine(generatedLine1)` maps a line in `code` back to its
 * line in `source`.
 */
export function createSvelteSupport(svelte2tsxFn) {
  function transform(fileName, source) {
    const result = svelte2tsxFn(source, { filename: basename(fileName), mode: "ts" });
    return { code: result.code, toOriginalLine: buildLineMap(result.map) };
  }
  return { transform };
}

/**
 * Resolve a relative import specifier ending in `.svelte` against the known
 * set of `.svelte` files being analyzed. TypeScript's own module resolution
 * has no notion of a `.svelte` extension (see the `allowNonTsExtensions`
 * compiler option this feature also needs, in `analyze.mjs`/`browserAnalyzer.js`),
 * so `import Child from "./Child.svelte"` needs this instead of the default
 * algorithm to end up pointing at the right file — the mechanism that lets a
 * component-to-component reference (`<Child .../>` in a template) resolve to
 * the *other* file's declarations rather than dead-ending at the import
 * statement itself, which is the specific thing script-block-only extraction
 * cannot do.
 */
export function resolveSvelteModule(specifier, containingFile, fileExists) {
  if (!specifier.endsWith(SVELTE_EXTENSION)) return undefined;
  if (!specifier.startsWith(".")) return undefined;
  const dirParts = containingFile.split("/");
  dirParts.pop(); // the containing file's own name
  for (const part of specifier.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") dirParts.pop();
    else dirParts.push(part);
  }
  const candidate = dirParts.join("/");
  return fileExists(candidate) ? candidate : undefined;
}

// svelte2tsx's own fixed naming for its generated scaffolding (unlike
// `Ωignore_startΩ`-style markers, these are real identifiers that end up in
// the transformed TSX's AST, not comments) — versioned in its own source
// (see svelte2tsx's `COMPONENT_SUFFIX`) since IDEs can end up with more than
// one svelte2tsx version's ambient declarations loaded at once; stable for
// the one version this project vendors.
const COMPONENT_SUFFIX = "__SvelteComponent_";
const RENDER_FUNCTION_NAME = "$$render";

/**
 * Every `.svelte` file's transform produces the same fixed scaffolding
 * around a component's actual code: a `$$render` function wrapping the
 * whole script and template, a `const Foo__SvelteComponent_ = ...` and a
 * `type Foo__SvelteComponent_ = ...` describing the component's public
 * shape, and a trailing `export default Foo__SvelteComponent_`. None of it
 * is something the component's author wrote, and left as-is it is actively
 * misleading: the `variable` and `type` declarations share one name and
 * therefore one id (`<file>::Foo__SvelteComponent_`, `docs/DATA_FORMAT.md`'s
 * "unique within the document" broken by construction, not by a bug in a
 * particular file), and every one of a component's own functions (promoted
 * by the always-on nesting `analyzeProgram` gives `.svelte` files) ends up
 * parented under the meaningless `$$render` rather than the component.
 *
 * This turns that scaffolding into what the two front ends should actually
 * show: one clean declaration per component, named and ided after the file
 * itself (`Foo.svelte::Foo`, kind `class`) — a Svelte component is exactly
 * that, a named, instantiable, importable unit — with the component's own
 * functions reparented onto it instead of `$$render`. Call once, after
 * `analyzeProgram()`, only when the document has `.svelte` files at all.
 */
export function cleanupSvelteDocument(doc) {
  const perFile = new Map(); // file -> { componentDecl, typeDecl, renderDecl, moduleDecl }
  for (const d of doc.declarations) {
    if (d.parent !== null || !d.file.endsWith(SVELTE_EXTENSION)) continue;
    let entry = perFile.get(d.file);
    if (!entry) perFile.set(d.file, (entry = {}));
    if (d.kind === "variable" && d.name.endsWith(COMPONENT_SUFFIX)) entry.componentDecl = d;
    else if (d.kind === "type" && d.name.endsWith(COMPONENT_SUFFIX)) entry.typeDecl = d;
    else if (d.kind === "function" && d.name === RENDER_FUNCTION_NAME) entry.renderDecl = d;
    else if (d.kind === "module") entry.moduleDecl = d;
  }

  const existingIds = new Set(doc.declarations.map((d) => d.id));
  const idRewrites = new Map(); // old id (exact or `${old}/…`, `${old}.…` prefix) -> new id
  const dropIds = new Set(); // declarations to remove outright (the redundant type, the render wrapper, module code)
  // The `variable` and `type` declarations share one name and, by
  // construction (see the doc comment above), one id *string* — a real id
  // collision, not just a rename target. A source/target pair both equal to
  // one of these knows it can only be the `type X = InstanceType<typeof X>`
  // self-reference that collision produces, never a real self-recursive
  // type (an interface or type alias legitimately referencing itself keeps
  // its own distinct id, since only this specific svelte2tsx pattern
  // collides two different declarations onto the same string).
  const collidedIds = new Set();
  for (const [file, entry] of perFile) {
    // Not the shape this version of svelte2tsx produces (a future version
    // changed something, or `file` isn't actually svelte2tsx output) —
    // leave it alone rather than guess.
    if (!entry.componentDecl || !entry.typeDecl || !entry.renderDecl) continue;
    collidedIds.add(entry.typeDecl.id); // === entry.componentDecl.id, before the rename below
    const baseName = file.slice(file.lastIndexOf("/") + 1).slice(0, -SVELTE_EXTENSION.length);
    const cleanId = `${file}::${baseName}`;
    const newId = existingIds.has(cleanId) ? entry.componentDecl.id : cleanId; // collision: keep the generated id rather than clash
    idRewrites.set(entry.componentDecl.id, newId);
    idRewrites.set(entry.renderDecl.id, newId); // its children (a component's own functions) move onto the component
    dropIds.add(entry.typeDecl.id);
    dropIds.add(entry.renderDecl.id);
    if (entry.moduleDecl) dropIds.add(entry.moduleDecl.id);
    entry.componentDecl.id = newId;
    entry.componentDecl.kind = "class";
    entry.componentDecl.name = baseName;
    entry.componentDecl.displayName = baseName;
    entry.componentDecl.exported = true; // every component is `export default`, even without its own `export` keyword
    // Its line, pre-cleanup, is wherever the transform's synthetic
    // `const Foo__SvelteComponent_ = …` wrapper statement landed — usually
    // the file's last line, since svelte2tsx emits it after the template —
    // rather than anywhere the component's own author would recognize. A
    // component starts where its file does.
    entry.componentDecl.line = 1;
  }
  if (idRewrites.size === 0) return doc;

  const rewriteId = (id) => {
    if (id == null) return id;
    if (idRewrites.has(id)) return idRewrites.get(id);
    for (const [oldId, newId] of idRewrites) {
      if (id.startsWith(`${oldId}/`) || id.startsWith(`${oldId}.`)) return newId + id.slice(oldId.length);
    }
    return id;
  };

  const declarations = [];
  for (const d of doc.declarations) {
    if (dropIds.has(d.id)) continue;
    if (d !== perFile.get(d.file)?.componentDecl) d.id = rewriteId(d.id); // already renamed above
    if (d.parent != null) d.parent = rewriteId(d.parent);
    declarations.push(d);
  }
  const survivingIds = new Set(declarations.map((d) => d.id));

  const edges = [];
  for (const e of doc.edges) {
    if (e.source === e.target && collidedIds.has(e.source)) continue; // the `type X = InstanceType<typeof X>` artifact
    const source = rewriteId(e.source);
    const target = rewriteId(e.target);
    if (!survivingIds.has(source) || !survivingIds.has(target)) continue; // pointed at dropped scaffolding
    if (source === target && e.source !== e.target) continue; // e.g. "the component calls its own $$render": two nodes merged into one, not real recursion
    e.source = source;
    e.target = target;
    edges.push(e);
  }

  doc.declarations = declarations;
  doc.edges = edges;
  return doc;
}
