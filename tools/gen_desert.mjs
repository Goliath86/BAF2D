// Genera config/levels/level03.json: mappa desertica 97x65, simmetrica per rotazione di 180°.
// Uso (dalla cartella del repo): node tools/gen_desert.mjs
// Le modifiche fatte a mano a level03.json vengono sovrascritte: modificare qui e rigenerare, oppure solo a mano.
import fs from 'node:fs';
import path from 'node:path';
import { checkGrid, report, walkGrid } from './check_level.mjs';

const W = 97;
const H = 65;
const G = Array.from({ length: H }, () => Array(W).fill('.'));
let seed = 12345;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

const inside = (x, y) => x >= 0 && y >= 0 && x < W && y < H;
const rot = (x, y) => [W - 1 - x, H - 1 - y];
const get = (x, y) => (inside(x, y) ? G[y][x] : '#');
/** Imposta la cella e la sua ruotata (simmetria). */
function set(x, y, ch, only = null) {
  for (const [a, b] of [[x, y], rot(x, y)]) {
    if (!inside(a, b)) continue;
    if (only && !only.includes(G[b][a])) continue;
    G[b][a] = ch;
  }
}
function fill(x0, y0, x1, y1, ch, only) {
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) set(x, y, ch, only);
}
const SOLID = new Set(['#', 'W', 'H', 'm', 'R', '~', 'P', 'c']);

// ---------- strade (larghe "w") lungo spezzate ----------
function road(points, w = 5) {
  const r = (w - 1) / 2;
  for (let i = 0; i < points.length - 1; i++) {
    const [x0, y0] = points[i];
    const [x1, y1] = points[i + 1];
    const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) * 2;
    for (let k = 0; k <= n; k++) {
      const cx = x0 + ((x1 - x0) * k) / n;
      const cy = y0 + ((y1 - y0) * k) / n;
      for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++)
        for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++)
          if (Math.hypot(x - cx, y - cy) <= r + 0.3) set(x, y, '=');
    }
  }
}

// ---------- case: muri ("W" fango / "H" intonaco), porte, crolli ----------
function house(x0, y0, x1, y1, { wall = 'W', doors = [], ruin = 0, rubbleFloor = 0.15 } = {}) {
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const edge = x === x0 || x === x1 || y === y0 || y === y1;
      if (!edge) {
        set(x, y, rnd() < rubbleFloor ? 'r' : wall === 'H' ? 'F' : 'f');
        continue;
      }
      const door = doors.some(([dx, dy]) => dx === x && dy === y);
      if (door) set(x, y, wall === 'H' ? 'F' : 'f');
      else if (rnd() < ruin) set(x, y, rnd() < 0.55 ? 'R' : 'r'); // muro crollato: macerie (a volte passabili)
      else set(x, y, wall);
    }
  }
}

// ---------- muretto a secco ----------
function lowwall(x0, y0, x1, y1, gaps = []) {
  const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
  for (let k = 0; k <= n; k++) {
    const x = Math.round(x0 + ((x1 - x0) * k) / (n || 1));
    const y = Math.round(y0 + ((y1 - y0) * k) / (n || 1));
    if (gaps.includes(k)) continue;
    set(x, y, 'm');
  }
}

// ---------- bordo di roccia irregolare ----------
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const d = Math.min(x, y, W - 1 - x, H - 1 - y);
    const t = 2 + Math.max(0, Math.round(1.2 + Math.sin(x * 0.37) * 1.1 + Math.cos(y * 0.43) * 1.1 + Math.sin((x + y) * 0.21)));
    if (d < t) G[y][x] = '#';
  }
}

// ---------- strade ----------
road([[5, 53], [28, 53], [48, 53]]); // dalla base blu verso la strada nord-sud (sud)
road([[48, 6], [48, 58]], 5); // strada nord-sud che attraversa il villaggio
road([[12, 50], [12, 30], [18, 25]], 5); // dalla base verso l'oasi
road([[27, 17], [48, 17]], 5); // dall'oasi al villaggio (nord)

// ---------- base blu (in basso a sinistra) ----------
lowwall(3, 46, 9, 46, [3]);
lowwall(16, 47, 16, 50);
lowwall(16, 56, 16, 59);
for (const [x, y] of [[6, 48], [7, 48], [14, 58], [14, 59], [4, 58]]) set(x, y, 'c');

// ---------- fattoria in rovina con recinto (bandiera A) ----------
house(26, 37, 31, 41, { wall: 'W', doors: [[28, 41], [26, 39]], ruin: 0.25 });
lowwall(19, 36, 25, 36, [2]);
lowwall(19, 36, 19, 46, [5]);
lowwall(19, 46, 33, 46, [6, 7]);
lowwall(33, 43, 33, 46);
for (const [x, y] of [[22, 38], [23, 44], [30, 44]]) set(x, y, 'o', ['.']);
for (const [x, y] of [[21, 40], [22, 41], [21, 43], [31, 35]]) set(x, y, 'P', ['.']);

// ---------- oasi (bandiera B) ----------
const oasis = { x: 21, y: 13, rx: 6.3, ry: 3.7 };
for (let y = oasis.y - 5; y <= oasis.y + 5; y++) {
  for (let x = oasis.x - 8; x <= oasis.x + 8; x++) {
    const d = ((x - oasis.x) / oasis.rx) ** 2 + ((y - oasis.y) / oasis.ry) ** 2;
    if (d <= 1) set(x, y, '~');
    else if (d <= 1.8 && get(x, y) === '.' && rnd() < 0.3) set(x, y, 'b');
  }
}
for (let i = 0; i < 16; i++) {
  const a = (i / 16) * Math.PI * 2 + rnd() * 0.3;
  const x = Math.round(oasis.x + Math.cos(a) * (oasis.rx + 2.5 + rnd() * 1.5));
  const y = Math.round(oasis.y + Math.sin(a) * (oasis.ry + 2 + rnd() * 1.5));
  if (get(x, y) === '.' || get(x, y) === 'b') set(x, y, 'P');
}
// orti cintati vicino all'oasi
lowwall(28, 6, 35, 6, [3, 6]); // il secondo varco evita il vicolo cieco tra il muretto e la roccia
lowwall(28, 6, 28, 11);
lowwall(35, 6, 35, 11, [2]);
lowwall(28, 11, 35, 11, [5]);
for (let y = 7; y <= 10; y++) for (let x = 29; x <= 34; x++) if ((x + y) % 2 === 0) set(x, y, 'b', ['.']);
house(6, 18, 10, 22, { wall: 'H', doors: [[10, 20]], ruin: 0.3 });

// ---------- villaggio (centro) ----------
house(31, 22, 37, 27, { wall: 'W', doors: [[34, 27], [31, 24]], ruin: 0.2 });
house(39, 22, 45, 27, { wall: 'H', doors: [[39, 24], [42, 27]], ruin: 0.1 });
house(30, 30, 36, 35, { wall: 'W', doors: [[36, 32]], ruin: 0.5, rubbleFloor: 0.5 });
house(38, 37, 45, 42, { wall: 'W', doors: [[41, 37], [45, 39]], ruin: 0.2 });
house(29, 38, 35, 43, { wall: 'H', doors: [[32, 38], [35, 41]], ruin: 0.35 });
house(39, 30, 44, 34, { wall: 'H', doors: [[44, 32], [41, 30]], ruin: 0.15 });
// cortili e muretti tra le case
lowwall(38, 29, 38, 35, [3]);
lowwall(30, 28, 37, 28, [2, 4]); // varco davanti alla porta sud della prima casa
// piazza centrale: sabbia, palme, pozzo
fill(46, 29, 48, 35, '.', ['f', 'F', 'r', 'R', 'W', 'H', 'm']);
set(45, 29, 'P', ['.', '=']);
set(46, 35, 'P', ['.', '=']);
// casse e macerie sparse nel villaggio
for (const [x, y] of [[37, 29], [36, 36], [38, 43], [30, 36]]) set(x, y, 'R', ['.']);
for (const [x, y] of [[33, 29], [37, 44]]) set(x, y, 'c', ['.']);

// ---------- rovine nel deserto aperto (sud) e coperture ----------
function ruin(x0, y0) {
  // muro a "L" crollato con macerie attorno
  lowwall(x0, y0, x0 + 4, y0, [2]);
  for (let y = y0; y <= y0 + 3; y++) set(x0, y, rnd() < 0.7 ? 'W' : 'R');
  set(x0 + 2, y0 + 2, 'r', ['.']);
  set(x0 + 1, y0 + 1, 'r', ['.']);
}
ruin(24, 57);
ruin(36, 57);
house(55, 55, 60, 59, { wall: 'W', doors: [[57, 55], [60, 57]], ruin: 0.45, rubbleFloor: 0.4 });
house(4, 30, 8, 34, { wall: 'W', doors: [[8, 32]], ruin: 0.4 });

// muretti sparsi come coperture in campo aperto (solo su sabbia libera)
const covers = [
  [22, 30, 26, 30], [30, 47, 30, 50], [40, 47, 43, 47], [20, 60, 23, 60], [5, 40, 8, 40],
  [26, 24, 26, 27], [52, 46, 55, 46], [62, 50, 66, 50], [40, 4, 43, 4],
];
for (const [a, b, c, d] of covers) {
  const n = Math.max(Math.abs(c - a), Math.abs(d - b));
  for (let k = 0; k <= n; k++) {
    const x = Math.round(a + ((c - a) * k) / (n || 1));
    const y = Math.round(b + ((d - b) * k) / (n || 1));
    set(x, y, 'm', ['.']);
  }
}

// palme lungo la strada nord (lato verso l'oasi)
for (let x = 29; x <= 44; x += 5) set(x, 14, 'P', ['.']);

// ---------- dettagli: cespugli, cespugli secchi, sassi su sabbia libera ----------
for (let y = 0; y < H; y++) {
  for (let x = 0; x <= Math.floor(W / 2); x++) {
    if (G[y][x] !== '.') continue;
    const r = rnd();
    if (r < 0.012) set(x, y, 'b', ['.']);
    else if (r < 0.032) set(x, y, 'd', ['.']);
    else if (r < 0.05) set(x, y, 'o', ['.']);
  }
}

// ---------- bandiere, basi, oggetti raccoglibili (per ultimi) ----------
const clear = (x, y, r = 1) => fill(x - r, y - r, x + r, y + r, '.', ['b', 'd', 'o', 'P', 'm', 'c', 'R', 'r', 'W', 'H']);
clear(7, 55, 2);
set(7, 55, '1');
clear(24, 41);
set(24, 41, 'A');
clear(22, 21);
set(22, 21, 'B');
fill(47, 31, 49, 33, '.');
G[32][48] = 'C';
set(42, 25, 'S'); // fucile a pompa nella casa bianca
set(18, 19, 'G', ['.', 'b', 'd', 'o']); // granate all'oasi
set(32, 33, 'G', ['f', 'F', 'r', '.']); // granate nella casa crollata
set(30, 58, 'S', ['.', 'r', 'd', 'o', 'b']); // fucile a pompa tra le rovine a sud
// mezzi: jeep e carro sulla strada della base (i rossi sono ruotati), jeep neutrale vicino all'oasi
set(13, 53, 'J', ['=']);
set(21, 53, 'T', ['=']);
set(31, 17, 'N', ['=']);
set(30, 53, 'U', ['=']); // elicottero blu (i rossi: ruotato)
// lanciarazzi: fattoria e casa del villaggio
set(30, 44, 'L', ['.', 'r', 'd', 'o', 'b']);
set(42, 40, 'L', ['f', 'F', 'r']);

// rossi: le celle ruotate di "1" e delle bandiere (set() le ha copiate uguali)
{
  const [rx, ry] = rot(7, 55);
  G[ry][rx] = '2';
  const [ex, ey] = rot(24, 41);
  G[ey][ex] = 'E';
  const [dx, dy] = rot(22, 21);
  G[dy][dx] = 'D';
}

// ---------- simmetria forzata (metà destra = metà sinistra ruotata) ----------
const swapTeam = { 1: '2', 2: '1', A: 'E', E: 'A', B: 'D', D: 'B', J: 'K', K: 'J', T: 'Y', Y: 'T', U: 'Z', Z: 'U' };
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const left = x < (W - 1) / 2 || (x === (W - 1) / 2 && y < (H - 1) / 2);
    if (left) continue;
    if (x === (W - 1) / 2 && y === (H - 1) / 2) continue;
    const [sx, sy] = rot(x, y);
    const ch = G[sy][sx];
    G[y][x] = swapTeam[ch] || ch;
  }
}

// ---------- raggiungibilità: celle percorribili non collegate alla base blu -> macerie ----------
const start = (() => {
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (G[y][x] === '1') return [x, y];
})();
const seen = new Set([start.join(',')]);
const q = [start];
while (q.length) {
  const [x, y] = q.pop();
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const nx = x + dx;
    const ny = y + dy;
    const k = `${nx},${ny}`;
    if (!inside(nx, ny) || seen.has(k) || SOLID.has(G[ny][nx])) continue;
    seen.add(k);
    q.push([nx, ny]);
  }
}
let fixed = 0;
for (let y = 0; y < H; y++)
  for (let x = 0; x < W; x++)
    if (!SOLID.has(G[y][x]) && !seen.has(`${x},${y}`)) {
      if (/[12A-E]/.test(G[y][x])) throw new Error(`unreachable ${G[y][x]} at ${x},${y}`);
      G[y][x] = 'R';
      fixed++;
    }

const sand = { tile: ['sand', 'sand2', 'sand3', 'sand4'], variantWeights: [6, 4, 2, 1] };
const level = {
  name: 'Desert village',
  tileset: 'desert',
  fill: 'rock',
  weather: 'desert_wind',
  background: '#3a2a1c',
  legend: {
    '.': sand,
    '=': { tile: ['road', 'road2', 'road3'], variantWeights: [3, 1, 2] },
    '#': ['rock', 'rock2'],
    W: ['adobe', 'adobe2'],
    H: ['plaster', 'plaster2'],
    m: ['lowwall', 'lowwall2'],
    R: ['rubble', 'rubble2'],
    r: ['rubble_floor', 'rubble_floor2'],
    f: { tile: ['house_floor', 'house_floor2'], variantWeights: [3, 1] },
    F: { tile: ['terracotta', 'terracotta2'], variantWeights: [3, 1] },
    '~': 'water',
    c: 'crate',
    P: { tile: 'palm_base', prop: 'palm' },
    b: { ...sand, prop: 'bush' },
    d: { ...sand, prop: 'bush_dry' },
    o: { ...sand, prop: 'pebble' },
    S: { ...sand, pickup: 'shotgun' },
    G: { ...sand, pickup: 'grenades' },
    L: { ...sand, pickup: 'launcher' },
    J: { tile: ['road', 'road2', 'road3'], vehicle: 'jeep', team: 'blue', angleDeg: 0 },
    K: { tile: ['road', 'road2', 'road3'], vehicle: 'jeep', team: 'red', angleDeg: 180 },
    T: { tile: ['road', 'road2', 'road3'], vehicle: 'tank', team: 'blue', angleDeg: 0 },
    Y: { tile: ['road', 'road2', 'road3'], vehicle: 'tank', team: 'red', angleDeg: 180 },
    N: { tile: ['road', 'road2', 'road3'], vehicle: 'jeep', angleDeg: 0 },
    U: { tile: ['road', 'road2', 'road3'], vehicle: 'helicopter', team: 'blue', angleDeg: 0 },
    Z: { tile: ['road', 'road2', 'road3'], vehicle: 'helicopter', team: 'red', angleDeg: 180 },
    1: { ...sand, spawn: 'blue' },
    2: { ...sand, spawn: 'red' },
    A: { ...sand, flag: 'A' },
    B: { ...sand, flag: 'B' },
    C: { ...sand, flag: 'C' },
    D: { ...sand, flag: 'D' },
    E: { ...sand, flag: 'E' },
  },
  flags: {
    A: { owner: 'blue' },
    B: { owner: null },
    C: { owner: null, radius: 44, captureTime: 10 },
    D: { owner: null },
    E: { owner: 'red' },
  },
  map: G.map((r) => r.join('')),
};

// vicoli ciechi e celle isolate: non scrivere un livello che non passa il controllo
{
  const assets = JSON.parse(fs.readFileSync(path.join(process.argv[2] || '.', 'config/assets.json'), 'utf8'));
  const walk = walkGrid(level, assets);
  if (!report('level03', walk, checkGrid(walk))) {
    console.log(level.map.join('\n'));
    console.error('level not written: fix the problems above');
    process.exit(1);
  }
}

// JSON con una riga per voce della legend e per riga di mappa (leggibile e modificabile a mano)
const legend = Object.entries(level.legend).map(([k, v]) => `    ${JSON.stringify(k)}: ${JSON.stringify(v).replace(/,"/g, ', "').replace(/":/g, '": ')}`).join(',\n');
const flags = Object.entries(level.flags).map(([k, v]) => `    ${JSON.stringify(k)}: ${JSON.stringify(v).replace(/,"/g, ', "').replace(/":/g, '": ')}`).join(',\n');
const out = `{
  "name": ${JSON.stringify(level.name)},
  "tileset": "desert",
  "fill": "rock",
  "weather": "desert_wind",
  "background": "${level.background}",
  "legend": {
${legend}
  },
  "flags": {
${flags}
  },
  "map": [
${level.map.map((r) => `    ${JSON.stringify(r)}`).join(',\n')}
  ]
}
`;
JSON.parse(out);
const file = path.join(process.argv[2] || '.', 'config/levels/level03.json');
fs.writeFileSync(file, out);
console.log(`written ${file} (${W}x${H}), unreachable fixed: ${fixed}`);
console.log(level.map.join('\n'));
