// Genera config/levels/level02.json: "Crossroads" 97x65, 5 bandiere, simmetrica per rotazione di 180°,
// senza vicoli ciechi. Uso (dalla cartella del repo): node tools/gen_crossroads.mjs
// Due viali (pavimento alternativo) si incrociano al centro; le strade larghe restano libere per le jeep.
import { createGrid, random, writeLevel } from './levelgen.mjs';

const g = createGrid(97, 65, '.');
const rnd = random(777);
const { W, H, G } = g;

// ---------- bordo ----------
g.fill(0, 0, W - 1, 0, '#');
g.fill(0, 0, 0, H - 1, '#');

// ---------- viali: orizzontale (y 30..34) e verticale (x 46..50) ----------
g.fill(1, 30, 48, 34, ',');
g.fill(46, 1, 50, 33, ',');

// ---------- base blu (in basso a sinistra) ----------
g.line(3, 50, 9, 50, '#', [3]);
g.line(16, 55, 16, 61, '#');
g.fill(5, 61, 6, 62, 'c');

// ---------- bandiera A: cortile con quattro ingressi ----------
g.room(10, 38, 24, 48, { doors: [[16, 38, 18, 38], [16, 48, 18, 48], [10, 42, 10, 44], [24, 42, 24, 44]] });
g.fill(13, 40, 13, 41, 'c');
g.fill(21, 45, 21, 46, 'c');

// ---------- bandiera D (in alto a sinistra): edificio con cortile interno ----------
g.room(6, 5, 22, 19, { doors: [[13, 5, 15, 5], [22, 11, 22, 13], [13, 19, 15, 19], [6, 11, 6, 13]] });
for (const [x, y] of [[10, 9], [18, 9], [10, 15], [18, 15]]) g.set(x, y, '#'); // colonne del cortile

// ---------- isolati lungo il viale orizzontale ----------
g.room(27, 21, 37, 27, { doors: [[32, 21], [32, 27], [27, 24], [37, 24]] });
g.room(27, 37, 37, 43, { doors: [[32, 37], [32, 43], [27, 40], [37, 40]] });
g.set(30, 23, 'c');
g.set(34, 41, 'c');

// ---------- incrocio centrale: quattro "L" agli angoli ----------
g.line(40, 26, 43, 26, '#');
g.line(40, 26, 40, 28, '#');
g.line(40, 38, 43, 38, '#');
g.line(40, 36, 40, 38, '#');
g.fill(44, 29, 44, 29, 'c');
g.fill(44, 35, 44, 35, 'c');

// ---------- settore nord-centrale: muri con varchi ----------
g.line(26, 9, 40, 9, '#', [7]);
g.line(33, 3, 33, 6, '#');
g.fill(38, 13, 39, 14, 'c');

// ---------- settore sud: copertura per la strada verso B (di là dalla rotazione) ----------
g.line(22, 54, 34, 54, '#', [6]);
g.line(38, 48, 38, 58, '#', [5]);
g.fill(28, 58, 29, 59, 'c');
g.fill(43, 52, 44, 53, 'c');

// ---------- coperture sparse ----------
for (const [x, y, w, h] of [[4, 24, 3, 1], [14, 27, 1, 2], [20, 33, 2, 1], [8, 31, 1, 2], [25, 15, 1, 2], [42, 18, 2, 1], [3, 36, 2, 1]]) {
  g.fill(x, y, x + w - 1, y + h - 1, 'c');
}
for (let i = 0; i < 14; i++) {
  const x = 3 + Math.floor(rnd() * 42);
  const y = 3 + Math.floor(rnd() * 58);
  let free = true;
  for (let j = -2; j <= 2; j++) for (let k = -2; k <= 2; k++) if (g.get(x + k, y + j) !== '.') free = false;
  if (free) g.set(x, y, 'c');
}

// ---------- bandiere, basi, oggetti ----------
const clear = (x, y, r = 1) => g.fill(x - r, y - r, x + r, y + r, '.', ['c', ',']);
clear(6, 57, 2);
G[57][6] = 'b';
G[43][17] = 'A';
G[12][14] = 'D';
g.fill(47, 31, 49, 33, ',');
G[32][48] = 'C';
G[60][11] = 'J';
G[46][22] = 's'; // pompa nel cortile di A
G[24][29] = 'g';
G[40][35] = 'g';
G[7][20] = 'L'; // lanciarazzi nell'edificio di D
G[56][27] = 'L';
G[6][28] = 's';

g.symmetrize({ b: 'r', r: 'b', A: 'E', E: 'A', D: 'B', B: 'D', J: 'K', K: 'J' });

writeLevel('config/levels/level02.json', {
  name: 'Crossroads',
  tileset: 'base',
  fill: 'wall',
  legend: {
    '.': 'floor',
    ',': 'floor_alt',
    '#': 'wall',
    c: 'crate',
    b: { tile: 'floor', spawn: 'blue' },
    r: { tile: 'floor', spawn: 'red' },
    A: { tile: 'floor', flag: 'A' },
    B: { tile: 'floor', flag: 'B' },
    C: { tile: 'floor_alt', flag: 'C' },
    D: { tile: 'floor', flag: 'D' },
    E: { tile: 'floor', flag: 'E' },
    s: { tile: 'floor', pickup: 'shotgun' },
    g: { tile: 'floor', pickup: 'grenades' },
    J: { tile: 'floor', vehicle: 'jeep', team: 'blue', angleDeg: 0 },
    K: { tile: 'floor', vehicle: 'jeep', team: 'red', angleDeg: 180 },
    L: { tile: 'floor', pickup: 'launcher' },
  },
  flags: {
    A: { owner: 'blue' },
    B: { owner: null },
    C: { owner: null, radius: 40, captureTime: 10 },
    D: { owner: null },
    E: { owner: 'red' },
  },
}, g);
