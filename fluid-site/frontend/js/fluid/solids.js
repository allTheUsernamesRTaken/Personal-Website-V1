/* solids.js — turns the DOM panel into an obstacle in the flow.

   constants.js has always had a `solid` array that nothing read. This is
   what reads it: the panel's bounding box is stamped into the grid, the
   solver treats those cells as a no-flux boundary, and the current has to
   go around. Bluff body in a uniform stream — the wake off the trailing
   edge is a von Karman street, not an animation. */

const panelEl = document.getElementById('panel');

function rebuildSolids() {
  if (!solid) return;
  solid.fill(0);
  if (!P.solids || !panelEl) return;

  const r  = panelEl.getBoundingClientRect();
  const cw = window.innerWidth  / COLS;
  const ch = window.innerHeight / ROWS;

  // Inset by a cell so the boundary layer has somewhere to live.
  const i0 = Math.max(1, Math.floor(r.left / cw) + 1);
  const i1 = Math.min(COLS - 2, Math.ceil(r.right / cw) - 1);
  const j0 = Math.max(1, Math.floor(r.top / ch) + 1);
  const j1 = Math.min(ROWS - 2, Math.ceil(r.bottom / ch) - 1);

  for (let j = j0; j <= j1; j++) {
    for (let i = i0; i <= i1; i++) solid[j * COLS + i] = 1;
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
