// What each diagnostic has to say for itself, as plain data.
//
// The panel's "Export report" buttons and the agent tools (agentTools.js)
// both need exactly this, and they must not drift: a number an agent reads
// through a tool call and the same number a human downloads have to be the
// same number, computed the same way, described the same way. So the shapes
// live here rather than inside the DOM-building method that first needed
// them.
//
// Every report leads with `description`, the same sentence the panel shows
// under the figure. A report is read away from the viewer — that is what
// exporting one is for, and it is all an agent ever sees — so the number by
// itself would not say what it was measuring.
import { elevationGaps, entryPoints, independence, islands } from "./metrics.js";
import { t } from "./i18n.js";

/** The fields of a declaration worth carrying into a report. */
export function reportNodeShape(node) {
  return { id: node.id, name: node.name, kind: node.kind, file: node.file, line: node.line, in: node.inDegree, out: node.outDegree, height: node.height };
}

export function entryPointsReport(graph) {
  const entries = entryPoints(graph);
  return { description: t("metric.entryPoints.hint"), count: entries.length, nodes: entries.map(reportNodeShape) };
}

export function elevationGapsReport(graph) {
  const gaps = elevationGaps(graph);
  return {
    description: t("metric.elevationGaps.hint"),
    total: gaps.total,
    flatEdges: gaps.flat,
    gapSum: gaps.gapSum,
    byGap: gaps.buckets.map(({ gap, edges }) => ({
      gap,
      count: edges.length,
      edges: edges.map((l) => ({ source: l.source.id, target: l.target.id, kind: l.kind, gap })),
    })),
  };
}

export function independenceReport(graph) {
  const owned = independence(graph);
  return {
    description: t("metric.independence.hint"),
    overall: owned.overall,
    nodes: owned.nodes.map(({ node, score, callees, shared }) => ({ ...reportNodeShape(node), independence: score, callees, shared })),
  };
}

export function islandsReport(graph) {
  const adrift = islands(graph);
  return {
    description: t("metric.islands.hint"),
    mainland: adrift.mainland,
    adrift: adrift.adrift,
    groups: adrift.groups.map((g) => ({
      size: g.nodes.length,
      nodes: g.nodes.map(reportNodeShape),
      edges: g.links.map((l) => ({ source: l.source.id, target: l.target.id, kind: l.kind })),
    })),
    // Listed here even though the panel only counts them: a report is read at
    // leisure, and a lone declaration adrift is still a finding.
    alone: adrift.singles.map(reportNodeShape),
  };
}

/**
 * All four at once, keyed by the same id each one's own export filename uses,
 * so "the entry-points report" means one thing whether it arrived as a
 * download or as a tool result.
 */
export function allReports(graph) {
  return {
    "entry-points": entryPointsReport(graph),
    "elevation-gaps": elevationGapsReport(graph),
    independence: independenceReport(graph),
    islands: islandsReport(graph),
  };
}
