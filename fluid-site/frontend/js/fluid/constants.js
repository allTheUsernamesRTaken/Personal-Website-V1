/* constants.js — grid, buffers, tunables.
   Loads first. Everything else reads the arrays allocated here. */

const REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/* Live parameters. The console writes to these, so they're a mutable
   object instead of the consts this used to be. */
const P = {
  injRadius : 3,
  injDens   : 3.5,
  injVel    : 6.0,
  visc      : 0.00008,
  diff      : 0.00004,
  fade      : 0.998,
  velDamp   : 0.9998,
  vort      : 6.0,
  iter      : 16,
  dt        : 0.16,
  wind      : 0,                   // ambient current — off. see ambient.js
  solids    : true,                // panel is a solid body in the flow
  palette   : 'flow'
};

const DEFAULTS = Object.assign({}, P);

/* Cell size in CSS px. Smaller on phones: at 11px a 390px screen is only 35
   columns, which is too coarse for the smoke to read as smoke. */
let CW = 11, CH = 12;

const canvas = document.getElementById('c');
const ctx    = canvas.getContext('2d', { alpha: false });

/* Sized in allocGrid(), rebuilt on resize. */
let COLS = 0, ROWS = 0, N = 0;
let vx, vy, vx0, vy0, dens, dens0, solid, curlBuf, renderCurl;

/* Share Tech Mono has no box-drawing coverage, so the sim glyphs and the
   ASCII name both need a stack that actually ships them. */
const MONO = 'ui-monospace, "Cascadia Mono", Consolas, "DejaVu Sans Mono", Menlo, monospace';

function allocGrid() {
  const narrow = window.innerWidth < 760;   // matches the CSS breakpoint
  CW = narrow ? 8 : 11;
  CH = narrow ? 9 : 12;

  COLS = Math.max(32, Math.min(Math.floor(window.innerWidth  / CW), 220));
  ROWS = Math.max(20, Math.min(Math.floor(window.innerHeight / CH), 140));
  N    = COLS * ROWS;

  vx = new Float32Array(N);  vy  = new Float32Array(N);
  vx0 = new Float32Array(N); vy0 = new Float32Array(N);
  dens = new Float32Array(N); dens0 = new Float32Array(N);
  solid      = new Uint8Array(N);
  curlBuf    = new Float32Array(N);
  renderCurl = new Float32Array(N);

  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width  = Math.round(COLS * CW * dpr);
  canvas.height = Math.round(ROWS * CH * dpr);
  // Display size is left to the stylesheet so the dvh rule there wins on
  // phones; getCell() reads the real rect, so input stays correct either way.

  // Resizing the backing store resets context state, so re-apply it here.
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.font = `${CW + 2}px ${MONO}`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
}

allocGrid();
