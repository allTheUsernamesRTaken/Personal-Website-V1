/* loop.js — the animation loop.

   Physics every other frame, draw every frame. Half for speed, half because
   it looked better that way. rAF parks itself when the tab is hidden, so a
   backgrounded page costs nothing. */

let _frame = 0;
let _origin = 0;
let _lifeLast = 0;

function loop(now) {
  _frame++;
  if (_frame % 2 === 0) step((now - _origin) / 1000);
  introFrame(now);
  packetLifeUpdate(_lifeLast ? (now - _lifeLast) / 1000 : 0, now);
  render();
  packetLifeRender();
  _lifeLast = now;
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
  rebuildSolids();       // needs layout, so after first paint
  charFrameSync();       // ditto — it measures the panel before snapping it
  tickSync();            // after charFrameSync: that can move the panel
  glassSync();           // ditto — it measures the panel's final rect
  introSequence();
  requestAnimationFrame(loop);
}

requestAnimationFrame(boot);
