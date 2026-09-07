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
// to the content's actual size lets ordinary flying bring a node's depth
// close enough to -focal that its perspective scale blows up, stretching it
// like a very wide-angle (near-fisheye) lens. Tying focal to extent keeps
// the lens "normal" regardless of how large the force layout happens to be.
const FOCAL_EXTENT_RATIO = 1.2;

// Points whose focal-relative depth would magnify them past this factor are
// clipped (not drawn) instead of being scaled up without bound: a real
// camera doesn't render what's essentially against the lens, it just falls
// out of frame.
const MAX_MAGNIFICATION = 4;

// Unit quaternions {x,y,z,w}, used only for `flightQuat` (see the
// constructor): composing pitch/yaw/roll as three independent angles in a
// fixed order can't represent "roll, then pitch relative to the now-rolled
// frame" — a coordinated turn, the way a real aircraft banks into one —
// since each angle would keep rotating around the ORIGINAL, unrolled axis
// regardless of the others. A quaternion accumulated via local-axis
// composition (see Graph3D#roll()/rotateInPlace()) has no such fixed axes
// to begin with.
function quatMultiply(a, b) {
  return {
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
  };
}
function quatFromAxisAngle([ax, ay, az], angle) {
  const s = Math.sin(angle / 2);
  return { x: ax * s, y: ay * s, z: az * s, w: Math.cos(angle / 2) };
}
/** Rotate a plain [x,y,z] vector by a unit quaternion (v' = q v q*, expanded to avoid building a quaternion for v). */
function quatRotateVector(q, [vx, vy, vz]) {
  const tx = 2 * (q.y * vz - q.z * vy);
  const ty = 2 * (q.z * vx - q.x * vz);
  const tz = 2 * (q.x * vy - q.y * vx);
  return [vx + q.w * tx + (q.y * tz - q.z * ty), vy + q.w * ty + (q.z * tx - q.x * tz), vz + q.w * tz + (q.x * ty - q.y * tx)];
}

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
    this.layerGap = 80;
    this.showLayers = false;
    // Whether a layer plane's fill/stroke fades out away from the camera's
    // own focus (see draw()) rather than a single flat colour everywhere —
    // needed once a plane always draws in full (projectClamped()) instead of
    // disappearing the moment any one corner would have clipped.
    this.layerFade = true;
    this.autoRotate = false;

    // yaw/pitch are only ever the camera's RESTING pose, set once by fit()'s
    // default framing or a preset like viewTop() — never touched by an
    // interactive look or turn, mouse or keyboard alike (see bindEvents and
    // rotateInPlace()). Every rotation the person driving the camera actually
    // does accumulates onto `flightQuat` instead (below), composed on top of
    // this base by viewSpace().
    this.yaw = -0.6;
    this.pitch = 0.9;
    // Every interactive rotation — mouse-look (bindEvents' pointermove) and
    // the keyboard's W/S/Q/E/A/D alike — accumulates here, via local-axis
    // quaternion multiplication (see quatMultiply()'s own comment) instead
    // of updating yaw/pitch/a third roll angle directly: pitching after a
    // roll needs to turn around the now-rolled right axis, not the original
    // unrolled one, the way a banked aircraft's nose actually swings when
    // its pilot pulls back — a coordinated turn, not just a tilted-looking
    // pan — and three independent, fixed-axis angles can't express that
    // regardless of update order. Identity (no rotation yet) until the
    // camera is first looked/turned; no clamp and no auto-level back to
    // level, since flying upside down is the point of a coordinated turn,
    // not an accident to recover from — "Fit to view"/"Top view" reset it
    // back to identity for whoever wants a clean way out instead.
    this.flightQuat = { x: 0, y: 0, z: 0, w: 1 };
    // True while showing the "Top view" preset: a perspective-free look
    // straight down the height axis (see viewTop()), which is what a purely
    // 2D top-down rendering of this same x/y layout would look like — the
    // graph's own physics never uses height, so seen from directly above and
    // without perspective it is exactly the layout a 2D-only renderer would
    // draw. Looking around away from it (see bindEvents) turns it back off,
    // since it is a specific camera pose, not a general drawing mode.
    this.orthographic = false;
    this.zoomK = 1;
    // The world point `focal` world units directly ahead of the camera, and
    // which therefore always projects to screen centre (see project()) — set
    // from the graph's own bounding box in fit(), or a node's position in
    // focusOn(), since nothing about the physics guarantees the layout sits
    // near world origin (see docs/DESIGN.md, "Nothing defines a centre").
    // Looking around (bindEvents' pointermove, or the keyboard) keeps this
    // invariant by re-deriving `target` from the camera's own (implicit,
    // unmoved) position every time — see rotateInPlace() — rather than by
    // rotating the world around a fixed `target` the way an orbit camera
    // would; a shift-drag pan or a dolly/strafe moves it in world space
    // instead, on purpose, since those really do mean to look at (or from)
    // somewhere else.
    this.targetX = 0;
    this.targetY = 0;
    this.targetZ = 0;
    // Node target is following, if any (see focusOn()). Node positions keep
    // changing under the physics — settling, or reheated by dragging another
    // node or changing physics params — so a one-off snapshot into target
    // goes stale almost immediately; draw() re-reads this node's live
    // position into target every frame instead, so it stays centred on
    // where the node actually is right now regardless of how the camera
    // looks around it.
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
        // screen — enough range for an ordinary look drag. A single drag
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
          // FPS-style mouse-look: rotateInPlace() (also W/S/Q/E's own method,
          // see its doc) turns the camera in place from wherever it already
          // is, rather than orbiting some subject around a screen-centred
          // pivot — the same reasoning that put the keyboard's rotations on
          // it applies here too, and a drag needs no easing of its own the
          // way a held key does, since the pointer's own movement already
          // is the rate.
          this.rotateInPlace(dx * 0.008, dy * 0.006);
          // A look is a deliberate move away from the flat top-down pose.
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
    // The wheel dollies (an actual move through the scene, see dolly())
    // instead of rescaling zoomK: a rescale and a real forward move look
    // enough alike that which one had just happened was never obvious, and
    // the arrow keys already dolly, so this is that same one mechanism
    // rather than a second, confusable way to get closer. zoomK itself is
    // unaffected — fit()/focusOn() still use it for framing, only its own
    // interactive control is gone.
    c.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        this.dolly(-e.deltaY * this.focal * 0.0008);
      },
      { passive: false },
    );

    // Keyboard camera controls, held down like a game camera: W/S pitch the
    // camera up/down, A/D roll it, Q/E yaw it left/right, and the arrows
    // dolly forward/back or strafe left/right the same way the wheel dollies
    // (see dolly()/strafe()), just eased rather than driven pixel-for-pixel.
    // Every axis eases toward whichever direction (or neither) is currently
    // held instead of snapping to full speed the instant a key goes down or
    // stopping dead the instant it comes up, so a tap reads as a nudge and a
    // held key reads as accelerating into a cruise and coasting back down on
    // release. Listens on window rather than the canvas since the canvas
    // never takes keyboard focus, and is skipped while a text field (e.g.
    // the GitHub repo box) is focused so typing doesn't fly the camera
    // around.
    const MAX_ROTATE_RATE = 0.03; // radians per animation frame at full speed
    const MAX_MOVE_RATE = 0.02; // fraction of the focal length per animation frame at full speed, dolly and strafe alike
    const EASE = 0.15; // fraction of the gap to the target rate closed per frame, speeding up or coasting down alike
    // Which eased rate each key drives, and which direction (+1/-1) holding
    // it asks that rate to approach; releasing every key on an axis asks its
    // rate to approach 0 instead (see keyStep()'s `target`).
    const KEY_AXIS = { w: ["pitch", 1], s: ["pitch", -1], q: ["yaw", -1], e: ["yaw", 1], a: ["roll", -1], d: ["roll", 1], arrowup: ["dolly", 1], arrowdown: ["dolly", -1], arrowright: ["strafe", 1], arrowleft: ["strafe", -1] };
    const rate = { pitch: 0, yaw: 0, roll: 0, dolly: 0, strafe: 0 };
    const heldKeys = new Set();
    let keyRAF = null;
    const isTyping = () => {
      const el = document.activeElement;
      return Boolean(el) && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable);
    };
    const keyStep = () => {
      const target = { pitch: 0, yaw: 0, roll: 0, dolly: 0, strafe: 0 };
      for (const k of heldKeys) {
        const axis = KEY_AXIS[k];
        if (axis) target[axis[0]] = axis[1];
      }
      for (const axis of Object.keys(rate)) {
        rate[axis] += (target[axis] - rate[axis]) * EASE;
        if (Math.abs(rate[axis]) < 0.0005) rate[axis] = 0; // snap to exactly 0 so the loop can actually stop
      }
      if (rate.pitch || rate.yaw) {
        // Camera-centred, not target-centred: see rotateInPlace()'s own doc.
        this.rotateInPlace(rate.yaw * MAX_ROTATE_RATE, rate.pitch * MAX_ROTATE_RATE);
        // A rotation is a deliberate move away from the flat top-down pose,
        // same as a mouse-look drag; a dolly/strafe (arrow keys) leaves it
        // alone, same as a shift-drag pan does.
        this.orthographic = false;
      }
      if (rate.roll) {
        this.roll(rate.roll * MAX_ROTATE_RATE);
        this.orthographic = false;
      }
      if (rate.dolly) this.dolly(rate.dolly * this.focal * MAX_MOVE_RATE);
      if (rate.strafe) this.strafe(rate.strafe * this.focal * MAX_MOVE_RATE);
      const settled = heldKeys.size === 0 && Object.values(rate).every((r) => r === 0);
      if (settled) {
        keyRAF = null;
        return;
      }
      this.draw();
      keyRAF = requestAnimationFrame(keyStep);
    };
    window.addEventListener("keydown", (e) => {
      const k = e.key.toLowerCase();
      if (!(k in KEY_AXIS) || isTyping()) return;
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
   * a separate screen-space offset, so a look still stays camera-centred
   * (see the constructor) even after panning, and stop following a focused
   * node so the pan sticks instead of being overridden on the next frame.
   */
  panScreen(dx, dy) {
    this.focusedNode = null;
    const scale = this.zoomK; // scale at the target's own depth (project(): depth 0)
    const ddx = dx / scale;
    const ddy = -dy / scale; // +1 = one world unit of screen "up"
    // World-space "right" and "up" for one unit of screen "right"/"up": the
    // inverse of viewSpace()'s full rotation (yaw, pitch, and flightQuat —
    // see localToWorld()), so this still points the right way regardless of
    // whatever the keyboard has rolled the camera to in the meantime.
    const [rx, ry, rz] = this.localToWorld([1, 0, 0]);
    const [ux, uy, uz] = this.localToWorld([0, 1, 0]);
    this.targetX -= ddx * rx + ddy * ux;
    this.targetY -= ddx * ry + ddy * uy;
    this.targetZ -= ddx * rz + ddy * uz;
    this.draw();
  }

  /**
   * Map a LOCAL camera-space direction — [1,0,0] right, [0,1,0] up, [0,0,1]
   * forward, before either the resting yaw/pitch (see the constructor) or
   * `flightQuat` — shared by mouse-look and the keyboard alike — are layered
   * on — into world space: the exact inverse of
   * `viewSpace()`'s own rotation, generalized from a single hardcoded
   * "forward" to any local direction, since `rotateInPlace()`/`dolly()`/
   * `strafe()`/`panScreen()` all need the camera's actual current
   * right/up/forward, not just forward.
   */
  localToWorld(local) {
    const [fx, fy, fz] = quatRotateVector(this.flightQuat, local);
    const cy = Math.cos(this.yaw);
    const sy = Math.sin(this.yaw);
    const cp = Math.cos(this.pitch);
    const sp = Math.sin(this.pitch);
    const Y = fy * sp + fz * cp;
    const rz = fy * cp - fz * sp;
    const rx = fx * cy + Y * sy;
    const ry = -fx * sy + Y * cy;
    return [rx, ry, rz];
  }

  /**
   * Move `target` a world-space distance `step` along the view direction —
   * positive is forward (into the scene), negative is back — shared by the
   * wheel and the arrow keys (see bindEvents): an actual move through the
   * scene, rather than a zoomK rescale.
   */
  dolly(step) {
    this.focusedNode = null;
    const [fx, fy, fz] = this.localToWorld([0, 0, 1]);
    this.targetX += step * fx;
    this.targetY += step * fy;
    this.targetZ += step * fz;
    this.draw();
  }

  /** Move `target` a world-space distance `step` sideways — positive is the camera's own right — for the left/right arrows' strafe (bindEvents). */
  strafe(step) {
    this.focusedNode = null;
    const [rx, ry, rz] = this.localToWorld([1, 0, 0]);
    this.targetX += step * rx;
    this.targetY += step * ry;
    this.targetZ += step * rz;
    this.draw();
  }

  /**
   * Roll by `angle` around the camera's own forward axis — A/D (bindEvents).
   * A pure rotation around forward leaves forward itself unchanged, so
   * unlike pitch/yaw this never has to move `target` to keep the camera's
   * position fixed.
   */
  roll(angle) {
    this.flightQuat = quatMultiply(this.flightQuat, quatFromAxisAngle([0, 0, 1], angle));
  }

  /**
   * Turn in place around the camera's own position — shared by mouse-look
   * (bindEvents' pointermove) and the keyboard's W/S/Q/E alike: the camera
   * stays put and what's dead ahead of it changes, rather than swinging some
   * subject around a fixed pivot the way an arcball/orbit camera would. The
   * camera's position is never stored on its own — it's always `target` minus
   * `focal` world units
   * along the current view direction (the same relationship project() uses
   * the other way around, via `focalDepth`) — so this recovers it from the
   * OLD orientation, applies the change, then re-derives `target` as
   * `focal` units ahead of that same fixed point along the NEW view
   * direction. The change itself is local-axis rotation of `flightQuat`
   * (canonical right for pitch, canonical up for yaw, composed the same way
   * roll() composes around canonical forward) rather than adding to `pitch`
   * directly, so that pitching after a roll turns around the now-rolled
   * right axis — a coordinated turn — instead of the original, unrolled one
   * a fixed-order Euler update would keep using regardless of roll.
   */
  rotateInPlace(dYaw, dPitch) {
    this.focusedNode = null;
    const [fx0, fy0, fz0] = this.localToWorld([0, 0, 1]);
    const camX = this.targetX - this.focal * fx0;
    const camY = this.targetY - this.focal * fy0;
    const camZ = this.targetZ - this.focal * fz0;
    this.flightQuat = quatMultiply(this.flightQuat, quatFromAxisAngle([1, 0, 0], dPitch));
    this.flightQuat = quatMultiply(this.flightQuat, quatFromAxisAngle([0, 1, 0], dYaw));
    const [fx1, fy1, fz1] = this.localToWorld([0, 0, 1]);
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

  setLayerFade(fade) {
    this.layerFade = fade;
    this.draw();
  }

  setShowLayers(show) {
    this.showLayers = show;
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
   * The rotation is centred on `target`, not the origin: yaw spins the
   * offset from target around the vertical axis, pitch is its elevation.
   * After the yaw rotation X points right and Y away from the camera;
   * tilting by pitch turns "away" into "up on screen" and brings higher
   * points closer to a camera that looks down. That's just the geometry of
   * the projection, though — nothing interacts by swinging around `target`
   * any more (see rotateInPlace()); `target` is instead kept `focal` units
   * directly ahead of wherever the camera actually is, and the two together
   * are what keep target always projecting to screen centre (X = Y = 0)
   * regardless of yaw/pitch.
   */
  /** The rotation (resting yaw/pitch, then `flightQuat` — driven by mouse-look and the keyboard alike, see the constructor) project() and projectClamped() share, before either decides how to turn depth into scale. */
  viewSpace(x, y, z) {
    const rx = x - this.targetX;
    const ry = y - this.targetY;
    const rz = z - this.targetZ;
    const cy = Math.cos(this.yaw);
    const sy = Math.sin(this.yaw);
    const X0 = rx * cy - ry * sy;
    const Y0 = rx * sy + ry * cy;
    const cp = Math.cos(this.pitch);
    const sp = Math.sin(this.pitch);
    const upX0 = Y0 * sp + rz * cp;
    const depth0 = Y0 * cp - rz * sp;
    // flightQuat (identity until the camera is first looked or turned) is a
    // further rotation on top of the yaw/pitch rotation above, applied here as a
    // rotation of the already-computed (X0, upX0, depth0) rather than
    // rotating (rx, ry, rz) directly: a pure roll leaves depth0 alone the
    // same way the old roll-only code did (rotation around the forward axis
    // doesn't touch the forward component), and a pitch/yaw rotation
    // composes correctly with whatever roll came before it, which three
    // independent angles in a fixed order could not (see quatMultiply()'s
    // own comment) — the reason this exists at all.
    const [X, screenUp, depth] = quatRotateVector(this.flightQuat, [X0, upX0, depth0]);
    return { X, screenUp, depth };
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

  /**
   * Like project(), but a point past the near plane is drawn at the
   * boundary's own scale instead of being left out — appropriate for a large
   * background shape (a layer plane's corner) where "very stretched" still
   * reads fine, unlike a node or an edge, which really should just fall out
   * of frame (see project() and MAX_MAGNIFICATION). Never returns `clipped`.
   */
  projectClamped(x, y, z) {
    const { X, screenUp, depth } = this.viewSpace(x, y, z);
    if (this.orthographic) {
      const scale = this.zoomK;
      return { x: this.width / 2 + X * scale, y: this.height / 2 - screenUp * scale, scale, depth };
    }
    const focalDepth = Math.max(this.focal + depth, this.focal / MAX_MAGNIFICATION);
    const scale = (this.focal / focalDepth) * this.zoomK;
    return { x: this.width / 2 + X * scale, y: this.height / 2 - screenUp * scale, scale, depth };
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
        // projectClamped(), not project(): a plane corner past the near
        // plane is still drawn, at the boundary's own scale, rather than
        // making the whole plane disappear just because one corner would
        // have been clipped as a node or edge would be (see MAX_MAGNIFICATION).
        const corners = [
          this.projectClamped(x0, y0, z),
          this.projectClamped(x1, y0, z),
          this.projectClamped(x1, y1, z),
          this.projectClamped(x0, y1, z),
        ];
        ctx.beginPath();
        ctx.moveTo(corners[0].x, corners[0].y);
        for (let i = 1; i < 4; i++) ctx.lineTo(corners[i].x, corners[i].y);
        ctx.closePath();
        if (this.layerFade) {
          // Always drawing the full plane (above) means it can now cover
          // most of the screen at a steep angle or close up — a flat fill
          // over that much area reads as a wash of solid colour instead of
          // a frame. Fading outward from the camera's own focus (`target`,
          // projected onto this same height) keeps what the camera is
          // actually looking at crisp while the rest recedes, the way
          // distance fog does, instead of every pixel competing at the same
          // strength regardless of how far off-focus it is.
          const focus = this.projectClamped(this.targetX, this.targetY, z);
          const radius = Math.max(1, ...corners.map((c) => Math.hypot(c.x - focus.x, c.y - focus.y)));
          ctx.fillStyle = fadeGradient(ctx, focus, radius, 100, 116, 139, 0.06);
          ctx.strokeStyle = fadeGradient(ctx, focus, radius, 100, 116, 139, 0.35);
        } else {
          ctx.fillStyle = "rgba(100, 116, 139, 0.04)";
          ctx.strokeStyle = "rgba(100, 116, 139, 0.25)";
        }
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
    // perspective view too, the same as looking away from Top view does —
    // including undoing whatever mouse-look or the keyboard's flight
    // controls rolled or looped the camera to, since that has no auto-level
    // of its own to fall back on (see the constructor).
    this.orthographic = false;
    this.flightQuat = { x: 0, y: 0, z: 0, w: 1 };
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
    // sit anywhere in world space. Point `target` at the
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
   * little if it's currently zoomed out, then re-point `target` at
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
   * Looking around away from here (bindEvents) turns `orthographic` back
   * off, and so does fit() — the two ways out of Top view mirror the two
   * ways in (bindEvents' mouse-look/keyboard, this method).
   */
  viewTop() {
    this.pitch = Math.PI / 2;
    this.flightQuat = { x: 0, y: 0, z: 0, w: 1 };
    this.orthographic = true;
    this.draw();
  }
}

/** A radial gradient of `rgba(r,g,b,maxAlpha)` at `center` fading to fully transparent at `radius`. */
function fadeGradient(ctx, center, radius, r, g, b, maxAlpha) {
  const gradient = ctx.createRadialGradient(center.x, center.y, 0, center.x, center.y, radius);
  gradient.addColorStop(0, `rgba(${r}, ${g}, ${b}, ${maxAlpha})`);
  gradient.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0)`);
  return gradient;
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
