/* packetLife.js — organisms that live in the lee of the panels.

   The first version of this was a self-contained ecosystem drawn *over* the
   fluid, and it fought the thing it was drawn on. The click that dropped food
   was also the click that fired a velocity burst into the same cell. The
   current took a flat 78% of every steering decision, so nothing could swim
   back to anything. And the food never moved — so the reward was pinned to
   the world while the organisms were pinned to the flow, and those two facts
   can't both hold and still produce a feeding loop.

   This version inverts it. Food is a passive tracer: it drifts with the
   field, the same way the smoke does. Organisms are partly self-propelled,
   and they steer *down the flow-speed gradient* — toward slow water, which on
   this page only exists in the lee of a solid body. Every panel is a solid
   body. So the panel is the habitat, and dragging one drags the shelter.

   Two things stop that from degenerating. The gradient alone is a descent, and
   a descent finds the nearest minimum, which is the frame — slow only because
   setBound() decays it. So the border is excluded from the search, and a weak
   pull toward the habitat keeps them the habitat's fauna rather than whatever
   happens to be calm. Past the frame they're gone, and the habitat spawns a
   replacement, so a sustained gale reads as turnover instead of a heap of
   glyphs in the corner.

   Which turns the current from the obstacle into the mechanic. You release
   food from the panel's downstream face and then push it where you want it,
   using the same mouse-drag that stirs everything else. Nothing here is a new
   interaction — it's the existing one, aimed at something.

   Nothing is drawn in its own colour. Organisms are inked out of the render
   LUT by heading, which is the same encoding the fluid itself uses, so they
   read as a property of the field rather than sprites on top of it. Their
   trail isn't drawn at all: a fed organism emits real density, and the fluid
   renderer draws it. Feeding is visible because it colours the water. */

const packetLife = {
  enabled: false,
  packets: [],
  food: [],
  released: 0,          // running total, for the panel readout
  venting: false,
  lastVentAt: 0
};

/* The panel that is currently acting as the habitat. Set when the life panel
   opens; the vent hangs off its live bounding rect, so it follows a drag. */
let habitatEl = null;

const LIFE_MAX_FOOD = 90;
const LIFE_MAX_PACKETS = 16;
/* The solver advances at 30 Hz with P.dt as its simulation timestep. Convert
   its normalised velocity into the grid-cells-per-second used by life. */
const LIFE_SOLVER_HZ = 30;
/* Movement cap. Not a physical claim — it stops a pointer wake (P.injVel is
   6, which is enormous locally) from flinging an organism across the page in
   one frame. Held a little above the speeds the smoke itself visibly moves
   at, so they read as carried by the flow rather than lagging behind it. */
const LIFE_MAX_CURRENT = 20;
const LIFE_FOOD_LIFE = 26;
/* Food is very nearly a pure passive tracer. The gap between this and an
   organism's own swim speed is the entire game: you can move food faster than
   they can chase it, so aim matters. */
const LIFE_FOOD_DRIFT = 0.92;
/* Sets how much current it takes to overwhelm self-propulsion — see
   lifeCurrentShare(). Bigger means the organisms hold station in more of the
   field; this is the single knob that used to be a flat 0.78. */
const LIFE_SWIM_AUTHORITY = 2.6;
const LIFE_PIGMENT = 0.17;
const LIFE_VENT_PUFF = 6;
const LIFE_VENT_EVERY = 190;
/* Below EPS cell/s the speed gradient is numerical noise and chasing it makes
   the organisms twitch in a still tank. SHELTER_FULL is a *fraction*: once a
   neighbouring sample is this much calmer than here, the lee is unambiguous
   and they commit to it. See lifeShelterDir(). */
const LIFE_SHELTER_EPS = 0.05;
const LIFE_SHELTER_FULL = 0.22;
/* Cells of border excluded from the shelter search — see lifeShelterDir(). */
const LIFE_EDGE_MARGIN = 5;
/* Homing on the habitat. NEAR is the radius inside which they're left alone,
   FAR the extra distance over which the pull reaches full strength. */
const LIFE_HOME = 0.7;
const LIFE_HOME_NEAR = 11;
const LIFE_HOME_FAR = 34;

/* Two of them, not five. This is a background, and a roster of species with
   appetites and predation is more invented biology than the rest of the page
   is willing to claim. They differ in the only two things that are legible at
   one character: how hard they swim, and how much they want to be sheltered.

   Swim speed is in the same cells/second as the current, and the ratio between
   them is the whole feel of the thing. The old values (0.64 against a 16
   cell/s cap) gave 25:1 in favour of the water, which is not an organism, it's
   a leaf — everything ended up pinned against the downstream border and
   nothing could enter or hold a wake. These are set so a wake at ~2 cell/s
   leaves them in near-full control, and the free stream at ~30 sweeps them
   while still letting them angle across it over a few seconds. */
const LIFE_SPECIES = [
  { empty: '<>', left: '<', right: '>', speed: 3.2, turn: 4.2, sense: 5.4,
    space: 2.2, foodWeight: 0.62, shelter: 0.48 },
  { empty: '{}', left: '{', right: '}', speed: 2.2, turn: 2.3, sense: 7.2,
    space: 2.9, foodWeight: 0.50, shelter: 0.78, splits: true }
];

function lifeIsAvailable() {
  return !REDUCED && window.innerWidth >= 760;
}

/* The main panel's cells, when it isn't a solid body. The canvas is drawn
   under the panel, so an organism that swims beneath it vanishes — the mask
   used to keep them out, and with `solid off` nothing does. Same rounding as
   stampRect() in solids.js. Refreshed once per update, not per lifeOpen(). */
let lifeKeepOut = null;
function lifeRefreshKeepOut() {
  lifeKeepOut = null;
  if (P.solids || !panelEl || !panelEl.isConnected || !COLS) return;
  const r = panelEl.getBoundingClientRect();
  const cw = window.innerWidth / COLS, ch = window.innerHeight / ROWS;
  lifeKeepOut = {
    i0: Math.round(r.left / cw), i1: Math.round(r.right / cw) - 1,
    j0: Math.round(r.top / ch),  j1: Math.round(r.bottom / ch) - 1
  };
}

function lifeOpen(i, j, width) {
  if (i < 2 || j < 2 || i + width >= COLS - 2 || j >= ROWS - 2) return false;
  const k = lifeKeepOut;
  if (k && j >= k.j0 && j <= k.j1 && i + width >= k.i0 && i <= k.i1) return false;
  for (let di = 0; di <= width; di++) if (solid[ix(i + di, j)]) return false;
  return true;
}

/* Bilinear sampling avoids the one-cell kick a nearest-neighbour field read
   would produce when a packet crosses a grid boundary. */
function lifeVelocity(x, y) {
  const x0 = Math.max(1, Math.min(COLS - 2, Math.floor(x)));
  const y0 = Math.max(1, Math.min(ROWS - 2, Math.floor(y)));
  const x1 = x0 + 1, y1 = y0 + 1;
  const tx = x - x0, ty = y - y0;
  const a = ix(x0, y0), b = ix(x1, y0), c = ix(x0, y1), d = ix(x1, y1);
  return {
    x: (vx[a] * (1 - tx) + vx[b] * tx) * (1 - ty) + (vx[c] * (1 - tx) + vx[d] * tx) * ty,
    y: (vy[a] * (1 - tx) + vy[b] * tx) * (1 - ty) + (vy[c] * (1 - tx) + vy[d] * tx) * ty
  };
}

/* Forward advection in the same coordinate system used by solver.js. Pointer
   wakes can be dramatic, so cap their result in cells/second rather than
   weakening the field everywhere.

   The cap is a *movement* limit and must not be applied to perception. A gust
   here runs well past 16 cell/s over most of the field, so sensing through
   the cap meant every sample outside the lee read as exactly max speed — the
   speed gradient flattened to zero precisely when shelter mattered most, and
   nothing could find the wake. lifeFlowSpeed() is the uncapped magnitude and
   is what the organisms actually smell. */
function lifeCurrent(x, y) {
  const flow = lifeVelocity(x, y);
  const scale = P.dt * LIFE_SOLVER_HZ;
  const cap = value => Math.max(-LIFE_MAX_CURRENT, Math.min(LIFE_MAX_CURRENT, value));
  return { x: cap(flow.x * (COLS - 2) * scale), y: cap(flow.y * (ROWS - 2) * scale) };
}

function lifeFlowSpeed(x, y) {
  const flow = lifeVelocity(x, y);
  const scale = P.dt * LIFE_SOLVER_HZ;
  const fx = flow.x * (COLS - 2) * scale, fy = flow.y * (ROWS - 2) * scale;
  return Math.sqrt(fx * fx + fy * fy);
}

/* How much of the movement the current takes. This is a ratio of advection to
   self-propulsion, so it falls out of the field instead of being asserted: in
   fast water an organism is cargo, in still water it goes where it likes. The
   old build pinned it flat, which is why feeding never worked — the organisms
   were equally helpless everywhere, including in the shelter they were
   supposed to be using. */
function lifeCurrentShare(speed, swim) {
  return speed / (speed + swim * LIFE_SWIM_AUTHORITY);
}

/* Steer down the flow-speed gradient — toward the slow water behind a body.
   Sampled at most of the sense radius rather than a cell away, so it finds a
   wake instead of the local jitter inside one.

   Relief is returned as a *fraction* of the local speed, not an absolute
   number of cells per second. The field spans two orders of magnitude between
   a dead calm and a gust, so any fixed threshold is either deaf in one and
   hysterical in the other. A fraction is scale-free: "meaningfully calmer
   than here" means the same thing at every wind level. */
function lifeShelterDir(p) {
  const r = p.species.sense * 0.6;
  const here = lifeFlowSpeed(p.x, p.y);
  let bx = 0, by = 0, best = here;
  for (let a = 0; a < 8; a++) {
    const ang = a * 0.7853981634;                // 45°
    const dx = Math.cos(ang), dy = Math.sin(ang);
    const nx = p.x + dx * r, ny = p.y + dy * r;
    if (!lifeOpen(Math.round(nx), Math.round(ny), 2)) continue;
    /* The screen border is slow because setBound() decays it to half the
       neighbour, not because anything is sheltering it. Left in the search it
       is the deepest minimum on the page, and pure gradient descent walks
       every organism into the frame and parks it there. It isn't a lee, so it
       isn't a candidate. */
    if (nx < LIFE_EDGE_MARGIN || nx > COLS - 1 - LIFE_EDGE_MARGIN ||
        ny < LIFE_EDGE_MARGIN || ny > ROWS - 1 - LIFE_EDGE_MARGIN) continue;
    const s = lifeFlowSpeed(nx, ny);
    if (s < best) { best = s; bx = dx; by = dy; }
  }
  const drop = here - best;
  return { x: bx, y: by, relief: drop < LIFE_SHELTER_EPS ? 0 : drop / (here + 0.4) };
}

/* The habitat's footprint in cells. Read live off the element, so it is
   wherever the window currently is. */
function lifeHabitatBox() {
  if (!habitatEl || !habitatEl.isConnected) return null;
  const r = habitatEl.getBoundingClientRect();
  const cw = window.innerWidth / COLS, ch = window.innerHeight / ROWS;
  const i0 = Math.floor(r.left / cw), i1 = Math.ceil(r.right / cw);
  const j0 = Math.floor(r.top / ch),  j1 = Math.ceil(r.bottom / ch);
  return { i0, i1, j0, j1, ci: (i0 + i1) / 2, cj: (j0 + j1) / 2 };
}

/* Homing. Shelter-seeking alone is a gradient descent, and a gradient descent
   finds whatever minimum it is nearest — which under a strong steady current
   is downstream of everything, nowhere near the panel. These are the habitat's
   fauna, so they are attached to the habitat: a weak pull that is nothing
   nearby and firm at range. It is what makes dragging the window move them
   rather than just move the calm patch they have already left. */
function lifeHomeDir(p) {
  const box = lifeHabitatBox();
  if (!box) return { x: 0, y: 0, weight: 0 };
  const dx = box.ci - p.x, dy = box.cj - p.y;
  const d = Math.sqrt(dx * dx + dy * dy);
  if (d < LIFE_HOME_NEAR || d < 0.001) return { x: 0, y: 0, weight: 0 };
  const w = Math.min(1, (d - LIFE_HOME_NEAR) / LIFE_HOME_FAR) * LIFE_HOME;
  return { x: dx / d, y: dy / d, weight: w };
}

/* Spawn point: the calmest open cell on the habitat's perimeter, which under
   any real flow is its lee. Not a special case — it's the same "find slow
   water" rule the organisms run, evaluated once at birth. */
function lifeShelteredCell() {
  const box = lifeHabitatBox();
  if (!box) return lifeFindOpen(2);

  let best = null, bestSpeed = Infinity;
  for (let a = 0; a < 16; a++) {
    const ang = a * 0.3926990817;                // 22.5°
    for (let r = 3; r <= 9; r += 3) {
      const i = Math.round(box.ci + Math.cos(ang) * (box.i1 - box.i0) * 0.5 + Math.cos(ang) * r);
      const j = Math.round(box.cj + Math.sin(ang) * (box.j1 - box.j0) * 0.5 + Math.sin(ang) * r);
      if (!lifeOpen(i, j, 2)) continue;
      if (i < LIFE_EDGE_MARGIN || i > COLS - 1 - LIFE_EDGE_MARGIN ||
          j < LIFE_EDGE_MARGIN || j > ROWS - 1 - LIFE_EDGE_MARGIN) continue;
      const s = lifeFlowSpeed(i, j);
      if (s < bestSpeed) { bestSpeed = s; best = { x: i, y: j }; }
    }
  }
  return best || lifeFindOpen(2);
}

/* Swept off the page. A sustained current can carry an organism downstream
   faster than it can ever swim back, and the border is where that ends — the
   old behaviour was a heap of glyphs vibrating in the corner. Treating the
   frame as an exit and the habitat as the source turns that into turnover:
   population holds, the habitat stays the centre of the thing, and a gale
   reads as a gale rather than as a bug. */
function lifeRecycle(p) {
  const born = lifeShelteredCell();
  p.x = born.x; p.y = born.y;
  p.vx = 0; p.vy = 0;
  p.cargo = 0; p.bright = 0.5;
  p.wander = Math.random() * Math.PI * 2;
}

function lifeIsOverboard(p) {
  return p.x < LIFE_EDGE_MARGIN || p.x > COLS - 1 - LIFE_EDGE_MARGIN ||
         p.y < LIFE_EDGE_MARGIN || p.y > ROWS - 1 - LIFE_EDGE_MARGIN;
}

function lifeFindOpen(width) {
  for (let tries = 0; tries < 90; tries++) {
    const i = 2 + ((Math.random() * (COLS - width - 4)) | 0);
    const j = 2 + ((Math.random() * (ROWS - 4)) | 0);
    if (lifeOpen(i, j, width)) return { x: i, y: j };
  }
  return { x: 2, y: 2 };
}

function lifeNewPacket(species, x, y, angle) {
  const p = x == null ? lifeShelteredCell() : { x, y };
  angle = angle == null ? Math.random() * Math.PI * 2 : angle;
  return {
    x: p.x, y: p.y, hx: Math.cos(angle), hy: Math.sin(angle), vx: 0, vy: 0,
    wander: angle, turnAt: 0, bright: 0, splitAt: 0, cargo: 0, species
  };
}

function lifeBuildPackets() {
  lifeRefreshKeepOut();
  packetLife.packets.length = 0;
  const count = window.innerWidth < 980 ? 6 : 8;
  for (let n = 0; n < count; n++) {
    packetLife.packets.push(lifeNewPacket(LIFE_SPECIES[n % LIFE_SPECIES.length]));
  }
}

/* ── the vent ─────────────────────────────────────────────────────────
   Food leaves the habitat from whichever face the flow is already leaving
   by, so a release reads as the panel shedding something into its own wake
   rather than as pellets appearing in mid-air. In a still field there is no
   downstream, the fallback face is used, and the food just sits there until
   you go and push it — which is the lesson the mechanic is trying to teach. */
function lifeVentCell() {
  const box = lifeHabitatBox();
  if (!box) return null;
  const { i0, i1, j0, j1 } = box;
  const ci = Math.round(box.ci), cj = Math.round(box.cj);

  const faces = [
    { i: i1 + 2, j: cj, nx:  1, ny:  0 },
    { i: i0 - 2, j: cj, nx: -1, ny:  0 },
    { i: ci, j: j1 + 2, nx:  0, ny:  1 },
    { i: ci, j: j0 - 2, nx:  0, ny: -1 }
  ];

  let best = null, bestOut = -Infinity;
  for (let n = 0; n < faces.length; n++) {
    const f = faces[n];
    if (!lifeOpen(f.i, f.j, 0)) continue;
    const c = lifeCurrent(f.i, f.j);
    const out = c.x * f.nx + c.y * f.ny;
    if (out > bestOut) { bestOut = out; best = f; }
  }
  return best;
}

function packetLifeRelease(now) {
  if (!packetLife.enabled) return 0;
  const vent = lifeVentCell();
  if (!vent) return 0;

  let made = 0;
  for (let n = 0; n < LIFE_VENT_PUFF && packetLife.food.length < LIFE_MAX_FOOD; n++) {
    const a = Math.random() * Math.PI * 2, rr = Math.random() * 1.6;
    const x = vent.i + vent.nx * 0.8 + Math.cos(a) * rr;
    const y = vent.j + vent.ny * 0.8 + Math.sin(a) * rr;
    if (!lifeOpen(Math.round(x), Math.round(y), 0)) continue;
    packetLife.food.push({ x, y, age: 0 });
    made++;
  }
  packetLife.released += made;
  packetLife.lastVentAt = now;
  return made;
}

function packetLifeSetVenting(on) { packetLife.venting = !!on; }

function lifeVentFrame(now) {
  if (!packetLife.venting) return;
  if (now - packetLife.lastVentAt < LIFE_VENT_EVERY) return;
  packetLifeRelease(now);
}

/* ── food ─────────────────────────────────────────────────────────────
   Advected, not simulated: food has no will and no wake of its own. It is a
   tracer with a lifetime, which is exactly what makes it steerable. */
function lifeAdvectFood(dt) {
  const food = packetLife.food;
  for (let n = food.length - 1; n >= 0; n--) {
    const f = food[n];
    const c = lifeCurrent(f.x, f.y);
    f.x += c.x * dt * LIFE_FOOD_DRIFT;
    f.y += c.y * dt * LIFE_FOOD_DRIFT;
    f.age += dt;

    if (f.age > LIFE_FOOD_LIFE || !lifeOpen(Math.round(f.x), Math.round(f.y), 0)) {
      food.splice(n, 1);
    }
  }
}

function lifeNearestFood(p) {
  let best = -1, bestD2 = p.species.sense * p.species.sense;
  for (let n = 0; n < packetLife.food.length; n++) {
    const f = packetLife.food[n], dx = f.x - p.x, dy = f.y - p.y, d2 = dx * dx + dy * dy;
    if (d2 < bestD2) { best = n; bestD2 = d2; }
  }
  return best;
}

/* ── lifecycle ────────────────────────────────────────────────────── */
function packetLifeSetEnabled(on, el) {
  if (!on) {
    packetLife.enabled = false;
    packetLife.venting = false;
    packetLife.food.length = 0;
    packetLife.packets.length = 0;
    packetLife.released = 0;
    habitatEl = null;
    return { ok: true, message: 'habitat closed' };
  }
  if (!lifeIsAvailable()) {
    return {
      ok: false,
      message: REDUCED ? 'life respects reduced motion' : 'life is desktop-only'
    };
  }
  habitatEl = el || null;
  packetLife.enabled = true;
  packetLife.released = 0;
  lifeBuildPackets();
  return { ok: true, message: 'habitat open — they shelter in the panel\'s wake' };
}

function packetLifeUpdate(dt, now) {
  if (!packetLife.enabled) return;
  dt = Math.min(dt, 0.05);
  if (dt <= 0) return;

  lifeRefreshKeepOut();
  lifeVentFrame(now);
  lifeAdvectFood(dt);

  const packets = packetLife.packets;
  for (let n = 0; n < packets.length; n++) {
    const p = packets[n];
    const sp = p.species;

    /* A resize, or a panel dragged onto them, can put the mask over an
       organism. Relocate before drawing so they never sit on readable text.
       Same treatment as being swept off: they come back at the habitat. */
    if (lifeIsOverboard(p) || !lifeOpen(Math.round(p.x), Math.round(p.y), 2)) {
      lifeRecycle(p);
    }

    if (now >= p.turnAt) {
      p.wander += (Math.random() - 0.5) * 1.15;
      p.turnAt = now + 500 + Math.random() * 950;
    }
    let tx = Math.cos(p.wander), ty = Math.sin(p.wander);

    /* A little personal space, so a gathering reads as several animals and
       not one pile of glyphs. Visual only — this is not a collision sim. */
    let awayX = 0, awayY = 0;
    const space2 = sp.space * sp.space;
    for (let qn = 0; qn < packets.length; qn++) {
      if (qn === n) continue;
      const q = packets[qn], dx = p.x - q.x, dy = p.y - q.y, d2 = dx * dx + dy * dy;
      if (d2 > 0.01 && d2 < space2) { awayX += dx / d2; awayY += dy / d2; }
    }
    tx += awayX * 0.16; ty += awayY * 0.16;

    /* Home first, then refine locally with shelter. Order matters: homing
       says which part of the page to be in, shelter says where to sit once
       you're there. */
    const home = lifeHomeDir(p);
    if (home.weight > 0) {
      tx = tx * (1 - home.weight) + home.x * home.weight;
      ty = ty * (1 - home.weight) + home.y * home.weight;
    }

    /* Shelter. This is the whole behaviour: the only slow water on the page
       is behind a solid body, so "swim toward calm" produces animals that
       live in the wake of the panels without ever being told the panels
       exist. Drag one and they follow the lee, because the lee moved. */
    const sh = lifeShelterDir(p);
    if (sh.relief > LIFE_SHELTER_EPS) {
      const w = sp.shelter * Math.min(1, sh.relief / LIFE_SHELTER_FULL);
      tx = tx * (1 - w) + sh.x * w;
      ty = ty * (1 - w) + sh.y * w;
    }

    /* Food outranks shelter — a hungry animal will leave the lee for it, and
       that's the moment the mechanic is built around: you steer a plume past
       the shelter and watch them break cover to intercept it. */
    const foodIndex = lifeNearestFood(p);
    if (foodIndex >= 0 && p.cargo < 2.7) {
      const f = packetLife.food[foodIndex], dx = f.x - p.x, dy = f.y - p.y;
      const inv = 1 / Math.max(0.001, Math.sqrt(dx * dx + dy * dy));
      tx = tx * (1 - sp.foodWeight) + dx * inv * sp.foodWeight;
      ty = ty * (1 - sp.foodWeight) + dy * inv * sp.foodWeight;

      if (dx * dx + dy * dy < 0.8) {
        packetLife.food.splice(foodIndex, 1);
        p.cargo = Math.min(3, p.cargo + 1);
        p.bright = 0.85;
        if (sp.splits && p.cargo >= 2.8 && now >= p.splitAt && packets.length < LIFE_MAX_PACKETS) {
          const a = p.wander + Math.PI * (0.65 + Math.random() * 0.7);
          const childX = p.x + Math.cos(a) * 1.5, childY = p.y + Math.sin(a) * 1.5;
          if (lifeOpen(Math.round(childX), Math.round(childY), 2)) {
            const child = lifeNewPacket(sp, childX, childY, a);
            child.cargo = 0.45; child.bright = 0.7;
            packets.push(child);
            p.cargo = 1.05; p.splitAt = now + 12000;
          }
        }
      }
    }

    /* Movement reads the capped current; the share reads the true one. An
       organism in water moving at 40 cell/s is cargo whether or not we're
       willing to move it that fast. */
    const current = lifeCurrent(p.x, p.y);
    const capped = Math.sqrt(current.x * current.x + current.y * current.y);
    const share = lifeCurrentShare(lifeFlowSpeed(p.x, p.y), sp.speed);

    if (capped > 0.01) {
      tx = tx * (1 - share) + current.x / capped * share;
      ty = ty * (1 - share) + current.y / capped * share;
    }
    const mag = Math.max(0.001, Math.sqrt(tx * tx + ty * ty)); tx /= mag; ty /= mag;

    const turn = Math.min(1, dt * sp.turn);
    p.hx += (tx - p.hx) * turn; p.hy += (ty - p.hy) * turn;
    const heading = Math.max(0.001, Math.sqrt(p.hx * p.hx + p.hy * p.hy));
    p.hx /= heading; p.hy /= heading;

    const targetVX = current.x * share + p.hx * sp.speed;
    const targetVY = current.y * share + p.hy * sp.speed;
    const inertia = Math.min(1, dt * (2.4 + sp.turn * 0.35));
    p.vx += (targetVX - p.vx) * inertia;
    p.vy += (targetVY - p.vy) * inertia;

    const nx = p.x + p.vx * dt, ny = p.y + p.vy * dt;
    if (lifeOpen(Math.round(nx), Math.round(ny), 2)) { p.x = nx; p.y = ny; }
    else {
      p.vx *= -0.28; p.vy *= -0.28;
      p.wander += Math.PI * (0.55 + Math.random() * 0.4); p.turnAt = now;
    }

    p.bright = Math.max(0, p.bright - dt);
    p.cargo = Math.max(0, p.cargo - dt * 0.17);   // digestion, not a health bar

    /* The trail isn't drawn — it's emitted. A fed organism puts real density
       into the solver and render.js draws it in the field's own palette, so
       the trail advects, diffuses and fades like everything else. Nothing is
       emitted when there's nothing to digest, which is what keeps an unfed
       habitat visually quiet. It adds no velocity on purpose: an organism
       must not be carried by a current it made itself. */
    if (p.cargo > 0.1) {
      const wake = Math.min(1.5, dt * LIFE_SOLVER_HZ);
      emit(Math.round(p.x - p.hx * 1.15), Math.round(p.y - p.hy * 1.15), 2,
           LIFE_PIGMENT * wake * Math.min(1, p.cargo), 0, 0);
    }
  }
}

/* ── render ───────────────────────────────────────────────────────────
   Inked out of the same lookup table render.js uses, indexed by heading. On
   the flow palette that means an organism swimming right is the colour of
   fluid moving right; on the ramp palettes it takes the top of the ramp. The
   point is that nothing here introduces a colour the field doesn't already
   contain — the old build's five pastels were the reason this read as a
   second, unrelated system running on top of the first. */
function lifeInk(hx, hy, bright) {
  let ti = LUT_T - 1;
  if (LUT_BY_DIR) {
    let h = Math.atan2(hy, hx);
    if (h < 0) h += 6.283185307;
    ti = (h * (LUT_T / 6.283185307)) | 0;
    if (ti >= LUT_T) ti = LUT_T - 1;
  }
  const bi = Math.max(0, Math.min(LUT_B - 1, (bright * (LUT_B - 1) + 0.5) | 0));
  return LUT[ti * LUT_B + bi];
}

function packetLifeRender() {
  if (!packetLife.enabled) return;
  ctx.textAlign = 'left'; ctx.textBaseline = 'top';

  for (let n = 0; n < packetLife.food.length; n++) {
    const f = packetLife.food[n];
    // Inert matter, so it gets no hue — just a dot that dims as it goes off.
    ctx.fillStyle = f.age < LIFE_FOOD_LIFE * 0.45 ? '#8d97a6' : '#565f6b';
    ctx.fillText('.', Math.round(f.x) * CW, Math.round(f.y) * CH);
  }

  for (let n = 0; n < packetLife.packets.length; n++) {
    const p = packetLife.packets[n];
    let sprite = p.species.empty;
    if (p.cargo > 0.08) {
      sprite = p.species.left + (p.cargo > 2 ? '#' : p.cargo > 1 ? '+' : '.') + p.species.right;
    }
    ctx.fillStyle = lifeInk(p.hx, p.hy, p.bright > 0 ? 1 : 0.72);
    ctx.fillText(sprite, Math.round(p.x) * CW, Math.round(p.y) * CH);
  }
}

/* ── readouts, for the panel ─────────────────────────────────────── */
function lifeStats() {
  const packets = packetLife.packets;
  let shelter = 0, fed = 0;
  for (let n = 0; n < packets.length; n++) {
    shelter += lifeFlowSpeed(packets[n].x, packets[n].y);
    fed += packets[n].cargo;
  }
  const c = packets.length || 1;
  return {
    pop: packets.length,
    adrift: packetLife.food.length,
    released: packetLife.released,
    shelter: shelter / c,
    fed: fed / c
  };
}
