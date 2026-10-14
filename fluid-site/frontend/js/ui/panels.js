/* panels.js — subpanels, which are also obstacles.

   The usual argument against opening more panels over a background sim is
   that they eat the space the sim needs. That's true of a background. It
   isn't true here, because the panel is already a solid body in the solve:
   solids.js stamps its bounding box into the obstacle mask every time it
   moves. So a subpanel isn't something placed *over* the simulation, it's
   something placed *in* it.

   Which makes dragging one the most direct interaction on the page. You are
   moving a bluff body through a fluid, and the wake follows you. Opening a
   panel puts a new obstacle in the stream; closing it lets the wake collapse.
   That is worth more than the space it costs.

   The cost it does have is real and it's about flow, not pixels: the wake
   needs room downstream to develop. So panels open into the right half —
   where the wake already is, so you see them disturb it — nothing opens on
   its own, and everything closes. `panels` in the console lists them.

   Phones get none of this. There's no room to drag anything and no second
   place to put a panel, so subpanels become a sheet over the main one. */

const SUB_MIN_W = 260;
const SUB_FPS   = 10;                    // live panels only; drag restamps separately

/* Definitions. Adding a panel is adding an entry here — build() returns the
   body element, live() is optional and runs on the tick, and open()/close()
   are optional hooks for a panel that owns something outside itself. */
const PANEL_DEFS = {
  solver: {
    title: 'solver',
    w: 300, h: 268,
    build: buildSolverBody,
    live:  updateSolverBody
  },
  detail: {
    title: 'detail',
    w: 380, h: 300,
    build: buildDetailBody
  },
  /* The only panel that is load-bearing rather than informational: it isn't
     a window onto the habitat, it *is* the habitat. Its own bounding box is
     the solid body whose lee the organisms shelter in, and the vent hangs
     off its live rect — so dragging this window herds them. */
  life: {
    title: 'life',
    w: 240, h: 176, minW: 220,
    build: buildLifeBody,
    live:  updateLifeBody,
    guard: () => lifeIsAvailable()
      ? '' : (REDUCED ? 'life respects reduced motion' : 'life is desktop-only'),
    open:  el => packetLifeSetEnabled(true, el),
    close: () => packetLifeSetEnabled(false)
  }
};

/* Content for the detail panel, keyed by the data-detail on a project title.
   Deliberately separate from index.html: the pane there is the summary, this
   is what you get when you want the longer version. */
const DETAILS = {
  'ascii-fluid': {
    head: 'ASCII Fluid Dynamics Simulator',
    sub:  'js · canvas · no dependencies',
    body: [
      ['method', 'Stable fluids (Stam 1999). Semi-Lagrangian advection, ' +
                 'Gauss-Seidel pressure projection, vorticity confinement to ' +
                 'put back the curl that diffusion eats.'],
      ['grid',   '~16k cells. Physics every other frame, draw every frame — ' +
                 'half for speed, half because it looked better.'],
      ['solids', 'Panels are Neumann boundaries, not sprites. The mask is ' +
                 'restamped from live DOM rects, which is why dragging this ' +
                 'window changes the flow.'],
      ['colour', 'Hue is velocity direction — the Middlebury convention. ' +
                 'Brightness is energy. Built once into a lookup table; ' +
                 'building hsla() strings per cell cost 16k allocations a frame.'],
      ['speed',  'Semi-Lagrangian advection took framerate up ~200% over the ' +
                 'first naive pass.']
    ]
  },
  'landmarks': {
    head: 'Facial-Landmark Feedback Pipeline',
    sub:  'python · opencv · numpy',
    body: [
      ['problem',  'Landmark feedback for drawings as well as photographs. ' +
                   'Neural detectors give up on rotated heads and pencil sketches.'],
      ['fallback', 'Coherent Point Drift registration plus solvePnP geometry ' +
                   'when the detector abstains, so the pipeline degrades ' +
                   'instead of failing.'],
      ['result',   '50-case benchmark: 98.9% precision / 100% recall, against ' +
                   'GPT-5.5 at 63.5% / 70.5%.']
    ]
  }
};

const openPanels = new Map();            // id -> { el, def, body }
let _zTop = 20;
let _cascade = 0;
let _spLast = 0;

function isNarrow() { return window.innerWidth < 760; }

/* ── bodies ───────────────────────────────────────────────────────────── */
function buildSolverBody() {
  const d = document.createElement('div');
  d.className = 'sp-body sp-solver';
  d.innerHTML =
    '<dl class="sp-kv">' +
    '<dt>grid</dt><dd data-f="grid">—</dd>' +
    '<dt>live</dt><dd data-f="live">—</dd>' +
    '<dt>fps</dt><dd data-f="fps">—</dd>' +
    '<dt>peak</dt><dd data-f="peak">—</dd>' +
    '<dt>wind</dt><dd data-f="wind">—</dd>' +
    '<dt>vort</dt><dd data-f="vort">—</dd>' +
    '<dt>visc</dt><dd data-f="visc">—</dd>' +
    '<dt>iter</dt><dd data-f="iter">—</dd>' +
    '<dt>solids</dt><dd data-f="solids">—</dd>' +
    '<dt>bodies</dt><dd data-f="bodies">—</dd>' +
    '<dt>palette</dt><dd data-f="pal">—</dd>' +
    '</dl>' +
    '<p class="sp-note">every number is read off the solver. drag this ' +
    'window — it is one of the bodies.</p>';
  return d;
}

function updateSolverBody(body) {
  const set = (k, v) => {
    const el = body.querySelector('[data-f="' + k + '"]');
    if (el && el.textContent !== v) el.textContent = v;
  };
  set('grid', COLS + ' × ' + ROWS);
  set('live', String(liveCells));
  set('fps', String(hudFps()));
  set('peak', peakSpeed.toFixed(3));
  set('wind', windLevel().toFixed(2));
  set('vort', P.vort.toFixed(1));
  set('visc', P.visc.toExponential(1));
  set('iter', String(P.iter));
  set('solids', P.solids ? 'on' : 'off');
  set('bodies', String(solidEls.filter(e => e && e.isConnected).length));
  set('pal', P.palette);
}

function buildDetailBody(arg) {
  const d = document.createElement('div');
  d.className = 'sp-body';
  const spec = DETAILS[arg];
  if (!spec) { d.textContent = 'no detail for ' + arg; return d; }

  const h = document.createElement('div');
  h.className = 'sp-head';
  h.textContent = spec.head;
  const s = document.createElement('div');
  s.className = 'sp-sub';
  s.textContent = spec.sub;
  d.appendChild(h); d.appendChild(s);

  const dl = document.createElement('dl');
  dl.className = 'sp-kv';
  spec.body.forEach(([k, v]) => {
    const dt = document.createElement('dt'); dt.textContent = k;
    const dd = document.createElement('dd'); dd.textContent = v;
    dl.appendChild(dt); dl.appendChild(dd);
  });
  d.appendChild(dl);
  return d;
}

/* Keep the habitat small: a summary, feeding control, fixed outlet and one
   event line. The simulation owns the detailed counters, not the window. */
function buildLifeBody() {
  const d = document.createElement('div');
  d.className = 'sp-body sp-life';
  d.innerHTML =
    '<p class="sp-life-summary"><span data-f="pop">—</span> alive · ' +
    '<span data-f="eggs">—</span> eggs · <span data-f="adrift">—</span> food</p>' +
    '<div class="sp-life-controls"><button class="sp-vent" type="button">Hold to feed</button>' +
    '<label class="sp-outlet-picker"><span class="sr-only">Food outlet</span>' +
    '<select aria-label="Food outlet">' +
    '<option value="left">Out: left ←</option><option value="right">Out: right →</option>' +
    '<option value="top">Out: top ↑</option><option value="bottom">Out: bottom ↓</option>' +
    '</select></label></div>' +
    '<p class="sp-life-status" role="status" aria-live="polite" data-f="status"></p>' +
    '<p class="sp-life-key" title="&lt;&gt; forage and scavenge; {} graze. + meal, * hatch, ! bite.">&lt;&gt; forage · {} graze · @ steals<br>o egg · x remains</p>';

  const outlet = d.querySelector('.sp-outlet-picker select');
  outlet.addEventListener('change', () => {
    lifeSetOutletSide(outlet.value);
    updateLifeBody(d);
  });

  /* Hold to keep venting. The pointer events are stopped here rather than
     allowed to bubble: the document-level mouse handler injects velocity
     wherever it fires, and a control that stirred the tank every time you
     used it would be the same design mistake this rewrite is undoing. */
  const vent = d.querySelector('.sp-vent');
  const stop = e => e.stopPropagation();
  const start = () => {
    if (packetLife.venting) return;
    packetLifeRelease(performance.now());
    packetLifeSetVenting(true);
    updateLifeBody(d);
  };
  const release = () => {
    packetLifeSetVenting(false);
    updateLifeBody(d);
  };
  vent.addEventListener('mousedown', stop);
  vent.addEventListener('pointerdown', e => {
    stop(e);
    if (e.button !== 0) return;
    vent.setPointerCapture(e.pointerId);
    start();
  });
  vent.addEventListener('pointerup', release);
  vent.addEventListener('pointercancel', release);
  vent.addEventListener('lostpointercapture', release);
  vent.addEventListener('blur', release);
  vent.addEventListener('keydown', e => {
    if (e.key !== ' ' && e.key !== 'Enter') return;
    e.preventDefault();
    stop(e);
    if (!e.repeat) start();
  });
  vent.addEventListener('keyup', e => {
    if (e.key !== ' ' && e.key !== 'Enter') return;
    e.preventDefault();
    release();
  });
  // Assistive technology can activate a button without pointer/key events.
  vent.addEventListener('click', e => {
    stop(e);
    if (e.detail === 0 && !packetLife.venting) {
      packetLifeRelease(performance.now());
      updateLifeBody(d);
    }
  });

  return d;
}

function updateLifeBody(body) {
  const s = lifeStats();
  const set = (k, v) => {
    const el = body.querySelector('[data-f="' + k + '"]');
    if (el && el.textContent !== v) el.textContent = v;
  };
  set('pop', String(s.pop));
  set('eggs', String(s.eggs));
  const hunterState = s.hunterState === 'chasing' ? '@ chasing prey'
    : s.hunterState === 'feeding' ? '@ eating stolen food'
    : s.hunterState === 'resting' ? '@ resting after a bite'
    : s.hunterState === 'searching' ? '@ seeking fed prey' : 'none — recovering';
  set('adrift', String(s.adrift));
  const outlet = lifeVentCell();
  const picker = body.querySelector('.sp-outlet-picker select');
  if (picker.value !== packetLife.outletSide) picker.value = packetLife.outletSide;
  picker.title = outlet ? 'Food outlet' : 'Outlet blocked — choose another side or move the panel';
  const importantEvent = performance.now() < packetLife.eventUntil && packetLife.eventPriority >= 2;
  const status = importantEvent ? packetLife.lastEvent : !outlet ? 'Outlet blocked — choose another side or move the panel.' : packetLife.venting
    ? (s.adrift >= LIFE_MAX_FOOD ? 'Food limit reached — let them eat.' : 'Feeding… guide the dots toward a creature.')
    : performance.now() < packetLife.eventUntil ? packetLife.lastEvent
    : hunterState + '. Hold to feed.';
  set('status', status);
  const vent = body.querySelector('.sp-vent');
  const label = packetLife.venting ? 'Release to stop' : 'Hold to feed';
  if (vent.textContent !== label) vent.textContent = label;
  vent.classList.toggle('is-feeding', packetLife.venting);
}

/* ── open / close ─────────────────────────────────────────────────────── */
function panelKey(id, arg) { return arg ? id + ':' + arg : id; }

/* Why the last openPanel() refused, so the console can say something better
   than "no such panel" when a panel exists but can't run here. */
let lastPanelError = '';

function openPanel(id, arg) {
  const def = PANEL_DEFS[id];
  lastPanelError = '';
  if (!def) return false;

  if (def.guard) {
    const why = def.guard();
    if (why) { lastPanelError = why; return false; }
  }

  const key = panelKey(id, arg);
  if (openPanels.has(key)) { focusPanel(key); return true; }

  const el = document.createElement('section');
  el.className = 'subpanel';
  el.dataset.panel = key;

  const bar = document.createElement('div');
  bar.className = 'sp-bar';
  const t = document.createElement('span');
  t.className = 'sp-title';
  t.textContent = def.title + (arg ? ' / ' + arg : '');
  const x = document.createElement('button');
  x.className = 'sp-x';
  x.type = 'button';
  x.setAttribute('aria-label', 'Close ' + def.title);
  x.textContent = '×';
  x.addEventListener('click', e => { e.stopPropagation(); closePanel(key); });
  bar.appendChild(t); bar.appendChild(x);

  const body = def.build(arg);
  el.appendChild(bar); el.appendChild(body);

  place(el, def);
  document.body.appendChild(el);

  makeDraggable(el, bar, key);
  el.addEventListener('pointerdown', () => focusPanel(key));

  openPanels.set(key, { el, def, body });

  /* The new panel is a new bluff body. Register before restamping or the
     mask won't know about it until something else moves. */
  registerSolid(el);
  rebuildSolids();

  /* After the mask, because a panel that owns something in the field wants
     to see the field with itself already in it — the habitat picks its vent
     face by reading the flow around its own body. */
  if (def.open) def.open(el, body);
  if (def.live) def.live(body);
  return true;
}

function closePanel(key) {
  const p = openPanels.get(key);
  if (!p) return false;
  if (p.def.close) p.def.close(p.el, p.body);
  unregisterSolid(p.el);
  p.el.remove();
  openPanels.delete(key);
  if (!openPanels.size) _cascade = 0;
  rebuildSolids();                       // the wake behind it collapses on its own
  return true;
}

function closeAllPanels() {
  Array.from(openPanels.keys()).forEach(closePanel);
}

function focusPanel(key) {
  const p = openPanels.get(key);
  if (p) p.el.style.zIndex = String(++_zTop);
}

/* Open into the right half, downstream of the main panel, so a new body
   lands where the wake already is and you see it break. */
function place(el, def) {
  if (isNarrow()) return;                // CSS puts it over the main panel

  const pr = panelEl ? panelEl.getBoundingClientRect() : { right: 80, top: 80 };
  const w = Math.max(def.minW || SUB_MIN_W, def.w);
  const h = def.h;
  const step = _cascade++ * 28;

  let left = pr.right + 64 + step;
  let top  = pr.top + 40 + step;
  left = Math.min(left, window.innerWidth - w - 20);
  top  = Math.min(top, window.innerHeight - h - 20);

  el.style.left = Math.max(12, left) + 'px';
  el.style.top  = Math.max(12, top) + 'px';
  el.style.width = w + 'px';
  el.style.height = h + 'px';
}

/* ── drag ─────────────────────────────────────────────────────────────── */
function makeDraggable(el, handle, key) {
  if (isNarrow()) return;

  let dx = 0, dy = 0;

  const move = e => {
    el.style.left = (e.clientX - dx) + 'px';
    el.style.top  = (e.clientY - dy) + 'px';
    // The main loop restamps before simulation and drawing. A separate rAF
    // callback could run after the loop and leave life under the old mask.
    markSolidsDirty();
  };

  const up = e => {
    handle.releasePointerCapture(e.pointerId);
    handle.removeEventListener('pointermove', move);
    handle.removeEventListener('pointerup', up);
    handle.removeEventListener('pointercancel', up);
    clampIntoView(el);
    rebuildSolids();
    el.classList.remove('is-drag');
  };

  handle.addEventListener('pointerdown', e => {
    if (e.button !== 0 || e.target.closest('.sp-x')) return;
    e.preventDefault();
    focusPanel(key);
    const r = el.getBoundingClientRect();
    dx = e.clientX - r.left;
    dy = e.clientY - r.top;
    el.classList.add('is-drag');
    handle.setPointerCapture(e.pointerId);
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
    handle.addEventListener('pointercancel', up);
  });
}

function clampIntoView(el) {
  const r = el.getBoundingClientRect();
  const l = Math.min(Math.max(4, r.left), window.innerWidth - 60);
  const t = Math.min(Math.max(0, r.top), window.innerHeight - 40);
  el.style.left = l + 'px';
  el.style.top = t + 'px';
}

/* ── tick ─────────────────────────────────────────────────────────────── */
function panelsFrame(now) {
  if (!openPanels.size) return;
  if (now - _spLast < 1000 / SUB_FPS) return;
  _spLast = now;
  openPanels.forEach(p => { if (p.def.live) p.def.live(p.body); });
}

function listOpenPanels() { return Array.from(openPanels.keys()); }

/* ── wiring ───────────────────────────────────────────────────────────── */
document.addEventListener('click', e => {
  const t = e.target.closest('[data-detail]');
  if (t) openPanel('detail', t.dataset.detail);
});

/* They're spans with role=button, so they have to answer the keyboard too. */
document.addEventListener('keydown', e => {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  const t = e.target.closest && e.target.closest('[data-detail]');
  if (!t) return;
  e.preventDefault();
  openPanel('detail', t.dataset.detail);
});

/* Escape closes the top window — the fastest way back to a clear field. */
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape' || !openPanels.size) return;
  const el = document.activeElement;
  if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) return;
  const keys = listOpenPanels();
  closePanel(keys[keys.length - 1]);
});

window.addEventListener('resize', () => {
  openPanels.forEach(p => clampIntoView(p.el));
  rebuildSolids();
});
