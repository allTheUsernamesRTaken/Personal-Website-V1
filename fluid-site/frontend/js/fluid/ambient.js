/* ambient.js — optional steady current. OFF by default (P.wind = 0);
   `wind 1` in the console turns it on.

   It exists to demo flow past a bluff body: with the panel solid, a uniform
   stream splits at the leading edge and sheds a vortex street off the back.
   It is not the default look, because a permanent body force fills every
   cell with velocity and the field never decays back to black — you lose the
   wisps, which is the whole character of the thing.

   Nothing else depends on this file. Delete it and the matching <script>
   tag and the site is unchanged apart from losing the `wind` command. */

let windAngle = 0;

function ambientForce(t) {
  if (P.wind <= 0) return;

  // Direction wanders a few degrees so the wake never settles into a loop.
  windAngle = 0.20 * Math.sin(t * 0.031) + 0.09 * Math.sin(t * 0.011 + 1.7);

  const mag = P.wind * 0.010;
  const tx = mag * Math.cos(windAngle);
  const ty = mag * Math.sin(windAngle);
  const k = 0.004;
  for (let n = 0; n < N; n++) {
    if (solid[n]) continue;
    vx[n] += (tx - vx[n]) * k;
    vy[n] += (ty - vy[n]) * k;
  }
}

const PLUMES = [
  { y: 0.24, rate: 0.083, phase: 0.0 },
  { y: 0.54, rate: 0.051, phase: 2.1 },
  { y: 0.79, rate: 0.115, phase: 4.4 }
];

/* Smoke is emitted every step, so the deposit has to be small — at fade
   0.998 a cell only sheds 0.2% of what it holds per step. */
function ambientInflow(t) {
  if (P.wind <= 0) return;
  for (const pl of PLUMES) {
    const y  = pl.y + 0.13 * Math.sin(t * pl.rate * 6 + pl.phase);
    emit(2, Math.round(y * ROWS), 4, 3.0 * P.wind, 0.30 * P.wind, 0);
  }
}
