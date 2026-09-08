// Application wiring: loads a dataset, runs the simulation and connects the
// renderer to the property panel.
/* global d3 */
import { deleteAnalysis, listRecentAnalyses, saveAnalysis } from "./analysisCache.js";
import { searchGithubRepos } from "./githubAnalyzer.js";
import { DEFAULT_OFF_KINDS, EDGE_KINDS } from "./kinds.js";
import { Graph3D } from "./graph3d.js";
import { LANGUAGES, detectLanguage, getLanguage, onLanguageChange, setLanguage, t } from "./i18n.js";
import { applyActiveKinds, buildGraph } from "./model.js";
import { CUSTOM_OPTION, Panel } from "./panel.js";
import { pathBetween } from "./paths.js";
import { DEFAULT_PHYSICS, applyPhysics, createSimulation, seedPositions } from "./simulation.js";
import { visibleContainers } from "./zones.js";

const state = {
  labelMode: "auto",
  colorBy: "kind",
  layerGap: 80,
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
  // The raw analyzer document currently installed (docs/DATA_FORMAT.md),
  // before buildGraph() turns it into `graph` above — kept only so
  // "Export JSON" can hand back exactly what was analyzed, for debugging an
  // analysis that looks wrong without having to reproduce it.
  doc: null,
  docLabel: null,
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
  // The panel's resize handle is focusable and has no text of its own, so its
  // only accessible name is this label; data-i18n above sets textContent,
  // which would be wrong for an element that must stay empty.
  document.getElementById("panel-resize").setAttribute("aria-label", t("panel.resize"));
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
  onExportJson: () => exportJson(),
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
  // Highlighting a diagnostic's edges reuses the path overlay rather than
  // adding a second "show me this set" mechanism: what it has to do — draw
  // these edges and their endpoints, dim everything else — is exactly what
  // the overlay already does, and the Selection section's existing "clear"
  // button then clears this too.
  onHighlight: (nodes, edges) => renderer.setPath(nodes, edges),
  onExportReport: (metric, payload) => exportReport(metric, payload),
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


/** The dataset's own name, reduced to something safe to put in a filename. */
function exportBaseName() {
  return (state.doc?.meta?.name ?? state.docLabel ?? "graph").replace(/[^A-Za-z0-9._-]+/g, "-");
}

/** Hand `value` to the browser as a downloaded JSON file. */
function downloadJson(filename, value) {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Download the raw analyzer document currently installed (docs/DATA_FORMAT.md),
 * exactly as analyzed — before buildGraph() merges/drops edges or derives
 * anything — so a graph that looks wrong (a reference that should have
 * connected two declarations but didn't, say) can be inspected or handed
 * off without having to reproduce the analysis that produced it.
 */
function exportJson() {
  if (!state.doc) return;
  downloadJson(`${exportBaseName()}.json`, state.doc);
}

/**
 * Download what one diagnostic is actually pointing at, as a report: the
 * figure on screen plus every declaration or dependency behind it. A number
 * in the panel says a program is not a tree; this says which parts of it are
 * not, in a form that can be worked through away from the viewer. `payload`
 * is whatever that metric has to say for itself (see panel.js's Diagnostics
 * section, which builds it).
 */
function exportReport(metric, payload) {
  if (!state.graph) return;
  downloadJson(`${exportBaseName()}-${metric}.json`, {
    dataset: state.docLabel ?? null,
    generatedAt: new Date().toISOString(),
    // Every diagnostic is computed on the enabled edge kinds only, so a
    // report that did not say which they were could not be reproduced.
    edgeKinds: [...state.kinds].sort(),
    metric,
    ...payload,
  });
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
  state.doc = doc;
  state.docLabel = label;
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
      installCustomGraph(JSON.parse(reader.result), file.name);
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

/**
 * Install a document that did not come from `data/index.json` — a JSON file,
 * a folder, a repo, a cached analysis, a `?data=<url>`. All of those have to
 * say so in the dropdown as well as install the graph, and every one of them
 * used to spell the pair out; the diagnostics ranked the load paths among
 * the least independent declarations in this codebase for exactly that.
 */
function installCustomGraph(doc, label) {
  state.datasetId = CUSTOM_OPTION;
  panel.setDatasets(state.datasets, CUSTOM_OPTION);
  installGraph(doc, label);
}

/**
 * Read and analyze a directory, reporting the file count as it goes and then
 * the analyzer's own phases. Shared by "Folder…" and by "re-analyze" on a
 * remembered folder, which differ only in where the permission comes from
 * and which cache key the result is filed under.
 */
function runLocalAnalysis(dirHandle) {
  let fileCount = 0;
  setStatus("app.readingFiles", { count: 0 });
  return runAnalysisInWorker(
    "local",
    { dirHandle },
    {},
    (count) => {
      fileCount = count;
      setStatus("app.readingFiles", { count });
    },
    (phase, detail) => reportPhase(phase, detail, fileCount),
  );
}

/** A "Recently opened" entry, clicked: show its cached graph, no re-reading. */
function loadFromCache(entry) {
  installCustomGraph(entry.doc, entry.label);
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
  try {
    const granted = await entry.dirHandle.requestPermission({ mode: "read" });
    if (granted !== "granted") throw new Error("permission was not granted");
    const doc = await runLocalAnalysis(entry.dirHandle);
    installCustomGraph(doc, entry.label);
    // Keyed by the entry's own key, so re-analyzing updates that row rather
    // than adding a second one for the same folder.
    await saveAnalysis({ kind: "local", key: entry.key, label: entry.label, doc, dirHandle: entry.dirHandle });
    await refreshRecent();
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
  try {
    const doc = await runLocalAnalysis(dirHandle);
    installCustomGraph(doc, dirHandle.name);
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
    installCustomGraph(doc, spec);
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
    installCustomGraph(await res.json(), url);
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
    panel.setDatasets(state.datasets, CUSTOM_OPTION);
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

// Panel width: a drag handle on the panel's own left edge, writing the width
// straight to the `--panel-width` custom property the stylesheet already
// reads. The stage is the flex item that absorbs the difference, so the
// canvas has to be told its box changed — nothing else does that, since the
// window itself never resized.
const PANEL_MIN_WIDTH = 260;
const panelResizer = document.getElementById("panel-resize");
const panelWidthLimit = () => Math.max(PANEL_MIN_WIDTH, Math.min(720, window.innerWidth - 320));
const setPanelWidth = (px) => {
  const width = Math.round(Math.max(PANEL_MIN_WIDTH, Math.min(panelWidthLimit(), px)));
  document.documentElement.style.setProperty("--panel-width", `${width}px`);
  renderer.resize();
  return width;
};

try {
  const saved = Number(localStorage.getItem("panelWidth"));
  if (Number.isFinite(saved) && saved > 0) setPanelWidth(saved);
} catch {
  // A browser that refuses storage just gets the stylesheet's default width.
}

panelResizer.addEventListener("pointerdown", (e) => {
  e.preventDefault(); // otherwise the drag selects the panel's text as it passes over it
  panelResizer.setPointerCapture(e.pointerId);
  panelResizer.classList.add("dragging");
});
panelResizer.addEventListener("pointermove", (e) => {
  if (!panelResizer.hasPointerCapture(e.pointerId)) return;
  // Width from the window's right edge rather than a delta, so a fast drag
  // that outruns the pointermove stream still lands where the cursor is
  // instead of drifting by whatever the missed events were worth.
  setPanelWidth(window.innerWidth - e.clientX);
});
const endPanelResize = (e) => {
  if (!panelResizer.hasPointerCapture(e.pointerId)) return;
  panelResizer.releasePointerCapture(e.pointerId);
  panelResizer.classList.remove("dragging");
  try {
    localStorage.setItem("panelWidth", String(document.getElementById("panel").getBoundingClientRect().width));
  } catch {
    // See above: not remembering the width is not worth interrupting for.
  }
};
panelResizer.addEventListener("pointerup", endPanelResize);
panelResizer.addEventListener("pointercancel", endPanelResize);
// Keyboard equivalent, since the handle is focusable and a pointer drag is
// not something every input device can do.
panelResizer.addEventListener("keydown", (e) => {
  const step = e.shiftKey ? 64 : 16;
  if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
  e.preventDefault();
  const current = document.getElementById("panel").getBoundingClientRect().width;
  setPanelWidth(current + (e.key === "ArrowLeft" ? step : -step));
});

d3.select(window).on("keydown", (event) => {
  if (event.key === "Escape") renderer.select(null);
});

main();
