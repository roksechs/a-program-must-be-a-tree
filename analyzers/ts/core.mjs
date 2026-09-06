// The portable core of the JavaScript / TypeScript analyzer: everything that
// walks an already-built `ts.Program` and emits a declaration graph document
// (docs/DATA_FORMAT.md). This file touches nothing outside the `ts` module it
// is handed (no `node:fs`, `node:path`, `node:url`), so the exact same code
// runs the analysis from `analyze.mjs`'s Node CLI (a Program built over real
// files via `ts.sys`) and from the browser's local-folder feature
// (`site/js/localAnalyzer.js`, a Program built over an in-memory CompilerHost
// fed by the File System Access API) — one analyzer, two front ends.
export const ANALYZER_VERSION = "0.4.0";
export const EXTENSIONS = new Set([".js", ".mjs", ".cjs", ".jsx", ".ts", ".tsx", ".mts", ".cts"]);
export const DEFAULT_EXCLUDES = ["node_modules", ".git", "dist", "build", "coverage", "vendor"];

/**
 * `fileName` with `root` stripped off the front, forward-slash separated. A
 * plain prefix strip rather than a real path-relativizing library call: the
 * two front ends already agree on the separator (`ts` normalizes every
 * `SourceFile.fileName` to forward slashes internally, on every platform),
 * so nothing here needs `node:path`.
 */
export function stripRoot(root, fileName) {
  let f = fileName;
  if (root && f.startsWith(root)) f = f.slice(root.length);
  if (f.startsWith("/")) f = f.slice(1);
  return f;
}

/**
 * Build the analyzer's functions against one `ts` module instance — the
 * `typescript` package in Node, the vendored `site/vendor/typescript.js`
 * global in the browser. Everything below closes over that single `ts`.
 */
export function createCore(ts) {
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

  /** The expression inside any parentheses. */
  function unwrap(e) {
    while (e && ts.isParenthesizedExpression(e)) e = e.expression;
    return e;
  }

  /** `a`, `a.b`, `a.b.c`: a path of names (docs/THEORY.md §4.1). */
  function isPathExpr(e) {
    return ts.isIdentifier(e) || (ts.isPropertyAccessExpression(e) && isPathExpr(e.expression));
  }

  /**
   * Collect the declarations written as such in one source file. Returns
   * { decls, rest, assignments, add, addClassMembers, sf, file, baseName }: `decls`
   * are entries of { node, id, name, kind, parent, exported, bodyNodes } where
   * bodyNodes are the AST nodes to scan for references, `rest` the top-level
   * statements that are the module's own code, and `assignments` the top-level
   * property assignments that may turn out to be declarations once every file is
   * known (docs/THEORY.md §4-5); `add` declares more entries in this file.
   */
  function collectDeclarations(sf, file, baseName) {
    const decls = [];
    const rest = []; // top-level statements that are not declarations: the module's own code
    const assignments = []; // `a.b = v` / `Object.assign(a.b, {...})` at top level
    const add = (node, name, kind, parent, exported, bodyNodes, nameNode, sep = ".") => {
      const id = parent ? `${parent.id}${sep}${name}` : `${file}::${name}`;
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
          if (!ts.isIdentifier(d.name)) {
            // A destructuring pattern (`const { a } = f()`) names no single
            // declaration, but its initializer still runs when the module
            // loads: module code, same as a bare expression statement.
            if (d.initializer) rest.push(d.initializer);
            continue;
          }
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
      } else if (topLevelAssignment(stmt)) {
        // `ns.f = function`, `C.prototype.m = f`, `Object.assign(C.prototype, {...})`:
        // a definition-time binding through a path of names (docs/THEORY.md §4-5).
        // The receiver may live in another file, so these are resolved once every
        // file has been read; whatever never resolves is module code.
        assignments.push(topLevelAssignment(stmt));
      } else if (!ts.isImportDeclaration(stmt) && !ts.isExportDeclaration(stmt) && !ts.isEmptyStatement(stmt) && !ts.isModuleDeclaration(stmt)) {
        // Expression statements, control flow, `export default <expr>`, destructuring
        // declarations: code the module runs when it is loaded.
        rest.push(stmt);
      }
    }
    return { decls, rest, assignments, add, addClassMembers, sf, file, baseName };
  }

  /**
   * A top-level statement that binds a value to a property path: `a.b.c = v`
   * (chains `a.b = c.d = v` bind the outermost path to the final value) or
   * `Object.assign(a.b, {...})`. Returns { stmt, target, value, spread } with
   * `target` the assigned property access (the receiver, for Object.assign) and
   * `value` the right-hand side; null for any other statement.
   */
  function topLevelAssignment(stmt) {
    if (!ts.isExpressionStatement(stmt)) return null;
    const e = stmt.expression;
    if (ts.isBinaryExpression(e) && e.operatorToken.kind === ts.SyntaxKind.EqualsToken && ts.isPropertyAccessExpression(e.left)) {
      let value = e.right;
      while (ts.isBinaryExpression(value) && value.operatorToken.kind === ts.SyntaxKind.EqualsToken) value = value.right;
      return { stmt, target: e.left, value, spread: false };
    }
    if (
      ts.isCallExpression(e) &&
      ts.isPropertyAccessExpression(e.expression) &&
      ts.isIdentifier(e.expression.expression) &&
      e.expression.expression.text === "Object" &&
      e.expression.name.text === "assign" &&
      e.arguments.length === 2 &&
      ts.isObjectLiteralExpression(e.arguments[1])
    ) {
      return { stmt, target: e.arguments[0], value: e.arguments[1], spread: true };
    }
    return null;
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

  // Assignment operators, plain (`=`) and compound (`+=`, `-=`, ...): docs/THEORY.md §3.5.
  const COMPOUND_ASSIGN_OPS = new Set([
    ts.SyntaxKind.PlusEqualsToken,
    ts.SyntaxKind.MinusEqualsToken,
    ts.SyntaxKind.AsteriskEqualsToken,
    ts.SyntaxKind.SlashEqualsToken,
    ts.SyntaxKind.PercentEqualsToken,
    ts.SyntaxKind.AsteriskAsteriskEqualsToken,
    ts.SyntaxKind.LessThanLessThanEqualsToken,
    ts.SyntaxKind.GreaterThanGreaterThanEqualsToken,
    ts.SyntaxKind.GreaterThanGreaterThanGreaterThanEqualsToken,
    ts.SyntaxKind.AmpersandEqualsToken,
    ts.SyntaxKind.BarEqualsToken,
    ts.SyntaxKind.CaretEqualsToken,
    ts.SyntaxKind.AmpersandAmpersandEqualsToken,
    ts.SyntaxKind.BarBarEqualsToken,
    ts.SyntaxKind.QuestionQuestionEqualsToken,
  ]);

  /**
   * Is `node` the target of an assignment (docs/THEORY.md §3.5, Definition 5a)?
   * Plain `x = e` only writes; compound assignment and `++`/`--` read the old
   * value too, since `x ⊕= e` is `x = x ⊕ e`.
   */
  function writeInfo(node) {
    const p = node.parent;
    if (ts.isBinaryExpression(p) && p.left === node) {
      if (p.operatorToken.kind === ts.SyntaxKind.EqualsToken) return { write: true, alsoRead: false };
      if (COMPOUND_ASSIGN_OPS.has(p.operatorToken.kind)) return { write: true, alsoRead: true };
    }
    if (
      (ts.isPrefixUnaryExpression(p) || ts.isPostfixUnaryExpression(p)) &&
      p.operand === node &&
      (p.operator === ts.SyntaxKind.PlusPlusToken || p.operator === ts.SyntaxKind.MinusMinusToken)
    ) {
      return { write: true, alsoRead: true };
    }
    return { write: false, alsoRead: true };
  }

  /**
   * Analyze an already-built `ts.Program`.
   * @param {object} args
   * @param {import("typescript").Program} args.program a Program covering (at least) `files`
   * @param {string[]} args.files the file names (as `ts.SourceFile.fileName` reports them) to analyze; the program may contain more (imported dependencies)
   * @param {string} args.stripPrefix stripped off the front of each file name to produce its `file` field (see `stripRoot`)
   * @param {string} args.rootLabel the document's `meta.root`
   * @param {object} args.options { name, language, nested: boolean (local functions as declarations, ids `<parent>/<name>`) }
   */
  function analyzeProgram({ program, files, stripPrefix, rootLabel, options }) {
    const checker = program.getTypeChecker();
    const fileSet = new Set(files);

    // Pass 1: declarations written as such.
    const declByNode = new Map();
    const declarations = [];
    const entryById = new Map();
    const fileCtx = []; // per file: module code, pending property assignments, `add`
    for (const sf of program.getSourceFiles()) {
      if (!fileSet.has(sf.fileName)) continue;
      const file = stripRoot(stripPrefix, sf.fileName);
      const baseName = file.split("/").pop().replace(/\.[^.]+$/, "");
      const ctx = collectDeclarations(sf, file, baseName);
      fileCtx.push(ctx);
      for (const d of ctx.decls) {
        d.file = file;
        declByNode.set(d.node, d);
        declarations.push(d);
        entryById.set(d.id, d);
      }
    }
    const ctxOf = new Map(fileCtx.map((c) => [c.file, c]));

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

    /**
     * `map[key].m(...)`: indexing an object with a key that is not a literal can
     * yield any of the object's property types, so `m` can be a member of any of
     * them. The checker gives up on such an access, so the candidates are
     * collected by hand (class hierarchy analysis over a record, docs/THEORY.md
     * §3.2).
     */
    const recordMembers = (node) => {
      const access = node.parent;
      if (!access || !ts.isPropertyAccessExpression(access) || access.name !== node) return [];
      const object = access.expression;
      if (!ts.isElementAccessExpression(object) || ts.isStringLiteralLike(object.argumentExpression)) return [];
      const out = [];
      try {
        const record = checker.getTypeAtLocation(object.expression);
        for (const prop of checker.getPropertiesOfType(record ?? {}) ?? []) {
          const at = prop.valueDeclaration ?? prop.declarations?.[0];
          if (!at) continue;
          const valueType = checker.getTypeOfSymbolAtLocation(prop, at);
          for (const constituent of valueType?.isUnion?.() ? valueType.types : [valueType]) {
            for (const decl of constituent?.getProperty?.(node.text)?.declarations ?? []) {
              const owner = ownerOf(decl);
              if (owner && (owner.node === decl || owner.nameNode === decl) && !out.includes(owner)) out.push(owner);
            }
          }
        }
      } catch {
        return [];
      }
      return out;
    };

    /**
     * Resolve an identifier (or `super`) to the declaration entries it can refer
     * to. A symbol usually has one declaration, but a member accessed through a
     * union type (`(Graph2D | Graph3D).setGraph`) or through a record indexed at
     * run time has one per constituent, and any of them can be the one that runs.
     */
    const resolveTargets = (node) => {
      const out = [];
      for (const decl of symbolOf(node)?.declarations ?? []) {
        const owner = ownerOf(decl);
        if (!owner || out.includes(owner)) continue;
        // Only accept the owner if the symbol's declaration *is* that owner (or its name / a
        // member of it). Locals declared inside a function body resolve to nothing.
        if (owner.node === decl || owner.nameNode === decl) out.push(owner);
        // Members of interfaces and enums resolve to the interface / enum itself.
        else if ((ts.isTypeElement(decl) || ts.isEnumMember(decl)) && declByNode.get(decl.parent) === owner) out.push(owner);
      }
      return out.length > 0 ? out : recordMembers(node);
    };

    // ---------------------------------------------------------------------------
    // Pass 1b: bindings made by assignment (docs/THEORY.md §4-5). A definition-time
    // assignment through a path of names binds a name other code can use, so it
    // declares: `ns.f = function` a static member, `C.prototype.m = function` an
    // instance member, `C.prototype.m = f` an alias (`f` gains the member role, no
    // new node, like an import), `exports.f = ...` an export, any other value a
    // variable. The receiver may be declared in another file or be an undeclared
    // global such as `d3` (the binding then keeps its qualified name and has no
    // parent), so the pending statements are resolved to a fixpoint over all
    // files; whatever never resolves is module code.
    const membersOf = new Map(); // class, namespace or interface id -> Map(slot name -> entry)
    const registerMember = (parentId, slot, entry) => {
      if (!membersOf.has(parentId)) membersOf.set(parentId, new Map());
      if (!membersOf.get(parentId).has(slot)) membersOf.get(parentId).set(slot, entry);
    };
    const slotName = (d) => d.memberName ?? d.name;
    for (const d of declarations) if (d.parent) registerMember(d.parent, d.name, d);
    /** Make an entry created after pass 1 a declaration of the document. */
    const attach = (ctx, e) => {
      e.file = ctx.file;
      declByNode.set(e.node, e);
      declarations.push(e);
      entryById.set(e.id, e);
      if (e.parent && !e.local) registerMember(e.parent, e.name, e);
      return e;
    };
    /** Attach the members `ctx.addClassMembers` declared for a class found after pass 1. */
    const attachNew = (ctx) => {
      for (const d of ctx.decls) if (!declByNode.has(d.node)) attach(ctx, d);
    };
    const globals = new Map(); // qualified name bound on an undeclared global ("d3.scale") -> entry
    const consumed = new Set(); // identifiers that name an alias target: not occurrences
    /**
     * What an expression denotes when it is a name (docs/THEORY.md §4.1): the one
     * resolver of the analyzer. `entry` is the declared class, function or
     * variable (null for an undeclared global, whose qualified `path` is kept);
     * `viaPrototype` marks `X.prototype`, `moduleNs` marks `exports` /
     * `module.exports`, `typed` a member the checker found through the receiver's
     * static type rather than by name. Identifiers and `super` go through the
     * checker; a variable initialised with a path (`var proto = C.prototype`)
     * denotes what the path denotes; a local or a parameter denotes a value, not
     * a name: null.
     */
    const denote = (expr, depth = 0) => {
      expr = unwrap(expr);
      if (!expr || depth > 8) return null;
      if (expr.kind === ts.SyntaxKind.SuperKeyword) {
        const t = resolveTargets(expr)[0] ?? null;
        return t ? { entry: t, path: "super" } : null;
      }
      if (ts.isIdentifier(expr)) {
        const target = resolveTargets(expr)[0] ?? null;
        if (target) {
          if (target.kind === "variable" && ts.isVariableDeclaration(target.node) && target.node.initializer) {
            let init = unwrap(target.node.initializer);
            if (ts.isBinaryExpression(init) && init.operatorToken.kind === ts.SyntaxKind.EqualsToken) init = init.left;
            if (isPathExpr(init) && !(ts.isIdentifier(init) && init.text === expr.text)) {
              const r = denote(init, depth + 1);
              if (r) return r;
            }
          }
          return { entry: target, path: target.qualified ?? target.name };
        }
        // CommonJS: TypeScript gives `exports` a symbol of its own in JavaScript files.
        if (expr.text === "exports") return { entry: null, moduleNs: true, path: "exports" };
        // In JavaScript files TypeScript also invents a symbol for an undeclared
        // global that has properties assigned to it (`d3.scale = {}`); its
        // "declarations" are the identifier occurrences themselves, not bindings.
        const sym = symbolOf(expr);
        const bound = sym?.declarations?.some((decl) => !ts.isIdentifier(decl) && !ts.isPropertyAccessExpression(decl) && !ts.isBinaryExpression(decl) && !ts.isExpressionStatement(decl));
        if (bound) return null;
        return { entry: globals.get(expr.text) ?? null, global: true, path: expr.text };
      }
      if (ts.isPropertyAccessExpression(expr)) {
        const name = expr.name.text;
        if (name === "exports" && ts.isIdentifier(expr.expression) && expr.expression.text === "module" && resolveTargets(expr.expression).length === 0) return { entry: null, moduleNs: true, path: "module.exports" };
        const r = denote(expr.expression, depth + 1);
        if (r?.moduleNs) {
          const file = stripRoot(stripPrefix, expr.getSourceFile().fileName);
          const e = entryById.get(`${file}::${name}`);
          return e ? { entry: e, path: name } : null;
        }
        if (r) {
          const path = `${r.path}.${name}`;
          if (name === "prototype" && !r.viaPrototype) return { entry: r.entry, global: r.global, viaPrototype: true, path };
          const member = r.entry ? membersOf.get(r.entry.id)?.get(name) : null;
          if (member) return { entry: member, path };
          if (r.global && !r.viaPrototype) return { entry: globals.get(path) ?? null, global: true, path };
        }
        // Not a path of names, or a name nothing was bound to: the member the
        // checker finds through the receiver's static type, if any.
        const t = resolveTargets(expr.name)[0] ?? null;
        return t ? { entry: t, path: t.name, typed: true } : null;
      }
      return null;
    };
    /**
     * Bind `value` to slot `slot` of `owner` (null: a top-level or global binding
     * named `qualified`). Returns the entry that now answers to the slot, or null
     * when nothing was bound: a re-binding of an existing name (the first binding
     * is the declaration, later ones are code), or a use-time value that is not a
     * function (a store).
     */
    const bindSlot = (ctx, owner, slot, value, nameNode, { viaPrototype = false, qualified = null, late = false, exported = false } = {}) => {
      value = unwrap(value);
      const name = owner ? slot : qualified ?? slot;
      const id = owner ? `${owner.id}.${slot}` : `${ctx.file}::${name}`;
      const record = (e) => {
        e.isStatic = !viaPrototype;
        if (late) e.late = true;
        if (!owner) e.qualified = name;
        attach(ctx, e);
        if (owner) registerMember(owner.id, slot, e);
        else if (qualified) globals.set(qualified, e);
        return e;
      };
      if (isPathExpr(value)) {
        const t = denote(value)?.entry ?? null;
        if (t && (t.kind === "function" || t.kind === "class" || t.kind === "method")) {
          if (late) return null;
          // `proto.add = add`: an alias. The function gains the member role; no new node.
          if (t.parent == null && owner) {
            t.parent = owner.id;
            t.memberName = slot;
            t.isStatic = !viaPrototype;
          }
          (t.aliases ??= []).push(owner ? `${owner.qualified ?? owner.name}.${slot}` : name);
          if (exported && !owner) t.exported = true;
          if (owner) registerMember(owner.id, slot, t);
          else if (qualified) globals.set(qualified, t);
          consumed.add(value);
          return t;
        }
      }
      if (entryById.has(id)) return null;
      if (isFunctionLike(value)) {
        const kind = ts.isClassExpression(value) ? "class" : owner && (owner.kind === "class" || owner.kind === "function" || owner.kind === "method") ? "method" : "function";
        const e = record(ctx.add(value, name, kind, owner, exported, [value], nameNode));
        if (ts.isClassExpression(value)) {
          ctx.addClassMembers(value, e);
          attachNew(ctx);
        }
        return e;
      }
      if (late) return null;
      // Any other value at definition time is a variable; an object literal is a
      // namespace whose function-valued properties are members of it.
      const e = record(ctx.add(value, name, "variable", owner, exported, [value], nameNode));
      if (ts.isObjectLiteralExpression(value)) bindProperties(ctx, e, value, { exported });
      return e;
    };
    /**
     * Bind every property of an object literal as a slot of `owner`
     * (`X.prototype = {...}`, `Object.assign(ns, {...})`). `bindSlot` and
     * `bindProperties` are one recursive pair: a slot bound to an object literal
     * is a namespace whose properties are slots in turn (`ns.sub = { f() {} }`).
     */
    const bindProperties = (ctx, owner, literal, opts) => {
      for (const prop of literal.properties) {
        const name = memberName(prop.name);
        if (!name) continue;
        if (ts.isPropertyAssignment(prop)) bindSlot(ctx, owner, name, prop.initializer, prop.name, opts);
        else if (ts.isShorthandPropertyAssignment(prop)) bindSlot(ctx, owner, name, prop.name, prop.name, opts);
        else if (ts.isMethodDeclaration(prop) || ts.isGetAccessorDeclaration(prop) || ts.isSetAccessorDeclaration(prop)) {
          if (entryById.has(owner ? `${owner.id}.${name}` : `${ctx.file}::${name}`)) continue;
          const e = ctx.add(prop, name, owner ? "method" : "function", owner, Boolean(opts.exported), [prop], prop.name);
          e.isStatic = !opts.viaPrototype;
          attach(ctx, e);
          if (owner) registerMember(owner.id, name, e);
        }
      }
    };
    /** Try to turn one pending top-level assignment into declarations. */
    const bind = (p, final) => {
      const { ctx, target, value, spread } = p;
      if (spread) {
        const r = denote(target);
        if (!r) return false;
        if (r.moduleNs) {
          bindProperties(ctx, null, value, { exported: true });
          return true;
        }
        if (!r.entry) return false;
        bindProperties(ctx, r.entry, value, { viaPrototype: Boolean(r.viaPrototype), exported: r.entry.exported });
        return true;
      }
      const slot = target.name.text;
      const r = denote(target.expression);
      if (!r) return false;
      if (r.moduleNs) return bindSlot(ctx, null, slot, value, target.name, { exported: true }) !== null;
      if (slot === "prototype" && !r.viaPrototype) {
        // `X.prototype = {...}` declares the members of X; any other value is module code.
        if (!r.entry || !ts.isObjectLiteralExpression(unwrap(value))) return false;
        bindProperties(ctx, r.entry, unwrap(value), { viaPrototype: true });
        return true;
      }
      if (r.viaPrototype) return r.entry ? bindSlot(ctx, r.entry, slot, value, target.name, { viaPrototype: true }) !== null : false;
      if (r.entry) return bindSlot(ctx, r.entry, slot, value, target.name, { exported: r.entry.exported }) !== null;
      // An undeclared global. Give an intermediate binding (`d3.geo = {}`) the
      // chance to appear before accepting a parent-less qualified name.
      if (!r.global || (r.path.includes(".") && !final)) return false;
      return bindSlot(ctx, null, slot, value, target.name, { qualified: `${r.path}.${slot}`, exported: true }) !== null;
    };
    const pending = fileCtx.flatMap((ctx) => ctx.assignments.map((p) => ({ ...p, ctx })));
    for (let final = false; ; ) {
      let progress = false;
      for (let i = 0; i < pending.length; ) {
        if (bind(pending[i], final)) {
          pending.splice(i, 1);
          progress = true;
        } else i++;
      }
      if (progress) continue;
      if (final || pending.length === 0) break;
      final = true;
    }
    for (const p of pending) p.ctx.rest.push(p.stmt);
    for (const ctx of fileCtx) {
      if (ctx.rest.length === 0) continue;
      ctx.rest.sort((a, b) => a.pos - b.pos);
      // One node per file for its top-level code (docs/THEORY.md §4: every
      // occurrence here is definition-time). The source file is its AST node.
      const e = ctx.add(ctx.sf, "<module>", "module", null, false, ctx.rest, null);
      e.displayName = ctx.baseName;
      e.line = ctx.sf.getLineAndCharacterOfPosition(ctx.rest[0].getStart(ctx.sf)).line + 1;
      attach(ctx, e);
    }

    // Pass 1c: late bindings (docs/THEORY.md §4). `app.handler = function` inside
    // a body binds a name other code can use, but only once that body has run: a
    // declaration flagged `late`, with a `reference` from its installer. When the
    // receiver is a value (a parameter, a local, `this`) nothing is declared: the
    // closure escapes into a slot and its callers are found by flow analysis.
    for (const d of [...declarations]) {
      const ctx = ctxOf.get(d.file);
      const walk = (node, inFn) => {
        if (inFn && ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken && ts.isPropertyAccessExpression(node.left) && isFunctionLike(unwrap(node.right))) {
          const r = denote(node.left.expression);
          if (r?.entry && !r.moduleNs) bindSlot(ctx, r.entry, node.left.name.text, node.right, node.left.name, { viaPrototype: Boolean(r.viaPrototype), late: true });
        }
        const childInFn = inFn || ts.isFunctionLike(node);
        ts.forEachChild(node, (child) => {
          const nested = declByNode.get(child);
          if (nested && nested !== d) return;
          walk(child, childInFn);
        });
      };
      for (const body of d.bodyNodes) walk(body, false);
    }

    // Pass 1d: local declarations. Two kinds share one walk, but only one of
    // them needs the `nested` option:
    //
    //  - A function-like value written as a property of an object literal
    //    (`{ onFit: () => {…} }`) is unconditionally a declaration. ECMAScript
    //    names it by NamedEvaluation exactly as it would a variable initialiser
    //    (`{ onFit: … }.onFit.name === "onFit"`, same rule as `const onFit =
    //    () => {}`), so it was never truly anonymous - only unnamed by the
    //    older, narrower pattern this walk used to match. And unlike a store
    //    (`el.cb = fn`, `el` a value, docs/THEORY.md §4.2 Definition 9a) it
    //    cannot be read back through an alias someone else holds: when the
    //    literal itself has no path of its own (typically because it is a bare
    //    call argument, `new Panel(host, state, { onFit, onLabels, … })`), the
    //    only way to reach the value at all is the one place that constructed
    //    it, so nothing is lost by naming it there. Its parent is therefore the
    //    declaration doing the constructing, id `<parent>/<key>` - the same
    //    shape as the local declarations below, because the reasoning is the
    //    same: a name with exactly one possible home.
    //  - A named local function, a `const x = () => {}`, or a local class is
    //    *additionally* promoted to its own node under the `nested` option:
    //    Definition 10 of docs/THEORY.md. Off by default, because unlike the
    //    case above this closure's body never leaves the declaration that
    //    wrote it - the default graph is the module-level `letrec`, and this
    //    is only ever more of that one declaration's own code.
    const nestLocal = (d) => {
      const ctx = ctxOf.get(d.file);
      const found = [];
      const walk = (node) => {
        let e = null;
        if (node !== d.node && ts.isPropertyAssignment(node) && isFunctionLike(unwrap(node.initializer))) {
          const init = unwrap(node.initializer);
          const name = memberName(node.name);
          if (name && !declByNode.has(init)) {
            e = ctx.add(node, name, ts.isClassExpression(init) ? "class" : "function", d, false, [init], node.name, "/");
            if (ts.isClassExpression(init)) ctx.addClassMembers(init, e);
          }
        } else if (node !== d.node && ts.isObjectLiteralExpression(node.parent) && (ts.isMethodDeclaration(node) || ts.isGetAccessorDeclaration(node) || ts.isSetAccessorDeclaration(node))) {
          const name = memberName(node.name);
          if (name) e = ctx.add(node, name, "function", d, false, [node], node.name, "/");
        } else if (options.nested && node !== d.node && ts.isFunctionDeclaration(node) && node.name) {
          e = ctx.add(node, node.name.text, "function", d, false, [node], node.name, "/");
        } else if (options.nested && node !== d.node && ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer && isFunctionLike(unwrap(node.initializer))) {
          const init = unwrap(node.initializer);
          e = ctx.add(node, node.name.text, ts.isClassExpression(init) ? "class" : "function", d, false, [init], node.name, "/");
          if (ts.isClassExpression(init)) ctx.addClassMembers(init, e);
        } else if (options.nested && node !== d.node && ts.isClassDeclaration(node) && node.name) {
          e = ctx.add(node, node.name.text, "class", d, false, [], node.name, "/");
          if (node.heritageClauses) e.bodyNodes.push(...node.heritageClauses);
          ctx.addClassMembers(node, e);
        }
        if (e) {
          e.local = true;
          attach(ctx, e);
          attachNew(ctx);
          found.push(e);
          return; // its own body is walked when it is nested in turn
        }
        ts.forEachChild(node, (child) => {
          const nested = declByNode.get(child);
          if (nested && nested !== d) return;
          walk(child);
        });
      };
      for (const body of d.bodyNodes) walk(body);
      for (const e of found) nestLocal(e);
    };
    for (const d of [...declarations]) nestLocal(d);

    // ---------------------------------------------------------------------------
    // Class hierarchy: constructor lookup, dispatch (class hierarchy analysis)
    // and the structural override / implements edges. See docs/THEORY.md §3.4, §5.
    const baseOf = new Map(); // class id -> base class entry
    const interfacesOf = new Map(); // class or interface id -> interface entries it implements / extends
    for (const d of declarations) {
      const node = d.kind === "class" ? d.classNode : d.kind === "interface" ? d.node : null;
      if (!node) continue;
      for (const clause of node.heritageClauses ?? []) {
        for (const t of clause.types) {
          const target = denote(t.expression)?.entry ?? null;
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
    for (const [id, base] of baseOf) link(base.id, entryById.get(id));
    for (const [id, ifaces] of interfacesOf) for (const i of ifaces) link(i.id, entryById.get(id));
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
      const owner = entryById.get(member.parent);
      if (!owner) return out;
      for (const sub of descendants(owner)) {
        const m = membersOf.get(sub.id)?.get(slotName(member));
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
    /**
     * Record one occurrence of `resolved` inside `d` (docs/THEORY.md §3, §5).
     * `new C(...)` reads the binding `C` and then runs the constructor found by
     * lookup, so it produces both edges; a call through an interface member is a
     * type-level dependency plus inferred calls to the implementations; a
     * dynamically dispatched method call also reaches the overriding methods.
     */
    const emitReference = (d, resolved, kind, time, node, inferred) => {
      let target = resolved;
      if (isNewTarget(node)) {
        target = constructorTarget(resolved);
        if (target !== resolved && resolved !== d) addEdge(d, resolved, "reference", time, inferred);
      }
      if (kind === "call" && target.kind === "interface") {
        // A call through an interface member: the interface is a type-level
        // dependency, the implementations are the control targets.
        addEdge(d, target, "type", time, inferred);
        for (const impl of dispatchTargets({ parent: target.id, name: node.text })) if (impl !== d) addEdge(d, impl, "call", time, true);
        return;
      }
      if (kind === "reference") {
        // Assignment target (docs/THEORY.md §3.5): the edge reverses, since the
        // variable's next value depends on its writer, not the other way
        // around. Compound assignment and `++`/`--` also read the old value,
        // so they keep the ordinary edge for that half.
        const w = writeInfo(node);
        if (w.write && target !== d) addEdge(target, d, "write", time, inferred);
        if (!w.write || w.alsoRead) {
          if (target !== d) addEdge(d, target, kind, time, inferred);
        }
      } else if (target !== d || kind === "call" || kind === "create") {
        addEdge(d, target, kind, time, inferred);
      }
      if (kind === "call" && target.kind === "method" && !target.isStatic && isDispatchedCall(node)) {
        for (const impl of dispatchTargets(target)) if (impl !== d) addEdge(d, impl, "call", time, true);
      }
    };

    // Structural edges: overriding and interface implementation at member level.
    for (const d of declarations) {
      if (!d.parent || slotName(d) === "constructor") continue;
      const owner = entryById.get(d.parent);
      if (!owner || owner.kind !== "class") continue;
      const base = inheritedMember(owner, slotName(d));
      if (base) addEdge(d, base, "override", "definition");
      for (const iface of allInterfaces(owner)) {
        const m = membersOf.get(iface.id)?.get(slotName(d));
        if (m) addEdge(d, m, "implements", "definition");
      }
    }

    /** Member `name` of the declaration `ownerId`, own or inherited. */
    const memberNamed = (ownerId, name) => {
      const own = membersOf.get(ownerId)?.get(name);
      if (own) return own;
      const owner = entryById.get(ownerId);
      return owner ? inheritedMember(owner, name) : null;
    };
    /** Every instance member called `name`, whatever its class: the field-based approximation of an untyped `o.name(...)`. */
    const instanceMembersNamed = (name) => {
      const out = [];
      for (const [ownerId, members] of membersOf) {
        const m = members.get(name);
        // Instance members only: class methods, prototype bindings and the functions aliased into them.
        if (!m || m.isStatic !== false || m.kind === "variable") continue;
        const owner = entryById.get(ownerId);
        if (owner && owner.kind !== "interface" && !out.includes(m)) out.push(m);
      }
      return out;
    };

    // Pass 2: syntactic references (docs/THEORY.md §3, definitions 4-6).
    const callSites = []; // { owner, node, time } for the flow analysis below
    for (const d of declarations) {
      const visit = (node, inFn) => {
        const time = inFn ? "use" : "definition";
        if (node.kind === ts.SyntaxKind.SuperKeyword && ts.isCallExpression(node.parent) && node.parent.expression === node) {
          // super(...) inside a derived constructor calls the base class constructor.
          const target = constructorTarget(denote(node)?.entry ?? null);
          if (target && target !== d) addEdge(d, target, "call", time);
        } else if (ts.isIdentifier(node) || ts.isPrivateIdentifier(node)) {
          if (node !== d.nameNode) {
            // Skip identifiers that merely name a property being declared or a local binding.
            const p = node.parent;
            const declaresBinding =
              (ts.isVariableDeclaration(p) || ts.isParameter(p) || ts.isBindingElement(p) || ts.isFunctionDeclaration(p) || ts.isClassDeclaration(p) || ts.isMethodDeclaration(p) || ts.isPropertyDeclaration(p) || ts.isPropertyAssignment(p) || ts.isImportSpecifier(p) || ts.isImportClause(p)) &&
              p.name === node;
            if (!declaresBinding && !consumed.has(node)) {
              const kind = referenceKind(node);
              // Several candidates mean the occurrence went through a union type or
              // a record indexed at run time: only one of them runs and which one is
              // not decided here, so they are all inferred.
              let found = resolveTargets(node);
              let inferred = found.length > 1;
              if (found.length === 0 && ts.isPropertyAccessExpression(p) && p.name === node) {
                // The checker could not type the receiver (untyped JavaScript, an
                // undeclared global). Resolve the path by name (`d3.scale.linear`),
                // then `this.m` inside a member, then any instance member called `m`
                // (the field-based call graph of Feldthaus et al. 2013), which is an
                // over-approximation and therefore inferred.
                const r = denote(p);
                if (r?.entry) found = [r.entry];
                else if (p.expression.kind === ts.SyntaxKind.ThisKeyword && d.parent) {
                  const m = memberNamed(d.parent, node.text);
                  if (m) found = [m];
                } else if (isDispatchedCall(node)) {
                  found = instanceMembersNamed(node.text);
                  inferred = true;
                }
              }
              for (const resolved of found) emitReference(d, resolved, kind, time, node, inferred);
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
      if (ts.isIdentifier(node) || ts.isPropertyAccessExpression(node)) {
        const r = denote(node);
        const target = r && !r.viaPrototype ? r.entry : null;
        if (target) {
          if (isCallable(target) || target.kind === "class") return new Set([target]);
          if (target.kind === "variable") return variableValues(target);
          return new Set();
        }
        const sym = ts.isIdentifier(node) ? symbolOf(node) : null;
        return sym && env.has(sym) ? new Set(env.get(sym)) : new Set();
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
        const t = constructorTarget(denote(callee)?.entry ?? null);
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
            if (sym && !denote(node.left)?.entry) union(setFor(env, sym), evalExpr(node.right));
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
        root: rootLabel,
        language: options.language ?? "typescript",
        generatedAt: new Date().toISOString(),
        analyzer: `analyzers/ts@${ANALYZER_VERSION}`,
        files: files.length,
      },
      declarations: declarations
        .map((d) => {
          const out = { id: d.id, name: d.displayName ?? d.name, kind: d.kind, file: d.file, line: d.line, parent: d.parent, exported: d.exported };
          if (d.late) out.late = true;
          if (d.aliases) out.aliases = d.aliases;
          return out;
        })
        .sort((a, b) => a.id.localeCompare(b.id)),
      edges: [...edges.values()].sort((a, b) => a.source.localeCompare(b.source) || a.target.localeCompare(b.target) || a.kind.localeCompare(b.kind)),
    };
  }

  return { analyzeProgram };
}
