/* packetLife.js — optional digital microfauna coupled to the fluid field.

   Packets are advected by the velocity grid, then write a small continuous
   tail force and pigment back into the solver's regular source buffers. */

const packetLife = {
  enabled: false,
  packets: [],
  food: [],
  lastFoodAt: 0,
  lastPointerI: -1,
  lastPointerJ: -1
};

const LIFE_MAX_FOOD = 42;
const LIFE_TRAIL = 4;
const LIFE_MAX_PACKETS = 14;
/* The solver advances at 30 Hz with P.dt as its simulation timestep. Convert
   its normalised velocity into the grid-cells-per-second used by life. */
const LIFE_SOLVER_HZ = 30;
const LIFE_MAX_CURRENT = 16;
const LIFE_CURRENT_SHARE = 0.78;
const LIFE_TRAIL_PIGMENT = 0.34;
/* Abstract microfauna: different glyphs, appetites and movement rhythms,
   without turning the field into a literal aquarium. */
const LIFE_SPECIES = [
  { empty: '<>', left: '<', right: '>', color: '#a9cbd8', bright: '#e5f7ff', trail: '#426271', speed: 0.55, turn: 4.4, sense: 5.0, trailEvery: 95, wakeEvery: 420, foodWeight: 0.55, space: 2.2 },
  { empty: '[-]', left: '[', right: ']', color: '#d0bd98', bright: '#fff0ca', trail: '#665841', speed: 0.34, turn: 1.9, sense: 7.1, trailEvery: 175, wakeEvery: 720, foodWeight: 0.62, space: 2.8 },
  { empty: '{}', left: '{', right: '}', color: '#c7b4d7', bright: '#f0e1ff', trail: '#574965', speed: 0.62, turn: 3.0, sense: 6.0, trailEvery: 125, wakeEvery: 560, foodWeight: 0.46, space: 2.4, splits: true },
  { empty: ':>', left: ':', right: '>', color: '#a8d1b1', bright: '#e1ffdf', trail: '#3e6048', speed: 0.72, turn: 5.6, sense: 4.1, trailEvery: 85, wakeEvery: 360, foodWeight: 0.36, space: 2.0 },
  { empty: '~~', left: '~', right: '~', color: '#c1b7a5', bright: '#fff5df', trail: '#625b50', speed: 0.42, turn: 1.25, sense: 8.0, trailEvery: 210, wakeEvery: 840, foodWeight: 0.68, space: 3.0 }
];
const LIFE_HUNTER = { empty: '@', color: '#dc9eb4', bright: '#ffe0ec', trail: '#744554', speed: 1.85, turn: 4.8, sense: 9.0, trailEvery: 105, wakeEvery: 390, space: 3.3, hunter: true };

function lifeIsAvailable() {
  return !REDUCED && window.innerWidth >= 760;
}

function lifeOpen(i, j, width) {
  if (i < 2 || j < 2 || i + width >= COLS - 2 || j >= ROWS - 2) return false;
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
   weakening the field everywhere. */
function lifeCurrent(x, y) {
  const flow = lifeVelocity(x, y);
  const scale = P.dt * LIFE_SOLVER_HZ;
  const cap = value => Math.max(-LIFE_MAX_CURRENT, Math.min(LIFE_MAX_CURRENT, value));
  return { x: cap(flow.x * (COLS - 2) * scale), y: cap(flow.y * (ROWS - 2) * scale) };
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
  const p = x == null ? lifeFindOpen(2) : { x, y };
  angle = angle == null ? Math.random() * Math.PI * 2 : angle;
  return {
      x: p.x, y: p.y, hx: Math.cos(angle), hy: Math.sin(angle), vx: 0, vy: 0,
      wander: angle, turnAt: 0, bright: 0, trailAt: 0, splitAt: 0, cargo: 0,
      species,
      tx: new Float32Array(LIFE_TRAIL), ty: new Float32Array(LIFE_TRAIL), trailHead: 0
  };
}

function lifeBuildPackets() {
  packetLife.packets.length = 0;
  const count = window.innerWidth < 980 ? 9 : 12;
  for (let n = 0; n < count; n++) {
    // Keep population fixed: the second hunter replaces a prey slot.
    const species = n >= count - 2 ? LIFE_HUNTER : LIFE_SPECIES[n % LIFE_SPECIES.length];
    packetLife.packets.push(lifeNewPacket(species));
  }
}

function packetLifeSetEnabled(on) {
  if (!on) {
    packetLife.enabled = false;
    packetLife.food.length = 0;
    return { ok: true, message: 'packet life off' };
  }
  if (!lifeIsAvailable()) return { ok: false, message: REDUCED ? 'packet life respects reduced motion' : 'packet life is desktop-only' };
  packetLife.enabled = true;
  lifeBuildPackets();
  return { ok: true, message: 'packet life on — click or hold in the background to release dots' };
}

function packetLifePointer(i, j) {
  if (i >= 0 && i < COLS && j >= 0 && j < ROWS && lifeOpen(i, j, 0)) {
    packetLife.lastPointerI = i;
    packetLife.lastPointerJ = j;
  }
}

function packetLifeDropFood(i, j, now) {
  if (!packetLife.enabled || now - packetLife.lastFoodAt < 150) return;
  if (!lifeOpen(i, j, 0)) return;
  packetLife.lastFoodAt = now;
  for (let n = 0; n < 4 && packetLife.food.length < LIFE_MAX_FOOD; n++) {
    const a = Math.random() * Math.PI * 2, r = Math.random() * 1.7;
    const x = i + Math.cos(a) * r, y = j + Math.sin(a) * r;
    if (lifeOpen(Math.round(x), Math.round(y), 0)) packetLife.food.push({ x, y, age: 0 });
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

function packetLifeUpdate(dt, now) {
  if (!packetLife.enabled) return;
  dt = Math.min(dt, 0.05);
  for (let n = packetLife.food.length - 1; n >= 0; n--) {
    const f = packetLife.food[n];
    f.age += dt;
    // Food is an intentional stationary resource patch: the current may carry
    // organisms away from it, but it never smears or drifts out from the click.
    if (f.age > 18 || !lifeOpen(Math.round(f.x), Math.round(f.y), 0)) packetLife.food.splice(n, 1);
  }

  const packetCount = packetLife.packets.length;
  for (let n = 0; n < packetCount; n++) {
    const p = packetLife.packets[n];
    /* A resize can move the panel mask over an existing packet. Relocate it
       before drawing so packets never sit on readable panel content. */
    if (!lifeOpen(Math.round(p.x), Math.round(p.y), 2)) {
      const open = lifeFindOpen(2);
      p.x = open.x; p.y = open.y;
    }
    if (now >= p.turnAt) {
      p.wander += (Math.random() - 0.5) * 1.15;
      p.turnAt = now + 500 + Math.random() * 950;
    }
    let tx = Math.cos(p.wander), ty = Math.sin(p.wander);
    /* A little personal space makes food gatherings read as behavior rather
       than a single pile of glyphs. This is visual-only, not a collision sim. */
    let awayX = 0, awayY = 0;
    const space2 = p.species.space * p.species.space;
    for (let qn = 0; qn < packetLife.packets.length; qn++) {
      if (qn === n) continue;
      const q = packetLife.packets[qn], dx = p.x - q.x, dy = p.y - q.y, d2 = dx * dx + dy * dy;
      if (d2 > 0.01 && d2 < space2) { awayX += dx / d2; awayY += dy / d2; }
    }
    tx += awayX * 0.16; ty += awayY * 0.16;
    if (p.species.hunter) {
      let target = -1, targetD2 = p.species.sense * p.species.sense;
      for (let qn = 0; qn < packetCount; qn++) {
        const q = packetLife.packets[qn];
        if (qn === n || q.species.hunter || q.cargo < 0.8) continue;
        const dx = q.x - p.x, dy = q.y - p.y, d2 = dx * dx + dy * dy;
        if (d2 < targetD2) { target = qn; targetD2 = d2; }
      }
      if (target >= 0) {
        const q = packetLife.packets[target], dx = q.x - p.x, dy = q.y - p.y;
        const inv = 1 / Math.max(0.001, Math.sqrt(dx * dx + dy * dy));
        tx = tx * 0.35 + dx * inv * 0.65; ty = ty * 0.35 + dy * inv * 0.65;
        if (targetD2 < 0.85) { q.cargo = Math.max(0, q.cargo - 1); q.bright = 0.28; p.bright = 0.7; }
      }
    }
    const foodIndex = lifeNearestFood(p);
    if (!p.species.hunter && foodIndex >= 0 && p.cargo < 2.7) {
      const f = packetLife.food[foodIndex], dx = f.x - p.x, dy = f.y - p.y;
      const inv = 1 / Math.max(0.001, Math.sqrt(dx * dx + dy * dy));
      tx = tx * (1 - p.species.foodWeight) + dx * inv * p.species.foodWeight;
      ty = ty * (1 - p.species.foodWeight) + dy * inv * p.species.foodWeight;
      if (dx * dx + dy * dy < 0.7) {
        packetLife.food.splice(foodIndex, 1);
        p.cargo = Math.min(3, p.cargo + 1);
        p.bright = 0.85;
        if (p.species.splits && p.cargo >= 2.8 && now >= p.splitAt && packetLife.packets.length < LIFE_MAX_PACKETS) {
          const a = p.wander + Math.PI * (0.65 + Math.random() * 0.7);
          const childX = p.x + Math.cos(a) * 1.5, childY = p.y + Math.sin(a) * 1.5;
          if (lifeOpen(Math.round(childX), Math.round(childY), 2)) {
            const child = lifeNewPacket(p.species, childX, childY, a);
            child.cargo = 0.45; child.bright = 0.7;
            packetLife.packets.push(child);
            p.cargo = 1.05; p.splitAt = now + 12000;
          }
        }
      }
    }
    const current = lifeCurrent(p.x, p.y);
    const currentLength = Math.sqrt(current.x * current.x + current.y * current.y);
    /* A packet can want something (food, space, wandering), but the current
       is the dominant movement. This makes a wake carry and turn it instead
       of merely colouring the background behind an autonomous sprite. */
    if (currentLength > 0.01) {
      tx = tx * (1 - LIFE_CURRENT_SHARE) + current.x / currentLength * LIFE_CURRENT_SHARE;
      ty = ty * (1 - LIFE_CURRENT_SHARE) + current.y / currentLength * LIFE_CURRENT_SHARE;
    }
    const mag = Math.max(0.001, Math.sqrt(tx * tx + ty * ty)); tx /= mag; ty /= mag;
    const turn = Math.min(1, dt * p.species.turn);
    p.hx += (tx - p.hx) * turn; p.hy += (ty - p.hy) * turn;
    const heading = Math.max(0.001, Math.sqrt(p.hx * p.hx + p.hy * p.hy)); p.hx /= heading; p.hy /= heading;
    const targetVX = current.x * LIFE_CURRENT_SHARE + p.hx * p.species.speed;
    const targetVY = current.y * LIFE_CURRENT_SHARE + p.hy * p.species.speed;
    const inertia = Math.min(1, dt * (2.4 + p.species.turn * 0.35));
    p.vx += (targetVX - p.vx) * inertia;
    p.vy += (targetVY - p.vy) * inertia;
    const nx = p.x + p.vx * dt;
    const ny = p.y + p.vy * dt;
    if (lifeOpen(Math.round(nx), Math.round(ny), 2)) { p.x = nx; p.y = ny; }
    else {
      p.vx *= -0.28; p.vy *= -0.28;
      p.wander += Math.PI * (0.55 + Math.random() * 0.4); p.turnAt = now;
    }
    p.bright = Math.max(0, p.bright - dt);
    p.cargo = Math.max(0, p.cargo - dt * 0.17); // digestion, not a score/health system
    /* This is real solver density, not a drawn line. It deliberately adds no
       velocity: a packet must not be carried by a current it made itself.
       The pigment still advects with any real ambient or pointer-driven flow. */
    const wake = Math.min(1.5, dt * LIFE_SOLVER_HZ);
    emit(Math.round(p.x - p.hx * 1.15), Math.round(p.y - p.hy * 1.15), 2,
      LIFE_TRAIL_PIGMENT * wake, 0, 0);
    if (now >= p.trailAt) {
      p.tx[p.trailHead] = p.x; p.ty[p.trailHead] = p.y;
      p.trailHead = (p.trailHead + 1) % LIFE_TRAIL; p.trailAt = now + p.species.trailEvery;
    }
  }
}

function packetLifeRender() {
  if (!packetLife.enabled) return;
  ctx.textAlign = 'left'; ctx.textBaseline = 'top';
  for (let n = 0; n < packetLife.food.length; n++) {
    const f = packetLife.food[n];
    ctx.fillStyle = f.age < 7.5 ? '#9ca9b8' : '#5e6874';
    ctx.fillText('.', Math.round(f.x) * CW, Math.round(f.y) * CH);
  }
  for (let n = 0; n < packetLife.packets.length; n++) {
    const p = packetLife.packets[n];
    for (let t = 0; t < LIFE_TRAIL; t++) {
      const k = (p.trailHead + t) % LIFE_TRAIL;
      if (p.tx[k] || p.ty[k]) { ctx.fillStyle = t < 2 ? '#303942' : p.species.trail; ctx.fillText('.', Math.round(p.tx[k]) * CW, Math.round(p.ty[k]) * CH); }
    }
    let sprite = p.species.empty;
    if (!p.species.hunter && p.cargo > 0.08) sprite = p.species.left + (p.cargo > 2 ? '#' : p.cargo > 1 ? '+' : '.') + p.species.right;
    ctx.fillStyle = p.bright > 0 ? p.species.bright : p.species.color;
    ctx.fillText(sprite, Math.round(p.x) * CW, Math.round(p.y) * CH);
  }
}
