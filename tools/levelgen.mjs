// Utilità comuni dei generatori di livelli (tools/gen_*.mjs): griglia di caratteri simmetrica per rotazione
// di 180°, forme base (rettangoli, linee, stanze con porte), controllo di raggiungibilità e vicoli ciechi,
// scrittura del JSON nello stesso formato leggibile (una riga per voce della legend e per riga di mappa).
import fs from 'node:fs';
import path from 'node:path';
import { checkGrid, report, walkGrid } from './check_level.mjs';

export function createGrid(W, H, ch = '.') {
  const G = Array.from({ length: H }, () => Array(W).fill(ch));
  const inside = (x, y) => x >= 0 && y >= 0 && x < W && y < H;
  const rot = (x, y) => [W - 1 - x, H - 1 - y];
  const g = {
    W, H, G, inside, rot,
    get: (x, y) => (inside(x, y) ? G[y][x] : '#'),
    /** Imposta la cella e la sua ruotata; `only` = caratteri sostituibili. */
    set(x, y, c, only = null) {
      for (const [a, b] of [[x, y], rot(x, y)]) {
        if (!inside(a, b) || (only && !only.includes(G[b][a]))) continue;
        G[b][a] = c;
      }
    },
    fill(x0, y0, x1, y1, c, only) {
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) g.set(x, y, c, only);
    },
    /** Linea (orizzontale/verticale/diagonale); `gaps` = indici dei passi lasciati liberi. */
    line(x0, y0, x1, y1, c, gaps = []) {
      const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
      for (let k = 0; k <= n; k++) {
        if (gaps.includes(k)) continue;
        g.set(Math.round(x0 + ((x1 - x0) * k) / (n || 1)), Math.round(y0 + ((y1 - y0) * k) / (n || 1)), c);
      }
    },
    /** Stanza: muri sul perimetro, pavimento dentro, porte = rettangoli [x0, y0, x1, y1] aperti nel muro. */
    room(x0, y0, x1, y1, { wall = '#', floor = '.', doors = [] } = {}) {
      g.fill(x0, y0, x1, y1, wall);
      g.fill(x0 + 1, y0 + 1, x1 - 1, y1 - 1, floor);
      for (const [a, b, c = a, d = b] of doors) g.fill(a, b, c, d, floor);
    },
    /** Copia la metà sinistra (ruotata) sulla destra, scambiando i caratteri di squadra. */
    symmetrize(swap = {}) {
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const left = x < (W - 1) / 2 || (x === (W - 1) / 2 && y < (H - 1) / 2);
          if (left || (x === (W - 1) / 2 && y === (H - 1) / 2)) continue;
          const [sx, sy] = rot(x, y);
          const c = G[sy][sx];
          G[y][x] = swap[c] || c;
        }
      }
    },
    find(c) {
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (G[y][x] === c) return [x, y];
      return null;
    },
    rows: () => G.map((r) => r.join('')),
  };
  return g;
}

/** Generatore pseudo-casuale deterministico (stesso seme = stessa mappa). */
export function random(seed) {
  return () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
}

const entry = ([k, v]) => `    ${JSON.stringify(k)}: ${JSON.stringify(v).replace(/,"/g, ', "').replace(/":/g, '": ')}`;

/**
 * Controlla e scrive il livello. `level` = { name, tileset, fill, ...extra, legend, flags } (la mappa viene da g).
 * Interrompe senza scrivere se ci sono celle irraggiungibili o vicoli ciechi.
 */
export function writeLevel(file, level, g) {
  const map = g.rows();
  const assets = JSON.parse(fs.readFileSync(path.resolve('config/assets.json'), 'utf8'));
  const walk = walkGrid({ ...level, map }, assets);
  const res = checkGrid(walk);
  console.log(map.join('\n'));
  if (!report(file, walk, res)) {
    console.error('level not written: fix the problems above');
    process.exit(1);
  }
  const head = Object.entries(level)
    .filter(([k]) => k !== 'legend' && k !== 'flags')
    .map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)},`)
    .join('\n');
  const out = `{
${head}
  "legend": {
${Object.entries(level.legend).map(entry).join(',\n')}
  },
  "flags": {
${Object.entries(level.flags).map(entry).join(',\n')}
  },
  "map": [
${map.map((r) => `    ${JSON.stringify(r)}`).join(',\n')}
  ]
}
`;
  JSON.parse(out);
  fs.writeFileSync(path.resolve(file), out);
  console.log(`written ${file}`);
}
