// Genera config/levels/training.json: campo d'addestramento 72x44 (tileset campagna) per l'addestramento del
// giocatore (config/training.json, js/game/training.js). Non è una mappa CTF: niente simmetria, ma come le altre
// senza celle irraggiungibili né vicoli ciechi (writeLevel non scrive un livello che non passa il controllo).
// Uso (dalla cartella del repo): node tools/gen_training.mjs
//
// Percorso (in senso orario dalla base in basso a sinistra): pista di corsa, poligono di tiro, buca delle
// granate (trincea con sagome al riparo), tavolo del lanciarazzi e sagoma del carro, recinto della bandiera, strada della jeep verso ovest,
// percorso d'assalto finale a nord-ovest. Segni per l'addestramento nella legend: { waypoint: id } = punto da
// raggiungere, { target: gruppo } = sagoma (vedi config/training.json).
import { createGrid, random, writeLevel } from './levelgen.mjs';

const W = 72;
const H = 44;
const g = createGrid(W, H, '.');
const { G } = g;
const rnd = random(20261115);

// scrittura diretta (createGrid.set ricopia anche la cella ruotata: qui la mappa non è simmetrica)
const put = (x, y, c) => {
  if (x >= 0 && y >= 0 && x < W && y < H) G[y][x] = c;
};
const rect = (x0, y0, x1, y1, c) => {
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) put(x, y, c);
};

// ---------- bordo di bosco, un po' irregolare ----------
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const d = Math.min(x, y, W - 1 - x, H - 1 - y);
    const t = 2 + (Math.sin(x * 0.53) + Math.cos(y * 0.47) > 1.2 ? 1 : 0);
    if (d < t) G[y][x] = '#';
  }
}

// ---------- caserma vicino alla base (due porte) ----------
rect(10, 34, 17, 40, 'W');
rect(11, 35, 16, 39, 'f');
rect(10, 37, 10, 38, 'f'); // porta ovest
rect(13, 34, 14, 34, 'f'); // porta nord
put(15, 36, 'x');
put(16, 39, 'x');

// ---------- pista di corsa: dalla base verso est ----------
rect(4, 29, 31, 31, '=');
for (const x of [9, 15, 21, 27]) {
  put(x, 27, 'H');
  put(x + 2, 33, 'H');
}

// ---------- poligono di tiro: linea di tiro (staccionata), campo, terrapieno di sacchi ----------
rect(35, 26, 35, 33, '|');
rect(56, 24, 56, 35, 's');
rect(36, 24, 55, 35, ':'); // campo arato
rect(36, 25, 55, 34, '.');

// ---------- buca delle granate: sagome al riparo in una trincea (solo le esplosioni le colpiscono) ----------
rect(41, 38, 49, 39, 'u');

// ---------- recinto della bandiera (cancelli a ovest e a sud) ----------
rect(54, 6, 66, 6, '-');
rect(54, 16, 66, 16, '-');
rect(54, 6, 54, 16, '|');
rect(66, 6, 66, 16, '|');
rect(54, 10, 54, 12, '.'); // cancello ovest
rect(59, 16, 61, 16, '.'); // cancello sud
put(54, 6, 'x');
put(66, 6, 'x');
put(54, 16, 'x');
put(66, 16, 'x');

// ---------- strada della jeep: dal recinto verso ovest ----------
rect(6, 11, 52, 13, '=');
rect(50, 13, 52, 22, '='); // raccordo verso il poligono

// ---------- percorso d'assalto (nord-ovest): trincee, casse, sacchi, siepi ----------
rect(5, 7, 30, 8, 'u');
for (const x of [8, 16, 24]) rect(x, 6, x + 2, 6, 's');
rect(4, 18, 4, 24, 'u');
rect(4, 18, 26, 19, 'u');
for (const [x, y] of [[9, 22], [15, 24], [22, 22], [28, 20], [12, 16], [20, 16]]) {
  put(x, y, 'x');
  put(x + 1, y, 'x');
}
for (const [x0, y0, x1, y1] of [[7, 25, 11, 25], [18, 26, 23, 26], [25, 23, 25, 26]]) rect(x0, y0, x1, y1, 'h');
for (const [x, y] of [[13, 4], [27, 4], [31, 17]]) put(x, y, 's');

// ---------- decorazioni: alberi e cespugli lungo il bordo e tra le zone ----------
for (const [x, y] of [[33, 5], [40, 4], [46, 7], [68, 20], [3, 14], [33, 21], [61, 21], [39, 18]]) put(x, y, 'P');
for (let i = 0; i < 26; i++) {
  const x = 3 + Math.floor(rnd() * (W - 6));
  const y = 3 + Math.floor(rnd() * (H - 6));
  let free = true;
  for (let j = -1; j <= 1; j++) for (let k = -1; k <= 1; k++) if (g.get(x + k, y + j) !== '.') free = false;
  if (free) put(x, y, rnd() < 0.6 ? 'b' : 'k');
}

// ---------- segni dell'addestramento, oggetti, basi ----------
const marks = {
  B: [6, 38], // base blu (partenza)
  R: [36, 3], // base rossa (non usata: serve alla modalità)
  1: [6, 33], // movimento
  2: [31, 30], // fine della pista di corsa
  3: [33, 30], // linea di tiro
  4: [45, 34], // lancio delle granate
  5: [9, 12], // fine della guida
  L: [59, 39], // tavolo del lanciarazzi
  J: [47, 12], // jeep
  A: [60, 11], // bandiera
  m: [30, 34], // cassa di munizioni vicino al poligono
  G: [38, 35], // granate vicino alla buca
};
for (const [c, [x, y]] of Object.entries(marks)) put(x, y, c);
// sagome: poligono (a), buca delle granate (g), carro (T), percorso d'assalto (f)
for (const [x, y] of [[38, 28], [41, 32], [44, 27]]) put(x, y, 'a');
for (const [x, y] of [[44, 39], [47, 39]]) put(x, y, 'g');
put(67, 33, 'T');
for (const [x, y] of [[7, 4], [15, 3], [23, 5], [8, 21], [17, 23], [28, 17]]) put(x, y, 'F');

const grass = { tile: ['grass', 'grass2', 'grass3', 'grass4'], variantWeights: [6, 4, 2, 2] };
const dirt = ['dirt', 'dirt2'];
writeLevel('config/levels/training.json', {
  name: 'Training Ground',
  tileset: 'countryside',
  fill: 'woods',
  background: '#1e2e16',
  destructible: false,
  legend: {
    '.': grass,
    '=': dirt,
    '#': ['woods', 'woods2'],
    u: { tile: ['trench', 'trench2'], variantWeights: [3, 1] },
    s: ['sandbags', 'sandbags2'],
    h: ['hedge', 'hedge2'],
    W: 'brick',
    f: 'planks',
    ':': 'field',
    '-': 'fence_h',
    '|': 'fence_v',
    x: 'crate',
    H: 'hay',
    P: { tile: 'tree_base', prop: 'tree' },
    b: { ...grass, prop: 'bush_green' },
    k: { ...grass, prop: 'stone_grey' },
    1: { ...grass, waypoint: '1' },
    2: { tile: dirt, waypoint: '2' },
    3: { ...grass, waypoint: '3' },
    4: { ...grass, waypoint: '4' },
    5: { tile: dirt, waypoint: '5' },
    L: { ...grass, pickup: 'launcher', waypoint: 'L' },
    J: { tile: dirt, vehicle: 'jeep', team: 'blue', angleDeg: 180 },
    m: { ...grass, pickup: 'ammo' },
    G: { ...grass, pickup: 'grenades' },
    a: { ...grass, target: 'a' },
    g: { tile: ['trench', 'trench2'], variantWeights: [3, 1], target: 'g' },
    T: { ...grass, target: 'r' },
    F: { ...grass, target: 'f' },
    B: { ...grass, spawn: 'blue' },
    R: { ...grass, spawn: 'red' },
    A: { ...grass, flag: 'A' },
  },
  flags: {
    A: { owner: null, captureTime: 5, neutralizeTime: 3 },
  },
}, g);
