# ASCII Fluid Dynamics Simulator 

My personal website. The background is a fluid sim made out of ASCII characters you can play with. Info card on top with bio, links, skills.

Made the first version in high school so the stack is a bit rudimentary, but I'm still proud of it, it's plain HTML, CSS, JS.

## Structure:

```
fluid-site/frontend/
├── index.html              the page + the panel
├── css/                    styling
└── js/
    ├── icons/              pixel-art link icons
    ├── fluid/              the sim
    │   ├── constants.js    all the numbers, grid allocation
    │   ├── grid.js         indexing, walls, solid cells, adding stuff in
    │   ├── solids.js       turns the panel into an obstacle
    │   ├── solver.js       the physics
    │   ├── ambient.js      optional steady current (off by default)
    │   ├── text.js         rasterises text into the density field
    │   ├── render.js       numbers into colored characters
    │   ├── input.js        mouse / touch
    │   └── loop.js         the animation loop
    └── ui/
        ├── panes.js        tab switching
        ├── console.js      the command line
        └── hud.js          telemetry readout
```

Script load order (bottom of `index.html`) matters. It's all one global scope, not modules, so `constants.js` has to load first since it makes the arrays everything else uses. Reorder it and you get "X is not defined".

`ambient.js` is the only file nothing else depends on — delete it and its `<script>` tag and the site is unchanged apart from losing the `wind` command.

## How the fluid works:

This follows Jos Stam's stable fluids (papers below):

Screen is a grid of cells. Each cell holds how fast the fluid moves there (`vx`, `vy`) and how much smoke is in it (`dens`). Every frame `step()` in `solver.js` runs: add whatever the mouse injected, diffuse it out to neighbors a bit, project, advect, project again, vorticity confinement, then everything fades.

Project is the important one, it's what makes it swirl like fluid instead of just blurring out, forces the velocity to conserve mass. Advect moves the smoke along the flow. Vorticity confinement adds the little curls back, without it everything goes soft. Project runs twice because advect messes the field up again. End of the step the smoke fades and velocity damps so the screen goes back to black when you stop.

`linSolve` is the same loop run `ITER` times to settle on an answer, both diffuse and project use it, more iterations looks better but slower. `advect` runs backwards, for each cell it asks where the stuff here came from and grabs from there, backwards is the reason it doesn't blow up.

`setBound` is the walls. Not a real reflective wall, just copies the neighbor cell times 0.5 so fluid softly dies at the edges instead of piling up.

## Obstacles:

The `solid` array used to sit there unused. Now `solids.js` stamps the panel's bounding box into it, and the panel is a real boundary in the solve — smoke can't cross it and the flow goes around. `solid off` in the console takes it back out if you want to see the difference.

The way it works is one change in `linSolve`. It used to be hardcoded to four neighbors:

```
diffuse:  x = (x0 + a*(4 neighbors)) / (1 + 4a)
project:  x = (x0 +   (4 neighbors)) / 4
```

Now it counts how many neighbors are actually fluid and drops the solid ones from the stencil:

```
x = (x0 + a*sum_of_fluid_neighbors) / (cSelf + a*count)
```

Dropping a solid neighbor is a zero-gradient (Neumann) condition at the wall — ∂p/∂n = 0, no flux through it. The denominator has to shrink with the count or a cell walled in on three sides divides by too much and goes unstable. With no obstacles `count` is always 4 and it collapses back to exactly the two lines above, so the open-water behavior is unchanged (checked: fields come out bit-identical to the old solver over 150 steps of identical input).

## Drawing:

`render.js` draws one character per cell, skips empty ones to save time. Denser ASCII characters (from `.` through symbols like `#`, `@`, and `$`) mean more smoke; hue comes from the direction the fluid moves, and it gets brighter where it's fast or swirly.

`loop.js` advances Life and sources at a fixed 60 Hz and the fluid solver at 30 Hz, while drawing at the display refresh rate. Catch-up is capped at six ticks per frame, and returning from a hidden tab does not replay the paused time.

## Interacting:

`input.js` takes the mouse/touch position, turns it into a cell, dumps density + velocity in. Moving paints a stream in the drag direction, clicking shoots it out in a circle. Ignores clicks over the panel so the buttons still work. Added touch handlers later for phone.

There's also a command line at the bottom of the panel (`js/ui/console.js`). It isn't decoration — it writes to the same parameter object the solver reads, so `vort 14` really does change the physics on the next step. `help` lists everything. `echo <text>` rasterises the text into an offscreen canvas at grid resolution and uses the alpha channel as a smoke deposit, so the letters come out made of fluid and the flow pulls them apart.

`life on` opens a compact 240×176 draggable habitat with a population summary, feed button and outlet dropdown. Choose Left, Right, Top or Bottom, then hold the feed button (or Space/Enter while focused). The selected side stays fixed as the current and panel move; a blocked outlet reports that it is blocked. Move the current to guide the released food. `<>` forage and scavenge, `{}` graze nearby, and one amber `@` steals food from fed adults with a 2.5-second attack cooldown. A direction cue shows pursuit, `@!` and a prey flash mark a bite, and the event line reports the hunter's current activity.

Adult, well-fed `{}` lay single-character `o` eggs with a 12-second cooldown. Eggs hatch after four seconds if there is room; `+` marks eating and `*` marks hatching. Feeding restores energy. Starvation and aging leave an `x` for several seconds, which becomes `:` and finally up to two food dots. Foragers can consume these remains, so they also act as scavengers. Death and bite notices take priority over routine feeding messages.

Creatures, eggs and remains share 16 slots, with at most four eggs and 90 food particles. A depleted habitat seeds one recovery egg at most every ten seconds, aiming for three prey and one hunter. Target searches run at 8 Hz without adding another fluid solve. Moving panels push creatures, eggs and food to a free edge; strict visual bounds keep whole sprites clear of panel text. Creatures steer inward near screen edges, with outward flow reduced and a final containment boundary. Edge contacts and viewport shrinking preserve the creature and its food, age and cooldowns; they do not fade it out or replace it.

Run the visual-boundary, collision, feeding, ecology and simulation-clock regressions with `node --test tests/life.test.cjs` (Node 18 or later). They include a four-minute simulated run with feeding and panel movement to check population limits and valid state.

## The numbers:

Constants are in `constants.js`, viscosity, fade, injection strength, vorticity etc. I found these on a vibes basis.

## Notable Errors I Made:

From memory:

Everything's global, and  `constants.js` not loading first gives "COLS is not defined". Load order is fragile.

Used to blow up to NaN, screen freezes or goes blank. If `DT` or the injection strength is too high the math goes unstable, one NaN cell spreads to all of them. Keeping `DT` small fixed it.

Smoke piled up at the edges before the `setBound` walls, the 0.5 copy was the fix.

Slightly laggy on bigger monitors, bigger window means more cells means more math, so there's a cell cap and the every-other-frame thing. (I set the simulation speed much lower now)

The real cause of that lag turned out to be `vorticityConfinement` doing `new Float32Array(N)` every single step — about 60KB of garbage 30 times a second. Hoisting it to one reused buffer, plus indexing with `id+1` / `id+COLS` instead of calling `ix()` for every array access, took a huge chunk off the frame time.

The grid was sized once at load from `window.innerWidth` and never recomputed, so resizing the window or rotating a phone stretched the whole sim. There's a debounced resize handler now that reallocates.

Colors used to build an `hsla(...)` string per cell per frame, ~16k allocations a frame. Now they're a quantised index into a prebuilt lookup table and `fillStyle` only gets touched when the index changes.

Mobile scrolled instead of drawing, had to `preventDefault()` on touchmove.

Clicks went through the card and fired the burst behind the buttons, `isOverCard` check fixed it.

Got the grid indexing backwards a few times, `ix(i,j) = j*COLS + i`, came out sideways/garbled until I fixed it.

Couple spots add `1e-6` before dividing, that's there because divide-by-zero gave NaN again.

## Sources:

The ASCII + coloring is original but otherwise I followed these papers:

Main one:

Jos Stam, "Real-Time Fluid Dynamics for Games" (GDC 2003), https://www.dgp.toronto.edu/people/stam/reality/Research/pdf/GDC03.pdf

(Original heavier paper I parsed):

Jos Stam, "Stable Fluids" (SIGGRAPH 1999), https://www.dgp.toronto.edu/people/stam/reality/Research/pdf/ns.pdf

Also this one:

Fedkiw, Stam & Jensen, "Visual Simulation of Smoke" (SIGGRAPH 2001), where vorticity confinement comes from. https://web.stanford.edu/class/cs237d/smoke.pdf
