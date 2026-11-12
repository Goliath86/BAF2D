// Genera config/levels/level01.json: "Test Arena" 97x65, simmetrica per rotazione di 180°, senza vicoli ciechi.
// Uso (dalla cartella del repo): node tools/gen_arena.mjs
// Si disegna la metà sinistra (x < 48, più la colonna centrale sopra il centro): set() scrive anche la cella
// ruotata, symmetrize() ricopia tutto scambiando i caratteri di squadra.
import { createGrid, random, writeLevel } from './levelgen.mjs';

const g = createGrid(97, 65, '.');
const rnd = random(4242);
const { W, H, G } = g;

// ---------- bordo ----------
g.fill(0, 0, W - 1, 0, '#');
g.fill(0, 0, 0, H - 1, '#');

// ---------- zone di pavimento alternativo (decorative) ----------
g.fill(22, 3, 33, 8, ',');
g.fill(19, 38, 29, 47, ',');
g.fill(3, 25, 14, 33, ',');
g.fill(42, 46, 48, 58, ',');

// ---------- base blu (in basso a sinistra): riparata a est, aperta a nord ----------
g.line(17, 50, 17, 57, '#');
g.fill(9, 53, 10, 54, 'c');
g.fill(4, 49, 5, 49, 'c');

// ---------- capannone nord-ovest: tre porte ----------
g.room(6, 6, 18, 16, { doors: [[11, 16, 13, 16], [18, 9, 18, 10], [6, 12, 6, 13]] });
g.fill(8, 8, 9, 9, 'c');
g.fill(14, 13, 15, 13, 'c');

// ---------- magazzino ovest: tre porte e un divisorio aperto ----------
g.room(4, 36, 14, 45, { doors: [[9, 36, 10, 36], [14, 40, 14, 41], [6, 45, 7, 45]] });
g.line(9, 39, 9, 42, '#');
g.set(12, 43, 'c');

// ---------- corridoio nord: muro con varco, aperto ai lati ----------
g.line(23, 21, 39, 21, '#', [8, 9]);
g.line(26, 12, 26, 16, '#');
g.fill(36, 9, 37, 10, 'c');
g.fill(41, 4, 42, 4, 'c');

// ---------- settore sud: muro lungo con varco ----------
g.line(34, 47, 34, 59, '#', [6, 7]);
g.fill(25, 56, 26, 57, 'c');
g.line(22, 61, 28, 61, '#');

// ---------- dintorni della bandiera A: pilastri e casse ----------
for (const [x, y] of [[19, 38], [28, 38], [19, 46], [28, 46]]) g.fill(x, y, x + 1, y + 1, '#');
g.set(23, 44, 'c');
g.set(25, 39, 'c');

// ---------- anello centrale attorno alla bandiera B: quattro varchi ----------
g.line(40, 26, 48, 26, '#', [3, 4, 5]); // lato nord (metà sinistra) -> lato sud (metà destra)
g.line(40, 38, 48, 38, '#', [3, 4, 5]); // lato sud (metà sinistra) -> lato nord (metà destra)
g.line(40, 26, 40, 38, '#', [4, 5, 6, 7, 8]); // lato ovest -> lato est
g.fill(44, 30, 44, 31, 'c');
g.fill(44, 33, 44, 34, 'c');

// ---------- coperture sparse nel mezzo ----------
for (const [x, y, w, h] of [[30, 28, 2, 1], [33, 33, 1, 2], [22, 26, 1, 3], [9, 22, 3, 1], [38, 15, 1, 2], [29, 51, 2, 1]]) {
  g.fill(x, y, x + w - 1, y + h - 1, 'c');
}

// ---------- casse sparse a caso su pavimento libero (lontano dai muri) ----------
for (let i = 0; i < 18; i++) {
  const x = 3 + Math.floor(rnd() * 44);
  const y = 3 + Math.floor(rnd() * 58);
  let free = true;
  for (let j = -2; j <= 2; j++) for (let k = -2; k <= 2; k++) if (!'.,'.includes(g.get(x + k, y + j))) free = false;
  if (free) g.set(x, y, 'c');
}

// ---------- bandiere, basi, oggetti ----------
const clear = (x, y, r = 1) => g.fill(x - r, y - r, x + r, y + r, '.', ['c']);
clear(6, 58, 2);
G[58][6] = 'b';
G[42][24] = 'A';
g.fill(47, 31, 49, 33, '.');
G[32][48] = 'B';
G[8][12] = 's'; // pompa nel capannone
G[42][11] = 'g'; // granate nel magazzino
G[34][36] = 'g';
G[52][38] = 'L'; // lanciarazzi dietro il muro sud
G[18][30] = 's';
G[60][11] = 'J'; // jeep della base
G[51][25] = 'a'; // casse di munizioni: tra la base e il centro, e sul lato nord
G[12][29] = 'a';

g.symmetrize({ b: 'r', r: 'b', A: 'C', C: 'A', J: 'K', K: 'J' });

writeLevel('config/levels/level01.json', {
  name: 'Test Arena',
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
    C: { tile: 'floor', flag: 'C' },
    s: { tile: 'floor', pickup: 'shotgun' },
    g: { tile: 'floor', pickup: 'grenades' },
    L: { tile: 'floor', pickup: 'launcher' },
    a: { tile: 'floor', pickup: 'ammo' },
    J: { tile: 'floor', vehicle: 'jeep', team: 'blue', angleDeg: 0 },
    K: { tile: 'floor', vehicle: 'jeep', team: 'red', angleDeg: 180 },
  },
  flags: {
    A: { owner: 'blue' },
    B: { owner: null, radius: 40, captureTime: 10 },
    C: { owner: 'red' },
  },
}, g);
