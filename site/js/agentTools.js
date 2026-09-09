// Tools an AI agent can call against the graph that is already on screen.
//
// The point is that nothing has to be downloaded. The browser has just
// analyzed a folder or a repository — seconds of work the page is holding in
// memory — and an agent that wants to act on the diagnosis would otherwise
// have to be handed an exported file, or re-run the whole analysis somewhere
// else. These tools hand it the same numbers directly.
//
// What the loop looks like, and why the page never writes a file:
//
//   get_diagnostics()   the agent reads what is wrong
//   get_declaration()   it asks where a finding actually lives
//   (the agent edits the source with its own tools, under its own
//    permissions, where the user can see and review the change)
//   reanalyze()         the page re-reads the folder and re-measures
//   get_diagnostics()   the agent checks whether the number moved
//
// The edit step is deliberately not here. A page that could rewrite a source
// tree is a much larger thing to trust than a page that can describe one, and
// the agents worth pointing at this already have file access of their own,
// granted and reviewed through their own front door. Re-analysis is what the
// page uniquely has (the directory handle, the vendored TypeScript, the
// worker), so re-analysis is what it offers.
//
// Transport: WebMCP (`navigator.modelContext`) when the browser has it, which
// is an emerging API and absent in most browsers today. Registration is
// therefore best-effort and silent when it fails; the same tools are always
// reachable at `window.programTree`, which is what an extension, a devtools
// console, a Playwright-driven agent, or this repository's own tests use.
import { allReports } from "./reports.js";
import { linkLift } from "./metrics.js";

/** Global the tools are always reachable at, WebMCP or no WebMCP. */
const GLOBAL_NAME = "programTree";

/**
 * How much of a report to hand back. A full diagnosis of a real codebase
 * lists every edge of every gap bucket and every declaration of every island
 * — tens of thousands of lines, most of a context window, for a question
 * usually answered by the first ten. `summary` (the default) keeps the
 * headline figures, the description, and the worst few of each; `full` is
 * byte-for-byte what the panel's export button downloads.
 */
const TOP_N = 10;

function summarize(reports) {
  const gaps = reports["elevation-gaps"];
  const islands = reports.islands;
  const independence = reports.independence;
  const entries = reports["entry-points"];
  return {
    "entry-points": {
      description: entries.description,
      count: entries.count,
      nodes: entries.nodes.slice(0, TOP_N),
      truncated: entries.nodes.length > TOP_N,
    },
    "elevation-gaps": {
      description: gaps.description,
      total: gaps.total,
      flatEdges: gaps.flatEdges,
      gapSum: gaps.gapSum,
      // Bucket sizes without their edge lists, plus the steepest few edges,
      // which is the part anyone acts on first.
      byGap: gaps.byGap.map(({ gap, count }) => ({ gap, count })),
      steepest: gaps.byGap
        .slice()
        .reverse()
        .flatMap((b) => b.edges)
        .slice(0, TOP_N),
    },
    independence: {
      description: independence.description,
      overall: independence.overall,
      nodes: independence.nodes.slice(0, TOP_N),
      truncated: independence.nodes.length > TOP_N,
    },
    islands: {
      description: islands.description,
      mainland: islands.mainland,
      adrift: islands.adrift,
      groups: islands.groups.slice(0, TOP_N).map((g) => ({ size: g.size, nodes: g.nodes.map((n) => n.name) })),
      groupCount: islands.groups.length,
      aloneCount: islands.alone.length,
    },
  };
}

/** Both ends of one edge, as an agent needs to read it: kind, lift, gap. */
function edgeShape(graph, link, other, direction) {
  const lift = linkLift(graph, link);
  return {
    [direction]: { id: other.id, name: other.name, file: other.file, line: other.line, kind: other.kind },
    edgeKind: link.kind,
    inferred: Boolean(link.inferred),
    // Both numbers the diagnostics are read off, for this one edge: how many
    // scopes it hoists its target out of, and how many call-height layers it
    // skips. -1 lift means the edge is inside a cycle and has neither.
    lift,
    gap: link.source.scc === link.target.scc ? null : link.source.height - link.target.height - 1,
  };
}

/**
 * Build the toolset over an app. `hooks` is how it reaches the live viewer
 * without importing it: app.js owns the state, this owns the vocabulary.
 */
export function createAgentTools(hooks) {
  const requireGraph = () => {
    const graph = hooks.getGraph();
    if (!graph || graph.nodes.length === 0) throw new Error("No graph is loaded. Open a dataset, a folder or a repository in the viewer first.");
    return graph;
  };
  const find = (graph, id) => graph.byId.get(id) ?? graph.nodes.find((n) => n.name === id) ?? null;

  return {
    get_diagnostics({ detail = "summary" } = {}) {
      const graph = requireGraph();
      const reports = allReports(graph);
      return {
        dataset: hooks.getLabel(),
        edgeKinds: hooks.getEdgeKinds(),
        declarations: graph.nodes.length,
        edges: (graph.activeLinks ?? graph.links).length,
        metrics: detail === "full" ? reports : summarize(reports),
      };
    },

    find_declarations({ query = "", kind = null, limit = 20 } = {}) {
      const graph = requireGraph();
      const needle = String(query).toLowerCase();
      const matches = graph.nodes.filter(
        (n) => (!kind || n.kind === kind) && (n.name.toLowerCase().includes(needle) || n.file.toLowerCase().includes(needle)),
      );
      return {
        count: matches.length,
        nodes: matches.slice(0, limit).map((n) => ({ id: n.id, name: n.name, kind: n.kind, file: n.file, line: n.line, height: n.height, in: n.inDegree, out: n.outDegree })),
      };
    },

    get_declaration({ id } = {}) {
      const graph = requireGraph();
      const node = find(graph, id);
      if (!node) throw new Error(`No declaration with id or name ${JSON.stringify(id)}. Use find_declarations to look one up.`);
      const links = graph.activeLinks ?? graph.links;
      return {
        id: node.id,
        name: node.name,
        kind: node.kind,
        file: node.file,
        line: node.line,
        height: node.height,
        inCycle: Boolean(node.inCycle),
        exported: Boolean(node.exported),
        callers: links.filter((l) => l.target === node).map((l) => edgeShape(graph, l, l.source, "from")),
        callees: links.filter((l) => l.source === node).map((l) => edgeShape(graph, l, l.target, "to")),
      };
    },

    set_edge_kinds({ kinds } = {}) {
      if (!Array.isArray(kinds) || kinds.length === 0) throw new Error("Pass a non-empty array of edge kinds, e.g. [\"call\", \"create\"] for the control graph.");
      hooks.setEdgeKinds(kinds);
      const graph = requireGraph();
      return { edgeKinds: hooks.getEdgeKinds(), edges: (graph.activeLinks ?? graph.links).length, metrics: summarize(allReports(graph)) };
    },

    highlight({ ids = [] } = {}) {
      const graph = requireGraph();
      const nodes = ids.map((id) => find(graph, id)).filter(Boolean);
      hooks.highlight(nodes);
      return { highlighted: nodes.map((n) => n.id), notFound: ids.filter((id) => !find(graph, id)) };
    },

    async reanalyze() {
      const done = await hooks.reanalyze();
      if (done?.error) throw new Error(done.error);
      const graph = requireGraph();
      return { dataset: hooks.getLabel(), declarations: graph.nodes.length, edges: (graph.activeLinks ?? graph.links).length, metrics: summarize(allReports(graph)) };
    },
  };
}

/** MCP tool descriptors: what each one is for, and what it takes. */
function descriptors(tools) {
  const kinds = { type: "array", items: { type: "string" } };
  const spec = [
    [
      "get_diagnostics",
      "The four structural diagnostics of the graph currently open in the viewer — entry points, elevation gaps, independence, islands — each with a description of what it measures. Start here.",
      { detail: { type: "string", enum: ["summary", "full"], description: "summary (default) keeps the figures and the worst few of each; full lists every declaration and edge behind every number." } },
    ],
    ["find_declarations", "Look up declarations by a substring of their name or file path, to turn a name in a diagnostic into a place in the source.", { query: { type: "string" }, kind: { type: "string" }, limit: { type: "number" } }],
    ["get_declaration", "Everything about one declaration: where it is, and every caller and callee with that edge's own lift and elevation gap.", { id: { type: "string", description: "The declaration's id, or its plain name." } }],
    ["set_edge_kinds", "Re-read every diagnostic on a different set of edge kinds — [\"call\", \"create\"] is the control graph, which reads differently from the default.", { kinds }],
    ["highlight", "Show these declarations in the viewer, so a human watching the screen sees what is being discussed.", { ids: kinds }],
    ["reanalyze", "Re-read and re-analyze the folder or repository currently open, then return the new figures. Call this after editing the source to see whether a number moved.", {}],
  ];
  return spec.map(([name, description, properties]) => ({
    name,
    description,
    inputSchema: { type: "object", properties, required: [] },
    execute: (args) => tools[name](args ?? {}),
  }));
}

/**
 * Hand the tools to WebMCP if this browser has it. Best-effort by design:
 * the API is a proposal, its shape has moved, and no version of it is worth
 * an exception in a viewer whose main job is drawing a graph. Returns how it
 * went, which `window.programTree.webmcp` then reports.
 */
function registerWithWebMcp(tools) {
  const mc = globalThis.navigator?.modelContext;
  if (!mc) return "unavailable";
  try {
    if (typeof mc.registerTool === "function") {
      for (const tool of descriptors(tools)) mc.registerTool(tool);
      return "registerTool";
    }
    if (typeof mc.provideContext === "function") {
      mc.provideContext({ tools: descriptors(tools) });
      return "provideContext";
    }
    return "unrecognised";
  } catch {
    return "failed";
  }
}

/**
 * Install the toolset: registered with WebMCP where that exists, and always
 * on `window.programTree` so the same calls work from an extension, a
 * console, or a test.
 */
export function installAgentTools(hooks) {
  const tools = createAgentTools(hooks);
  const api = { ...tools, webmcp: registerWithWebMcp(tools), tools: () => descriptors(tools).map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) };
  globalThis[GLOBAL_NAME] = api;
  return api;
}
