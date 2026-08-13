/* console.js — a small command line wired to the actual solver.

   Nothing here is faked for effect. `vort 14` writes P.vort, which the next
   physics step reads; `solid off` clears the obstacle mask and the wake
   behind the panel disappears within a second. It's the fastest way to show
   someone what the thing under the page actually is. */

const cmdEl = document.getElementById('cmd');
const logEl = document.getElementById('cmdlog');

const history = [];
let histIdx = -1;

function focusCmd() { cmdEl.focus(); }

function print(text, cls) {
  const line = document.createElement('div');
  line.className = cls || 'out';
  line.textContent = text;
  logEl.appendChild(line);
  while (logEl.childElementCount > 60) logEl.removeChild(logEl.firstChild);
  logEl.scrollTop = logEl.scrollHeight;
}

function printLines(arr, cls) { arr.forEach(l => print(l, cls)); }

/* Read a number, clamp it, write it back, and say what happened. */
function setNum(key, raw, lo, hi, label) {
  const v = parseFloat(raw);
  if (!isFinite(v)) { print(`${label}: ${P[key]}   (give me a number to change it)`, 'out'); return; }
  P[key] = Math.max(lo, Math.min(hi, v));
  print(`${label} = ${P[key]}`, 'ok');
}

const HELP = [
  'sections    ident · work · built · stack        (or press 1-4)',
  'resume      opens the pdf         gh / li / mail   opens the link',
  '',
  'the fluid —',
  'solid on|off    panel as a solid body in the flow (default on)',
  'wind            one gust across the field — flow past a bluff body',
  'wind <0-4>      or pin a steady current instead (0 turns it off)',
  'vort <0-24>     vorticity confinement — how tight the curls stay',
  'visc <n>        viscosity          fade <0-1>   how fast smoke dies',
  'iter <4-40>     solver iterations per step',
  'palette <flow|thermal|ember|mono>',
  'sat <0-1>       hue saturation      lum <0.35-1>  lightness ceiling',
  '                lower lum = more chromatic, less wash-out (flow only)',
  'life on|off    optional digital microfauna; click/hold the background to feed',
  'echo <text>     rasterise text straight into the density field',
  'flush           empty the tank     reset        back to defaults',
  '',
  'the panel —',
  'skin <night|cut|block>   how the panel sits on top of the field',
  '',
  'clear           clear this log'
];

function openURL(u) { window.open(u, '_blank', 'noopener'); }

function runCommand(raw) {
  const line = raw.trim();
  if (!line) return;
  print('dg@fluid:~$ ' + line, 'echo');

  const parts = line.split(/\s+/);
  const cmd = parts[0].toLowerCase();
  const arg = parts.slice(1).join(' ');

  switch (cmd) {
    case 'help': case '?': case 'man':
      printLines(HELP); return;

    case 'ident': case 'about': case 'me':
      showPane('ident'); return;
    case 'work': case 'experience':
      showPane('work'); return;
    case 'built': case 'projects':
      showPane('built'); return;
    case 'stack': case 'skills':
      showPane('stack'); return;

    case 'resume': case 'cv':
      openURL('Daniel-Guo-Resume.pdf'); print('opening resume', 'ok'); return;
    case 'gh': case 'github':
      openURL('https://github.com/allTheUsernamesRTaken'); return;
    case 'li': case 'linkedin':
      openURL('https://www.linkedin.com/in/dguo7/'); return;
    case 'mail': case 'email':
      location.href = 'mailto:danielguo2007@gmail.com'; return;
    case 'source':
      openURL('https://github.com/allTheUsernamesRTaken/Personal-Website-V1'); return;

    case 'clear': logEl.innerHTML = ''; return;

    /* ── physics ─────────────────────────────────────────────────── */
    case 'solid': {
      const a = arg.toLowerCase();
      P.solids = a === 'off' || a === '0' || a === 'false' ? false
               : a === 'on' || a === '1' || a === 'true'   ? true
               : !P.solids;
      rebuildSolids();
      print(P.solids
        ? 'panel is a solid body — flow splits at the leading edge, wake off the back'
        : 'panel removed from the solve — the fluid runs straight through it now', 'ok');
      return;
    }
    /* No argument is the one people actually want: a gust that arrives,
       does the thing, and leaves. A number pins a steady current instead,
       which is honest physics but never decays back to black. */
    case 'wind': case 'gust': {
      if (!arg) {
        gust(1.4, simNow());
        print('gust incoming — it splits at the panel and sheds off the corner', 'ok');
        return;
      }
      setNum('wind', arg, 0, 4, 'wind');
      if (P.wind <= 0) cancelGust();
      return;
    }
    case 'vort': setNum('vort', arg, 0, 24, 'vorticity'); return;
    case 'visc': setNum('visc', arg, 0, 0.02, 'viscosity'); return;
    case 'diff': setNum('diff', arg, 0, 0.02, 'diffusion'); return;
    case 'fade': setNum('fade', arg, 0.9, 1, 'fade'); return;
    case 'iter': setNum('iter', arg, 4, 40, 'iterations'); return;
    case 'dt':   setNum('dt', arg, 0.02, 0.4, 'timestep'); return;

    case 'palette': case 'pal': {
      const name = arg.toLowerCase();
      if (!PALETTES.includes(name)) {
        print('palettes: ' + PALETTES.join(' · ') + `   (now: ${P.palette})`); return;
      }
      buildPalette(name);
      print('palette = ' + name, 'ok');
      return;
    }

    /* Both only shape the `flow` wheel — the ramp palettes get their colour
       from a stop list, not from HSL. Say so rather than silently no-op. */
    case 'sat': case 'lum': {
      const isSat = cmd === 'sat';
      if (!isFinite(parseFloat(arg))) {
        print(`${isSat ? 'saturation' : 'lightness ceiling'}: ${P[cmd]}   (give me a number to change it)`);
        return;
      }
      setNum(cmd, arg, isSat ? 0 : 0.35, 1, isSat ? 'saturation' : 'lightness ceiling');
      buildPalette(P.palette);
      if (P.palette !== 'flow') print('note: only the flow palette reads this', 'out');
      return;
    }

    /* ── the panel ───────────────────────────────────────────────── */
    case 'skin': {
      const name = arg.toLowerCase();
      if (!SKIN_IDS.includes(name)) {
        print('skins —');
        SKIN_IDS.forEach(s =>
          print('  ' + s.padEnd(7) + SKINS[s] + (s === currentSkin ? '   ← now' : '')));
        return;
      }
      applySkin(name);
      print('skin = ' + name + ' — ' + SKINS[name], 'ok');
      return;
    }

    case 'life': {
      const a = arg.toLowerCase();
      if (a !== 'on' && a !== 'off') { print('life on|off   (now: ' + (packetLife.enabled ? 'on' : 'off') + ')'); return; }
      const result = packetLifeSetEnabled(a === 'on');
      print(result.message, result.ok ? 'ok' : 'err');
      return;
    }

    case 'echo': case 'say':
      stampText(arg || 'stable fluids');
      return;

    case 'flush': case 'clearfluid':
      dens.fill(0); vx.fill(0); vy.fill(0);
      dens0.fill(0); vx0.fill(0); vy0.fill(0);
      print('tank emptied', 'ok');
      return;

    case 'reset':
      Object.assign(P, DEFAULTS);
      cancelGust();
      buildPalette(P.palette);
      rebuildSolids();
      packetLifeSetEnabled(false);
      print('back to defaults', 'ok');
      return;

    case 'burst':
      burstAt(Math.round(COLS * 0.75), Math.round(ROWS * 0.5));
      return;

    /* ── the fun ones ────────────────────────────────────────────── */
    case 'whoami':
      print('daniel — waterloo cs+ml. currently teaching robots which way a hinge opens.'); return;
    case 'uname':
      print('fluid 1.0 · stable-fluids/1999 · ' + COLS + 'x' + ROWS + ' cells · js'); return;
    case 'ls':
      print('ident  work  built  stack  Daniel-Guo-Resume.pdf'); return;
    case 'sudo':
      print("you're already the only user here.", 'err'); return;
    case 'rm':
      if (/-rf?\s*\/?$/.test(arg) || arg.startsWith('-rf')) {
        print('nice try. try `flush` — it does what you want and less.', 'err'); return;
      }
      print('rm: ' + (arg || 'missing operand'), 'err'); return;
    case 'cheese':
      print('UW Cheese Club. it is a real club. i am a real member. ask me about comté.', 'ok'); return;
    case 'exit': case 'quit':
      print('there is nowhere to go, the page is the terminal.'); return;

    default:
      print(cmd + ': not a command — try `help`', 'err');
  }
}

/* ── wiring ───────────────────────────────────────────────────────── */
cmdEl.addEventListener('keydown', e => {
  if (e.key === 'Enter') {
    const v = cmdEl.value;
    if (v.trim()) { history.push(v.trim()); histIdx = history.length; }
    runCommand(v);
    cmdEl.value = '';
    return;
  }
  if (e.key === 'ArrowUp' && history.length) {
    e.preventDefault();
    histIdx = Math.max(0, histIdx - 1);
    cmdEl.value = history[histIdx];
    return;
  }
  if (e.key === 'ArrowDown' && history.length) {
    e.preventDefault();
    histIdx = Math.min(history.length, histIdx + 1);
    cmdEl.value = history[histIdx] || '';
    return;
  }
  if (e.key === 'Tab') {
    e.preventDefault();
    const stem = cmdEl.value.toLowerCase();
    if (!stem) return;
    const words = ['help', 'ident', 'work', 'built', 'stack', 'resume', 'source',
                   'solid ', 'wind ', 'vort ', 'visc ', 'fade ', 'iter ',
                   'palette ', 'sat ', 'lum ', 'skin ', 'life ', 'echo ',
                   'flush', 'reset', 'clear', 'whoami'];
    const hit = words.find(w => w.startsWith(stem));
    if (hit) cmdEl.value = hit;
    return;
  }
  if (e.key === 'Escape') { cmdEl.blur(); }
});

document.querySelector('.prompt').addEventListener('click', focusCmd);
document.querySelectorAll('.run').forEach(b =>
  b.addEventListener('click', () => runCommand(b.dataset.run)));

print('type `help`, or press 1-4 for sections.');
