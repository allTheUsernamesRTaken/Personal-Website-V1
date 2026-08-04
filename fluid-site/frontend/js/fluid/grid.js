/* grid.js — indexing, sources, walls, solid cells. */

function ix(i, j) { return j * COLS + i; }

function addSource(x, s) {
  const dt = P.dt;
  for (let i = 0; i < N; i++) x[i] += dt * s[i];
}

/* Not a reflective wall — the neighbour times 0.5, so fluid softly dies at
   the screen edge instead of piling up against it. */
function setBound(b, x) {
  for (let i = 0; i < COLS; i++) {
    x[ix(i, 0)]      = x[ix(i, 1)]      * 0.5;
    x[ix(i, ROWS - 1)] = x[ix(i, ROWS - 2)] * 0.5;
  }
  for (let j = 0; j < ROWS; j++) {
    x[ix(0, j)]        = x[ix(1, j)]        * 0.5;
    x[ix(COLS - 1, j)] = x[ix(COLS - 2, j)] * 0.5;
  }
}

/* Solid cells hold no fluid and no smoke. Run after anything that could
   have written into them. */
function enforceSolids() {
  for (let k = 0; k < N; k++) {
    if (solid[k]) { vx[k] = 0; vy[k] = 0; dens[k] = 0; }
  }
}

/* Soft radial deposit of smoke + velocity. Used by the mouse, the ambient
   plumes, and the burst. */
function emit(ci, cj, r, amount, dvx, dvy) {
  const r2 = r * r;
  for (let dj = -r; dj <= r; dj++) {
    const nj = cj + dj;
    if (nj < 1 || nj >= ROWS - 1) continue;
    for (let di = -r; di <= r; di++) {
      const ni = ci + di;
      if (ni < 1 || ni >= COLS - 1) continue;
      const d2 = di * di + dj * dj;
      if (d2 > r2) continue;
      const id = ix(ni, nj);
      if (solid[id]) continue;
      const f = (1 - Math.sqrt(d2) / r) ** 2;
      dens0[id] += amount * f;
      vx0[id]   += dvx * f;
      vy0[id]   += dvy * f;
    }
  }
}
