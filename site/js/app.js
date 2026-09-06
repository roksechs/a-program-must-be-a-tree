// Application wiring: loads a dataset, runs the simulation and connects the
// renderers to the property panel.
/* global d3 */
import { DEFAULT_OFF_KINDS, EDGE_KINDS } from "./kinds.js";
import { Graph2D } from "./graph2d.js";
import { Graph3D } from "./graph3d.js";
import { LANGUAGES, detectLanguage, getLanguage, onLanguageChange, setLanguage, t } from "./i18n.js";
import { applyActiveKinds, buildGraph } from "./model.js";
import { Panel } from "./panel.js";
import { DEFAULT_PHYSICS, applyPhysics, createSimulation, seedPositions } from "./simulation.js";
import { visibleContainers } from "./zones.js";

const state = {
  view: "2d",
  labelMode: "auto",
  colorBy: "kind",
  layerGap: 80,
  showLayers: true,
  autoRotate: false,
  zoneDepth: 2,
  // Enabled edge kinds. An enabled kind is drawn, acts as a spring and counts
  // for degrees, call heights and the diagnostics; a disabled kind does none
  // of these. Type-level edges are off by default (erased at run time);
  // write edges are off by default (reversed direction, THEORY.md §7).
  kinds: new Set(EDGE_KINDS.filter((k) => !DEFAULT_OFF_KINDS.has(k))),
  maxDepth: 0,
  physics: { ...DEFAULT_PHYSICS },
  datasets: [],
  datasetId: null,
  graph: null,
  sim: null,
};

const stage = document.getElementById("stage");
const tooltip = document.getElementById("tooltip");
const status = document.getElementById("status");
const languageSelect = document.getElementById("language");

// Language: ?lang= query, then the saved preference, then the browser locale.
let savedLanguage = null;
try {
  savedLanguage = localStorage.getItem("lang");
} catch {
  savedLanguage = null;
}
setLanguage(detectLanguage(location.search, savedLanguage, navigator.language));
for (const l of LANGUAGES) {
  const opt = document.createElement("option");
  opt.value = l.code;
  opt.textContent = l.label;
  languageSelect.append(opt);
}
languageSelect.value = getLanguage();
languageSelect.addEventListener("change", () => setLanguage(languageSelect.value));

/** Re-translate the static parts of the page (header, document language). */
function applyStaticTranslations() {
  document.documentElement.lang = getLanguage();
  for (const el of document.querySelectorAll("[data-i18n]")) el.textContent = t(el.dataset.i18n);
  languageSelect.value = getLanguage();
}
applyStaticTranslations();

const renderers = {
  "2d": new Graph2D(stage, rendererCallbacks()),
  "3d": new Graph3D(stage, rendererCallbacks()),
};
renderers["3d"].show(false);

function rendererCallbacks() {
  return {
    onSelect: (node) => {
      for (const r of Object.values(renderers)) if (r.selected !== node) r.select?.(node);
      panel.setSelection(node, state.graph);
    },
    onDragStart: () => state.sim?.alphaTarget(0.3).restart(),
    onDragEnd: () => state.sim?.alphaTarget(0),
    onHover: (node, event) => {
      if (!node) {
        tooltip.hidden = true;
        return;
      }
      tooltip.hidden = false;
      tooltip.textContent = t("app.tooltip", {
        name: node.name,
        kind: node.kind,
        location: node.line ? `${node.file}:${node.line}` : node.file,
        in: node.inDegree,
        out: node.outDegree,
        height: node.height,
      });
      const rect = stage.getBoundingClientRect();
      tooltip.style.left = `${event.clientX - rect.left + 12}px`;
      tooltip.style.top = `${event.clientY - rect.top + 12}px`;
    },
  };
}

const panel = new Panel(document.getElementById("panel"), state, {
  onDataset: (id) => loadDataset(id),
  onFile: (file) => loadFile(file),
  onView: (view) => setView(view),
  onPhysics: (key, value) => {
    state.physics[key] = value;
    if (state.sim) {
      applyPhysics(state.sim, state.physics);
      state.sim.alpha(Math.max(state.sim.alpha(), 0.3)).restart();
    }
  },
  onReheat: () => state.sim?.alpha(1).restart(),
  onReset: () => {
    if (!state.graph) return;
    seedPositions(state.graph);
    state.sim.alpha(1).restart();
  },
  onFit: () => renderers[state.view].fit(),
  onZones: (depth) => {
    state.zoneDepth = depth;
    updateZones();
  },
  onLabels: (mode) => {
    state.labelMode = mode;
    for (const r of Object.values(renderers)) r.setLabelMode(mode);
  },
  onKinds: (kind, enabled) => {
    if (enabled) state.kinds.add(kind);
    else state.kinds.delete(kind);
    applyKinds();
  },
  onColorBy: (mode) => {
    state.colorBy = mode;
    for (const r of Object.values(renderers)) r.setColorBy(mode);
  },
  onLayerGap: (gap) => {
    state.layerGap = gap;
    renderers["3d"].setLayerGap(gap);
  },
  onShowLayers: (show) => {
    state.showLayers = show;
    renderers["3d"].setShowLayers(show);
  },
  onAutoRotate: (on) => {
    state.autoRotate = on;
    renderers["3d"].autoRotate = on;
    if (on) ensureTicking();
  },
  onSelectNode: (node) => renderers[state.view].select(node),
  onFocusNode: (node) => renderers[state.view].focusOn(node),
});

/** Apply the enabled edge kinds to drawing, springs and diagnostics at once. */
function applyKinds() {
  for (const r of Object.values(renderers)) r.setVisibleKinds(state.kinds);
  state.physics.springKinds = new Set(state.kinds);
  if (state.graph) {
    applyActiveKinds(state.graph, state.kinds);
    panel.setMetrics(state.graph);
    panel.setSelection(renderers[state.view].selected, state.graph);
    for (const r of Object.values(renderers)) r.restyle();
  }
  if (state.sim) {
    applyPhysics(state.sim, state.physics);
    state.sim.alpha(Math.max(state.sim.alpha(), 0.3)).restart();
  }
}

function setView(view) {
  state.view = view;
  panel.setView(view);
  for (const [k, r] of Object.entries(renderers)) r.show(k === view);
  renderers[view].resize();
  renderers[view].fit();
}

function updateZones() {
  if (!state.graph) return;
  const containers = visibleContainers(state.graph, state.zoneDepth);
  for (const r of Object.values(renderers)) r.setZones(containers);
}

let statusMessage = { key: "app.loading", params: {} };
function setStatus(key, params = {}) {
  statusMessage = { key, params };
  status.textContent = t(key, params);
}

onLanguageChange(() => {
  try {
    localStorage.setItem("lang", getLanguage());
  } catch {
    // Storage may be unavailable (private mode); the ?lang= parameter still works.
  }
  const url = new URL(location.href);
  url.searchParams.set("lang", getLanguage());
  history.replaceState(null, "", url);
  applyStaticTranslations();
  setStatus(statusMessage.key, statusMessage.params);
  panel.refresh();
  panel.setView(state.view);
  renderers["3d"].draw();
});

// The 3D view redraws on an animation frame while auto-rotating even after the
// simulation has cooled down.
let ticking = false;
function ensureTicking() {
  if (ticking) return;
  ticking = true;
  const frame = () => {
    if (!state.autoRotate || state.view !== "3d") {
      ticking = false;
      return;
    }
    renderers["3d"].tick();
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

function installGraph(doc, label) {
  state.sim?.stop();
  const graph = buildGraph(doc);
  applyActiveKinds(graph, state.kinds);
  state.physics.springKinds = new Set(state.kinds);
  state.graph = graph;
  state.maxDepth = graph.maxDepth;
  state.zoneDepth = Math.min(state.zoneDepth, graph.maxDepth);
  seedPositions(graph);

  for (const r of Object.values(renderers)) {
    r.setGraph(graph);
    r.setLabelMode(state.labelMode);
    r.setColorBy(state.colorBy);
    r.setVisibleKinds(state.kinds);
  }
  panel.setMaxDepth(graph.maxDepth, state.zoneDepth);
  panel.setMetrics(graph);
  panel.setSelection(null, graph);
  panel.setDataInfo({ label, nodes: graph.nodes.length, edges: graph.links.length, files: graph.containers.filter((c) => c.isFile).length });
  updateZones();

  const sim = createSimulation(graph, state.physics);
  let fitted = false;
  sim.on("tick", () => {
    renderers[state.view].tick();
    if (!fitted && sim.alpha() < 0.6) {
      fitted = true;
      renderers[state.view].fit();
    }
  });
  sim.on("end", () => renderers[state.view].fit());
  state.sim = sim;
  setStatus("app.status", { nodes: graph.nodes.length, edges: graph.links.length });
}

async function loadDataset(id) {
  const ds = state.datasets.find((d) => d.id === id);
  if (!ds) return;
  state.datasetId = id;
  panel.setDatasets(state.datasets, id);
  setStatus("app.loadingDataset", { name: ds.name });
  try {
    const res = await fetch(ds.file);
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    const doc = await res.json();
    installGraph(doc, ds.description ? `${ds.name} (${ds.description})` : ds.name);
    const url = new URL(location.href);
    url.searchParams.set("data", id);
    history.replaceState(null, "", url);
  } catch (err) {
    setStatus("app.loadFailed", { file: ds.file, message: err.message });
  }
}

function loadFile(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const doc = JSON.parse(reader.result);
      state.datasetId = "__custom__";
      panel.setDatasets(state.datasets, "__custom__");
      installGraph(doc, file.name);
    } catch (err) {
      setStatus("app.parseFailed", { file: file.name, message: err.message });
    }
  };
  reader.readAsText(file);
}

async function loadRemote(url) {
  setStatus("app.loadingDataset", { name: url });
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    const doc = await res.json();
    state.datasetId = "__custom__";
    panel.setDatasets(state.datasets, "__custom__");
    installGraph(doc, url);
  } catch (err) {
    setStatus("app.loadFailed", { file: url, message: err.message });
  }
}

async function main() {
  const res = await fetch("data/index.json");
  state.datasets = res.ok ? await res.json() : [];
  const params = new URLSearchParams(location.search);
  const wanted = params.get("data");
  if (wanted && /^https?:\/\//.test(wanted)) {
    panel.setDatasets(state.datasets, "__custom__");
    await loadRemote(wanted);
  } else if (wanted && state.datasets.some((d) => d.id === wanted)) {
    await loadDataset(wanted);
  } else if (state.datasets.length > 0) {
    await loadDataset(state.datasets[0].id);
  } else {
    setStatus("app.noDatasets");
  }
}

window.addEventListener("resize", () => {
  for (const r of Object.values(renderers)) r.resize();
});

d3.select(window).on("keydown", (event) => {
  if (event.key === "Escape") renderers[state.view].select(null);
});

main();
