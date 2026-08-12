/* intro.js — what the page does before you touch it.

   An implosion, in the middle of whatever part of the screen the panel
   isn't using. A ring of smoke closes to a point over a second and a half,
   lands as a bright core, and detonates outward once.

   The obvious way to build this does not work, and it's worth knowing why
   before changing anything here. Two separate walls:

   An incompressible velocity field cannot concentrate a passive scalar.
   Advection by a divergence-free field rearranges density values without
   ever raising the peak, so no arrangement of forcing will pull smoke into
   a bright core. Measured across the parameter space, mass inside the core
   pinned at the uniform-distribution value every time — 12-14%, whatever
   the jets did.

   And any *sustained* forcing floods the field. project() is an elliptic
   solve, so pressure propagates across the whole grid every step; a ring of
   jets firing for a couple of seconds puts 70-88% of the field under smoke,
   which is the flat washed-out look this intro exists to avoid. At a sixth
   of the injection strength it was still 71%. Cutting injected velocity to
   zero is what holds it near 45%.

   So the convergence comes from where the smoke is *put*, not from where
   the fluid pushes it: the emission ring itself shrinks. That reads as an
   implosion because it is one, and it leaves the field quiet enough that
   the single burst at the end actually registers instead of vanishing into
   an already-saturated screen.

   What this replaced: a version that stamped DANIEL GUO into the density
   field. The name is already six lines of block ASCII a hundred pixels to
   the left, so the smoke was repeating something the reader could see
   perfectly well — and losing, because at this grid size ten characters
   gives each letter about ten cells of width, which is one stroke thick and
   mush on contact. A stamp is also at its most legible on the frame it
   lands and decays from there, so its one readable moment was the moment
   nobody was looking yet. An implosion runs the other way: it starts spread
   out and *resolves*, peaking a second and a half in, which is about when
   attention actually arrives. */

const INTRO_DELAY = 300;               // ms of black before it starts

/* If nothing has been touched by the time it clears, the visitor probably
   hasn't worked out that the background is theirs to push. One stroke says
   so. It gives up after a few tries rather than nagging. */
const HINT_FIRST  = 10000;             // ms after boot
const HINT_REPEAT = 20000;
const HINT_MAX    = 3;

let userHasTouched = false;
let _hintsShown = 0;
let _hintTimer  = 0;
let _stroke     = null;
let _impl       = null;

/* input.js calls this on any pointer activity over the background. It
   cancels the hint only — the implosion plays regardless, see below. */
function noteUserInput() {
  if (userHasTouched) return;
  userHasTouched = true;
  clearTimeout(_hintTimer);
  _stroke = null;
}

/* The implosion is unconditional. It used to be skipped if the pointer had
   moved during the 300ms lead-in, on the theory that we shouldn't hijack
   someone already interacting — but a visitor arrives by clicking a link,
   so their cursor is usually sitting over the page already and one pixel of
   drift killed the whole intro before it started.

   The theory was wrong anyway. Input and the intro aren't in competition:
   both just deposit into the same field, so smoke pushed during the
   collapse composes with it. Someone testing whether the background reacts
   during the opening is the best possible moment for it to react. */
function introSequence() {
  if (REDUCED) return;
  setTimeout(() => startImplosion(performance.now()), INTRO_DELAY);
  _hintTimer = setTimeout(runHint, HINT_FIRST);
}

function runHint() {
  if (userHasTouched || _hintsShown >= HINT_MAX) return;
  startGhostStroke();
  _hintsShown++;
  if (_hintsShown < HINT_MAX) _hintTimer = setTimeout(runHint, HINT_REPEAT);
}

/* ── the implosion ────────────────────────────────────────────────── */

const IMPL_COLLAPSE = 1.50;            // seconds — ring closes to a point
const IMPL_JETS     = 28;              // enough to read as a continuous ring
const IMPL_SPIN     = 0.85;            // rad/s the ring turns as it closes

/* Smoke only — the emits below pass zero velocity. See the top of the file
   for why that isn't a stylistic choice. */
function startImplosion(now) {
  if (!N) return;
  // freeRegion() finds the biggest slab of screen the panel isn't using.
  // Centring on the viewport would put this behind the panel.
  const reg = freeRegion();
  _impl = {
    t0: now,
    ci: reg.cx * COLS,
    cj: reg.cy * ROWS,
    // Capped against the grid width as well as the region: on a phone the
    // free band is nearly the whole viewport, and a ring scaled only to the
    // region ends up 35 of 48 columns across — everything it lays down
    // overlaps and it smears instead of reading as a ring.
    r0: Math.min(reg.w * COLS, reg.h * ROWS, COLS * 0.62) * 0.42,
    fired: false
  };
}

function implosionFrame(now) {
  if (!_impl) return;

  const e = (now - _impl.t0) / 1000;

  /* The payoff. All the motion arrives here as a single event rather than
     as forcing spread over seconds, which is why it blooms instead of
     flooding — and the fluid takes it from here.

     Not burstAt(): that fires sixty overlapping emits into one cell, which
     took the peak density from 3.7 to 72 and left the screen smeared white
     for a minute and a half afterwards. This one carries almost no smoke.
     Its whole job is velocity — the ring already laid down the smoke, the
     burst only needs to throw it outward. */
  if (e >= IMPL_COLLAPSE) {
    if (!_impl.fired) {
      const ci = Math.round(_impl.ci), cj = Math.round(_impl.cj);
      // Scaled to the ring, not fixed: a phone's grid is 48 columns to a
      // desktop's 130, and a pulse sized for the desktop washes the whole
      // narrow screen out instead of blooming inside it.
      const s = P.injVel * 0.6 * Math.min(1, _impl.r0 / 26);
      for (let a = 0; a < 360; a += 15) {
        const r = a * Math.PI / 180;
        emit(ci, cj, 4, 0.18, Math.cos(r) * s, Math.sin(r) * s);
      }
      _impl.fired = true;
    }
    _impl = null;
    return;
  }

  const u   = e / IMPL_COLLAPSE;
  const rad = _impl.r0 * (1 - Math.pow(u, 0.85));
  // Emission eases off as the ring lands, so the core arrives as a bloom
  // rather than a hard dot.
  const env = Math.min(1, (1 - u) * 3.2);
  const spin = e * IMPL_SPIN;

  for (let k = 0; k < IMPL_JETS; k++) {
    const a = (k / IMPL_JETS) * 6.283185307 + spin;
    emit(Math.round(_impl.ci + Math.cos(a) * rad),
         Math.round(_impl.cj + Math.sin(a) * rad),
         2, 1.7 * env, 0, 0);
  }
}

/* ── the ghost stroke ─────────────────────────────────────────────── */

/* Drawn, not stamped. It goes down the same emit() path a real cursor does,
   one segment per frame, so what the visitor sees is exactly what their own
   hand would produce. A stroke laid down over time also stays crisp at its
   head while its tail is already coming apart — which is why it stays
   readable in a medium that eats anything stamped all at once. */
const STROKE_MS = 1250;

/* Wherever the panel isn't. On a phone the panel spans the width and is
   anchored to the bottom, so the lane is the band across the top instead. */
function strokePath() {
  if (!panelEl) return { x0: 0.5, x1: 0.94, yc: 0.5 };

  const r = panelEl.getBoundingClientRect();
  const rightGap = 1 - r.right / window.innerWidth;
  const topGap   = r.top / window.innerHeight;

  if (rightGap > 0.16) {
    return { x0: r.right / window.innerWidth + 0.05, x1: 0.95, yc: 0.5 };
  }
  if (topGap > 0.16) {
    return { x0: 0.10, x1: 0.90, yc: topGap * 0.55 };
  }
  return null;                          // nowhere worth drawing
}

function startGhostStroke() {
  const p = strokePath();
  if (!p || !N) return;
  _stroke = { p, t0: performance.now(), prevI: -1, prevJ: -1 };
}

/* Every frame, from the loop. */
function introFrame(now) {
  implosionFrame(now);
  if (!_stroke) return;

  const u = (now - _stroke.t0) / STROKE_MS;
  if (u >= 1) { _stroke = null; return; }

  // Ease both ends so it starts and stops like a hand, not a machine.
  const s = 0.5 * (1 - Math.cos(Math.PI * u));
  const p = _stroke.p;
  const ci = Math.round((p.x0 + (p.x1 - p.x0) * s) * COLS);
  const cj = Math.round((p.yc + 0.11 * Math.sin(s * Math.PI * 1.6 + 0.5)) * ROWS);

  if (_stroke.prevI >= 0) {
    const dvx = (ci - _stroke.prevI) * 2.8;
    const dvy = (cj - _stroke.prevJ) * 2.8;
    const spd = Math.sqrt(dvx * dvx + dvy * dvy);
    if (spd > 0.05) {
      // Slightly under a real cursor — a hint shouldn't upstage the thing
      // it's pointing at.
      const amt = P.injDens * 2.2 + spd * 1.0;
      emit(ci, cj, P.injRadius, amt,
           (dvx / spd) * P.injVel * 0.8, (dvy / spd) * P.injVel * 0.8);
    }
  }
  _stroke.prevI = ci; _stroke.prevJ = cj;
}
