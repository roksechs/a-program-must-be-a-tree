// Application wiring: loads a dataset, runs the simulation and connects the
// renderer to the property panel.
/* global d3 */
import { deleteAnalysis, listRecentAnalyses, saveAnalysis } from "./analysisCache.js";
import { searchGithubRepos } from "./githubAnalyzer.js";
import { DEFAULT_OFF_KINDS, EDGE_KINDS } from "./kinds.js";
import { Graph3D } from "./graph3d.js";
import { LANGUAGES, detectLanguage, getLanguage, onLanguageChange, setLanguage, t } from "./i18n.js";
import { applyActiveKinds, buildGraph } from "./model.js";
import { Panel } from "./panel.js";
import { pathBetween } from "./paths.js";
import { DEFAULT_PHYSICS, applyPhysics, createSimulation, seedPositions } from "./simulation.js";
import { visibleContainers } from "./zones.js";

const state = {
  labelMode: "auto",
  colorBy: "kind",
  layerGap: 80,
  showLayers: true,
  layerFade: true,
  autoRotate: false,
  // No container has depth 0 (1 = top-level directory, model.js's
  // buildContainers), so this range starts as empty on purpose: nothing
  // drawn until the user asks for a band of it.
  zoneMinDepth: 0,
  zoneMaxDepth: 0,
  // Enabled edge kinds. An enabled kind is drawn, acts as a spring and counts
  // for degrees, call heights and the diagnostics; a disabled kind does none
  // of these. Every kind starts enabled (see kinds.js); `write`'s reversed
  // direction (THEORY.md §7) is the one worth turning back off if it confuses
  // a dominator-tree-based reading of the diagnostics.
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

const renderer = new Graph3D(stage, rendererCallbacks());

function rendererCallbacks() {
  return {
    onSelect: (node) => panel.setSelection(node, state.graph),
    onFindPath: (from, to) => {
      if (!state.graph) return;
      const result = pathBetween(state.graph, from, to);
      renderer.setPath(result.reachable ? result.nodes : null, result.reachable ? result.edges : null);
      panel.setPathResult(result, from, to);
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
  onOpenFolder: () => loadLocalFolder(),
  onGithub: (spec) => loadGithubRepo(spec),
  onGithubSearch: (query) => searchGithubRepos(query).catch(() => []),
  onLoadRecent: (entry) => loadFromCache(entry),
  onReanalyzeRecent: (entry) => reanalyzeRecent(entry),
  onDeleteRecent: (entry) => deleteRecent(entry),
  onPhysics: (key, value) => {
    state.physics[key] = value;
    // Apply the new parameter without forcing a reheat: a settled layout the
    // user has been looking at should not be flung back into motion just for
    // touching a slider. If the simulation is still warm the new value takes
    // effect on its very next tick either way; "Recompute (reheat)" is the
    // explicit way to ask for a fresh layout.
    if (state.sim) applyPhysics(state.sim, state.physics);
  },
  onReheat: () => state.sim?.alpha(1).restart(),
  onReset: () => {
    if (!state.graph) return;
    seedPositions(state.graph);
    state.sim.alpha(1).restart();
  },
  onFit: () => renderer.fit(),
  onTop: () => renderer.viewTop(),
  onZones: (minDepth, maxDepth) => {
    state.zoneMinDepth = minDepth;
    state.zoneMaxDepth = maxDepth;
    updateZones();
  },
  onLabels: (mode) => {
    state.labelMode = mode;
    renderer.setLabelMode(mode);
  },
  onKinds: (kind, enabled) => {
    if (enabled) state.kinds.add(kind);
    else state.kinds.delete(kind);
    applyKinds();
  },
  onColorBy: (mode) => {
    state.colorBy = mode;
    renderer.setColorBy(mode);
  },
  onLayerGap: (gap) => {
    state.layerGap = gap;
    renderer.setLayerGap(gap);
  },
  onShowLayers: (show) => {
    state.showLayers = show;
    renderer.setShowLayers(show);
  },
  onLayerFade: (fade) => {
    state.layerFade = fade;
    renderer.setLayerFade(fade);
  },
  onAutoRotate: (on) => {
    state.autoRotate = on;
    renderer.autoRotate = on;
    if (on) ensureTicking();
  },
  onSelectNode: (node) => renderer.select(node),
  onFocusNode: (node) => renderer.focusOn(node),
  onClearPath: () => {
    renderer.setPath(null, null);
    panel.setPathResult(null);
  },
});

/** Apply the enabled edge kinds to drawing, springs and diagnostics at once. */
function applyKinds() {
  renderer.setVisibleKinds(state.kinds);
  state.physics.springKinds = new Set(state.kinds);
  if (state.graph) {
    applyActiveKinds(state.graph, state.kinds);
    panel.setMetrics(state.graph);
    panel.setSelection(renderer.selected, state.graph);
    renderer.restyle();
  }
  // Drawing, degrees and diagnostics above already reflect the new kinds
  // immediately; the spring set (below) takes effect on the simulation's own
  // schedule instead of being forced with a reheat, so switching a kind on or
  // off while exploring a graph never flings a layout the user just settled
  // back into motion (see onPhysics for the same reasoning).
  if (state.sim) applyPhysics(state.sim, state.physics);
}

function updateZones() {
  if (!state.graph) return;
  const containers = visibleContainers(state.graph, state.zoneMinDepth, state.zoneMaxDepth);
  renderer.setZones(containers);
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
  renderer.draw();
});

// The view redraws on an animation frame while auto-rotating even after the
// simulation has cooled down.
let ticking = false;
function ensureTicking() {
  if (ticking) return;
  ticking = true;
  const frame = () => {
    if (!state.autoRotate) {
      ticking = false;
      return;
    }
    renderer.tick();
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
  state.zoneMinDepth = Math.min(state.zoneMinDepth, graph.maxDepth);
  state.zoneMaxDepth = Math.min(state.zoneMaxDepth, graph.maxDepth);
  seedPositions(graph);

  renderer.setGraph(graph);
  renderer.setLabelMode(state.labelMode);
  renderer.setColorBy(state.colorBy);
  renderer.setVisibleKinds(state.kinds);
  panel.setMaxDepth(graph.maxDepth, state.zoneMinDepth, state.zoneMaxDepth);
  panel.setMetrics(graph);
  panel.setSelection(null, graph);
  panel.setDataInfo({ label, nodes: graph.nodes.length, edges: graph.links.length, files: graph.containers.filter((c) => c.isFile).length });
  updateZones();

  // The camera is never moved on its own — not on load, not while the
  // simulation is running, not once it settles. "Fit to view" is the only
  // way the view reframes; the user asks for it, or does not.
  const sim = createSimulation(graph, state.physics);
  sim.on("tick", () => renderer.tick());
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

// The local-folder and GitHub-repo features analyze real source entirely in
// the browser (site/js/localAnalyzer.js, site/js/githubAnalyzer.js): no
// pre-generated JSON, no server. They run inside analyzeWorker.js's
// dedicated worker, not here — building and walking a ts.Program is heavy
// enough to freeze the page for the duration otherwise (docs/DESIGN.md).
function runAnalysisInWorker(kind, payload, options, onProgress, onPhase) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./analyzeWorker.js", import.meta.url));
    worker.onmessage = (event) => {
      const msg = event.data;
      if (msg.type === "progress") onProgress?.(...msg.args);
      else if (msg.type === "phase") onPhase?.(msg.phase, msg.detail);
      else if (msg.type === "done") {
        worker.terminate();
        resolve(msg.doc);
      } else if (msg.type === "error") {
        worker.terminate();
        reject(new Error(msg.message));
      }
    };
    worker.onerror = (event) => {
      worker.terminate();
      reject(new Error(event.message || "worker error"));
    };
    worker.postMessage({ kind, payload, options });
  });
}

/** Past file-reading, analysis has no single "percent done" — these are the stages there are (browserAnalyzer.js's analyzeFiles). */
function reportPhase(phase, detail, fileCount) {
  if (phase === "compiler") setStatus("app.loadingCompiler");
  else if (phase === "types") setStatus("app.loadingTypes", { count: detail });
  else if (phase === "analyzing") setStatus("app.analyzingFiles", { count: fileCount });
}

async function refreshRecent() {
  panel.setRecent(await listRecentAnalyses());
}

/** A "Recently opened" entry, clicked: show its cached graph, no re-reading. */
function loadFromCache(entry) {
  state.datasetId = "__custom__";
  panel.setDatasets(state.datasets, "__custom__");
  installGraph(entry.doc, entry.label);
}

async function deleteRecent(entry) {
  await deleteAnalysis(entry.kind, entry.key);
  await refreshRecent();
}

/** The explicit "re-analyze" action on a "Recently opened" entry: re-read/re-fetch and refresh the cache, in place of just replaying the cached graph. */
async function reanalyzeRecent(entry) {
  if (entry.kind === "github") {
    await loadGithubRepo(entry.key);
    return;
  }
  let fileCount = 0;
  setStatus("app.readingFiles", { count: 0 });
  try {
    const granted = await entry.dirHandle.requestPermission({ mode: "read" });
    if (granted !== "granted") throw new Error("permission was not granted");
    const doc = await runAnalysisInWorker(
      "local",
      { dirHandle: entry.dirHandle },
      {},
      (count) => {
        fileCount = count;
        setStatus("app.readingFiles", { count });
      },
      (phase, detail) => reportPhase(phase, detail, fileCount),
    );
    await saveAnalysis({ kind: "local", key: entry.key, label: entry.label, doc, dirHandle: entry.dirHandle });
    await refreshRecent();
    state.datasetId = "__custom__";
    panel.setDatasets(state.datasets, "__custom__");
    installGraph(doc, entry.label);
  } catch (err) {
    setStatus("app.analyzeFailed", { name: entry.label, message: err.message });
  }
}

async function loadLocalFolder() {
  let dirHandle;
  try {
    dirHandle = await window.showDirectoryPicker();
  } catch {
    return; // the user cancelled the picker
  }
  let fileCount = 0;
  setStatus("app.readingFiles", { count: 0 });
  try {
    const doc = await runAnalysisInWorker(
      "local",
      { dirHandle },
      {},
      (count) => {
        fileCount = count;
        setStatus("app.readingFiles", { count });
      },
      (phase, detail) => reportPhase(phase, detail, fileCount),
    );
    state.datasetId = "__custom__";
    panel.setDatasets(state.datasets, "__custom__");
    installGraph(doc, dirHandle.name);
    await saveAnalysis({ kind: "local", key: crypto.randomUUID(), label: dirHandle.name, doc, dirHandle });
    await refreshRecent();
  } catch (err) {
    setStatus("app.analyzeFailed", { name: dirHandle.name, message: err.message });
  }
}

async function loadGithubRepo(spec) {
  let fileCount = 0;
  setStatus("app.fetchingFiles", { done: 0, total: "?" });
  try {
    const doc = await runAnalysisInWorker(
      "github",
      { spec },
      {},
      (done, total) => {
        fileCount = done;
        setStatus("app.fetchingFiles", { done, total });
      },
      (phase, detail) => reportPhase(phase, detail, fileCount),
    );
    state.datasetId = "__custom__";
    panel.setDatasets(state.datasets, "__custom__");
    installGraph(doc, spec);
    // Keyed by the resolved "owner/repo@ref" (doc.meta.root), not the raw
    // input: typing "owner/repo" and "owner/repo@main" for the same default
    // branch collapse to one cache entry once the ref is resolved.
    await saveAnalysis({ kind: "github", key: doc.meta.root, label: doc.meta.root, doc });
    await refreshRecent();
  } catch (err) {
    setStatus("app.analyzeFailed", { name: spec, message: err.message });
  }
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
  refreshRecent(); // does not block the initial dataset load
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

window.addEventListener("resize", () => renderer.resize());

d3.select(window).on("keydown", (event) => {
  if (event.key === "Escape") renderer.select(null);
});

main();
