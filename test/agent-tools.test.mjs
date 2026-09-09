import { test } from "node:test";
import assert from "node:assert/strict";
import { buildGraph } from "../site/js/model.js";
import { createAgentTools } from "../site/js/agentTools.js";
import { allReports } from "../site/js/reports.js";

const decl = (id, extra = {}) => ({ id, name: id, kind: "function", file: `src/${id}.js`, line: 1, ...extra });
const edge = (source, target, kind = "call") => ({ source, target, kind });

// r calls a and b; a and b both call shared; r also reaches deep directly.
const sample = () =>
  buildGraph({
    declarations: ["r", "a", "b", "shared", "deep", "lonely1", "lonely2"].map((id) => decl(id)),
    edges: [edge("r", "a"), edge("r", "b"), edge("a", "shared"), edge("b", "shared"), edge("shared", "deep"), edge("r", "deep"), edge("lonely1", "lonely2")],
  });

const toolsFor = (graph, hooks = {}) =>
  createAgentTools({
    getGraph: () => graph,
    getLabel: () => "sample",
    getEdgeKinds: () => ["call"],
    setEdgeKinds: () => {},
    highlight: () => {},
    reanalyze: async () => ({}),
    ...hooks,
  });

test("every report says what it measures", () => {
  const reports = allReports(sample());
  assert.deepEqual(Object.keys(reports).sort(), ["elevation-gaps", "entry-points", "independence", "islands"]);
  for (const [name, report] of Object.entries(reports)) {
    assert.equal(typeof report.description, "string", `${name} has a description`);
    assert.ok(report.description.length > 40, `${name}'s description says something`);
  }
});

test("get_diagnostics summarises by default and carries every edge only when asked", () => {
  const tools = toolsFor(sample());
  const summary = tools.get_diagnostics();
  assert.equal(summary.dataset, "sample");
  assert.deepEqual(summary.edgeKinds, ["call"]);
  assert.equal(summary.declarations, 7);
  // A bucket in the summary is a count; the edges behind it are not.
  const summarised = summary.metrics["elevation-gaps"].byGap[0];
  assert.ok(summarised.count > 0);
  assert.equal(summarised.edges, undefined);

  const full = tools.get_diagnostics({ detail: "full" });
  assert.ok(full.metrics["elevation-gaps"].byGap[0].edges.length > 0, "full carries the edges themselves");
  assert.ok(JSON.stringify(full).length > JSON.stringify(summary).length, "full is the bigger of the two");
  // Both readings of the same graph agree about the figure itself.
  assert.equal(full.metrics["elevation-gaps"].total, summary.metrics["elevation-gaps"].total);
});

test("find_declarations matches on name or file and caps what it returns", () => {
  const tools = toolsFor(sample());
  assert.deepEqual(
    tools.find_declarations({ query: "lonely" }).nodes.map((n) => n.name),
    ["lonely1", "lonely2"],
  );
  assert.equal(tools.find_declarations({ query: "src/shared" }).nodes[0].name, "shared");
  const capped = tools.find_declarations({ query: "", limit: 2 });
  assert.equal(capped.nodes.length, 2);
  assert.equal(capped.count, 7, "the count is of every match, not of what fitted");
});

test("get_declaration carries both numbers the diagnostics are read off, per edge", () => {
  const tools = toolsFor(sample());
  const shared = tools.get_declaration({ id: "shared" });
  assert.equal(shared.file, "src/shared.js");
  assert.deepEqual(shared.callers.map((c) => c.from.name).sort(), ["a", "b"]);
  for (const caller of shared.callers) {
    assert.equal(caller.lift, 1, "shared sits one scope above both of its callers");
    assert.equal(caller.gap, 0, "and one call-height layer below each of them");
  }
  // `deep` sits at the bottom (0) and `r` at the top (3), so r -> deep
  // reaches past two whole layers — the one a and b sit on and the one
  // `shared` sits on — while shared -> deep, one layer up, is flat.
  const deep = tools.get_declaration({ id: "deep" });
  assert.equal(deep.callers.find((c) => c.from.name === "r").gap, 2);
  assert.equal(deep.callers.find((c) => c.from.name === "shared").gap, 0);
});

test("a tool called with nothing loaded, or an unknown name, says which", () => {
  const empty = toolsFor(buildGraph({ declarations: [], edges: [] }));
  assert.throws(() => empty.get_diagnostics(), /No graph is loaded/);
  const tools = toolsFor(sample());
  assert.throws(() => tools.get_declaration({ id: "nope" }), /find_declarations/);
  assert.throws(() => tools.set_edge_kinds({ kinds: [] }), /non-empty array/);
});

test("reanalyze reports back what the viewer refused to do, rather than resolving quietly", async () => {
  const tools = toolsFor(sample(), { reanalyze: async () => ({ error: "Nothing re-analyzable is open." }) });
  await assert.rejects(() => tools.reanalyze(), /Nothing re-analyzable/);
});

test("highlight reports what it could not find instead of failing the call", () => {
  let highlighted = null;
  const tools = toolsFor(sample(), { highlight: (nodes) => (highlighted = nodes.map((n) => n.name)) });
  const result = tools.highlight({ ids: ["a", "ghost"] });
  assert.deepEqual(highlighted, ["a"]);
  assert.deepEqual(result.notFound, ["ghost"]);
});
