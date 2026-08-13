/* render.js — density and velocity into coloured characters.

   Default palette is `flow`: hue from velocity direction, the same encoding
   the original used and the same one optical-flow fields are conventionally
   drawn with (the Middlebury colour wheel) — direction around the wheel,
   energy in the brightness. The ramp palettes below are alternates, not
   replacements.

   One thing that did change: colours come out of a lookup table. Building an
   `hsla(...)` string per cell per frame meant ~16k string allocations every
   frame; now it's a quantised index into pre-built strings, and fillStyle is
   only touched when the index actually changes. */

const CHARS = " .'`^\",:;Il!i><~+_-?][}{1)(|/tfjrxnuvczXYUJCLQ0OZmwqpdbkhao*#MW&8%B@$".split('');
const BG = '#05060c';

const RAMPS = {
  thermal: [[8, 14, 44], [22, 72, 168], [64, 178, 214], [168, 235, 240], [255, 250, 232]],
  ember:   [[26, 6, 4], [122, 22, 10], [224, 74, 16], [255, 156, 44], [255, 238, 190]],
  mono:    [[18, 20, 26], [74, 80, 92], [146, 154, 168], [212, 219, 232], [255, 255, 255]]
};
const PALETTES = ['flow', 'thermal', 'ember', 'mono'];

/* Resolution high enough that quantising can't band the hue wheel — 5° of
   hue and ~3% of brightness. Built once, so the size costs nothing. */
const LUT_T = 72, LUT_B = 32;
let LUT = null, LUT_BY_DIR = true;

function hsl2rgb(h, s, l) {
  h /= 360;
  const f = n => {
    const k = (n + h * 12) % 12;
    const a = s * Math.min(l, 1 - l);
    return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))));
  };
  return [f(0), f(8), f(4)];
}

function rampAt(stops, t) {
  const x = t * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(x));
  const f = x - i, a = stops[i], b = stops[i + 1];
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
}

function buildPalette(name) {
  if (!PALETTES.includes(name)) name = 'flow';
  P.palette = name;
  LUT_BY_DIR = (name === 'flow');
  LUT = new Array(LUT_T * LUT_B);

  for (let ti = 0; ti < LUT_T; ti++) {
    const t = ti / (LUT_T - 1);
    for (let bi = 0; bi < LUT_B; bi++) {
      const b = bi / (LUT_B - 1);
      let rgb;
      if (LUT_BY_DIR) {
        /* HSL lightness, not a multiply — that's what makes the fast cores
           wash out to white instead of just getting a brighter hue. */
        rgb = hsl2rgb(t * 360, P.sat, b * P.lum);
      } else {
        const base = rampAt(RAMPS[name], t);
        const m = Math.pow(b, 1.18);
        rgb = [base[0] * m, base[1] * m, base[2] * m];
      }
      LUT[ti * LUT_B + bi] = 'rgb(' + (rgb[0] | 0) + ',' + (rgb[1] | 0) + ',' + (rgb[2] | 0) + ')';
    }
  }
}
buildPalette(P.palette);

function computeCurl() {
  for (let j = 1; j < ROWS - 1; j++) {
    for (let i = 1; i < COLS - 1; i++) {
      const id = ix(i, j);
      renderCurl[id] = solid[id] ? 0 : Math.abs(
        (vy[id + 1] - vy[id - 1]) * 0.5 - (vx[id + COLS] - vx[id - COLS]) * 0.5
      );
    }
  }
}

/* Live counters for the HUD. */
let liveCells = 0, peakSpeed = 0;

function render() {
  computeCurl();
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, COLS * CW, ROWS * CH);

  const nChars1 = CHARS.length - 1;
  let lastKey = -1, live = 0, peak = 0;

  for (let j = 0; j < ROWS; j++) {
    const py = j * CH, row = j * COLS;
    for (let i = 0; i < COLS; i++) {
      const id = row + i;
      if (solid[id]) continue;

      const d = dens[id], a = vx[id], b = vy[id];
      const spd = Math.sqrt(a * a + b * b);
      if (d < 0.003 && spd < 0.004) continue;
      live++;
      if (spd > peak) peak = spd;
      const wrl = renderCurl[id];

      let ti, br;
      if (LUT_BY_DIR) {
        let h = Math.atan2(b, a);
        if (h < 0) h += 6.283185307;
        ti = (h * (LUT_T / 6.283185307)) | 0;
        if (ti >= LUT_T) ti = LUT_T - 1;
        /* Original lightness and alpha, folded into one brightness index —
           on a near-black background, fading a colour and darkening it are
           the same thing. */
        const L = Math.min(12 + d * 65 + spd * 22 + wrl * 50, 92) / 92;
        const alpha = Math.min(Math.pow(d * 2.8 + spd * 0.8, 1.25), 1);
        br = L * alpha;
      } else {
        const k = spd * 22 + wrl * 46;
        ti = ((k / (1 + k)) * (LUT_T - 1) + 0.5) | 0;
        const m = d * 1.7 + spd * 0.8;
        br = (m / (1 + m)) * 1.16;
      }
      if (br > 1) br = 1;

      const key = ti * LUT_B + ((br * (LUT_B - 1) + 0.5) | 0);
      if (key !== lastKey) { ctx.fillStyle = LUT[key]; lastKey = key; }

      let fill = Math.min(d * 2.5 + spd * 0.35, 1.0);
      fill = Math.pow(fill, 1.1);
      const ci = Math.max(1, Math.min((fill * CHARS.length) | 0, nChars1));
      ctx.fillText(CHARS[ci], i * CW, py);
    }
  }
  liveCells = live;
  peakSpeed = peak;
}
