// 3D renderer: canvas projection of the force layout where the vertical axis
// is the call height (deepest callers on top, pure callees at the bottom).
// The x/y coordinates come from the same simulation as the 2D view; only the
// projection differs, so switching views never restarts the physics.
/* global d3 */
import { EDGE_KINDS, edgeBowOffset, edgeColor, heightColor, kindColor, zoneColor } from "./colors.js";
import { t } from "./i18n.js";
import { nodeRadius } from "./simulation.js";
import { hullPath } from "./zones.js";

// Smallest distance, in radians, that pitch is kept away from a level view.
// Camera elevation is periodic every PI, not just 2*PI (see clampPitch), and
// at each of those points the height axis carries no perspective at all (see
// the constructor); this keeps pitch just off every one of those dead spots
// without stopping the camera from getting close to level, or from orbiting
// all the way through a full vertical loop.
const MIN_PITCH = 0.15;

// focal is kept proportional to the graph's own extent (set in fit(), below)
// rather than a fixed world-unit constant: a focal length that's small next
// to the content's actual size lets ordinary orbiting bring a node's depth
// close enough to -focal that its perspective scale blows up, stretching it
// like a very wide-angle (near-fisheye) lens. Tying focal to extent keeps
// the lens "normal" regardless of how large the force layout happens to be.
const FOCAL_EXTENT_RATIO = 1.2;

// Points whose focal-relative depth would magnify them past this factor are
// clipped (not drawn) instead of being scaled up without bound: a real
// camera doesn't render what's essentially against the lens, it just falls
// out of frame.
const MAX_MAGNIFICATION = 4;

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
    this.visibleKinds = new Set(EDGE_KINDS);
    this.layerGap = 80;
    this.showLayers = true;
    this.autoRotate = false;

    this.yaw = -0.6;
    // Camera elevation above the ground plane: 0 = looking horizontally,
    // +PI/2 = straight down from above, -PI/2 = straight up from below, and
    // it keeps going past there — orbiting over the top or under the bottom
    // continues the loop rather than stopping, so every angle is reachable.
    // Kept away from exactly level (a multiple of PI): at those elevations
    // the camera's forward axis is horizontal, so height never contributes
    // to depth and the call-height axis would render with no perspective at
    // all (a real pinhole camera has the same dead spot). MIN_PITCH keeps
    // some of it visible at every elevation.
    this.pitch = 0.9;
    // True while showing the "Top view" preset: a perspective-free look
    // straight down the height axis (see viewTop()), which is what a purely
    // 2D top-down rendering of this same x/y layout would look like — the
    // graph's own physics never uses height, so seen from directly above and
    // without perspective it is exactly the layout a 2D-only renderer would
    // draw. Orbiting away from it (see bindEvents) turns it back off, since
    // it is a specific camera pose, not a general drawing mode.
    this.orthographic = false;
    this.zoomK = 1;
    // World point the camera orbits and looks at (yaw/pitch pivot around
    // this, not the origin) and which always projects to screen centre
    // (see project()) — set from the graph's own bounding box in fit(), or
    // a node's position in focusOn(), since nothing about the physics
    // guarantees the layout sits near world origin (see docs/DESIGN.md,
    // "Nothing defines a centre"). A shift-drag pan (see bindEvents) moves
    // this point in world space rather than adding a screen-space offset,
    // so the point under the pointer keeps tracking it and orbiting always
    // pivots on screen centre, panned or not.
    this.targetX = 0;
    this.targetY = 0;
    this.targetZ = 0;
    // Node target is following, if any (see focusOn()). Node positions keep
    // changing under the physics — settling, or reheated by dragging another
    // node or changing physics params — so a one-off snapshot into target
    // goes stale almost immediately; draw() re-reads this node's live
    // position into target every frame instead, so orbiting always pivots
    // on where the node actually is right now.
    this.focusedNode = null;
    // Placeholder until the first fit(), which sets this from the graph's
    // own extent (see FOCAL_EXTENT_RATIO).
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
    document.addEventListener("pointerlockchange", () => {
      // Escape (or anything else) can end the lock without a pointerup;
      // without this the next real pointerup would use a stale `dragging`.
      if (document.pointerLockElement !== c && dragging && !dragging.pan) dragging = null;
    });
    c.addEventListener("pointermove", (e) => {
      if (dragging) {
        // Orbiting needs to accept a drag larger than the screen: reaching a
        // pitch on the far side of level (looking up from underneath, say)
        // can take more pixels of movement than fit on the actual display.
        // Pointer lock removes that ceiling by reporting relative movement
        // (movementX/Y) instead of an absolute, screen-bounded position, the
        // same trick orbit/first-person controls in web-based 3D tools use.
        // Only requested once the cursor actually reaches the window edge —
        // not on every orbit drag — because acquiring it hides the system
        // cursor and the browser announces that with its own "press Esc to
        // exit" banner; doing that for every ordinary small drag would show
        // it constantly. Panning never requests it, since it's a direct 1:1
        // drag. `pointerlockchange` below cleans up if the lock ends some
        // other way (Escape) mid-drag.
        const edge = 2;
        const atEdge = e.clientX <= edge || e.clientY <= edge || e.clientX >= window.innerWidth - edge || e.clientY >= window.innerHeight - edge;
        if (!dragging.pan && atEdge && document.pointerLockElement !== c) c.requestPointerLock?.();
        const locked = document.pointerLockElement === c;
        const dx = locked ? e.movementX : e.clientX - dragging.x;
        const dy = locked ? e.movementY : e.clientY - dragging.y;
        dragging.x = e.clientX;
        dragging.y = e.clientY;
        if (Math.abs(dx) + Math.abs(dy) > 1) moved = true;
        if (dragging.pan) {
          // Move `target` itself in world space by the screen-space drag,
          // instead of adding a separate screen-space offset: that keeps
          // orbiting pivoting on screen centre even after panning (see the
          // constructor). Stop following a focused node so the pan sticks
          // instead of being overridden on the next frame.
          this.focusedNode = null;
          const scale = this.zoomK; // scale at the target's own depth (project(): depth 0)
          const ddx = dx / scale;
          const ddy = -dy / scale; // +1 = one world unit of screen "up"
          const cy = Math.cos(this.yaw);
          const sy = Math.sin(this.yaw);
          const cp = Math.cos(this.pitch);
          const sp = Math.sin(this.pitch);
          // World-space "right" and "up" directions for one unit of screen
          // "right"/"up": the inverse of project()'s yaw then pitch rotation.
          this.targetX -= ddx * cy + ddy * sy * sp;
          this.targetY -= -ddx * sy + ddy * cy * sp;
          this.targetZ -= ddy * cp;
        } else {
          this.yaw += dx * 0.008;
          this.pitch = clampPitch(this.pitch + dy * 0.006);
          // Orbiting is a deliberate move away from the flat top-down pose.
          this.orthographic = false;
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
      if (document.pointerLockElement === c) document.exitPointerLock();
    };
    c.addEventListener("pointerup", end);
    c.addEventListener("pointercancel", () => {
      dragging = null;
      if (document.pointerLockElement === c) document.exitPointerLock();
    });
    c.addEventListener("dblclick", (e) => {
      const n = this.hitTest(e.offsetX, e.offsetY);
      if (n) {
        this.select(n);
        this.focusOn(n);
      }
    });
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
    this.focusedNode = null;
    // Zones belong to the previous graph until the app calls setZones again.
    this.zones = [];
    this.maxHeight = graph.nodes.reduce((h, n) => Math.max(h, n.height), 0);
    this.draw();
  }

  setZones(containers) {
    this.zones = containers;
    this.draw();
  }

  /** Degrees or heights changed: recompute the height range and redraw. */
  restyle() {
    if (this.graph) this.maxHeight = this.graph.nodes.reduce((h, n) => Math.max(h, n.height), 0);
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

  setVisibleKinds(kinds) {
    this.visibleKinds = new Set(kinds);
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

  /**
   * Project a world point (x, y horizontal plane; z up) to screen space.
   * The camera orbits `target`, not the origin: yaw spins it around the
   * vertical axis through target, pitch is its elevation. After the yaw
   * rotation X points right and Y away from the camera; tilting by pitch
   * turns "away" into "up on screen" and brings higher points closer to a
   * camera that looks down. Because rotation applies to the offset from
   * target, target itself always projects to screen centre (X = Y = 0)
   * regardless of yaw/pitch — orbiting never drifts it away from centre.
   */
  project(x, y, z) {
    const rx = x - this.targetX;
    const ry = y - this.targetY;
    const rz = z - this.targetZ;
    const cy = Math.cos(this.yaw);
    const sy = Math.sin(this.yaw);
    const X = rx * cy - ry * sy;
    const Y = rx * sy + ry * cy;
    const cp = Math.cos(this.pitch);
    const sp = Math.sin(this.pitch);
    const screenUp = Y * sp + rz * cp;
    const depth = Y * cp - rz * sp; // distance along the view direction; negative = nearer than target
    // Orthographic (Top view, see viewTop()): every point scales the same
    // regardless of depth, exactly like a 2D top-down drawing of the x/y
    // layout — there is no near plane to clip against either.
    if (this.orthographic) {
      const scale = this.zoomK;
      return { x: this.width / 2 + X * scale, y: this.height / 2 - screenUp * scale, scale, depth, clipped: false };
    }
    const focalDepth = this.focal + depth;
    if (focalDepth <= this.focal / MAX_MAGNIFICATION) {
      return { x: null, y: null, scale: 0, depth, clipped: true };
    }
    const scale = (this.focal / focalDepth) * this.zoomK;
    return {
      x: this.width / 2 + X * scale,
      y: this.height / 2 - screenUp * scale,
      scale,
      depth,
      clipped: false,
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
    if (this.focusedNode) {
      this.targetX = this.focusedNode.x;
      this.targetY = this.focusedNode.y;
      this.targetZ = this.zOf(this.focusedNode);
    }
    const { nodes, links } = this.graph;
    const sel = this.selected;
    const neighbours = this.neighbourSet();

    // Project all nodes once per frame. Nodes too close to the camera to
    // project sanely (see MAX_MAGNIFICATION) are left out, the same way a
    // real camera simply doesn't show what's past its near plane.
    const projected = nodes.map((n) => ({ node: n, ...this.project(n.x, n.y, this.zOf(n)) })).filter((p) => !p.clipped);
    this.projected = projected;
    const byIndex = new Map(projected.map((p) => [p.node.index, p]));

    // Layer planes: a translucent rectangle per call height. Meaningless in
    // Top view — looking straight down the height axis, every layer's
    // rectangle projects to the exact same screen quad, so they would only
    // stack into a single smear instead of showing anything.
    if (this.showLayers && !this.orthographic && nodes.length > 0) {
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
        if (corners.some((c) => c.clipped)) continue;
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
      color.opacity = 0.1;
      ctx.fillStyle = color.formatRgb();
      ctx.fill(path);
      color.opacity = 0.45;
      ctx.strokeStyle = color.formatRgb();
      ctx.lineWidth = 1;
      ctx.stroke(path);
    }

    // Edges, far ones first.
    const edgeItems = links
      .filter((l) => this.visibleKinds.has(l.kind))
      .map((l) => {
        const s = byIndex.get(l.source.index);
        const t = byIndex.get(l.target.index);
        return s && t ? { l, s, t, depth: (s.depth + t.depth) / 2 } : null;
      })
      .filter((item) => item !== null)
      .sort((a, b) => b.depth - a.depth);
    for (const { l, s, t } of edgeItems) {
      const active = sel && (l.source === sel || l.target === sel);
      const dimmed = sel && !active;
      ctx.strokeStyle = active ? "#111827" : edgeColor(l.kind);
      // Full opacity unless some other node is selected: `active`/`dimmed`
      // already partition every edge when `sel` is set, so with nothing
      // selected both are false and this used to fall through to a default
      // 0.55 — permanently muting every edge kind's colour well below its
      // legend swatch (nearly to invisibility for paler kinds like
      // `reference`), which is what made the graph look like it didn't
      // match the legend at all.
      ctx.globalAlpha = dimmed ? 0.08 : 1;
      ctx.lineWidth = active ? 2 : 1;
      ctx.setLineDash(l.inferred ? [3, 3] : l.kind === "type" || l.kind === "reference" ? [1, 3] : []);
      if (l.source === l.target) {
        const r = nodeRadius(l.source) * s.scale;
        ctx.beginPath();
        ctx.arc(s.x + r, s.y - r, r, 0, Math.PI * 2);
        ctx.stroke();
      } else {
        // `reference` and `write` bow through edgeBowOffset (colors.js, the
        // same function Graph2D uses), so the read and write halves of a
        // compound assignment never draw on top of each other.
        let control = null;
        const bow = edgeBowOffset(l.source, l.target, l.kind);
        if (bow) {
          const mx = (l.source.x + l.target.x) / 2 + bow.x;
          const my = (l.source.y + l.target.y) / 2 + bow.y;
          const mz = (this.zOf(l.source) + this.zOf(l.target)) / 2;
          const p = this.project(mx, my, mz);
          if (!p.clipped) control = p;
        }
        drawArrow(ctx, s.x, s.y, t.x, t.y, nodeRadius(l.target) * t.scale + 1, 5 * Math.max(0.6, t.scale), control);
      }
    }
    ctx.setLineDash([]);
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
    this.focusedNode = null;
    // The general "get me unstuck" reset, so it returns to the normal
    // perspective view too, the same as orbiting away from Top view does.
    this.orthographic = false;
    this.targetX = 0;
    this.targetY = 0;
    this.targetZ = 0;
    if (!this.graph || this.graph.nodes.length === 0) return;
    const xs = this.graph.nodes.map((n) => n.x);
    const ys = this.graph.nodes.map((n) => n.y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const extent = Math.max(maxX - minX, maxY - minY, this.maxHeight * this.layerGap, 1);
    this.zoomK = Math.max(0.05, Math.min(2, (Math.min(this.width, this.height) * 0.8) / extent));
    this.focal = extent * FOCAL_EXTENT_RATIO;
    // Repulsion has no range limit and nothing pulls nodes toward a centre
    // (by design, see docs/DESIGN.md), so the layout's own bounding box can
    // sit anywhere in world space. Point the camera's orbit target at the
    // box's own centre — since target always projects to screen centre (see
    // project()) — instead of leaving it at the origin, or both zooming and
    // rotating would drift the graph away from screen centre.
    this.targetX = (minX + maxX) / 2;
    this.targetY = (minY + maxY) / 2;
    this.targetZ = (this.maxHeight * this.layerGap) / 2;
    this.draw();
  }

  /**
   * Centre the camera on one node without touching yaw/pitch: zoom in a
   * little if it's currently zoomed out, then re-point the orbit target at
   * the node so it lands exactly at screen centre. draw() keeps re-reading
   * the node's live position into target every frame (see focusedNode)
   * rather than a one-off snapshot, so it stays centred through further
   * rotation and through the physics moving it, not just while both hold
   * still.
   */
  focusOn(node) {
    if (!node) return;
    this.zoomK = Math.min(8, Math.max(this.zoomK, 1.2));
    this.focusedNode = node;
    this.targetX = node.x;
    this.targetY = node.y;
    this.targetZ = this.zOf(node);
    this.draw();
  }

  /**
   * Look straight down the height axis with no perspective: yaw stops
   * mattering once pitch points straight down, so only pitch needs setting,
   * to exactly PI/2 rather than through clampPitch — PI/2 is the view with
   * the *most* height contribution, not one of the level dead spots
   * clampPitch pushes away from (see MIN_PITCH). Orbiting away from here
   * (bindEvents) turns `orthographic` back off, and so does fit() — the two
   * ways out of Top view mirror the two ways in (bindEvents' orbit, this
   * method).
   */
  viewTop() {
    this.pitch = Math.PI / 2;
    this.orthographic = true;
    this.draw();
  }

  show(visible) {
    this.canvas.style.display = visible ? null : "none";
  }
}

/**
 * Push pitch away from the nearest level orientation (a multiple of PI —
 * see MIN_PITCH) by at least MIN_PITCH, without otherwise bounding its
 * range: unlike a clamp to [-PI/2, PI/2], this lets the camera complete a
 * full vertical loop, orbiting up over the top or down under the bottom and
 * on around, instead of stopping at straight up/down.
 */
function clampPitch(pitch) {
  const nearestLevel = Math.round(pitch / Math.PI) * Math.PI;
  const offset = pitch - nearestLevel;
  if (Math.abs(offset) >= MIN_PITCH) return pitch;
  return nearestLevel + (offset < 0 ? -MIN_PITCH : MIN_PITCH);
}

/**
 * `control`, when given, is a projected point the line bows through (a
 * quadratic curve, via colors.js's edgeBowOffset) instead of running
 * straight. The arrowhead uses the curve's own end tangent
 * (control -> x1,y1), not the start -> end line.
 */
function drawArrow(ctx, x0, y0, x1, y1, stopBefore, headSize, control) {
  const tangentX = control ? x1 - control.x : x1 - x0;
  const tangentY = control ? y1 - control.y : y1 - y0;
  const d = Math.hypot(tangentX, tangentY) || 1;
  const ux = tangentX / d;
  const uy = tangentY / d;
  const ex = x1 - ux * stopBefore;
  const ey = y1 - uy * stopBefore;
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  if (control) ctx.quadraticCurveTo(control.x, control.y, ex, ey);
  else ctx.lineTo(ex, ey);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(ex, ey);
  ctx.lineTo(ex - ux * headSize - uy * headSize * 0.5, ey - uy * headSize + ux * headSize * 0.5);
  ctx.lineTo(ex - ux * headSize + uy * headSize * 0.5, ey - uy * headSize - ux * headSize * 0.5);
  ctx.closePath();
  ctx.fillStyle = ctx.strokeStyle;
  ctx.fill();
}
