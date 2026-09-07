#!/usr/bin/env node
// JavaScript / TypeScript / Svelte analyzer, Node front end.
//
// Walks a directory tree, parses every .js/.mjs/.cjs/.jsx/.ts/.tsx/.svelte
// file with the TypeScript compiler API (a `.svelte` file's script and
// template transformed through svelte2tsx first, see svelte.mjs) and emits
// a declaration graph document (see docs/DATA_FORMAT.md). Declarations are
// module-level functions, variables, classes (with their members),
// interfaces, type aliases and enums. An edge A -> B is emitted whenever the
// body of A references B; the edge kind tells whether it was a call, a
// plain reference, a heritage clause or a type-only use.
//
// The actual analysis (walking a ts.Program) lives in core.mjs and is shared
// with the browser's local-folder feature (site/js/localAnalyzer.js); this
// file only supplies the Node-specific half: finding source files on disk
// and building the ts.Program that reads them via ts.sys.
//
// Usage:
//   node analyzers/ts/analyze.mjs --name my-project --root path/to/project \
//        --include src lib --exclude "**/*.test.ts" [--nested] --out graph.json
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { extname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { svelte2tsx } from "svelte2tsx";
import { ANALYZER_VERSION, DEFAULT_EXCLUDES, EXTENSIONS, createCore } from "./core.mjs";
import { SVELTE_EXTENSION, cleanupSvelteDocument, createSvelteSupport, resolveSvelteModule } from "./svelte.mjs";

export { ANALYZER_VERSION };
const { analyzeProgram } = createCore(ts);
const svelteSupport = createSvelteSupport(svelte2tsx);

/** Recursively list source files under `dir`, skipping excluded directory names and glob-ish patterns. */
export function listSourceFiles(dir, excludes) {
  const out = [];
  const walk = (d) => {
    let entries;
    try {
      entries = readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = join(d, e.name);
      if (e.isDirectory()) {
        if (DEFAULT_EXCLUDES.includes(e.name) || excludes.some((x) => matches(full, x))) continue;
        walk(full);
      } else if (e.isFile()) {
        if (!EXTENSIONS.has(extname(e.name))) continue;
        if (e.name.endsWith(".d.ts")) continue;
        if (excludes.some((x) => matches(full, x))) continue;
        out.push(full);
      }
    }
  };
  const st = statSync(dir);
  if (st.isFile()) return [dir];
  walk(dir);
  return out;
}

/** Tiny glob matcher supporting `*`, `**` and literal substrings. */
function matches(path, pattern) {
  const normalized = path.split(sep).join("/");
  if (!pattern.includes("*")) return normalized.includes(pattern);
  const re = new RegExp(
    "^" +
      pattern
        .split("/")
        .join("\\/")
        .replace(/\*\*\\\//g, "(?:.*\\/)?")
        .replace(/\*\*/g, ".*")
        .replace(/\*/g, "[^/]*") +
      "$",
  );
  return re.test(normalized) || re.test(normalized.split("/").pop());
}

/**
 * Analyze a project.
 * @param {object} options { name, root, include: string[], exclude: string[], language,
 *   nested: boolean (local functions as declarations, ids `<parent>/<name>`) }
 */
export function analyze(options) {
  const root = resolve(options.root ?? ".");
  const includes = (options.include?.length ? options.include : ["."]).map((p) => resolve(root, p));
  const excludes = options.exclude ?? [];
  const files = [...new Set(includes.flatMap((p) => listSourceFiles(p, excludes)))].sort();
  const hasSvelte = files.some((f) => f.endsWith(SVELTE_EXTENSION));

  const compilerOptions = {
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
    // TypeScript otherwise refuses to include a root file with an extension
    // it doesn't recognize at all (a hard error, not just a diagnostic — see
    // analyzers/ts/svelte.mjs's own comment on the transform this enables).
    // Scoped to projects that actually have a `.svelte` file, so it changes
    // nothing about how every other project here has always been analyzed.
    ...(hasSvelte ? { allowNonTsExtensions: true } : null),
  };

  // The plain default host (real `ts.sys` file reads, no `.svelte` in sight)
  // unless there is a `.svelte` file to transform — most projects, so this
  // keeps their exact prior behavior rather than adding an unneeded custom
  // host to every analysis.
  let host;
  let svelteLineMaps;
  if (hasSvelte) {
    const defaultHost = ts.createCompilerHost(compilerOptions, true);
    svelteLineMaps = new Map();
    const svelteSourceFiles = new Map();
    host = {
      ...defaultHost,
      getSourceFile(fileName, languageVersionOrOptions, ...rest) {
        if (!fileName.endsWith(SVELTE_EXTENSION)) return defaultHost.getSourceFile(fileName, languageVersionOrOptions, ...rest);
        if (!svelteSourceFiles.has(fileName)) {
          const raw = defaultHost.readFile(fileName);
          if (raw === undefined) {
            svelteSourceFiles.set(fileName, undefined);
          } else {
            const { code, toOriginalLine } = svelteSupport.transform(fileName, raw);
            svelteLineMaps.set(fileName, toOriginalLine);
            svelteSourceFiles.set(fileName, ts.createSourceFile(fileName, code, languageVersionOrOptions, true, ts.ScriptKind.TSX));
          }
        }
        return svelteSourceFiles.get(fileName);
      },
      resolveModuleNames(moduleNames, containingFile, ...rest) {
        return moduleNames.map((name) => {
          const svelteResolved = resolveSvelteModule(name, containingFile, (f) => ts.sys.fileExists(f));
          if (svelteResolved) return { resolvedFileName: svelteResolved, extension: ts.Extension.Tsx, isExternalLibraryImport: false };
          return ts.resolveModuleName(name, containingFile, compilerOptions, defaultHost).resolvedModule;
        });
      },
    };
  }

  const program = host ? ts.createProgram({ rootNames: files, options: compilerOptions, host }) : ts.createProgram(files, compilerOptions);

  const doc = analyzeProgram({
    program,
    files,
    stripPrefix: root.split(sep).join("/"),
    rootLabel: relative(process.cwd(), root).split(sep).join("/") || ".",
    options,
    svelteLineMaps,
  });
  return hasSvelte ? cleanupSvelteDocument(doc) : doc;
}

function parseArgs(argv) {
  const opts = { include: [], exclude: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    switch (a) {
      case "--name":
        opts.name = next();
        break;
      case "--root":
        opts.root = next();
        break;
      case "--out":
        opts.out = next();
        break;
      case "--language":
        opts.language = next();
        break;
      case "--nested":
        opts.nested = true;
        break;
      case "--include":
        while (argv[i + 1] && !argv[i + 1].startsWith("--")) opts.include.push(next());
        break;
      case "--exclude":
        while (argv[i + 1] && !argv[i + 1].startsWith("--")) opts.exclude.push(next());
        break;
      case "--help":
      case "-h": {
        // The whole header comment block, from just after the shebang to the
        // first line that isn't part of it (robust to the comment's length,
        // unlike a hardcoded line count).
        const lines = readFileSync(fileURLToPath(import.meta.url), "utf8").split("\n");
        const header = [];
        for (let j = 1; j < lines.length && lines[j].startsWith("//"); j++) header.push(lines[j].replace(/^\/\/ ?/, ""));
        console.log(header.join("\n"));
        process.exit(0);
        break;
      }
      default:
        throw new Error(`unknown argument: ${a}`);
    }
  }
  return opts;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const opts = parseArgs(process.argv.slice(2));
  const doc = analyze(opts);
  const json = JSON.stringify(doc, null, 1) + "\n";
  if (opts.out) {
    writeFileSync(opts.out, json);
    console.error(`${doc.meta.name}: ${doc.meta.files} files, ${doc.declarations.length} declarations, ${doc.edges.length} edges -> ${opts.out}`);
  } else {
    process.stdout.write(json);
  }
}
