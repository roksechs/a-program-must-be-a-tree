// The article page: chapters written in Markdown (one file per chapter per
// language under content/), each with the live graphs its directives ask for.
// The graphs are the viewer's own modules on the viewer's own datasets, so
// every number on the page is the real implementation's output.
/* global d3 */
import { EDGE_KINDS } from "./kinds.js";
import { Graph3D } from "./graph3d.js";
import { LANGUAGES, detectLanguage, getLanguage, kindLabel, onLanguageChange, setLanguage, t } from "./i18n.js";
import { renderMarkdown } from "./markdown.js";
import { computeMetrics, naturalScope } from "./metrics.js";
import { applyActiveKinds, buildGraph } from "./model.js";
import { DEFAULT_PHYSICS, createSimulation, seedPositions } from "./simulation.js";
import { visibleContainers } from "./zones.js";

const chaptersEl = document.getElementById("chapters");
const tocEl = document.getElementById("toc");
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
for (const l of LANGUAGES) languageSelect.append(el("option", { value: l.code }, l.label));
languageSelect.value = getLanguage();
languageSelect.addEventListener("change", () => setLanguage(languageSelect.value));

function applyStaticTranslations() {
  document.documentElement.lang = getLanguage();
  for (const node of document.querySelectorAll("[data-i18n]")) node.textContent = t(node.dataset.i18n);
  languageSelect.value = getLanguage();
}

/** Create an element with attributes and children. */
function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined) continue;
    if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v);
  }
  node.append(...children);
  return node;
}

let chapterIds = [];
let datasets = [];
const figures = new Map(); // chapter id -> live figures, kept across language switches

async function fetchText(file) {
  const res = await fetch(file);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.text();
}

async function renderChapters() {
  const lang = getLanguage();
  for (const id of chapterIds) {
    const file = `content/${lang}/${id}.md`;
    let md;
    try {
      md = await fetchText(file);
    } catch (err) {
      md = `# ${id}\n\n${t("article.loadFailed", { file, message: err.message })}`;
    }
    const { html, directives } = renderMarkdown(md);
    let section = document.getElementById(`ch-${id}`);
    if (!section) {
      section = el("section", { class: "chapter", id: `ch-${id}` }, el("div", { class: "prose" }), el("div", { class: "figures" }));
      chaptersEl.append(section);
    }
    // The renderer escapes everything and passes no raw HTML through, so the
    // markup here is only what markdown.js produced.
    section.querySelector(".prose").innerHTML = html;
    if (!figures.has(id)) {
      const made = directives.filter((d) => d.graph).map((d) => createFigure(d));
      figures.set(id, made);
      const host = section.querySelector(".figures");
      for (const f of made) host.append(f.el);
      if (made.length === 0) section.classList.add("no-figures");
    } else {
      for (const f of figures.get(id)) f.retranslate();
    }
  }
  tocEl.replaceChildren(
    ...chapterIds.map((id) => {
      const h = document.querySelector(`#ch-${id} h1`);
      return el("a", { href: `#ch-${id}` }, h ? h.textContent : id);
    }),
  );
  status.textContent = t("article.ready", { count: chapterIds.length });
}

/**
 * A live graph beside a chapter. Directive keys: graph (dataset id), view
 * (top | 3d, default 3d), labels (auto | all | none), zones (container
 * depth), pitch (3D camera elevation), kinds (comma-separated edge kinds;
 * default all but type).
 */
function createFigure(d) {
  const state = {
    dataset: d.graph,
    top: d.view === "top",
    labels: d.labels ?? "auto",
    zoneDepth: d.zones != null ? Number(d.zones) : null,
    pitch: d.pitch != null ? Number(d.pitch) : 0.5,
    kinds: new Set(d.kinds ? d.kinds.split(",").map((k) => k.trim()) : EDGE_KINDS.filter((k) => k !== "type")),
    renamed: false,
    graph: null,
    sim: null,
    started: false,
    selected: null,
  };
  const tooltip = el("div", { class: "tooltip", hidden: "" });
  const stage = el("div", { class: "stage" }, tooltip);
  const readout = el("div", { class: "readout" });
  const selection = el("div", { class: "selection" });
  const fitBtn = el("button", { type: "button", onclick: () => renderer.fit() });
  const topBtn = el("button", { type: "button", onclick: () => renderer.viewTop() });
  const renameBtn = el("button", { type: "button", "aria-pressed": "false", onclick: () => toggleRename() });
  const openLink = el("a", { class: "muted", target: "_blank", rel: "noopener" });
  const bar = el("div", { class: "bar" }, fitBtn, topBtn, renameBtn, el("span", { class: "spacer" }), openLink);
  const caption = el("figcaption");
  const fig = el("figure", { class: "live" }, stage, readout, selection, bar, caption);

  const renderer = new Graph3D(stage, callbacks());
  renderer.pitch = state.pitch;
  renderer.colorBy = "kind";

  /** Settle the camera after the layout has moved: frame it, then flatten to Top view if the directive asked for it. */
  function settle() {
    renderer.fit();
    if (state.top) renderer.viewTop();
  }

  function callbacks() {
    return {
      onSelect: (node) => {
        state.selected = node;
        if (renderer.selected !== node) renderer.select?.(node);
        showSelection();
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
          kind: kindLabel(node.kind),
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

  function metricsRow(key, value) {
    return el("div", {}, el("span", { class: "muted" }, t(key)), el("b", {}, value.toFixed(3)));
  }

  function showMetrics() {
    if (!state.graph) return;
    const m = computeMetrics(state.graph);
    readout.replaceChildren(
      metricsRow("metric.treeScore", m.overall),
      metricsRow("metric.spanning", m.treeScore),
      metricsRow("metric.acyclicity", m.acyclicity),
      metricsRow("metric.singleCaller", m.singleCallerRatio),
      metricsRow("metric.dagness", m.dagness),
      metricsRow("metric.locality", m.locality),
    );
  }

  function showSelection() {
    const n = state.selected;
    if (!n || !state.graph) {
      selection.replaceChildren(el("span", { class: "muted" }, t("article.selection.empty")));
      return;
    }
    const scope = naturalScope(state.graph, n);
    const where = scope.topLevel ? t("selection.scope.top") : scope.nodes.map((x) => x.name).join(", ");
    selection.replaceChildren(
      el("b", {}, t("article.selection.node", { name: n.name, kind: kindLabel(n.kind), in: n.inDegree, out: n.outDegree, height: n.height })),
      document.createTextNode(` · ${t("selection.scope")}: ${where} (${t("selection.lift", { lift: scope.lift })})`),
    );
  }

  function retranslate() {
    fitBtn.textContent = t("view.fit");
    topBtn.textContent = t("view.top");
    renameBtn.textContent = t(state.renamed ? "article.restore" : "article.rename");
    openLink.textContent = t("article.openInViewer");
    openLink.href = `index.html?data=${encodeURIComponent(state.dataset)}&lang=${getLanguage()}`;
    const ds = datasets.find((x) => x.id === state.dataset);
    caption.textContent = state.renamed ? t("article.renamed") : t("article.dataset", { name: ds ? ds.name : state.dataset });
    showMetrics();
    showSelection();
    renderer.draw();
  }

  /** Rename every declaration to a1, a2, ... and back. Nothing structural changes, so no number moves. */
  function toggleRename() {
    if (!state.graph) return;
    state.renamed = !state.renamed;
    state.graph.nodes.forEach((n, i) => {
      if (n.originalName === undefined) n.originalName = n.name;
      n.name = state.renamed ? `a${i + 1}` : n.originalName;
    });
    renameBtn.setAttribute("aria-pressed", String(state.renamed));
    readout.classList.toggle("changed", state.renamed);
    retranslate();
  }

  async function load() {
    try {
      const res = await fetch(`data/${state.dataset}.json`);
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      const graph = buildGraph(await res.json());
      applyActiveKinds(graph, state.kinds);
      seedPositions(graph);
      state.graph = graph;
      renderer.setGraph(graph);
      renderer.setLabelMode(state.labels);
      renderer.setColorBy("kind");
      renderer.setVisibleKinds(state.kinds);
      renderer.setZones(visibleContainers(graph, state.zoneDepth ?? Math.min(1, graph.maxDepth)));
      const physics = { ...DEFAULT_PHYSICS, springKinds: new Set(state.kinds) };
      const sim = createSimulation(graph, physics);
      sim.stop();
      let fitted = false;
      sim.on("tick", () => {
        renderer.tick();
        if (!fitted && sim.alpha() < 0.6) {
          fitted = true;
          settle();
        }
      });
      sim.on("end", () => settle());
      state.sim = sim;
      retranslate();
      // Run the physics only while the figure is on screen.
      const observer = new IntersectionObserver((entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            renderer.resize();
            if (!state.started) {
              state.started = true;
              sim.alpha(1).restart();
            } else sim.restart();
          } else sim.stop();
        }
      });
      observer.observe(fig);
    } catch (err) {
      caption.textContent = t("article.loadFailed", { file: `data/${state.dataset}.json`, message: err.message });
    }
  }
  load();

  return {
    el: fig,
    retranslate,
    resize: () => renderer.resize(),
    deselect: () => renderer.select(null),
  };
}

onLanguageChange(() => {
  try {
    localStorage.setItem("lang", getLanguage());
  } catch {
    // Storage may be unavailable; the ?lang= parameter still works.
  }
  const url = new URL(location.href);
  url.searchParams.set("lang", getLanguage());
  history.replaceState(null, "", url);
  applyStaticTranslations();
  renderChapters();
});

window.addEventListener("resize", () => {
  for (const made of figures.values()) for (const f of made) f.resize();
});

d3.select(window).on("keydown", (event) => {
  if (event.key !== "Escape") return;
  for (const made of figures.values()) for (const f of made) f.deselect();
});

async function main() {
  applyStaticTranslations();
  try {
    const [ids, index] = await Promise.all([fetch("content/chapters.json"), fetch("data/index.json")]);
    chapterIds = ids.ok ? await ids.json() : [];
    datasets = index.ok ? await index.json() : [];
  } catch (err) {
    status.textContent = t("article.loadFailed", { file: "content/chapters.json", message: err.message });
    return;
  }
  await renderChapters();
}

main();
