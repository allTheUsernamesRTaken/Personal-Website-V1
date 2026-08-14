/* skins.js — which way the panel sits on the fluid.

   All the actual design is in css/skins.css; this just flips an attribute on
   <html> and remembers the choice. Kept out of the console so the list and
   the descriptions live next to the thing they describe.

   The panel is a solid body in the solver, and the skins change its border
   weight, so the obstacle mask has to be restamped after a switch or the
   wake stays keyed to the old bounding box. */

const SKINS = {
  night: 'translucent dark panel, amber ticks that light where the flow works',
  steel: 'box-character frame on the sim grid, cold until the flow lights it',
  rime:  'no frame — smoke accreting on the panel, drawn in the sim\'s own ramp',
  cut:   'opaque bone slab, black type, hard offset shadow — wins on value',
  block: 'dark, chromatic, full-length edge bars — wins on scale'
};

const SKIN_IDS = Object.keys(SKINS);
const SKIN_KEY = 'dg.skin';

/* Old names that shipped before, so a saved preference doesn't fall back to
   night and look like the setting was lost. */
const SKIN_ALIASES = { deck: 'steel' };

let currentSkin = 'night';

function applySkin(name) {
  name = SKIN_ALIASES[name] || name;
  if (!SKIN_IDS.includes(name)) return false;
  currentSkin = name;
  document.documentElement.dataset.skin = name;

  try { localStorage.setItem(SKIN_KEY, name); } catch (e) { /* private mode */ }

  /* steel and rime snap the panel to the cell lattice and build a boundary;
     every other skin has to hand those inline styles back. charFrameSync()
     does both, and calls rebuildSolids() itself once the rect is final. */
  if (typeof charFrameSync === 'function') charFrameSync();
  else if (typeof rebuildSolids === 'function') rebuildSolids();

  /* night's ticks measure themselves in cells and read the field per corner,
     so they need the final rect too — and need standing down on the way out. */
  if (typeof tickSync === 'function') tickSync();
  return true;
}

/* Restore before first paint if we can. index.html loads this ahead of the
   panel's first frame, so there's no flash of the default skin. */
(function restoreSkin() {
  let saved = null;
  try { saved = localStorage.getItem(SKIN_KEY); } catch (e) { /* ignore */ }
  saved = SKIN_ALIASES[saved] || saved;
  if (SKIN_IDS.includes(saved)) currentSkin = saved;
  document.documentElement.dataset.skin = currentSkin;
})();
