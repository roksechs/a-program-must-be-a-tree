// 2D renderer: SVG with zoom/pan, zone hulls, arrowed edges, draggable nodes.
/* global d3 */
import { EDGE_KINDS, edgeBowOffset, edgeColor, kindColor, zoneColor } from "./colors.js";
import { hullPath, topPoint } from "./zones.js";

const ZONE_PADDING = { file: 14, dir: 26 };

export class Graph2D {
  /**
   * @param {HTMLElement} host element that receives the <svg>
   * @param {object} callbacks { onSelect(node|null), onDragStart(), onDragEnd(), onHover(node|null, event) }
   */
  constructor(host, callbacks) {
    this.host = host;
    this.callbacks = callbacks;
    this.graph = null;
    this.zones = [];
    this.selected = null;
    this.hovered = null;
    this.labelMode = "auto";
    this.colorBy = "kind";
    this.visibleKinds = new Set(EDGE_KINDS);
    this.transform = d3.zoomIdentity;

    this.svg = d3.select(host).append("svg").attr("class", "graph2d");
    const defs = this.svg.append("defs");
    for (const kind of [...EDGE_KINDS, "selected"]) {
      defs
        .append("marker")
        .attr("id", `arrow-${kind}`)
        .attr("viewBox", "0 -4 8 8")
        .attr("refX", 8)
        .attr("refY", 0)
        .attr("markerWidth", 8)
        .attr("markerHeight", 8)
        .attr("markerUnits", "userSpaceOnUse")
        .attr("orient", "auto")
        .append("path")
        .attr("d", "M0,-4L8,0L0,4Z")
        .attr("fill", kind === "selected" ? "#111827" : edgeColor(kind));
    }

    this.root = this.svg.append("g").attr("class", "viewport");
    this.zoneLayer = this.root.append("g").attr("class", "zones");
    this.zoneLabelLayer = this.root.append("g").attr("class", "zone-labels");
    this.linkLayer = this.root.append("g").attr("class", "links");
    this.nodeLayer = this.root.append("g").attr("class", "nodes");
    this.labelLayer = this.root.append("g").attr("class", "labels");

    this.zoom = d3
      .zoom()
      .scaleExtent([0.05, 8])
      .on("zoom", (event) => {
        this.transform = event.transform;
        this.root.attr("transform", event.transform);
        this.updateLabelVisibility();
      });
    this.svg.call(this.zoom).on("dblclick.zoom", null);
    this.svg.on("click", (event) => {
      if (event.target === this.svg.node()) this.select(null);
    });
    this.resize();
  }

  resize() {
    const { width, height } = this.host.getBoundingClientRect();
    this.width = width;
    this.height = height;
    this.svg.attr("width", width).attr("height", height);
    this.svg.attr("viewBox", [-width / 2, -height / 2, width, height]);
  }

  setGraph(graph) {
    this.graph = graph;
    this.selected = null;
    this.hovered = null;
    // Zones belong to the previous graph until the app calls setZones again.
    this.zones = [];
    this.zoneLayer.selectAll("*").remove();
    this.zoneLabelLayer.selectAll("*").remove();

    const link = this.linkLayer.selectAll("path.link").data(graph.links, (l) => `${l.source.id}->${l.target.id}:${l.kind}`);
    link.exit().remove();
    link
      .enter()
      .append("path")
      .attr("class", (l) => `link link-${l.kind}`)
      .merge(link)
      .attr("stroke", (l) => edgeColor(l.kind))
      .attr("stroke-width", (l) => Math.min(4, 1 + Math.log2(l.count)))
      .attr("stroke-dasharray", (l) => (l.inferred ? "3 3" : l.kind === "type" || l.kind === "reference" ? "1 3" : null))
      .attr("marker-end", (l) => `url(#arrow-${l.kind})`)
      .attr("fill", "none")
      .attr("display", (l) => (this.visibleKinds.has(l.kind) ? null : "none"));

    const drag = d3
      .drag()
      .on("start", (event, n) => {
        if (!event.active) this.callbacks.onDragStart?.();
        n.fx = n.x;
        n.fy = n.y;
      })
      .on("drag", (event, n) => {
        n.fx = event.x;
        n.fy = event.y;
      })
      .on("end", (event, n) => {
        if (!event.active) this.callbacks.onDragEnd?.();
        n.fx = null;
        n.fy = null;
      });

    const node = this.nodeLayer.selectAll("circle.node").data(graph.nodes, (n) => n.id);
    node.exit().remove();
    node
      .enter()
      .append("circle")
      .attr("class", "node")
      .merge(node)
      .attr("r", (n) => n.radius)
      .attr("fill", (n) => this.nodeFill(n))
      .attr("stroke", (n) => (n.inCycle ? "#b91c1c" : "#ffffff"))
      .attr("stroke-width", (n) => (n.inCycle ? 2 : 1))
      .call(drag)
      .on("click", (event, n) => {
        event.stopPropagation();
        this.select(n === this.selected ? null : n);
      })
      .on("dblclick", (event, n) => {
        event.stopPropagation();
        this.select(n);
        this.focusOn(n);
      })
      .on("mouseenter", (event, n) => {
        this.hovered = n;
        this.callbacks.onHover?.(n, event);
        this.updateLabelVisibility();
      })
      .on("mousemove", (event, n) => this.callbacks.onHover?.(n, event))
      .on("mouseleave", () => {
        this.hovered = null;
        this.callbacks.onHover?.(null);
        this.updateLabelVisibility();
      });

    const label = this.labelLayer.selectAll("text.label").data(graph.nodes, (n) => n.id);
    label.exit().remove();
    label
      .enter()
      .append("text")
      .attr("class", "label")
      .merge(label)
      .text((n) => n.name)
      .attr("dy", (n) => -n.radius - 3);

    this.updateLabelVisibility();
    this.applyHighlight();
  }

  nodeFill(n) {
    if (this.colorBy === "height") {
      const max = this.graph?.maxHeightCache ?? 0;
      return d3.interpolateViridis(max > 0 ? 0.15 + (0.75 * n.height) / max : 0.15);
    }
    return kindColor(n.kind);
  }

  setColorBy(mode) {
    this.colorBy = mode;
    this.restyle();
  }

  /** Re-apply node radius, colour and cycle marks (degrees or heights changed). */
  restyle() {
    if (!this.graph) return;
    this.graph.maxHeightCache = this.graph.nodes.reduce((h, n) => Math.max(h, n.height), 0);
    this.nodeLayer
      .selectAll("circle.node")
      .attr("r", (n) => n.radius)
      .attr("fill", (n) => this.nodeFill(n))
      .attr("stroke", (n) => (n.inCycle ? "#b91c1c" : "#ffffff"))
      .attr("stroke-width", (n) => (n.inCycle ? 2 : 1));
    this.labelLayer.selectAll("text.label").attr("dy", (n) => -n.radius - 3);
    this.tick();
  }

  setZones(containers) {
    this.zones = containers;
    const zone = this.zoneLayer.selectAll("path.zone").data(containers, (c) => c.id);
    zone.exit().remove();
    zone
      .enter()
      .append("path")
      .attr("class", "zone")
      .merge(zone)
      .attr("class", (c) => `zone ${c.isFile ? "zone-file" : "zone-dir"}`)
      .attr("fill", (c) => zoneColor(c))
      .attr("stroke", (c) => zoneColor(c))
      .attr("fill-opacity", 0.1)
      .attr("stroke-opacity", 0.45)
      .append("title")
      .text((c) => c.path);

    const label = this.zoneLabelLayer.selectAll("text.zone-label").data(containers, (c) => c.id);
    label.exit().remove();
    label
      .enter()
      .append("text")
      .attr("class", "zone-label")
      .merge(label)
      .attr("class", (c) => `zone-label ${c.isFile ? "zone-label-file" : "zone-label-dir"}`)
      .attr("fill", (c) => zoneColor(c))
      .text((c) => (c.isFile ? c.label : `${c.path}/`));
    this.tick();
  }

  setLabelMode(mode) {
    this.labelMode = mode;
    this.updateLabelVisibility();
  }

  /** Re-read the node names into the labels (names can change without the graph changing). */
  refreshLabels() {
    this.labelLayer.selectAll("text.label").text((n) => n.name);
  }

  setVisibleKinds(kinds) {
    this.visibleKinds = new Set(kinds);
    this.linkLayer.selectAll("path.link").attr("display", (l) => (this.visibleKinds.has(l.kind) ? null : "none"));
  }

  updateLabelVisibility() {
    if (!this.graph) return;
    const k = this.transform.k;
    const many = this.graph.nodes.length > 200;
    const neighbours = this.neighbourSet();
    this.labelLayer.selectAll("text.label").attr("display", (n) => {
      if (n === this.hovered || n === this.selected || neighbours.has(n)) return null;
      if (this.labelMode === "none") return "none";
      if (this.labelMode === "all") return null;
      // auto: show labels once the graph is zoomed in enough for them to be readable.
      return k * (many ? 1 : 2) >= 1.4 ? null : "none";
    });
  }

  neighbourSet() {
    const set = new Set();
    if (!this.selected || !this.graph) return set;
    for (const l of this.graph.links) {
      if (l.source === this.selected) set.add(l.target);
      if (l.target === this.selected) set.add(l.source);
    }
    return set;
  }

  select(node) {
    this.selected = node;
    this.applyHighlight();
    this.updateLabelVisibility();
    this.callbacks.onSelect?.(node);
  }

  applyHighlight() {
    const sel = this.selected;
    const neighbours = this.neighbourSet();
    this.nodeLayer
      .selectAll("circle.node")
      .classed("selected", (n) => n === sel)
      .classed("dimmed", (n) => sel && n !== sel && !neighbours.has(n));
    this.linkLayer
      .selectAll("path.link")
      .classed("highlight", (l) => sel && (l.source === sel || l.target === sel))
      .classed("dimmed", (l) => sel && l.source !== sel && l.target !== sel)
      .attr("marker-end", (l) => (sel && (l.source === sel || l.target === sel) ? "url(#arrow-selected)" : `url(#arrow-${l.kind})`));
    this.labelLayer.selectAll("text.label").classed("dimmed", (n) => sel && n !== sel && !neighbours.has(n));
  }

  /** Called on every simulation tick. */
  tick() {
    if (!this.graph) return;
    this.linkLayer.selectAll("path.link").attr("d", (l) => linkPath(l));
    this.nodeLayer
      .selectAll("circle.node")
      .attr("cx", (n) => n.x)
      .attr("cy", (n) => n.y);
    this.labelLayer
      .selectAll("text.label")
      .attr("x", (n) => n.x)
      .attr("y", (n) => n.y);

    const hulls = new Map();
    for (const c of this.zones) {
      const points = c.nodes.map((n) => [n.x, n.y]);
      hulls.set(c.id, { path: hullPath(points, c.isFile ? ZONE_PADDING.file : ZONE_PADDING.dir + 4 * c.depth), top: topPoint(points) });
    }
    this.zoneLayer.selectAll("path.zone").attr("d", (c) => hulls.get(c.id)?.path ?? "");
    this.zoneLabelLayer
      .selectAll("text.zone-label")
      .attr("x", (c) => hulls.get(c.id)?.top[0] ?? 0)
      .attr("y", (c) => (hulls.get(c.id)?.top[1] ?? 0) - (c.isFile ? ZONE_PADDING.file : ZONE_PADDING.dir + 4 * c.depth) - 4);
  }

  /** Fit the whole graph into the viewport. */
  fit() {
    if (!this.graph || this.graph.nodes.length === 0) return;
    const xs = this.graph.nodes.map((n) => n.x);
    const ys = this.graph.nodes.map((n) => n.y);
    const x0 = Math.min(...xs) - 60;
    const x1 = Math.max(...xs) + 60;
    const y0 = Math.min(...ys) - 60;
    const y1 = Math.max(...ys) + 60;
    const k = Math.min(this.width / (x1 - x0), this.height / (y1 - y0), 2);
    const t = d3.zoomIdentity.scale(k).translate(-(x0 + x1) / 2, -(y0 + y1) / 2);
    this.svg.transition().duration(400).call(this.zoom.transform, t);
  }

  /** Centre the camera on one node, zooming in a little if it's currently zoomed out. */
  focusOn(node) {
    if (!node) return;
    const k = Math.min(8, Math.max(this.transform.k, 1.5));
    const t = d3.zoomIdentity.scale(k).translate(-node.x, -node.y);
    this.svg.transition().duration(400).call(this.zoom.transform, t);
  }

  show(visible) {
    this.svg.style("display", visible ? null : "none");
  }
}

/**
 * Edge that stops at the target's radius: straight for most kinds, a
 * quadratic bow through `edgeBowOffset` (colors.js, shared with Graph3D) for
 * `reference` and `write`, so the read and write halves of a compound
 * assignment never overlap. Self loops become a small arc.
 */
function linkPath(l) {
  const s = l.source;
  const t = l.target;
  if (s === t) {
    const r = s.radius;
    return `M${s.x + r},${s.y} A${r * 1.4},${r * 1.4} 0 1,1 ${s.x},${s.y - r}`;
  }
  const dx = t.x - s.x;
  const dy = t.y - s.y;
  const d = Math.hypot(dx, dy) || 1;
  const rs = s.radius;
  const rt = t.radius + 1;
  const sx = s.x + (dx / d) * rs;
  const sy = s.y + (dy / d) * rs;
  const tx = t.x - (dx / d) * rt;
  const ty = t.y - (dy / d) * rt;
  const bow = edgeBowOffset(s, t, l.kind);
  if (!bow) return `M${sx},${sy}L${tx},${ty}`;
  const mx = (sx + tx) / 2 + bow.x;
  const my = (sy + ty) / 2 + bow.y;
  return `M${sx},${sy}Q${mx},${my} ${tx},${ty}`;
}
