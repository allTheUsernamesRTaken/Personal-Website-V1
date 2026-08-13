/* deckFrame.js — the panel's frame, drawn as characters on the sim's own grid.

   The reason the CSS skins never sat right: the whole page is quantised
   character cells — the background is glyphs on an 11x12 lattice, the name in
   the header is box-drawing glyphs — and a CSS border is anti-aliased vector
   graphics. Right idiom, wrong material. So this draws the frame out of the
   same stuff as everything else: box-drawing characters, in the same font, at
   the same cell pitch, snapped to the same lattice the fluid is drawn on.

   Two things follow from that, and they're the whole point:

   - The panel stops being an element floating over a canvas and becomes a
     region of one display. snapPanel() rounds its rect to whole cells so the
     frame glyphs land exactly where the sim's glyphs would have.

   - The frame can be coloured per character, from the flow passing outside
     that cell. So the corners light up when the wake hits them. That's
     variation which tracks something real, which is what the four identical
     amber ticks never had.

   The asymmetry is likewise not decorative. Double rule on the top edge and
   the right edge, single on the left and bottom, because ambient.js sends the
   gust in over the top at ~25 degrees and sheds it off the top-right corner:
   the two edges the flow actually engages are the two that carry weight. */

const DECK_FPS = 20;                         // colour-only redraw; geometry is static

let deckCanvas = null, deckCtx = null;
let deckCells  = [];                         // { u, v, ch, w }
let deckGeom   = null;                       // { i0, j0, W, H, cw, ch }
let deckBase   = [138, 151, 168];            // structural colour, from --deck-frame
let _deckLast  = 0;

function deckActive() {
  return typeof currentSkin !== 'undefined' && currentSkin === 'deck';
}

/* ── glyph map ────────────────────────────────────────────────────────
   Double and single lines have to meet on proper transition glyphs or the
   joins break: U+2552 down-single/right-double at the top-left, U+255C
   up-double/left-single at the bottom-right, and so on. */
function buildCells(W, H) {
  const c = [];
  const put = (u, v, ch, w) => c.push({ u, v, ch, w });

  const EDGE = 0.42, NODE = 0.78, CORNER = 1, LABEL = 0.3;

  /* corners */
  put(0,     0,     '╒', CORNER);   // ╒  single down, double right
  put(W - 1, 0,     '╗', CORNER);   // ╗  double down, double left
  put(0,     H - 1, '└', CORNER);   // └  single up, single right
  put(W - 1, H - 1, '╜', CORNER);   // ╜  double up, single left

  /* top — inflow edge, double */
  for (let u = 1; u < W - 1; u++) put(u, 0, '═', EDGE);
  /* right — the wake runs down it, double */
  for (let v = 1; v < H - 1; v++) put(W - 1, v, '║', EDGE);
  /* left — a narrow gutter, nothing happens here */
  for (let v = 1; v < H - 1; v++) put(0, v, '│', EDGE);
  /* bottom */
  for (let u = 1; u < W - 1; u++) put(u, H - 1, '─', EDGE);

  /* Below this the panel is too small for detail to read as anything but
     clutter — phones, mostly. */
  if (W < 22 || H < 14) return c;

  /* Ports along the top, dropping a short lead into the panel. Spacing and
     lead length are both irregular on purpose: regular spacing reads as a
     pattern, irregular reads as an assembly that had reasons. */
  [[3, 2], [9, 1], [12, 1]].forEach(([u, drop]) => {
    if (u >= W - 11) return;
    put(u, 0, '╤', NODE);              // ╤ double horizontal, single down
    for (let v = 1; v <= drop; v++) put(u, v, '│', EDGE);
  });

  /* The shedding corner — the only elaborate one, because it's the only
     corner where anything happens. An inner rule gives it thickness, and it
     terminates into the right edge on ╢ so nothing dangles. */
  const s = Math.max(6, Math.min(10, W - 14));
  for (let u = W - s; u <= W - 2; u++) put(u, 1, '─', LABEL);
  put(W - 1, 1, '╢', CORNER);          // ╢ double vertical, single left
  put(W - 1, 2, '╢', NODE);
  put(W - 1, 3, '╢', NODE);

  /* Taps down the right edge. This is the edge the wake runs along, so the
     marks are also the thing most worth lighting up — clustered rather than
     evenly spaced, and proportional so a tall panel doesn't just get a
     longer bare run.

     Runs are counted in cells rather than derived from nearby fractions,
     which round together on a short panel and silently collapse. */
  const taps = (u, ch, w, lo, spec) => spec.forEach(([f, n]) => {
    const v0 = Math.round(f * H);
    for (let k = 0; k < n; k++) {
      const v = v0 + k;
      if (v > lo && v < H - 2) put(u, v, ch, w);
    }
  });

  taps(W - 1, '╢', EDGE, 4, [[0.17, 1], [0.26, 2], [0.44, 1], [0.62, 3], [0.81, 1]]);

  /* Left edge taps. Fewer, because nothing happens on this side. */
  taps(0, '├', NODE, 1, [[0.10, 2], [0.29, 1]]);

  /* Nameplate in the bottom rule. Frames on real equipment carry labels;
     this is the one place the panel can say what it is without spending a
     line of the layout on it. */
  const label = ' STABLE·FLUIDS·1999 ';
  if (W > label.length + 8) {
    for (let k = 0; k < label.length; k++) {
      const chx = label[k];
      put(3 + k, H - 1, chx === ' ' ? '─' : chx, chx === ' ' ? EDGE : LABEL);
    }
  }
  return c;
}

/* ── lattice ──────────────────────────────────────────────────────────
   The sim's canvas backing store is COLS*CW but it's displayed at 100vw, so
   the cell pitch on screen is innerWidth/COLS, not CW. solids.js already
   works in those units; this has to agree with it or the frame and the
   obstacle would key to different grids. */
function snapPanel() {
  const cw = window.innerWidth / COLS;
  const ch = window.innerHeight / ROWS;

  // Measure where the stylesheet wants the panel, then round that to cells.
  clearSnap();
  const r = panelEl.getBoundingClientRect();

  const i0 = Math.max(0, Math.round(r.left / cw));
  const j0 = Math.max(0, Math.round(r.top  / ch));
  const i1 = Math.max(i0 + 12, Math.round(r.right  / cw));
  const j1 = Math.max(j0 +  8, Math.round(r.bottom / ch));

  const st = panelEl.style;
  st.left = (i0 * cw) + 'px';
  st.top  = (j0 * ch) + 'px';
  st.right = st.bottom = 'auto';
  st.width  = ((i1 - i0) * cw) + 'px';
  st.height = ((j1 - j0) * ch) + 'px';
  st.transform = 'none';

  deckGeom = { i0, j0, W: i1 - i0, H: j1 - j0, cw, ch };
}

function clearSnap() {
  const st = panelEl.style;
  st.left = st.top = st.right = st.bottom = st.width = st.height = st.transform = '';
}

/* ── colour ───────────────────────────────────────────────────────────
   Sample the flow two cells outside whichever edge this glyph sits on. The
   panel is a solid body, so anything inside its own bounds is zeroed and
   would read as permanently dead. */
function sampleOutside(u, v, g) {
  let si = g.i0 + u, sj = g.j0 + v;
  const dl = u, dr = g.W - 1 - u, dt = v, db = g.H - 1 - v;
  const m = Math.min(dl, dr, dt, db);

  if      (m === dt) sj = g.j0 - 2;
  else if (m === db) sj = g.j0 + g.H + 1;
  else if (m === dl) si = g.i0 - 2;
  else               si = g.i0 + g.W + 1;

  si = Math.max(1, Math.min(COLS - 2, si));
  sj = Math.max(1, Math.min(ROWS - 2, sj));
  const id = ix(si, sj);
  return { d: dens[id], a: vx[id], b: vy[id] };
}

function parseHex(s) {
  const m = /^#?([0-9a-f]{6})$/i.exec((s || '').trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function readBaseColour() {
  const v = getComputedStyle(panelEl).getPropertyValue('--deck-frame');
  const rgb = parseHex(v);
  if (rgb) deckBase = rgb;
}

function drawFrame() {
  if (!deckCtx || !deckGeom) return;
  const g = deckGeom;
  deckCtx.clearRect(0, 0, g.W * g.cw, g.H * g.ch);

  for (let k = 0; k < deckCells.length; k++) {
    const cell = deckCells[k];
    const s = sampleOutside(cell.u, cell.v, g);
    const spd = Math.sqrt(s.a * s.a + s.b * s.b);

    /* Soft knee so a wisp registers but a gust doesn't clip everything to
       the same value. */
    const raw = s.d * 2.2 + spd * 1.8;
    const e = raw / (1 + raw);

    let r, gr, b;
    if (e > 0.02) {
      let h = Math.atan2(s.b, s.a);
      if (h < 0) h += 6.283185307;
      const flow = hsl2rgb(h * 57.29577951, P.sat, 0.34 + 0.5 * e);
      const k2 = e * 0.9;                       // how far the flow takes over
      r  = deckBase[0] * cell.w * (1 - k2) + flow[0] * k2;
      gr = deckBase[1] * cell.w * (1 - k2) + flow[1] * k2;
      b  = deckBase[2] * cell.w * (1 - k2) + flow[2] * k2;
    } else {
      r = deckBase[0] * cell.w; gr = deckBase[1] * cell.w; b = deckBase[2] * cell.w;
    }

    deckCtx.fillStyle = 'rgb(' + (r | 0) + ',' + (gr | 0) + ',' + (b | 0) + ')';
    deckCtx.fillText(cell.ch, cell.u * g.cw, cell.v * g.ch);
  }
}

/* ── lifecycle ────────────────────────────────────────────────────────── */
function ensureCanvas() {
  if (deckCanvas) return;
  deckCanvas = document.createElement('canvas');
  deckCanvas.id = 'deckframe';
  deckCanvas.setAttribute('aria-hidden', 'true');
  panelEl.appendChild(deckCanvas);
  deckCtx = deckCanvas.getContext('2d');
}

function sizeCanvas() {
  const g = deckGeom;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = g.W * g.cw, h = g.H * g.ch;

  deckCanvas.style.width  = w + 'px';
  deckCanvas.style.height = h + 'px';
  deckCanvas.width  = Math.round(w * dpr);
  deckCanvas.height = Math.round(h * dpr);

  deckCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  // Same font and the same size the sim uses, corrected for the slight
  // stretch between the sim's backing store and its display width.
  deckCtx.font = ((CW + 2) * (g.cw / CW)).toFixed(2) + 'px ' + MONO;
  deckCtx.textAlign = 'left';
  deckCtx.textBaseline = 'top';
}

function deckTeardown() {
  if (deckCanvas) { deckCanvas.remove(); deckCanvas = null; deckCtx = null; }
  deckCells = [];
  deckGeom = null;
  if (panelEl) clearSnap();
}

function deckFrameSync() {
  if (!panelEl || !COLS) return;
  if (!deckActive()) {
    deckTeardown();
    if (typeof rebuildSolids === 'function') rebuildSolids();
    return;
  }
  ensureCanvas();
  readBaseColour();
  snapPanel();
  sizeCanvas();
  deckCells = buildCells(deckGeom.W, deckGeom.H);
  drawFrame();
  /* The snap moves the panel by up to a cell, and the panel is the obstacle. */
  if (typeof rebuildSolids === 'function') rebuildSolids();
}

function deckFrameFrame(now) {
  if (!deckActive() || !deckCtx) return;
  if (now - _deckLast < 1000 / DECK_FPS) return;
  _deckLast = now;
  drawFrame();
}

/* solids.js debounces its own realloc at 140ms and COLS/ROWS only exist
   after it runs, so this has to land after that. */
let _deckResize = 0;
window.addEventListener('resize', () => {
  clearTimeout(_deckResize);
  _deckResize = setTimeout(deckFrameSync, 220);
});
