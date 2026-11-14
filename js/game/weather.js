// Meteo del livello: vento con raffiche e sabbia che si muove (effects.json -> "weather", il livello sceglie
// il tipo con "weather": "desert_wind"). Tutto in coordinate mondo attorno alla visuale:
// - wind: direzione (angleDeg) e intensità = base + raffiche (gustEvery / gustTime / gustStrength), con
//   un'oscillazione lenta; letta da Props (palme e cespugli) e Effects (fumo trasportato);
// - wisps: lingue di sabbia sinuose che scorrono rasoterra (sotto i soldati);
// - streaks: granelli veloci in aria (sopra tutto);
// - haze: velature di polvere grandi e tenui, a pixel sparsi (sopra tutto);
// - tint: velo di colore su tutto lo schermo (caldo del deserto), più denso durante le raffiche ("mode" = modo
//   di fusione, default normale);
// - clouds: ombre delle nuvole che scorrono col vento sul terreno (sotto le luci; spariscono col buio);
// - fog: lista di banchi (nebbia, polvere densa) sopra a tutto, che scorrono col vento ("gustAlpha" = più densi
//   nelle raffiche);
// - rain: gocce oblique col vento, spruzzi a terra, cerchi su pozzanghere e acqua;
// - puddles: pozzanghere sparse sul terreno indicato (riflesso del cielo, luccichii, stabili per cella);
// - grade: passaggi di correzione di colore aggiunti a quelli della mappa (js/game/atmosphere.js);
// - sound: suono continuo dell'ambiente (es. pioggia) = { name, volume }.
// I granelli usciti dalla visuale (più un margine) rientrano dal lato da cui soffia il vento.
// Banchi di nuvole e nebbia = tessere di rumore ripetibili (in cache) a gradini retinati, in coordinate mondo.

import { cellRandom } from '../engine/tilemap.js';
import { matcher } from '../engine/scatter.js';

const DEG = Math.PI / 180;
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, w);
  c.height = Math.max(1, h);
  return c;
}

function hexToRgb(hex) {
  const n = parseInt(String(hex || '#000').replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Rumore frattale ripetibile (le tessere combaciano sui bordi): valori 0..1 in un quadrato size x size. */
function tileNoise(size, scale, octaves, salt) {
  const out = new Float32Array(size * size);
  let amp = 1;
  let total = 0;
  for (let o = 0; o < octaves; o++) {
    const P = Math.max(1, Math.round(size / scale) << o); // nodi per lato (periodo = size)
    const cell = size / P;
    const nodes = new Float32Array(P * P);
    for (let j = 0; j < P; j++) for (let i = 0; i < P; i++) nodes[j * P + i] = cellRandom(i, j, salt + o * 101);
    for (let y = 0; y < size; y++) {
      const fy = y / cell;
      const iy = Math.floor(fy);
      let ty = fy - iy;
      ty = ty * ty * (3 - 2 * ty);
      const r0 = (iy % P) * P;
      const r1 = ((iy + 1) % P) * P;
      for (let x = 0; x < size; x++) {
        const fx = x / cell;
        const ix = Math.floor(fx);
        let tx = fx - ix;
        tx = tx * tx * (3 - 2 * tx);
        const c0 = ix % P;
        const c1 = (ix + 1) % P;
        const a = nodes[r0 + c0];
        const b = nodes[r0 + c1];
        const c = nodes[r1 + c0];
        const d = nodes[r1 + c1];
        out[y * size + x] += amp * (a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty);
      }
    }
    total += amp;
    amp *= 0.5;
  }
  for (let i = 0; i < out.length; i++) out[i] /= total;
  return out;
}

/** Tessere dei banchi già fatte: "dimensioni|scala|ottave|soglia|morbidezza|gradini|colore|sale" -> canvas. */
const layerCache = new Map();

/**
 * Banco (nuvole, nebbia, polvere): densità = rumore oltre "threshold" ammorbidito su "soft", a "bands" gradini
 * retinati (pixel pieni o vuoti, niente sfumature lisce).
 */
function layerCanvas(def, salt) {
  const size = def.size ?? 384;
  const key = [size, def.scale ?? 96, def.octaves ?? 3, def.threshold ?? 0.5, def.soft ?? 0.15, def.bands ?? 3, def.color, salt].join('|');
  let c = layerCache.get(key);
  if (c) return c;
  const v = tileNoise(size, def.scale ?? 96, def.octaves ?? 3, salt);
  c = makeCanvas(size, size);
  const g = c.getContext('2d');
  const img = g.createImageData(size, size);
  const [r, gr, b] = hexToRgb(def.color || '#000000');
  const th = def.threshold ?? 0.5;
  const soft = Math.max(0.01, def.soft ?? 0.15);
  const bands = Math.max(1, def.bands ?? 3);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let t = (v[y * size + x] - th) / soft;
      if (t <= 0) continue;
      t = Math.min(1, t);
      t = t * t * (3 - 2 * t);
      const lv = Math.min(bands, Math.floor(t * bands + BAYER[(y & 3) * 4 + (x & 3)] / 16));
      if (lv <= 0) continue;
      const i = (y * size + x) * 4;
      img.data[i] = r;
      img.data[i + 1] = gr;
      img.data[i + 2] = b;
      img.data[i + 3] = Math.round((255 * lv) / bands);
    }
  }
  g.putImageData(img, 0, 0);
  if (layerCache.size > 24) layerCache.clear();
  layerCache.set(key, c);
  return c;
}

/** Banco che scorre col vento: def = { size, scale, octaves, threshold, soft, bands, color, alpha, speed, gustAlpha }. */
class DriftLayer {
  constructor(def, salt) {
    this.def = def;
    this.img = layerCanvas(def, salt);
    this.ox = cellRandom(salt, 3, 7) * this.img.width;
    this.oy = cellRandom(salt, 5, 9) * this.img.height;
  }

  update(dt, wind) {
    const sp = (this.def.speed ?? 8) * (0.5 + wind.strength);
    this.ox += wind.x * sp * dt;
    this.oy += wind.y * sp * dt;
  }

  /** ctx traslato sulla camera; k = moltiplicatore dell'alpha. */
  draw(ctx, view, k = 1) {
    const a = (this.def.alpha ?? 0.2) * k;
    if (!(a > 0.003)) return;
    const s = this.img.width;
    const mod = (v) => ((v % s) + s) % s;
    const x0 = view.x - mod(view.x - Math.round(this.ox));
    const y0 = view.y - mod(view.y - Math.round(this.oy));
    ctx.save();
    ctx.globalAlpha = Math.min(1, a);
    if (this.def.mode) ctx.globalCompositeOperation = this.def.mode;
    for (let y = y0; y < view.y + view.h; y += s) {
      for (let x = x0; x < view.x + view.w; x += s) ctx.drawImage(this.img, x, y);
    }
    ctx.restore();
  }
}

/**
 * Pozzanghere (weather.puddles): { on (tile o "terrain:<t>"), chance per cella, size [rx min, max], flat (ry/rx),
 * color, edge, sky (riflesso del cielo in alto), glint, alpha, salt }. Una piccola immagine per pozzanghera, con
 * la maschera dei pixel d'acqua (per i cerchi della pioggia); mai sui tile solidi.
 */
function buildPuddles(map, def) {
  const list = [];
  if (!map || !def) return list;
  const isOn = matcher(def.on) || (() => true);
  const s = map.size;
  const salt = def.salt ?? 4401;
  const [r0, r1] = def.size || [3, 7];
  // acqua semitrasparente (il terreno sotto si vede: prende il suo colore), cielo riflesso, terra bagnata attorno
  const water = [...hexToRgb(def.color || '#14202a'), Math.round(255 * (def.alpha ?? 0.5))];
  const sky = [...hexToRgb(def.sky || '#a8bccc'), Math.round(255 * (def.skyAlpha ?? 0.35))];
  const wet = [...hexToRgb(def.wet || '#000000'), Math.round(255 * (def.wetAlpha ?? 0.16))];
  const wetW = def.wetWidth ?? 0.35; // larghezza della terra bagnata (frazione del raggio)
  for (let ty = 1; ty < map.rows - 1; ty++) {
    for (let tx = 1; tx < map.cols - 1; tx++) {
      if (cellRandom(tx, ty, salt) >= (def.chance ?? 0.05)) continue;
      const t = map.tileAt(tx, ty);
      if (!t || t.solid || !isOn(t)) continue;
      const R = (k) => cellRandom(tx, ty, salt + k);
      const rx = r0 + R(1) * (r1 - r0);
      const ry = Math.max(1.5, rx * (def.flat ?? 0.6) * (0.8 + R(5) * 0.4));
      const cx = tx * s + s / 2 + (R(2) - 0.5) * s * 0.6;
      const cy = ty * s + s / 2 + (R(3) - 0.5) * s * 0.6;
      const ph = R(4) * 10;
      // forma: unione di 1-3 ellissi sfalsate con il contorno mosso (pozze allungate, a fagiolo, a otto)
      const blobs = [{ x: 0, y: 0, rx, ry }];
      const extra = Math.floor(R(6) * 3);
      for (let b = 0; b < extra; b++) {
        const a = R(7 + b) * Math.PI * 2;
        const k = 0.45 + R(9 + b) * 0.4;
        blobs.push({ x: Math.cos(a) * rx * 0.8, y: Math.sin(a) * ry * 0.8, rx: rx * k, ry: ry * k * (0.8 + R(11 + b) * 0.5) });
      }
      const dist = (dx, dy) => {
        let m = Infinity;
        for (const b of blobs) {
          const ex = (dx - b.x) / b.rx;
          const ey = (dy - b.y) / b.ry;
          const a = Math.atan2(ey, ex);
          const wob = 1 + 0.16 * Math.sin(a * 3 + ph) + 0.09 * Math.sin(a * 7 + ph * 1.7);
          m = Math.min(m, Math.hypot(ex, ey) / wob);
        }
        return m;
      };
      const ext = 1 + wetW;
      const w = Math.ceil(rx * 2 * 1.8 * ext) + 2;
      const h = Math.ceil(ry * 2 * 1.8 * ext) + 2;
      const x0 = Math.round(cx - w / 2);
      const y0 = Math.round(cy - h / 2);
      const img = new ImageData(w, h);
      const mask = new Uint8Array(w * h);
      let n = 0;
      const put = (k, c) => {
        img.data[k] = c[0];
        img.data[k + 1] = c[1];
        img.data[k + 2] = c[2];
        img.data[k + 3] = c[3];
      };
      for (let j = 0; j < h; j++) {
        for (let i = 0; i < w; i++) {
          const px = x0 + i;
          const py = y0 + j;
          if (map.isSolidAt(px, py)) continue;
          const dx = px + 0.5 - cx;
          const dy = py + 0.5 - cy;
          const d = dist(dx, dy);
          if (d >= ext) continue;
          const k = (j * w + i) * 4;
          const dither = BAYER[(py & 3) * 4 + (px & 3)] / 16;
          if (d >= 1) {
            // terra bagnata: più scura vicino all'acqua, retinata verso fuori
            if (dither < 1 - (d - 1) / wetW) put(k, wet);
            continue;
          }
          // cielo riflesso: righe orizzontali a una riga sì e una no nella metà alta, mai sul bordo
          const sy = dy / ry;
          const row = Math.floor(dy + 100 + ph) & 1;
          if (d < 0.78 && sy < 0.15 && sy > -0.85 && row === 0 && dither < 0.92 - d * 0.5) put(k, sky);
          else put(k, water);
          mask[j * w + i] = 1;
          n++;
        }
      }
      if (n < 4) continue;
      const c = makeCanvas(w, h);
      c.getContext('2d').putImageData(img, 0, 0);
      list.push({ x: x0, y: y0, w, h, cx, cy, rx, ry, canvas: c, mask, phase: ph, tx, ty });
    }
  }
  return list;
}

function rand(v, def = 0) {
  if (v === undefined || v === null) return def;
  if (Array.isArray(v)) return v[0] + Math.random() * (v[1] - v[0]);
  return v;
}

/** Velatura a pixel sparsi: densità che cala dal centro al bordo (aspetto pixel-art, niente sfumature). */
function hazeCanvas(size, color, seed) {
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const g = c.getContext('2d');
  g.fillStyle = color;
  let s = seed * 7919 + 1;
  const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const h = size / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x + 0.5 - h, (y + 0.5 - h) * 1.6) / h; // ellittica, allungata
      if (d < 1 && r() < (1 - d) * (1 - d) * 0.9) g.fillRect(x, y, 1, 1);
    }
  }
  return c;
}

export class Weather {
  /** cfg = un tipo di effects.json -> weather (null = niente meteo). */
  constructor(cfg) {
    this.cfg = cfg || null;
    this.time = 0;
    const w = this.cfg?.wind || {};
    const a = (w.angleDeg ?? 0) * DEG;
    // wind: direzione unitaria (x, y) e intensità attuale (0 = calma, ~1 = raffica)
    this.wind = { x: Math.cos(a), y: Math.sin(a), strength: w.base ?? 0 };
    this.gust = { timer: rand(w.gustEvery, 6), time: 0, duration: 0, peak: 0 };
    this.streaks = [];
    this.wisps = [];
    this.hazes = [];
    this._hazeImgs = [];
    this._seeded = false;
    const c = this.cfg || {};
    // ombre delle nuvole e banchi di nebbia/polvere (stesso disegno, salt diverso per banco)
    this.clouds = [].concat(c.clouds || []).map((d, i) => new DriftLayer(d, 7001 + i * 13));
    this.fog = [].concat(c.fog || []).map((d, i) => new DriftLayer(d, 7301 + i * 17));
    this.drops = []; // gocce di pioggia: { x, y (punto a terra), z (quota), vz, len, color, alpha }
    this.splashes = []; // { x, y, age, life, ring }
    this.puddles = [];
    this.map = null;
  }

  /** Mappa della partita: pozzanghere (stabili per cella) e acqua per i cerchi della pioggia. */
  attach(map) {
    this.map = map;
    this.puddles = this.cfg?.puddles ? buildPuddles(map, this.cfg.puddles) : [];
    // indice per cella delle pozzanghere (il punto d'arrivo di una goccia trova subito la sua)
    this._puddleAt = new Map();
    if (map) {
      for (const p of this.puddles) {
        for (let ty = Math.floor(p.y / map.size); ty <= Math.floor((p.y + p.h) / map.size); ty++) {
          for (let tx = Math.floor(p.x / map.size); tx <= Math.floor((p.x + p.w) / map.size); tx++) {
            const k = ty * map.cols + tx;
            if (!this._puddleAt.has(k)) this._puddleAt.set(k, []);
            this._puddleAt.get(k).push(p);
          }
        }
      }
    }
  }

  /** Il punto (x, y) è sull'acqua di una pozzanghera? */
  puddleAt(x, y) {
    const m = this.map;
    if (!m || !this._puddleAt) return false;
    const list = this._puddleAt.get(Math.floor(y / m.size) * m.cols + Math.floor(x / m.size));
    if (!list) return false;
    const px = Math.floor(x);
    const py = Math.floor(y);
    for (const p of list) {
      const i = px - p.x;
      const j = py - p.y;
      if (i >= 0 && j >= 0 && i < p.w && j < p.h && p.mask[j * p.w + i]) return true;
    }
    return false;
  }

  get active() {
    return !!this.cfg;
  }

  /** Intensità 0..1 della raffica in corso (inviluppo morbido). */
  _gustLevel() {
    const g = this.gust;
    if (g.duration <= 0) return 0;
    const k = g.time / g.duration;
    return k >= 1 ? 0 : Math.sin(Math.PI * k) * g.peak;
  }

  /** view = { x, y, w, h } (px mondo) della visuale attuale. */
  update(dt, view) {
    if (!this.cfg) return;
    const c = this.cfg;
    const w = c.wind || {};
    this.time += dt;

    // raffiche
    const g = this.gust;
    if (g.duration > 0) {
      g.time += dt;
      if (g.time >= g.duration) g.duration = 0;
    } else if ((g.timer -= dt) <= 0) {
      g.timer = rand(w.gustEvery, 6);
      g.time = 0;
      g.duration = rand(w.gustTime, 2);
      g.peak = rand(w.gustStrength, 0.7);
    }
    const wobble = Math.sin(this.time * 0.37) * (w.wobble ?? 0.08);
    this.wind.strength = Math.max(0, (w.base ?? 0.3) + wobble + this._gustLevel());
    // la direzione oscilla un poco
    const a = ((w.angleDeg ?? 0) + Math.sin(this.time * 0.13) * (w.angleWobbleDeg ?? 6)) * DEG;
    this.wind.x = Math.cos(a);
    this.wind.y = Math.sin(a);

    if (!this._seeded) this._seed(view);
    const mul = 0.35 + this.wind.strength;
    const margin = c.margin ?? 40;
    const out = (p) => p.x < view.x - margin || p.x > view.x + view.w + margin || p.y < view.y - margin || p.y > view.y + view.h + margin;

    for (const p of this.streaks) {
      p.x += this.wind.x * p.speed * mul * dt;
      p.y += this.wind.y * p.speed * mul * dt;
      if (out(p)) this._respawn(p, view, margin);
    }
    for (const p of this.wisps) {
      p.x += this.wind.x * p.speed * mul * dt;
      p.y += this.wind.y * p.speed * mul * dt;
      if (out(p)) this._respawn(p, view, margin + p.length);
    }
    for (const p of this.hazes) {
      p.x += this.wind.x * p.speed * mul * dt;
      p.y += this.wind.y * p.speed * mul * dt;
      if (out(p)) this._respawn(p, view, margin + p.img.width / 2);
    }
    for (const l of this.clouds) l.update(dt, this.wind);
    for (const l of this.fog) l.update(dt, this.wind);
    if (c.rain) this._updateRain(dt, view);
  }

  /** Spostamento orizzontale delle gocce per px di caduta (vento). */
  _slant() {
    const k = (this.cfg.rain.slant ?? 0.35) * (0.5 + this.wind.strength);
    return { sx: this.wind.x * k, sy: this.wind.y * k };
  }

  /** Goccia nuova sopra un punto a caso della visuale (spostato controvento: arriva a terra dentro la visuale). */
  _newDrop(d, view, anyHeight) {
    const r = this.cfg.rain;
    const m = 16;
    const [h0, h1] = r.height || [40, 110];
    d.z = anyHeight ? Math.random() * h1 : h0 + Math.random() * (h1 - h0);
    d.x = view.x - m + Math.random() * (view.w + m * 2);
    d.y = view.y - m + Math.random() * (view.h + m * 2);
    d.vz = rand(r.speed, 260);
    d.len = Math.round(rand(r.length, 5));
    d.color = r.colors ? r.colors[(Math.random() * r.colors.length) | 0] : r.color || '#b8c8d8';
    d.alpha = rand(r.alpha, 0.5);
    return d;
  }

  _updateRain(dt, view) {
    const r = this.cfg.rain;
    const n = r.count ?? 160;
    while (this.drops.length < n) this.drops.push(this._newDrop({}, view, true));
    const sp = r.splash || {};
    const ring = r.ring || {};
    const maxSplash = r.maxSplashes ?? 160;
    for (const d of this.drops) {
      d.z -= d.vz * dt;
      if (d.z > 0) continue;
      // a terra: cerchio su pozzanghere e acqua, spruzzo altrove (non sui tile che fermano i colpi: muri, tetti)
      const map = this.map;
      if (this.splashes.length < maxSplash && map) {
        const t = map.tileAt(Math.floor(d.x / map.size), Math.floor(d.y / map.size));
        const wet = t && t.impact === 'water';
        if (wet || this.puddleAt(d.x, d.y)) {
          if (Math.random() < (ring.chance ?? 0.7)) this.splashes.push({ x: Math.round(d.x), y: Math.round(d.y), age: 0, life: ring.life ?? 0.45, ring: true });
        } else if (!(t && t.solid) && Math.random() < (sp.chance ?? 0.6)) {
          this.splashes.push({ x: Math.round(d.x), y: Math.round(d.y), age: 0, life: sp.life ?? 0.12, ring: false });
        }
      }
      this._newDrop(d, view, false);
    }
    for (let i = this.splashes.length - 1; i >= 0; i--) {
      const s = this.splashes[i];
      s.age += dt;
      if (s.age >= s.life) this.splashes.splice(i, 1);
    }
  }

  /** Prima volta: oggetti sparsi su tutta la visuale. */
  _seed(view) {
    const c = this.cfg;
    const any = (extra) => ({ x: view.x + Math.random() * view.w, y: view.y + Math.random() * view.h, ...extra });
    const s = c.streaks;
    if (s) {
      for (let i = 0; i < (s.count ?? 60); i++) {
        this.streaks.push(any({
          speed: rand(s.speed, 100),
          length: rand(s.length, 3),
          alpha: rand(s.alpha, 0.4),
          color: s.colors ? s.colors[i % s.colors.length] : s.color || '#e8d3a0',
        }));
      }
    }
    const wi = c.wisps;
    if (wi) {
      for (let i = 0; i < (wi.count ?? 8); i++) {
        this.wisps.push(any({ speed: rand(wi.speed, 35), length: Math.round(rand(wi.length, 30)), phase: Math.random() * 10, wave: rand(wi.wave, 3) }));
      }
    }
    const hz = c.haze;
    if (hz) {
      for (let k = 0; k < 3; k++) this._hazeImgs.push(hazeCanvas(Math.round(rand(hz.size, 100)), hz.color || '#d9b77a', k + 1));
      for (let i = 0; i < (hz.count ?? 3); i++) {
        this.hazes.push(any({ speed: rand(hz.speed, 12), img: this._hazeImgs[i % this._hazeImgs.length] }));
      }
    }
    this._seeded = true;
  }

  /** Rientro dal lato controvento della visuale (posizione casuale lungo quel lato). */
  _respawn(p, view, margin) {
    const wx = this.wind.x;
    const wy = this.wind.y;
    // lato da cui entra: scelto in proporzione alla componente del vento su ciascun asse
    if (Math.random() < Math.abs(wx) / (Math.abs(wx) + Math.abs(wy) || 1)) {
      p.x = wx > 0 ? view.x - margin + 1 : view.x + view.w + margin - 1;
      p.y = view.y - margin + Math.random() * (view.h + margin * 2);
    } else {
      p.y = wy > 0 ? view.y - margin + 1 : view.y + view.h + margin - 1;
      p.x = view.x - margin + Math.random() * (view.w + margin * 2);
    }
  }

  /** Pozzanghere visibili (dopo l'acqua della mappa, sotto decal e decorazioni): immagine + luccichio. */
  drawPuddles(ctx, view, time) {
    if (!this.puddles.length) return;
    const def = this.cfg.puddles;
    ctx.save();
    ctx.fillStyle = def.glint || '#e8f0f8';
    for (const p of this.puddles) {
      if (p.x + p.w < view.x || p.y + p.h < view.y || p.x > view.x + view.w || p.y > view.y + view.h) continue;
      ctx.globalAlpha = 1;
      ctx.drawImage(p.canvas, p.x, p.y);
      // riflesso che brilla e scorre piano sulla superficie
      const b = Math.sin(time * 1.7 + p.phase);
      if (b < 0.5) continue;
      const span = Math.max(1, Math.round(p.rx * 1.2));
      const gx = Math.round(p.cx - span / 2 + ((time * 1.5 + p.phase * 3) % span));
      const gy = Math.round(p.cy - p.ry * 0.1);
      const i = gx - p.x;
      const j = gy - p.y;
      if (i < 0 || j < 0 || i >= p.w || j >= p.h || !p.mask[j * p.w + i]) continue;
      ctx.globalAlpha = (b - 0.5) * 1.6;
      ctx.fillRect(gx, gy, b > 0.85 && p.mask[j * p.w + i + 1] ? 2 : 1, 1);
    }
    ctx.restore();
  }

  /** Ombre delle nuvole sul terreno e su tutto quello che c'è sopra (prima delle luci); k = luce del giorno 0..1. */
  drawShadows(ctx, view, k = 1) {
    for (const l of this.clouds) l.draw(ctx, view, k);
  }

  /** Lingue di sabbia rasoterra (sotto soldati e oggetti). */
  drawGround(ctx) {
    const wi = this.cfg?.wisps;
    if (!wi) return;
    const { x: wx, y: wy, strength } = this.wind;
    const px = -wy; // perpendicolare
    const py = wx;
    ctx.save();
    ctx.fillStyle = wi.color || '#e8d3a0';
    const base = (wi.alpha ?? 0.2) * Math.min(1.4, 0.4 + strength);
    for (const p of this.wisps) {
      const L = p.length;
      for (let k = 0; k < L; k++) {
        const off = Math.sin(k * 0.18 + this.time * 2.2 + p.phase) * p.wave;
        const x = Math.round(p.x - wx * k + px * off);
        const y = Math.round(p.y - wy * k + py * off);
        ctx.globalAlpha = base * Math.sin((Math.PI * k) / L);
        ctx.fillRect(x, y, 1, 1);
      }
    }
    ctx.restore();
  }

  /** Granelli in aria, velature di polvere, banchi di nebbia e pioggia (sopra a tutto, coordinate mondo). */
  drawAir(ctx, view) {
    const c = this.cfg;
    if (!c) return;
    const { x: wx, y: wy, strength } = this.wind;
    ctx.save();
    const hz = c.haze;
    if (hz) {
      ctx.globalAlpha = (hz.alpha ?? 0.08) * Math.min(1.5, 0.5 + strength);
      for (const p of this.hazes) ctx.drawImage(p.img, Math.round(p.x - p.img.width / 2), Math.round(p.y - p.img.height / 2));
    }
    const k = 0.5 + strength;
    for (const p of this.streaks) {
      ctx.globalAlpha = p.alpha * Math.min(1, 0.3 + strength);
      ctx.fillStyle = p.color;
      const n = Math.max(1, Math.round(p.length * k));
      for (let i = 0; i < n; i++) ctx.fillRect(Math.round(p.x - wx * i), Math.round(p.y - wy * i), 1, 1);
    }
    ctx.restore();
    // banchi di nebbia o polvere (più densi nelle raffiche se gustAlpha)
    const gust = this._gustLevel();
    if (view) for (const l of this.fog) l.draw(ctx, view, 1 + ((l.def.gustAlpha ?? 0) * gust) / Math.max(0.001, l.def.alpha ?? 0.2));
    if (c.rain) this._drawRain(ctx);
  }

  /** Gocce (righe oblique dalla quota z verso il punto d'arrivo), spruzzi e cerchi a terra. */
  _drawRain(ctx) {
    const r = this.cfg.rain;
    const { sx, sy } = this._slant();
    // direzione della scia (verso l'alto, controvento), normalizzata a 1 px per passo
    const tx = -sx;
    const ty = -(1 + sy);
    const tl = Math.hypot(tx, ty) || 1;
    const ux = tx / tl;
    const uy = ty / tl;
    ctx.save();
    for (const d of this.drops) {
      const hx = d.x - sx * d.z; // testa della goccia: sopra il punto d'arrivo, spostata controvento
      const hy = d.y - d.z - sy * d.z;
      ctx.globalAlpha = d.alpha;
      ctx.fillStyle = d.color;
      for (let i = 0; i < d.len; i++) ctx.fillRect(Math.round(hx + ux * i), Math.round(hy + uy * i), 1, 1);
    }
    const sp = r.splash || {};
    const ring = r.ring || {};
    for (const s of this.splashes) {
      const k = s.age / s.life;
      if (s.ring) {
        // cerchio che si allarga e svanisce (schiacciato: vista dall'alto un po' inclinata)
        const R = 1 + k * ((ring.radius ?? 3) - 1);
        ctx.globalAlpha = (ring.alpha ?? 0.6) * (1 - k);
        ctx.fillStyle = ring.color || '#c8dce8';
        const pts = Math.max(4, Math.round(R * 4));
        for (let i = 0; i < pts; i++) {
          const a = (i / pts) * Math.PI * 2;
          ctx.fillRect(Math.round(s.x + Math.cos(a) * R), Math.round(s.y + Math.sin(a) * R * 0.6), 1, 1);
        }
      } else {
        // spruzzo: un punto, poi due goccioline che saltano di lato
        ctx.globalAlpha = (sp.alpha ?? 0.7) * (1 - k * 0.6);
        ctx.fillStyle = sp.color || '#d8e4ee';
        if (k < 0.4) ctx.fillRect(s.x, s.y, 1, 1);
        else {
          ctx.fillRect(s.x - 1, s.y - 1, 1, 1);
          ctx.fillRect(s.x + 1, s.y - 1, 1, 1);
        }
      }
    }
    ctx.restore();
  }

  /** Velo di colore su tutta la visuale (ctx non traslato). */
  drawTint(ctx, w, h) {
    const t = this.cfg?.tint;
    if (!t) return;
    ctx.save();
    ctx.globalAlpha = (t.alpha ?? 0.05) + (t.gustAlpha ?? 0) * this._gustLevel();
    if (t.mode) ctx.globalCompositeOperation = t.mode;
    ctx.fillStyle = t.color || '#f0c070';
    ctx.fillRect(0, 0, w, h);
    ctx.restore();
  }
}
