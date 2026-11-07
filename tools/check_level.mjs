// Controlla un livello: celle percorribili raggiungibili e vicoli ciechi.
// Uso: node tools/check_level.mjs config/levels/level03.json [altri livelli...]
// Esce con codice 1 se trova problemi. Usato anche dai generatori (export checkGrid).
//
// Vicolo cieco = zona percorribile, profonda almeno `depth` tile, raggiungibile da un solo varco: chiuso
// quel varco non resta altra uscita. Si cerca a più "scale" (s = 1..maxScale): alla scala s una cella conta
// come percorribile solo se lo è tutto il blocco s×s, così un varco largo s diventa un punto di articolazione
// del grafo. La zona dietro un'articolazione è un vicolo cieco solo se, chiuso il varco nel grafo originale,
// non trova un'altra uscita (magari più stretta).
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

/**
 * @param {boolean[][]} walk griglia [y][x] delle celle percorribili
 * @returns {{ unreachable: number, deadEnds: { scale, x, y, depth, cells, box }[] }}
 */
export function checkGrid(walk, { maxScale = 3, depth = 4 } = {}) {
  const H = walk.length;
  const W = walk[0].length;
  const ok = (x, y) => x >= 0 && y >= 0 && x < W && y < H && walk[y][x];
  let total = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (walk[y][x]) total++;

  // componente principale (la più grande) nel grafo originale
  const comp = componentsOf(W, H, ok);
  const unreachable = total - comp.largestSize;

  const deadEnds = [];
  for (let s = 1; s <= maxScale; s++) {
    const fat = (x, y) => {
      if (x < 0 || y < 0 || x + s > W || y + s > H) return false;
      for (let j = 0; j < s; j++) for (let i = 0; i < s; i++) if (!walk[y + j][x + i]) return false;
      return true;
    };
    const fc = componentsOf(W, H, fat);
    const inMain = (x, y) => fat(x, y) && fc.label[y * W + x] === fc.largest;
    for (const ap of articulationPoints(W, H, inMain)) {
      const ax = ap % W;
      const ay = Math.floor(ap / W);
      // componenti senza l'articolazione: tutte tranne la più grande sono "tasche"
      const pockets = [];
      const seen = new Uint8Array(W * H);
      seen[ap] = 1;
      for (const [dx, dy] of DIRS) {
        const sx = ax + dx;
        const sy = ay + dy;
        if (!inMain(sx, sy) || seen[sy * W + sx]) continue;
        const cells = [];
        const q = [[sx, sy, 0]];
        seen[sy * W + sx] = 1;
        let far = 0;
        while (q.length) {
          const [x, y, d] = q.shift();
          cells.push(y * W + x);
          far = Math.max(far, d);
          for (const [ex, ey] of DIRS) {
            const nx = x + ex;
            const ny = y + ey;
            if (!inMain(nx, ny) || seen[ny * W + nx]) continue;
            seen[ny * W + nx] = 1;
            q.push([nx, ny, d + 1]);
          }
        }
        pockets.push({ cells, far });
      }
      pockets.sort((a, b) => b.cells.length - a.cells.length);
      for (const p of pockets.slice(1)) {
        if (p.far + 1 < depth) continue;
        // verifica nel grafo originale: varco chiuso (blocco s×s dell'articolazione), c'è un'altra uscita?
        const blocked = (x, y) => x >= ax && x < ax + s && y >= ay && y < ay + s;
        const start = new Set();
        for (const c of p.cells) {
          const cx = c % W;
          const cy = Math.floor(c / W);
          for (let j = 0; j < s; j++) for (let i = 0; i < s; i++) if (!blocked(cx + i, cy + j)) start.add((cy + j) * W + cx + i);
        }
        const reach = flood(W, H, [...start], (x, y) => ok(x, y) && !blocked(x, y), total / 2);
        if (reach > total / 2) continue;
        let x0 = W, y0 = H, x1 = 0, y1 = 0;
        for (const c of start) {
          x0 = Math.min(x0, c % W); x1 = Math.max(x1, c % W);
          y0 = Math.min(y0, Math.floor(c / W)); y1 = Math.max(y1, Math.floor(c / W));
        }
        deadEnds.push({ scale: s, x: ax, y: ay, depth: p.far + 1, cells: reach, box: [x0, y0, x1, y1] });
      }
    }
  }
  // stessa tasca vista a più scale: tieni la scala più piccola
  const out = [];
  for (const d of deadEnds) {
    if (out.some((o) => o.box[0] <= d.box[0] && o.box[1] <= d.box[1] && o.box[2] >= d.box[2] && o.box[3] >= d.box[3])) continue;
    out.push(d);
  }
  return { unreachable, deadEnds: out };
}

function componentsOf(W, H, ok) {
  const label = new Int32Array(W * H).fill(-1);
  let n = 0;
  let largest = -1;
  let largestSize = 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (!ok(x, y) || label[y * W + x] >= 0) continue;
      const size = floodLabel(W, H, x, y, ok, label, n);
      if (size > largestSize) { largestSize = size; largest = n; }
      n++;
    }
  }
  return { label, largest, largestSize };
}

function floodLabel(W, H, x0, y0, ok, label, id) {
  const q = [[x0, y0]];
  label[y0 * W + x0] = id;
  let size = 0;
  while (q.length) {
    const [x, y] = q.pop();
    size++;
    for (const [dx, dy] of DIRS) {
      const nx = x + dx;
      const ny = y + dy;
      if (!ok(nx, ny) || label[ny * W + nx] >= 0) continue;
      label[ny * W + nx] = id;
      q.push([nx, ny]);
    }
  }
  return size;
}

function flood(W, H, starts, ok, limit) {
  const seen = new Uint8Array(W * H);
  const q = [];
  for (const c of starts) {
    if (!ok(c % W, Math.floor(c / W)) || seen[c]) continue;
    seen[c] = 1;
    q.push(c);
  }
  let n = 0;
  while (q.length) {
    const c = q.pop();
    if (++n > limit) return n;
    const x = c % W;
    const y = Math.floor(c / W);
    for (const [dx, dy] of DIRS) {
      const nx = x + dx;
      const ny = y + dy;
      if (!ok(nx, ny) || seen[ny * W + nx]) continue;
      seen[ny * W + nx] = 1;
      q.push(ny * W + nx);
    }
  }
  return n;
}

/** Punti di articolazione (Tarjan iterativo) del grafo a 4 vicini. */
function articulationPoints(W, H, ok) {
  const disc = new Int32Array(W * H).fill(-1);
  const low = new Int32Array(W * H);
  const aps = new Set();
  let time = 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const root = y * W + x;
      if (!ok(x, y) || disc[root] >= 0) continue;
      disc[root] = low[root] = time++;
      let rootChildren = 0;
      const stack = [[root, -1, 0]];
      while (stack.length) {
        const top = stack[stack.length - 1];
        const [v, parent] = top;
        if (top[2] < 4) {
          const [dx, dy] = DIRS[top[2]++];
          const nx = (v % W) + dx;
          const ny = Math.floor(v / W) + dy;
          if (!ok(nx, ny)) continue;
          const u = ny * W + nx;
          if (disc[u] < 0) {
            disc[u] = low[u] = time++;
            stack.push([u, v, 0]);
          } else if (u !== parent) low[v] = Math.min(low[v], disc[u]);
          continue;
        }
        stack.pop();
        if (parent < 0) continue;
        low[parent] = Math.min(low[parent], low[v]);
        if (parent === root) rootChildren++;
        else if (low[v] >= disc[parent]) aps.add(parent);
      }
      if (rootChildren > 1) aps.add(root);
    }
  }
  return aps;
}

/** Griglia percorribile di un livello JSON (solidità dai tile del tileset in assets.json). */
export function walkGrid(level, assets) {
  const tiles = assets.tilesets[level.tileset].tiles;
  const solidTile = (t) => {
    const name = Array.isArray(t) ? t[0] : t;
    const def = tiles.find((d) => d.name === name || d.id === name);
    return !def || def.solid;
  };
  const solidChar = {};
  for (const [ch, v] of Object.entries(level.legend)) solidChar[ch] = solidTile(typeof v === 'object' && !Array.isArray(v) ? v.tile : v);
  const W = Math.max(...level.map.map((r) => r.length));
  return level.map.map((r) => Array.from({ length: W }, (_, x) => {
    const ch = r[x] ?? level.fill;
    return ch in solidChar ? !solidChar[ch] : !solidTile(ch);
  }));
}

/** Stampa il risultato; restituisce true se il livello è a posto. */
export function report(name, walk, result) {
  const W = walk[0].length;
  const H = walk.length;
  const bad = result.unreachable > 0 || result.deadEnds.length > 0;
  console.log(`${name}: ${W}x${H}, unreachable cells: ${result.unreachable}, dead ends: ${result.deadEnds.length}`);
  for (const d of result.deadEnds) {
    console.log(`  dead end (width ${d.scale}) at ${d.x},${d.y}: depth ${d.depth}, ${d.cells} cells, box ${d.box.join(',')}`);
  }
  return !bad;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const assets = JSON.parse(fs.readFileSync(path.resolve('config/assets.json'), 'utf8'));
  let good = true;
  for (const file of process.argv.slice(2)) {
    const level = JSON.parse(fs.readFileSync(file, 'utf8'));
    const walk = walkGrid(level, assets);
    good = report(file, walk, checkGrid(walk)) && good;
  }
  process.exit(good ? 0 : 1);
}
