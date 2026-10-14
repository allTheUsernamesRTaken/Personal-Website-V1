const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const scripts = path.join(__dirname, '../fluid-site/frontend/js/fluid');
function setup() {
  let seed = 12345;
  const math = Object.create(Math);
  math.random = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  const listeners = {};
  const main = { isConnected: true, getBoundingClientRect: () => ({ left: 55, right: 550, top: 84, bottom: 756 }) };
  const habitat = { isConnected: true, rect: { left: 858, right: 1166, top: 252, bottom: 576 }, getBoundingClientRect() { return this.rect; } };
  const draws = [];
  const ctx = { setTransform() {}, fillText(glyph) { draws.push({ glyph, alpha: this.globalAlpha, color: this.fillStyle }); } };
  const calls = { steps: 0, intro: 0, lifeTime: 0 };
  const c = vm.createContext({
    Math: math, performance: { now: () => 1000 }, setTimeout, clearTimeout, habitat, calls,
    document: {
      getElementById: id => id === 'panel' ? main : { getContext: () => ctx },
      addEventListener: (name, fn) => { listeners[name] = fn; }
    },
    window: {
      innerWidth: 1320, innerHeight: 840, devicePixelRatio: 1,
      matchMedia: () => ({ matches: false }), addEventListener: (name, fn) => { listeners[name] = fn; }
    },
    requestAnimationFrame() {},
    step() { calls.steps++; }, introFrame() { calls.intro++; }, render() {},
    charFrameFrame() {}, tickFrame() {}, glassFrame() {}, panelsFrame() {}, hudFrame() {}
  });
  const run = source => vm.runInContext(source, c);
  const load = name => vm.runInContext(fs.readFileSync(path.join(scripts, name), 'utf8'), c, { filename: name });
  for (const name of ['constants.js', 'grid.js', 'solids.js', 'packetLife.js']) load(name);
  run(`const LUT_T=8, LUT_B=8, LUT_BY_DIR=false, LUT=Array(64).fill('#ccc');
       registerSolid(habitat); rebuildSolids(); packetLifeSetEnabled(true, habitat);`);
  return { c, calls, listeners, draws, run, load };
}

test('a dragged panel pushes locally and preserves the creature and its feeding state', () => {
  const { run } = setup();
  run(`const p=lifeNewPacket(LIFE_SPECIES[1],75,35,0);
       p.cargo=2; p.splitAt=12000; p.vx=3; p.vy=2; packetLife.packets=[p];
       habitat.rect={left:847,right:1155,top:252,bottom:576}; rebuildSolids();`);
  assert.equal(run('packetLife.packets[0] === p'), true);
  assert.equal(run('p.x'), 74);
  assert.equal(run('p.y'), 35);
  assert.equal(run('p.cargo'), 2);
  assert.equal(run('p.splitAt'), 12000);
  assert.equal(run('p.vx'), 0);
  assert.equal(run('p.vy'), 2);
  assert.equal(run('packetLife.births'), 0);
  assert.equal(run('lifeOpen(Math.round(p.x),Math.round(p.y),2)'), true);
});

test('deep overlap uses the closest free edge instead of returning to the habitat spawn', () => {
  const { run } = setup();
  run(`const p=lifeNewPacket(LIFE_SPECIES[0],70,20,0); p.cargo=2; packetLife.packets=[p];
       habitat.rect={left:726,right:1034,top:168,bottom:480}; rebuildSolids();`);
  assert.equal(run('Math.hypot(p.x-70,p.y-20)'), 7);
  assert.equal(run('p.cargo'), 2);
});

test('blocked creatures wait without being reset and resume when space opens', () => {
  const { run } = setup();
  run(`const p=packetLife.packets[0];p.cargo=2;
       const cover={isConnected:true,getBoundingClientRect:()=>({left:0,right:1320,top:0,bottom:840})};
       registerSolid(cover);rebuildSolids();packetLifeUpdate(1/60,1000);`);
  assert.equal(run('p.blocked'), true);
  assert.equal(run('p.cargo'), 2);
  run('unregisterSolid(cover);rebuildSolids();');
  assert.equal(run('p.blocked'), false);
  assert.equal(run('p.cargo'), 2);
});

test('a panel also pushes existing food without resetting its age', () => {
  const { run } = setup();
  run(`const f={x:77,y:35,age:4};packetLife.food=[f];
       habitat.rect={left:847,right:1155,top:252,bottom:576};rebuildSolids();`);
  assert.equal(run('packetLife.food.length'), 1);
  assert.equal(run('f.x'), 76);
  assert.equal(run('f.age'), 4);
});

test('displacement respects overlapping panels and the main-panel keep-out area', () => {
  const { run } = setup();
  run(`const p=lifeNewPacket(LIFE_SPECIES[0],60,35,0);packetLife.packets=[p];
       const cover={isConnected:true,getBoundingClientRect:()=>({left:550,right:660,top:336,bottom:504})};
       registerSolid(cover);rebuildSolids();`);
  assert.equal(run('lifeOpen(p.x,p.y,2)'), true);
  assert.ok(run('p.x') > 59); // the main panel blocks the apparently nearer left exit
});

test('temporarily blocked food still expires and cannot attract creatures through a wall', () => {
  const { run } = setup();
  run(`const p=lifeNewPacket(LIFE_SPECIES[0],60,20,0);
       packetLife.food=[{x:60,y:20,age:LIFE_FOOD_LIFE-0.01,blocked:true}];`);
  assert.equal(run('lifeNearestFood(p)'), -1);
  run('lifeAdvectFood(1/60);');
  assert.equal(run('packetLife.food.length'), 0);
});

test('all screen edges and corners keep the same creature visible without resetting food or age', () => {
  for (const [x,y,vx,vy] of [[2.1,35,-20,0],[114.9,35,20,0],[110,2.1,0,-20],[110,66.9,0,20],
    [2.1,2.1,-20,-20],[114.9,2.1,20,-20],[2.1,66.9,-20,20],[114.9,66.9,20,20]]) {
    const { run } = setup();
    run(`const p=lifeNewPacket(LIFE_SPECIES[0],${x},${y},0);p.age=12;p.cargo=2;p.splitAt=12000;
         p.vx=${vx};p.vy=${vy};packetLife.packets=[p];
         for(let n=0;n<60;n++)packetLifeUpdate(1/60,1000+n*1000/60);`);
    assert.equal(run('packetLife.packets[0] === p'), true);
    assert.equal(run('p.phase'), '');
    assert.equal(run('p.alpha'), 1);
    assert.ok(run('p.cargo') > 1.8);
    assert.ok(run('p.age') > 12.9);
    assert.equal(run('p.splitAt'), 12000);
    assert.equal(run('packetLife.births+packetLife.deaths'), 0);
    assert.equal(run('lifeOpen(Math.round(p.x),Math.round(p.y),2)'), true);
  }
});

test('strong outward flow cannot sweep a creature through the bottom-right boundary', () => {
  const { run } = setup();
  run(`const p=lifeNewPacket(LIFE_SPECIES[0],113,65,Math.PI/4);packetLife.packets=[p];vx.fill(0.5);vy.fill(0.5);
       for(let n=0;n<600;n++){
         packetLifeUpdate(1/60,1000+n*1000/60);
         const b=lifeScreenBounds();
         if(p.x<b.left||p.x>b.right||p.y<b.top||p.y>b.bottom||p.alpha!==1)throw new Error('Creature left the viewport or faded');
       }`);
  assert.equal(run('packetLife.packets[0] === p'), true);
  assert.equal(run('packetLife.deaths+packetLife.births'), 0);
});

test('a panel can push a creature to the bottom boundary without despawning it', () => {
  const { run } = setup();
  run(`const p=lifeNewPacket(LIFE_SPECIES[0],100,65,0);p.cargo=2;packetLife.packets=[p];
       habitat.rect={left:88*11,right:116*11,top:60*12,bottom:66*12};rebuildSolids();`);
  assert.equal(run('p.y'), 67);
  assert.equal(run('p.cargo'), 2);
  run('for(let n=0;n<60;n++)packetLifeUpdate(1/60,1000+n*1000/60);');
  assert.equal(run('p.alpha'), 1);
  assert.equal(run('p.phase'), '');
  assert.equal(run('packetLife.packets[0] === p'), true);
  assert.equal(run('lifeOpen(Math.round(p.x),Math.round(p.y),2)'), true);
});

test('shrinking the viewport contains existing creatures without replacing or resetting them', () => {
  const { run } = setup();
  run(`const p=lifeNewPacket(LIFE_SPECIES[1],110,65,0);p.age=12;p.cargo=2;packetLife.packets=[p];
       window.innerWidth=800;window.innerHeight=600;allocGrid();rebuildSolids();`);
  assert.equal(run('p.cargo'), 2);
  assert.equal(run('p.age'), 12);
  assert.equal(run('p.alpha'), 1);
  assert.equal(run('p.phase'), '');
  assert.equal(run('lifeOpen(Math.round(p.x),Math.round(p.y),2)'), true);
});

test('fed adult grazers lay a visible egg that hatches after four seconds', () => {
  const { run, draws } = setup();
  run(`const p=lifeNewPacket(LIFE_SPECIES[1],60,20,0);p.cargo=1.99;p.age=12;packetLife.packets=[p];
       packetLife.food=[{x:60,y:20,age:0}];packetLifeUpdate(1/60,1000);packetLifeRender();`);
  assert.equal(run('packetLife.packets.length'), 1);
  assert.equal(run('packetLife.eggs.length'), 1);
  assert.equal(run('packetLife.eaten'), 1);
  assert.equal(run('packetLife.births'), 0);
  assert.equal(run('p.splitAt'), 13000);
  assert.ok(draws.some(draw => draw.glyph === 'o'));
  run('lifeUpdateEggs(3.9,4900);');
  assert.equal(run('packetLife.births'), 0);
  run('lifeUpdateEggs(0.1,5000);packetLifeRender();');
  assert.equal(run('packetLife.packets.length'), 2);
  assert.equal(run('packetLife.eggs.length'), 0);
  assert.equal(run('packetLife.births'), 1);
  assert.ok(draws.some(draw => draw.glyph === '*'));
  assert.equal(run('ctx.globalAlpha'), 1);
});

test('reproduction respects cooldown and population cap', () => {
  for (const capped of [false, true]) {
    const { run } = setup();
    run(`const p=lifeNewPacket(LIFE_SPECIES[1],60,20,0);p.cargo=1.99;p.age=12;packetLife.packets=[p];
         ${capped ? 'while(packetLife.packets.length<LIFE_MAX_PACKETS)packetLife.packets.push(lifeNewPacket(LIFE_SPECIES[0],110,60,0));' : 'p.splitAt=2000;'}
         packetLife.food=[{x:60,y:20,age:0}];packetLifeUpdate(1/60,1000);`);
    assert.equal(run('packetLife.births'), 0);
    assert.equal(run('packetLife.eggs.length'), 0);
    assert.equal(run('packetLife.packets.length'), capped ? 16 : 1);
  }
});

test('ordinary swimmers eat without splitting', () => {
  const { run, draws } = setup();
  run(`const p=lifeNewPacket(LIFE_SPECIES[0],60,20,0);p.cargo=1.99;packetLife.packets=[p];
       packetLife.food=[{x:60,y:20,age:0}];packetLifeUpdate(1/60,1000);packetLifeRender();`);
  assert.equal(run('packetLife.packets.length'), 1);
  assert.equal(run('packetLife.eaten'), 1);
  assert.ok(draws.some(draw => draw.glyph === '+'));
});

test('closing life clears feeding and event counters', () => {
  const { run } = setup();
  run('packetLifeSetVenting(true);packetLife.eaten=5;packetLife.births=2;packetLife.eggs=[{x:60,y:20}];packetLifeSetEnabled(false);');
  assert.equal(run('packetLife.venting'), false);
  assert.equal(run('packetLife.eaten+packetLife.births+packetLife.food.length+packetLife.packets.length+packetLife.eggs.length'), 0);
});

test('30, 60, 120 and 144 Hz displays advance identical fluid and life ticks', () => {
  const states = [];
  for (const hz of [30, 60, 120, 144]) {
    const { calls, run, load } = setup();
    load('loop.js');
    run('_lastFrame=0;');
    for (let f = 1; f <= hz; f++) run(`loop(${f * 1000 / hz});`);
    assert.equal(calls.steps, 30);
    assert.equal(calls.intro, 60);
    states.push(run('JSON.stringify(packetLife.packets.map(p=>[p.x,p.y,p.cargo,p.phase]))'));
  }
  for (const state of states) assert.equal(state, states[0]);
});

test('a slow frame has bounded catch-up and tab return does not replay hidden time', () => {
  const { calls, listeners, run, load } = setup();
  load('loop.js');
  run('_lastFrame=0;loop(200);');
  assert.equal(calls.steps, 3);
  assert.equal(calls.intro, 6);
  run('packetLifeSetVenting(true);');
  listeners.visibilitychange();
  assert.equal(run('packetLife.venting'), false);
  run('loop(5000);');
  assert.equal(calls.steps, 3);
  run('loop(5017);');
  assert.equal(calls.intro, 7);
});

test('pending panel movement updates the mask before any rendering or simulation tick', () => {
  const { run, load } = setup();
  load('loop.js');
  run(`const p=lifeNewPacket(LIFE_SPECIES[0],75,35,0);packetLife.packets=[p];
       habitat.rect={left:847,right:1155,top:252,bottom:576};markSolidsDirty();loop(0);`);
  assert.equal(run('p.x'), 74);
  assert.equal(run('solidsDirty'), false);
});

test('opening a habitat reserves one hunter slot and spreads the initial creatures', () => {
  const { run } = setup();
  assert.equal(run('packetLife.packets.filter(p=>p.species.hunter).length'), 1);
  assert.equal(run('new Set(packetLife.packets.map(p=>p.x+","+p.y)).size'), 8);
});

test('canvas never draws the bare outlet arrow or creatures in partially covered cells', () => {
  const { run, draws } = setup();
  run('packetLife.packets=[];packetLifeRender();');
  assert.equal(draws.length, 0);
  run(`habitat.rect.right=1166.4;rebuildSolids();const p=lifeNewPacket(LIFE_SPECIES[0],106,35,0);
       p.blocked=false;packetLife.packets=[p];packetLifeRender();`);
  assert.equal(run('solid[ix(106,35)]'), 0); // fluid permits this partially covered cell
  assert.equal(run('lifeOpen(106,35,2)'), false);
  assert.equal(draws.length, 0);
  run('packetLifeDisplaceCovered();');
  assert.equal(run('p.x'), 107);
});

test('visual exclusion includes glyph height above the panel and remains active with solid off', () => {
  const { run } = setup();
  assert.equal(run('solid[ix(80,20)]'), 0);
  assert.equal(run('lifeOpen(80,20,2)'), false);
  assert.equal(run('P.solids'), false);
  assert.equal(run('lifeOpen(20,20,2)'), false);
});

test('eggs share the population cap and have a separate nursery cap', () => {
  for (const nurseryFull of [false, true]) {
    const { run } = setup();
    run(`const p=lifeNewPacket(LIFE_SPECIES[1],60,20,0);p.age=12;p.cargo=3;packetLife.packets=[p];
      packetLife.eggs=Array.from({length:${nurseryFull ? 4 : 1}},(_,n)=>({x:100+n*3,y:60,age:0,species:LIFE_SPECIES[1]}));
      ${nurseryFull ? '' : 'while(packetLife.packets.length<15)packetLife.packets.push(lifeNewPacket(LIFE_SPECIES[0],110,60,0));'}`);
    assert.equal(run('lifeLayEgg(p,1000)'), false);
  }
});

test('juveniles and low-energy adults cannot lay eggs', () => {
  const { run } = setup();
  run('const p=lifeNewPacket(LIFE_SPECIES[1],60,20,0);p.cargo=3;packetLife.packets=[p];');
  assert.equal(run('lifeLayEgg(p,1000)'), false);
  run('p.age=12;p.energy=0.4;');
  assert.equal(run('lifeLayEgg(p,1000)'), false);
});

test('a hunter steals a bounded meal and waits for its attack cooldown', () => {
  const { run } = setup();
  run(`const prey=lifeNewPacket(LIFE_SPECIES[0],60,20,0);prey.cargo=2;prey.age=12;
       const hunter=lifeNewPacket(LIFE_HUNTER,60.8,20,0);hunter.energy=0.4;
       packetLife.packets=[prey,hunter];packetLifeUpdate(1/60,1000);`);
  assert.ok(run('prey.cargo') > 1 && run('prey.cargo') < 1.3);
  assert.ok(run('hunter.cargo') > 0.7);
  assert.ok(run('hunter.energy') > 0.6);
  assert.equal(run('hunter.attackAt'), 3500);
  const cargo = run('prey.cargo');
  run('packetLifeUpdate(1/60,1017);');
  assert.ok(cargo - run('prey.cargo') < 0.01);
});

test('hunters do not eat passive food and cannot acquire prey through a panel', () => {
  const { run } = setup();
  run(`const hunter=lifeNewPacket(LIFE_HUNTER,76,35,0);packetLife.packets=[hunter];
       packetLife.food=[{x:76,y:35,age:0}];packetLifeUpdate(1/60,1000);`);
  assert.equal(run('packetLife.eaten'), 0);
  run(`const prey=lifeNewPacket(LIFE_SPECIES[0],80,35,0);prey.age=12;prey.cargo=2;
       packetLife.packets.push(prey);lifeSense(hunter,1200);`);
  assert.equal(run('hunter.preyTarget'), null);
});

test('creatures can turn away from an exactly opposite heading', () => {
  const { run } = setup();
  run(`const p=lifeNewPacket(LIFE_SPECIES[0],60,20,0);p.wander=Math.PI;p.turnAt=10000;
       packetLife.packets=[p];for(let n=0;n<60;n++)packetLifeUpdate(1/60,1000+n*1000/60);`);
  assert.ok(run('p.hx') < 0);
});

test('energy drains without food, feeding restores it, and aging or starvation produces a real death', () => {
  const { run } = setup();
  run('const p=lifeNewPacket(LIFE_SPECIES[0],60,20,0);packetLife.packets=[p];packetLifeUpdate(1/60,1000);');
  assert.ok(run('p.energy') < 0.8);
  run('packetLife.food=[{x:p.x,y:p.y,age:0}];p.senseAt=0;packetLifeUpdate(1/60,1017);');
  assert.ok(run('p.energy') > 0.9);
  for (const starvation of [false, true]) {
    const s = setup();
    s.run(`const p=lifeNewPacket(LIFE_SPECIES[0],60,20,0);packetLife.packets=[p];
      ${starvation ? 'p.energy=0;' : 'p.age=p.maxAge;p.cargo=2;'}
      for(let n=0;n<60;n++)packetLifeUpdate(1/60,1000+n*1000/60);`);
    assert.equal(s.run('packetLife.packets.length'), 1);
    assert.equal(s.run('p.phase'), 'remains');
    assert.equal(s.run('lifeStats().pop'), 0);
    assert.equal(s.run('lifeStats().remains'), 1);
    assert.equal(s.run('packetLife.deaths'), 1);
    s.run('for(let n=60;n<400;n++)packetLifeUpdate(1/60,1000+n*1000/60);');
    assert.equal(s.run('packetLife.packets.length'), 0);
    if (!starvation) assert.equal(s.run('packetLife.food.length'), 2);
  }
});

test('a depleted habitat recovers through a visible egg rather than an instant creature', () => {
  const { run } = setup();
  run('packetLife.packets=[];lifeSeedHabitat(11000);');
  assert.equal(run('packetLife.packets.length'), 0);
  assert.equal(run('packetLife.eggs.length'), 1);
  assert.equal(run('packetLife.eggs[0].seed'), true);
  run('lifeSeedHabitat(11001);');
  assert.equal(run('packetLife.eggs.length'), 1);
  run('lifeUpdateEggs(4,15000);');
  assert.equal(run('packetLife.packets.length'), 1);
  assert.equal(run('packetLife.births'), 1);
});

test('food and threat searches run at the decision rate instead of every movement tick', () => {
  const { run } = setup();
  run(`let searches=0;const originalFoodSearch=lifeNearestFood;lifeNearestFood=p=>{searches++;return originalFoodSearch(p);};
       packetLife.packets=[lifeNewPacket(LIFE_SPECIES[0],60,20,0)];
       for(let n=0;n<60;n++)packetLifeUpdate(1/60,1000+n*1000/60);`);
  assert.ok(run('searches') <= 9);
  assert.ok(run('searches') >= 7);
});

test('sustained feeding, aging and panel moves preserve population limits and valid state', () => {
  const { run } = setup();
  const result = run(`(()=>{
    let maxPopulation=0,maxFood=0,maxEggs=0;
    for(let n=0;n<60*240;n++) {
      const now=1000+n*1000/60;
      if(n%180===0)packetLifeRelease(now);
      if(n%600===0) {
        const left=(n%1200===0?78:69)*11;
        habitat.rect={left,right:left+308,top:252,bottom:576};rebuildSolids();
      }
      packetLifeUpdate(1/60,now);
      maxPopulation=Math.max(maxPopulation,packetLife.packets.length+packetLife.eggs.length);
      maxFood=Math.max(maxFood,packetLife.food.length);maxEggs=Math.max(maxEggs,packetLife.eggs.length);
      for(const p of packetLife.packets) {
        if(![p.x,p.y,p.vx,p.vy,p.energy,p.alpha,p.age].every(Number.isFinite))throw new Error('Non-finite creature state');
        if(p.energy<0||p.energy>1||p.alpha<0||p.alpha>1)throw new Error('Invalid energy/fade');
        if(!p.blocked&&!lifeOpen(Math.round(p.x),Math.round(p.y),2))throw new Error('Creature under panel');
      }
      if(maxPopulation>LIFE_MAX_PACKETS||maxFood>LIFE_MAX_FOOD||maxEggs>LIFE_MAX_EGGS)throw new Error('Cap exceeded');
    }
    return {maxPopulation,maxFood,maxEggs,deaths:packetLife.deaths};
  })()`);
  assert.ok(result.maxPopulation <= 16);
  assert.ok(result.maxFood <= 90);
  assert.ok(result.maxEggs <= 4);
  assert.ok(result.deaths > 0);
});

test('a selected food outlet stays fixed as currents reverse', () => {
  const { run } = setup();
  run('lifeSetOutletSide("left");vx.fill(0.5);vy.fill(-0.2);');
  const before = run('JSON.stringify(lifeVentCell())');
  run('vx.fill(-0.5);vy.fill(0.9);');
  assert.equal(run('JSON.stringify(lifeVentCell())'), before);
  assert.equal(run('packetLife.outletSide'), 'left');
  assert.equal(run('lifeSetOutletSide("invalid")'), false);
  assert.equal(run('packetLife.outletSide'), 'left');
});

test('a blocked outlet does not silently move, and selecting another side restores feeding', () => {
  const { run } = setup();
  run('lifeSetOutletSide("right");const outlet=lifeVentCell();solid[ix(outlet.i,outlet.j)]=1;');
  assert.equal(run('lifeVentCell()'), null);
  assert.equal(run('packetLifeRelease(1000)'), 0);
  assert.equal(run('packetLife.outletSide'), 'right');
  run('lifeSetOutletSide("bottom");');
  assert.ok(run('packetLifeRelease(1017)') > 0);
  assert.equal(run('lifeVentCell().ny'), 1);
});

test('death remains are visible before decay and do not count as living creatures', () => {
  const { run, draws } = setup();
  run('const p=lifeNewPacket(LIFE_SPECIES[0],60,20,0);p.energy=0;packetLife.packets=[p];packetLifeUpdate(1/60,1000);packetLifeRender();');
  assert.ok(draws.some(draw => draw.glyph === 'x' && draw.alpha === 1));
  assert.match(run('packetLife.lastEvent'), /starvation/);
  assert.equal(run('lifeStats().pop'), 0);
  assert.equal(run('lifeStats().occupied'), 1);
  run('for(let n=1;n<310;n++)packetLifeUpdate(1/60,1000+n*1000/60);packetLifeRender();');
  assert.ok(draws.some(draw => draw.glyph === ':'));
  assert.equal(run('packetLife.packets.length'), 1);
});

test('foragers scavenge remains with a cooldown, restoring energy and consuming a finite supply', () => {
  const { run } = setup();
  run(`const corpse=lifeNewPacket(LIFE_SPECIES[1],60.8,20,0);corpse.phase='remains';corpse.deathAge=1;corpse.remainsFood=2;
       const p=lifeNewPacket(LIFE_SPECIES[0],60,20,0);p.energy=0.3;
       packetLife.packets=[corpse,p];packetLifeUpdate(1/60,1000);`);
  assert.equal(run('corpse.remainsFood'), 1);
  assert.ok(run('p.energy') > 0.49);
  assert.ok(run('p.cargo') > 0.6);
  assert.equal(run('packetLife.eaten'), 1);
  run('packetLifeUpdate(1/60,1017);');
  assert.equal(run('corpse.remainsFood'), 1);
});

test('hunter pursuit keeps its acquired target and displays clear pursuit and bite cues', () => {
  const { run, draws } = setup();
  run(`const hunter=lifeNewPacket(LIFE_HUNTER,60,20,0);
       const prey=lifeNewPacket(LIFE_SPECIES[0],64,20,0);prey.age=12;prey.cargo=2;
       packetLife.packets=[hunter,prey];lifeSense(hunter,1000);
       const nearer=lifeNewPacket(LIFE_SPECIES[0],62,20,0);nearer.age=12;nearer.cargo=2;
       packetLife.packets.push(nearer);lifeSense(hunter,1130);packetLifeRender();`);
  assert.equal(run('hunter.preyTarget === prey'), true);
  assert.ok(draws.some(draw => draw.glyph === '@>' && draw.color === '#ffb86b'));
  run('prey.x=60.8;packetLifeUpdate(1/60,1147);packetLifeRender();');
  assert.equal(run('hunter.huntMode'), 'feeding');
  assert.ok(draws.some(draw => draw.glyph === '@!'));
  assert.ok(draws.some(draw => draw.glyph === '!'));
});

test('death and hunt notices survive frequent low-priority feeding messages', () => {
  const { run } = setup();
  run('lifeEvent("death",1000,3);lifeEvent("food",1100);lifeEvent("bite",1200,2);');
  assert.equal(run('packetLife.lastEvent'), 'death');
  run('lifeEvent("food",6001);');
  assert.equal(run('packetLife.lastEvent'), 'food');
});
