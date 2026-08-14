/* solids.js — turns the DOM panel into an obstacle in the flow.

   constants.js has always had a `solid` array that nothing read. This is
   what reads it: the panel's bounding box is stamped into the grid, the
   solver treats those cells as a no-flux boundary, and the current has to
   go around. Bluff body in a uniform stream — the wake off the trailing
   edge is a von Karman street, not an animation. */

const panelEl = document.getElementById('panel');

/* Every panel on the page is an obstacle, not just the main one. Subpanels
   register on open and unregister on close, so opening one puts a new bluff
   body in the stream and closing one lets its wake collapse. panels.js
   restamps on every drag frame, which is the whole point of the thing:
   dragging a panel is dragging an obstacle through the flow. */
const solidEls = [panelEl];

function registerSolid(el) {
  if (el && solidEls.indexOf(el) < 0) solidEls.push(el);
}

function unregisterSolid(el) {
  const i = solidEls.indexOf(el);
  if (i >= 0) solidEls.splice(i, 1);
}

function stampRect(r, cw, ch) {
  // Inset by a cell so the boundary layer has somewhere to live.
  const i0 = Math.max(1, Math.floor(r.left / cw) + 1);
  const i1 = Math.min(COLS - 2, Math.ceil(r.right / cw) - 1);
  const j0 = Math.max(1, Math.floor(r.top / ch) + 1);
  const j1 = Math.min(ROWS - 2, Math.ceil(r.bottom / ch) - 1);
  if (i1 < i0 || j1 < j0) return;              // smaller than its own boundary layer

  for (let j = j0; j <= j1; j++) {
    for (let i = i0; i <= i1; i++) solid[j * COLS + i] = 1;
  }
}

/* ── moving bodies ────────────────────────────────────────────────────
   The solver only ever knew about stationary obstacles. Solid cells are
   dropped from the stencil, which is a no-flux wall, and enforceSolids()
   zeroes velocity and density inside them. That's right for a panel that
   sits still and wrong for one you drag: the wall never pushes, and any
   smoke a cell was holding when it became solid is destroyed. So a moving
   panel cut a hole through the field instead of shoving it aside — an
   eraser, not a body.

   Two things fix that, and neither needs the pressure solve rewritten:

   - Mass moves instead of vanishing. Cells that just became solid hand
     their density to the nearest free cell, preferring the direction of
     travel, so smoke piles up ahead of the leading face.

   - The wall reports that it's moving. Free cells against a leading face
     get the body's velocity added, which is the moving-boundary condition
     in the only place it's visible. Projection turns that into a bow wave,
     and the cavity behind fills from the sides on its own.

   PUSH_R caps how far mass will search for somewhere to go. It's what makes
   a window opening on top of smoke shove it out around the edges rather
   than teleport the whole footprint to the perimeter. */
const PUSH_R = 5;

let solidPrev = null;
const lastRect = new WeakMap();

function cellIdx(i, j) {
  if (i < 1 || i > COLS - 2 || j < 1 || j > ROWS - 2) return -1;
  return j * COLS + i;
}

/* Nearest free cell, searching outward. The direction of travel is tried
   first at each radius, so a dragged body pushes its smoke forward rather
   than sideways; with no travel the ring search finds whatever is closest,
   which for a newly opened window is straight out through the nearest edge. */
function freeCellNear(i, j, dirx, diry) {
  for (let r = 1; r <= PUSH_R; r++) {
    if (dirx || diry) {
      const t = cellIdx(i + Math.round(dirx * r), j + Math.round(diry * r));
      if (t >= 0 && !solid[t]) return t;
    }
    for (let a = 0; a < 8; a++) {
      const ang = a * 0.7853981634;              // 45°
      const t = cellIdx(i + Math.round(Math.cos(ang) * r),
                        j + Math.round(Math.sin(ang) * r));
      if (t >= 0 && !solid[t]) return t;
    }
  }
  return -1;                                     // walled in; this mass is lost
}

function displaceCovered(mvx, mvy) {
  const sp = Math.sqrt(mvx * mvx + mvy * mvy);
  const dirx = sp > 1e-4 ? mvx / sp : 0;
  const diry = sp > 1e-4 ? mvy / sp : 0;
  // Same scale the mouse uses in input.js, so a dragged panel and a dragged
  // cursor shove with comparable force.
  const shove = Math.min(sp * 2.2, 1) * P.injVel;

  for (let j = 1; j < ROWS - 1; j++) {
    for (let i = 1; i < COLS - 1; i++) {
      const k = j * COLS + i;
      if (!solid[k] || solidPrev[k]) continue;   // only cells that just got covered
      const d = dens[k];
      if (d <= 1e-4) continue;

      const t = freeCellNear(i, j, dirx, diry);
      if (t < 0) continue;
      dens[t] += d;
      dens[k] = 0;

      // Shove along the displacement itself, so it's outward either way.
      const odx = (t % COLS) - i, ody = ((t / COLS) | 0) - j;
      const olen = Math.sqrt(odx * odx + ody * ody) || 1;
      const mag = sp > 1e-3 ? shove * 0.5 : P.injVel * 0.22;
      vx[t] += (odx / olen) * mag;
      vy[t] += (ody / olen) * mag;
    }
  }

  if (sp <= 1e-3) return;

  /* Leading faces. Gated per axis so diagonal travel pushes on both. */
  const si = dirx > 0.35 ? 1 : dirx < -0.35 ? -1 : 0;
  const sj = diry > 0.35 ? 1 : diry < -0.35 ? -1 : 0;
  if (!si && !sj) return;

  for (let j = 1; j < ROWS - 1; j++) {
    for (let i = 1; i < COLS - 1; i++) {
      if (!solid[j * COLS + i]) continue;
      if (si) {
        const t = cellIdx(i + si, j);
        if (t >= 0 && !solid[t]) { vx[t] += dirx * shove * 0.35; vy[t] += diry * shove * 0.35; }
      }
      if (sj) {
        const t = cellIdx(i, j + sj);
        if (t >= 0 && !solid[t]) { vx[t] += dirx * shove * 0.35; vy[t] += diry * shove * 0.35; }
      }
    }
  }
}

function rebuildSolids() {
  if (!solid) return;

  /* A realloc means the previous mask describes a different grid, so there's
     nothing meaningful to diff against and displacement sits this one out. */
  const resized = !solidPrev || solidPrev.length !== N;
  if (resized) solidPrev = new Uint8Array(N);
  else solidPrev.set(solid);

  solid.fill(0);

  const cw = window.innerWidth  / COLS;
  const ch = window.innerHeight / ROWS;
  let mvx = 0, mvy = 0;

  for (let k = 0; k < solidEls.length; k++) {
    const el = solidEls[k];
    if (!el || !el.isConnected) continue;
    const r = el.getBoundingClientRect();

    const prev = lastRect.get(el);
    if (prev) { mvx += (r.left - prev.left) / cw; mvy += (r.top - prev.top) / ch; }
    lastRect.set(el, { left: r.left, top: r.top });

    if (P.solids) stampRect(r, cw, ch);
  }

  if (!resized && P.solids && P.displace) displaceCovered(mvx, mvy);
}

/* Grid is sized off the viewport, so a resize means a full realloc.
   Debounced — dragging a window edge fires this constantly. */
let _resizeTimer = 0;
function onViewportChange() {
  clearTimeout(_resizeTimer);
  _resizeTimer = setTimeout(() => {
    allocGrid();
    buildPalette(P.palette);
    rebuildSolids();
  }, 140);
}

window.addEventListener('resize', onViewportChange);
window.addEventListener('orientationchange', onViewportChange);

/* The panel changes height when you switch tabs, so track it directly. */
if (panelEl && window.ResizeObserver) {
  new ResizeObserver(() => rebuildSolids()).observe(panelEl);
}
