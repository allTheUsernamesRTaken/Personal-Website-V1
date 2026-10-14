/* loop.js — the animation loop.

   Life and sources advance at 60 Hz, the fluid at 30 Hz, independently of
   display refresh. Rendering still follows rAF. Catch-up is bounded so a
   stalled or backgrounded tab cannot queue seconds of solver work. */

let _frame = 0;
let _origin = 0;
let _lastFrame = null;
let _simAcc = 0;
let _simTick = 0;
const SIM_TICK_MS = 1000 / SIM_HZ;
const MAX_SIM_TICKS = 6;

function loop(now) {
  _frame++;
  flushSolids();
  const elapsed = _lastFrame === null ? 0 : Math.max(0, now - _lastFrame);
  _lastFrame = now;
  // A long suspension is a pause, rather than a burst of catch-up on return.
  _simAcc += elapsed > 250 ? 0 : Math.min(elapsed, SIM_TICK_MS * MAX_SIM_TICKS);
  let ticks = 0;
  while (_simAcc + 1e-6 >= SIM_TICK_MS && ticks < MAX_SIM_TICKS) {
    _simAcc = Math.max(0, _simAcc - SIM_TICK_MS);
    const tickNow = now - _simAcc;
    _simTick++;
    if (_simTick % (SIM_HZ / SOLVER_HZ) === 0) step((tickNow - _origin) / 1000);
    introFrame(tickNow);
    packetLifeUpdate(1 / SIM_HZ, tickNow);
    ticks++;
  }
  render();
  packetLifeRender();
  charFrameFrame(now);      // no-op unless a character-frame skin is on
  tickFrame(now);           // no-op unless night's corner ticks are on
  glassFrame(now);          // no-op unless glass is on
  panelsFrame(now);         // no-op unless a live subpanel is open
  hudFrame(now);
  requestAnimationFrame(loop);
}

/* Solver time, for anything outside the loop that needs to line up with it
   — the console firing a gust, mostly. */
function simNow() { return (performance.now() - _origin) / 1000; }

function boot(now) {
  _origin = now;
  _lastFrame = now;
  rebuildSolids();       // needs layout, so after first paint
  charFrameSync();       // ditto — it measures the panel before snapping it
  tickSync();            // after charFrameSync: that can move the panel
  glassSync();           // ditto — it measures the panel's final rect
  introSequence();
  requestAnimationFrame(loop);
}

document.addEventListener('visibilitychange', () => {
  _lastFrame = null;
  _simAcc = 0;
  packetLifeSetVenting(false);
});
window.addEventListener('blur', () => packetLifeSetVenting(false));

requestAnimationFrame(boot);
