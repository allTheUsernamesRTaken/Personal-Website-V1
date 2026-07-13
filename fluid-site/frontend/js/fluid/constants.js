// Tuning
const INJ_RADIUS = 3;
const INJ_DENS   = 3.5;
const INJ_VEL    = 6.0;
const VISC       = 0.00008;
const DIFF       = 0.00004;
const FADE       = 0.998;
const VEL_DAMP   = 0.9998;
const VORT       = 6.0;
const ITER       = 16;
const DT         = 0.16;

const CW = 11, CH = 12;
const COLS = Math.min(Math.floor(window.innerWidth  / CW), 160);
const ROWS = Math.min(Math.floor(window.innerHeight / CH), 100);

const canvas = document.getElementById('c');
const ctx    = canvas.getContext('2d');
canvas.width  = COLS * CW;
canvas.height = ROWS * CH;
canvas.style.width  = '100vw';
canvas.style.height = '100vh';

const N = COLS * ROWS;
let vx    = new Float32Array(N);
let vy    = new Float32Array(N);
let vx0   = new Float32Array(N);
let vy0   = new Float32Array(N);
let dens  = new Float32Array(N);
let dens0 = new Float32Array(N);
const solid = new Uint8Array(N);
