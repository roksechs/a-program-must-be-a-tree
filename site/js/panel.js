// Property panel: builds the right-hand side controls and diagnostics.
// The panel is deliberately framework-free: it renders plain DOM and reports
// changes through callbacks so the app stays in charge of state.
import { kindColor } from "./colors.js";
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

  render() {
    const s = this.state;
    const h = this.h;
    this.host.replaceChildren();

    // Data
    this.datasetSelect = this.el("select", { onchange: (e) => h.onDataset(e.target.value) });
    const fileInput = this.el("input", { type: "file", accept: ".json,application/json", onchange: (e) => e.target.files[0] && h.onFile(e.target.files[0]) });
    this.dataInfo = this.el("p", { class: "muted small" });
    this.host.append(
      this.section(
        "Data",
        this.el("label", { class: "control" }, this.el("span", {}, "Dataset"), this.datasetSelect),
        this.el("label", { class: "control" }, this.el("span", {}, "Open JSON"), fileInput),
        this.dataInfo,
      ),
    );

    // View
    const viewGroup = this.el("div", { class: "segmented" });
    for (const v of ["2d", "3d"]) {
      const b = this.el("button", { type: "button", class: s.view === v ? "active" : "", onclick: () => h.onView(v) }, v.toUpperCase());
      viewGroup.append(b);
    }
    this.viewGroup = viewGroup;
    const labelSelect = this.el("select", { onchange: (e) => h.onLabels(e.target.value) });
    for (const m of ["auto", "all", "none"]) labelSelect.append(this.el("option", { value: m, selected: s.labelMode === m ? "" : null }, m));
    const colorSelect = this.el("select", { onchange: (e) => h.onColorBy(e.target.value) });
    for (const m of ["kind", "height"]) colorSelect.append(this.el("option", { value: m, selected: s.colorBy === m ? "" : null }, m));
    this.layerGap = this.slider("Layer gap (3D)", "layerGap", 10, 300, 5, h.onLayerGap);
    const layers = this.el("input", { type: "checkbox", checked: s.showLayers ? "" : null, onchange: (e) => h.onShowLayers(e.target.checked) });
    const rotate = this.el("input", { type: "checkbox", checked: s.autoRotate ? "" : null, onchange: (e) => h.onAutoRotate(e.target.checked) });
    this.host.append(
      this.section(
        "View",
        this.el("div", { class: "control" }, this.el("span", {}, "Mode"), viewGroup),
        this.el("label", { class: "control" }, this.el("span", {}, "Labels"), labelSelect),
        this.el("label", { class: "control" }, this.el("span", {}, "Colour by"), colorSelect),
        this.layerGap,
        this.el("label", { class: "control" }, this.el("span", {}, "Layer planes (3D)"), layers),
        this.el("label", { class: "control" }, this.el("span", {}, "Auto-rotate (3D)"), rotate),
        this.el("div", { class: "buttons" }, this.el("button", { type: "button", onclick: h.onFit }, "Fit to view")),
        this.el("p", { class: "muted small" }, "2D: drag nodes, wheel to zoom, drag background to pan. 3D: drag to orbit, shift+drag to pan, wheel to zoom. Click a node to inspect it."),
      ),
    );

    // Physics
    this.host.append(
      this.section(
        "Physics",
        this.el(
          "div",
          { class: "buttons" },
          this.el("button", { type: "button", class: "primary", onclick: h.onReheat }, "Recompute (reheat)"),
          this.el("button", { type: "button", onclick: h.onReset }, "Reset positions"),
        ),
        this.slider("Repulsion (1/d)", "repulsion", 0, 1000, 5, (v) => h.onPhysics("repulsion", v)),
        this.slider("Spring stiffness", "stiffness", 0, 0.2, 0.001, (v) => h.onPhysics("stiffness", v), (v) => v.toFixed(3)),
        this.slider("Spring rest length", "restLength", 0, 200, 1, (v) => h.onPhysics("restLength", v)),
        this.slider("Zone cohesion", "cohesion", 0, 1, 0.01, (v) => h.onPhysics("cohesion", v), (v) => v.toFixed(2)),
        this.slider("Gravity", "gravity", 0, 0.2, 0.005, (v) => h.onPhysics("gravity", v), (v) => v.toFixed(3)),
        this.el("p", { class: "muted small" }, "Repulsion between every pair of nodes is inversely proportional to their distance; every edge is a spring whose pull is proportional to its length. Use Recompute when the layout gets stuck in an early configuration."),
      ),
    );

    // Zones
    this.depthSlider = this.slider("Directory depth", "zoneDepth", 0, Math.max(0, s.maxDepth), 1, h.onZones, (v) => `${v} / ${s.maxDepth}`);
    const files = this.el("input", { type: "checkbox", checked: s.showFiles ? "" : null, onchange: (e) => h.onZones(undefined, e.target.checked) });
    this.host.append(
      this.section(
        "Zones",
        this.depthSlider,
        this.el("label", { class: "control" }, this.el("span", {}, "File zones"), files),
        this.el("p", { class: "muted small" }, "Depth 0 hides directory zones; the maximum shows every directory in the codebase. Zones are convex hulls around the declarations they contain."),
      ),
    );

    // Diagnostics
    this.metricsBody = this.el("div", { class: "metrics" });
    this.sharedList = this.el("ol", { class: "shared" });
    this.host.append(
      this.section(
        "Diagnostics: is it a tree?",
        this.metricsBody,
        this.el("h3", {}, "Most shared declarations"),
        this.sharedList,
      ),
    );

    // Selection
    this.selectionBody = this.el("div", { class: "selection muted small" }, "Click a node to see its callers and callees.");
    this.host.append(this.section("Selection", this.selectionBody));

    // Legend
    const legend = this.el("div", { class: "legend" });
    for (const kind of ["function", "method", "class", "variable", "interface", "enum", "module"]) {
      legend.append(this.el("span", { class: "legend-item" }, this.el("i", { style: `background:${kindColor(kind)}` }), kind));
    }
    legend.append(this.el("span", { class: "legend-item" }, this.el("i", { class: "cycle" }), "in a cycle"));
    this.host.append(this.section("Legend", legend));
  }

  setDatasets(datasets, current) {
    this.datasetSelect.replaceChildren();
    for (const d of datasets) {
      this.datasetSelect.append(this.el("option", { value: d.id, selected: d.id === current ? "" : null }, d.name));
    }
    this.datasetSelect.append(this.el("option", { value: "__custom__", disabled: "", selected: current === "__custom__" ? "" : null }, "(local file)"));
  }

  setDataInfo(text) {
    this.dataInfo.textContent = text;
  }

  setView(view) {
    for (const b of this.viewGroup.children) b.classList.toggle("active", b.textContent.toLowerCase() === view);
  }

  setMaxDepth(maxDepth, value) {
    this.state.maxDepth = maxDepth;
    this.depthSlider.input.max = String(Math.max(0, maxDepth));
    this.depthSlider.input.value = String(value);
    this.depthSlider.output.textContent = `${value} / ${maxDepth}`;
  }

  setMetrics(graph) {
    const m = computeMetrics(graph);
    const pct = (v) => `${(v * 100).toFixed(1)}%`;
    const bar = (label, v, hint) =>
      this.el(
        "div",
        { class: "metric-bar", title: hint },
        this.el("span", { class: "metric-label" }, label),
        this.el("span", { class: "bar" }, this.el("i", { style: `width:${Math.max(0, Math.min(1, v)) * 100}%` })),
        this.el("span", { class: "metric-value" }, pct(v)),
      );
    const kv = (label, v, hint) => this.el("div", { class: "metric-kv", title: hint }, this.el("span", {}, label), this.el("b", {}, String(v)));
    this.metricsBody.replaceChildren(
      bar("Tree score", m.overall, "Average of the four ratios below."),
      bar("Spanning ratio", m.treeScore, "(nodes - components) / edges. Exactly 1 for a forest; lower when declarations are reached by more than one path."),
      bar("Acyclicity", m.acyclicity, "Share of declarations that are not part of any call cycle."),
      bar("Single caller", m.singleCallerRatio, "Share of declarations with at most one caller."),
      bar("DAG-ness", m.dagness, "Share of edges that do not participate in a cycle."),
      this.el(
        "div",
        { class: "metric-grid" },
        kv("Declarations", m.nodes),
        kv("Edges", m.edges),
        kv("Components", m.components, "Weakly connected components."),
        kv("Roots", m.roots, "Declarations nobody calls."),
        kv("Leaves", m.leaves, "Declarations that call nothing."),
        kv("Max height", m.maxHeight, "Longest call chain (layers in 3D)."),
        kv("Surplus edges", m.surplusEdges, "Edges beyond what a forest would need."),
        kv("Cycles (SCCs)", m.nontrivialSccs, "Non-trivial strongly connected components."),
        kv("Self loops", m.selfLoops, "Directly recursive declarations."),
        kv("Multi-caller nodes", m.multiCallers, "Declarations called from more than one place."),
        kv("Dropped edges", m.dropped, "Edges whose endpoints were not declared."),
      ),
    );
    this.sharedList.replaceChildren();
    for (const n of topSharedNodes(graph)) {
      const li = this.el("li", {}, this.el("a", { href: "#", onclick: (e) => (e.preventDefault(), this.h.onSelectNode(n)) }, n.name), this.el("span", { class: "muted" }, ` ${n.inDegree} callers`));
      this.sharedList.append(li);
    }
    if (this.sharedList.children.length === 0) this.sharedList.append(this.el("li", { class: "muted" }, "none: every declaration has at most one caller"));
  }

  setSelection(node, graph) {
    if (!node) {
      this.selectionBody.className = "selection muted small";
      this.selectionBody.replaceChildren("Click a node to see its callers and callees.");
      return;
    }
    this.selectionBody.className = "selection";
    const callers = graph.links.filter((l) => l.target === node).map((l) => l.source);
    const callees = graph.links.filter((l) => l.source === node).map((l) => l.target);
    const list = (title, items) => {
      const ul = this.el("ul", {});
      for (const n of items) {
        ul.append(this.el("li", {}, this.el("a", { href: "#", onclick: (e) => (e.preventDefault(), this.h.onSelectNode(n)) }, n.name), this.el("span", { class: "muted small" }, ` ${n.file}`)));
      }
      if (items.length === 0) ul.append(this.el("li", { class: "muted" }, "none"));
      return this.el("div", {}, this.el("h3", {}, `${title} (${items.length})`), ul);
    };
    this.selectionBody.replaceChildren(
      this.el("div", { class: "sel-title" }, this.el("i", { style: `background:${kindColor(node.kind)}` }), this.el("b", {}, node.name), this.el("span", { class: "muted" }, ` ${node.kind}`)),
      this.el("div", { class: "small mono" }, node.line ? `${node.file}:${node.line}` : node.file),
      this.el("div", { class: "small muted" }, `height ${node.height}${node.inCycle ? ", in a cycle" : ""}${node.exported ? ", exported" : ""}`),
      list("Callers", callers),
      list("Callees", callees),
    );
  }
}
