/* solver.js — Jos Stam, "Stable Fluids" (1999), with obstacles.

   step() order: sources, diffuse, project, advect, project, vorticity, fade.
   project runs twice because advect wrecks the divergence-free field it was
   just handed. */

/* Gauss-Seidel relaxation, solid-aware.

   Solving  x[c]*cSelf + a*SUM(x[c] - x[n])  =  x0[c]  over fluid neighbours
   only. A solid neighbour is simply dropped from the stencil, which is a
   zero-gradient (Neumann) condition at the wall — no flux through it. The
   denominator has to shrink with the neighbour count or a cell walled in on
   three sides blows up. */
function linSolve(b, x, x0, a, cSelf) {
  for (let k = 0; k < P.iter; k++) {
    for (let j = 1; j < ROWS - 1; j++) {
      const row = j * COLS;
      for (let i = 1; i < COLS - 1; i++) {
        const id = row + i;
        if (solid[id]) { x[id] = 0; continue; }
        let sum = 0, cnt = 0;
        if (!solid[id - 1])    { sum += x[id - 1];    cnt++; }
        if (!solid[id + 1])    { sum += x[id + 1];    cnt++; }
        if (!solid[id - COLS]) { sum += x[id - COLS]; cnt++; }
        if (!solid[id + COLS]) { sum += x[id + COLS]; cnt++; }
        const den = cSelf + a * cnt;
        x[id] = den > 1e-9 ? (x0[id] + a * sum) / den : 0;
      }
    }
    setBound(b, x);
  }
}

function diffuse(b, x, x0, coeff) {
  const a = P.dt * coeff * (COLS - 2) * (ROWS - 2);
  linSolve(b, x, x0, a, 1);          // cSelf 1  =>  (x0 + a*sum)/(1 + 4a)
}

/* Semi-Lagrangian: for each cell, walk the velocity backwards and sample
   where this stuff came from. Backwards is why it can't blow up. */
function advect(b, d, d0, vX, vY) {
  const dtx = P.dt * (COLS - 2), dty = P.dt * (ROWS - 2);
  for (let j = 1; j < ROWS - 1; j++) {
    for (let i = 1; i < COLS - 1; i++) {
      const id = ix(i, j);
      if (solid[id]) { d[id] = 0; continue; }
      let px = i - dtx * vX[id];
      let py = j - dty * vY[id];
      px = px < 0.5 ? 0.5 : (px > COLS - 1.5 ? COLS - 1.5 : px);
      py = py < 0.5 ? 0.5 : (py > ROWS - 1.5 ? ROWS - 1.5 : py);
      const i0 = px | 0, i1 = i0 + 1;
      const j0 = py | 0, j1 = j0 + 1;
      const s1 = px - i0, s0 = 1 - s1, t1 = py - j0, t0 = 1 - t1;
      d[id] = s0 * (t0 * d0[ix(i0, j0)] + t1 * d0[ix(i0, j1)])
            + s1 * (t0 * d0[ix(i1, j0)] + t1 * d0[ix(i1, j1)]);
    }
  }
  setBound(b, d);
}

/* Force the field back to divergence-free. This is what makes it swirl
   like fluid instead of just blurring outward. */
function project(vX, vY, p, div) {
  const hx = 1 / COLS, hy = 1 / ROWS;
  for (let j = 1; j < ROWS - 1; j++) {
    for (let i = 1; i < COLS - 1; i++) {
      const id = ix(i, j);
      p[id] = 0;
      if (solid[id]) { div[id] = 0; continue; }
      div[id] = -0.5 * (hx * (vX[id + 1] - vX[id - 1])
                      + hy * (vY[id + COLS] - vY[id - COLS]));
    }
  }
  setBound(0, div); setBound(0, p);
  linSolve(0, p, div, 1, 0);         // cSelf 0  =>  (div + sum)/count

  for (let j = 1; j < ROWS - 1; j++) {
    for (let i = 1; i < COLS - 1; i++) {
      const id = ix(i, j);
      if (solid[id]) continue;
      vX[id] -= 0.5 * (p[id + 1]    - p[id - 1])    / hx;
      vY[id] -= 0.5 * (p[id + COLS] - p[id - COLS]) / hy;
    }
  }
  setBound(1, vX); setBound(2, vY);
}

/* Diffusion eats the small curls. This puts them back by pushing each cell
   toward its local vorticity gradient. Without it everything goes soft. */
function vorticityConfinement(vX, vY) {
  const curl = curlBuf;              // hoisted: this used to allocate 64KB/step
  for (let j = 1; j < ROWS - 1; j++) {
    for (let i = 1; i < COLS - 1; i++) {
      const id = ix(i, j);
      curl[id] = solid[id] ? 0
        : (vY[id + 1] - vY[id - 1]) * 0.5 - (vX[id + COLS] - vX[id - COLS]) * 0.5;
    }
  }
  const s = P.vort * P.dt;
  for (let j = 1; j < ROWS - 1; j++) {
    for (let i = 1; i < COLS - 1; i++) {
      const id = ix(i, j);
      if (solid[id]) continue;
      const dx = (Math.abs(curl[id + 1])    - Math.abs(curl[id - 1]))    * 0.5;
      const dy = (Math.abs(curl[id + COLS]) - Math.abs(curl[id - COLS])) * 0.5;
      const len = Math.sqrt(dx * dx + dy * dy) + 1e-6;
      vX[id] += s * (dy / len) * curl[id];
      vY[id] -= s * (dx / len) * curl[id];
    }
  }
}

function step(t) {
  ambientForce(t);
  ambientInflow(t);

  addSource(vx, vx0); addSource(vy, vy0);
  [vx, vx0] = [vx0, vx]; diffuse(1, vx, vx0, P.visc);
  [vy, vy0] = [vy0, vy]; diffuse(2, vy, vy0, P.visc);
  project(vx, vy, vx0, vy0);
  [vx, vx0] = [vx0, vx]; [vy, vy0] = [vy0, vy];
  advect(1, vx, vx0, vx0, vy0);
  advect(2, vy, vy0, vx0, vy0);
  project(vx, vy, vx0, vy0);
  vorticityConfinement(vx, vy);

  addSource(dens, dens0);
  [dens, dens0] = [dens0, dens]; diffuse(0, dens, dens0, P.diff);
  [dens, dens0] = [dens0, dens]; advect(0, dens, dens0, vx, vy);

  enforceSolids();

  const fade = P.fade, damp = P.velDamp;
  for (let i = 0; i < N; i++) {
    vx0[i] = 0; vy0[i] = 0; dens0[i] = 0;
    dens[i] *= fade; vx[i] *= damp; vy[i] *= damp;
  }
}
