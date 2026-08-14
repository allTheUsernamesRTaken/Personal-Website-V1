/* ticks.js — night's corner ticks read the field they sit in.

   The ticks were the one mark on the page that didn't know the solver was
   running: fixed hue, fixed opacity, four identical corners. Everything else
   here is driven by the sim — the HUD reads it, steel lights from it, rime
   accretes out of it — so an inert mark reads as an overlay sitting on the
   page rather than as part of it.

   This samples the field just outside each of the four corners and reports it
   on that corner's two arms, as colour and as stroke weight.

   Arm length stays structural — it encodes which edge is busy, which doesn't
   change — so it lives in layout.css. Only colour and weight are dynamic. That
   split is deliberate: length carries the fixed argument about the flow field,
   brightness and weight carry what's happening right now.

   Two things that matter more than they look:

   - Dim at rest, and only the top of the range is bright. Ambient smoke is
     everywhere, so a tick that tints up from zero never rests and the
     brightening stops carrying information.

   - Rises fast, falls slowly. Tracking the smoke symmetrically means the tick
     follows every wisp, which reads as flicker; the slow release reads as a
     needle settling, and leaves the corner lit for about a second after a
     gust has passed. */

const TICK_FPS   = 15;                  // no geometry rebuild, so this is plenty
const TICK_FLOOR = 0.16;                // energy below this is ambient, not an event

/* Order matches tkLit and the sample list in tickFrame. */
const TICK_CORNERS = ['tl', 'tr', 'br', 'bl'];

/* Stroke weight, resting to full, px. Everything rests at a hairline — the
   weight is purely an event channel. A doubling is very legible on a 1px line
   and still never accumulates enough area to read as a filled UI element,
   which is what a 3px arm did: it stopped being a tick and became chrome. */
const TICK_W0 = 1.0, TICK_W1 = 2.0;

let tkGeom = null;                      // { i0, j0, i1, j1 } — panel in sim cells
let tkLit  = [0, 0, 0, 0];
let tkSent = [-1, -1, -1, -1];          // last step written, so we can skip writes
let _tkLast = 0;

/* Step diagonally outward from the corner cell, so the block clears the panel
   on both axes. Sampling inward would read as permanently dead: the panel is a
   solid body and enforceSolids() zeroes everything inside it. */
function tickSample(ci, cj, sx, sy) {
  let d = 0, a = 0, b = 0, n = 0;
  for (let p = 1; p <= 3; p++) {
    for (let q = 1; q <= 3; q++) {
      const i = Math.max(1, Math.min(COLS - 2, ci + sx * p));
      const j = Math.max(1, Math.min(ROWS - 2, cj + sy * q));
      const id = ix(i, j);
      if (solid[id]) continue;
      d += dens[id]; a += vx[id]; b += vy[id]; n++;
    }
  }
  if (!n) return 0;

  d /= n; a /= n; b /= n;
  const raw = d * 2.0 + Math.sqrt(a * a + b * b) * 1.6;
  const e = raw / (1 + raw);            // same shape steel uses, so they agree
  return Math.max(0, Math.min(1, (e - TICK_FLOOR) / (1 - TICK_FLOOR)));
}

/* Amber lit to pale amber. Brightness and alpha only, never hue: the
   background is a full 360° wheel at high saturation, so a tick that shifted
   hue would be competing on the one axis it cannot win, and would stop reading
   as the same mark from one second to the next. */
function tickColour(f) {
  const g = Math.round(171 + 51 * f);
  const b = Math.round(77 + 99 * f);
  /* The floor is well clear of invisible: the field is empty by default
     (P.wind is 0), so resting is the state most visitors see the most of. */
  return 'rgba(255,' + g + ',' + b + ',' + (0.42 + 0.58 * f).toFixed(3) + ')';
}

function tickFrame(now) {
  if (!tkGeom || REDUCED) return;
  if (now - _tkLast < 1000 / TICK_FPS) return;
  _tkLast = now;

  const g = tkGeom;
  const raw = [
    tickSample(g.i0, g.j0, -1, -1),     // stagnation corner
    tickSample(g.i1, g.j0,  1, -1),     // where the wake sheds
    tickSample(g.i1, g.j1,  1,  1),     // downstream, weak
    tickSample(g.i0, g.j1, -1,  1)      // dead water
  ];

  for (let k = 0; k < TICK_CORNERS.length; k++) {
    tkLit[k] += (raw[k] - tkLit[k]) * (raw[k] > tkLit[k] ? 0.30 : 0.055);

    /* Quantised, and written only when the step actually moves. A custom
       property on #panel invalidates style for everything inheriting it, and
       #panel is the whole document — so at rest, when the field has decayed
       and the step has stopped moving, this writes nothing at all. */
    const q = Math.round(tkLit[k] * 24);
    if (q === tkSent[k]) continue;
    tkSent[k] = q;

    const f = q / 24;
    const c = TICK_CORNERS[k];
    panelEl.style.setProperty('--tk-' + c, tickColour(f));
    panelEl.style.setProperty('--tw-' + c,
      (TICK_W0 + (TICK_W1 - TICK_W0) * f).toFixed(2) + 'px');
  }
}

function tickSync() {
  if (!panelEl || !COLS) return;
  const st = panelEl.style;

  /* Every other skin replaces #panel::before outright (cut, block) or removes
     it (steel, rime), so there is nothing to drive — and the vars have to go
     back or they'd sit on the element as dead inline styles. */
  if (typeof currentSkin !== 'undefined' && currentSkin !== 'night') {
    tkGeom = null;
    TICK_CORNERS.forEach(c => {
      st.removeProperty('--tk-' + c);
      st.removeProperty('--tw-' + c);
    });
    st.removeProperty('--cell-w');
    st.removeProperty('--cell-h');
    return;
  }

  /* Arm lengths are whole cells of the on-screen lattice. That pitch is
     innerWidth/COLS, not CW — the sim's backing store is COLS*CW stretched to
     100vw — so this agrees with solids.js and charFrame.js. */
  const cw = window.innerWidth / COLS;
  const ch = window.innerHeight / ROWS;
  st.setProperty('--cell-w', cw.toFixed(3) + 'px');
  st.setProperty('--cell-h', ch.toFixed(3) + 'px');

  const r = panelEl.getBoundingClientRect();
  tkGeom = {
    i0: Math.max(1, Math.round(r.left   / cw)),
    j0: Math.max(1, Math.round(r.top    / ch)),
    i1: Math.min(COLS - 2, Math.round(r.right  / cw)),
    j1: Math.min(ROWS - 2, Math.round(r.bottom / ch))
  };

  tkLit  = [0, 0, 0, 0];
  tkSent = [-1, -1, -1, -1];
}

/* Behind solids.js (140ms realloc, so COLS/ROWS are current) and charFrame.js
   (220ms, and it can move the panel by up to a cell). */
let _tkResize = 0;
window.addEventListener('resize', () => {
  clearTimeout(_tkResize);
  _tkResize = setTimeout(tickSync, 260);
});
