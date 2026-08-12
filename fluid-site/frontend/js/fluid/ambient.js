/* ambient.js — the current, and the gust that drives the intro.

   A permanent body force is the wrong shape for this page. Every cell ends
   up holding velocity, the field never decays back to black, and you lose
   the wisps that are the whole character of the thing. So the default is a
   gust: ramp in, hold, release, gone. It reads as an event rather than a
   setting, which is also what someone clicking a button expects — and it
   leaves the tank empty when it's finished.

   Direction is down-and-right rather than straight across. The panel is
   left-anchored and 86vh tall, so a horizontal stream enters through the
   six-cell gutter between the screen edge and the panel and dead-ends
   against 86vh of solid; the open half of the viewport only ever saw what
   squeezed over the top. Coming in over the top edge instead puts the whole
   width into the inflow and makes the panel's top-right corner the shedding
   edge, with the open half downstream of it.

   P.wind is a sustained floor, off by default and still settable. gust()
   adds an envelope on top. windLevel() is the sum, and is what the solver
   and the HUD actually read. */

/* ── envelope ─────────────────────────────────────────────────────── */

const GUST_IN   = 2.0;                 // seconds — ramp up
const GUST_HOLD = 5.0;                 //           full strength
const GUST_OUT  = 3.5;                 //           ramp down
const GUST_LEN  = GUST_IN + GUST_HOLD + GUST_OUT;

const GUST = { t0: 0, peak: 0, active: false };

function gust(strength, t) {
  GUST.peak   = Math.max(0.2, Math.min(4, strength));
  GUST.t0     = t;
  GUST.active = true;
}

function cancelGust() { GUST.active = false; GUST.peak = 0; }

/* Cosine on both ends. A linear ramp reads as a switch being thrown; the
   ease is the difference between "wind turned on" and "a gust arrived". */
function gustEnvelope(t) {
  if (!GUST.active) return 0;
  const e = t - GUST.t0;
  if (e < 0) return 0;
  if (e >= GUST_LEN) { GUST.active = false; return 0; }
  if (e < GUST_IN) return GUST.peak * 0.5 * (1 - Math.cos(Math.PI * e / GUST_IN));
  const r = e - GUST_IN - GUST_HOLD;
  if (r <= 0) return GUST.peak;
  return GUST.peak * 0.5 * (1 + Math.cos(Math.PI * r / GUST_OUT));
}

/* Memoised on the timestamp so force and inflow can't disagree inside one
   step. Called with no argument (the HUD) it just reports the last value. */
let _levelT = -1, _level = 0;

function windLevel(t) {
  if (t === undefined) return _level;
  if (t !== _levelT) { _levelT = t; _level = P.wind + gustEnvelope(t); }
  return _level;
}

/* ── forcing ──────────────────────────────────────────────────────── */

const WIND_ANGLE = 0.44;               // ~25° — +y is down the screen
let windAngle = WIND_ANGLE;

function ambientForce(t) {
  const w = windLevel(t);
  if (w <= 0.001) return;

  // Direction wanders a few degrees so the wake never settles into a loop.
  windAngle = WIND_ANGLE
            + 0.16 * Math.sin(t * 0.031)
            + 0.07 * Math.sin(t * 0.011 + 1.7);

  const mag = w * 0.010;
  const tx = mag * Math.cos(windAngle);
  const ty = mag * Math.sin(windAngle);
  const k = 0.004;
  for (let n = 0; n < N; n++) {
    if (solid[n]) continue;
    vx[n] += (tx - vx[n]) * k;
    vy[n] += (ty - vy[n]) * k;
  }
}

/* Inlets along the top edge, spanning the full width. Smoke is emitted
   every step, so each deposit has to be small — at fade 0.998 a cell only
   sheds 0.2% of what it holds per step.

   ambientForce() runs immediately before this in step(), so windAngle is
   current by the time the inlets read it. */
const INLETS = 7;

function ambientInflow(t) {
  const w = windLevel(t);
  if (w <= 0.001) return;

  const dx = Math.cos(windAngle), dy = Math.sin(windAngle);
  for (let k = 0; k < INLETS; k++) {
    const f = k / (INLETS - 1);
    // Drift and breathe at a different rate per inlet, so the sheet is
    // uneven enough to roll up instead of arriving as a flat curtain.
    const x     = 0.08 + f * 0.88 + 0.025 * Math.sin(t * 0.27 + k * 1.9);
    const pulse = 0.65 + 0.35 * Math.sin(t * (0.31 + k * 0.043) + k * 2.4);
    emit(Math.round(x * COLS), 3, 4,
         2.4 * w * pulse, 0.34 * w * dx, 0.34 * w * dy);
  }
}
