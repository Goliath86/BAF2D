// Genera config/levels/level04.json: "Countryside" 97x65, campagna tra due linee di trincea, simmetrica per
// rotazione di 180°, senza vicoli ciechi. Uso (dalla cartella del repo): node tools/gen_countryside.mjs
// Si disegna la metà sinistra: set() scrive anche la cella ruotata, symmetrize() ricopia tutto scambiando i
// caratteri di squadra. Ordine: terreno, campi, siepi, frutteto, trincee, casale, strade (tagliano tutto),
// dettagli, bandiere/basi/oggetti.
import { createGrid, random, writeLevel } from './levelgen.mjs';

const g = createGrid(97, 65, '.');
const rnd = random(20261107);
const { W, H, G } = g;
const SOLID = new Set(['#', 'h', 's', 'W', 'w', '~', 'x', 'R', 'P', 'Q', '-', '|', 'H']);
const OPEN = ['.', 'b', 'k', ':', ';'];

// ---------- bordo di bosco irregolare ----------
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const d = Math.min(x, y, W - 1 - x, H - 1 - y);
    const t = 2 + Math.max(0, Math.round(1 + Math.sin(x * 0.41) * 1.2 + Math.cos(y * 0.37) * 1.1 + Math.sin((x - y) * 0.19)));
    if (d < t) G[y][x] = '#';
  }
}

// ---------- utilità ----------
function disc(cx, cy, r, ch, only) {
  for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++)
    for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++)
      if (Math.hypot(x - cx, y - cy) <= r) g.set(x, y, ch, only);
}
/** Percorre una spezzata a passi di mezza cella: fn(cx, cy, nx, ny, k) con (nx, ny) = normale del tratto. */
function walk(points, fn) {
  let k = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const [x0, y0] = points[i];
    const [x1, y1] = points[i + 1];
    const len = Math.hypot(x1 - x0, y1 - y0);
    const n = Math.ceil(len * 2);
    for (let j = 0; j <= n; j++) fn(x0 + ((x1 - x0) * j) / n, y0 + ((y1 - y0) * j) / n, -(y1 - y0) / len, (x1 - x0) / len, k++);
  }
}
function road(points, w = 5) {
  const r = (w - 1) / 2;
  walk(points, (cx, cy) => disc(cx, cy, r + 0.3, '='));
}
function hedge(x0, y0, x1, y1, gaps = []) {
  g.line(x0, y0, x1, y1, 'h', gaps);
}

/**
 * Trincea: fondo largo 2 lungo la spezzata (con assi a tratti), parapetto di sacchi su entrambi i lati,
 * uscite ogni "every" passi (alternate a destra e a sinistra) e alle due estremità.
 */
function trench(points, every = 16) {
  const floor = new Set();
  walk(points, (cx, cy) => {
    for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) floor.add(`${Math.floor(cx) + dx},${Math.floor(cy) + dy}`);
  });
  for (const k of floor) {
    const [x, y] = k.split(',').map(Number);
    g.set(x, y, rnd() < 0.45 ? 'n' : 'u');
  }
  for (const k of floor) {
    const [x, y] = k.split(',').map(Number);
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) g.set(x + dx, y + dy, 's', OPEN);
  }
  // uscite: varco largo 2 attraverso il parapetto, perpendicolare al tratto
  const exit = (cx, cy, nx, ny, side) => {
    for (let t = 0; t <= 3; t++) {
      for (const [ox, oy] of [[0, 0], [ny, -nx]]) {
        const x = Math.round(cx + 0.5 + nx * side * t + ox);
        const y = Math.round(cy + 0.5 + ny * side * t + oy);
        g.set(x, y, '.', ['s']);
      }
    }
  };
  let last = null;
  walk(points, (cx, cy, nx, ny, k) => {
    if (k === 2) { exit(cx, cy, nx, ny, 1); exit(cx, cy, nx, ny, -1); }
    if (k > 0 && k % every === 0) exit(cx, cy, nx, ny, (k / every) % 2 ? 1 : -1);
    last = [cx, cy, nx, ny];
  });
  exit(last[0], last[1], last[2], last[3], 1);
  exit(last[0], last[1], last[2], last[3], -1);
}

/** Casa di mattoni: muri, pavimento di assi, porte = celle aperte nel muro, crolli (macerie) a caso. */
function house(x0, y0, x1, y1, doors, ruin = 0.08) {
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const edge = x === x0 || x === x1 || y === y0 || y === y1;
      if (!edge) g.set(x, y, rnd() < 0.08 ? 'r' : 'f');
      else if (doors.some(([dx, dy]) => dx === x && dy === y)) g.set(x, y, 'f');
      else g.set(x, y, rnd() < ruin ? 'R' : 'W');
    }
  }
}

// ---------- campi e siepi (la metà sinistra; la destra è ruotata) ----------
g.fill(4, 25, 16, 34, ':', OPEN); // grano a ovest
g.fill(21, 26, 29, 33, ';', OPEN); // ortaggi
g.fill(38, 4, 46, 10, ':', OPEN); // grano a nord, verso lo stagno
hedge(3, 23, 33, 23, [5, 6, 13, 14, 22, 23]);
hedge(19, 25, 19, 35, [4, 5]);
hedge(34, 12, 34, 22, [4, 5]);
hedge(37, 12, 47, 12, [3, 4]);
hedge(24, 44, 28, 44);

// ---------- frutteto (bandiera D) con staccionata ----------
for (let y = 6; y <= 20; y += 3) {
  for (let x = 7 + ((y / 3) % 2 ? 2 : 0); x <= 30; x += 4) {
    if (Math.hypot(x - 18, y - 13) < 4.5) continue;
    g.set(x, y, 'Q', OPEN);
  }
}
g.line(6, 21, 31, 21, '-', [6, 7, 14, 15, 22, 23]);
g.line(32, 4, 32, 20, '|', [0, 1, 7, 8, 13, 14]); // varco in cima: niente vicolo cieco tra stagno e bosco

// ---------- stagno ----------
for (let y = 4; y <= 12; y++) {
  for (let x = 28; x <= 42; x++) {
    const d = ((x - 35) / 4.6) ** 2 + ((y - 8) / 2.7) ** 2;
    if (d <= 1) g.set(x, y, '~');
    else if (d <= 1.9 && OPEN.includes(g.get(x, y)) && rnd() < 0.35) g.set(x, y, 'b');
  }
}

// ---------- crateri nella terra di nessuno ----------
for (const [x, y, r] of [[38, 47, 2.2], [27, 38, 1.6], [41, 19, 2], [33, 28, 1.8], [44, 52, 1.6], [24, 31, 1.4], [12, 42, 1.4], [45, 14, 1.5]]) {
  disc(x, y, r, 'o', [...OPEN, 'h']);
}

// ---------- trincea blu: fronte nord (a zig-zag) e fronte est, posto di comando con la bandiera A ----------
trench([[4, 40], [9, 37], [15, 40], [21, 37], [27, 40], [31, 37], [35, 42], [31, 47], [35, 52], [31, 57], [33, 59]], 14);
// posto di comando: anello di sacchi con quattro varchi
for (let a = 0; a < 64; a++) {
  const t = (a / 64) * Math.PI * 2;
  g.set(Math.round(18 + Math.cos(t) * 5), Math.round(49 + Math.sin(t) * 4), 's', OPEN);
}
for (const [x0, y0, x1, y1] of [[12, 48, 14, 50], [22, 48, 24, 50], [17, 44, 19, 46], [17, 52, 19, 54]]) g.fill(x0, y0, x1, y1, '.', ['s']);
// nidi di mitragliatrice (archi di sacchi) e casse dietro la linea
for (const [x, y] of [[24, 46], [10, 45]]) g.line(x, y, x + 2, y, 's');
g.fill(26, 53, 27, 53, 'x', OPEN);
g.fill(5, 47, 5, 48, 'x', OPEN);

// ---------- casale al centro (bandiera C): quattro edifici agli angoli di un cortile a croce ----------
house(38, 23, 45, 29, [[45, 26], [41, 29], [38, 25]]); // NO (-> SE ruotato)
house(38, 35, 45, 41, [[41, 35], [45, 38], [40, 41], [38, 39]]); // SO (-> NE ruotato)
g.fill(46, 30, 48, 34, '.', ['W', 'R', 'f', 'r']);
// balle di fieno nel cortile, agli angoli (coperture vicino alla bandiera)
g.set(46, 30, 'H');
g.set(46, 34, 'H');

// ---------- strade (tagliano campi, siepi, trincee) ----------
road([[3, 58], [26, 58], [36, 55], [44, 47], [48, 42], [48, 36]]); // base -> cancello sud del casale
road([[8, 58], [8, 30], [12, 24], [17, 18]]); // base -> frutteto
road([[17, 18], [28, 24], [33, 32], [40, 32]], 5); // frutteto -> cancello ovest del casale
// la strada scopre la trincea: niente fondo di trincea isolato sotto l'asfalto, solo bordi di sacchi rimasti
// (tolti i sacchi a contatto con la strada, così l'incrocio è un passaggio largo)
for (let y = 0; y < H; y++) {
  for (let x = 0; x <= 48; x++) {
    if (G[y][x] !== 's') continue;
    let near = false;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (g.get(x + dx, y + dy) === '=') near = true;
    if (near) g.set(x, y, '.');
  }
}

// ---------- boschetti e dettagli ----------
function copse(cx, cy, n, spread) {
  for (let i = 0; i < n; i++) {
    const x = Math.round(cx + (rnd() - 0.5) * spread * 2);
    const y = Math.round(cy + (rnd() - 0.5) * spread * 2);
    let free = true;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (!OPEN.includes(g.get(x + dx, y + dy)) || ['P', 'Q'].includes(g.get(x + dx, y + dy))) free = false;
    if (free) g.set(x, y, 'P');
  }
}
copse(5, 50, 4, 2);
copse(26, 50, 5, 3);
copse(42, 58, 5, 3);
copse(39, 16, 4, 2);
copse(12, 30, 2, 2);
for (let y = 0; y < H; y++) {
  for (let x = 0; x <= Math.floor(W / 2); x++) {
    if (G[y][x] !== '.') continue;
    const r = rnd();
    if (r < 0.012) g.set(x, y, 'b', ['.']);
    else if (r < 0.022) g.set(x, y, 'k', ['.']);
    else if (r < 0.027) {
      let free = true;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (!OPEN.includes(g.get(x + dx, y + dy))) free = false;
      if (free) g.set(x, y, 'P', ['.']);
    }
  }
}

// ---------- bandiere, basi, oggetti, mezzi ----------
const clear = (x, y, r = 1) => g.fill(x - r, y - r, x + r, y + r, '.', ['b', 'k', 'P', 'Q', 'x', ':', ';']);
clear(6, 55, 2);
G[55][6] = '1';
clear(18, 49);
G[49][18] = 'A';
clear(18, 13, 2);
G[13][18] = 'D';
g.fill(47, 31, 49, 33, '.');
G[32][48] = 'C';
G[58][13] = 'J'; // jeep blu sulla strada della base
G[58][20] = 'V'; // carro blu
G[24][27] = 'N'; // jeep neutrale sulla strada del frutteto
G[26][41] = 'S'; // fucile a pompa nel casale
G[38][42] = 'L'; // lanciarazzi nel casale
G[45][33] = 'L'; // lanciarazzi in trincea
G[49][21] = 'G'; // granate al posto di comando
G[9][24] = 'S'; // fucile a pompa nel frutteto
G[29][33] = 'G'; // granate al cratere

g.symmetrize({ 1: '2', 2: '1', A: 'E', E: 'A', B: 'D', D: 'B', J: 'K', K: 'J', V: 'Y', Y: 'V' });

// ---------- celle percorribili isolate (rumore del bordo, angoli) -> bosco ----------
{
  const start = g.find('1');
  const seen = new Set([start.join(',')]);
  const q = [start];
  while (q.length) {
    const [x, y] = q.pop();
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx;
      const ny = y + dy;
      const k = `${nx},${ny}`;
      if (!g.inside(nx, ny) || seen.has(k) || SOLID.has(G[ny][nx])) continue;
      seen.add(k);
      q.push([nx, ny]);
    }
  }
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (SOLID.has(G[y][x]) || seen.has(`${x},${y}`)) continue;
      if (/[12A-ESGLJKVYN]/.test(G[y][x])) throw new Error(`unreachable ${G[y][x]} at ${x},${y}`);
      G[y][x] = '#';
    }
  }
}

const grass = { tile: ['grass', 'grass2', 'grass3', 'grass4'], variantWeights: [6, 4, 2, 2] };
const dirt = ['dirt', 'dirt2'];
writeLevel('config/levels/level04.json', {
  name: 'Countryside',
  tileset: 'countryside',
  fill: 'woods',
  weather: 'country_breeze',
  background: '#1e2e16',
  legend: {
    '.': grass,
    '=': dirt,
    '#': ['woods', 'woods2'],
    u: { tile: ['trench', 'trench2'], variantWeights: [3, 1] },
    n: 'duckboard',
    o: { tile: ['crater', 'crater2'], variantWeights: [3, 1] },
    s: ['sandbags', 'sandbags2'],
    h: ['hedge', 'hedge2'],
    W: 'brick',
    w: 'stonewall',
    f: 'planks',
    ':': 'field',
    ';': 'field_green',
    '-': 'fence_h',
    '|': 'fence_v',
    '~': 'water',
    x: 'crate',
    R: 'rubble',
    r: 'rubble_floor',
    H: 'hay',
    P: { tile: 'tree_base', prop: 'tree' },
    Q: { tile: 'tree_base', prop: 'tree_fruit' },
    b: { ...grass, prop: 'bush_green' },
    k: { ...grass, prop: 'stone_grey' },
    S: { ...grass, pickup: 'shotgun' },
    G: { ...grass, pickup: 'grenades' },
    L: { ...grass, pickup: 'launcher' },
    J: { tile: dirt, vehicle: 'jeep', team: 'blue', angleDeg: 0 },
    K: { tile: dirt, vehicle: 'jeep', team: 'red', angleDeg: 180 },
    V: { tile: dirt, vehicle: 'tank', team: 'blue', angleDeg: 0 },
    Y: { tile: dirt, vehicle: 'tank', team: 'red', angleDeg: 180 },
    N: { tile: dirt, vehicle: 'jeep', angleDeg: 30 },
    1: { ...grass, spawn: 'blue' },
    2: { ...grass, spawn: 'red' },
    A: { ...grass, flag: 'A' },
    B: { ...grass, flag: 'B' },
    C: { ...grass, flag: 'C' },
    D: { ...grass, flag: 'D' },
    E: { ...grass, flag: 'E' },
  },
  flags: {
    A: { owner: 'blue' },
    B: { owner: null },
    C: { owner: null, radius: 44, captureTime: 10 },
    D: { owner: null },
    E: { owner: 'red' },
  },
}, g);
