/* loop.js — the animation loop.

   Physics every other frame, draw every frame. Half for speed, half because
   it looked better that way. rAF parks itself when the tab is hidden, so a
   backgrounded page costs nothing. */

let _frame = 0;
let _origin = 0;

function loop(now) {
  _frame++;
  if (_frame % 2 === 0) step((now - _origin) / 1000);
  render();
  hudFrame(now);
  requestAnimationFrame(loop);
}

function boot(now) {
  _origin = now;
  rebuildSolids();       // needs layout, so after first paint
  introSequence();
  requestAnimationFrame(loop);
}

requestAnimationFrame(boot);
