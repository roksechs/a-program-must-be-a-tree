// 3D renderer: canvas projection of the force layout where the vertical axis
// is the call height (deepest callers on top, pure callees at the bottom).
// The x/y coordinates come from the same simulation as the 2D view; only the
// projection differs, so switching views never restarts the physics.
/* global d3 */
import { edgeColor, heightColor, kindColor, zoneColor } from "./colors.js";
import { t } from "./i18n.js";
import { nodeRadius } from "./simulation.js";
import { hullPath } from "./zones.js";

export class Graph3D {
  constructor(host, callbacks) {
    this.host = host;
    this.callbacks = callbacks;
    this.graph = null;
    this.zones = [];
    this.selected = null;
    this.hovered = null;
    this.labelMode = "auto";
    this.colorBy = "height";
    this.layerGap = 80;
    this.showLayers = true;
    this.autoRotate = false;

    this.yaw = -0.6;
    this.pitch = 0.9; // 0 = looking horizontally, PI/2 = top-down
    this.zoomK = 1;
    this.panX = 0;
    this.panY = 0;
    this.focal = 1400;

    this.canvas = document.createElement("canvas");
    this.canvas.className = "graph3d";
    host.appendChild(this.canvas);
    this.ctx = this.canvas.getContext("2d");
    this.projected = [];
    this.bindEvents();
    this.resize();
  }

  bindEvents() {
    const c = this.canvas;
    let dragging = null;
    let moved = false;
    c.addEventListener("pointerdown", (e) => {
      dragging = { x: e.clientX, y: e.clientY, pan: e.shiftKey || e.button === 1 };
      moved = false;
      c.setPointerCapture(e.pointerId);
    });
    c.addEventListener("pointermove", (e) => {
      if (dragging) {
        const dx = e.clientX - dragging.x;
        const dy = e.clientY - dragging.y;
        dragging.x = e.clientX;
        dragging.y = e.clientY;
        if (Math.abs(dx) + Math.abs(dy) > 1) moved = true;
        if (dragging.pan) {
          this.panX += dx;
          this.panY += dy;
        } else {
          this.yaw += dx * 0.008;
          this.pitch = Math.max(0.02, Math.min(Math.PI / 2, this.pitch + dy * 0.006));
        }
        this.draw();
      } else {
        const n = this.hitTest(e.offsetX, e.offsetY);
        if (n !== this.hovered) {
          this.hovered = n;
          this.draw();
        }
        this.callbacks.onHover?.(n, e);
      }
    });
    const end = (e) => {
      if (!dragging) return;
      if (!moved) {
        const n = this.hitTest(e.offsetX, e.offsetY);
        this.select(n === this.selected ? null : n);
      }
      dragging = null;
    };
    c.addEventListener("pointerup", end);
    c.addEventListener("pointercancel", () => (dragging = null));
    c.addEventListener("pointerleave", () => {
      this.hovered = null;
      this.callbacks.onHover?.(null);
    });
    c.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        const f = Math.exp(-e.deltaY * 0.0015);
        this.zoomK = Math.max(0.05, Math.min(8, this.zoomK * f));
        this.draw();
      },
      { passive: false },
    );
  }

  resize() {
    const { width, height } = this.host.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.width = width;
    this.height = height;
    this.canvas.width = Math.round(width * dpr);
    this.canvas.height = Math.round(height * dpr);
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${height}px`;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.draw();
  }

  setGraph(graph) {
    this.graph = graph;
    this.selected = null;
    this.hovered = null;
    // Zones belong to the previous graph until the app calls setZones again.
    this.zones = [];
    this.maxHeight = graph.nodes.reduce((h, n) => Math.max(h, n.height), 0);
    this.draw();
  }

  setZones(containers) {
    this.zones = containers;
    this.draw();
  }

  setLabelMode(mode) {
    this.labelMode = mode;
    this.draw();
  }

  setColorBy(mode) {
    this.colorBy = mode;
    this.draw();
  }

  setLayerGap(gap) {
    this.layerGap = gap;
    this.draw();
  }

  setShowLayers(show) {
    this.showLayers = show;
    this.draw();
  }

  select(node) {
    this.selected = node;
    this.draw();
    this.callbacks.onSelect?.(node);
  }

  /** Project a world point (x, y horizontal plane; z up) to screen space. */
  project(x, y, z) {
    const cy = Math.cos(this.yaw);
    const sy = Math.sin(this.yaw);
    const X = x * cy - y * sy;
    const Y = x * sy + y * cy;
    const cp = Math.cos(this.pitch);
    const sp = Math.sin(this.pitch);
    const screenY = Y * sp - z * cp;
    const depth = Y * cp + z * sp;
    const scale = (this.focal / (this.focal + depth)) * this.zoomK;
    return {
      x: this.width / 2 + this.panX + X * scale,
      y: this.height / 2 + this.panY + screenY * scale,
      scale,
      depth,
    };
  }

  zOf(node) {
    return node.height * this.layerGap;
  }

  hitTest(px, py) {
    let best = null;
    let bestD = Infinity;
    for (const p of this.projected) {
      const r = nodeRadius(p.node) * p.scale + 3;
      const d = Math.hypot(p.x - px, p.y - py);
      if (d <= r && p.depth < bestD) {
        best = p.node;
        bestD = p.depth;
      }
    }
    return best;
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

  tick() {
    if (this.autoRotate) this.yaw += 0.003;
    this.draw();
  }

  draw() {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.width, this.height);
    if (!this.graph) return;
    const { nodes, links } = this.graph;
    const sel = this.selected;
    const neighbours = this.neighbourSet();

    // Project all nodes once per frame.
    const projected = nodes.map((n) => ({ node: n, ...this.project(n.x, n.y, this.zOf(n)) }));
    this.projected = projected;
    const byIndex = new Map(projected.map((p) => [p.node.index, p]));

    // Layer planes: a translucent rectangle per call height.
    if (this.showLayers && nodes.length > 0) {
      let x0 = Infinity;
      let x1 = -Infinity;
      let y0 = Infinity;
      let y1 = -Infinity;
      for (const n of nodes) {
        if (n.x < x0) x0 = n.x;
        if (n.x > x1) x1 = n.x;
        if (n.y < y0) y0 = n.y;
        if (n.y > y1) y1 = n.y;
      }
      const pad = 40;
      x0 -= pad;
      x1 += pad;
      y0 -= pad;
      y1 += pad;
      for (let h = 0; h <= this.maxHeight; h++) {
        const z = h * this.layerGap;
        const corners = [
          this.project(x0, y0, z),
          this.project(x1, y0, z),
          this.project(x1, y1, z),
          this.project(x0, y1, z),
        ];
        ctx.beginPath();
        ctx.moveTo(corners[0].x, corners[0].y);
        for (let i = 1; i < 4; i++) ctx.lineTo(corners[i].x, corners[i].y);
        ctx.closePath();
        ctx.fillStyle = "rgba(100, 116, 139, 0.04)";
        ctx.strokeStyle = "rgba(100, 116, 139, 0.25)";
        ctx.lineWidth = 1;
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = "rgba(71, 85, 105, 0.7)";
        ctx.font = "11px system-ui, sans-serif";
        ctx.fillText(t("graph3d.height", { height: h }), corners[0].x + 4, corners[0].y - 3);
      }
    }

    // Zones: hull of the projected member positions.
    for (const c of this.zones) {
      const pts = [];
      for (const n of c.nodes) {
        const p = byIndex.get(n.index);
        if (p && p.node === n) pts.push([p.x, p.y]);
      }
      const d = hullPath(pts, (c.isFile ? 12 : 20 + 4 * c.depth) * this.zoomK);
      if (!d) continue;
      const path = new Path2D(d);
      const color = d3.color(zoneColor(c));
      color.opacity = c.isFile ? 0.12 : 0.06;
      ctx.fillStyle = color.formatRgb();
      ctx.fill(path);
      color.opacity = c.isFile ? 0.5 : 0.3;
      ctx.strokeStyle = color.formatRgb();
      ctx.setLineDash(c.isFile ? [] : [6, 4]);
      ctx.lineWidth = 1;
      ctx.stroke(path);
      ctx.setLineDash([]);
    }

    // Edges, far ones first.
    const edgeItems = links
      .map((l) => {
        const s = byIndex.get(l.source.index);
        const t = byIndex.get(l.target.index);
        return { l, s, t, depth: (s.depth + t.depth) / 2 };
      })
      .sort((a, b) => b.depth - a.depth);
    for (const { l, s, t } of edgeItems) {
      const active = sel && (l.source === sel || l.target === sel);
      const dimmed = sel && !active;
      ctx.strokeStyle = active ? "#111827" : edgeColor(l.kind);
      ctx.globalAlpha = dimmed ? 0.08 : active ? 1 : 0.55;
      ctx.lineWidth = active ? 2 : 1;
      if (l.source === l.target) {
        const r = nodeRadius(l.source) * s.scale;
        ctx.beginPath();
        ctx.arc(s.x + r, s.y - r, r, 0, Math.PI * 2);
        ctx.stroke();
      } else {
        drawArrow(ctx, s.x, s.y, t.x, t.y, nodeRadius(l.target) * t.scale + 1, 5 * Math.max(0.6, t.scale));
      }
    }
    ctx.globalAlpha = 1;

    // Nodes, far ones first.
    const sorted = [...projected].sort((a, b) => b.depth - a.depth);
    ctx.font = "11px system-ui, sans-serif";
    for (const p of sorted) {
      const n = p.node;
      const r = nodeRadius(n) * p.scale;
      const dimmed = sel && n !== sel && !neighbours.has(n);
      ctx.globalAlpha = dimmed ? 0.2 : 1;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.fillStyle = this.colorBy === "height" ? heightColor(n.height, this.maxHeight) : kindColor(n.kind);
      ctx.fill();
      ctx.lineWidth = n === sel ? 3 : n.inCycle ? 2 : 1;
      ctx.strokeStyle = n === sel ? "#111827" : n.inCycle ? "#b91c1c" : "#ffffff";
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    // Labels.
    const showAll = this.labelMode === "all" || (this.labelMode === "auto" && nodes.length <= 60 && this.zoomK >= 0.7);
    ctx.fillStyle = "#111827";
    ctx.textAlign = "center";
    for (const p of sorted) {
      const n = p.node;
      const wanted = n === sel || n === this.hovered || neighbours.has(n) || (showAll && this.labelMode !== "none");
      if (!wanted) continue;
      const r = nodeRadius(n) * p.scale;
      ctx.globalAlpha = sel && n !== sel && !neighbours.has(n) && n !== this.hovered ? 0.3 : 1;
      ctx.fillText(n.name, p.x, p.y - r - 4);
    }
    ctx.globalAlpha = 1;
    ctx.textAlign = "start";
  }

  fit() {
    this.zoomK = 1;
    this.panX = 0;
    this.panY = 0;
    if (!this.graph || this.graph.nodes.length === 0) return;
    const xs = this.graph.nodes.map((n) => n.x);
    const ys = this.graph.nodes.map((n) => n.y);
    const extent = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys), this.maxHeight * this.layerGap, 1);
    this.zoomK = Math.max(0.05, Math.min(2, (Math.min(this.width, this.height) * 0.8) / extent));
    this.draw();
  }

  show(visible) {
    this.canvas.style.display = visible ? null : "none";
  }

  destroy() {
    this.canvas.remove();
  }
}

function drawArrow(ctx, x0, y0, x1, y1, stopBefore, headSize) {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const d = Math.hypot(dx, dy) || 1;
  const ux = dx / d;
  const uy = dy / d;
  const ex = x1 - ux * stopBefore;
  const ey = y1 - uy * stopBefore;
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(ex, ey);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(ex, ey);
  ctx.lineTo(ex - ux * headSize - uy * headSize * 0.5, ey - uy * headSize + ux * headSize * 0.5);
  ctx.lineTo(ex - ux * headSize + uy * headSize * 0.5, ey - uy * headSize - ux * headSize * 0.5);
  ctx.closePath();
  ctx.fillStyle = ctx.strokeStyle;
  ctx.fill();
}
