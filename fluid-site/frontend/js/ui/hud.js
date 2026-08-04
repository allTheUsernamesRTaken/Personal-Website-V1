/* hud.js — telemetry, read straight off the solver.

   Not chrome for the sake of it: the numbers are the real grid size, the
   real count of cells carrying smoke this frame, and the real parameters
   the console is editing. */

const hudEl = document.getElementById('hud');

let _fps = 0, _fpsAcc = 0, _fpsT = 0;

function renderHud() {
  if (!hudEl) return;
  hudEl.innerHTML =
    `stable fluids · <b>${COLS}×${ROWS}</b> cells · <b>${liveCells}</b> live · <b>${_fps}</b> fps\n` +
    `wind <b>${P.wind.toFixed(1)}</b> · vort <b>${P.vort.toFixed(1)}</b> · ` +
    `<b>${P.palette}</b> · solid <b>${P.solids ? 'ON' : 'OFF'}</b>`;
}

function hudFrame(now) {
  _fpsAcc++;
  if (now - _fpsT >= 500) {
    _fps = Math.round(_fpsAcc * 1000 / (now - _fpsT));
    _fpsAcc = 0; _fpsT = now;
    renderHud();
  }
}
