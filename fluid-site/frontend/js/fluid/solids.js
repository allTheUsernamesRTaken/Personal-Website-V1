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

function rebuildSolids() {
  if (!solid) return;
  solid.fill(0);
  if (!P.solids) return;

  const cw = window.innerWidth  / COLS;
  const ch = window.innerHeight / ROWS;

  for (let k = 0; k < solidEls.length; k++) {
    const el = solidEls[k];
    if (!el || !el.isConnected) continue;
    stampRect(el.getBoundingClientRect(), cw, ch);
  }
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
