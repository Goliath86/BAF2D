// Genera config/levels/level05.json: "Millstream Valley" 97x65, una valle boscosa tagliata da un fiume a S, simmetrica
// per rotazione di 180°, senza vicoli ciechi. Uso (dalla cartella del repo): node tools/gen_valley.mjs
//
// Il fiume attraversa la mappa da ovest a est e al centro si apre attorno a un'isola con le rovine del mulino
// (bandiera C), raggiunta da due ponti di legno. Due ponti larghi per i mezzi (ovest ed est) e due passerelle
// strette per la fanteria; la sponda sud è della squadra blu (base in basso a sinistra), quella nord della rossa.
// Su ogni sponda un villaggio (B / D) e una vecchia torre di guardia in pietra vicino alla base (A / E).
// Si disegna con set() (scrive anche la cella ruotata) e alla fine symmetrize() ricopia la metà sinistra
// scambiando i caratteri di squadra.
import { createGrid, random, writeLevel } from './levelgen.mjs';

const g = createGrid(97, 65, '.');
const rnd = random(20261116);
const { W, H, G } = g;
const SOLID = new Set(['#', 'h', 's', 'W', 'w', '~', 'x', 'R', 'P', 'Q', '-', '|', 'H']);
const OPEN = ['.', 'b', 'k', ':', ';'];
const CX = (W - 1) / 2;
const CY = (H - 1) / 2;

// ---------- bordo di bosco irregolare (la valle) ----------
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const d = Math.min(x, y, W - 1 - x, H - 1 - y);
    const t = 2 + Math.max(0, Math.round(1.2 + Math.sin(x * 0.29) * 1.3 + Math.cos(y * 0.33) * 1.2 + Math.sin((x + y) * 0.13)));
    if (d < t) G[y][x] = '#';
  }
}

// ---------- utilità ----------
function disc(cx, cy, r, ch, only) {
  for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++)
    for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++)
      if (Math.hypot(x - cx, y - cy) <= r) g.set(x, y, ch, only);
}
function walk(points, fn) {
  for (let i = 0; i < points.length - 1; i++) {
    const [x0, y0] = points[i];
    const [x1, y1] = points[i + 1];
    const n = Math.ceil(Math.hypot(x1 - x0, y1 - y0) * 2);
    for (let j = 0; j <= n; j++) fn(x0 + ((x1 - x0) * j) / n, y0 + ((y1 - y0) * j) / n);
  }
}
function road(points, w = 4) {
  walk(points, (cx, cy) => disc(cx, cy, (w - 1) / 2 + 0.3, '=', [...OPEN, 'h', '#']));
}
/** Casa di pietra: muri, pavimento di assi, porte = celle aperte nel muro, crolli (macerie) a caso. */
function house(x0, y0, x1, y1, doors, ruin = 0.1) {
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const edge = x === x0 || x === x1 || y === y0 || y === y1;
      if (!edge) g.set(x, y, rnd() < 0.08 ? 'r' : 'f');
      else if (doors.some(([dx, dy]) => dx === x && dy === y)) g.set(x, y, 'f');
      else g.set(x, y, rnd() < ruin ? 'R' : 'W');
    }
  }
}

// ---------- fiume a S con l'isola del mulino ----------
// asse del fiume: y = CY + 9 sin(pi (x - CX) / 48) (funzione dispari attorno al centro: la rotazione lo riporta su sé
// stesso); più largo al centro, dove l'isola lo divide in due rami
const riverY = (x) => CY + 9 * Math.sin((Math.PI * (x - CX)) / 48);
const halfWidth = (x) => 2.6 + 5.8 * Math.max(0, 1 - Math.abs(x - CX) / 13) ** 0.7;
const island = (x, y) => ((x - CX) / 10) ** 2 + ((y - riverY(x)) / 3.4) ** 2 <= 1;
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    if (Math.abs(y - riverY(x)) <= halfWidth(x) && !island(x, y)) g.set(x, y, '~');
  }
}
// canneti e sassi sulle sponde (sopra il bosco del bordo no)
for (let y = 0; y < H; y++) {
  for (let x = 0; x <= CX; x++) {
    const d = Math.abs(y - riverY(x)) - halfWidth(x);
    if (d > 0 && d < 1.6 && G[y][x] === '.' && rnd() < 0.18) g.set(x, y, rnd() < 0.6 ? 'b' : 'k');
  }
}

/** Ponte verticale di assi largo w (x0..x0+w-1) sopra l'acqua, con parapetti (staccionata) ai lati sull'acqua. */
function bridge(x0, w, yFrom, yTo) {
  for (let y = yFrom; y <= yTo; y++) {
    const water = (x) => G[y][x] === '~';
    const wet = water(x0 - 1) || water(x0 + w) || [...Array(w)].some((_, i) => water(x0 + i));
    if (!wet) continue;
    for (let i = 0; i < w; i++) g.set(x0 + i, y, 'n');
    g.set(x0 - 1, y, '|', ['~']);
    g.set(x0 + w, y, '|', ['~']);
  }
}
// ponti larghi per i mezzi (ovest; l'est è il ruotato) e passerelle per la fanteria
bridge(18, 4, 14, 33);
bridge(33, 1, 15, 33);
// ponti dell'isola: dalla sponda sud all'isola (il ruotato va dall'isola alla sponda nord)
bridge(47, 3, 34, 44);

// ---------- strade ----------
road([[7, 57], [22, 57], [28, 52], [28, 44]]); // base blu -> villaggio B
road([[19.5, 57], [19.5, 34], [19.5, 14], [24, 8], [40, 6]]); // base -> ponte ovest -> sponda nord
road([[28, 44], [40, 44], [48, 42]], 3); // villaggio -> ponte sud dell'isola
road([[19.5, 40], [28, 44]], 3);

// ---------- torre di guardia (bandiera A): anello di pietra con quattro varchi ----------
for (let a = 0; a < 72; a++) {
  const t = (a / 72) * Math.PI * 2;
  g.set(Math.round(10 + Math.cos(t) * 4.5), Math.round(43 + Math.sin(t) * 3.5), 'w', OPEN);
}
for (const [x0, y0, x1, y1] of [[4, 42, 6, 44], [14, 42, 16, 44], [9, 38, 11, 40], [9, 46, 11, 48]]) g.fill(x0, y0, x1, y1, '.', ['w']);
g.set(8, 42, 'x');
g.set(12, 44, 'x');

// ---------- villaggio sud (bandiera B): case di pietra attorno a una piazza ----------
house(22, 38, 27, 42, [[27, 40], [24, 38], [22, 41]]);
house(31, 37, 37, 41, [[31, 39], [34, 41], [37, 38]]);
house(32, 47, 37, 51, [[32, 49], [34, 47], [37, 50]]);
g.fill(28, 43, 31, 46, '.', ['W', 'R', 'f', 'r', '=']); // piazza
g.set(29, 45, 'H');
// orti e campi attorno al villaggio, frutteto verso la torre
g.fill(22, 46, 29, 50, ':', OPEN);
g.fill(38, 52, 44, 57, ';', OPEN);
for (let y = 49; y <= 55; y += 3) for (let x = 6 + ((y / 3) % 2 ? 2 : 0); x <= 16; x += 4) g.set(x, y, 'Q', OPEN);
// siepi tra i campi (con varchi)
g.line(21, 52, 30, 52, 'h', [3, 4, 5]);
g.line(38, 51, 44, 51, 'h', [2, 3]);
g.line(45, 50, 45, 57, 'h', [3, 4]);

// ---------- isola del mulino (bandiera C): rovine del mulino, mola, sacchi ----------
// rovine del mulino: spezzoni di muro e macerie attorno alla bandiera (il ruotato fa l'altra metà); l'isola è
// un'ellisse inclinata come il fiume: niente muri lunghi, che ne chiuderebbero le punte
g.line(45, 29, 46, 29, 'W');
g.set(44, 31, 'R');
g.set(45, 34, 'x');

// ---------- dettagli: rocce sulle pendici, cespugli, alberi ----------
// massi: un blocco 2x2 più qualche cella a caso attorno (forme irregolari, non croci)
for (const [x, y] of [[38, 60], [44, 8], [5, 24], [26, 59], [14, 30]]) {
  g.fill(x, y, x + 1, y + 1, 'R', OPEN);
  for (const [dx, dy] of [[-1, 0], [2, 1], [0, -1], [1, 2], [-1, 1], [2, 0]]) if (rnd() < 0.4) g.set(x + dx, y + dy, 'R', OPEN);
}
function copse(cx, cy, n, spread) {
  for (let i = 0; i < n; i++) {
    const x = Math.round(cx + (rnd() - 0.5) * spread * 2);
    const y = Math.round(cy + (rnd() - 0.5) * spread * 2);
    let free = true;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (!OPEN.includes(g.get(x + dx, y + dy)) || ['P', 'Q'].includes(g.get(x + dx, y + dy))) free = false;
    if (free) g.set(x, y, 'P');
  }
}
copse(40, 36, 3, 2);
copse(12, 33, 4, 2.5);
copse(44, 62, 3, 2);
copse(30, 8, 4, 3);
copse(8, 10, 4, 3);
for (let y = 0; y < H; y++) {
  for (let x = 0; x <= Math.floor(CX); x++) {
    if (G[y][x] !== '.') continue;
    const r = rnd();
    if (r < 0.012) g.set(x, y, 'b', ['.']);
    else if (r < 0.022) g.set(x, y, 'k', ['.']);
    else if (r < 0.028) {
      let free = true;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (!OPEN.includes(g.get(x + dx, y + dy))) free = false;
      if (free) g.set(x, y, 'P', ['.']);
    }
  }
}

// ---------- bandiere, basi, oggetti, mezzi ----------
const clear = (x, y, r = 1) => g.fill(x - r, y - r, x + r, y + r, '.', ['b', 'k', 'P', 'Q', 'x', ':', ';', 'R']);
clear(6, 57, 2);
G[57][6] = '1';
clear(10, 43);
G[43][10] = 'A';
clear(29, 44);
G[44][29] = 'B';
g.fill(47, 31, 49, 33, '.', ['b', 'k', 'R', 'x']);
G[32][48] = 'C';
G[57][13] = 'J'; // jeep blu sulla strada della base
G[54][24] = 'V'; // carro blu
G[60][16] = 'U'; // elicottero blu
G[40][25] = 'S'; // fucile a pompa nella prima casa
G[49][35] = 'L'; // lanciarazzi nella casa sud del villaggio
G[33][44] = 'L'; // lanciarazzi tra le rovine del mulino
G[44][13] = 'G'; // granate alla torre
G[36][14] = 'S'; // fucile a pompa nel boschetto
G[44][40] = 'G'; // granate sulla strada del ponte
G[47][17] = 'a'; // casse di munizioni: alla torre e prima del ponte ovest
G[36][22] = 'a';

g.symmetrize({ 1: '2', 2: '1', A: 'E', E: 'A', B: 'D', D: 'B', J: 'K', K: 'J', V: 'Y', Y: 'V', U: 'Z', Z: 'U' });

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
      if (/[12A-ESGLJKVYUZa]/.test(G[y][x])) throw new Error(`unreachable ${G[y][x]} at ${x},${y}`);
      G[y][x] = '#';
    }
  }
}

const grass = { tile: ['grass', 'grass2', 'grass3', 'grass4'], variantWeights: [6, 4, 2, 2] };
const dirt = ['dirt', 'dirt2'];
writeLevel('config/levels/level05.json', {
  name: 'Millstream Valley',
  tileset: 'countryside',
  fill: 'woods',
  weather: 'country_breeze',
  background: '#1e2e16',
  legend: {
    '.': grass,
    '=': dirt,
    '#': ['woods', 'woods2'],
    '~': 'water',
    n: 'planks',
    W: 'stonewall',
    w: 'stonewall',
    f: 'planks',
    r: 'rubble_floor',
    R: 'rubble',
    ':': 'field',
    ';': 'field_green',
    h: ['hedge', 'hedge2'],
    '-': 'fence_h',
    '|': 'fence_v',
    x: 'crate',
    H: 'hay',
    P: { tile: 'tree_base', prop: 'tree' },
    Q: { tile: 'tree_base', prop: 'tree_fruit' },
    b: { ...grass, prop: 'bush_green' },
    k: { ...grass, prop: 'stone_grey' },
    S: { ...grass, pickup: 'shotgun' },
    G: { ...grass, pickup: 'grenades' },
    L: { ...grass, pickup: 'launcher' },
    a: { ...grass, pickup: 'ammo' },
    J: { tile: dirt, vehicle: 'jeep', team: 'blue', angleDeg: 0 },
    K: { tile: dirt, vehicle: 'jeep', team: 'red', angleDeg: 180 },
    V: { tile: dirt, vehicle: 'tank', team: 'blue', angleDeg: -90 },
    Y: { tile: dirt, vehicle: 'tank', team: 'red', angleDeg: 90 },
    U: { ...grass, vehicle: 'helicopter', team: 'blue', angleDeg: 0 },
    Z: { ...grass, vehicle: 'helicopter', team: 'red', angleDeg: 180 },
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
