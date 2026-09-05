// Property panel: builds the right-hand side controls and diagnostics.
// The panel is deliberately framework-free: it renders plain DOM and reports
// changes through callbacks so the app stays in charge of state. All visible
// strings go through the translator so the panel can be re-rendered in
// another language with `refresh()`.
import { EDGE_KINDS, edgeColor, kindColor } from "./colors.js";
import { kindLabel, t } from "./i18n.js";
import { computeMetrics, topSharedNodes } from "./metrics.js";

export class Panel {
  /**
   * @param {HTMLElement} host
   * @param {object} state shared mutable state (see app.js)
   * @param {object} handlers { onDataset, onFile, onView, onPhysics, onReheat, onReset, onFit, onZones, onLabels, onColorBy, onLayerGap, onShowLayers, onAutoRotate, onSelectNode }
   */
  constructor(host, state, handlers) {
    this.host = host;
    this.state = state;
    this.h = handlers;
    // Remembered so the panel can be rebuilt (e.g. after a language change).
    this.datasets = [];
    this.currentDataset = null;
    this.dataInfo = null;
    this.graph = null;
    this.selected = null;
    this.render();
  }

  el(tag, attrs = {}, ...children) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === "class") e.className = v;
      else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
      else if (v !== null && v !== undefined) e.setAttribute(k, v);
    }
    for (const c of children) e.append(c);
    return e;
  }

  section(title, ...children) {
    return this.el("section", { class: "panel-section" }, this.el("h2", {}, title), ...children);
  }

  slider(label, key, min, max, step, onChange, format = (v) => v) {
    const value = this.state.physics[key] ?? this.state[key];
    const out = this.el("output", {}, format(value));
    const input = this.el("input", {
      type: "range",
      min,
      max,
      step,
      value,
      oninput: (e) => {
        const v = Number(e.target.value);
        out.textContent = format(v);
        onChange(v);
      },
    });
    const row = this.el("label", { class: "control" }, this.el("span", {}, label), input, out);
    row.input = input;
    row.output = out;
    return row;
  }

  select(options, current, onChange) {
    const sel = this.el("select", { onchange: (e) => onChange(e.target.value) });
    for (const [value, label] of options) sel.append(this.el("option", { value, selected: current === value ? "" : null }, label));
    return sel;
  }

  /** Rebuild the DOM and re-apply everything the app has told the panel so far. */
  refresh() {
    this.render();
    this.setDatasets(this.datasets, this.currentDataset);
    if (this.dataInfo) this.setDataInfo(this.dataInfo);
    if (this.graph) {
      this.setMaxDepth(this.state.maxDepth, this.state.zoneDepth);
      this.setMetrics(this.graph);
      this.setSelection(this.selected, this.graph);
    }
  }

  render() {
    const s = this.state;
    const h = this.h;
    this.host.replaceChildren();

    // Data
    this.datasetSelect = this.el("select", { onchange: (e) => h.onDataset(e.target.value) });
    const fileInput = this.el("input", { type: "file", accept: ".json,application/json", onchange: (e) => e.target.files[0] && h.onFile(e.target.files[0]) });
    this.dataInfoEl = this.el("p", { class: "muted small" });
    this.host.append(
      this.section(
        t("section.data"),
        this.el("label", { class: "control" }, this.el("span", {}, t("data.dataset")), this.datasetSelect),
        this.el("label", { class: "control" }, this.el("span", {}, t("data.openJson")), fileInput),
        this.dataInfoEl,
      ),
    );

    // View
    const viewGroup = this.el("div", { class: "segmented" });
    for (const v of ["2d", "3d"]) {
      viewGroup.append(this.el("button", { type: "button", "data-view": v, class: s.view === v ? "active" : "", onclick: () => h.onView(v) }, v.toUpperCase()));
    }
    this.viewGroup = viewGroup;
    const labelSelect = this.select(
      ["auto", "all", "none"].map((m) => [m, t(`view.labels.${m}`)]),
      s.labelMode,
      h.onLabels,
    );
    const colorSelect = this.select(
      ["kind", "height"].map((m) => [m, t(`view.colour.${m}`)]),
      s.colorBy,
      h.onColorBy,
    );
    this.layerGap = this.slider(t("view.layerGap"), "layerGap", 10, 300, 5, h.onLayerGap);
    const layers = this.el("input", { type: "checkbox", checked: s.showLayers ? "" : null, onchange: (e) => h.onShowLayers(e.target.checked) });
    const rotate = this.el("input", { type: "checkbox", checked: s.autoRotate ? "" : null, onchange: (e) => h.onAutoRotate(e.target.checked) });
    this.host.append(
      this.section(
        t("section.view"),
        this.el("div", { class: "control" }, this.el("span", {}, t("view.mode")), viewGroup),
        this.el("label", { class: "control" }, this.el("span", {}, t("view.labels")), labelSelect),
        this.el("label", { class: "control" }, this.el("span", {}, t("view.colourBy")), colorSelect),
        this.layerGap,
        this.el("label", { class: "control" }, this.el("span", {}, t("view.layerPlanes")), layers),
        this.el("label", { class: "control" }, this.el("span", {}, t("view.autoRotate")), rotate),
        this.el("div", { class: "buttons" }, this.el("button", { type: "button", onclick: h.onFit }, t("view.fit"))),
        this.el("p", { class: "muted small" }, t("view.help")),
      ),
    );

    // Edges: one switch per kind; it drives drawing, springs and diagnostics together.
    const kindList = this.el("div", { class: "kind-list" });
    for (const kind of EDGE_KINDS) {
      const box = this.el("input", { type: "checkbox", checked: s.kinds.has(kind) ? "" : null, onchange: (e) => h.onKinds(kind, e.target.checked) });
      kindList.append(this.el("label", { class: "kind-item" }, box, this.el("i", { class: "edge-swatch", style: `background:${edgeColor(kind)}` }), t(`edge.${kind}`)));
    }
    this.host.append(this.section(t("section.edges"), kindList, this.el("p", { class: "muted small" }, t("edges.help"))));

    // Physics
    this.host.append(
      this.section(
        t("section.physics"),
        this.el(
          "div",
          { class: "buttons" },
          this.el("button", { type: "button", class: "primary", onclick: h.onReheat }, t("physics.reheat")),
          this.el("button", { type: "button", onclick: h.onReset }, t("physics.reset")),
        ),
        this.slider(t("physics.repulsion"), "repulsion", 0, 1000, 5, (v) => h.onPhysics("repulsion", v)),
        this.slider(t("physics.stiffness"), "stiffness", 0, 0.2, 0.001, (v) => h.onPhysics("stiffness", v), (v) => v.toFixed(3)),
        this.slider(t("physics.restLength"), "restLength", 0, 200, 1, (v) => h.onPhysics("restLength", v)),
        this.slider(t("physics.gravity"), "gravity", 0, 0.2, 0.005, (v) => h.onPhysics("gravity", v), (v) => v.toFixed(3)),
        this.el("p", { class: "muted small" }, t("physics.help")),
      ),
    );

    // Zones
    this.depthSlider = this.slider(t("zones.depth"), "zoneDepth", 0, Math.max(0, s.maxDepth), 1, h.onZones, (v) => `${v} / ${s.maxDepth}`);
    this.host.append(this.section(t("section.zones"), this.depthSlider, this.el("p", { class: "muted small" }, t("zones.help"))));

    // Diagnostics
    this.metricsBody = this.el("div", { class: "metrics" });
    this.sharedList = this.el("ol", { class: "shared" });
    this.host.append(
      this.section(
        t("section.diagnostics"),
        this.el("p", { class: "muted small", style: "margin:0 0 6px" }, t("metric.scope")),
        this.metricsBody,
        this.el("h3", {}, t("metric.shared")),
        this.sharedList,
      ),
    );

    // Selection
    this.selectionBody = this.el("div", { class: "selection muted small" }, t("selection.empty"));
    this.host.append(this.section(t("section.selection"), this.selectionBody));

    // Legend
    const legend = this.el("div", { class: "legend" });
    for (const kind of ["function", "method", "class", "variable", "interface", "enum", "module"]) {
      legend.append(this.el("span", { class: "legend-item" }, this.el("i", { style: `background:${kindColor(kind)}` }), kindLabel(kind)));
    }
    legend.append(this.el("span", { class: "legend-item" }, this.el("i", { class: "cycle" }), t("legend.inCycle")));
    const edgeLegend = this.el("div", { class: "legend" });
    for (const kind of EDGE_KINDS) edgeLegend.append(this.el("span", { class: "legend-item" }, this.el("i", { class: "edge", style: `background:${edgeColor(kind)}` }), t(`edge.${kind}`)));
    edgeLegend.append(this.el("span", { class: "legend-item muted" }, t("legend.inferred")));
    this.host.append(this.section(t("section.legend"), legend, this.el("h3", {}, t("legend.edges")), edgeLegend));
  }

  setDatasets(datasets, current) {
    this.datasets = datasets;
    this.currentDataset = current;
    this.datasetSelect.replaceChildren();
    for (const d of datasets) {
      this.datasetSelect.append(this.el("option", { value: d.id, selected: d.id === current ? "" : null }, d.name));
    }
    this.datasetSelect.append(this.el("option", { value: "__custom__", disabled: "", selected: current === "__custom__" ? "" : null }, t("data.localFile")));
  }

  /** @param {object} info { label, nodes, edges, files } */
  setDataInfo(info) {
    this.dataInfo = info;
    this.dataInfoEl.textContent = t("app.dataInfo", info);
  }

  setView(view) {
    for (const b of this.viewGroup.children) b.classList.toggle("active", b.dataset.view === view);
  }

  setMaxDepth(maxDepth, value) {
    this.state.maxDepth = maxDepth;
    this.depthSlider.input.max = String(Math.max(0, maxDepth));
    this.depthSlider.input.value = String(value);
    this.depthSlider.output.textContent = `${value} / ${maxDepth}`;
  }

  setMetrics(graph) {
    this.graph = graph;
    const m = computeMetrics(graph);
    const pct = (v) => `${(v * 100).toFixed(1)}%`;
    const bar = (key, v) =>
      this.el(
        "div",
        { class: "metric-bar", title: t(`${key}.hint`) },
        this.el("span", { class: "metric-label" }, t(key)),
        this.el("span", { class: "bar" }, this.el("i", { style: `width:${Math.max(0, Math.min(1, v)) * 100}%` })),
        this.el("span", { class: "metric-value" }, pct(v)),
      );
    const kv = (key, v, hint = true) => this.el("div", { class: "metric-kv", title: hint ? t(`${key}.hint`) : null }, this.el("span", {}, t(key)), this.el("b", {}, String(v)));
    this.metricsBody.replaceChildren(
      bar("metric.treeScore", m.overall),
      bar("metric.spanning", m.treeScore),
      bar("metric.acyclicity", m.acyclicity),
      bar("metric.singleCaller", m.singleCallerRatio),
      bar("metric.dagness", m.dagness),
      this.el(
        "div",
        { class: "metric-grid" },
        kv("metric.declarations", m.nodes, false),
        kv("metric.edges", m.edges, false),
        kv("metric.activeEdges", m.activeEdges),
        kv("metric.initCycles", m.initCycles),
        kv("metric.components", m.components),
        kv("metric.roots", m.roots),
        kv("metric.leaves", m.leaves),
        kv("metric.maxHeight", m.maxHeight),
        kv("metric.surplus", m.surplusEdges),
        kv("metric.cycles", m.nontrivialSccs),
        kv("metric.selfLoops", m.selfLoops),
        kv("metric.multiCallers", m.multiCallers),
        kv("metric.dropped", m.dropped),
      ),
    );
    this.sharedList.replaceChildren();
    for (const n of topSharedNodes(graph)) {
      const li = this.el(
        "li",
        {},
        this.el("a", { href: "#", onclick: (e) => (e.preventDefault(), this.h.onSelectNode(n)) }, n.name),
        this.el("span", { class: "muted" }, ` ${t("metric.shared.callers", { count: n.inDegree })}`),
      );
      this.sharedList.append(li);
    }
    if (this.sharedList.children.length === 0) this.sharedList.append(this.el("li", { class: "muted" }, t("metric.shared.none")));
  }

  setSelection(node, graph) {
    this.selected = node;
    if (!node) {
      this.selectionBody.className = "selection muted small";
      this.selectionBody.replaceChildren(t("selection.empty"));
      return;
    }
    this.selectionBody.className = "selection";
    const callers = graph.links.filter((l) => l.target === node).map((l) => ({ n: l.source, l }));
    const callees = graph.links.filter((l) => l.source === node).map((l) => ({ n: l.target, l }));
    const list = (title, items) => {
      const ul = this.el("ul", {});
      for (const { n, l } of items) {
        ul.append(
          this.el(
            "li",
            {},
            this.el("i", { class: "edge-dot", style: `background:${edgeColor(l.kind)}`, title: t(`edge.${l.kind}`) }),
            this.el("a", { href: "#", onclick: (e) => (e.preventDefault(), this.h.onSelectNode(n)) }, n.name),
            this.el("span", { class: "muted small" }, ` ${t(`edge.${l.kind}`)}${l.inferred ? "*" : ""} · ${n.file}`),
          ),
        );
      }
      if (items.length === 0) ul.append(this.el("li", { class: "muted" }, t("selection.none")));
      return this.el("div", {}, this.el("h3", {}, `${title} (${items.length})`), ul);
    };
    const flags = [t("selection.height", { height: node.height })];
    if (node.inCycle) flags.push(t("selection.inCycle"));
    if (node.exported) flags.push(t("selection.exported"));
    this.selectionBody.replaceChildren(
      this.el("div", { class: "sel-title" }, this.el("i", { style: `background:${kindColor(node.kind)}` }), this.el("b", {}, node.name), this.el("span", { class: "muted" }, ` ${kindLabel(node.kind)}`)),
      this.el("div", { class: "small mono" }, node.line ? `${node.file}:${node.line}` : node.file),
      this.el("div", { class: "small muted" }, flags.join(", ")),
      list(t("selection.callers"), callers),
      list(t("selection.callees"), callees),
    );
  }
}
