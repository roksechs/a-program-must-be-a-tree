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
  const rest = []; // top-level statements that are not declarations: the module's own code
  const add = (node, name, kind, parent, exported, bodyNodes, nameNode) => {
    const id = parent ? `${parent.id}.${name}` : `${file}::${name}`;
    const entry = { node, id, name, kind, parent: parent?.id ?? null, exported, bodyNodes, nameNode, line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1 };
    decls.push(entry);
    return entry;
  };

  const addClassMembers = (cls, parentEntry) => {
    parentEntry.classNode = cls;
    for (const m of cls.members) {
      const isStatic = Boolean(ts.getCombinedModifierFlags(m) & ts.ModifierFlags.Static);
      if (ts.isConstructorDeclaration(m)) {
        add(m, "constructor", "method", parentEntry, false, [m], null);
      } else if (ts.isMethodDeclaration(m) || ts.isGetAccessorDeclaration(m) || ts.isSetAccessorDeclaration(m)) {
        const name = memberName(m.name);
        if (name) add(m, name, "method", parentEntry, false, [m], m.name).isStatic = isStatic;
      } else if (ts.isPropertyDeclaration(m) && isFunctionLike(m.initializer)) {
        const name = memberName(m.name);
        if (name) add(m, name, "method", parentEntry, false, [m.initializer], m.name).isStatic = isStatic;
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
    } else if (!ts.isImportDeclaration(stmt) && !ts.isExportDeclaration(stmt) && !ts.isEmptyStatement(stmt) && !ts.isModuleDeclaration(stmt)) {
      // Expression statements, control flow, `export default <expr>`, destructuring
      // declarations: code the module runs when it is loaded.
      rest.push(stmt);
    }
  }
  if (rest.length > 0) {
    // One node per file for its top-level code (docs/THEORY.md §4: every
    // occurrence here is definition-time). The source file is its AST node.
    const e = add(sf, "<module>", "module", null, false, rest, null);
    e.displayName = baseName;
    e.line = sf.getLineAndCharacterOfPosition(rest[0].getStart(sf)).line + 1;
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
  if (ts.isNewExpression(parent) && parent.expression === node) return "create";
  if (ts.isCallExpression(parent) && parent.expression === node) return "call";
  if (ts.isPropertyAccessExpression(parent) && parent.name === node) {
    const gp = parent.parent;
    if (ts.isNewExpression(gp) && gp.expression === parent) return "create";
    if (ts.isCallExpression(gp) && gp.expression === parent) return "call";
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

  /** Symbol of a node, with import aliases resolved. */
  const symbolOf = (node) => {
    let symbol;
    try {
      // `{ select }` names the property; the value it carries is the binding `select`.
      symbol =
        node.parent && ts.isShorthandPropertyAssignment(node.parent) && node.parent.name === node
          ? checker.getShorthandAssignmentValueSymbol(node.parent)
          : checker.getSymbolAtLocation(node);
    } catch {
      return null;
    }
    if (symbol && symbol.flags & ts.SymbolFlags.Alias) {
      try {
        symbol = checker.getAliasedSymbol(symbol);
      } catch {
        return null;
      }
    }
    return symbol ?? null;
  };

  /** Resolve an identifier (or `super`) to the declaration entry it refers to, if any. */
  const resolveTarget = (node) => {
    const symbol = symbolOf(node);
    if (!symbol) return null;
    for (const decl of symbol.declarations ?? []) {
      const owner = ownerOf(decl);
      if (owner) {
        // Only accept the owner if the symbol's declaration *is* that owner (or its name / a
        // member of it). Locals declared inside a function body resolve to nothing.
        if (owner.node === decl || owner.nameNode === decl) return owner;
        // Members of interfaces and enums resolve to the interface / enum itself.
        if ((ts.isTypeElement(decl) || ts.isEnumMember(decl)) && declByNode.get(decl.parent) === owner) return owner;
      }
    }
    return null;
  };

  // ---------------------------------------------------------------------------
  // Class hierarchy: constructor lookup, dispatch (class hierarchy analysis)
  // and the structural override / implements edges. See docs/THEORY.md §3.4, §5.
  const membersOf = new Map(); // class or interface id -> Map(member name -> entry)
  for (const d of declarations) {
    if (!d.parent) continue;
    if (!membersOf.has(d.parent)) membersOf.set(d.parent, new Map());
    membersOf.get(d.parent).set(d.name, d);
  }
  const heritageName = (expr) => (ts.isPropertyAccessExpression(expr) ? expr.name : expr);
  const baseOf = new Map(); // class id -> base class entry
  const interfacesOf = new Map(); // class or interface id -> interface entries it implements / extends
  for (const d of declarations) {
    const node = d.kind === "class" ? d.classNode : d.kind === "interface" ? d.node : null;
    if (!node) continue;
    for (const clause of node.heritageClauses ?? []) {
      for (const t of clause.types) {
        const target = resolveTarget(heritageName(t.expression));
        if (!target) continue;
        if (clause.token === ts.SyntaxKind.ExtendsKeyword && d.kind === "class") baseOf.set(d.id, target);
        else {
          if (!interfacesOf.has(d.id)) interfacesOf.set(d.id, []);
          interfacesOf.get(d.id).push(target);
        }
      }
    }
  }
  const children = new Map(); // id -> entries that extend or implement it
  const link = (parentId, child) => {
    if (!children.has(parentId)) children.set(parentId, []);
    children.get(parentId).push(child);
  };
  for (const [id, base] of baseOf) link(base.id, declarations.find((d) => d.id === id));
  for (const [id, ifaces] of interfacesOf) for (const i of ifaces) link(i.id, declarations.find((d) => d.id === id));
  const descendants = (entry) => {
    const out = [];
    const seen = new Set([entry.id]);
    const stack = [entry];
    while (stack.length) {
      for (const c of children.get(stack.pop().id) ?? []) {
        if (seen.has(c.id)) continue;
        seen.add(c.id);
        out.push(c);
        stack.push(c);
      }
    }
    return out;
  };
  /** Constructor that `new C()` runs: C's own, else the nearest ancestor's, else the class itself. */
  const constructorTarget = (classEntry) => {
    if (!classEntry || classEntry.kind !== "class") return classEntry;
    let c = classEntry;
    const seen = new Set();
    while (c && !seen.has(c.id)) {
      seen.add(c.id);
      const ctor = membersOf.get(c.id)?.get("constructor");
      if (ctor) return ctor;
      c = baseOf.get(c.id);
    }
    return classEntry;
  };
  /** Nearest ancestor class or interface (via extends only) that declares `name`. */
  const inheritedMember = (classEntry, name) => {
    let c = baseOf.get(classEntry.id);
    const seen = new Set();
    while (c && !seen.has(c.id)) {
      seen.add(c.id);
      const m = membersOf.get(c.id)?.get(name);
      if (m) return m;
      c = baseOf.get(c.id);
    }
    return null;
  };
  /** Interfaces implemented by a class, including those of its ancestors and interface extension. */
  const allInterfaces = (entry) => {
    const out = [];
    const seen = new Set();
    const stack = [entry];
    while (stack.length) {
      const e = stack.pop();
      if (seen.has(e.id)) continue;
      seen.add(e.id);
      for (const i of interfacesOf.get(e.id) ?? []) {
        out.push(i);
        stack.push(i);
      }
      const b = baseOf.get(e.id);
      if (b) stack.push(b);
    }
    return out;
  };
  /**
   * Dispatch targets of a non-static member call: the resolved member plus every
   * overriding member in a subclass (or implementing class of an interface).
   */
  const dispatchTargets = (member) => {
    const out = [];
    const owner = declarations.find((d) => d.id === member.parent);
    if (!owner) return out;
    for (const sub of descendants(owner)) {
      const m = membersOf.get(sub.id)?.get(member.name);
      if (m && m !== member) out.push(m);
    }
    return out;
  };
  const isNewTarget = (node) => {
    const p = node.parent;
    if (ts.isNewExpression(p) && p.expression === node) return true;
    return ts.isPropertyAccessExpression(p) && p.name === node && ts.isNewExpression(p.parent) && p.parent.expression === p;
  };
  /** `o.m(...)` where the receiver is not `super`: the call is dispatched dynamically. */
  const isDispatchedCall = (node) => {
    const p = node.parent;
    return ts.isPropertyAccessExpression(p) && p.name === node && ts.isCallExpression(p.parent) && p.parent.expression === p && p.expression.kind !== ts.SyntaxKind.SuperKeyword;
  };

  // ---------------------------------------------------------------------------
  // Edges. `time` is "definition" when the occurrence is evaluated while the
  // module initialises, "use" when it runs inside a function or method body.
  const edges = new Map();
  const addEdge = (source, target, kind, time, inferred = false) => {
    const key = `${source.id} ${target.id} ${kind} ${time}`;
    const e = edges.get(key);
    if (e) {
      if (!inferred) e.count++;
    } else {
      const edge = { source: source.id, target: target.id, kind, count: 1, time };
      if (inferred) edge.inferred = true;
      edges.set(key, edge);
    }
  };
  // Structural edges: overriding and interface implementation at member level.
  for (const d of declarations) {
    if (!d.parent || d.name === "constructor") continue;
    const owner = declarations.find((x) => x.id === d.parent);
    if (!owner || owner.kind !== "class") continue;
    const base = inheritedMember(owner, d.name);
    if (base) addEdge(d, base, "override", "definition");
    for (const iface of allInterfaces(owner)) {
      const m = membersOf.get(iface.id)?.get(d.name);
      if (m) addEdge(d, m, "implements", "definition");
    }
  }

  // Pass 2: syntactic references (docs/THEORY.md §3, definitions 4-6).
  const callSites = []; // { owner, node, time } for the flow analysis below
  for (const d of declarations) {
    const visit = (node, inFn) => {
      const time = inFn ? "use" : "definition";
      if (node.kind === ts.SyntaxKind.SuperKeyword && ts.isCallExpression(node.parent) && node.parent.expression === node) {
        // super(...) inside a derived constructor calls the base class constructor.
        const target = constructorTarget(resolveTarget(node));
        if (target && target !== d) addEdge(d, target, "call", time);
      } else if (ts.isIdentifier(node) || ts.isPrivateIdentifier(node)) {
        if (node !== d.nameNode) {
          // Skip identifiers that merely name a property being declared or a local binding.
          const p = node.parent;
          const declaresBinding =
            (ts.isVariableDeclaration(p) || ts.isParameter(p) || ts.isBindingElement(p) || ts.isFunctionDeclaration(p) || ts.isClassDeclaration(p) || ts.isMethodDeclaration(p) || ts.isPropertyDeclaration(p) || ts.isPropertyAssignment(p) || ts.isImportSpecifier(p) || ts.isImportClause(p)) &&
            p.name === node;
          if (!declaresBinding) {
            let target = resolveTarget(node);
            let kind = referenceKind(node);
            if (target && isNewTarget(node)) target = constructorTarget(target);
            if (target && kind === "call" && target.kind === "interface") {
              // A call through an interface member: the interface is a type-level
              // dependency; the implementations are the control targets.
              addEdge(d, target, "type", time);
              for (const impl of dispatchTargets({ parent: target.id, name: node.text })) if (impl !== d) addEdge(d, impl, "call", time, true);
              target = null;
            }
            if (target && target !== d) addEdge(d, target, kind, time);
            else if (target === d && (kind === "call" || kind === "create")) addEdge(d, target, kind, time);
            if (target && kind === "call" && target.kind === "method" && !target.isStatic && isDispatchedCall(node)) {
              for (const impl of dispatchTargets(target)) if (impl !== d) addEdge(d, impl, "call", time, true);
            }
          }
        }
      }
      if (ts.isCallExpression(node) || ts.isNewExpression(node)) callSites.push({ owner: d, node, time });
      const childInFn = inFn || ts.isFunctionLike(node) || (ts.isPropertyDeclaration(node) && !(ts.getCombinedModifierFlags(node) & ts.ModifierFlags.Static));
      // Do not descend into nested declarations that are declarations of their own (class members).
      ts.forEachChild(node, (child) => {
        const nested = declByNode.get(child);
        if (nested && nested !== d) return;
        visit(child, childInFn);
      });
    };
    for (const body of d.bodyNodes) visit(body, false);
  }

  // ---------------------------------------------------------------------------
  // Pass 3: bounded 0-CFA (docs/THEORY.md §3.2). Abstract values are sets of
  // declared functions, methods and classes. Values flow through local
  // bindings, parameters of declared callees and return values of declared
  // functions; property stores and anonymous functions are not modelled, so a
  // callback handed to an external library stays a `reference`.
  const env = new Map(); // local symbol -> Set(entry)
  const returns = new Map(); // entry -> Set(entry)
  const varValues = new Map(); // variable entry -> Set(entry) (memoised)
  let changed = false;
  const union = (into, from) => {
    for (const v of from) {
      if (!into.has(v)) {
        into.add(v);
        changed = true;
      }
    }
  };
  const setFor = (map, key) => {
    let s = map.get(key);
    if (!s) map.set(key, (s = new Set()));
    return s;
  };
  const fnNodeOf = (e) => (e.bodyNodes.length === 1 && ts.isFunctionLike(e.bodyNodes[0]) ? e.bodyNodes[0] : null);
  const isCallable = (e) => e.kind === "function" || e.kind === "method";
  const evaluating = new Set();
  const evalExpr = (node) => {
    if (!node) return new Set();
    if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isTypeAssertionExpression(node) || ts.isNonNullExpression(node) || ts.isSatisfiesExpression?.(node)) return evalExpr(node.expression);
    if (ts.isIdentifier(node)) {
      const target = resolveTarget(node);
      if (target) {
        if (isCallable(target) || target.kind === "class") return new Set([target]);
        if (target.kind === "variable") return variableValues(target);
        return new Set();
      }
      const sym = symbolOf(node);
      return sym && env.has(sym) ? new Set(env.get(sym)) : new Set();
    }
    if (ts.isPropertyAccessExpression(node)) {
      const target = resolveTarget(node.name);
      return target && (isCallable(target) || target.kind === "class") ? new Set([target]) : new Set();
    }
    if (ts.isCallExpression(node)) {
      const out = new Set();
      for (const g of calleeValues(node)) if (isCallable(g)) for (const v of returns.get(g) ?? []) out.add(v);
      return out;
    }
    if (ts.isConditionalExpression(node)) return new Set([...evalExpr(node.whenTrue), ...evalExpr(node.whenFalse)]);
    if (ts.isBinaryExpression(node)) {
      const op = node.operatorToken.kind;
      if (op === ts.SyntaxKind.BarBarToken || op === ts.SyntaxKind.QuestionQuestionToken || op === ts.SyntaxKind.AmpersandAmpersandToken) return new Set([...evalExpr(node.left), ...evalExpr(node.right)]);
      if (op === ts.SyntaxKind.EqualsToken || op === ts.SyntaxKind.CommaToken) return evalExpr(node.right);
    }
    return new Set();
  };
  const variableValues = (entry) => {
    if (varValues.has(entry)) return new Set(varValues.get(entry));
    if (evaluating.has(entry)) return new Set();
    evaluating.add(entry);
    const values = evalExpr(entry.bodyNodes[0]);
    evaluating.delete(entry);
    varValues.set(entry, values);
    return new Set(values);
  };
  /** Callees of a call or `new`: syntactic targets, dispatch targets and flow-derived values. */
  const calleeValues = (call) => {
    const out = new Set();
    const callee = call.expression;
    if (ts.isNewExpression(call)) {
      for (const v of evalExpr(callee)) if (v.kind === "class") out.add(constructorTarget(v));
      return out;
    }
    if (callee.kind === ts.SyntaxKind.SuperKeyword) {
      const t = constructorTarget(resolveTarget(callee));
      if (t) out.add(t);
      return out;
    }
    for (const v of evalExpr(callee)) {
      if (v.kind === "class") continue;
      out.add(v);
      if (v.kind === "method" && !v.isStatic && ts.isPropertyAccessExpression(callee)) for (const impl of dispatchTargets(v)) out.add(impl);
    }
    return out;
  };
  const paramsOf = (entry) => {
    const fn = fnNodeOf(entry);
    return fn ? fn.parameters : [];
  };

  const flowPass = () => {
    for (const d of declarations) {
      const fn = fnNodeOf(d);
      const walk = (node) => {
        if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
          const sym = symbolOf(node.name);
          if (sym) union(setFor(env, sym), evalExpr(node.initializer));
        } else if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken && ts.isIdentifier(node.left)) {
          const sym = symbolOf(node.left);
          if (sym && !resolveTarget(node.left)) union(setFor(env, sym), evalExpr(node.right));
        } else if (ts.isReturnStatement(node) && node.expression && fn) {
          // Only returns of the declaration's own function body count; inner anonymous functions are not modelled.
          let a = node.parent;
          while (a && a !== fn && !ts.isFunctionLike(a)) a = a.parent;
          if (a === fn) union(setFor(returns, d), evalExpr(node.expression));
        } else if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
          const args = node.arguments ?? [];
          for (const g of calleeValues(node)) {
            const params = paramsOf(g);
            for (let i = 0; i < params.length && i < args.length; i++) {
              const p = params[i];
              if (!ts.isIdentifier(p.name) || p.dotDotDotToken) continue;
              const sym = symbolOf(p.name);
              if (sym) union(setFor(env, sym), evalExpr(args[i]));
            }
          }
        }
        ts.forEachChild(node, (child) => {
          const nested = declByNode.get(child);
          if (nested && nested !== d) return;
          walk(child);
        });
      };
      if (fn && ts.isArrowFunction(fn) && !ts.isBlock(fn.body)) union(setFor(returns, d), evalExpr(fn.body));
      for (const body of d.bodyNodes) walk(body);
    }
  };
  for (let i = 0; i < 50; i++) {
    changed = false;
    varValues.clear();
    flowPass();
    if (!changed) break;
  }
  // Emit the calls the flow analysis found on top of the syntactic ones.
  for (const { owner, node, time } of callSites) {
    for (const g of calleeValues(node)) {
      if (g === owner) continue;
      addEdge(owner, g, ts.isNewExpression(node) ? "create" : "call", time, true);
    }
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
