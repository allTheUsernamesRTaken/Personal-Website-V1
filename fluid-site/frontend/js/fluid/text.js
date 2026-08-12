/* text.js — rasterise a string straight into the density field.

   Draw the text into an offscreen canvas at exactly grid resolution, read
   the alpha channel back, and use it as a smoke deposit. The letters come
   out made of fluid, so the current starts pulling them apart the moment
   they exist. Drives the `echo` command.

   It used to drive the intro too. See intro.js for why it doesn't. */

const _tCanvas = document.createElement('canvas');
const _tCtx    = _tCanvas.getContext('2d', { willReadFrequently: true });

/* Biggest chunk of screen the panel isn't occupying. Stamping into solid
   cells is stamping into nothing, so aim at the wake instead. */
function freeRegion() {
  if (!panelEl || !P.solids) return { cx: 0.5, cy: 0.46, w: 0.52, h: 1 };
  const w = window.innerWidth, h = window.innerHeight;
  const r = panelEl.getBoundingClientRect();
  const boxes = [
    { x0: 0, x1: r.left / w, y0: 0, y1: 1 },              // left of panel
    { x0: r.right / w, x1: 1, y0: 0, y1: 1 },             // downstream
    { x0: 0, x1: 1, y0: 0, y1: r.top / h },               // above
    { x0: 0, x1: 1, y0: r.bottom / h, y1: 1 }             // below
  ];
  let best = boxes[1], bestA = -1;
  for (const b of boxes) {
    const a = (b.x1 - b.x0) * (b.y1 - b.y0);
    if (a > bestA) { bestA = a; best = b; }
  }
  return {
    cx: (best.x0 + best.x1) / 2,
    cy: (best.y0 + best.y1) / 2,
    w:  Math.max(0.16, (best.x1 - best.x0) * 0.86),
    h:  Math.max(0.04, (best.y1 - best.y0))
  };
}

function stampText(str, opts) {
  str = (str || '').trim().slice(0, 42);
  if (!str || !N) return;

  const o     = opts || {};
  const power = o.power || 7.5;
  const lift  = o.lift === undefined ? 0.9 : o.lift;
  const reg   = freeRegion();
  const cx    = o.cx === undefined ? reg.cx : o.cx;
  const cy    = o.cy === undefined ? reg.cy : o.cy;

  _tCanvas.width = COLS; _tCanvas.height = ROWS;
  _tCtx.clearRect(0, 0, COLS, ROWS);
  _tCtx.fillStyle = '#fff';
  _tCtx.textAlign = 'center';
  _tCtx.textBaseline = 'middle';

  const maxW = COLS * reg.w;
  const maxH = ROWS * reg.h * 0.7;
  let size = Math.min(Math.floor(ROWS * 0.34), Math.max(5, Math.floor(maxH)));
  for (; size > 4; size--) {
    _tCtx.font = `bold ${size}px ${MONO}`;
    if (_tCtx.measureText(str).width <= maxW) break;
  }
  _tCtx.fillText(str, COLS * cx, ROWS * cy);

  const px = _tCtx.getImageData(0, 0, COLS, ROWS).data;
  for (let j = 1; j < ROWS - 1; j++) {
    for (let i = 1; i < COLS - 1; i++) {
      const a = px[(j * COLS + i) * 4 + 3];
      if (a < 36) continue;
      const id = ix(i, j);
      if (solid[id]) continue;
      const f = a / 255;
      dens0[id] += power * f;
      vy0[id]   -= lift * f;
      vx0[id]   += (Math.random() - 0.5) * 0.55 * f;
    }
  }
}
