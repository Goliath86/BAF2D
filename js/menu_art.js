// Disegni della scena del menu (js/menu_scene.js): ripresa dall'alto di un drone con la camera termica.
// Tutto è disegnato in "calore" (grigio 0..1, 1 = più caldo); la scena lo converte nella tavolozza del sensore
// (bianco caldo, nero caldo...). Qui: primitive a pixel, rumore stabile, rete stradale infinita (City), pezzi di
// città 128x128 (paintChunk: sabbia, strade, isolati con case, cortili, moschee, rovine, accampamenti), sprite
// termici di mezzi ed elicottero, carattere a pixel 3x5 dell'HUD. Misure e valori in config/menu_scene.json.

const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16);
export const bayer = (x, y) => BAYER[(y & 3) * 4 + (x & 3)];

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const rnd = (a, b) => a + Math.random() * (b - a);
export const range = (r, d = [0, 1]) => rnd(...(Array.isArray(r) ? r : d));
export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const pick = (list) => list[Math.floor(Math.random() * list.length)];

export function hex(c) {
  const h = String(c).replace('#', '');
  const n = parseInt(h.length === 3 ? h.replace(/./g, '$&$&') : h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function makeCanvas(w, h, readable = false) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.ceil(w));
  c.height = Math.max(1, Math.ceil(h));
  const g = c.getContext('2d', readable ? { willReadFrequently: true } : undefined);
  g.imageSmoothingEnabled = false;
  return { c, g };
}

/** Grigio di un valore di calore 0..1 (per disegnare sul canvas del calore). */
export const heat = (v) => {
  const k = Math.round(clamp(v, 0, 1) * 255);
  return `rgb(${k},${k},${k})`;
};

// ---------- Primitive a pixel (canvas) ----------

export function disc(g, cx, cy, r, color) {
  if (color) g.fillStyle = color;
  const ir = Math.ceil(r);
  for (let dy = -ir; dy <= ir; dy++) {
    const k = r * r - dy * dy;
    if (k < 0) continue;
    const hw = Math.floor(Math.sqrt(k) + 0.25);
    g.fillRect(Math.round(cx) - hw, Math.round(cy) + dy, hw * 2 + 1, 1);
  }
}

export function ring(g, cx, cy, r, color) {
  if (color) g.fillStyle = color;
  const n = Math.max(8, Math.round(r * 6.5));
  let last = '';
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const x = Math.round(cx + Math.cos(a) * r);
    const y = Math.round(cy + Math.sin(a) * r);
    const key = `${x},${y}`;
    if (key !== last) g.fillRect(x, y, 1, 1);
    last = key;
  }
}

export function line(g, x0, y0, x1, y1, color) {
  if (color) g.fillStyle = color;
  x0 = Math.round(x0);
  y0 = Math.round(y0);
  x1 = Math.round(x1);
  y1 = Math.round(y1);
  const dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  for (let n = 0; n < 2000; n++) {
    g.fillRect(x0, y0, 1, 1);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x0 += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y0 += sy;
    }
  }
}

// ---------- Rumore stabile (dipende solo dalle coordinate del mondo) ----------

export function hash2(x, y, s = 0) {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul((s | 0) + 1, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

export function vnoise(x, y, scale, s) {
  const fx = x / scale;
  const fy = y / scale;
  const ix = Math.floor(fx);
  const iy = Math.floor(fy);
  const tx = fx - ix;
  const ty = fy - iy;
  const sx = tx * tx * (3 - 2 * tx);
  const sy = ty * ty * (3 - 2 * ty);
  const a = hash2(ix, iy, s);
  const b = hash2(ix + 1, iy, s);
  const c = hash2(ix, iy + 1, s);
  const d = hash2(ix + 1, iy + 1, s);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

// ---------- Rete stradale ----------

/**
 * Città infinita a griglia irregolare: strade verticali in roadX(k), orizzontali in roadY(k) (spostate a caso
 * di ± jitter × block), alcune larghe (viali). Gli isolati stanno tra due strade consecutive.
 */
export class City {
  constructor(cfg, seed) {
    this.cfg = cfg;
    this.B = cfg.block ?? 140;
    this.jit = cfg.jitter ?? 0.25;
    this.seed = seed;
  }

  roadX(k) {
    return k * this.B + Math.round((hash2(k, 1, this.seed) - 0.5) * this.B * this.jit);
  }

  roadY(k) {
    return k * this.B + Math.round((hash2(k, 2, this.seed) - 0.5) * this.B * this.jit);
  }

  widthX(k) {
    const [a, b] = this.cfg.road || [8, 12];
    return hash2(k, 3, this.seed) < (this.cfg.mainChance ?? 0.35) ? b : a;
  }

  widthY(k) {
    const [a, b] = this.cfg.road || [8, 12];
    return hash2(k, 4, this.seed) < (this.cfg.mainChance ?? 0.35) ? b : a;
  }

  /** Indice k della strada verticale con roadX(k) <= x < roadX(k + 1). */
  colAt(x) {
    let k = Math.floor(x / this.B);
    while (this.roadX(k) > x) k--;
    while (this.roadX(k + 1) <= x) k++;
    return k;
  }

  rowAt(y) {
    let k = Math.floor(y / this.B);
    while (this.roadY(k) > y) k--;
    while (this.roadY(k + 1) <= y) k++;
    return k;
  }

  /** Strada più vicina a (x, y): { axis: 'x' (orizzontale) | 'y' (verticale), k, d }. */
  nearestRoad(x, y) {
    const i = this.colAt(x);
    const j = this.rowAt(y);
    const best = [
      { axis: 'y', k: i, d: Math.abs(x - this.roadX(i)) },
      { axis: 'y', k: i + 1, d: Math.abs(x - this.roadX(i + 1)) },
      { axis: 'x', k: j, d: Math.abs(y - this.roadY(j)) },
      { axis: 'x', k: j + 1, d: Math.abs(y - this.roadY(j + 1)) },
    ];
    best.sort((a, b) => a.d - b.d);
    return best[0];
  }

  /** Rettangolo interno dell'isolato (i, j), marciapiede compreso. */
  block(i, j) {
    const L = this.roadX(i) + Math.ceil(this.widthX(i) / 2);
    const R = this.roadX(i + 1) - Math.ceil(this.widthX(i + 1) / 2);
    const T = this.roadY(j) + Math.ceil(this.widthY(j) / 2);
    const B = this.roadY(j + 1) - Math.ceil(this.widthY(j + 1) / 2);
    return { L, T, R, B };
  }
}

// ---------- Buffer di calore di un pezzo ----------

class Buf {
  constructor(x0, y0, w, h) {
    Object.assign(this, { x0, y0, w, h });
    this.a = new Float32Array(w * h);
  }

  idx(x, y) {
    x = Math.round(x) - this.x0;
    y = Math.round(y) - this.y0;
    return x < 0 || y < 0 || x >= this.w || y >= this.h ? -1 : y * this.w + x;
  }

  set(x, y, v) {
    const i = this.idx(x, y);
    if (i >= 0) this.a[i] = v;
  }

  get(x, y) {
    const i = this.idx(x, y);
    return i >= 0 ? this.a[i] : 0;
  }

  add(x, y, v) {
    const i = this.idx(x, y);
    if (i >= 0) this.a[i] += v;
  }

  mul(x, y, k) {
    const i = this.idx(x, y);
    if (i >= 0) this.a[i] *= k;
  }

  /** Riempie un rettangolo (coordinate del mondo); v = numero o funzione (x, y, valore attuale) -> valore. */
  fill(x, y, w, h, v) {
    const xa = Math.max(Math.round(x), this.x0);
    const ya = Math.max(Math.round(y), this.y0);
    const xb = Math.min(Math.round(x + w), this.x0 + this.w);
    const yb = Math.min(Math.round(y + h), this.y0 + this.h);
    const fn = typeof v === 'function';
    for (let yy = ya; yy < yb; yy++) {
      let i = (yy - this.y0) * this.w + (xa - this.x0);
      for (let xx = xa; xx < xb; xx++, i++) this.a[i] = fn ? v(xx, yy, this.a[i]) : v;
    }
  }

  disc(cx, cy, r, v) {
    const ir = Math.ceil(r);
    const fn = typeof v === 'function';
    for (let dy = -ir; dy <= ir; dy++) {
      for (let dx = -ir; dx <= ir; dx++) {
        const d2 = dx * dx + dy * dy;
        if (d2 > r * r) continue;
        const i = this.idx(cx + dx, cy + dy);
        if (i >= 0) this.a[i] = fn ? v(dx, dy, Math.sqrt(d2), this.a[i]) : v;
      }
    }
  }

  line(x0, y0, x1, y1, v) {
    const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
    for (let s = 0; s <= n; s++) this.set(x0 + ((x1 - x0) * s) / n, y0 + ((y1 - y0) * s) / n, v);
  }

  /** Copia uno sprite termico (Float32Array con NaN = trasparente) ruotato di dir × 90°, centrato in (cx, cy). */
  stamp(spr, cx, cy, dir, k = 1) {
    const { w, h, a } = spr;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const v = a[y * w + x];
        if (Number.isNaN(v)) continue;
        let dx = x - (w - 1) / 2;
        let dy = y - (h - 1) / 2;
        for (let r = 0; r < dir; r++) [dx, dy] = [-dy, dx];
        this.set(cx + dx, cy + dy, v * k);
      }
    }
  }
}

// ---------- Pezzo di città ----------

const CHOICE = (rng, weights) => {
  const keys = Object.keys(weights);
  let tot = 0;
  for (const k of keys) tot += weights[k];
  let r = rng() * tot;
  for (const k of keys) {
    r -= weights[k];
    if (r <= 0) return k;
  }
  return keys[0];
};

/**
 * Disegna il pezzo di mondo [x0, x0 + size) x [y0, y0 + size) come calore. Restituisce { canvas, fires } con i
 * punti in fiamme in coordinate del mondo. Ogni elemento dipende solo dalla sua posizione: i pezzi combaciano.
 */
export function paintChunk(city, x0, y0, size, cfg) {
  const H = cfg.heat || {};
  const seed = city.seed;
  const buf = new Buf(x0, y0, size, size);
  const fires = [];

  // sabbia: ondulazioni grandi, chiazze, granelli
  const g0 = H.ground ?? 0.2;
  for (let y = y0; y < y0 + size; y++) {
    for (let x = x0; x < x0 + size; x++) {
      const n = (vnoise(x, y, 46, seed + 5) - 0.5) * 0.08 + (vnoise(x, y, 11, seed + 6) - 0.5) * 0.04;
      const dune = Math.sin((x * 0.55 + y * 0.32) / 2.6 + vnoise(x, y, 30, seed + 7) * 7) * 0.008;
      buf.a[(y - y0) * size + (x - x0)] = g0 + n + dune + (hash2(x, y, seed + 8) - 0.5) * 0.03;
    }
  }

  // strade (asfalto più caldo della sabbia: ha trattenuto il calore del giorno), cordoli, mezzeria dei viali
  const roadH = H.road ?? 0.34;
  const curbH = H.curb ?? 0.42;
  const ia = city.colAt(x0);
  const ib = city.colAt(x0 + size) + 1;
  const ja = city.rowAt(y0);
  const jb = city.rowAt(y0 + size) + 1;
  const vRoads = [];
  for (let k = ia; k <= ib; k++) vRoads.push({ k, c: city.roadX(k), w: city.widthX(k) });
  const hRoads = [];
  for (let k = ja; k <= jb; k++) hRoads.push({ k, c: city.roadY(k), w: city.widthY(k) });
  const inRoad = (p, r) => p >= r.c - r.w / 2 && p < r.c + r.w / 2;
  for (let y = y0; y < y0 + size; y++) {
    const hr = hRoads.find((r) => inRoad(y, r));
    for (let x = x0; x < x0 + size; x++) {
      const vr = vRoads.find((r) => inRoad(x, r));
      if (!vr && !hr) continue;
      let v = roadH + (vnoise(x, y, 13, seed + 9) - 0.5) * 0.05 + (hash2(x, y, seed + 10) - 0.5) * 0.02;
      // corsie consumate (più lisce e un filo più fredde)
      if (vr && !hr && Math.abs(Math.abs(x - vr.c + 0.5) - vr.w / 4) < 1) v -= 0.015;
      if (hr && !vr && Math.abs(Math.abs(y - hr.c + 0.5) - hr.w / 4) < 1) v -= 0.015;
      if (vr && !hr) {
        if (x === Math.ceil(vr.c - vr.w / 2) || x === Math.ceil(vr.c + vr.w / 2) - 1) v = curbH;
        else if (vr.w > 9 && x === vr.c && (y >> 2) & 1) v = roadH + 0.07;
      }
      if (hr && !vr) {
        if (y === Math.ceil(hr.c - hr.w / 2) || y === Math.ceil(hr.c + hr.w / 2) - 1) v = curbH;
        else if (hr.w > 9 && y === hr.c && (x >> 2) & 1) v = roadH + 0.07;
      }
      buf.a[(y - y0) * size + (x - x0)] = v;
    }
  }
  // buche e crateri sulle strade
  for (const r of [...vRoads.map((r) => ({ ...r, axis: 'y' })), ...hRoads.map((r) => ({ ...r, axis: 'x' }))]) {
    const segA = r.axis === 'y' ? y0 : x0;
    for (let s = Math.floor(segA / 40) - 1; s <= Math.floor((segA + size) / 40) + 1; s++) {
      const h = hash2(r.k * 977 + s, r.axis === 'y' ? 11 : 12, seed);
      if (h > (cfg.city?.potholes ?? 0.25)) continue;
      const along = s * 40 + hash2(s, r.k, seed + 13) * 40;
      const across = r.c + (hash2(s, r.k, seed + 14) - 0.5) * r.w * 0.6;
      const [cx, cy] = r.axis === 'y' ? [across, along] : [along, across];
      crater(buf, cx, cy, 1.5 + h * 8, H, seed);
    }
  }

  // isolati
  for (let i = ia - 1; i <= ib; i++) {
    for (let j = ja - 1; j <= jb; j++) {
      const b = city.block(i, j);
      if (b.R < x0 || b.L > x0 + size || b.B < y0 || b.T > y0 + size) continue;
      paintBlock(buf, b, mulberry32(Math.floor(hash2(i, j, seed + 20) * 4294967296)), cfg, fires, seed);
    }
  }

  // tutto in un canvas grigio
  const { c, g } = makeCanvas(size, size);
  const img = g.createImageData(size, size);
  for (let i = 0; i < size * size; i++) {
    const k = Math.round(clamp(buf.a[i], 0, 1) * 255);
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = k;
    img.data[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return { canvas: c, fires };
}

/** Cratere: fondo freddo, bordo di terra smossa più caldo, schizzi intorno. */
function crater(buf, cx, cy, r, H, seed) {
  buf.disc(cx, cy, r + 1.5, (dx, dy, d, v) => v + 0.03 * (hash2(cx + dx, cy + dy, seed + 30) > 0.5 ? 1 : 0));
  buf.disc(cx, cy, r, (dx, dy, d) => (d > r - 1.2 ? H.craterRim ?? 0.4 : (H.craterFloor ?? 0.14) + (d / r) * 0.06));
  const n = Math.round(r * 3);
  for (let i = 0; i < n; i++) {
    const a = hash2(cx * 7 + i, cy, seed + 31) * Math.PI * 2;
    const d = r + 1 + hash2(cx, cy * 3 + i, seed + 32) * r * 1.2;
    buf.set(cx + Math.cos(a) * d, cy + Math.sin(a) * d, 0.32);
  }
}

/** Albero: chioma fredda (le foglie traspirano), più chiara al centro; palma = foglie a raggiera. */
function tree(buf, cx, cy, r, palm, H, rng) {
  const t = H.tree ?? 0.12;
  if (palm) {
    const n = 7 + Math.floor(rng() * 3);
    const a0 = rng() * 6;
    for (let i = 0; i < n; i++) {
      const a = a0 + (i / n) * Math.PI * 2;
      for (let s = 1; s <= r; s++) {
        const bend = (s / r) ** 2 * 1.2;
        const x = cx + Math.cos(a) * s + Math.cos(a + 1.57) * bend;
        const y = cy + Math.sin(a) * s + Math.sin(a + 1.57) * bend;
        buf.set(x, y, t + 0.02 * (s / r));
        if (s > 1 && s < r - 1) buf.set(x + Math.cos(a + 1.57), y + Math.sin(a + 1.57), t + 0.035);
      }
    }
    buf.set(cx, cy, t + 0.12);
  } else {
    buf.disc(cx, cy, r, (dx, dy, d) => t + (hash2(cx + dx, cy + dy, 41) - 0.5) * 0.04 - (d / r) * 0.02 + (dx + dy < -r * 0.5 ? 0.02 : 0));
  }
}

/** Ombra termica (il terreno all'ombra di giorno è più freddo di notte): verso sud-est. */
function shadow(buf, x, y, w, h, off, k) {
  buf.fill(x + off, y + off, w, h, (xx, yy, v) => v * k);
}

/**
 * Edificio dall'alto: ombra, tetto, parapetto caldo, angolo d'ombra interno, impianti (condizionatori caldi,
 * cisterne fredde, scale), danni (buchi, crolli) e fiamme. Restituisce i punti in fiamme in fires.
 */
function building(buf, x, y, w, h, rng, cfg, fires, opt = {}) {
  const H = cfg.heat || {};
  // tetto: cemento (tiepido), lamiera ondulata (freddissima: riflette il cielo) o caldo (ambienti riscaldati)
  const kind = opt.roof != null ? 'concrete' : CHOICE(rng, cfg.city?.roofs || { concrete: 1 });
  let roof = opt.roof ?? lerp(...(H.roof || [0.28, 0.42]), rng());
  if (kind === 'warm') roof += 0.12;
  const off = opt.storeys ?? 1 + Math.floor(rng() * 3);
  const s = Math.floor(rng() * 1e6);
  if (kind === 'metal') {
    shadow(buf, x, y, w, h, 2, H.shadow ?? 0.62);
    const vert = w < h;
    buf.fill(x, y, w, h, (xx, yy) => (((vert ? xx : yy) - (vert ? x : y)) % 2 ? 0.13 : 0.18) + (hash2(xx, yy, s) - 0.5) * 0.02);
    // lamiere sostituite e ruggine (più calde)
    for (let i = 0; i < 2; i++) {
      const px = x + Math.floor(rng() * (w - 3));
      const py = y + Math.floor(rng() * (h - 3));
      buf.fill(px, py, 2 + Math.floor(rng() * 4), 2 + Math.floor(rng() * 4), (xx, yy, v) => v + 0.07);
    }
    return;
  }
  const par = roof + (H.parapet ?? 0.13);
  shadow(buf, x, y, w, h, off + 1, H.shadow ?? 0.62);
  buf.fill(x, y, w, h, (xx, yy) => roof + (vnoise(xx, yy, 5, s) - 0.5) * 0.04 + (hash2(xx, yy, s) - 0.5) * 0.02);
  // parapetto e angolo in ombra
  buf.fill(x, y, w, 1, par);
  buf.fill(x, y + h - 1, w, 1, par);
  buf.fill(x, y, 1, h, par);
  buf.fill(x + w - 1, y, 1, h, par);
  buf.fill(x + 1, y + 1, w - 2, 1, roof - 0.05);
  buf.fill(x + 1, y + 1, 1, h - 2, roof - 0.05);
  // piano rialzato
  if (w > 16 && h > 16 && rng() < 0.45) {
    const tw = Math.floor(w * lerp(0.35, 0.6, rng()));
    const th = Math.floor(h * lerp(0.35, 0.6, rng()));
    const tx = x + 2 + Math.floor(rng() * (w - tw - 4));
    const ty = y + 2 + Math.floor(rng() * (h - th - 4));
    shadow(buf, tx, ty, tw, th, 2, 0.8);
    buf.fill(tx, ty, tw, th, (xx, yy) => roof + 0.03 + (hash2(xx, yy, s + 1) - 0.5) * 0.02);
    buf.fill(tx, ty, tw, 1, par + 0.03);
    buf.fill(tx, ty + th - 1, tw, 1, par + 0.03);
    buf.fill(tx, ty, 1, th, par + 0.03);
    buf.fill(tx + tw - 1, ty, 1, th, par + 0.03);
  }
  // impianti sul tetto
  const items = rng() < 0.25 ? 0 : Math.floor((w * h) / 220) + (rng() < 0.5 ? 1 : 0);
  for (let i = 0; i < items; i++) {
    const ix = x + 2 + Math.floor(rng() * Math.max(1, w - 6));
    const iy = y + 2 + Math.floor(rng() * Math.max(1, h - 6));
    const kind = rng();
    if (kind < 0.35) {
      // condizionatore: scatola con la ventola calda (a volte spento)
      const on = rng() < 0.6;
      buf.fill(ix + 1, iy + 1, 3, 2, (xx, yy, v) => v * 0.85);
      buf.fill(ix, iy, 3, 2, (H.ac ?? 0.55) - (on ? 0 : 0.12));
      if (on) buf.set(ix + 1 + Math.floor(rng() * 2), iy, (H.ac ?? 0.55) + 0.3);
    } else if (kind < 0.5) {
      // cisterna d'acqua (fredda)
      buf.fill(ix + 1, iy + 1, 3, 3, (xx, yy, v) => v * 0.85);
      buf.fill(ix, iy, 3, 3, H.water ?? 0.14);
      buf.set(ix, iy, roof);
      buf.set(ix + 2, iy + 2, roof);
    } else if (kind < 0.62) {
      // panni stesi: fili tiepidi
      for (let k = 0; k < 3; k++) buf.fill(ix, iy + k * 2, 5 + Math.floor(rng() * 4), 1, (xx, yy, v) => (hash2(xx, yy, s + 9) < 0.7 ? roof + 0.06 : v));
    } else if (kind < 0.8) {
      // pannelli solari
      buf.fill(ix, iy, 4, 3, (xx) => ((xx - ix) % 2 ? 0.16 : 0.2));
    } else {
      // uscita delle scale
      buf.fill(ix + 1, iy + 1, 4, 4, roof * 0.8);
      buf.fill(ix, iy, 4, 4, roof + 0.08);
      buf.fill(ix, iy, 4, 1, par);
    }
  }
  // danni
  const dmg = opt.damage ?? (rng() < (cfg.city?.damaged ?? 0.25) ? rng() : 0);
  if (dmg > 0) {
    const holes = 1 + Math.floor(dmg * 2.5);
    for (let k = 0; k < holes; k++) {
      const r = 1.5 + rng() * Math.min(w, h) * 0.22 * (0.5 + dmg);
      const cx = x + r + rng() * Math.max(1, w - r * 2);
      const cy = y + r + rng() * Math.max(1, h - r * 2);
      const hs = Math.floor(rng() * 1e6);
      // buco nel tetto (si vede il buio dentro), bordo di macerie
      buf.disc(cx, cy, r + 2, (dx, dy, d, v) => (hash2(cx + dx, cy + dy, hs) < 0.55 ? lerp(0.22, 0.48, hash2(dx, dy, hs + 1)) : v));
      buf.disc(cx, cy, r, (dx, dy, d) => (d + hash2(cx + dx, cy + dy, hs + 2) * 1.5 < r ? 0.07 + hash2(dx, dy, hs + 3) * 0.05 : 0.3));
      if (rng() < (cfg.city?.burning ?? 0.3) * (0.5 + dmg)) fires.push({ x: Math.round(cx), y: Math.round(cy), s: 0.6 + rng() * 0.8 });
    }
    if (dmg > 0.6) {
      // un lato crollato: parapetto interrotto e macerie che escono sulla strada
      const side = Math.floor(rng() * 4);
      const hs = Math.floor(rng() * 1e6);
      const [ax, ay, aw, ah] = side === 0 ? [x - 3, y - 3, w + 6, 6] : side === 1 ? [x - 3, y + h - 3, w + 6, 6] : side === 2 ? [x - 3, y - 3, 6, h + 6] : [x + w - 3, y - 3, 6, h + 6];
      buf.fill(ax, ay, aw, ah, (xx, yy, v) => (hash2(xx, yy, hs) < 0.5 ? lerp(0.2, 0.5, hash2(xx, yy, hs + 1)) : v));
    }
  }
}

/** Isolato: marciapiede, poi un tipo a caso fra case, recinto, moschea, rovine, accampamento, spiazzo. */
function paintBlock(buf, b, rng, cfg, fires, seed) {
  const H = cfg.heat || {};
  const sw = cfg.city?.sidewalk ?? 2;
  const side = H.sidewalk ?? 0.29;
  // marciapiede a lastre
  buf.fill(b.L, b.T, b.R - b.L, b.B - b.T, (x, y, v) => {
    const inner = x >= b.L + sw && x < b.R - sw && y >= b.T + sw && y < b.B - sw;
    if (inner) return v;
    return side + ((x + y) % 5 === 0 ? -0.02 : 0) + (hash2(x, y, seed + 50) - 0.5) * 0.02;
  });
  const L = b.L + sw + 1;
  const T = b.T + sw + 1;
  const R = b.R - sw - 1;
  const B = b.B - sw - 1;
  // alberi lungo il marciapiede
  if (rng() < 0.5) {
    const palm = rng() < 0.6;
    const step = 14 + Math.floor(rng() * 10);
    for (let x = L + 4; x < R - 4; x += step) {
      if (rng() < 0.7) tree(buf, x, b.T + 1, palm ? 4 : 3, palm, H, rng);
      if (rng() < 0.7) tree(buf, x + 5, b.B - 2, palm ? 4 : 3, palm, H, rng);
    }
  }
  const type = CHOICE(rng, cfg.blocks || { houses: 1 });
  if (type === 'houses') houses(buf, L, T, R, B, rng, cfg, fires);
  else if (type === 'compound') compound(buf, L, T, R, B, rng, cfg, fires);
  else if (type === 'mosque') mosque(buf, L, T, R, B, rng, cfg, fires);
  else if (type === 'ruins') ruins(buf, L, T, R, B, rng, cfg, fires);
  else if (type === 'camp') camp(buf, L, T, R, B, rng, cfg, fires);
  else lot(buf, L, T, R, B, rng, cfg, fires);
}

function wall(buf, x0, y0, x1, y1, v, rng, gaps = 1) {
  const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
  const cuts = Array.from({ length: gaps }, () => [Math.floor(rng() * n), 3 + Math.floor(rng() * 4)]);
  for (let s = 0; s <= n; s++) {
    if (cuts.some(([c, l]) => s >= c && s < c + l)) continue;
    const x = Math.round(x0 + ((x1 - x0) * s) / n);
    const y = Math.round(y0 + ((y1 - y0) * s) / n);
    buf.set(x + 1, y + 1, buf.get(x + 1, y + 1) * 0.8);
    buf.set(x, y, v);
  }
}

function houses(buf, L, T, R, B, rng, cfg, fires) {
  const H = cfg.heat || {};
  const lots = [];
  const split = (x, y, w, h, d) => {
    if ((w < 40 && h < 40) || d > 4 || (d > 1 && rng() < 0.15)) {
      lots.push([x, y, w, h]);
      return;
    }
    const k = lerp(0.35, 0.65, rng());
    if (w > h) {
      const a = Math.floor(w * k);
      split(x, y, a, h, d + 1);
      split(x + a, y, w - a, h, d + 1);
    } else {
      const a = Math.floor(h * k);
      split(x, y, w, a, d + 1);
      split(x, y + a, w, h - a, d + 1);
    }
  };
  split(L, T, R - L, B - T, 0);
  for (const [x, y, w, h] of lots) {
    const walled = rng() < 0.45;
    if (walled) {
      wall(buf, x, y, x + w - 1, y, H.wall ?? 0.44, rng);
      wall(buf, x, y, x, y + h - 1, H.wall ?? 0.44, rng, 0);
    }
    if (rng() < 0.82 && w > 10 && h > 10) {
      const ins = 2 + Math.floor(rng() * 3);
      const bw = w - ins * 2 - Math.floor(rng() * w * 0.25);
      const bh = h - ins * 2 - Math.floor(rng() * h * 0.25);
      if (bw < 7 || bh < 7) continue;
      const bx = x + ins + Math.floor(rng() * (w - ins * 2 - bw + 1));
      const by = y + ins + Math.floor(rng() * (h - ins * 2 - bh + 1));
      building(buf, bx, by, bw, bh, rng, cfg, fires);
      // cortile interno
      if (bw > 22 && bh > 22 && rng() < 0.4) {
        const cw = Math.floor(bw * 0.4);
        const ch = Math.floor(bh * 0.4);
        const cx = bx + Math.floor((bw - cw) / 2);
        const cy = by + Math.floor((bh - ch) / 2);
        buf.fill(cx, cy, cw, ch, (xx, yy) => (H.ground ?? 0.2) + 0.04 + (hash2(xx, yy, 77) - 0.5) * 0.03);
        buf.fill(cx, cy, cw, 2, (xx, yy, v) => v * 0.75);
        buf.fill(cx, cy, 2, ch, (xx, yy, v) => v * 0.75);
        if (rng() < 0.7) tree(buf, cx + cw / 2, cy + ch / 2, Math.min(cw, ch) / 3, rng() < 0.5, H, rng);
      }
    } else {
      yard(buf, x + 2, y + 2, w - 4, h - 4, rng, cfg, fires);
    }
  }
}

function yard(buf, x, y, w, h, rng, cfg, fires) {
  const H = cfg.heat || {};
  const n = 1 + Math.floor(rng() * 3);
  for (let i = 0; i < n; i++) {
    const px = x + rng() * w;
    const py = y + rng() * h;
    const k = rng();
    if (k < 0.45) tree(buf, px, py, 2.5 + rng() * 3, rng() < 0.5, H, rng);
    else if (k < 0.7) parkedCar(buf, px, py, rng, cfg, fires);
    else if (k < 0.85) crater(buf, px, py, 2 + rng() * 3, H, Math.floor(rng() * 1000));
    else {
      // mucchio di macerie
      const s = Math.floor(rng() * 1e6);
      buf.disc(px, py, 2 + rng() * 3, (dx, dy, d, v) => (hash2(dx, dy, s) < 0.6 ? lerp(0.22, 0.46, hash2(dx, dy, s + 1)) : v));
    }
  }
}

/** Auto parcheggiata: fredda, vetri ancora più freddi; a volte col motore caldo o carcassa che brucia. */
function parkedCar(buf, x, y, rng, cfg, fires) {
  const dir = Math.floor(rng() * 4);
  const burnt = rng() < (cfg.city?.carWrecks ?? 0.2);
  const spr = carSprite(burnt ? 'wreck' : rng() < 0.25 ? 'warm' : 'cold');
  buf.stamp(spr, x, y, dir);
  if (burnt && rng() < 0.4) fires.push({ x: Math.round(x), y: Math.round(y), s: 0.5 + rng() * 0.4 });
}

const CAR_CACHE = new Map();
function carSprite(kind) {
  if (CAR_CACHE.has(kind)) return CAR_CACHE.get(kind);
  const w = 8;
  const h = 4;
  const a = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let v = kind === 'wreck' ? 0.5 + hash2(x, y, 3) * 0.2 : 0.3;
      if (kind !== 'wreck') {
        if (x === 2 || x === 5) v = 0.2; // parabrezza e lunotto
        if (x >= 6 && kind === 'warm') v = 0.72; // cofano col motore caldo
      }
      if ((x === 0 || x === w - 1) && (y === 0 || y === h - 1)) v = NaN;
      a[y * w + x] = v;
    }
  }
  const spr = { w, h, a };
  CAR_CACHE.set(kind, spr);
  return spr;
}

function compound(buf, L, T, R, B, rng, cfg, fires) {
  const H = cfg.heat || {};
  const wv = (H.wall ?? 0.44) + 0.04;
  // muro di cinta con torrette agli angoli e un cancello
  wall(buf, L, T, R - 1, T, wv, rng);
  wall(buf, L, B - 1, R - 1, B - 1, wv, rng, 0);
  wall(buf, L, T, L, B - 1, wv, rng, 0);
  wall(buf, R - 1, T, R - 1, B - 1, wv, rng, 0);
  for (const [cx, cy] of [[L, T], [R - 3, T], [L, B - 3], [R - 3, B - 3]]) {
    shadow(buf, cx, cy, 3, 3, 2, 0.7);
    buf.fill(cx, cy, 3, 3, wv + 0.06);
  }
  const w = R - L;
  const h = B - T;
  const bw = Math.floor(w * lerp(0.4, 0.6, rng()));
  const bh = Math.floor(h * lerp(0.4, 0.6, rng()));
  const bx = L + 5 + Math.floor(rng() * (w - bw - 10));
  const by = T + 5 + Math.floor(rng() * (h - bh - 10));
  building(buf, bx, by, bw, bh, rng, cfg, fires, { storeys: 3 });
  // cortile: palme e mezzi parcheggiati
  for (let i = 0; i < 4; i++) {
    const px = L + 5 + rng() * (w - 10);
    const py = T + 5 + rng() * (h - 10);
    if (px > bx - 4 && px < bx + bw + 6 && py > by - 4 && py < by + bh + 6) continue;
    if (rng() < 0.6) tree(buf, px, py, 4, true, H, rng);
    else buf.stamp(vehicleHeat(pick(['truck', 'pickup'])), px, py, Math.floor(rng() * 4), 0.7);
  }
}

function mosque(buf, L, T, R, B, rng, cfg, fires) {
  const H = cfg.heat || {};
  const w = R - L;
  const h = B - T;
  // cortile lastricato
  buf.fill(L + 2, T + 2, w - 4, h - 4, (x, y) => 0.25 + ((x >> 2) + (y >> 2)) % 2 * 0.015 + (hash2(x, y, 90) - 0.5) * 0.015);
  wall(buf, L + 1, T + 1, R - 2, T + 1, (H.wall ?? 0.44) + 0.03, rng);
  wall(buf, L + 1, B - 2, R - 2, B - 2, (H.wall ?? 0.44) + 0.03, rng);
  const hw = Math.floor(w * 0.55);
  const hh = Math.floor(h * 0.5);
  const hx = L + Math.floor((w - hw) / 2);
  const hy = T + Math.floor((h - hh) / 2);
  building(buf, hx, hy, hw, hh, rng, cfg, fires, { storeys: 3, roof: 0.36, damage: rng() < 0.3 ? 0.4 : 0 });
  // cupola: sfumata, più calda dal lato del tramonto (in alto a sinistra)
  const r = Math.min(hw, hh) * 0.36;
  const cx = hx + hw / 2;
  const cy = hy + hh / 2;
  buf.disc(cx + 2, cy + 2, r, (dx, dy, d, v) => v * 0.8);
  buf.disc(cx, cy, r, (dx, dy, d) => 0.33 + (-(dx + dy) / (r * 2.8)) * 0.16 + (d > r - 1 ? 0.06 : 0) + (Math.round((Math.atan2(dy, dx) * 8) / Math.PI) % 2 ? 0.01 : 0));
  buf.set(cx, cy, 0.5);
  for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    if (rng() < 0.5) continue;
    buf.disc(cx + sx * hw * 0.32, cy + sy * hh * 0.3, r * 0.35, (dx, dy) => 0.35 - (dx + dy) * 0.02);
  }
  // minareto: torre tonda con la lunga ombra
  const mx = L + 4 + (rng() < 0.5 ? 0 : w - 9);
  const my = T + 4 + (rng() < 0.5 ? 0 : h - 9);
  for (let k = 1; k < 9; k++) buf.disc(mx + k, my + k, 1.8, (dx, dy, d, v) => v * 0.78);
  buf.disc(mx, my, 2.4, (dx, dy, d) => (d > 1.6 ? 0.5 : 0.4 - (dx + dy) * 0.03));
  buf.set(mx, my, 0.6);
}

function ruins(buf, L, T, R, B, rng, cfg, fires) {
  const H = cfg.heat || {};
  const s = Math.floor(rng() * 1e6);
  // macerie sparse ovunque
  buf.fill(L, T, R - L, B - T, (x, y, v) => (vnoise(x, y, 7, s) > 0.62 && hash2(x, y, s) < 0.6 ? lerp(0.2, 0.47, hash2(x, y, s + 1)) : v));
  const n = 2 + Math.floor(rng() * 3);
  for (let i = 0; i < n; i++) {
    const bw = 12 + Math.floor(rng() * (R - L) * 0.35);
    const bh = 12 + Math.floor(rng() * (B - T) * 0.35);
    const bx = L + Math.floor(rng() * Math.max(1, R - L - bw));
    const by = T + Math.floor(rng() * Math.max(1, B - T - bh));
    if (rng() < 0.5) building(buf, bx, by, bw, bh, rng, cfg, fires, { damage: 0.6 + rng() * 0.4 });
    else {
      // solo muri perimetrali rimasti in piedi
      const wv = (H.wall ?? 0.44) + 0.02;
      wall(buf, bx, by, bx + bw, by, wv, rng, 2);
      wall(buf, bx, by, bx, by + bh, wv, rng, 2);
      wall(buf, bx + bw, by, bx + bw, by + bh, wv, rng, 1);
      wall(buf, bx, by + bh, bx + bw, by + bh, wv, rng, 2);
    }
  }
  for (let i = 0; i < 3; i++) crater(buf, L + rng() * (R - L), T + rng() * (B - T), 2 + rng() * 6, H, s + i);
  if (rng() < 0.6) fires.push({ x: Math.round(L + rng() * (R - L)), y: Math.round(T + rng() * (B - T)), s: 0.8 + rng() * 0.7 });
}

function camp(buf, L, T, R, B, rng, cfg, fires) {
  const H = cfg.heat || {};
  // terra battuta, cerchio di sacchi di sabbia
  const s = Math.floor(rng() * 1e6);
  buf.fill(L, T, R - L, B - T, (x, y, v) => v + 0.02 + (vnoise(x, y, 4, s) - 0.5) * 0.03);
  const bag = H.sandbag ?? 0.44;
  for (let x = L; x < R; x++) {
    for (const y of [T, B - 2]) {
      buf.set(x, y, (x % 3) === 0 ? bag - 0.08 : bag);
      buf.set(x, y + 1, (x % 3) === 1 ? bag - 0.08 : bag - 0.03);
    }
  }
  for (let y = T; y < B; y++) {
    for (const x of [L, R - 2]) {
      if (y > (T + B) / 2 - 4 && y < (T + B) / 2 + 4 && x === L) continue; // varco
      buf.set(x, y, (y % 3) === 0 ? bag - 0.08 : bag);
      buf.set(x + 1, y, (y % 3) === 1 ? bag - 0.08 : bag - 0.03);
    }
  }
  // tende in fila: calde (dentro dorme qualcuno), col colmo
  const tw = 9;
  const th = 6;
  const tent = H.tent ?? 0.5;
  for (let y = T + 5; y + th < B - 12; y += th + 4) {
    for (let x = L + 5; x + tw < (L + R) / 2 + 10; x += tw + 3) {
      if (rng() < 0.2) continue;
      shadow(buf, x, y, tw, th, 1, 0.7);
      const warm = tent + (rng() - 0.5) * 0.12;
      buf.fill(x, y, tw, th, (xx, yy) => warm - Math.abs(yy - y - th / 2) * 0.012);
      buf.fill(x, y + Math.floor(th / 2), tw, 1, warm + 0.06);
    }
  }
  // mezzi parcheggiati, generatore caldissimo, fuoco del bivacco
  const vx = (L + R) / 2 + 14;
  for (let y = T + 10; y < B - 10; y += 14) {
    if (rng() < 0.3) continue;
    buf.stamp(vehicleHeat(pick(['tank', 'apc', 'truck'])), vx + rng() * 6, y, rng() < 0.8 ? 0 : 2, 0.55 + rng() * 0.25);
  }
  buf.fill(R - 9, B - 9, 3, 3, 0.9);
  buf.set(R - 8, B - 8, 1);
  buf.disc(L + 10, B - 9, 2, 0.85);
  buf.set(L + 10, B - 9, 1);
}

function lot(buf, L, T, R, B, rng, cfg, fires) {
  const H = cfg.heat || {};
  const s = Math.floor(rng() * 1e6);
  // terreno incolto con tracce di ruote
  buf.fill(L, T, R - L, B - T, (x, y, v) => v - 0.02 + (vnoise(x, y, 17, s) - 0.5) * 0.05);
  const ty = T + (B - T) * lerp(0.3, 0.7, rng());
  for (let x = L; x < R; x++) {
    const yy = ty + Math.sin(x / 13 + s) * 4;
    buf.set(x, yy, buf.get(x, yy) + 0.04);
    buf.set(x, yy + 3, buf.get(x, yy + 3) + 0.04);
  }
  const n = 4 + Math.floor(rng() * 6);
  for (let i = 0; i < n; i++) tree(buf, L + rng() * (R - L), T + rng() * (B - T), 3 + rng() * 2.5, rng() < 0.7, H, rng);
  for (let i = 0; i < 2 + rng() * 3; i++) crater(buf, L + rng() * (R - L), T + rng() * (B - T), 2 + rng() * 5, H, s + i);
  if (rng() < 0.6) parkedCar(buf, L + rng() * (R - L), T + rng() * (B - T), rng, { ...cfg, city: { ...cfg.city, carWrecks: 0.8 } }, fires);
}

// ---------- Sprite termici dei mezzi (rivolti a destra, +x = avanti) ----------

const VEH_CACHE = new Map();

/**
 * Mappa di calore di un mezzo: { w, h, a (NaN = trasparente), engine: [x, y] (scarico), turret: [x, y] o null }.
 * phase = passo dei cingoli (animazione).
 */
export function vehicleHeat(type, phase = 0) {
  const key = `${type}:${phase}`;
  if (VEH_CACHE.has(key)) return VEH_CACHE.get(key);
  let w;
  let h;
  let engine;
  let turret = null;
  let px;
  if (type === 'tank') {
    w = 17;
    h = 9;
    engine = [0, 4];
    turret = [9, 4];
    px = (x, y) => {
      if (y <= 1 || y >= h - 2) return ((x + phase) % 3 === 0 ? 0.5 : 0.62) + (y === 0 || y === h - 1 ? -0.04 : 0); // cingoli caldi
      if (x <= 4) return (x % 2 ? 0.86 : 0.95); // vano motore con griglia
      if (x === w - 1) return 0.46;
      return 0.4 + (y === 2 ? 0.04 : 0);
    };
  } else if (type === 'apc') {
    w = 14;
    h = 7;
    engine = [0, 3];
    turret = [8, 3];
    px = (x, y) => {
      if ((x === 0 || x === w - 1) && (y === 0 || y === h - 1)) return NaN;
      if ((y === 0 || y === h - 1) && [2, 5, 9, 12].includes(x)) return 0.66; // ruote
      if (x <= 3) return x % 2 ? 0.8 : 0.9;
      if (x >= w - 2) return 0.38; // muso inclinato
      return 0.43 + (y === 1 ? 0.04 : 0);
    };
  } else if (type === 'pickup') {
    w = 10;
    h = 5;
    engine = [w - 1, 2];
    px = (x, y) => {
      if ((x === 0 || x === w - 1) && (y === 0 || y === h - 1)) return NaN;
      if (x <= 4) return y === 0 || y === h - 1 || x === 0 ? 0.38 : x === 2 && y === 2 ? 0.24 : 0.3; // cassone (con mitragliatrice)
      if (x === 5) return 0.3;
      if (x === 6) return 0.22; // lunotto
      if (x === 7) return 0.42;
      if (x === 8) return 0.24; // parabrezza
      return 0.78; // cofano caldo
    };
  } else {
    // camion: telone sul cassone, cabina col motore davanti
    w = 15;
    h = 6;
    engine = [w - 2, 0];
    px = (x, y) => {
      if (x <= 9) {
        if ((x === 0 || x === 9) && (y === 0 || y === h - 1)) return NaN;
        return x % 2 === 0 ? 0.4 : 0.35;
      }
      if (x === 10) return NaN;
      if ((x === 11 || x === w - 1) && (y === 0 || y === h - 1)) return NaN;
      if (x === 13) return 0.24;
      if (x === w - 1) return 0.82;
      return 0.45;
    };
  }
  const a = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) a[y * w + x] = px(x, y);
  const spr = { w, h, a, engine, turret };
  VEH_CACHE.set(key, spr);
  return spr;
}

/** Canvas grigio di una mappa di calore (k = moltiplicatore). */
export function heatCanvas(spr, k = 1) {
  const { c, g } = makeCanvas(spr.w, spr.h);
  const img = g.createImageData(spr.w, spr.h);
  for (let i = 0; i < spr.w * spr.h; i++) {
    const v = spr.a[i];
    if (Number.isNaN(v)) continue;
    const q = Math.round(clamp(v * k, 0, 1) * 255);
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = q;
    img.data[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return c;
}

/** Elicottero d'attacco dall'alto (rivolto a destra): coda, fusoliera, abitacolo in tandem, turbine roventi, alette
 * con i lanciarazzi, sensore sul muso. */
export function heliHeat() {
  const w = 40;
  const h = 19;
  const a = new Float32Array(w * h).fill(NaN);
  const set = (x, y, v) => {
    if (x >= 0 && y >= 0 && x < w && y < h) a[y * w + x] = v;
  };
  const cy = 9;
  // trave di coda, impennaggio orizzontale, rotore di coda (scatola calda)
  for (let x = 2; x < 16; x++) {
    set(x, cy, 0.44);
    if (x > 8) set(x, cy + 1, 0.4);
  }
  for (let y = cy - 4; y <= cy + 4; y++) set(5, y, 0.42);
  set(4, cy - 4, 0.42);
  set(4, cy + 4, 0.42);
  set(2, cy + 1, 0.62);
  set(3, cy + 1, 0.55);
  // fusoliera
  const half = (x) => (x < 18 ? 1 : x < 31 ? 2 : x < 36 ? 1 : 0);
  for (let x = 14; x < 38; x++) {
    const hw = half(x);
    for (let y = -hw; y <= hw + (x < 36 ? 1 : 0); y++) set(x, cy + y, 0.46 + (y === 0 ? 0.04 : 0) - (Math.abs(y) === hw + 1 ? 0.04 : 0));
  }
  // abitacolo in tandem: vetri freddi con la cornice
  for (const x of [29, 30, 32, 33, 34]) {
    set(x, cy, 0.18);
    set(x, cy + 1, 0.2);
  }
  set(31, cy, 0.5);
  set(31, cy + 1, 0.5);
  set(38, cy, 0.62); // sensore sul muso
  set(38, cy + 1, 0.55);
  // turbine ai lati: carenatura tiepida, ugelli roventi verso la coda
  for (let x = 18; x < 26; x++) {
    for (const y of [cy - 3, cy - 4, cy + 4, cy + 5]) set(x, y, x < 20 ? 1 : x < 22 ? 0.85 : 0.6);
  }
  // alette con i lanciarazzi alle estremità
  for (let y = 0; y < h; y++) {
    if (y >= cy - 2 && y <= cy + 3) continue;
    set(26, y, 0.4);
    set(27, y, 0.38);
  }
  for (const y of [0, 1, h - 2, h - 1]) for (let x = 24; x < 30; x++) set(x, y, x === 29 ? 0.3 : 0.34);
  return { w, h, a, rotor: [26, cy], tail: [2, cy + 2] };
}

// ---------- Carattere a pixel 3x5 dell'HUD ----------

// ogni carattere: 5 righe da 3 pixel ("#" = acceso)
const GLYPHS = {
  A: '.#. #.# ### #.# #.#', B: '##. #.# ##. #.# ##.', C: '.## #.. #.. #.. .##', D: '##. #.# #.# #.# ##.',
  E: '### #.. ##. #.. ###', F: '### #.. ##. #.. #..', G: '.## #.. #.# #.# .##', H: '#.# #.# ### #.# #.#',
  I: '### .#. .#. .#. ###', J: '..# ..# ..# #.# .#.', K: '#.# #.# ##. #.# #.#', L: '#.. #.. #.. #.. ###',
  M: '#.# ### ### #.# #.#', N: '##. #.# #.# #.# #.#', O: '.#. #.# #.# #.# .#.', P: '##. #.# ##. #.. #..',
  Q: '.#. #.# #.# ##. .##', R: '##. #.# ##. #.# #.#', S: '.## #.. .#. ..# ##.', T: '### .#. .#. .#. .#.',
  U: '#.# #.# #.# #.# ###', V: '#.# #.# #.# #.# .#.', W: '#.# #.# ### ### #.#', X: '#.# #.# .#. #.# #.#',
  Y: '#.# #.# .#. .#. .#.', Z: '### ..# .#. #.. ###',
  0: '### #.# #.# #.# ###', 1: '.#. ##. .#. .#. ###', 2: '##. ..# .#. #.. ###', 3: '##. ..# .#. ..# ##.',
  4: '#.# #.# ### ..# ..#', 5: '### #.. ##. ..# ##.', 6: '.## #.. ### #.# ###', 7: '### ..# .#. .#. .#.',
  8: '### #.# ### #.# ###', 9: '### #.# ### ..# ##.',
  ' ': '... ... ... ... ...', '.': '... ... ... ... .#.', ':': '... .#. ... .#. ...', '-': '... ... ### ... ...',
  '/': '..# ..# .#. #.. #..', '+': '... .#. ### .#. ...', '%': '#.# ..# .#. #.. #.#', '°': '##. ##. ... ... ...',
  "'": '.#. .#. ... ... ...', '(': '.#. #.. #.. #.. .#.', ')': '.#. ..# ..# ..# .#.', '>': '#.. .#. ..# .#. #..',
  '<': '..# .#. #.. .#. ..#', '#': '#.# ### #.# ### #.#',
};
const FONT = {};
for (const [ch, s] of Object.entries(GLYPHS)) FONT[ch] = s.replace(/ /g, '');

/** Testo in maiuscolo col carattere 3x5 (accenti tolti); restituisce la larghezza in pixel. */
export function drawText(g, x, y, text, color) {
  const s = String(text).normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
  g.fillStyle = color;
  let cx = Math.round(x);
  for (const ch of s) {
    const gl = FONT[ch] || FONT[' '];
    for (let i = 0; i < 15; i++) if (gl[i] === '#') g.fillRect(cx + (i % 3), Math.round(y) + Math.floor(i / 3), 1, 1);
    cx += 4;
  }
  return s.length * 4 - 1;
}

export const textWidth = (text) => String(text).length * 4 - 1;
