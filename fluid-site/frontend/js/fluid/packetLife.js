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
   happens to be calm. At the screen boundary they turn inward and stay in
   view; only aging and starvation remove an animal.

   Food leaves a user-selected face and is then carried by the current. Most
   organisms use the fluid's heading palette. The hunter stays amber, bites
   flash, and dead organisms leave neutral x remains so these events can be
   read independently of the changing flow. A fed organism's trail is real
   density emitted into the solver. */

const packetLife = {
  enabled: false,
  packets: [],
  eggs: [],
  food: [],
  released: 0,          // running total, for the panel readout
  eaten: 0,
  births: 0,
  deaths: 0,
  laid: 0,
  reseedAt: 0,
  lastEvent: '',
  eventUntil: 0,
  eventPriority: 0,
  outletSide: 'right',
  venting: false,
  lastVentAt: 0
};

/* The panel that is currently acting as the habitat. Set when the life panel
   opens; the vent hangs off its live bounding rect, so it follows a drag. */
let habitatEl = null;

const LIFE_MAX_FOOD = 90;
const LIFE_MAX_PACKETS = 16;
const LIFE_MAX_EGGS = 4;       // eggs also reserve a slot in the total of 16
const LIFE_SENSE_EVERY = 125;  // 8 Hz decisions, 60 Hz movement
const LIFE_HATCH_TIME = 4;
const LIFE_ATTACK_EVERY = 2500;
const LIFE_REMAINS_TIME = 6;
const LIFE_OUTLET_SIDES = ['left', 'right', 'top', 'bottom'];
/* The solver advances at 30 Hz with P.dt as its simulation timestep. Convert
   its normalised velocity into the grid-cells-per-second used by life. */
const LIFE_SOLVER_HZ = SOLVER_HZ;
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
const LIFE_EDGE_TURN = 6;  // start steering before reaching the visible boundary
/* Homing on the habitat. NEAR is the radius inside which they're left alone,
   FAR the extra distance over which the pull reaches full strength. */
const LIFE_HOME = 0.7;
const LIFE_HOME_NEAR = 11;
const LIFE_HOME_FAR = 34;

/* Foragers range farther for food; grazers stay close to shelter and lay eggs.
   One hunter occupies an ordinary population slot and steals stored food.
   Speeds remain in cells/second, shared with the current conversion below. */
const LIFE_SPECIES = [
  { name: 'forager', empty: '<>', left: '<', right: '>', speed: 3.2, turn: 4.2, sense: 7.2,
    space: 2.2, foodWeight: 0.72, shelter: 0.40, home: 0.65, lifespan: 180, metabolism: 0.010 },
  { name: 'grazer', empty: '{}', left: '{', right: '}', speed: 2.2, turn: 2.3, sense: 4.8,
    space: 2.9, foodWeight: 0.58, shelter: 0.88, home: 1.15, lifespan: 220, metabolism: 0.008, splits: true }
];
const LIFE_HUNTER = {
  name: 'hunter', empty: '@', speed: 3.6, turn: 3.8, sense: 9,
  space: 3.2, foodWeight: 0, shelter: 0.4, home: 0.65,
  lifespan: 240, metabolism: 0.007, hunter: true
};

function lifeIsAvailable() {
  return !REDUCED && window.innerWidth >= 760;
}

/* Visual exclusion is deliberately stricter than the fluid's rounded mask.
   A partially covered cell is still water, but a whole creature must remain
   visible. Cache all DOM rectangles once per update, including solid-off UI.
   The font is slightly taller than CH, so reserve its two-pixel overhang. */
const lifeKeepOut = [];
let lifeHabitat = null;
function lifeRefreshKeepOut() {
  lifeKeepOut.length = 0;
  lifeHabitat = null;
  if (!COLS) return;
  const cw = window.innerWidth / COLS, ch = window.innerHeight / ROWS;
  for (const el of solidEls) {
    if (!el || !el.isConnected) continue;
    const r = el.getBoundingClientRect();
    lifeKeepOut.push({
      i0: Math.floor(r.left / cw), i1: Math.ceil(r.right / cw) - 1,
      j0: Math.floor((r.top - 2) / ch), j1: Math.ceil((r.bottom + 1) / ch) - 1
    });
    if (el === habitatEl) {
      const i0 = Math.floor(r.left / cw), i1 = Math.ceil(r.right / cw);
      const j0 = Math.floor(r.top / ch), j1 = Math.ceil(r.bottom / ch);
      lifeHabitat = { i0, i1, j0, j1, ci: (i0 + i1) / 2, cj: (j0 + j1) / 2 };
    }
  }
}

function lifeOpen(i, j, width) {
  if (i < 2 || j < 2 || i + width >= COLS - 2 || j >= ROWS - 2) return false;
  for (const k of lifeKeepOut) {
    if (j >= k.j0 && j <= k.j1 && i + width >= k.i0 && i <= k.i1) return false;
  }
  for (let di = 0; di <= width; di++) if (solid[ix(i + di, j)]) return false;
  return true;
}

function lifeScreenBounds(width = 2) {
  return { left: 2, right: COLS - width - 3, top: 2, bottom: ROWS - 3 };
}

/* Keep the full sprite on screen. Only outward velocity is reflected, so an
   edge contact preserves position along the wall and every lifecycle value. */
function lifeContainPoint(p, width = 2) {
  const b = lifeScreenBounds(width);
  const x = Math.max(b.left, Math.min(b.right, p.x));
  const y = Math.max(b.top, Math.min(b.bottom, p.y));
  if (p.x <= b.left || p.x >= b.right) {
    const inward = p.x <= b.left ? 1 : -1;
    if (p.vx * inward < 0) p.vx *= -0.35;
    if (p.hx * inward < 0) p.hx *= -1;
  }
  if (p.y <= b.top || p.y >= b.bottom) {
    const inward = p.y <= b.top ? 1 : -1;
    if (p.vy * inward < 0) p.vy *= -0.35;
    if (p.hy * inward < 0) p.hy *= -1;
  }
  p.x = x; p.y = y;
}

function lifeEdgeDirection(p) {
  const b = lifeScreenBounds();
  const near = d => Math.max(0, 1 - d / LIFE_EDGE_TURN);
  return { x: near(p.x - b.left) - near(b.right - p.x),
           y: near(p.y - b.top) - near(b.bottom - p.y) };
}

/* Search only when geometry covers an entity. The nearest legal anchor puts
   a normal drag just outside the contacting edge; overlapping panels are
   handled by the same mask. No safe space means wait, keeping all state. */
function lifeDisplacePoint(p, width) {
  if (lifeOpen(Math.round(p.x), Math.round(p.y), width)) {
    p.blocked = false;
    return true;
  }
  const bounds = lifeScreenBounds(width);
  const ci = Math.max(bounds.left, Math.min(bounds.right, Math.round(p.x)));
  const cj = Math.max(bounds.top, Math.min(bounds.bottom, Math.round(p.y)));
  let best = null, bestD2 = Infinity;
  const consider = (i, j) => {
    if (i < bounds.left || i > bounds.right || j < bounds.top || j > bounds.bottom || !lifeOpen(i, j, width)) return;
    const d2 = (i - p.x) ** 2 + (j - p.y) ** 2;
    if (d2 < bestD2) { bestD2 = d2; best = { x: i, y: j }; }
  };
  for (let r = 0; r < Math.max(COLS, ROWS); r++) {
    // Past this ring no anchor can be closer (allow half-cell rounding).
    if (r > 0 && (r - 0.5) ** 2 > bestD2) break;
    for (let di = -r; di <= r; di++) {
      consider(ci + di, cj - r);
      if (r) consider(ci + di, cj + r);
    }
    for (let dj = -r + 1; dj < r; dj++) {
      consider(ci - r, cj + dj);
      consider(ci + r, cj + dj);
    }
  }
  p.blocked = !best;
  if (!best) return false;
  const dx = best.x - p.x, dy = best.y - p.y;
  const d = Math.hypot(dx, dy) || 1;
  // Remove only velocity back into the contacting face. Tangential motion,
  // heading, food, reproduction cooldown and object identity survive.
  if (Number.isFinite(p.vx) && Number.isFinite(p.vy)) {
    const inward = Math.min(0, (p.vx * dx + p.vy * dy) / d);
    p.vx -= inward * dx / d;
    p.vy -= inward * dy / d;
  }
  p.x = best.x; p.y = best.y;
  return true;
}

function packetLifeDisplaceCovered() {
  if (!packetLife.enabled) return;
  lifeRefreshKeepOut();
  for (const p of packetLife.packets) { lifeContainPoint(p); lifeDisplacePoint(p, 2); }
  for (const egg of packetLife.eggs) lifeDisplacePoint(egg, 2);
  for (const f of packetLife.food) lifeDisplacePoint(f, 0);
}

function lifeEvent(message, now, priority = 0) {
  if (now < packetLife.eventUntil && priority < packetLife.eventPriority) return;
  packetLife.lastEvent = message;
  packetLife.eventPriority = priority;
  packetLife.eventUntil = now + (priority >= 3 ? 5000 : priority >= 2 ? 3000 : 2200);
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
  return lifeHabitat;
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
  const w = Math.min(0.85, Math.min(1, (d - LIFE_HOME_NEAR) / LIFE_HOME_FAR) * LIFE_HOME * p.species.home);
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
      if (!lifeOpen(i, j, 2) || !lifeRoomAt(i, j)) continue;
      if (i < LIFE_EDGE_MARGIN || i > COLS - 1 - LIFE_EDGE_MARGIN ||
          j < LIFE_EDGE_MARGIN || j > ROWS - 1 - LIFE_EDGE_MARGIN) continue;
      const s = lifeFlowSpeed(i, j);
      if (s < bestSpeed) { bestSpeed = s; best = { x: i, y: j }; }
    }
  }
  return best || lifeFindOpen(2);
}

/* New eggs start clear of the boundary; this is not a despawn condition. */
function lifeOutsideSpawnArea(p) {
  return p.x < LIFE_EDGE_MARGIN || p.x > COLS - 1 - LIFE_EDGE_MARGIN ||
         p.y < LIFE_EDGE_MARGIN || p.y > ROWS - 1 - LIFE_EDGE_MARGIN;
}

function lifeFindOpen(width) {
  const margin = width ? LIFE_EDGE_MARGIN : 2;
  for (let tries = 0; tries < 90; tries++) {
    const i = margin + ((Math.random() * (COLS - width - margin * 2)) | 0);
    const j = margin + ((Math.random() * (ROWS - margin * 2)) | 0);
    if (lifeOpen(i, j, width) && (!width || lifeRoomAt(i, j))) return { x: i, y: j };
  }
  return null;
}

function lifeNewPacket(species, x, y, angle) {
  const p = (x == null ? lifeShelteredCell() : { x, y }) || { x: LIFE_EDGE_MARGIN, y: LIFE_EDGE_MARGIN };
  angle = angle == null ? Math.random() * Math.PI * 2 : angle;
  return {
    x: p.x, y: p.y, hx: Math.cos(angle), hy: Math.sin(angle), vx: 0, vy: 0,
    wander: angle, turnAt: 0, bright: 0, splitAt: 0, cargo: 0, species,
    alpha: 1, phase: '', blocked: !lifeOpen(Math.round(p.x), Math.round(p.y), 2), eatGlow: 0, birthGlow: 0,
    age: 0, energy: 0.8, maxAge: species.lifespan + Math.random() * 30,
    senseAt: 0, foodTarget: null, preyTarget: null, threat: null, shelterDir: null, attackAt: 0,
    huntMode: 'searching', attackGlow: 0, hitGlow: 0, carcassTarget: null, scavengeAt: 0,
    deathAge: 0, remainsFood: 0
  };
}

function lifeBuildPackets() {
  lifeRefreshKeepOut();
  packetLife.packets.length = 0;
  const count = window.innerWidth < 980 ? 6 : 8;
  for (let n = 0; n < count; n++) {
    const p = lifeNewPacket(n === count - 1 ? LIFE_HUNTER : LIFE_SPECIES[n % LIFE_SPECIES.length]);
    p.age = 12 + Math.random() * 15;
    packetLife.packets.push(p);
  }
}

/* ── the vent ─────────────────────────────────────────────────────────
   A visitor chooses a fixed outlet. Currents carry the food after release,
   but never move its source. A blocked side stays selected and reports it. */
function lifeSetOutletSide(side) {
  if (!LIFE_OUTLET_SIDES.includes(side)) return false;
  packetLife.outletSide = side;
  return true;
}

function lifeVentCell(side = packetLife.outletSide) {
  const box = lifeHabitatBox();
  if (!box) return null;
  const { i0, i1, j0, j1 } = box;
  const ci = Math.round(box.ci), cj = Math.round(box.cj);

  const face = side === 'right' ? { i: i1 + 2, j: cj, nx: 1, ny: 0 }
    : side === 'left' ? { i: i0 - 2, j: cj, nx: -1, ny: 0 }
    : side === 'bottom' ? { i: ci, j: j1 + 2, nx: 0, ny: 1 }
    : { i: ci, j: j0 - 2, nx: 0, ny: -1 };
  return lifeOpen(face.i, face.j, 0) ? face : null;
}

function packetLifeRelease(now) {
  if (!packetLife.enabled) return 0;
  lifeRefreshKeepOut();
  packetLife.lastVentAt = now;
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
    f.age += dt;
    if (f.age > LIFE_FOOD_LIFE) { f.gone = true; food.splice(n, 1); continue; }
    if (f.blocked) continue;
    const c = lifeCurrent(f.x, f.y);
    f.x += c.x * dt * LIFE_FOOD_DRIFT;
    f.y += c.y * dt * LIFE_FOOD_DRIFT;
    if (!lifeOpen(Math.round(f.x), Math.round(f.y), 0)) {
      f.gone = true;
      food.splice(n, 1);
    }
  }
}

function lifeNearestFood(p) {
  let best = -1, bestD2 = p.species.sense * p.species.sense;
  for (let n = 0; n < packetLife.food.length; n++) {
    const f = packetLife.food[n];
    if (f.blocked) continue;
    const dx = f.x - p.x, dy = f.y - p.y, d2 = dx * dx + dy * dy;
    if (d2 < bestD2 && lifeLineClear(p.x, p.y, f.x, f.y)) { best = n; bestD2 = d2; }
  }
  return best;
}

/* Small bounded ecology: no new fluid pass or full-grid field. Only sensing
   searches run at 8 Hz; movement and the scalar energy/age timers stay smooth. */
function lifeRoomAt(x, y, ignore = null) {
  for (const p of packetLife.packets) {
    if (p !== ignore && !p.blocked && (p.x - x) ** 2 + (p.y - y) ** 2 < 6.25) return false;
  }
  for (const egg of packetLife.eggs) {
    if (egg !== ignore && !egg.blocked && (egg.x - x) ** 2 + (egg.y - y) ** 2 < 6.25) return false;
  }
  return true;
}

function lifeLineClear(x0, y0, x1, y1) {
  const steps = Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)));
  for (let n = 1; n <= steps; n++) {
    const t = n / steps;
    if (!lifeOpen(Math.round(x0 + (x1 - x0) * t), Math.round(y0 + (y1 - y0) * t), 0)) return false;
  }
  return true;
}

function lifeActive(p) {
  return p && !p.blocked && p.phase !== 'dying' && p.phase !== 'remains' && p.phase !== 'dead';
}

function lifeSense(p, now) {
  p.senseAt = now + LIFE_SENSE_EVERY;
  p.shelterDir = lifeShelterDir(p);
  p.foodTarget = p.species.hunter ? null : packetLife.food[lifeNearestFood(p)] || null;
  const previousPrey = p.preyTarget;
  p.preyTarget = null; p.threat = null;
  p.carcassTarget = null;
  if (p.species.hunter) {
    if (now < p.attackAt) { p.huntMode = p.attackGlow > 0 ? 'feeding' : 'resting'; return; }
    // Keep an acquired target instead of switching between nearby animals
    // every sensing tick. The pursuit is easier to follow and less twitchy.
    if (lifeActive(previousPrey) && previousPrey.cargo >= 0.35 && previousPrey.age >= 8 &&
        (previousPrey.x - p.x) ** 2 + (previousPrey.y - p.y) ** 2 < (p.species.sense * 1.4) ** 2 &&
        lifeLineClear(p.x, p.y, previousPrey.x, previousPrey.y)) {
      p.preyTarget = previousPrey; p.huntMode = 'chasing'; return;
    }
  }
  let nearest = p.species.sense ** 2;
  for (const q of packetLife.packets) {
    if (p === q || !lifeActive(q)) continue;
    if (p.species.hunter ? q.species.hunter || q.cargo < 0.35 || q.age < 8 : !q.species.hunter) continue;
    const d2 = (q.x - p.x) ** 2 + (q.y - p.y) ** 2;
    if (d2 < nearest && lifeLineClear(p.x, p.y, q.x, q.y)) {
      nearest = d2;
      if (p.species.hunter) p.preyTarget = q;
      else p.threat = q;
    }
  }
  if (p.species.hunter) p.huntMode = p.preyTarget ? 'chasing' : 'searching';
  // Foragers also scavenge; no extra species or unbounded corpse list.
  if (!p.species.hunter && !p.species.splits) {
    let best = p.foodTarget ? (p.foodTarget.x - p.x) ** 2 + (p.foodTarget.y - p.y) ** 2 : p.species.sense ** 2;
    for (const q of packetLife.packets) {
      if (q.phase !== 'remains' || q.blocked || q.remainsFood <= 0) continue;
      const d2 = (q.x - p.x) ** 2 + (q.y - p.y) ** 2;
      if (d2 < best && lifeLineClear(p.x, p.y, q.x, q.y)) { best = d2; p.carcassTarget = q; }
    }
    if (p.carcassTarget) p.foodTarget = null;
  }
}

function lifeLayEgg(p, now) {
  if (!p.species.splits || p.age < 8 || p.energy < 0.55 || p.cargo < 2.8 || now < p.splitAt ||
      packetLife.eggs.length >= LIFE_MAX_EGGS || packetLife.packets.length + packetLife.eggs.length >= LIFE_MAX_PACKETS) return false;
  for (let n = 0; n < 8; n++) {
    const a = p.wander + Math.PI + n * Math.PI / 4;
    const x = Math.round(p.x + Math.cos(a) * 3.5), y = Math.round(p.y + Math.sin(a) * 3.5);
    if (lifeOutsideSpawnArea({ x, y }) || !lifeOpen(x, y, 2) || !lifeRoomAt(x, y)) continue;
    packetLife.eggs.push({ x, y, age: 0, species: p.species, blocked: false, seed: false });
    p.cargo = 1.05; p.energy -= 0.12; p.splitAt = now + 12000;
    packetLife.laid++;
    lifeEvent('A {} laid an o egg — hatching in 4 seconds.', now, 1);
    return true;
  }
  return false;
}

function lifeUpdateEggs(dt, now) {
  for (let n = packetLife.eggs.length - 1; n >= 0; n--) {
    const egg = packetLife.eggs[n];
    if (egg.blocked || !lifeDisplacePoint(egg, 2)) continue;
    egg.age += dt;
    if (egg.age < LIFE_HATCH_TIME || packetLife.packets.length >= LIFE_MAX_PACKETS || !lifeRoomAt(egg.x, egg.y, egg)) continue;
    const child = lifeNewPacket(egg.species, egg.x, egg.y);
    child.cargo = 0.45; child.energy = 0.7;
    child.alpha = 0; child.phase = 'entering'; child.birthGlow = 1.2;
    packetLife.eggs.splice(n, 1);
    packetLife.packets.push(child);
    packetLife.births++;
    lifeEvent(egg.seed ? 'A habitat recovery egg hatched.' : 'A {} hatched — * marks the birth.', now, 2);
  }
}

function lifeSeedHabitat(now) {
  if (now < packetLife.reseedAt) return;
  packetLife.reseedAt = now + 10000;
  if (packetLife.eggs.length >= LIFE_MAX_EGGS || packetLife.packets.length + packetLife.eggs.length >= LIFE_MAX_PACKETS) return;
  let prey = 0, hunters = 0;
  for (const p of [...packetLife.packets, ...packetLife.eggs]) {
    if (p.phase === 'dying' || p.phase === 'remains') continue;
    if (p.species.hunter) hunters++; else prey++;
  }
  const species = prey < 3 ? LIFE_SPECIES[prey % 2] : hunters < 1 ? LIFE_HUNTER : null;
  if (!species) return;
  const pos = lifeShelteredCell();
  if (!pos) return;
  packetLife.eggs.push({ ...pos, age: 0, species, blocked: false, seed: true });
  lifeEvent('Habitat recovery — a new egg is growing.', now);
}

function lifeReturnNutrients(p) {
  for (let n = 0; n < p.remainsFood; n++) {
    if (packetLife.food.length >= LIFE_MAX_FOOD || !lifeOpen(Math.round(p.x + n), Math.round(p.y), 0)) break;
    packetLife.food.push({ x: p.x + n, y: p.y, age: 0 });
  }
}

function lifeBeginDeath(p, now) {
  p.phase = 'dying'; p.deathAge = 0; p.alpha = 1;
  p.vx = 0; p.vy = 0;
  p.remainsFood = Math.max(1, Math.min(2, Math.ceil(p.cargo)));
  p.attackGlow = 0; p.hitGlow = 0;
  packetLife.deaths++;
  lifeEvent(p.species.empty + ' died: ' + (p.energy === 0 ? 'starvation' : 'old age') + ' — x marks the remains.', now, 3);
}

/* ── lifecycle ────────────────────────────────────────────────────── */
function packetLifeSetEnabled(on, el) {
  if (!on) {
    packetLife.enabled = false;
    packetLife.venting = false;
    packetLife.food.length = 0;
    packetLife.packets.length = 0;
    packetLife.eggs.length = 0;
    packetLife.released = 0;
    packetLife.eaten = 0;
    packetLife.births = 0;
    packetLife.deaths = 0;
    packetLife.laid = 0;
    packetLife.reseedAt = 0;
    packetLife.lastEvent = '';
    packetLife.eventUntil = 0;
    packetLife.eventPriority = 0;
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
  packetLife.eaten = 0;
  packetLife.births = 0;
  packetLife.deaths = 0;
  packetLife.laid = 0;
  packetLife.eggs.length = 0;
  packetLife.reseedAt = performance.now() + 10000;
  packetLife.lastEvent = '';
  packetLife.eventUntil = 0;
  packetLife.eventPriority = 0;
  lifeBuildPackets();
  // Choose a usable side once at opening. Dragging or changing the current
  // never changes this choice; the four controls belong to the visitor.
  packetLife.outletSide = ['right', 'bottom', 'left', 'top'].find(side => lifeVentCell(side)) || 'right';
  return { ok: true, message: 'habitat open — they shelter in the panel\'s wake' };
}

function packetLifeUpdate(dt, now) {
  if (!packetLife.enabled) return;
  dt = Math.min(dt, 0.05);
  if (dt <= 0) return;

  lifeRefreshKeepOut();
  lifeVentFrame(now);
  lifeAdvectFood(dt);
  lifeUpdateEggs(dt, now);
  lifeSeedHabitat(now);

  const packets = packetLife.packets;
  for (let n = 0; n < packets.length; n++) {
    const p = packets[n];
    const sp = p.species;

    lifeContainPoint(p);
    if (p.blocked) continue;  // retry when the geometry changes
    if (!lifeDisplacePoint(p, 2)) continue;
    if (p.phase !== 'dying' && p.phase !== 'remains') {
      p.age += dt;
      p.energy = Math.max(0, Math.min(1, p.energy + dt * (p.cargo > 0.1 ? 0.018 : -sp.metabolism)));
      if (p.energy === 0 || p.age >= p.maxAge) {
        lifeBeginDeath(p, now);
      }
    }
    if (p.phase === 'dying' || p.phase === 'remains') {
      p.deathAge += dt;
      if (p.deathAge >= 0.8) p.phase = 'remains';
      if (p.remainsFood === 0 && p.deathAge >= 2.5) p.deathAge = Math.max(p.deathAge, LIFE_REMAINS_TIME - 1);
      p.alpha = Math.max(0.35, Math.min(1, LIFE_REMAINS_TIME - p.deathAge));
      if (p.deathAge >= LIFE_REMAINS_TIME) {
        lifeReturnNutrients(p);
        lifeEvent(p.remainsFood ? 'Remains broke down into food dots.' : '<> cleared the remains by scavenging.', now, 2);
        p.phase = 'dead'; packets.splice(n--, 1);
      }
      continue;
    }
    if (p.phase === 'entering') {
      p.alpha = Math.min(1, p.alpha + dt / 0.4);
      if (p.alpha === 1) p.phase = '';
    }
    p.eatGlow = Math.max(0, p.eatGlow - dt);
    p.birthGlow = Math.max(0, p.birthGlow - dt);
    p.attackGlow = Math.max(0, p.attackGlow - dt);
    p.hitGlow = Math.max(0, p.hitGlow - dt);
    if (now >= p.senseAt) { lifeSense(p, now); lifeLayEgg(p, now); }

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
    const sh = p.shelterDir;
    if (sh.relief > LIFE_SHELTER_EPS) {
      const w = sp.shelter * Math.min(1, sh.relief / LIFE_SHELTER_FULL);
      tx = tx * (1 - w) + sh.x * w;
      ty = ty * (1 - w) + sh.y * w;
    }

    /* Food outranks shelter — a hungry animal will leave the lee for it, and
       that's the moment the mechanic is built around: you steer a plume past
       the shelter and watch them break cover to intercept it. */
    const f = p.foodTarget;
    if (f && !f.gone && !f.blocked && p.cargo < 2.7) {
      const dx = f.x - p.x, dy = f.y - p.y;
      const inv = 1 / Math.max(0.001, Math.sqrt(dx * dx + dy * dy));
      tx = tx * (1 - sp.foodWeight) + dx * inv * sp.foodWeight;
      ty = ty * (1 - sp.foodWeight) + dy * inv * sp.foodWeight;

      if (dx * dx + dy * dy < 0.8) {
        const foodIndex = packetLife.food.indexOf(f);
        if (foodIndex >= 0) packetLife.food.splice(foodIndex, 1);
        f.gone = true; p.foodTarget = null;
        p.cargo = Math.min(3, p.cargo + 1);
        p.energy = Math.min(1, p.energy + 0.25);
        p.bright = 0.85;
        p.eatGlow = 0.45;
        packetLife.eaten++;
        lifeEvent('Food eaten — + marks the bite.', now);
        lifeLayEgg(p, now);
      }
    }

    const carcass = p.carcassTarget;
    if (carcass && carcass.phase === 'remains' && !carcass.blocked && carcass.remainsFood > 0 && p.cargo < 2.7) {
      const dx = carcass.x - p.x, dy = carcass.y - p.y, d = Math.max(0.001, Math.hypot(dx, dy));
      tx = tx * 0.2 + dx / d * 0.8; ty = ty * 0.2 + dy / d * 0.8;
      if (d < 1.25 && now >= p.scavengeAt && lifeLineClear(p.x, p.y, carcass.x, carcass.y)) {
        carcass.remainsFood--;
        p.cargo = Math.min(3, p.cargo + 0.7); p.energy = Math.min(1, p.energy + 0.2);
        p.eatGlow = 0.65; p.bright = 0.65; p.scavengeAt = now + 1000;
        packetLife.eaten++;
        lifeEvent('<> scavenged the x remains.', now, 2);
      }
    }

    const prey = p.preyTarget;
    if (sp.hunter && now >= p.attackAt && lifeActive(prey) && prey.cargo >= 0.35) {
      p.huntMode = 'chasing';
      const dx = prey.x - p.x, dy = prey.y - p.y, d = Math.max(0.001, Math.hypot(dx, dy));
      tx = tx * 0.25 + dx / d * 0.75; ty = ty * 0.25 + dy / d * 0.75;
      if (d < 1.25 && now >= p.attackAt && lifeLineClear(p.x, p.y, prey.x, prey.y)) {
        const stolen = Math.min(0.8, prey.cargo);
        prey.cargo -= stolen; prey.energy = Math.max(0, prey.energy - 0.12);
        p.cargo = Math.min(3, p.cargo + stolen); p.energy = Math.min(1, p.energy + 0.3);
        p.attackAt = now + LIFE_ATTACK_EVERY; p.bright = 0.7;
        p.attackGlow = 0.9; prey.hitGlow = 0.9;
        p.huntMode = 'feeding'; p.preyTarget = null;
        lifeEvent('@ stole a meal — ! marks the bite.', now, 2);
      }
    } else if (sp.hunter) {
      p.huntMode = p.attackGlow > 0 ? 'feeding' : now < p.attackAt ? 'resting' : 'searching';
      p.preyTarget = null;
    }
    const threat = p.threat;
    if (!sp.hunter && lifeActive(threat)) {
      const dx = p.x - threat.x, dy = p.y - threat.y, d = Math.max(0.001, Math.hypot(dx, dy));
      if (d < sp.sense * 1.3) { tx = tx * 0.2 + dx / d * 0.8; ty = ty * 0.2 + dy / d * 0.8; }
    }

    /* Movement reads the capped current; the share reads the true one. An
       organism in water moving at 40 cell/s is cargo whether or not we're
       willing to move it that fast. */
    const current = lifeCurrent(p.x, p.y);
    const edge = lifeEdgeDirection(p);
    // Taper just the flow component that pushes out of the viewport. The
    // tangential current stays intact, letting animals swim along the edge.
    if (current.x * edge.x < 0) current.x *= 1 - Math.abs(edge.x);
    if (current.y * edge.y < 0) current.y *= 1 - Math.abs(edge.y);
    const capped = Math.sqrt(current.x * current.x + current.y * current.y);
    const swimSpeed = sp.speed * (sp.hunter && p.huntMode === 'chasing' ? 1.4 : p.hitGlow > 0 ? 1.25 : 1);
    const share = lifeCurrentShare(lifeFlowSpeed(p.x, p.y), swimSpeed);

    if (capped > 0.01) {
      tx = tx * (1 - share) + current.x / capped * share;
      ty = ty * (1 - share) + current.y / capped * share;
    }
    const edgeWeight = Math.max(Math.abs(edge.x), Math.abs(edge.y));
    tx = tx * (1 - edgeWeight) + edge.x * 1.4;
    ty = ty * (1 - edgeWeight) + edge.y * 1.4;
    const mag = Math.max(0.001, Math.sqrt(tx * tx + ty * ty)); tx /= mag; ty /= mag;

    const heading = Math.atan2(p.hy, p.hx), desired = Math.atan2(ty, tx);
    const delta = Math.atan2(Math.sin(desired - heading), Math.cos(desired - heading));
    const angle = heading + Math.max(-dt * sp.turn, Math.min(dt * sp.turn, delta));
    p.hx = Math.cos(angle); p.hy = Math.sin(angle);

    const targetVX = current.x * share + p.hx * swimSpeed;
    const targetVY = current.y * share + p.hy * swimSpeed;
    const inertia = Math.min(1, dt * (2.4 + sp.turn * 0.35));
    p.vx += (targetVX - p.vx) * inertia;
    p.vy += (targetVY - p.vy) * inertia;

    const bounds = lifeScreenBounds();
    const rawX = p.x + p.vx * dt, rawY = p.y + p.vy * dt;
    const nx = Math.max(bounds.left, Math.min(bounds.right, rawX));
    const ny = Math.max(bounds.top, Math.min(bounds.bottom, rawY));
    if (lifeOpen(Math.round(nx), Math.round(ny), 2)) { p.x = nx; p.y = ny; }
    else {
      // Slide along a panel rather than reversing both components. This
      // matters in the narrow strip between a dragged panel and the screen.
      if (Math.abs(nx - p.x) > 1e-6 && lifeOpen(Math.round(nx), Math.round(p.y), 2)) {
        p.x = nx; p.vy *= -0.28;
      } else if (Math.abs(ny - p.y) > 1e-6 && lifeOpen(Math.round(p.x), Math.round(ny), 2)) {
        p.y = ny; p.vx *= -0.28;
      } else {
        p.vx *= -0.28; p.vy *= -0.28;
        p.wander += Math.PI * (0.55 + Math.random() * 0.4); p.turnAt = now;
      }
    }
    lifeContainPoint(p);

    p.bright = Math.max(0, p.bright - dt);
    p.cargo = Math.max(0, p.cargo - dt * 0.17);   // digestion fuels energy

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
   Most organisms use the same heading lookup table as the fluid. Stable
   hunter/remains colours and brief bite marks make ecology events legible. */
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
  ctx.globalAlpha = 1;

  for (let n = 0; n < packetLife.food.length; n++) {
    const f = packetLife.food[n];
    if (f.blocked || !lifeOpen(Math.round(f.x), Math.round(f.y), 0)) continue;
    // Inert matter, so it gets no hue — just a dot that dims as it goes off.
    ctx.fillStyle = f.age < LIFE_FOOD_LIFE * 0.45 ? '#8d97a6' : '#565f6b';
    ctx.fillText('.', Math.round(f.x) * CW, Math.round(f.y) * CH);
  }

  for (const egg of packetLife.eggs) {
    if (egg.blocked || !lifeOpen(Math.round(egg.x), Math.round(egg.y), 2)) continue;
    ctx.fillStyle = lifeInk(0, -1, 0.8);
    ctx.globalAlpha = Math.min(1, egg.age / 0.3);
    ctx.fillText('o', Math.round(egg.x) * CW, Math.round(egg.y) * CH);
  }
  ctx.globalAlpha = 1;

  for (let n = 0; n < packetLife.packets.length; n++) {
    const p = packetLife.packets[n];
    if (p.blocked || !lifeOpen(Math.round(p.x), Math.round(p.y), 2)) continue;
    if (p.phase === 'dying' || p.phase === 'remains') {
      ctx.fillStyle = p.deathAge < 0.8 ? '#ffc9b8' : '#a6a0a0';
      ctx.globalAlpha = p.alpha;
      ctx.fillText(p.deathAge >= LIFE_REMAINS_TIME - 1 ? ':' : 'x', Math.round(p.x) * CW, Math.round(p.y) * CH);
      ctx.globalAlpha = 1;
      continue;
    }
    let sprite = p.species.empty;
    if (!p.species.hunter && p.cargo > 0.08) {
      sprite = p.species.left + (p.cargo > 2 ? '#' : p.cargo > 1 ? '+' : '.') + p.species.right;
    }
    if (p.species.hunter) {
      if (p.attackGlow > 0) sprite = '@!';
      else if (p.huntMode === 'chasing' && lifeActive(p.preyTarget)) {
        const dx = p.preyTarget.x - p.x, dy = p.preyTarget.y - p.y;
        sprite = Math.abs(dx) >= Math.abs(dy) ? (dx >= 0 ? '@>' : '<@') : (dy >= 0 ? '@v' : '@^');
      }
    }
    ctx.fillStyle = p.species.hunter ? (p.attackGlow > 0 ? '#ff8c75' : '#ffb86b')
      : p.hitGlow > 0 ? '#ffd1a1' : lifeInk(p.hx, p.hy, p.bright > 0 ? 1 : 0.45 + p.energy * 0.27);
    ctx.globalAlpha = p.alpha;
    ctx.fillText(sprite, Math.round(p.x) * CW, Math.round(p.y) * CH);
    if ((p.hitGlow > 0 || p.birthGlow > 0 || p.eatGlow > 0) && lifeOpen(Math.round(p.x) + 1, Math.round(p.y) - 1, 0)) {
      ctx.globalAlpha = p.alpha * Math.min(1, p.hitGlow > 0 ? p.hitGlow / 0.9 : p.birthGlow > 0 ? p.birthGlow / 1.2 : p.eatGlow / 0.45);
      ctx.fillText(p.hitGlow > 0 ? '!' : p.birthGlow > 0 ? '*' : '+', (Math.round(p.x) + 1) * CW, (Math.round(p.y) - 1) * CH);
    }
    ctx.globalAlpha = 1;
  }
}

/* ── readouts, for the panel ─────────────────────────────────────── */
function lifeStats() {
  const packets = packetLife.packets;
  let shelter = 0, fed = 0, energy = 0, hunters = 0, pop = 0, remains = 0, hunterState = 'none';
  for (let n = 0; n < packets.length; n++) {
    if (packets[n].phase === 'dying' || packets[n].phase === 'remains') { remains++; continue; }
    pop++;
    shelter += lifeFlowSpeed(packets[n].x, packets[n].y);
    fed += packets[n].cargo;
    energy += packets[n].energy;
    if (packets[n].species.hunter) { hunters++; hunterState = packets[n].huntMode; }
  }
  const c = pop || 1;
  return {
    pop,
    remains,
    occupied: packets.length + packetLife.eggs.length,
    eggs: packetLife.eggs.length,
    hunters,
    hunterState,
    energy: energy / c,
    adrift: packetLife.food.length,
    released: packetLife.released,
    eaten: packetLife.eaten,
    births: packetLife.births,
    deaths: packetLife.deaths,
    shelter: shelter / c,
    fed: fed / c
  };
}
