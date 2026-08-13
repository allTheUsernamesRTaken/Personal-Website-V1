/* skins.js — which way the panel sits on the fluid.

   All the actual design is in css/skins.css; this just flips an attribute on
   <html> and remembers the choice. Kept out of the console so the list and
   the descriptions live next to the thing they describe.

   The panel is a solid body in the solver, and the skins change its border
   weight, so the obstacle mask has to be restamped after a switch or the
   wake stays keyed to the old bounding box. */

const SKINS = {
  night: 'translucent dark panel, amber viewfinder ticks — the original',
  cut:   'opaque bone slab, black type, hard offset shadow — wins on value',
  block: 'dark, chromatic, full-length edge bars — wins on scale'
};

const SKIN_IDS = Object.keys(SKINS);
const SKIN_KEY = 'dg.skin';

let currentSkin = 'night';

function applySkin(name) {
  if (!SKIN_IDS.includes(name)) return false;
  currentSkin = name;
  document.documentElement.dataset.skin = name;

  try { localStorage.setItem(SKIN_KEY, name); } catch (e) { /* private mode */ }

  /* Border width changes with the skin, so the panel's rect moves by a pixel
     or two. Cheap to redo, and it keeps the boundary layer honest. */
  if (typeof rebuildSolids === 'function') rebuildSolids();
  return true;
}

/* Restore before first paint if we can. index.html loads this ahead of the
   panel's first frame, so there's no flash of the default skin. */
(function restoreSkin() {
  let saved = null;
  try { saved = localStorage.getItem(SKIN_KEY); } catch (e) { /* ignore */ }
  if (SKIN_IDS.includes(saved)) currentSkin = saved;
  document.documentElement.dataset.skin = currentSkin;
})();
