// Graph model: normalises an analyzer document (see docs/DATA_FORMAT.md) into
// the in-memory structures used by the renderers and the diagnostics panel.
import { CONTROL_KINDS } from "./kinds.js";

/** Split a `/`-separated path into its directory segments and the file name. */
export function splitPath(file) {
  const parts = file.split("/").filter((p) => p.length > 0);
  const name = parts.pop() ?? "";
  return { dirs: parts, name };
}

/**
 * Build the graph model.
 * @param {object} doc analyzer document
 * @returns {{nodes, links, containers, maxDepth, dropped, byId}}
 */
export function buildGraph(doc) {
  const declarations = Array.isArray(doc.declarations) ? doc.declarations : [];
  const rawEdges = Array.isArray(doc.edges) ? doc.edges : [];

  const nodes = declarations.map((d, index) => {
    const { dirs, name: fileName } = splitPath(d.file ?? "");
    return {
      id: d.id,
      index,
      name: d.name ?? d.id,
      kind: d.kind ?? "unknown",
      file: d.file ?? "",
      line: d.line ?? null,
      parent: d.parent ?? null,
      exported: Boolean(d.exported),
      dirs,
      fileName,
      inDegree: 0,
      outDegree: 0,
      height: 0,
      scc: -1,
      inCycle: false,
    };
  });
  const byId = new Map(nodes.map((n) => [n.id, n]));

  // Merge duplicate edges and drop dangling ones.
  const merged = new Map();
  let dropped = 0;
  for (const e of rawEdges) {
    const s = byId.get(e.source);
    const t = byId.get(e.target);
    if (!s || !t) {
      dropped++;
      continue;
    }
    const kind = e.kind ?? "call";
    const time = e.time === "definition" ? "definition" : "use";
    const key = `${s.id} ${t.id} ${kind} ${time}`;
    const existing = merged.get(key);
    if (existing) existing.count += e.count ?? 1;
    else merged.set(key, { source: s, target: t, kind, time, inferred: Boolean(e.inferred), count: e.count ?? 1 });
  }
  const links = [...merged.values()];
  // Degrees, heights and the tree diagnostics are defined on the control graph
  // (calls and constructions), see docs/THEORY.md §7. Other kinds are drawn but
  // do not make a declaration a "caller".
  const controlLinks = links.filter((l) => CONTROL_KINDS.has(l.kind));
  for (const l of controlLinks) {
    l.source.outDegree += 1;
    l.target.inDegree += 1;
  }

  const containers = buildContainers(nodes);
  // Deepest container, files included: the zone depth slider runs from 0 to this value.
  const maxDepth = containers.reduce((m, c) => Math.max(m, c.depth), 0);
  computeHeights(nodes, controlLinks);

  return { nodes, links, controlLinks, containers, maxDepth, dropped, byId };
}

/**
 * Containers are directories (depth = number of path segments, root = 0) and
 * files (depth = directory depth + 1, `isFile` = true). Each container owns the
 * nodes located beneath it.
 */
export function buildContainers(nodes) {
  const map = new Map();
  const get = (path, depth, isFile, parentPath) => {
    let c = map.get(path);
    if (!c) {
      c = {
        id: path,
        path,
        depth,
        isFile,
        parent: parentPath,
        label: path.split("/").pop() || "/",
        nodes: [],
      };
      map.set(path, c);
    }
    return c;
  };
  for (const n of nodes) {
    let path = "";
    let parentPath = null;
    for (let d = 0; d < n.dirs.length; d++) {
      path = path ? `${path}/${n.dirs[d]}` : n.dirs[d];
      const c = get(path, d + 1, false, parentPath);
      c.nodes.push(n);
      parentPath = path;
    }
    const filePath = path ? `${path}/${n.fileName}` : n.fileName;
    const f = get(filePath, n.dirs.length + 1, true, parentPath);
    f.nodes.push(n);
    n.fileContainer = f;
  }
  return [...map.values()];
}

/**
 * Tarjan's strongly connected components (iterative, so deep graphs do not
 * overflow the call stack). Returns `comp[i]` = component id of node i.
 * Component ids are emitted in reverse topological order of the condensation.
 */
export function stronglyConnectedComponents(nodes, links) {
  const n = nodes.length;
  const adj = Array.from({ length: n }, () => []);
  for (const l of links) adj[l.source.index].push(l.target.index);

  const indexOf = new Int32Array(n).fill(-1);
  const low = new Int32Array(n);
  const onStack = new Uint8Array(n);
  const comp = new Int32Array(n).fill(-1);
  const stack = [];
  let counter = 0;
  let compCount = 0;

  for (let root = 0; root < n; root++) {
    if (indexOf[root] !== -1) continue;
    const work = [[root, 0]];
    indexOf[root] = low[root] = counter++;
    stack.push(root);
    onStack[root] = 1;
    while (work.length > 0) {
      const frame = work[work.length - 1];
      const v = frame[0];
      if (frame[1] < adj[v].length) {
        const w = adj[v][frame[1]++];
        if (indexOf[w] === -1) {
          indexOf[w] = low[w] = counter++;
          stack.push(w);
          onStack[w] = 1;
          work.push([w, 0]);
        } else if (onStack[w]) {
          low[v] = Math.min(low[v], indexOf[w]);
        }
      } else {
        work.pop();
        if (work.length > 0) {
          const u = work[work.length - 1][0];
          low[u] = Math.min(low[u], low[v]);
        }
        if (low[v] === indexOf[v]) {
          let w;
          do {
            w = stack.pop();
            onStack[w] = 0;
            comp[w] = compCount;
          } while (w !== v);
          compCount++;
        }
      }
    }
  }
  return { comp, compCount };
}

/**
 * Assign each node a call height: the longest path from its SCC to a sink SCC
 * in the condensation DAG. Nodes that only get called have height 0.
 * Tarjan emits SCCs in reverse topological order, so a single pass suffices.
 */
export function computeHeights(nodes, links) {
  const { comp, compCount } = stronglyConnectedComponents(nodes, links);
  const compSize = new Int32Array(compCount);
  for (const n of nodes) {
    n.scc = comp[n.index];
    compSize[n.scc]++;
  }
  const compAdj = Array.from({ length: compCount }, () => new Set());
  const selfLoop = new Uint8Array(nodes.length);
  for (const l of links) {
    const a = comp[l.source.index];
    const b = comp[l.target.index];
    if (a !== b) compAdj[a].add(b);
    if (l.source === l.target) selfLoop[l.source.index] = 1;
  }
  // Every condensation edge a->b satisfies b < a, so ascending order is topological from the sinks.
  const height = new Int32Array(compCount);
  for (let c = 0; c < compCount; c++) {
    let h = 0;
    for (const d of compAdj[c]) h = Math.max(h, height[d] + 1);
    height[c] = h;
  }
  let maxHeight = 0;
  for (const n of nodes) {
    n.height = height[n.scc];
    n.inCycle = compSize[n.scc] > 1 || selfLoop[n.index] === 1;
    if (n.height > maxHeight) maxHeight = n.height;
  }
  return { compCount, compSize, maxHeight };
}

/** Undirected connected components; returns their count. */
export function connectedComponentCount(nodes, links) {
  const parent = new Int32Array(nodes.length);
  for (let i = 0; i < parent.length; i++) parent[i] = i;
  const find = (i) => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  };
  let count = nodes.length;
  for (const l of links) {
    const a = find(l.source.index);
    const b = find(l.target.index);
    if (a !== b) {
      parent[a] = b;
      count--;
    }
  }
  return count;
}
