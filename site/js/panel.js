// Property panel: builds the right-hand side controls and diagnostics.
// The panel is deliberately framework-free: it renders plain DOM and reports
// changes through callbacks so the app stays in charge of state. All visible
// strings go through the translator so the panel can be re-rendered in
// another language with `refresh()`.
import { EDGE_KINDS, edgeColor, kindColor } from "./colors.js";
import { POPULAR_REPOS } from "./githubAnalyzer.js";
import { kindLabel, t } from "./i18n.js";
import { localFolderSupported } from "./localAnalyzer.js";
import { entryPoints, independence, islands, linkLift, naturalScope, scopeEscapes } from "./metrics.js";

const GITHUB_SEARCH_DEBOUNCE_MS = 400;

// Which sections start expanded on a browser that has never been here. The
// panel has more sections than fit a screen at once, so most start collapsed
// and the two anyone needs to get a graph on screen at all start open;
// Selection also opens itself the moment a node is actually selected (see
// setSelection), since that is the one section whose content arrives in
// response to something the user just did.
const DEFAULT_OPEN_SECTIONS = ["data", "view"];
const SECTIONS_STORAGE_KEY = "panelSections";

// Sentinel values in the one dropdown that is every way of choosing what to
// look at: an example, something opened before, or something new. None of
// FOLDER_OPTION/JSON_OPTION/GITHUB_OPTION is a dataset id — picking one is a
// command, not a selection, so the handler that fires it puts the visible
// value straight back (see currentValue()) rather than leaving the dropdown
// parked on an action. GITHUB_OPTION is the one exception: it reveals the
// repo field instead of firing anything by itself (setGithubMode), so it
// stays selected while that field is showing. CUSTOM_OPTION is the disabled
// entry shown whenever what is loaded did not come from data/index.json and
// has nowhere else in the dropdown to be selected — a JSON file opened from
// disk (never remembered, see analysisCache.js) or a `?data=<url>`; a folder
// or a GitHub repo has a real "Recently opened" entry to show as selected
// instead, once analysisCache.js has saved it (see recentOptionValue).
const FOLDER_OPTION = "__folder__";
const JSON_OPTION = "__json__";
const GITHUB_OPTION = "__github__";
export const CUSTOM_OPTION = "__custom__";

/** The dropdown value standing for one "Recently opened" entry (setRecent). */
export function recentOptionValue(entry) {
  return `recent:${entry.kind}:${entry.key}`;
}

export class Panel {
  /**
   * @param {HTMLElement} host
   * @param {object} state shared mutable state (see app.js)
   * @param {object} handlers { onDataset, onFile, onOpenFolder, onGithub, onGithubSearch, onLoadRecent, onReanalyzeRecent, onDeleteRecent, onExportJson, onPhysics, onReheat, onReset, onFit, onFitNodes, onTop, onZones, onLabels, onColorBy, onLayerGap, onAutoRotate, onSelectNode, onFocusNode, onClearPath, onHighlight, onExportReport }
   */
  constructor(host, state, handlers) {
    this.host = host;
    this.state = state;
    this.h = handlers;
    // Remembered so the panel can be rebuilt (e.g. after a language change).
    this.datasets = [];
    this.currentDataset = null;
    this.dataInfo = null;
    this.recent = [];
    // recentOptionValue(entry) -> entry, so the dropdown's onchange can turn
    // the <option> it just got back into the entry onLoadRecent needs.
    this.recentByValue = new Map();
    this.graph = null;
    this.selected = null;
    // Whether the GitHub repo field is showing. Panel state rather than
    // something derived from the dropdown's value: loading a repo re-selects
    // the dropdown's "(local file)" sentinel, which would otherwise hide the
    // field the moment it had been used, and render() would lose it on a
    // language change.
    this.githubMode = false;
    // Which sections are expanded, by the stable id section() is given (never
    // the translated title). Kept on the instance because render() rebuilds
    // every section from scratch — on a language change, say — and a freshly
    // built <details> would otherwise come back at its default state and
    // silently discard what the user had opened.
    this.openSections = new Set(loadOpenSections());
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

  /**
   * One collapsible section. `id` is a stable key (not the translated title)
   * so the expanded/collapsed state survives both a language change and a
   * reload. A native <details>/<summary> rather than a hand-rolled toggle:
   * the keyboard behaviour, the ARIA semantics and the open state all come
   * for free, and `hidden` on the body would have had to reimplement each.
   */
  section(id, title, ...children) {
    const box = this.el(
      "details",
      { class: "panel-section", open: this.openSections.has(id) ? "" : null },
      this.el("summary", {}, this.el("h2", {}, title)),
      this.el("div", { class: "panel-body" }, ...children),
    );
    box.dataset.section = id;
    box.addEventListener("toggle", () => {
      if (box.open) this.openSections.add(id);
      else this.openSections.delete(id);
      saveOpenSections(this.openSections);
    });
    return box;
  }

  /**
   * Show or hide the GitHub repo field. Selecting "GitHub repo…" in the
   * dataset dropdown turns it on; anything that starts a load from somewhere
   * else turns it back off, so the panel never offers two sources at once.
   */
  setGithubMode(on) {
    this.githubMode = on;
    this.githubRow.hidden = !on;
    if (on) this.githubInput.focus();
    else this.githubResults.hidden = true;
  }

  /** Expand a section from code (Selection, when a node is selected). */
  openSection(id) {
    this.openSections.add(id);
    const box = this.host.querySelector(`[data-section="${id}"]`);
    if (box) box.open = true;
    saveOpenSections(this.openSections);
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

  /**
   * Two-handled range: two overlapping native `<input type=range>` sharing
   * one visual track (only their thumbs are interactive — the tracks
   * themselves are transparent, see styles.css's `.dual-slider`), plus a
   * `.range-fill` bar redrawn on every change to show the selected span.
   * Each handle refuses to cross the other rather than swap places, so
   * "low" and "high" always mean what their own thumb suggests.
   */
  rangeSlider(label, lo, hi, min, max, step, onChange, format = (v) => v) {
    const out = this.el("output", {}, `${format(lo)}–${format(hi)}`);
    const fill = this.el("div", { class: "range-fill" });
    const track = this.el("div", { class: "range-track" });
    const minInput = this.el("input", { type: "range", min, max, step, value: lo });
    const maxInput = this.el("input", { type: "range", min, max, step, value: hi });
    const pct = (v) => (max > min ? ((v - min) / (max - min)) * 100 : 0);
    const refresh = () => {
      const a = Number(minInput.value);
      const b = Number(maxInput.value);
      fill.style.left = `${pct(a)}%`;
      fill.style.width = `${Math.max(0, pct(b) - pct(a))}%`;
      out.textContent = `${format(a)}–${format(b)}`;
    };
    minInput.addEventListener("input", () => {
      if (Number(minInput.value) > Number(maxInput.value)) minInput.value = maxInput.value;
      refresh();
      onChange(Number(minInput.value), Number(maxInput.value));
    });
    maxInput.addEventListener("input", () => {
      if (Number(maxInput.value) < Number(minInput.value)) maxInput.value = minInput.value;
      refresh();
      onChange(Number(minInput.value), Number(maxInput.value));
    });
    refresh();
    const wrap = this.el("div", { class: "dual-slider" }, track, fill, minInput, maxInput);
    const row = this.el("label", { class: "control" }, this.el("span", {}, label), wrap, out);
    row.minInput = minInput;
    row.maxInput = maxInput;
    row.output = out;
    row.refresh = refresh;
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
    this.setRecent(this.recent);
    if (this.graph) {
      this.setMaxDepth(this.state.maxDepth, this.state.zoneMinDepth, this.state.zoneMaxDepth);
      this.setMetrics(this.graph);
      this.setSelection(this.selected, this.graph);
    }
  }

  render() {
    const s = this.state;
    const h = this.h;
    this.host.replaceChildren();

    // Data
    // One dropdown is every way of choosing what to look at: examples,
    // something opened before, and something new, as three optgroups in a
    // fixed order — a returning visitor's most likely destinations (an
    // example, then their own history) before the actions that leave the
    // page to go get something (see the sentinel comment above). A native
    // <select> rather than a custom listbox: keyboard navigation and
    // type-ahead come for free, and every entry is exactly one line, which
    // is all any of them need.
    //
    // Picking Folder…/JSON file…/GitHub repo… is a command, not a selection
    // — nothing about what is loaded has changed yet, and for the first two
    // it may never (the picker can be cancelled) — so the handler puts the
    // select's value straight back with currentValue() rather than leaving
    // it parked on the command. GitHub repo… is the one that stays selected:
    // it reveals a field the user is about to type into, not fire-and-forget.
    const currentValue = () => (this.githubMode ? GITHUB_OPTION : this.currentDataset);
    this.examplesGroup = this.el("optgroup", { label: t("data.examples") });
    this.recentGroup = this.el("optgroup", { label: t("data.recent") });
    const folderSupported = localFolderSupported();
    const loadNewGroup = this.el(
      "optgroup",
      { label: t("data.loadNew") },
      this.el("option", { value: FOLDER_OPTION, disabled: folderSupported ? null : "", title: folderSupported ? null : t("data.folderUnsupported") }, t("data.openFolder")),
      this.el("option", { value: JSON_OPTION }, t("data.openJson")),
      this.el("option", { value: GITHUB_OPTION }, t("data.githubOption")),
    );
    this.datasetSelect = this.el(
      "select",
      {
        onchange: (e) => {
          const value = e.target.value;
          if (value === FOLDER_OPTION) {
            this.setGithubMode(false);
            e.target.value = currentValue();
            h.onOpenFolder();
            return;
          }
          if (value === JSON_OPTION) {
            this.setGithubMode(false);
            e.target.value = currentValue();
            fileInput.click();
            return;
          }
          if (value === GITHUB_OPTION) {
            this.setGithubMode(true);
            return;
          }
          this.setGithubMode(false);
          const entry = this.recentByValue.get(value);
          if (entry) h.onLoadRecent(entry);
          else h.onDataset(value);
        },
      },
      this.examplesGroup,
      this.recentGroup,
      loadNewGroup,
    );
    // Hidden: nothing to render, since the option that triggers it
    // (JSON_OPTION, above) already is one. .click() from that onchange
    // handler keeps the user gesture the picker needs.
    const fileInput = this.el("input", {
      type: "file",
      accept: ".json,application/json",
      hidden: "",
      onchange: (e) => {
        if (!e.target.files[0]) return;
        h.onFile(e.target.files[0]);
        e.target.value = ""; // so re-picking the same file fires change again
      },
    });
    this.githubInput = this.el("input", { type: "text", placeholder: t("data.githubPlaceholder"), autocomplete: "off" });
    const githubInput = this.githubInput;
    this.githubResults = this.el("div", { class: "github-results", hidden: "" });
    const githubResults = this.githubResults;
    const hideResults = () => (githubResults.hidden = true);
    const loadGithub = (spec) => {
      hideResults();
      githubInput.value = spec;
      h.onGithub(spec);
    };
    const submitGithub = () => githubInput.value.trim() && loadGithub(githubInput.value.trim());
    const githubBtn = this.el("button", { type: "button", onclick: submitGithub }, t("data.githubLoad"));
    const showGithubResults = (items) => {
      githubResults.replaceChildren(
        ...items.map((r) =>
          this.el(
            "button",
            { type: "button", class: "github-result", onmousedown: (e) => e.preventDefault(), onclick: () => loadGithub(r.full_name) },
            this.el("span", { class: "github-result-name" }, r.full_name),
            this.el("span", { class: "muted small github-result-desc" }, r.description ?? ""),
          ),
        ),
      );
      githubResults.hidden = items.length === 0;
    };
    // GitHub's search API has its own, much stricter rate limit (10/minute
    // unauthenticated, versus 60/hour for fetching a repo itself), so this
    // debounces and never fires for a query shorter than 2 characters.
    let searchTimer = null;
    githubInput.addEventListener("input", () => {
      clearTimeout(searchTimer);
      const q = githubInput.value.trim();
      if (q.length === 0) {
        showGithubResults(POPULAR_REPOS);
        return;
      }
      if (q.length < 2) {
        hideResults();
        return;
      }
      searchTimer = setTimeout(() => h.onGithubSearch(q).then(showGithubResults, hideResults), GITHUB_SEARCH_DEBOUNCE_MS);
    });
    githubInput.addEventListener("focus", () => {
      if (githubInput.value.trim().length === 0) showGithubResults(POPULAR_REPOS);
    });
    // A click on a result fires this input's blur before its own onclick;
    // onmousedown above (preventDefault, so focus never actually leaves the
    // input) is what makes the click land instead of hiding the list first.
    githubInput.addEventListener("blur", hideResults);
    githubInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") submitGithub();
      else if (e.key === "Escape") hideResults();
    });
    this.githubRow = this.el("div", { hidden: this.githubMode ? null : "" }, this.el("label", { class: "control" }, this.el("span", {}, t("data.github")), githubInput, githubBtn), githubResults);
    this.dataInfoEl = this.el("p", { class: "muted small" });
    // Re-analyze / remove only apply to a "Recently opened" entry, and only
    // the one currently loaded — there is nowhere left in the dropdown for a
    // per-entry button now that entries are plain <option>s, so this shows
    // instead of one, right where the loaded entry's own name is (see
    // updateRecentActions, called whenever setDatasets/setRecent might have
    // changed which one that is).
    this.recentActionsEl = this.el("div", { class: "buttons", hidden: "" });
    // Downloads the raw analyzer document exactly as installed — see
    // app.js's exportJson() — so a graph that looks wrong can be inspected
    // or handed off without reproducing the analysis that produced it.
    const exportBtn = this.el("button", { type: "button", onclick: () => h.onExportJson() }, t("data.exportJson"));
    this.host.append(
      this.section(
        "data",
        t("section.data"),
        this.el("label", { class: "control" }, this.el("span", {}, t("data.open")), this.datasetSelect),
        fileInput,
        this.githubRow,
        this.dataInfoEl,
        this.recentActionsEl,
        this.el("div", { class: "buttons" }, exportBtn),
      ),
    );

    // View & Physics: what the camera shows and how the layout moves are two
    // faces of one section, not two separate ones — merged so both are one
    // scroll away from each other instead of split by the Edges section.
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
    const rotate = this.el("input", { type: "checkbox", checked: s.autoRotate ? "" : null, onchange: (e) => h.onAutoRotate(e.target.checked) });
    this.host.append(
      this.section(
        "view",
        t("section.view"),
        this.el("label", { class: "control" }, this.el("span", {}, t("view.labels")), labelSelect),
        this.el("label", { class: "control" }, this.el("span", {}, t("view.colourBy")), colorSelect),
        this.layerGap,
        this.el("label", { class: "control" }, this.el("span", {}, t("view.autoRotate")), rotate),
        this.el(
          "div",
          { class: "buttons" },
          this.el("button", { type: "button", onclick: h.onFit }, t("view.fit")),
          this.el("button", { type: "button", onclick: h.onTop }, t("view.top")),
        ),
        this.el("p", { class: "muted small" }, t("view.help")),
        this.el("h3", {}, t("section.physics")),
        this.el(
          "div",
          { class: "buttons" },
          this.el("button", { type: "button", class: "primary", onclick: h.onReheat }, t("physics.reheat")),
          this.el("button", { type: "button", onclick: h.onReset }, t("physics.reset")),
        ),
        this.slider(t("physics.repulsion"), "repulsion", 0, 1000, 5, (v) => h.onPhysics("repulsion", v)),
        this.slider(t("physics.stiffness"), "stiffness", 0, 0.2, 0.001, (v) => h.onPhysics("stiffness", v), (v) => v.toFixed(3)),
        this.slider(t("physics.restLength"), "restLength", 0, 200, 1, (v) => h.onPhysics("restLength", v)),
        this.el("p", { class: "muted small" }, t("physics.help")),
      ),
    );

    // Edges: one switch per kind; it drives drawing, springs and diagnostics together.
    const kindList = this.el("div", { class: "kind-list" });
    for (const kind of EDGE_KINDS) {
      const box = this.el("input", { type: "checkbox", checked: s.kinds.has(kind) ? "" : null, onchange: (e) => h.onKinds(kind, e.target.checked) });
      kindList.append(this.el("label", { class: "kind-item" }, box, this.el("i", { class: "edge-swatch", style: `background:${edgeColor(kind)}` }), t(`edge.${kind}`)));
    }
    this.host.append(this.section("edges", t("section.edges"), kindList, this.el("p", { class: "muted small" }, t("edges.help"))));

    // Zones
    this.depthSlider = this.rangeSlider(t("zones.depth"), s.zoneMinDepth, s.zoneMaxDepth, 0, Math.max(0, s.maxDepth), 1, h.onZones, (v) => v);
    this.host.append(this.section("zones", t("section.zones"), this.depthSlider, this.el("p", { class: "muted small" }, t("zones.help"))));

    // Diagnostics: three questions, each with the declarations or
    // dependencies behind its number (see setMetrics).
    this.metricsBody = this.el("div", { class: "metrics" });
    this.host.append(
      this.section(
        "diagnostics",
        t("section.diagnostics"),
        this.el("p", { class: "muted small", style: "margin:0 0 6px" }, t("metric.scope")),
        this.metricsBody,
      ),
    );

    // Selection
    this.selectionBody = this.el("div", { class: "selection muted small" }, t("selection.empty"));
    this.pathResultEl = this.el("div", { class: "path-result", hidden: "" });
    this.host.append(this.section("selection", t("section.selection"), this.selectionBody, this.pathResultEl));

    // Legend
    const legend = this.el("div", { class: "legend" });
    for (const kind of ["function", "method", "class", "variable", "interface", "enum", "module"]) {
      legend.append(this.el("span", { class: "legend-item" }, this.el("i", { style: `background:${kindColor(kind)}` }), kindLabel(kind)));
    }
    legend.append(this.el("span", { class: "legend-item" }, this.el("i", { class: "cycle" }), t("legend.inCycle")));
    const edgeLegend = this.el("div", { class: "legend" });
    for (const kind of EDGE_KINDS) edgeLegend.append(this.el("span", { class: "legend-item" }, this.el("i", { class: "edge", style: `background:${edgeColor(kind)}` }), t(`edge.${kind}`)));
    edgeLegend.append(this.el("span", { class: "legend-item muted" }, t("legend.inferred")));
    this.host.append(this.section("legend", t("section.legend"), legend, this.el("h3", {}, t("legend.edges")), edgeLegend));
  }

  setDatasets(datasets, current) {
    this.datasets = datasets;
    this.currentDataset = current;
    this.examplesGroup.replaceChildren(...datasets.map((d) => this.el("option", { value: d.id }, d.name)));
    // CUSTOM_OPTION has no <option> of its own in either optgroup — it is
    // only ever reached from a JSON file opened from disk or a ?data=<url>,
    // neither of which is a "Recently opened" entry — so it is appended
    // bare, disabled, and only while actually current: a JSON file has
    // nowhere else in the dropdown to show as selected.
    const customOption = current === CUSTOM_OPTION ? this.el("option", { value: CUSTOM_OPTION, disabled: "" }, t("data.localFile")) : null;
    this.datasetSelect.querySelector(`option[value="${CUSTOM_OPTION}"]`)?.remove();
    if (customOption) this.datasetSelect.append(customOption);
    this.applySelectValue();
  }

  /** @param {object} info { label, nodes, edges, files } */
  setDataInfo(info) {
    this.dataInfo = info;
    this.dataInfoEl.textContent = t("app.dataInfo", info);
  }

  /** @param {object[]} entries analysisCache.js rows, newest first */
  setRecent(entries) {
    this.recent = entries;
    this.recentByValue = new Map(entries.map((entry) => [recentOptionValue(entry), entry]));
    const when = new Intl.DateTimeFormat(undefined, { dateStyle: "short", timeStyle: "short" });
    this.recentGroup.replaceChildren(
      ...entries.map((entry) => this.el("option", { value: recentOptionValue(entry) }, `${entry.label} — ${when.format(entry.analyzedAt)}`)),
    );
    this.applySelectValue();
  }

  /**
   * Rebuilding an optgroup's <option>s (setDatasets/setRecent, a language
   * change) resets what the <select> shows as chosen even when the value
   * that should be selected is untouched, so both call this afterwards
   * instead of setting `selected` per option themselves. Re-derives the
   * re-analyze/remove row at the same time: they track the same thing,
   * "which entry is current", so a value never has one updated without the
   * other.
   */
  applySelectValue() {
    this.datasetSelect.value = this.githubMode ? GITHUB_OPTION : this.currentDataset;
    const entry = this.recentByValue.get(this.currentDataset);
    this.recentActionsEl.hidden = !entry;
    if (entry) {
      this.recentActionsEl.replaceChildren(
        this.el("button", { type: "button", onclick: () => this.h.onReanalyzeRecent(entry) }, t("data.reanalyze")),
        this.el("button", { type: "button", onclick: () => this.h.onDeleteRecent(entry) }, t("data.remove")),
      );
    }
  }

  setMaxDepth(maxDepth, minValue, maxValue) {
    this.state.maxDepth = maxDepth;
    const cap = String(Math.max(0, maxDepth));
    this.depthSlider.minInput.max = cap;
    this.depthSlider.maxInput.max = cap;
    this.depthSlider.minInput.value = String(minValue);
    this.depthSlider.maxInput.value = String(maxValue);
    this.depthSlider.refresh();
  }

  /**
   * Render the three diagnostics. Each is a heading with its own figure, a
   * short reading of what that figure means, the declarations or dependencies
   * it is actually pointing at, and a button that downloads exactly those as
   * a report (app.js's exportReport). A number alone says a program is not a
   * tree; the list is what makes it something to act on.
   */
  setMetrics(graph) {
    this.graph = graph;
    const entries = entryPoints(graph);
    const escapes = scopeEscapes(graph);
    const owned = independence(graph);
    const adrift = islands(graph);

    const heading = (key, figure) => this.el("h3", { class: "metric-head" }, this.el("span", {}, t(key)), this.el("b", {}, figure));
    const hint = (key) => this.el("p", { class: "muted small metric-hint" }, t(key));
    const nodeLink = (node, trailing) =>
      this.el(
        "li",
        {},
        this.el("a", { href: "#", onclick: (e) => (e.preventDefault(), this.h.onSelectNode(node)) }, node.name),
        trailing ? this.el("span", { class: "muted" }, ` ${trailing}`) : "",
      );
    const exportButton = (metric, build) =>
      this.el("div", { class: "buttons" }, this.el("button", { type: "button", onclick: () => this.h.onExportReport(metric, build()) }, t("metric.export")));
    // A list long enough to read, with the rest reachable through the export
    // — a panel that printed every one of several hundred entry points would
    // be a worse way to look at them than the file it can hand over.
    const LIST_LIMIT = 12;
    const more = (shown, total) => (total > shown ? this.el("li", { class: "muted" }, t("metric.more", { count: total - shown })) : "");

    // 1. Entry points.
    const entryList = this.el("ol", { class: "shared" });
    for (const node of entries.slice(0, LIST_LIMIT)) entryList.append(nodeLink(node, `${node.kind} · ${node.file}`));
    if (entries.length === 0) entryList.append(this.el("li", { class: "muted" }, t("metric.entryPoints.none")));
    else entryList.append(more(Math.min(LIST_LIMIT, entries.length), entries.length));

    // 2. Scope escapes, one row per lift.
    const escapeList = this.el("div", { class: "lift-list" });
    for (const { lift, edges } of escapes.buckets) {
      escapeList.append(
        this.el(
          "button",
          {
            type: "button",
            class: "lift-row",
            title: t("metric.escapes.show"),
            // Highlighting the bucket goes through the path overlay (see
            // app.js's onHighlight): both endpoints of every edge, so the
            // edges have something to be drawn between.
            onclick: () => this.h.onHighlight(new Set(edges.flatMap((l) => [l.source, l.target])), new Set(edges)),
          },
          this.el("span", { class: "lift-label" }, t("metric.escapes.lift", { lift })),
          this.el("span", { class: "bar" }, this.el("i", { style: `width:${escapes.escapes === 0 ? 0 : (edges.length / escapes.escapes) * 100}%` })),
          this.el("span", { class: "metric-value" }, String(edges.length)),
        ),
      );
    }
    if (escapes.buckets.length === 0) escapeList.append(this.el("p", { class: "muted small" }, t("metric.escapes.none")));

    // 3. Independence, least first.
    const ownedList = this.el("ol", { class: "shared" });
    for (const { node, score, callees } of owned.nodes.slice(0, LIST_LIMIT)) {
      ownedList.append(nodeLink(node, t("metric.independence.of", { score: score.toFixed(2), count: callees })));
    }
    if (owned.nodes.length === 0) ownedList.append(this.el("li", { class: "muted" }, t("metric.independence.none")));
    else ownedList.append(more(Math.min(LIST_LIMIT, owned.nodes.length), owned.nodes.length));

    // 4. Islands, largest first, each a button that both highlights it and
    // frames it in the view (onFitNodes) — "which piece is this" and "let me
    // look at just that piece" are the same click. Islands of one are only
    // counted (see metrics.js's islands), since they would bury the groups.
    const focusGroup = (nodes, links) => {
      this.h.onHighlight(new Set(nodes), new Set(links));
      this.h.onFitNodes(nodes);
    };
    const islandList = this.el("div", { class: "lift-list" });
    // The mainland itself is a row too, and the first one: the one place to
    // get back to "the connected majority, framed" after looking at an
    // island — the default view already fits it (see app.js's
    // fitToMainland), so this is a way back to that, not a new destination.
    islandList.append(
      this.el(
        "button",
        {
          type: "button",
          class: "lift-row island-row",
          title: t("metric.islands.mainlandShow"),
          onclick: () => focusGroup(adrift.mainlandGroup.nodes, adrift.mainlandGroup.links),
        },
        this.el("span", { class: "lift-label" }, t("metric.islands.mainland")),
        this.el("span", { class: "metric-value" }, String(adrift.mainland)),
      ),
    );
    for (const group of adrift.groups.slice(0, LIST_LIMIT)) {
      const names = group.nodes.slice(0, 4).map((n) => n.name).join(", ");
      islandList.append(
        this.el(
          "button",
          {
            type: "button",
            class: "lift-row island-row",
            title: t("metric.islands.show"),
            onclick: () => focusGroup(group.nodes, group.links),
          },
          this.el("span", { class: "lift-label" }, group.nodes.length > 4 ? t("metric.islands.andMore", { names, count: group.nodes.length - 4 }) : names),
          this.el("span", { class: "metric-value" }, String(group.nodes.length)),
        ),
      );
    }
    if (adrift.groups.length === 0) islandList.append(this.el("p", { class: "muted small" }, t("metric.islands.none")));
    else if (adrift.groups.length > LIST_LIMIT) {
      islandList.append(this.el("p", { class: "muted small" }, t("metric.more", { count: adrift.groups.length - LIST_LIMIT })));
    }

    this.metricsBody.replaceChildren(
      heading("metric.entryPoints", String(entries.length)),
      hint("metric.entryPoints.hint"),
      entryList,
      exportButton("entry-points", () => ({ count: entries.length, nodes: entries.map(reportNodeShape) })),

      heading("metric.escapes", String(escapes.escapes)),
      hint("metric.escapes.hint"),
      this.el("p", { class: "muted small metric-hint" }, t("metric.escapes.summary", { nesting: escapes.nesting, liftSum: escapes.liftSum })),
      escapeList,
      exportButton("scope-escapes", () => ({
        escapes: escapes.escapes,
        nestingEdges: escapes.nesting,
        liftSum: escapes.liftSum,
        byLift: escapes.buckets.map(({ lift, edges }) => ({
          lift,
          count: edges.length,
          edges: edges.map((l) => ({ source: l.source.id, target: l.target.id, kind: l.kind, lift })),
        })),
      })),

      heading("metric.independence", owned.overall.toFixed(2)),
      hint("metric.independence.hint"),
      ownedList,
      exportButton("independence", () => ({
        overall: owned.overall,
        nodes: owned.nodes.map(({ node, score, callees, shared }) => ({ ...reportNodeShape(node), independence: score, callees, shared })),
      })),

      heading("metric.islands", String(adrift.groups.length)),
      hint("metric.islands.hint"),
      this.el("p", { class: "muted small metric-hint" }, t("metric.islands.summary", { mainland: adrift.mainland, singles: adrift.singles.length })),
      islandList,
      exportButton("islands", () => ({
        mainland: adrift.mainland,
        adrift: adrift.adrift,
        groups: adrift.groups.map((g) => ({
          size: g.nodes.length,
          nodes: g.nodes.map(reportNodeShape),
          edges: g.links.map((l) => ({ source: l.source.id, target: l.target.id, kind: l.kind })),
        })),
        // Listed here even though the panel only counts them: a report is
        // read at leisure, and a lone declaration adrift is still a finding.
        alone: adrift.singles.map(reportNodeShape),
      })),
    );
  }

  setSelection(node, graph) {
    this.selected = node;
    this.pathResultEl.hidden = true;
    // Clicking a node in the view is a request to see what it is, so the
    // section that answers that opens itself rather than making the click a
    // two-step affair. Only on the way in: a deselect leaves it as it is,
    // since collapsing a section the user is reading would be worse than an
    // empty one they can close themselves.
    if (node) this.openSection("selection");
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
        const lift = linkLift(graph, l);
        ul.append(
          this.el(
            "li",
            {},
            this.el("i", { class: "edge-dot", style: `background:${edgeColor(l.kind)}`, title: t(`edge.${l.kind}`) }),
            this.el("a", { href: "#", onclick: (e) => (e.preventDefault(), this.h.onSelectNode(n)) }, n.name),
            this.el("span", { class: "muted small" }, ` ${t(`edge.${l.kind}`)}${l.inferred ? "*" : ""}${lift > 0 ? ` · ${t("selection.lift", { lift })}` : ""} · ${n.file}`),
          ),
        );
      }
      if (items.length === 0) ul.append(this.el("li", { class: "muted" }, t("selection.none")));
      return this.el("div", {}, this.el("h3", {}, `${title} (${items.length})`), ul);
    };
    const flags = [t("selection.height", { height: node.height })];
    if (node.inCycle) flags.push(t("selection.inCycle"));
    if (node.exported) flags.push(t("selection.exported"));
    const scope = naturalScope(graph, node);
    const scopeText = scope.topLevel ? t("selection.scope.top") : scope.nodes.map((x) => x.name).join(", ");
    this.selectionBody.replaceChildren(
      this.el(
        "div",
        { class: "sel-title" },
        this.el("i", { style: `background:${kindColor(node.kind)}` }),
        this.el("b", {}, node.name),
        this.el("span", { class: "muted" }, ` ${kindLabel(node.kind)}`),
        this.el("button", { type: "button", class: "focus-button", title: t("selection.focus.hint"), onclick: () => this.h.onFocusNode(node) }, t("selection.focus")),
      ),
      this.el("div", { class: "small mono" }, node.line ? `${node.file}:${node.line}` : node.file),
      this.el("div", { class: "small muted" }, flags.join(", ")),
      this.el("div", { class: "small muted", title: t("selection.scope.hint") }, `${t("selection.scope")}: ${scopeText}`),
      this.el("div", { class: "small muted" }, t("selection.pathHint")),
      list(t("selection.callers"), callers),
      list(t("selection.callees"), callees),
    );
  }

  /**
   * @param {object|null} result paths.js's pathBetween() output, or null to clear
   * @param {object} [from] the path's origin node (for the "no path" message)
   * @param {object} [to] the path's destination node
   */
  setPathResult(result, from, to) {
    if (!result) {
      this.pathResultEl.hidden = true;
      return;
    }
    this.pathResultEl.hidden = false;
    const clearButton = this.el("button", { type: "button", class: "icon-button", title: t("selection.path.clear"), onclick: () => this.h.onClearPath() }, "×");
    if (!result.reachable) {
      this.pathResultEl.replaceChildren(this.el("span", { class: "muted small" }, t("selection.path.none", { from: from.name, to: to.name })), clearButton);
      return;
    }
    const names = result.shortestPath.map((n) => n.name).join(" → ");
    this.pathResultEl.replaceChildren(
      this.el("div", { class: "small" }, t("selection.path.found", { count: result.nodes.size })),
      this.el("div", { class: "small mono path-route" }, names),
      clearButton,
    );
  }
}

/**
 * The expanded sections remembered from a previous visit, falling back to
 * DEFAULT_OPEN_SECTIONS. Storage can throw outright (a browser set to block
 * site data), so every access is guarded and a failure just means the
 * defaults — a panel that opens at its default shape is a far smaller
 * problem than one that fails to render.
 */
function loadOpenSections() {
  try {
    const raw = localStorage.getItem(SECTIONS_STORAGE_KEY);
    if (raw === null) return DEFAULT_OPEN_SECTIONS;
    const ids = JSON.parse(raw);
    return Array.isArray(ids) ? ids.filter((id) => typeof id === "string") : DEFAULT_OPEN_SECTIONS;
  } catch {
    return DEFAULT_OPEN_SECTIONS;
  }
}

function saveOpenSections(ids) {
  try {
    localStorage.setItem(SECTIONS_STORAGE_KEY, JSON.stringify([...ids]));
  } catch {
    // Not being able to remember the layout is not worth interrupting anything for.
  }
}

/** The fields of a declaration an exported report carries (see app.js's exportReport). */
function reportNodeShape(node) {
  return { id: node.id, name: node.name, kind: node.kind, file: node.file, line: node.line, in: node.inDegree, out: node.outDegree, height: node.height };
}
