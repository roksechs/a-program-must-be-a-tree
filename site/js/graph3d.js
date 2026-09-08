// 3D renderer: canvas projection of the force layout where the vertical axis
// is the call height (deepest callers on top, pure callees at the bottom).
// The x/y coordinates come from the same simulation as the 2D view; only the
// projection differs, so switching views never restarts the physics.
/* global d3 */
import { EDGE_KINDS, edgeBowOffset, edgeColor, heightColor, kindColor, zoneColor } from "./colors.js";
import { t } from "./i18n.js";
import { hullPath } from "./zones.js";

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
    // A ctrl/cmd+click on a second node while one is selected asks "how does
    // the selected node reach this one" (see paths.js's pathBetween(), run
    // by the app, not here — this renderer only draws whatever it is given).
    // Both null together, or both set together; never one without the other.
    this.pathNodes = null;
    this.pathEdges = null;
    // Motif highlighting (motifs.js): `Map<kind, {nodes, edges}>`, drawn as
    // an overlay — a coloured ring per matching node, a thicker stroke per
    // matching edge — on top of the ordinary drawing rather than replacing
    // it, since (unlike a path) a motif is a category to spot within the
    // whole graph, not a single relationship to isolate from everything
    // else; a node can belong to more than one at once (e.g. a hub that is
    // also in a cycle), each getting its own ring rather than one winning.
    this.motifs = null;
    this.labelMode = "auto";
    this.colorBy = "height";
    this.visibleKinds = new Set(EDGE_KINDS);
    // Vertical world-space distance between two consecutive call heights.
    // Only spaces the height axis out; nothing is drawn at a height of its
    // own (the layer planes that used to be were removed — see zOf()).
    this.layerGap = 80;
    this.autoRotate = false;

    this.yaw = -0.6;
    // Camera elevation above the ground plane: 0 = looking horizontally,
    // +PI/2 = straight down from above, -PI/2 = straight up from below, and
    // it keeps going past there — orbiting over the top or under the bottom
    // continues the loop rather than stopping, so every angle is reachable,
    // including exactly level. At a level elevation the camera's forward
    // axis is horizontal, so height stops contributing to depth (the layer
    // planes, drawn edge-on, briefly flatten to lines — see draw()) the same
    // way a real pinhole camera has the same momentary dead spot; earlier
    // versions kept pitch a fixed distance away from every such point to
    // avoid it, which instead made crossing one a sudden jump (an orbit drag
    // can only sample discrete steps, so a value forced to stay outside a
    // band has to skip over it, however small the step) for a flaw that is
    // only ever visible for the single instant a continuous orbit passes
    // through the exact angle anyway.
    this.pitch = 0.9;
    // Camera roll (tilt around the forward axis, A/D — see bindEvents):
    // unlike yaw/pitch there is no pointer gesture for it, only the keyboard,
    // and it auto-levels back to 0 once A/D stop being held (see keyStep())
    // rather than staying wherever it was left, since an accidentally tilted
    // horizon has no way back other than rolling the exact opposite amount.
    this.roll = 0;
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
    c.addEventListener("pointermove", (e) => {
      if (dragging) {
        // setPointerCapture (pointerdown, above) keeps delivering these to
        // the canvas even once the cursor leaves it, up to the edge of the
        // screen — enough range for an ordinary orbit drag. A single drag
        // reaching all the way around (say, a full vertical loop) can take
        // more pixels than fit on the actual display; that needs release
        // and re-drag to continue, rather than Pointer Lock's uncapped
        // relative movement, which hides the system cursor and made the
        // browser announce it with its own "press Esc to exit" banner even
        // just brushing the window edge — worse than the capped range it
        // bought back.
        const dx = e.clientX - dragging.x;
        const dy = e.clientY - dragging.y;
        dragging.x = e.clientX;
        dragging.y = e.clientY;
        if (Math.abs(dx) + Math.abs(dy) > 1) moved = true;
        if (dragging.pan) {
          this.panScreen(dx, dy);
        } else {
          this.yaw += dx * 0.008;
          this.pitch += dy * 0.006;
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
        // Ctrl/cmd+click a second node while one is already selected: "how
        // does the selected node reach this one" (see paths.js), instead of
        // the plain click's normal select/deselect — the origin stays
        // selected (its own callers/callees stay in the Selection panel)
        // with the path drawn as an overlay on top of it.
        if ((e.ctrlKey || e.metaKey) && this.selected && n && n !== this.selected) {
          this.callbacks.onFindPath?.(this.selected, n);
        } else {
          this.select(n === this.selected ? null : n);
        }
      }
      dragging = null;
    };
    c.addEventListener("pointerup", end);
    c.addEventListener("pointercancel", () => {
      dragging = null;
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

    // Keyboard camera controls, held down like a game camera: W/S pitch the
    // camera up/down, A/D roll it, Q/E yaw it left/right, and the up/down
    // arrows dolly forward/back — an actual move through the scene (see
    // dolly()), not a rescale like the wheel's zoom. Listens on window
    // rather than the canvas since the canvas never takes keyboard focus,
    // and is skipped while a text field (e.g. the GitHub repo box) is
    // focused so typing doesn't fly the camera around.
    const ROTATE_STEP = 0.03; // radians per animation frame
    const DOLLY_STEP = 0.02; // fraction of the focal length per animation frame
    const KEY_ACTIONS = {
      w: () => this.rotateInPlace(0, ROTATE_STEP),
      s: () => this.rotateInPlace(0, -ROTATE_STEP),
      a: () => {
        this.roll -= ROTATE_STEP;
      },
      d: () => {
        this.roll += ROTATE_STEP;
      },
      q: () => this.rotateInPlace(-ROTATE_STEP, 0),
      e: () => this.rotateInPlace(ROTATE_STEP, 0),
      arrowup: () => {
        this.dolly(this.focal * DOLLY_STEP);
      },
      arrowdown: () => {
        this.dolly(-this.focal * DOLLY_STEP);
      },
    };
    const heldKeys = new Set();
    let keyRAF = null;
    const isTyping = () => {
      const el = document.activeElement;
      return Boolean(el) && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable);
    };
    const keyStep = () => {
      for (const k of heldKeys) {
        KEY_ACTIONS[k]();
        // A rotation is a deliberate move away from the flat top-down pose,
        // same as an orbit drag; a dolly (arrow keys) leaves it alone, same
        // as a shift-drag pan does.
        if (k !== "arrowup" && k !== "arrowdown") this.orthographic = false;
      }
      // Auto-level: once A/D aren't actively rolling it further, roll eases
      // back to 0 on its own instead of leaving the horizon tilted, the same
      // way a game camera self-rights after a roll input ends. This keeps
      // the loop alive past the last keyup until it settles.
      if (!heldKeys.has("a") && !heldKeys.has("d") && this.roll !== 0) {
        this.roll *= 0.85;
        if (Math.abs(this.roll) < 0.001) this.roll = 0;
      }
      if (heldKeys.size === 0 && this.roll === 0) {
        keyRAF = null;
        return;
      }
      this.draw();
      keyRAF = requestAnimationFrame(keyStep);
    };
    window.addEventListener("keydown", (e) => {
      const k = e.key.toLowerCase();
      if (!(k in KEY_ACTIONS) || isTyping()) return;
      e.preventDefault(); // stop the arrow keys from scrolling the page
      heldKeys.add(k);
      if (keyRAF === null) keyRAF = requestAnimationFrame(keyStep);
    });
    window.addEventListener("keyup", (e) => heldKeys.delete(e.key.toLowerCase()));
    window.addEventListener("blur", () => heldKeys.clear());
  }

  /**
   * Pan by a screen-space delta (dx right, dy down) — used by the shift-drag
   * pan in bindEvents: move `target` itself in world space instead of adding
   * a separate screen-space offset, so orbiting keeps pivoting on screen
   * centre even after panning (see the constructor), and stop following a
   * focused node so the pan sticks instead of being overridden on the next
   * frame.
   */
  panScreen(dx, dy) {
    this.focusedNode = null;
    const scale = this.zoomK; // scale at the target's own depth (project(): depth 0)
    let ddx = dx / scale;
    let ddy = -dy / scale; // +1 = one world unit of screen "up"
    if (this.roll !== 0) {
      // Undo the on-screen roll rotation first: dx/dy arrive in final screen
      // pixels, but the yaw/pitch math below expects them in the unrolled
      // frame viewSpace() itself works in (see project()).
      const cr = Math.cos(this.roll);
      const sr = Math.sin(this.roll);
      const rx = ddx * cr + ddy * sr;
      const ry = -ddx * sr + ddy * cr;
      ddx = rx;
      ddy = ry;
    }
    const cy = Math.cos(this.yaw);
    const sy = Math.sin(this.yaw);
    const cp = Math.cos(this.pitch);
    const sp = Math.sin(this.pitch);
    // World-space "right" and "up" directions for one unit of screen
    // "right"/"up": the inverse of project()'s yaw then pitch rotation.
    this.targetX -= ddx * cy + ddy * sy * sp;
    this.targetY -= -ddx * sy + ddy * cy * sp;
    this.targetZ -= ddy * cp;
    this.draw();
  }

  /**
   * Unit world-space "forward" (view) direction for a given yaw/pitch — the
   * world-space gradient of viewSpace()'s own `depth`, i.e. the inverse of
   * its yaw-then-pitch rotation applied to the unit vector "straight ahead".
   * Shared by dolly() and rotateInPlace(); roll never enters it, since it
   * only spins the rendered picture and doesn't change which way the camera
   * actually faces.
   */
  forwardVector(yaw, pitch) {
    const cy = Math.cos(yaw);
    const sy = Math.sin(yaw);
    const cp = Math.cos(pitch);
    const sp = Math.sin(pitch);
    return [sy * cp, cy * cp, -sp];
  }

  /**
   * Move `target` a world-space distance `step` along the view direction —
   * positive is forward (into the scene), negative is back — for the arrow
   * keys' dolly (see bindEvents): an actual move through the scene, unlike
   * the wheel's zoomK rescale.
   */
  dolly(step) {
    this.focusedNode = null;
    const [fx, fy, fz] = this.forwardVector(this.yaw, this.pitch);
    this.targetX += step * fx;
    this.targetY += step * fy;
    this.targetZ += step * fz;
    this.draw();
  }

  /**
   * Adjust yaw/pitch the way W/S/Q/E do (bindEvents) — around the camera's
   * own position instead of around `target` the way mouse-drag orbiting
   * does: the camera stays put and what's dead ahead of it changes, rather
   * than swinging around a fixed subject. The camera's position is never
   * stored on its own — it's always `target` minus `focal` world units
   * along the current view direction (the same relationship project() uses
   * the other way around, via `focalDepth`) — so this recovers it from the
   * OLD yaw/pitch, applies the change, then re-derives `target` as `focal`
   * units ahead of that same fixed point along the NEW view direction.
   */
  rotateInPlace(dYaw, dPitch) {
    this.focusedNode = null;
    const [fx0, fy0, fz0] = this.forwardVector(this.yaw, this.pitch);
    const camX = this.targetX - this.focal * fx0;
    const camY = this.targetY - this.focal * fy0;
    const camZ = this.targetZ - this.focal * fz0;
    this.yaw += dYaw;
    this.pitch += dPitch;
    const [fx1, fy1, fz1] = this.forwardVector(this.yaw, this.pitch);
    this.targetX = camX + this.focal * fx1;
    this.targetY = camY + this.focal * fy1;
    this.targetZ = camZ + this.focal * fz1;
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

  select(node) {
    this.selected = node;
    // A path highlight is only meaningful relative to the selection it was
    // asked for; changing that selection (including clearing it) leaves it
    // stale rather than wrong, so drop it here instead of drawing a path
    // whose own endpoint no longer matches what is selected.
    this.pathNodes = null;
    this.pathEdges = null;
    this.draw();
    this.callbacks.onSelect?.(node);
  }

  /** Highlight every node/edge on some path between two nodes (paths.js's pathBetween()); null clears it. */
  setPath(nodes, edges) {
    this.pathNodes = nodes;
    this.pathEdges = edges;
    this.draw();
  }

  /** `motifs` is a Map<kind, {nodes, edges, color}> (see app.js), or null to clear every motif overlay at once. */
  setMotifs(motifs) {
    this.motifs = motifs;
    this.draw();
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
  /** The rotation (yaw, then pitch, then roll) project() applies, before it decides how to turn depth into scale. */
  viewSpace(x, y, z) {
    const rx = x - this.targetX;
    const ry = y - this.targetY;
    const rz = z - this.targetZ;
    const cy = Math.cos(this.yaw);
    const sy = Math.sin(this.yaw);
    const X = rx * cy - ry * sy;
    const Y = rx * sy + ry * cy;
    const cp = Math.cos(this.pitch);
    const sp = Math.sin(this.pitch);
    const upX = Y * sp + rz * cp;
    const depth = Y * cp - rz * sp;
    // Roll doesn't change distance from the camera, only the on-screen
    // orientation, so it's a plain 2D rotation of the already-projected
    // X/screenUp pair around target's own screen position (always centre) —
    // equivalent to rolling the camera itself around its forward axis.
    if (this.roll === 0) return { X, screenUp: upX, depth };
    const cr = Math.cos(this.roll);
    const sr = Math.sin(this.roll);
    return { X: X * cr - upX * sr, screenUp: X * sr + upX * cr, depth };
  }

  project(x, y, z) {
    const { X, screenUp, depth } = this.viewSpace(x, y, z);
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
      const r = p.node.radius * p.scale + 3;
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
    // A path highlight (see setPath()) takes over what "active"/"dimmed"
    // mean from the plain selection while it's set: everything on the path
    // reads as active, everything else dims, regardless of adjacency to
    // `sel` — a node three hops from the selection but not on this path is
    // exactly as irrelevant here as one with no relation to it at all.
    const edgeActive = this.pathEdges ? (l) => this.pathEdges.has(l) : (l) => Boolean(sel) && (l.source === sel || l.target === sel);
    const nodeDimmed = this.pathNodes ? (n) => !this.pathNodes.has(n) : (n) => Boolean(sel) && n !== sel && !neighbours.has(n);

    // Project all nodes once per frame. Nodes too close to the camera to
    // project sanely (see MAX_MAGNIFICATION) are left out, the same way a
    // real camera simply doesn't show what's past its near plane.
    const projected = nodes.map((n) => ({ node: n, ...this.project(n.x, n.y, this.zOf(n)) })).filter((p) => !p.clipped);
    this.projected = projected;
    const byIndex = new Map(projected.map((p) => [p.node.index, p]));

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
      const active = edgeActive(l);
      const dimmed = Boolean(sel || this.pathEdges) && !active;
      ctx.strokeStyle = active ? "#111827" : edgeColor(l.kind);
      // Full opacity unless something is selected or a path is highlighted:
      // `active`/`dimmed` already partition every edge in either of those
      // states, so with neither active this used to fall through to a
      // default 0.55 — permanently muting every edge kind's colour well
      // below its legend swatch (nearly to invisibility for paler kinds
      // like `reference`), which is what made the graph look like it didn't
      // match the legend at all.
      ctx.globalAlpha = dimmed ? 0.08 : 1;
      ctx.lineWidth = active ? 2 : 1;
      ctx.setLineDash(l.inferred ? [3, 3] : l.kind === "type" || l.kind === "reference" ? [1, 3] : []);
      if (l.source === l.target) {
        const r = l.source.radius * s.scale;
        ctx.beginPath();
        ctx.arc(s.x + r, s.y - r, r, 0, Math.PI * 2);
        ctx.stroke();
      } else {
        // `reference` and `write` bow through edgeBowOffset (colors.js), so
        // the read and write halves of a compound assignment never draw on
        // top of each other.
        let control = null;
        const bow = edgeBowOffset(l.source, l.target, l.kind);
        if (bow) {
          const mx = (l.source.x + l.target.x) / 2 + bow.x;
          const my = (l.source.y + l.target.y) / 2 + bow.y;
          const mz = (this.zOf(l.source) + this.zOf(l.target)) / 2;
          const p = this.project(mx, my, mz);
          if (!p.clipped) control = p;
        }
        drawArrow(ctx, s.x, s.y, t.x, t.y, l.target.radius * t.scale + 1, 5 * Math.max(0.6, t.scale), control);
      }
    }
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;

    // Nodes, far ones first.
    const sorted = [...projected].sort((a, b) => b.depth - a.depth);
    ctx.font = "11px system-ui, sans-serif";
    for (const p of sorted) {
      const n = p.node;
      const r = n.radius * p.scale;
      const dimmed = nodeDimmed(n);
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
      const wanted = n === sel || n === this.hovered || neighbours.has(n) || this.pathNodes?.has(n) || (showAll && this.labelMode !== "none");
      if (!wanted) continue;
      const r = n.radius * p.scale;
      ctx.globalAlpha = nodeDimmed(n) && n !== this.hovered ? 0.3 : 1;
      ctx.fillText(n.name, p.x, p.y - r - 4);
    }
    ctx.globalAlpha = 1;
    ctx.textAlign = "start";

    // Motif overlay (see setMotifs()): drawn last, on top of everything
    // above, since it is a category to spot within the whole graph rather
    // than a relationship that dims the rest of it away.
    if (this.motifs) {
      for (const { edges, color } of this.motifs.values()) {
        ctx.strokeStyle = color;
        ctx.lineWidth = 3;
        ctx.globalAlpha = 0.6;
        for (const l of edges) {
          const s = byIndex.get(l.source.index);
          const t = byIndex.get(l.target.index);
          if (!s || !t) continue;
          ctx.beginPath();
          ctx.moveTo(s.x, s.y);
          ctx.lineTo(t.x, t.y);
          ctx.stroke();
        }
      }
      ctx.globalAlpha = 1;
      ctx.lineWidth = 2;
      for (const p of sorted) {
        let ring = 0;
        for (const { nodes: motifNodes, color } of this.motifs.values()) {
          if (!motifNodes.has(p.node)) continue;
          ctx.strokeStyle = color;
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.node.radius * p.scale + 3 + ring * 4, 0, Math.PI * 2);
          ctx.stroke();
          ring++;
        }
      }
    }
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
   * to exactly PI/2 — the view with the *most* height contribution, the
   * opposite end of the range from the level orientations discussed above.
   * Orbiting away from here (bindEvents) turns `orthographic` back off, and
   * so does fit() — the two ways out of Top view mirror the two ways in
   * (bindEvents' orbit, this method).
   */
  viewTop() {
    this.pitch = Math.PI / 2;
    this.orthographic = true;
    this.draw();
  }
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
