// Dettagli a terra disegnati nella mappa (tileset.scatter in assets.json): macchie d'olio, crepe, segnaletica,
// tombini, griglie, cavi, tracce di pneumatici, impronte, rifiuti, ciuffi d'erba, sassolini, fiori, canne.
// Cotti nel canvas della mappa da TileMap._renderRegion (dopo la fusione dei terreni): nessun costo per
// fotogramma. Tutto stabile per cella (cellRandom), quindi uguale a ogni partita e su ogni dispositivo.
//
// Regola = { paint, on, near, far, edge, chance, salt, colors, alpha, ...parametri del disegno }:
// - on: nomi di tile o "terrain:<t>" su cui può comparire;
// - near / far: deve / non deve avere tra le 8 celle vicine un tile della lista (stessa sintassi);
// - edge: true = solo celle con un vicino (4 lati) fuori da "on" (es. ciuffi lungo il bordo della strada);
// - chance: probabilità per cella (per "tracks" e "marking": probabilità per riga/colonna di strada).

import { cellRandom } from './tilemap.js';

/** Filtro di tile da una lista di nomi e "terrain:<t>" (null se la lista manca). */
export function matcher(list) {
  if (!list) return null;
  const names = new Set();
  const terrains = new Set();
  for (const s of [].concat(list)) {
    if (String(s).startsWith('terrain:')) terrains.add(s.slice(8));
    else names.add(s);
  }
  return (t) => !!t && (names.has(t.name) || (!!t.terrain && terrains.has(t.terrain)));
}

/** Regole del tileset compilate una volta (matcher dei nomi). */
function compile(tileset) {
  if (tileset._scatter) return tileset._scatter;
  tileset._scatter = (tileset.scatter || []).map((r, i) => ({
    ...r,
    salt: r.salt ?? 900 + i * 37,
    isOn: matcher(r.on) || (() => true),
    isNear: matcher(r.near),
    isFar: matcher(r.far),
  }));
  return tileset._scatter;
}

const N8 = [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]];
const N4 = [[0, -1], [1, 0], [0, 1], [-1, 0]];

/**
 * Disegna i dettagli delle celle della regione r = { x0, y0, x1, y1 }. Lavora sui pixel della regione con la
 * trasparenza calcolata a mano (interi): il risultato non dipende da come il browser accelera il canvas, quindi
 * la mappa disegnata a pezzi è identica a quella disegnata intera.
 */
export function paintScatter(g, map, r) {
  const rules = compile(map.tileset);
  if (!rules.length) return;
  const s = map.size;
  const ox = r.x0 * s;
  const oy = r.y0 * s;
  const W = (r.x1 - r.x0 + 1) * s;
  const H = (r.y1 - r.y0 + 1) * s;
  const img = g.getImageData(ox, oy, W, H);
  target = { data: img.data, ox, oy, W, H, alpha: 1 };
  // anche le celle appena fuori: i loro dettagli possono sbordare nella regione (che il chiamante ritaglia),
  // così disegnare la mappa a pezzi dà lo stesso risultato che disegnarla intera
  for (let ty = Math.max(0, r.y0 - 1); ty <= Math.min(map.rows - 1, r.y1 + 1); ty++) {
    for (let tx = Math.max(0, r.x0 - 1); tx <= Math.min(map.cols - 1, r.x1 + 1); tx++) {
      const t = map.tileAt(tx, ty);
      if (!t || t.solid) continue;
      for (const rule of rules) {
        if (!rule.isOn(t)) continue;
        if (rule.isNear && !N8.some(([dx, dy]) => rule.isNear(map.tileAt(tx + dx, ty + dy)))) continue;
        if (rule.isFar && N8.some(([dx, dy]) => rule.isFar(map.tileAt(tx + dx, ty + dy)))) continue;
        if (rule.edge && !N4.some(([dx, dy]) => !rule.isOn(map.tileAt(tx + dx, ty + dy)))) continue;
        const paint = PAINTS[rule.paint];
        if (!paint) continue;
        const rnd = (k) => cellRandom(tx, ty, rule.salt + k);
        // tracce e segnaletica decidono da sole (righe/colonne continue), gli altri a caso per cella
        if (!paint.lane && rnd(0) >= (rule.chance ?? 0.05)) continue;
        target.alpha = rule.alpha ?? 1;
        paint(g, tx * s, ty * s, s, rule, rnd, { map, tx, ty, t });
      }
    }
  }
  g.putImageData(img, ox, oy);
  target = null;
}

// pixel della regione in disegno (paintScatter): { data, ox, oy, W, H, alpha }
let target = null;
const rgbaCache = new Map();

/** "#rgb", "#rrggbb" o "#rrggbbaa" -> [r, g, b, a 0..1]. */
function rgba(c) {
  let v = rgbaCache.get(c);
  if (v) return v;
  let h = String(c).replace('#', '');
  if (h.length === 3) h = [...h].map((ch) => ch + ch).join('');
  const n = parseInt(h.slice(0, 6), 16);
  v = [(n >> 16) & 255, (n >> 8) & 255, n & 255, h.length >= 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1];
  rgbaCache.set(c, v);
  return v;
}

/** Rettangolo di pixel fuso sopra la regione (fuori regione: niente), trasparenza = regola × colore. */
function px(g, x, y, c, w = 1, h = 1) {
  const T = target;
  const [cr, cg, cb, ca] = rgba(c);
  const a = Math.round(T.alpha * ca * 256);
  if (a <= 0) return;
  const x0 = Math.round(x) - T.ox;
  const y0 = Math.round(y) - T.oy;
  for (let yy = Math.max(0, y0); yy < Math.min(T.H, y0 + h); yy++) {
    for (let xx = Math.max(0, x0); xx < Math.min(T.W, x0 + w); xx++) {
      const i = (yy * T.W + xx) * 4;
      const d = T.data;
      d[i] = (d[i] * (256 - a) + cr * a) >> 8;
      d[i + 1] = (d[i + 1] * (256 - a) + cg * a) >> 8;
      d[i + 2] = (d[i + 2] * (256 - a) + cb * a) >> 8;
      d[i + 3] = 255;
    }
  }
}

const pick = (cols, v) => cols[Math.floor(v * cols.length) % cols.length];

const PAINTS = {
  /** Macchia (olio, bagnato, terra smossa): dischi sovrapposti, riflesso opzionale. */
  stain(g, ox, oy, s, p, rnd) {
    const cols = p.colors || ['#14161c'];
    const [a, b] = p.size || [3, 6];
    const cx = ox + 3 + rnd(1) * (s - 6);
    const cy = oy + 3 + rnd(2) * (s - 6);
    const n = 2 + Math.floor(rnd(3) * 3);
    for (let i = 0; i < n; i++) {
      const rr = a + rnd(10 + i) * (b - a);
      const x0 = cx + (rnd(20 + i) - 0.5) * rr;
      const y0 = cy + (rnd(30 + i) - 0.5) * rr * 0.7;
      const c = pick(cols, rnd(40 + i));
      for (let y = Math.floor(-rr / 2); y <= rr / 2; y++) {
        const hw = Math.floor(Math.sqrt(Math.max(0, (rr / 2) ** 2 - y * y)));
        if (hw > 0) px(g, x0 - hw, y0 + y, c, hw * 2, 1);
      }
    }
    if (p.sheen) {
      px(g, cx - 1, cy - 1, p.sheen, 2, 1);
      if (rnd(5) < 0.5) px(g, cx + 1, cy + 1, p.sheen);
    }
  },

  /** Crepa: linea spezzata che devia a ogni passo, con una diramazione. */
  crack(g, ox, oy, s, p, rnd) {
    const c = (p.colors || ['#1a1d24'])[0];
    let x = ox + 2 + rnd(1) * (s - 4);
    let y = oy + 2 + rnd(2) * (s - 4);
    const dir = rnd(3) * Math.PI * 2;
    const len = 5 + Math.floor(rnd(4) * 8);
    for (let k = 0; k < len; k++) {
      px(g, x, y, c);
      const j = rnd(50 + k) - 0.5;
      x += Math.cos(dir + j * 1.6);
      y += Math.sin(dir + j * 1.6);
      if (k === 3 && p.branch !== false) {
        let bx = x;
        let by = y;
        for (let m = 0; m < 3; m++) {
          bx += Math.cos(dir + 1.2);
          by += Math.sin(dir + 1.2);
          px(g, bx, by, c);
        }
      }
      if (x < ox || y < oy || x >= ox + s || y >= oy + s) break;
    }
  },

  /** Tombino rotondo (anello scuro, coperchio con fessure) o griglia di scolo (sbarre). */
  manhole(g, ox, oy, s, p, rnd) {
    const [ring, lid, slot] = p.colors || ['#15181e', '#3a3f4a', '#22262e'];
    const cx = ox + Math.floor(s / 2);
    const cy = oy + Math.floor(s / 2);
    const R = p.radius ?? 5;
    for (let y = -R; y <= R; y++) {
      for (let x = -R; x <= R; x++) {
        const d = Math.hypot(x + 0.5, y + 0.5);
        if (d <= R) px(g, cx + x, cy + y, d > R - 1.2 ? ring : lid);
      }
    }
    for (let k = -2; k <= 2; k += 2) px(g, cx - 2, cy + k, slot, 5, 1);
    px(g, cx - 2, cy - 3, p.light || '#4c5260', 2, 1);
  },
  grate(g, ox, oy, s, p, rnd) {
    const [frame, bar, hole] = p.colors || ['#15181e', '#4a505c', '#0a0b0e'];
    const w = 8;
    const h = 6;
    const x0 = ox + Math.floor((s - w) / 2);
    const y0 = oy + Math.floor((s - h) / 2);
    px(g, x0, y0, frame, w, h);
    px(g, x0 + 1, y0 + 1, hole, w - 2, h - 2);
    for (let x = x0 + 1; x < x0 + w - 1; x += 2) px(g, x, y0 + 1, bar, 1, h - 2);
  },

  /** Cavo: curva morbida da un lato all'altro della cella. */
  cable(g, ox, oy, s, p, rnd) {
    const c = (p.colors || ['#111216'])[0];
    const vert = rnd(1) < 0.5;
    const a = 2 + rnd(2) * (s - 4);
    const amp = 1 + rnd(3) * 3;
    const ph = rnd(4) * 6;
    for (let k = 0; k < s; k++) {
      const off = a + Math.sin(k / 3 + ph) * amp;
      if (vert) px(g, ox + off, oy + k, c);
      else px(g, ox + k, oy + off, c);
    }
  },

  /** Segnaletica a terra: strisce tratteggiate lungo righe o colonne intere, consumate (pixel mancanti). */
  marking: Object.assign(
    function marking(g, ox, oy, s, p, rnd, ctx) {
      const { tx, ty } = ctx;
      const c = (p.colors || ['#c8a83a'])[0];
      const period = p.period ?? 7; // ogni quante righe/colonne
      const dash = p.dash ?? 2; // celle piene + celle vuote
      const wear = p.wear ?? 0.25;
      const w = p.width ?? 2;
      if (ty % period === Math.floor(cellRandom(0, 0, p.salt ?? 0) * period) && Math.floor(tx / dash) % 2 === 0) {
        for (let x = 0; x < s; x++) for (let k = 0; k < w; k++) if (rnd(100 + x * 3 + k) > wear) px(g, ox + x, oy + s / 2 - 1 + k, c);
      }
      if (tx % period === Math.floor(cellRandom(1, 0, p.salt ?? 0) * period) && Math.floor(ty / dash) % 2 === 0) {
        for (let y = 0; y < s; y++) for (let k = 0; k < w; k++) if (rnd(300 + y * 3 + k) > wear) px(g, ox + s / 2 - 1 + k, oy + y, c);
      }
    },
    { lane: true }
  ),

  /**
   * Tracce di pneumatici: due solchi paralleli lungo la strada, continui per tratti lunghi (scelti per riga/colonna
   * e per tratto di "segment" celle), orizzontali se la strada prosegue a destra/sinistra, verticali se su/giù.
   */
  tracks: Object.assign(
    function tracks(g, ox, oy, s, p, rnd, ctx) {
      const { map, tx, ty } = ctx;
      const on = (dx, dy) => {
        const t = map.tileAt(tx + dx, ty + dy);
        return !!t && !t.solid && t.terrain === ctx.t.terrain;
      };
      const seg = p.segment ?? 6;
      const cols = p.colors || ['#00000033'];
      const chance = p.chance ?? 0.3;
      const gap = p.gap ?? 6;
      const dither = p.dither ?? 0.75;
      // solo strade vere: larghezza in senso trasversale al massimo maxWidth celle (niente griglie sugli spiazzi)
      const maxW = p.maxWidth ?? 5;
      const width = (dx, dy) => {
        let n = 1;
        for (const sgn of [-1, 1]) for (let k = 1; k <= maxW && on(dx * k * sgn, dy * k * sgn); k++) n++;
        return n;
      };
      if (on(-1, 0) && on(1, 0) && width(0, 1) <= maxW && cellRandom(Math.floor(tx / seg), ty, (p.salt ?? 0) + 1) < chance) {
        const y = oy + 2 + Math.floor(cellRandom(0, ty, (p.salt ?? 0) + 2) * (s - gap - 4));
        for (let x = 0; x < s; x++) {
          if (rnd(200 + x) < dither) px(g, ox + x, y, pick(cols, rnd(400 + x)));
          if (rnd(600 + x) < dither) px(g, ox + x, y + gap, pick(cols, rnd(800 + x)));
        }
      }
      if (on(0, -1) && on(0, 1) && width(1, 0) <= maxW && cellRandom(tx, Math.floor(ty / seg), (p.salt ?? 0) + 3) < chance) {
        const x = ox + 2 + Math.floor(cellRandom(tx, 0, (p.salt ?? 0) + 4) * (s - gap - 4));
        for (let y = 0; y < s; y++) {
          if (rnd(1000 + y) < dither) px(g, x, oy + y, pick(cols, rnd(1200 + y)));
          if (rnd(1400 + y) < dither) px(g, x + gap, oy + y, pick(cols, rnd(1600 + y)));
        }
      }
    },
    { lane: true }
  ),

  /** Impronte: coppie di puntini alternate lungo una diagonale. */
  footprints(g, ox, oy, s, p, rnd) {
    const c = (p.colors || ['#00000040'])[0];
    const dir = rnd(1) * Math.PI * 2;
    let x = ox + s / 2 - Math.cos(dir) * 6;
    let y = oy + s / 2 - Math.sin(dir) * 6;
    for (let k = 0; k < 4; k++) {
      const side = k % 2 ? 1 : -1;
      const fx = x + Math.cos(dir + Math.PI / 2) * side * 1.5;
      const fy = y + Math.sin(dir + Math.PI / 2) * side * 1.5;
      px(g, fx, fy, c, 2, 1);
      x += Math.cos(dir) * 3.5;
      y += Math.sin(dir) * 3.5;
    }
  },

  /** Pezzetti sparsi (rifiuti, sassolini, fiori): count pixel o 2x1 nei colori dati, con ombra opzionale. */
  bits(g, ox, oy, s, p, rnd) {
    const cols = p.colors || ['#888'];
    const [a, b] = p.count || [2, 5];
    const n = a + Math.floor(rnd(1) * (b - a + 1));
    const cluster = p.cluster ?? s;
    const cx = ox + cluster / 2 + rnd(2) * (s - cluster);
    const cy = oy + cluster / 2 + rnd(3) * (s - cluster);
    for (let i = 0; i < n; i++) {
      const x = cx + (rnd(10 + i) - 0.5) * cluster;
      const y = cy + (rnd(30 + i) - 0.5) * cluster;
      const big = rnd(50 + i) < (p.big ?? 0.3);
      if (p.shadow) px(g, x + 1, y + 1, p.shadow, big ? 2 : 1, 1);
      px(g, x, y, pick(cols, rnd(70 + i)), big ? 2 : 1, 1);
      if (p.light && big) px(g, x, y, p.light);
    }
  },

  /** Ciuffo d'erba o canne: steli verticali di altezza diversa, punta più chiara, base più scura. */
  tuft(g, ox, oy, s, p, rnd) {
    const [dark, mid, light] = p.colors || ['#3e6a26', '#5a9038', '#8ac05a'];
    const [a, b] = p.count || [3, 6];
    const n = a + Math.floor(rnd(1) * (b - a + 1));
    const cx = ox + 3 + rnd(2) * (s - 6);
    const by = oy + 4 + rnd(3) * (s - 5);
    const [h0, h1] = p.height || [2, 4];
    for (let i = 0; i < n; i++) {
      const x = cx + (i - n / 2) * (p.spacing ?? 1) + (rnd(10 + i) - 0.5) * 1.5;
      const h = Math.round(h0 + rnd(20 + i) * (h1 - h0));
      const lean = rnd(30 + i) < 0.3 ? (rnd(40 + i) < 0.5 ? -1 : 1) : 0;
      px(g, x, by, dark);
      for (let k = 1; k < h; k++) px(g, x + (k === h - 1 ? lean : 0), by - k, k === h - 1 ? light : mid);
      if (p.tip && rnd(50 + i) < 0.4) px(g, x + lean, by - h, p.tip);
    }
  },
};
