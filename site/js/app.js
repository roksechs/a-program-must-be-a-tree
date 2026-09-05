// Application wiring: loads a dataset, runs the simulation and connects the
// renderers to the property panel.
/* global d3 */
import { Graph2D } from "./graph2d.js";
import { Graph3D } from "./graph3d.js";
import { buildGraph } from "./model.js";
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
  zoneDepth: 1,
  showFiles: true,
  maxDepth: 0,
  physics: { ...DEFAULT_PHYSICS },
  datasets: [],
  datasetId: null,
  graph: null,
  sim: null,
};

const containersRef = { current: [] };
const stage = document.getElementById("stage");
const tooltip = document.getElementById("tooltip");
const status = document.getElementById("status");

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
      tooltip.textContent = `${node.name}  (${node.kind})  ${node.file}${node.line ? ":" + node.line : ""}  in ${node.inDegree} / out ${node.outDegree} / height ${node.height}`;
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
  onZones: (depth, showFiles) => {
    if (depth !== undefined) state.zoneDepth = depth;
    if (showFiles !== undefined) state.showFiles = showFiles;
    updateZones();
    state.sim?.alpha(Math.max(state.sim.alpha(), 0.2)).restart();
  },
  onLabels: (mode) => {
    state.labelMode = mode;
    for (const r of Object.values(renderers)) r.setLabelMode(mode);
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
});

function setView(view) {
  state.view = view;
  panel.setView(view);
  for (const [k, r] of Object.entries(renderers)) r.show(k === view);
  renderers[view].resize();
  renderers[view].fit();
}

function updateZones() {
  if (!state.graph) return;
  containersRef.current = visibleContainers(state.graph, state.zoneDepth, state.showFiles);
  for (const r of Object.values(renderers)) r.setZones(containersRef.current);
}

function setStatus(text) {
  status.textContent = text;
}

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
  state.graph = graph;
  state.maxDepth = graph.maxDepth;
  state.zoneDepth = Math.min(state.zoneDepth, graph.maxDepth);
  seedPositions(graph);

  for (const r of Object.values(renderers)) {
    r.setGraph(graph);
    r.setLabelMode(state.labelMode);
    r.setColorBy(state.colorBy);
  }
  panel.setMaxDepth(graph.maxDepth, state.zoneDepth);
  panel.setMetrics(graph);
  panel.setSelection(null, graph);
  panel.setDataInfo(`${label}: ${graph.nodes.length} declarations, ${graph.links.length} edges, ${graph.containers.filter((c) => c.isFile).length} files`);
  updateZones();

  const sim = createSimulation(graph, state.physics, containersRef);
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
  setStatus(`${graph.nodes.length} declarations · ${graph.links.length} edges`);
}

async function loadDataset(id) {
  const ds = state.datasets.find((d) => d.id === id);
  if (!ds) return;
  state.datasetId = id;
  panel.setDatasets(state.datasets, id);
  setStatus(`loading ${ds.name}…`);
  try {
    const res = await fetch(ds.file);
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    const doc = await res.json();
    installGraph(doc, ds.description ? `${ds.name} (${ds.description})` : ds.name);
    const url = new URL(location.href);
    url.searchParams.set("data", id);
    history.replaceState(null, "", url);
  } catch (err) {
    setStatus(`failed to load ${ds.file}: ${err.message}`);
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
      setStatus(`could not parse ${file.name}: ${err.message}`);
    }
  };
  reader.readAsText(file);
}

async function loadRemote(url) {
  setStatus(`loading ${url}…`);
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    const doc = await res.json();
    state.datasetId = "__custom__";
    panel.setDatasets(state.datasets, "__custom__");
    installGraph(doc, url);
  } catch (err) {
    setStatus(`failed to load ${url}: ${err.message}`);
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
    setStatus("no datasets found: open a JSON file from the panel");
  }
}

window.addEventListener("resize", () => {
  for (const r of Object.values(renderers)) r.resize();
});

d3.select(window).on("keydown", (event) => {
  if (event.key === "Escape") renderers[state.view].select(null);
});

main();
