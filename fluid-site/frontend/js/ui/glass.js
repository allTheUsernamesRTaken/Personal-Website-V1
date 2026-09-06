/* glass.js — the panel has no colour of its own.

   Every other skin picks a hue and defends it. This one can't: the argument
   against amber is that a chosen accent is a decision the page has to keep
   justifying against a background that is already every hue at once. So the
   panel is achromatic — bone-white type on near-black glass, no accent token
   at all — and the only colour on it is light the fluid puts there.

   Three channels, because a real sheet of glass in front of a light source
   does three different things and doing only one of them reads as a filter:

     tint    what the surface transmits. The whole panel takes a wash of the
             mean hue behind it. Very weak — this is the one that has to stay
             under the threshold of "the panel is coloured", because the
             moment it reads as a colour choice we're back to amber.

     edge    what the surface catches. The rim samples per-side, so the lit
             edge is the one the flow is actually working, and the four sides
             disagree. This is the loudest channel and still tops out well
             below the sim's own saturation.

     spec    a specular smear along the leading edge, from the component of
             flow driven into the panel rather than past it. Grazing light,
             so it only appears under a real event and decays slowly.

   Everything is one-way: the field lights the panel, the panel never lights
   back. And every channel rests at zero, so with an empty tank this is a
   plain white-on-black panel — which is the point. It has to be legible as
   a document first and a surface second.

   Writes CSS custom properties on #panel; css/skins.css consumes them. */

const GL_FPS = 20;

/* Sample rings, in cells, outside each edge. Two deep: the cell adjacent to
   a solid is a boundary cell and carries the wall condition, not the flow. */
const GL_OUT = 2, GL_DEPTH = 2;

/* Below this the field is ambient wash rather than an event. Same floor
   ticks.js uses, so the two agree about what "something is happening" means. */
const GL_FLOOR = 0.14;

/* Rim alpha, resting to fully lit. The rim is the panel's entire boundary —
   skins.css sets --frame to transparent — so the resting value has to hold
   an edge on its own against a black field, and it sits above night's --line
   (0.15) rather than below it.

   The peak is lower than it would need to be for a uniformly lit edge. Once
   the rim is a gradient, a hot stop is legible because its neighbours are
   darker — the contrast is local, along the edge itself — so the whole line
   no longer has to get bright for anything to read. */
const GL_REST = 0.30, GL_PEAK = 0.66;

let glGeom = null;                       // { i0, j0, i1, j1 }
let _glLast = 0;

/* Stops per edge. The rim used to be one sample per side, which meant a wake
   shedding off one corner lit the entire edge it touched, uniformly — the
   edge had a state rather than a distribution, and a uniformly lit 560px line
   reads as a UI element switching on.

   7 is enough that a feature the size of a vortex (a few cells) shows up as a
   local brightening, and few enough that the gradient string stays short —
   it's rebuilt on every write, so its length is the per-frame cost. */
const GL_STOPS = 7;

/* Smoothed state, now one entry per stop per side. Velocity is carried as a
   vector, never as a hue: hue is circular and averaging it wraps
   catastrophically across 0/360. */
const GL_SIDES = ['t', 'r', 'b', 'l'];
const glA = {};                          // vx per stop
const glB = {};                          // vy per stop
const glE = {};                          // energy per stop, 0..1
const glS = { t: 0, r: 0, b: 0, l: 0 };  // specular stays per side

GL_SIDES.forEach(s => {
  glA[s] = new Float32Array(GL_STOPS);
  glB[s] = new Float32Array(GL_STOPS);
  glE[s] = new Float32Array(GL_STOPS);
});

let glTintA = 0, glTintB = 0, glTintE = 0;

/* Quantised last-written values, so we can skip the write when nothing moved.
   A custom property on #panel invalidates style for the entire document —
   #panel is the document — so writing every frame at rest is real cost. */
const glSent = {};

/* `tube` is glass's rim with a fixed palette on the type, so it wants the
   same edge sampling. Only --gl-lit differs in what reads it: glass spends it
   on the sim-wired marks, tube declares those instead and leaves it unread. */
function glassOn() {
  return typeof currentSkin !== 'undefined'
    && (currentSkin === 'glass' || currentSkin === 'tube');
}

/* Density and velocity around one stop on one edge.

   `t` is the stop's position along the edge, 0..1. The window is the run of
   cells nearest that position, overlapping its neighbours — adjacent stops
   share cells, so the gradient CSS interpolates between values that were
   already related and the rim comes out continuous rather than banded.

   Sampling outward only: the panel is a solid body and enforceSolids() zeroes
   its interior, so the inside always reads as dead. */
function glSample(side, g, t) {
  const horiz = (side === 't' || side === 'b');
  const lo = horiz ? g.i0 : g.j0;
  const hi = horiz ? g.i1 : g.j1;
  const span = Math.max(1, hi - lo);

  /* Half-window of one stop's spacing, so consecutive windows just touch at
     their centres and overlap by half on each side. */
  const half = Math.max(1, Math.round(span / (GL_STOPS - 1) * 0.5));
  const c = lo + Math.round(t * span);

  let d = 0, a = 0, b = 0, n = 0;

  for (let k = 0; k < GL_DEPTH; k++) {
    const off = GL_OUT + k;
    for (let m = -half; m <= half; m++) {
      let ci, cj;
      if (horiz) {
        ci = c + m;
        cj = side === 't' ? g.j0 - off : g.j1 + off;
      } else {
        ci = side === 'l' ? g.i0 - off : g.i1 + off;
        cj = c + m;
      }
      ci = Math.max(1, Math.min(COLS - 2, ci));
      cj = Math.max(1, Math.min(ROWS - 2, cj));
      const id = ix(ci, cj);
      if (solid[id]) continue;
      d += dens[id]; a += vx[id]; b += vy[id]; n++;
    }
  }
  if (!n) return { d: 0, a: 0, b: 0 };
  return { d: d / n, a: a / n, b: b / n };
}

/* One edge -> a linear-gradient with GL_STOPS colour stops.

   `dir` is the CSS gradient direction, which has to run the same way the
   sample index does or the rim ends up mirrored against the field it's
   reading. */
function glGradient(side, dir) {
  const A = glA[side], B = glB[side], E = glE[side];
  let out = 'linear-gradient(' + dir;

  for (let k = 0; k < GL_STOPS; k++) {
    const lit = E[k];
    const c = glHue(A[k], B[k], 0.66, 0.62, lit);
    const pos = (k / (GL_STOPS - 1) * 100).toFixed(1) + '%';
    const alpha = GL_REST + (GL_PEAK - GL_REST) * lit;
    out += ', ' + (c ? glRgba(c, alpha)
                     : 'rgba(214,226,242,' + (GL_REST + 0.10 * lit).toFixed(3) + ')')
         + ' ' + pos;
  }
  return out + ')';
}

/* Outward normal per side, for the specular term. +y is down the screen. */
const GL_NORM = { t: [0, -1], r: [1, 0], b: [0, 1], l: [-1, 0] };

/* Rises fast, falls slowly — a needle settling, not a meter tracking. The
   asymmetry is what stops the rim flickering with every wisp.

   The release is only moderately slower than the attack, not an order of
   magnitude. At 0.045 the rim took the better part of ten seconds to give up
   a gust, which past a couple of seconds stops reading as "settling" and
   starts reading as "stuck". */
function glEase(cur, target) {
  return cur + (target - cur) * (target > cur ? 0.30 : 0.10);
}

/* Energy -> 0..1 with the ambient floor removed, so a field with smoke
   sitting in it still rests at zero and only events register. */
function glEnergy(d, a, b) {
  const raw = d * 2.0 + Math.sqrt(a * a + b * b) * 1.6;
  const e = raw / (1 + raw);
  return Math.max(0, Math.min(1, (e - GL_FLOOR) / (1 - GL_FLOOR)));
}

/* Velocity direction -> rgb, at a saturation the panel can carry.

   Deliberately not P.sat. The sim runs at 0.90 because it's drawing 1px
   glyphs on black and needs the chroma to survive at that size; a wash over
   a 560px surface at the same saturation reads as a coloured panel, which is
   the thing this skin exists to avoid.

   `lit` is the mover. Saturation scales with it, so a settling field doesn't
   just dim — it desaturates back to the neutral rim. That distinction is the
   whole reason this reads as a reflection: colour is a thing the field is
   currently doing, not a state the panel latches into.

   It has to work this way because velocity direction never actually stops
   pointing somewhere. The field decays by velDamp (0.9998/step), so atan2
   keeps returning a perfectly good hue long after there's any energy behind
   it — for minutes. Gating on speed alone leaves a bright stale colour on an
   edge with nothing happening at it. */
function glHue(a, b, sat, lum, lit) {
  const spd = Math.sqrt(a * a + b * b);
  if (spd < 1e-5 || lit < 0.012) return null;
  let h = Math.atan2(b, a);
  if (h < 0) h += 6.283185307;
  /* Ease in, so the last of the colour goes quickly rather than lingering
     as a faint tint — a slow tail is exactly what "never settles" looks
     like, even when the numbers are technically decaying. */
  return hsl2rgb(h * 57.29577951, sat * Math.pow(lit, 0.65), lum);
}

function glRgba(c, alpha) {
  return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + alpha.toFixed(3) + ')';
}

/* Write only when the quantised value actually moves. */
function glSet(name, value, q) {
  if (glSent[name] === q) return;
  glSent[name] = q;
  panelEl.style.setProperty(name, value);
}

function glassFrame(now) {
  if (!glassOn() || !glGeom || REDUCED) return;
  if (now - _glLast < 1000 / GL_FPS) return;
  _glLast = now;

  const g = glGeom;
  let sumA = 0, sumB = 0, sumE = 0;

  /* Gradient direction per side. Each runs the same way its stop index does,
     so stop 0 is the top-left end of the top edge and the rim isn't mirrored
     against the field it's reading. */
  const DIR = { t: 'to right', r: 'to bottom', b: 'to right', l: 'to bottom' };

  for (let k = 0; k < GL_SIDES.length; k++) {
    const s = GL_SIDES[k];
    const A = glA[s], B = glB[s], E = glE[s];

    let sideA = 0, sideB = 0, sideE = 0, qsum = 0;

    for (let p = 0; p < GL_STOPS; p++) {
      const smp = glSample(s, g, p / (GL_STOPS - 1));

      A[p] = glEase(A[p], smp.a);
      B[p] = glEase(B[p], smp.b);
      E[p] = glEase(E[p], glEnergy(smp.d, smp.a, smp.b));

      sideA += A[p]; sideB += B[p]; sideE += E[p];

      /* Cheap fingerprint of the whole edge, so the gradient string is only
         rebuilt when some stop has actually moved. Hue is folded in as well
         as energy — a stop can change colour at constant brightness. */
      qsum = (qsum * 31 + Math.round(E[p] * 18)
                        + Math.round(Math.atan2(B[p], A[p]) * 6)) | 0;
    }

    sideA /= GL_STOPS; sideB /= GL_STOPS; sideE /= GL_STOPS;
    sumA += sideA; sumB += sideB; sumE += sideE;

    /* ── edge ──
       Floor is GL_REST, well above night's --line, because the rim is the
       panel's only boundary — there is no CSS border under it. An edge that
       is only there when the sim is busy means the panel dissolves into the
       background on a still page, which is worse than any accent colour. */
    glSet('--gl-' + s, glGradient(s, DIR[s]), qsum);

    /* ── spec ──
       Grazing highlight, still one value per side: it's a broad wash, and
       giving it per-stop structure would put a second gradient on top of the
       rim's and just read as noise. Uses the side mean, so it responds to the
       edge as a whole. Only the component driven *into* the surface counts —
       flow running parallel past an edge is not a reflection, it's traffic.

       Decays on its own accumulator (0.90/frame ≈ 1.5s), independently of the
       rim, so the highlight is gone well before the edge finishes settling —
       a specular is the first thing to leave a surface, not the last. */
    const nm = GL_NORM[s];
    const into = Math.max(0, -(sideA * nm[0] + sideB * nm[1]));
    glS[s] = Math.min(1, glS[s] * 0.90 + into * 2.4 * 0.16);

    const sp = glS[s];
    glSet('--gs-' + s, (sp * 0.34).toFixed(3), Math.round(sp * 16));
  }

  /* ── tint ──
     The mean of the four sides, i.e. what the sheet as a whole transmits.
     Capped very low on purpose: this is the channel that would turn the
     panel into a coloured object if it ever got loud, so it stays at the
     edge of perceptible and does its work by moving rather than by being
     visible in a still. */
  glTintA = sumA / 4; glTintB = sumB / 4; glTintE = sumE / 4;

  const tc = glHue(glTintA, glTintB, 0.62, 0.52, glTintE);
  const tq = Math.round(glTintE * 14);
  if (tc) {
    glSet('--gl-tint', glRgba(tc, 0.11 * glTintE), tq * 1000 + (tc[0] << 2 | tc[1] >> 6));
  } else {
    glSet('--gl-tint', 'rgba(0,0,0,0)', -1);
  }

  /* One scalar for everything that should acknowledge the field without
     taking its hue — the rules inside the panel, mostly. Achromatic, so it
     reads as the sheet catching more light rather than as another accent. */
  const gq = Math.round(glTintE * 12);
  glSet('--gl-lift', (0.15 + 0.22 * glTintE).toFixed(3), gq);

  /* ── lit ──
     An opaque text colour in the field's current hue, for the handful of
     marks that are about the sim (the prompt, the caret, the one <b> that
     names the solver). This is the skin's answer to "where does colour come
     back": borrowed, never chosen.

     Three things separate it from the rim, all of them because this is type
     and the rim is not:

     - Lightness is high (0.78) and fixed. Text has to hold contrast against
       the panel at 12px; a mid-lightness hue that works as a 1px edge is
       unreadable as a word.
     - Saturation tops out low. At 12px a saturated hue on near-black fringes
       and reads as a rendering fault rather than as a colour.
     - It lands on white, not on transparent, so an idle field gives plain
       white type rather than type that fades out. A body word that dims
       because the tank is empty would be a legibility bug, not an effect. */
  const lc = glHue(glTintA, glTintB, 0.42, 0.78, glTintE);
  if (lc) {
    const w = Math.min(1, glTintE * 1.8);      // ease onto white
    const r = Math.round(255 + (lc[0] - 255) * w);
    const g2 = Math.round(255 + (lc[1] - 255) * w);
    const b2 = Math.round(255 + (lc[2] - 255) * w);
    glSet('--gl-lit', 'rgb(' + r + ',' + g2 + ',' + b2 + ')',
          (r >> 3) * 4096 + (g2 >> 3) * 64 + (b2 >> 3));
  } else {
    glSet('--gl-lit', '#fff', -1);
  }
}

/* Panel rect in sim cells. Same pitch everything else uses: the backing store
   is COLS*CW stretched to 100vw, so this is innerWidth/COLS, not CW. */
function glassSync() {
  if (!panelEl || !COLS) return;
  const st = panelEl.style;

  if (!glassOn()) {
    glGeom = null;
    GL_SIDES.forEach(s => {
      st.removeProperty('--gl-' + s);
      st.removeProperty('--gs-' + s);
    });
    st.removeProperty('--gl-tint');
    st.removeProperty('--gl-lift');
    st.removeProperty('--gl-lit');
    for (const k in glSent) delete glSent[k];
    return;
  }

  const cw = window.innerWidth / COLS;
  const ch = window.innerHeight / ROWS;
  const r = panelEl.getBoundingClientRect();

  glGeom = {
    i0: Math.max(1, Math.round(r.left   / cw)),
    j0: Math.max(1, Math.round(r.top    / ch)),
    i1: Math.min(COLS - 2, Math.round(r.right  / cw)),
    j1: Math.min(ROWS - 2, Math.round(r.bottom / ch))
  };

  GL_SIDES.forEach(s => {
    glA[s].fill(0); glB[s].fill(0); glE[s].fill(0);
    glS[s] = 0;
  });
  glTintA = glTintB = glTintE = 0;
  for (const k in glSent) delete glSent[k];

  /* Resting values, so the panel is correct before the first sampled frame
     and stays correct under prefers-reduced-motion, where glassFrame() never
     runs at all. A flat colour rather than a gradient — with no field read
     yet there is nothing for a gradient to describe. */
  const flat = 'linear-gradient(rgba(214,226,242,' + GL_REST + '),'
             + 'rgba(214,226,242,' + GL_REST + '))';
  GL_SIDES.forEach(s => {
    st.setProperty('--gl-' + s, flat);
    st.setProperty('--gs-' + s, '0');
  });
  st.setProperty('--gl-tint', 'rgba(0,0,0,0)');
  st.setProperty('--gl-lift', '0.15');
  st.setProperty('--gl-lit', '#fff');
}

/* Behind solids.js (140ms realloc) and charFrame.js (220ms, and it can move
   the panel), same as ticks.js. */
let _glResize = 0;
window.addEventListener('resize', () => {
  clearTimeout(_glResize);
  _glResize = setTimeout(glassSync, 260);
});
