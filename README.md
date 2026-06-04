# Personal-Website-V1

My personal website. The background is a fluid sim made out of ASCII/block characters you can play with. Info card on top with bio, links, skills.

Made the first version in high school so the stack is a bit rudimentary, but I'm still proud of it, it's plain HTML, CSS, JS.

## Structure:

```
fluid site/frontend/
├── index.html              the page + the card
├── css/                    styling
└── js/
    ├── icons/              pixel-art link icons
    └── fluid/              the sim
        ├── constants.js    all the numbers
        ├── grid.js         indexing, walls, adding stuff in
        ├── solver.js       the physics
        ├── render.js       numbers into colored characters
        ├── input.js        mouse / touch
        └── loop.js         the animation loop
```

Script load order (bottom of `index.html`) matters. It's all one global scope, not modules, so `constants.js` has to load first since it makes the arrays everything else uses. Reorder it and you get "X is not defined".

## How the fluid works:

This follows Jos Stam's stable fluids (papers below):

Screen is a grid of cells. Each cell holds how fast the fluid moves there (`vx`, `vy`) and how much smoke is in it (`dens`). Every frame `step()` in `solver.js` runs: add whatever the mouse injected, diffuse it out to neighbors a bit, project, advect, project again, vorticity confinement, then everything fades.

Project is the important one, it's what makes it swirl like fluid instead of just blurring out, forces the velocity to conserve mass. Advect moves the smoke along the flow. Vorticity confinement adds the little curls back, without it everything goes soft. Project runs twice because advect messes the field up again. End of the step the smoke fades and velocity damps so the screen goes back to black when you stop.

`linSolve` is the same loop run `ITER` times to settle on an answer, both diffuse and project use it, more iterations looks better but slower. `advect` runs backwards, for each cell it asks where the stuff here came from and grabs from there, backwards is the reason it doesn't blow up.

`setBound` is the walls. Not a real reflective wall, just copies the neighbor cell times 0.5 so fluid softly dies at the edges instead of piling up. There's also a `solid` array in `constants.js` for obstacles but I never finished it, nothing reads it.

## Drawing:

`render.js` draws one character per cell, skips empty ones to save time. Heavier block (`░ ▒ ▓ █ ■`) the more smoke, hue from the direction the fluid moves, brighter where it's fast or swirly, fades to nothing where there's barely anything.

`loop.js` is the loop. Physics only runs every other frame (`_frame % 2`) but draws every frame. Half for speed, half because it looked better that way.

## Interacting:

`input.js` takes the mouse/touch position, turns it into a cell, dumps density + velocity in. Moving paints a stream in the drag direction, clicking shoots it out in a circle. Ignores clicks over the card so the buttons still work. Added touch handlers later for phone.

## The numbers:

Constants are in `constants.js`, viscosity, fade, injection strength, vorticity etc. I found these on a vibes basis.

## Notable Errors I Made:

From memory:

Everything's global, and  `constants.js` not loading first gives "COLS is not defined". Load order is fragile.

Used to blow up to NaN, screen freezes or goes blank. If `DT` or the injection strength is too high the math goes unstable, one NaN cell spreads to all of them. Keeping `DT` small fixed it.

Smoke piled up at the edges before the `setBound` walls, the 0.5 copy was the fix.

Slightly laggy on bigger monitors, bigger window means more cells means more math, so there's a `160×100` cap and the every-other-frame thing. (I set the simulation speed much lower now)

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
