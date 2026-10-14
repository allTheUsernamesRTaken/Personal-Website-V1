/* input.js — mouse / touch into the velocity field. */

let prevCi = -1, prevCj = -1;

function getCell(cx, cy) {
  const r = canvas.getBoundingClientRect();
  return {
    ci: Math.floor((cx - r.left) * (COLS / r.width)),
    cj: Math.floor((cy - r.top)  * (ROWS / r.height))
  };
}

function overPanel(e) {
  return !!panelEl && (e.target === panelEl || panelEl.contains(e.target));
}

function applyMove(ci, cj) {
  if (prevCi < 0) { prevCi = ci; prevCj = cj; return; }
  const dvx = (ci - prevCi) * 2.8, dvy = (cj - prevCj) * 2.8;
  const spd = Math.sqrt(dvx * dvx + dvy * dvy);
  if (spd > 0.05) {
    const amt = P.injDens * 3 + spd * 1.2;
    emit(ci, cj, P.injRadius, amt, (dvx / spd) * P.injVel, (dvy / spd) * P.injVel);
  }
  prevCi = ci; prevCj = cj;
}

function burstAt(ci, cj) {
  for (let a = 0; a < 360; a += 6) {
    const r = a * Math.PI / 180;
    emit(ci, cj, P.injRadius, 8, Math.cos(r) * P.injVel, Math.sin(r) * P.injVel);
  }
}

/* Moving over the panel stirs the fluid behind it when the panel isn't a
   solid body. Clicks over it still don't — those are for the panel's own
   buttons. Touches get a sideways-only version further down. */
document.addEventListener('mousemove', e => {
  if (e.target.closest && e.target.closest('.subpanel')) { prevCi = -1; prevCj = -1; return; }
  if (P.solids && overPanel(e)) { prevCi = -1; prevCj = -1; return; }
  const { ci, cj } = getCell(e.clientX, e.clientY);
  noteUserInput();
  applyMove(ci, cj);
});

document.addEventListener('mouseleave', () => { prevCi = -1; prevCj = -1; });

/* Nothing here knows about life any more. Feeding used to hang off this same
   handler, which meant the click that dropped food also fired the burst that
   blew it away; food is released from the habitat panel now, and this drag is
   just a drag — which is what makes it usable for steering. */
document.addEventListener('mousedown', e => {
  if (overPanel(e) || (e.target.closest && e.target.closest('.subpanel'))) return;
  const { ci, cj } = getCell(e.clientX, e.clientY);
  noteUserInput();
  burstAt(ci, cj);
});

function getTouchCell(e) {
  if (!e.touches || !e.touches.length) return null;
  const t = e.touches[0];
  return getCell(t.clientX, t.clientY);
}

/* On a phone the panel is most of the screen, so leaving it out of the touch
   path left a strip along the bottom as the only thing you could stir. A
   touch on the panel now gets the same deal the mouse does — it stirs the
   flow behind — but only once it's clearly sideways. Vertical is the pane
   scrolling, and #panel's `touch-action: pan-y` (layout.css) is what stops
   the browser claiming a sideways drag before this sees it. Controls and the
   command line keep their touches either way. */
const STIR_LOCK_PX = 10;
let _panelTouch = null;     // { x, y, mode: 'pending' | 'stir' | 'scroll' }

function onControl(e) {
  return !!(e.target.closest && e.target.closest('a, button, input, .ascii-wrap, .subpanel'));
}

document.addEventListener('touchstart', e => {
  _panelTouch = null;
  if (overPanel(e)) {
    if (P.solids || onControl(e) || e.touches.length > 1) return;
    const t = e.touches[0];
    _panelTouch = { x: t.clientX, y: t.clientY, mode: 'pending' };
    prevCi = -1; prevCj = -1;
    return;
  }
  const cell = getTouchCell(e);
  if (cell) { noteUserInput(); burstAt(cell.ci, cell.cj); prevCi = cell.ci; prevCj = cell.cj; }
}, { passive: true });

document.addEventListener('touchmove', e => {
  if (_panelTouch) {
    const t = e.touches[0];
    if (_panelTouch.mode === 'pending') {
      const dx = Math.abs(t.clientX - _panelTouch.x), dy = Math.abs(t.clientY - _panelTouch.y);
      if (Math.max(dx, dy) < STIR_LOCK_PX) return;
      _panelTouch.mode = dx > dy ? 'stir' : 'scroll';
      if (_panelTouch.mode === 'stir') noteUserInput();
    }
    if (_panelTouch.mode !== 'stir') return;
    if (e.cancelable) e.preventDefault();
    const cell = getCell(t.clientX, t.clientY);
    applyMove(cell.ci, cell.cj);
    return;
  }
  if (overPanel(e)) return;
  const cell = getTouchCell(e);
  if (cell) { applyMove(cell.ci, cell.cj); e.preventDefault(); }
}, { passive: false });

function endTouch() { prevCi = -1; prevCj = -1; _panelTouch = null; }
document.addEventListener('touchend',    endTouch);
document.addEventListener('touchcancel', endTouch);
