/* charFrame.js — panel boundaries drawn as characters on the sim's own grid.

   The page is quantised character cells all the way down: the background is
   glyphs on an 11x12 lattice, the header name is box-drawing glyphs. A CSS
   border is anti-aliased vector graphics, which is the right idiom in the
   wrong material — it's why the slab skins read as generic next to the ASCII.
   So these two skins draw their boundary out of the same stuff as everything
   else, in the same font, at the same pitch, on the same lattice.

   Shared by both:

   - snapPanel() rounds the panel's rect to whole cells, so a boundary glyph
     lands exactly where a sim glyph would have. That's what stops the panel
     reading as an element floating over a canvas. Note the on-screen pitch is
     innerWidth/COLS, not CW — the sim's backing store is COLS*CW stretched to
     100vw — so this agrees with solids.js.

   - Sampling is smoothed in space and in time. Reading one fluid cell per
     glyph makes neighbours disagree, which shows up as a shifting multi-hue
     speckle along the edge rather than an edge that lights up as one thing.

   The two differ in what they draw:

   steel  a fixed box-drawing frame, lit by the flow. Asymmetric because the
          gust comes in over the top and sheds off the top-right (ambient.js),
          so the two edges the flow engages are the two that carry weight.

   rime   no frame at all. The boundary is drawn from the sim's own density
          ramp — dense glyphs where flow presses on the panel, nothing where
          it doesn't. The panel is a bluff body, so smoke stagnates on its
          windward edge; this just makes that visible. It accretes and decays
          like rime ice, so the edge is incomplete, ragged, and moving.

   A complete box is a widget. An incomplete boundary is a place. */

const CHAR_FPS = 20;                    // redraw rate; geometry is cheap, this isn't hot

let cfCanvas = null, cfCtx = null;
let cfGeom   = null;                    // { i0, j0, W, H, cw, ch }
let cfSlots  = [];                      // { u, v, ch?, w?, d? } — what to draw where
let cfInk    = [200, 210, 220];         // base colour, from --char-ink
let _cfLast  = 0;

/* Smoothing state, parallel to cfSlots. Velocity is smoothed as a vector
   rather than as a hue: averaging hues wraps catastrophically at 0/360. */
let sA = null, sB = null, sD = null, sAcc = null;

function charSkin() {
  if (typeof currentSkin === 'undefined') return null;
  return (currentSkin === 'steel' || currentSkin === 'rime') ? currentSkin : null;
}

/* ── steel: the glyph map ─────────────────────────────────────────────
   Keyed by cell so a later mark replaces the rule underneath it. Pushing to
   a list instead means the canvas draws both, which strikes a rule through
   the nameplate and double-renders every tap. */
function buildSteel(W, H) {
  const map = new Map();
  const put = (u, v, ch, w) => map.set(v * W + u, { u, v, ch, w });

  const EDGE = 0.42, NODE = 0.78, CORNER = 1, LABEL = 0.34;

  /* Single and double rules have to meet on proper transition glyphs or the
     joins break: ╒ is down-single/right-double, ╜ is up-double/left-single. */
  put(0,     0,     '╒', CORNER);
  put(W - 1, 0,     '╗', CORNER);
  put(0,     H - 1, '└', CORNER);
  put(W - 1, H - 1, '╜', CORNER);

  for (let u = 1; u < W - 1; u++) put(u, 0,     '═', EDGE);   // inflow edge
  for (let v = 1; v < H - 1; v++) put(W - 1, v, '║', EDGE);   // the wake runs down this one
  for (let v = 1; v < H - 1; v++) put(0, v,     '│', EDGE);
  for (let u = 1; u < W - 1; u++) put(u, H - 1, '─', EDGE);

  // Below this, detail is clutter rather than structure.
  if (W < 22 || H < 14) return Array.from(map.values());

  /* Ports, with irregular spacing and irregular lead length. Regular spacing
     reads as a pattern; irregular reads as an assembly that had reasons. */
  [[3, 2], [9, 1], [12, 1]].forEach(([u, drop]) => {
    if (u >= W - 11) return;
    put(u, 0, '╤', NODE);
    for (let v = 1; v <= drop; v++) put(u, v, '│', EDGE);
  });

  /* The shedding corner — the only elaborate one, because it's the only
     corner where anything happens. Terminates into ╢ so nothing dangles. */
  const s = Math.max(6, Math.min(10, W - 14));
  for (let u = W - s; u <= W - 2; u++) put(u, 1, '─', LABEL);
  put(W - 1, 1, '╢', CORNER);
  put(W - 1, 2, '╢', NODE);
  put(W - 1, 3, '╢', NODE);

  /* Taps, counted in cells — nearby fractions round together and collapse. */
  const taps = (u, ch, w, lo, spec) => spec.forEach(([f, n]) => {
    const v0 = Math.round(f * H);
    for (let k = 0; k < n; k++) {
      const v = v0 + k;
      if (v > lo && v < H - 2) put(u, v, ch, w);
    }
  });
  taps(W - 1, '╢', EDGE, 4, [[0.17, 1], [0.26, 2], [0.44, 1], [0.62, 3], [0.81, 1]]);
  taps(0,     '├', NODE, 1, [[0.10, 2], [0.29, 1]]);

  /* Nameplate in the bottom rule. Written last so it clears the rule. */
  const label = ' STABLE·FLUIDS·1999 ';
  if (W > label.length + 8) {
    for (let k = 0; k < label.length; k++) {
      const c = label[k];
      put(3 + k, H - 1, c === ' ' ? '─' : c, c === ' ' ? EDGE : LABEL);
    }
  }
  return Array.from(map.values());
}

/* ── rime: the band ───────────────────────────────────────────────────
   Two cells deep. Depth 1 needs far more accretion to show at all, so the
   edge has variable thickness instead of a constant outline. */
function buildRime(W, H) {
  const out = [];
  for (let d = 0; d < 2; d++) {
    if (W - 2 * d < 3 || H - 2 * d < 3) break;
    for (let u = d; u < W - d; u++) { out.push({ u, v: d, d }); out.push({ u, v: H - 1 - d, d }); }
    for (let v = d + 1; v < H - 1 - d; v++) { out.push({ u: d, v, d }); out.push({ u: W - 1 - d, v, d }); }
  }
  return out;
}

/* ── sampling ─────────────────────────────────────────────────────────
   Average a short run of cells just outside the edge this glyph sits on.
   Everything inside the panel is zeroed — it's a solid body — so sampling
   inward would read as permanently dead. */
function sampleBand(u, v, g) {
  const dl = u, dr = g.W - 1 - u, dt = v, db = g.H - 1 - v;
  const m = Math.min(dl, dr, dt, db);

  let si = g.i0 + u, sj = g.j0 + v, nx = 0, ny = 0;
  if      (m === dt) { sj = g.j0 - 2;            ny = -1; }
  else if (m === db) { sj = g.j0 + g.H + 1;      ny =  1; }
  else if (m === dl) { si = g.i0 - 2;            nx = -1; }
  else               { si = g.i0 + g.W + 1;      nx =  1; }

  // Run along the edge, i.e. perpendicular to the outward normal.
  const tx = ny === 0 ? 0 : 1, ty = nx === 0 ? 0 : 1;
  let d = 0, a = 0, b = 0, n = 0;
  for (let k = -2; k <= 2; k++) {
    const ci = Math.max(1, Math.min(COLS - 2, si + tx * k));
    const cj = Math.max(1, Math.min(ROWS - 2, sj + ty * k));
    const id = ix(ci, cj);
    d += dens[id]; a += vx[id]; b += vy[id]; n++;
  }
  return { d: d / n, a: a / n, b: b / n, nx, ny };
}

/* Temporal ease. Without it the frame flickers per redraw even when the
   spatial average is stable. */
function smooth(i, s) {
  const k = 0.22;
  sA[i] += (s.a - sA[i]) * k;
  sB[i] += (s.b - sB[i]) * k;
  sD[i] += (s.d - sD[i]) * k;
}

function parseHex(s) {
  const m = /^#?([0-9a-f]{6})$/i.exec((s || '').trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/* ── drawing ──────────────────────────────────────────────────────────── */
function drawSteel(g) {
  for (let i = 0; i < cfSlots.length; i++) {
    const c = cfSlots[i];
    smooth(i, sampleBand(c.u, c.v, g));

    const a = sA[i], b = sB[i];
    const spd = Math.sqrt(a * a + b * b);
    const raw = sD[i] * 2.0 + spd * 1.6;
    const e = raw / (1 + raw);

    /* Quiet by default. Ambient smoke is everywhere, so tinting from zero
       means the frame never rests — it has to take a real event to light. */
    const k = Math.max(0, e - 0.30) * 1.5;
    let r = cfInk[0] * c.w, gr = cfInk[1] * c.w, bl = cfInk[2] * c.w;

    if (k > 0.001) {
      let h = Math.atan2(b, a);
      if (h < 0) h += 6.283185307;
      const f = hsl2rgb(h * 57.29577951, P.sat, 0.36 + 0.46 * e);
      const t = Math.min(0.72, k);
      r = r * (1 - t) + f[0] * t;
      gr = gr * (1 - t) + f[1] * t;
      bl = bl * (1 - t) + f[2] * t;
    }
    cfCtx.fillStyle = 'rgb(' + (r | 0) + ',' + (gr | 0) + ',' + (bl | 0) + ')';
    cfCtx.fillText(c.ch, c.u * g.cw, c.v * g.ch);
  }
}

function drawRime(g) {
  const nCh = CHARS.length - 1;

  for (let i = 0; i < cfSlots.length; i++) {
    const c = cfSlots[i];
    const s = sampleBand(c.u, c.v, g);
    smooth(i, s);

    const a = sA[i], b = sB[i];
    const spd = Math.sqrt(a * a + b * b);
    // Flow driven *into* the panel is what actually piles up against it.
    const into = Math.max(0, -(a * s.nx + b * s.ny));
    const press = sD[i] * 2.0 + into * 3.4 + spd * 0.6;

    /* Accretion: rises fast, sheds slowly, so a gust leaves frost behind for
       about a second instead of vanishing with the smoke. */
    sAcc[i] = Math.min(2.2, sAcc[i] * 0.93 + press * 0.17);
    const norm = sAcc[i] / (1 + sAcc[i]);

    // Depth 1 needs real accretion, so thickness varies along the edge.
    if (norm < (c.d === 0 ? 0.07 : 0.30)) continue;

    const t = c.d === 0 ? norm : (norm - 0.30) / 0.70;
    const ci = Math.max(1, Math.min((Math.pow(t, 0.85) * CHARS.length) | 0, nCh));

    /* Colour stays near the frost base. The variation people read here is in
       the glyphs, which is the medium's own channel for it — pulling hue per
       cell as well is what made the box frame shimmer. */
    const br = 0.30 + 0.70 * t;
    let r = cfInk[0] * br, gr = cfInk[1] * br, bl = cfInk[2] * br;

    if (spd > 0.02) {
      let h = Math.atan2(b, a);
      if (h < 0) h += 6.283185307;
      const f = hsl2rgb(h * 57.29577951, 0.55, 0.42 + 0.34 * t);
      const w = Math.min(0.34, spd * 2.2);
      r = r * (1 - w) + f[0] * w;
      gr = gr * (1 - w) + f[1] * w;
      bl = bl * (1 - w) + f[2] * w;
    }
    cfCtx.fillStyle = 'rgb(' + (r | 0) + ',' + (gr | 0) + ',' + (bl | 0) + ')';
    cfCtx.fillText(CHARS[ci], c.u * g.cw, c.v * g.ch);
  }
}

function drawFrame() {
  if (!cfCtx || !cfGeom) return;
  const g = cfGeom;
  cfCtx.clearRect(0, 0, g.W * g.cw, g.H * g.ch);
  if (charSkin() === 'rime') drawRime(g); else drawSteel(g);
}

/* ── lattice ──────────────────────────────────────────────────────────── */
function snapPanel() {
  const cw = window.innerWidth / COLS;
  const ch = window.innerHeight / ROWS;

  clearSnap();                                   // measure what the CSS wants
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

  cfGeom = { i0, j0, W: i1 - i0, H: j1 - j0, cw, ch };
}

function clearSnap() {
  const st = panelEl.style;
  st.left = st.top = st.right = st.bottom = st.width = st.height = st.transform = '';
}

/* ── lifecycle ────────────────────────────────────────────────────────── */
function ensureCanvas() {
  if (cfCanvas) return;
  cfCanvas = document.createElement('canvas');
  cfCanvas.id = 'charframe';
  cfCanvas.setAttribute('aria-hidden', 'true');
  panelEl.appendChild(cfCanvas);
  cfCtx = cfCanvas.getContext('2d');
}

function sizeCanvas() {
  const g = cfGeom;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = g.W * g.cw, h = g.H * g.ch;

  cfCanvas.style.width  = w + 'px';
  cfCanvas.style.height = h + 'px';
  cfCanvas.width  = Math.round(w * dpr);
  cfCanvas.height = Math.round(h * dpr);

  cfCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  // The sim's font, corrected for the stretch between its backing store and
  // its display width, so these glyphs match the ones behind them.
  cfCtx.font = ((CW + 2) * (g.cw / CW)).toFixed(2) + 'px ' + MONO;
  cfCtx.textAlign = 'left';
  cfCtx.textBaseline = 'top';
}

function charFrameTeardown() {
  if (cfCanvas) { cfCanvas.remove(); cfCanvas = null; cfCtx = null; }
  cfSlots = [];
  cfGeom = null;
  sA = sB = sD = sAcc = null;
  if (panelEl) clearSnap();
}

function charFrameSync() {
  if (!panelEl || !COLS) return;
  if (!charSkin()) {
    charFrameTeardown();
    if (typeof rebuildSolids === 'function') rebuildSolids();
    return;
  }
  ensureCanvas();

  const ink = parseHex(getComputedStyle(panelEl).getPropertyValue('--char-ink'));
  if (ink) cfInk = ink;

  snapPanel();
  sizeCanvas();
  cfSlots = charSkin() === 'rime'
    ? buildRime(cfGeom.W, cfGeom.H)
    : buildSteel(cfGeom.W, cfGeom.H);

  const n = cfSlots.length;
  sA = new Float32Array(n); sB = new Float32Array(n);
  sD = new Float32Array(n); sAcc = new Float32Array(n);

  drawFrame();
  /* The snap moves the panel by up to a cell, and the panel is the obstacle. */
  if (typeof rebuildSolids === 'function') rebuildSolids();
}

function charFrameFrame(now) {
  if (!charSkin() || !cfCtx) return;
  if (now - _cfLast < 1000 / CHAR_FPS) return;
  _cfLast = now;
  drawFrame();
}

/* solids.js debounces its own realloc at 140ms and COLS/ROWS only exist after
   it runs, so this has to land after that. */
let _cfResize = 0;
window.addEventListener('resize', () => {
  clearTimeout(_cfResize);
  _cfResize = setTimeout(charFrameSync, 220);
});
