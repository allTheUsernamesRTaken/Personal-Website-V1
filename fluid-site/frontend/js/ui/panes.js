/* panes.js — tab switching. Click, or press 1-4 / h-l when you aren't
   typing a command. */

const PANE_IDS = ['ident', 'work', 'built', 'stack'];
const tabEls   = Array.from(document.querySelectorAll('.tab'));
const paneEls  = Array.from(document.querySelectorAll('.pane'));

function showPane(id) {
  if (!PANE_IDS.includes(id)) return false;
  tabEls.forEach(t => t.classList.toggle('is-on', t.dataset.pane === id));
  paneEls.forEach(p => {
    const on = p.dataset.pane === id;
    p.classList.toggle('is-on', on);
    if (on) p.scrollTop = 0;
  });
  return true;
}

function currentPane() {
  const on = paneEls.find(p => p.classList.contains('is-on'));
  return on ? on.dataset.pane : PANE_IDS[0];
}

function stepPane(dir) {
  const i = PANE_IDS.indexOf(currentPane());
  showPane(PANE_IDS[(i + dir + PANE_IDS.length) % PANE_IDS.length]);
}

tabEls.forEach(t => t.addEventListener('click', () => showPane(t.dataset.pane)));

document.addEventListener('keydown', e => {
  const el = document.activeElement;
  if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) return;
  if (e.metaKey || e.ctrlKey || e.altKey) return;

  if (e.key >= '1' && e.key <= '4') { showPane(PANE_IDS[+e.key - 1]); return; }
  if (e.key === 'ArrowRight' || e.key === 'l') { stepPane(1);  return; }
  if (e.key === 'ArrowLeft'  || e.key === 'h') { stepPane(-1); return; }
  if (e.key === '/' || e.key === ':') { e.preventDefault(); focusCmd(); }
});
