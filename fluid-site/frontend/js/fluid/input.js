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

document.addEventListener('mousemove', e => {
  if (overPanel(e)) { prevCi = -1; prevCj = -1; return; }
  const { ci, cj } = getCell(e.clientX, e.clientY);
  applyMove(ci, cj);
});

document.addEventListener('mouseleave', () => { prevCi = -1; prevCj = -1; });

document.addEventListener('mousedown', e => {
  if (overPanel(e)) return;
  const { ci, cj } = getCell(e.clientX, e.clientY);
  burstAt(ci, cj);
});

function getTouchCell(e) {
  if (!e.touches || !e.touches.length) return null;
  const t = e.touches[0];
  return getCell(t.clientX, t.clientY);
}

document.addEventListener('touchstart', e => {
  if (overPanel(e)) return;
  const cell = getTouchCell(e);
  if (cell) { burstAt(cell.ci, cell.cj); prevCi = cell.ci; prevCj = cell.cj; }
}, { passive: true });

document.addEventListener('touchmove', e => {
  if (overPanel(e)) return;
  const cell = getTouchCell(e);
  if (cell) { applyMove(cell.ci, cell.cj); e.preventDefault(); }
}, { passive: false });

document.addEventListener('touchend',    () => { prevCi = -1; prevCj = -1; });
document.addEventListener('touchcancel', () => { prevCi = -1; prevCj = -1; });
