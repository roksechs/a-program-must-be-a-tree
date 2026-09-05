#!/usr/bin/env node
// JavaScript / TypeScript analyzer.
//
// Walks a directory tree, parses every .js/.mjs/.cjs/.jsx/.ts/.tsx file with
// the TypeScript compiler API and emits a declaration graph document (see
// docs/DATA_FORMAT.md). Declarations are module-level functions, variables,
// classes (with their members), interfaces, type aliases and enums. An edge
// A -> B is emitted whenever the body of A references B; the edge kind tells
// whether it was a call, a plain reference, a heritage clause or a type-only use.
//
// Usage:
//   node analyzers/ts/analyze.mjs --name my-project --root path/to/project \
//        --include src lib --exclude "**/*.test.ts" --out graph.json
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { extname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

export const ANALYZER_VERSION = "0.1.0";
const EXTENSIONS = new Set([".js", ".mjs", ".cjs", ".jsx", ".ts", ".tsx", ".mts", ".cts"]);
const DEFAULT_EXCLUDES = ["node_modules", ".git", "dist", "build", "coverage", "vendor"];

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

function hasExportModifier(node) {
  const mods = ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined;
  return Boolean(mods?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword));
}

function isFunctionLike(node) {
  return (
    node &&
    (ts.isArrowFunction(node) || ts.isFunctionExpression(node) || ts.isClassExpression(node))
  );
}

/**
 * Collect the declarations of one source file. Returns entries of
 * { node, id, name, kind, parent, exported, bodyNodes } where bodyNodes are the
 * AST nodes to scan for references.
 */
function collectDeclarations(sf, file, baseName) {
  const decls = [];
  const add = (node, name, kind, parent, exported, bodyNodes, nameNode) => {
    const id = parent ? `${parent.id}.${name}` : `${file}::${name}`;
    const entry = { node, id, name, kind, parent: parent?.id ?? null, exported, bodyNodes, nameNode, line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1 };
    decls.push(entry);
    return entry;
  };

  const addClassMembers = (cls, parentEntry) => {
    for (const m of cls.members) {
      if (ts.isConstructorDeclaration(m)) {
        add(m, "constructor", "method", parentEntry, false, [m], null);
      } else if (ts.isMethodDeclaration(m) || ts.isGetAccessorDeclaration(m) || ts.isSetAccessorDeclaration(m)) {
        const name = memberName(m.name);
        if (name) add(m, name, "method", parentEntry, false, [m], m.name);
      } else if (ts.isPropertyDeclaration(m) && isFunctionLike(m.initializer)) {
        const name = memberName(m.name);
        if (name) add(m, name, "method", parentEntry, false, [m.initializer], m.name);
      } else {
        // Plain properties and static blocks are scanned as part of the class itself.
        parentEntry.bodyNodes.push(m);
      }
    }
  };

  for (const stmt of sf.statements) {
    if (ts.isFunctionDeclaration(stmt)) {
      const name = stmt.name?.text ?? "default";
      const display = stmt.name ? name : baseName;
      const e = add(stmt, name, "function", null, hasExportModifier(stmt), [stmt], stmt.name ?? null);
      e.displayName = display;
    } else if (ts.isClassDeclaration(stmt)) {
      const name = stmt.name?.text ?? "default";
      const e = add(stmt, name, "class", null, hasExportModifier(stmt), [], stmt.name ?? null);
      e.displayName = stmt.name ? name : baseName;
      if (stmt.heritageClauses) e.bodyNodes.push(...stmt.heritageClauses);
      addClassMembers(stmt, e);
    } else if (ts.isVariableStatement(stmt)) {
      for (const d of stmt.declarationList.declarations) {
        if (!ts.isIdentifier(d.name)) continue; // destructuring patterns are skipped
        const init = d.initializer;
        const kind = init && (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) ? "function" : init && ts.isClassExpression(init) ? "class" : "variable";
        const e = add(d, d.name.text, kind, null, hasExportModifier(stmt), init ? [init] : [], d.name);
        if (init && ts.isClassExpression(init)) addClassMembers(init, e);
      }
    } else if (ts.isInterfaceDeclaration(stmt)) {
      add(stmt, stmt.name.text, "interface", null, hasExportModifier(stmt), [stmt], stmt.name);
    } else if (ts.isTypeAliasDeclaration(stmt)) {
      add(stmt, stmt.name.text, "type", null, hasExportModifier(stmt), [stmt], stmt.name);
    } else if (ts.isEnumDeclaration(stmt)) {
      add(stmt, stmt.name.text, "enum", null, hasExportModifier(stmt), [stmt], stmt.name);
    } else if (ts.isExportAssignment(stmt) && isFunctionLike(stmt.expression)) {
      // export default () => {} / export default function () {} / export default class {}
      const kind = ts.isClassExpression(stmt.expression) ? "class" : "function";
      const e = add(stmt, "default", kind, null, true, [stmt.expression], null);
      e.displayName = baseName;
      if (ts.isClassExpression(stmt.expression)) addClassMembers(stmt.expression, e);
    }
  }
  return decls;
}

function memberName(nameNode) {
  if (!nameNode) return null;
  if (ts.isIdentifier(nameNode) || ts.isStringLiteral(nameNode) || ts.isNumericLiteral(nameNode) || ts.isPrivateIdentifier(nameNode)) return nameNode.text;
  if (ts.isComputedPropertyName(nameNode)) return `[${nameNode.expression.getText()}]`;
  return null;
}

/** Classify how an identifier is used. */
function referenceKind(node) {
  const parent = node.parent;
  if (!parent) return "reference";
  if ((ts.isCallExpression(parent) || ts.isNewExpression(parent)) && parent.expression === node) return "call";
  if (ts.isPropertyAccessExpression(parent) && parent.name === node) {
    const gp = parent.parent;
    if ((ts.isCallExpression(gp) || ts.isNewExpression(gp)) && gp.expression === parent) return "call";
  }
  if (ts.isExpressionWithTypeArguments(parent) || (ts.isPropertyAccessExpression(parent) && ts.isExpressionWithTypeArguments(parent.parent))) {
    const clause = ts.findAncestor(parent, ts.isHeritageClause);
    if (clause) return clause.token === ts.SyntaxKind.ExtendsKeyword ? "extends" : "implements";
  }
  if (ts.isTypeReferenceNode(parent) || ts.isTypeQueryNode(parent) || ts.findAncestor(node, ts.isTypeNode)) return "type";
  return "reference";
}

/**
 * Analyze a project.
 * @param {object} options { name, root, include: string[], exclude: string[], language }
 */
export function analyze(options) {
  const root = resolve(options.root ?? ".");
  const includes = (options.include?.length ? options.include : ["."]).map((p) => resolve(root, p));
  const excludes = options.exclude ?? [];
  const files = [...new Set(includes.flatMap((p) => listSourceFiles(p, excludes)))].sort();

  const program = ts.createProgram(files, {
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
  });
  const checker = program.getTypeChecker();
  const fileSet = new Set(files);

  // Pass 1: declarations.
  const declByNode = new Map();
  const declarations = [];
  for (const sf of program.getSourceFiles()) {
    if (!fileSet.has(sf.fileName)) continue;
    const file = relative(root, sf.fileName).split(sep).join("/");
    const baseName = file.split("/").pop().replace(/\.[^.]+$/, "");
    for (const d of collectDeclarations(sf, file, baseName)) {
      d.file = file;
      declByNode.set(d.node, d);
      declarations.push(d);
    }
  }

  /** Find the declaration entry that owns an AST node (nearest declared ancestor). */
  const ownerOf = (node) => {
    let n = node;
    while (n) {
      const d = declByNode.get(n);
      if (d) return d;
      n = n.parent;
    }
    return null;
  };

  /** Resolve an identifier to the declaration entry it refers to, if any. */
  const resolveTarget = (ident) => {
    let symbol;
    try {
      symbol = checker.getSymbolAtLocation(ident);
    } catch {
      return null;
    }
    if (!symbol) return null;
    if (symbol.flags & ts.SymbolFlags.Alias) {
      try {
        symbol = checker.getAliasedSymbol(symbol);
      } catch {
        return null;
      }
    }
    for (const decl of symbol.declarations ?? []) {
      const owner = ownerOf(decl);
      if (owner) {
        // Only accept the owner if the symbol's declaration *is* that owner (or its name / a
        // member of it). Locals declared inside a function body resolve to nothing.
        if (owner.node === decl || owner.nameNode === decl || (ts.isVariableDeclaration(decl) && owner.node === decl)) return owner;
        if (decl.parent && declByNode.get(decl.parent) === owner) return owner;
      }
    }
    return null;
  };

  // Pass 2: references.
  const edges = new Map();
  const addEdge = (source, target, kind) => {
    const key = `${source.id} ${target.id} ${kind}`;
    const e = edges.get(key);
    if (e) e.count++;
    else edges.set(key, { source: source.id, target: target.id, kind, count: 1 });
  };

  for (const d of declarations) {
    const visit = (node) => {
      if (ts.isIdentifier(node) || ts.isPrivateIdentifier(node)) {
        if (node !== d.nameNode) {
          // Skip identifiers that merely name a property being declared or a local binding.
          const p = node.parent;
          const declaresBinding =
            (ts.isVariableDeclaration(p) || ts.isParameter(p) || ts.isBindingElement(p) || ts.isFunctionDeclaration(p) || ts.isClassDeclaration(p) || ts.isMethodDeclaration(p) || ts.isPropertyDeclaration(p) || ts.isPropertyAssignment(p) || ts.isImportSpecifier(p) || ts.isImportClause(p)) &&
            p.name === node;
          if (!declaresBinding) {
            const target = resolveTarget(node);
            if (target && target !== d) addEdge(d, target, referenceKind(node));
            else if (target === d && referenceKind(node) === "call") addEdge(d, target, "call");
          }
        }
      }
      // Do not descend into nested declarations that are declarations of their own (class members).
      ts.forEachChild(node, (child) => {
        const nested = declByNode.get(child);
        if (nested && nested !== d) return;
        visit(child);
      });
    };
    for (const body of d.bodyNodes) visit(body);
  }

  return {
    meta: {
      name: options.name ?? "project",
      root: relative(process.cwd(), root).split(sep).join("/") || ".",
      language: options.language ?? "typescript",
      generatedAt: new Date().toISOString(),
      analyzer: `analyzers/ts@${ANALYZER_VERSION}`,
      files: files.length,
    },
    declarations: declarations
      .map((d) => ({ id: d.id, name: d.displayName ?? d.name, kind: d.kind, file: d.file, line: d.line, parent: d.parent, exported: d.exported }))
      .sort((a, b) => a.id.localeCompare(b.id)),
    edges: [...edges.values()].sort((a, b) => a.source.localeCompare(b.source) || a.target.localeCompare(b.target) || a.kind.localeCompare(b.kind)),
  };
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
      case "--include":
        while (argv[i + 1] && !argv[i + 1].startsWith("--")) opts.include.push(next());
        break;
      case "--exclude":
        while (argv[i + 1] && !argv[i + 1].startsWith("--")) opts.exclude.push(next());
        break;
      case "--help":
      case "-h":
        console.log(readFileSync(fileURLToPath(import.meta.url), "utf8").split("\n").slice(1, 14).map((l) => l.replace(/^\/\/ ?/, "")).join("\n"));
        process.exit(0);
        break;
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
