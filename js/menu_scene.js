// Scena animata dietro al menu principale (al posto della partita dimostrativa): deserto al tramonto,
// soldato visto di fronte con il fucile e un piede su una maceria, bandiera rossa a brandelli, carro armato in
// fiamme col fumo, nuvole e un elicottero che passa ogni tanto. Tutto procedurale a pixel su un canvas a bassa
// risoluzione scalato di un fattore intero; parametri e colori in config/menu_scene.json.

const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16);
const bayer = (x, y) => BAYER[(y & 3) * 4 + (x & 3)];

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rnd = (a, b) => a + Math.random() * (b - a);
const range = (r, d = [0, 1]) => rnd(...(Array.isArray(r) ? r : d));
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

function hex(c) {
  const h = c.replace('#', '');
  const n = parseInt(h.length === 3 ? h.replace(/./g, '$&$&') : h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const mixRGB = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const css = (c) => `rgb(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])})`;

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.ceil(w));
  c.height = Math.max(1, Math.ceil(h));
  const g = c.getContext('2d');
  g.imageSmoothingEnabled = false;
  return { c, g };
}

// ---------- Primitive a pixel (niente antialiasing) ----------

function rect(g, x, y, w, h, color) {
  g.fillStyle = color;
  g.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
}

function disc(g, cx, cy, r, color) {
  g.fillStyle = color;
  const R = Math.max(0, r);
  const ir = Math.ceil(R);
  for (let dy = -ir; dy <= ir; dy++) {
    const hw = Math.floor(Math.sqrt(Math.max(0, R * R - dy * dy)) + 0.25);
    if (R * R - dy * dy < 0) continue;
    g.fillRect(Math.round(cx) - hw, Math.round(cy) + dy, hw * 2 + 1, 1);
  }
}

/** Righe di un'ellisse tra yMin e yMax (es. la calotta dell'elmetto). */
function ellipseRows(g, cx, cy, rx, ry, color, yMin = -Infinity, yMax = Infinity) {
  g.fillStyle = color;
  for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
    if (y < yMin || y > yMax) continue;
    const k = 1 - ((y + 0.5 - cy) / ry) ** 2;
    if (k <= 0) continue;
    const hw = rx * Math.sqrt(k);
    const x0 = Math.round(cx - hw);
    const x1 = Math.round(cx + hw);
    if (x1 > x0) g.fillRect(x0, y, x1 - x0, 1);
  }
}

/** Poligono pieno (scanline, regola pari-dispari). */
function poly(g, pts, color) {
  g.fillStyle = color;
  let y0 = Infinity;
  let y1 = -Infinity;
  for (const p of pts) {
    y0 = Math.min(y0, p[1]);
    y1 = Math.max(y1, p[1]);
  }
  for (let y = Math.floor(y0); y <= Math.ceil(y1); y++) {
    const yc = y + 0.5;
    const xs = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      if ((a[1] <= yc && b[1] > yc) || (b[1] <= yc && a[1] > yc)) xs.push(a[0] + ((yc - a[1]) / (b[1] - a[1])) * (b[0] - a[0]));
    }
    xs.sort((p, q) => p - q);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const xa = Math.round(xs[k]);
      const xb = Math.round(xs[k + 1]);
      if (xb > xa) g.fillRect(xa, y, xb - xa, 1);
    }
  }
}

/** Linea spessa w pixel (Bresenham con un quadrato w×w a ogni passo). */
function line(g, x0, y0, x1, y1, w, color) {
  g.fillStyle = color;
  x0 = Math.round(x0);
  y0 = Math.round(y0);
  x1 = Math.round(x1);
  y1 = Math.round(y1);
  const dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  const o = Math.floor((w - 1) / 2);
  for (;;) {
    g.fillRect(x0 - o, y0 - o, w, w);
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

/** Rumore a macchie stabile (griglia casuale interpolata), 0..1. */
function blobNoise(seed, cell) {
  const r = mulberry32(seed);
  const N = 64;
  const grid = Array.from({ length: N * N }, () => r());
  const at = (i, j) => grid[(((j % N) + N) % N) * N + (((i % N) + N) % N)];
  const s = (t) => t * t * (3 - 2 * t);
  return (x, y) => {
    const fx = x / cell;
    const fy = y / cell;
    const i = Math.floor(fx);
    const j = Math.floor(fy);
    const u = s(fx - i);
    const v = s(fy - j);
    const a = at(i, j) + (at(i + 1, j) - at(i, j)) * u;
    const b = at(i, j + 1) + (at(i + 1, j + 1) - at(i, j + 1)) * u;
    return a + (b - a) * v;
  };
}

/**
 * Rifinitura di uno sprite: tinta di controluce (tint), luce sul lato verso il sole (rim, rimDir -1 = sinistra,
 * +1 = destra; più debole in alto) e contorno di 1 pixel attorno (outline). Lo sprite deve avere 1 px di margine.
 */
function finish(canvas, { tint, tintAmount = 0, rim, rimAmount = 0.6, rimDir = 0, outline }) {
  const W = canvas.width;
  const H = canvas.height;
  const g = canvas.getContext('2d');
  const img = g.getImageData(0, 0, W, H);
  const d = img.data;
  const src = new Uint8ClampedArray(d);
  const a = (x, y) => (x < 0 || y < 0 || x >= W || y >= H ? 0 : src[(y * W + x) * 4 + 3]);
  const T = tint ? hex(tint) : null;
  const R = rim ? hex(rim) : null;
  const O = outline ? hex(outline) : null;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      if (src[i + 3] > 0) {
        let c = [src[i], src[i + 1], src[i + 2]];
        if (T) c = mixRGB(c, T, tintAmount);
        if (R) {
          const side = rimDir && !a(x + rimDir, y);
          const top = !a(x, y - 1);
          if (side || top) c = mixRGB(c, R, side ? rimAmount : rimAmount * 0.45);
        }
        d[i] = c[0];
        d[i + 1] = c[1];
        d[i + 2] = c[2];
      } else if (O && (a(x - 1, y) || a(x + 1, y) || a(x, y - 1) || a(x, y + 1))) {
        d[i] = O[0];
        d[i + 1] = O[1];
        d[i + 2] = O[2];
        d[i + 3] = 255;
      }
    }
  }
  g.putImageData(img, 0, 0);
}

/** Sostituisce i pixel di colore "base" con una mimetica a macchie (colori "spots"). shift(x, y) = y in coordinate stabili. */
function camouflage(canvas, base, spots, noise, shift = (x, y) => y) {
  const g = canvas.getContext('2d');
  const img = g.getImageData(0, 0, canvas.width, canvas.height);
  const d = img.data;
  const B = hex(base);
  const S = spots.map(hex);
  for (let y = 0; y < canvas.height; y++) {
    for (let x = 0; x < canvas.width; x++) {
      const i = (y * canvas.width + x) * 4;
      if (d[i + 3] === 0 || d[i] !== B[0] || d[i + 1] !== B[1] || d[i + 2] !== B[2]) continue;
      const v = noise(x, shift(x, y));
      const w = noise(x + 37, shift(x, y) + 11);
      let c = null;
      if (v < 0.3) c = S[0];
      else if (w < 0.24) c = S[1];
      else if (v > 0.74) c = S[2];
      if (c) {
        d[i] = c[0];
        d[i + 1] = c[1];
        d[i + 2] = c[2];
      }
    }
  }
  g.putImageData(img, 0, 0);
}

// ---------- Sprite ----------

const M = 2; // margine degli sprite (per il contorno)

/** Soldato visto di fronte: fucile tenuto di traverso, gamba destra (a destra di chi guarda) su una maceria. */
function drawSoldier(g, c, oy) {
  const U = (y) => y + oy;
  g.save();
  g.translate(M, M);
  // maceria sotto il piede alzato
  const block = (x, y, w, h, col, light, dark) => {
    rect(g, x, y, w, h, col);
    rect(g, x, y, w, 1, light);
    rect(g, x, y + h - 1, w, 1, dark);
  };
  line(g, 36, 83, 33, 75, 1, c.rebar);
  line(g, 51, 84, 56, 76, 1, c.rebar);
  block(29, 85, 11, 6, c.concrete, c.concreteLight, c.concreteDark);
  block(48, 86, 9, 5, c.brick, c.concreteLight, c.concreteDark);
  block(37, 82, 13, 9, c.concrete, c.concreteLight, c.concreteDark);
  block(33, 83, 7, 3, c.concreteLight, c.concreteLight, c.concrete);
  block(47, 82, 7, 4, c.concrete, c.concreteLight, c.concreteDark);
  block(53, 85, 4, 2, c.brick, c.brick, c.concreteDark);
  rect(g, 42, 86, 2, 2, c.concreteDark);
  rect(g, 31, 88, 3, 1, c.concreteDark);

  // gamba d'appoggio (a sinistra di chi guarda)
  poly(g, [[15, 54], [26, 54], [25, 72], [16, 72]], c.camo);
  poly(g, [[16, 72], [25, 72], [24, 84], [17, 84]], c.camo);
  rect(g, 15, 68, 10, 5, c.pads);
  rect(g, 15, 68, 10, 1, c.vestLight);
  rect(g, 14, 83, 12, 6, c.boots);
  rect(g, 15, 84, 10, 1, c.bootsDark);
  rect(g, 13, 88, 14, 2, c.bootsDark);
  // gamba alzata sulla maceria
  poly(g, [[26, 53], [37, 52], [47, 60], [38, 66]], c.camo);
  poly(g, [[39, 62], [47, 62], [46, 77], [40, 77]], c.camo);
  rect(g, 39, 59, 9, 5, c.pads);
  rect(g, 39, 59, 9, 1, c.vestLight);
  rect(g, 38, 76, 11, 5, c.boots);
  rect(g, 39, 77, 9, 1, c.bootsDark);
  rect(g, 37, 80, 13, 2, c.bootsDark);
  // fianchi
  poly(g, [[14, 49], [38, 49], [38, 56], [14, 56]], c.camo);
  rect(g, 21, 54, 10, 1, c.vestDark); // ombra del cavallo

  // busto (respira: oy)
  poly(g, [[12, U(27)], [40, U(27)], [38, U(50)], [14, U(50)]], c.camo);
  disc(g, 13, U(30), 4, c.camo);
  disc(g, 39, U(30), 4, c.camo);
  // braccia (parte alta)
  line(g, 12, U(30), 9, U(42), 6, c.camo);
  line(g, 40, U(30), 44, U(40), 6, c.camo);
  // giubbotto tattico
  poly(g, [[15, U(28)], [37, U(28)], [36, U(48)], [16, U(48)]], c.vest);
  rect(g, 26, U(29), 1, 19, c.vestDark);
  for (const px of [17, 21, 28, 32]) {
    rect(g, px, U(39), 4, 7, c.vestDark);
    rect(g, px, U(39), 4, 1, c.vestLight);
    rect(g, px + 1, U(41), 2, 1, c.vest);
  }
  rect(g, 30, U(30), 5, 6, c.vestDark);
  rect(g, 30, U(30), 5, 1, c.vestLight);
  line(g, 34, U(29), 36, U(19), 1, c.dark); // antenna della radio
  rect(g, 16, U(31), 3, 5, c.vestDark);
  // cinturone
  rect(g, 15, U(48), 23, 3, c.belt);
  rect(g, 25, U(48), 3, 3, c.buckle);
  // collo e kefiah
  rect(g, 19, U(22), 15, 6, c.scarf);
  for (let x = 20; x < 34; x += 3) rect(g, x, U(22), 1, 6, c.scarfDark);
  rect(g, 19, U(24), 15, 1, c.scarfDark);
  // viso
  rect(g, 20, U(13), 13, 9, c.skin);
  rect(g, 21, U(21), 11, 1, c.skin);
  rect(g, 20, U(13), 13, 2, c.skinShadow);
  rect(g, 22, U(15), 2, 1, c.skinShadow);
  rect(g, 29, U(15), 2, 1, c.skinShadow);
  rect(g, 22, U(16), 2, 1, c.dark);
  rect(g, 29, U(16), 2, 1, c.dark);
  rect(g, 26, U(17), 1, 2, c.skinShadow);
  rect(g, 25, U(20), 3, 1, c.skinShadow);
  rect(g, 20, U(15), 1, 6, c.strap);
  rect(g, 32, U(15), 1, 6, c.strap);
  // elmetto con occhiali
  ellipseRows(g, 26.5, U(12), 11.5, 11, c.helmet, U(1), U(11));
  rect(g, 14, U(11), 25, 2, c.helmetDark);
  rect(g, 15, U(6), 23, 2, c.strap);
  rect(g, 19, U(5), 5, 4, c.goggles);
  rect(g, 29, U(5), 5, 4, c.goggles);
  rect(g, 19, U(8), 5, 1, c.strap);
  rect(g, 29, U(8), 5, 1, c.strap);
  rect(g, 20, U(5), 1, 1, c.gogglesLight);
  rect(g, 30, U(5), 1, 1, c.gogglesLight);
  // fucile di traverso
  line(g, 8, U(57), 14, U(49), 4, c.wood);
  line(g, 14, U(49), 27, U(33), 4, c.gun);
  line(g, 20, U(42), 24, U(47), 3, c.gun);
  line(g, 24, U(47), 25, U(51), 3, c.gun);
  line(g, 15, U(47), 17, U(51), 2, c.gun);
  line(g, 17, U(40), 23, U(33), 1, c.gunLight); // tacca di mira / ottica
  line(g, 27, U(33), 37, U(20), 3, c.wood);
  line(g, 37, U(20), 45, U(10), 2, c.gun);
  rect(g, 45, U(8), 1, 2, c.gun);
  // avambracci e mani sul fucile
  line(g, 9, U(42), 16, U(48), 5, c.camo);
  line(g, 44, U(40), 34, U(28), 5, c.camo);
  disc(g, 16, U(48), 2, c.gloves);
  disc(g, 33, U(27), 2, c.gloves);
  rect(g, 32, U(26), 3, 1, c.camo); // polsino
  g.restore();
}

/** Carro armato distrutto, di fianco col muso a destra: torretta con portello aperto, cannone piegato. */
function drawTank(g, c, seed) {
  const r = mulberry32(seed);
  g.save();
  g.translate(M, M);
  poly(g, [[4, 24], [58, 24], [62, 28], [58, 32], [6, 32], [2, 28]], c.track);
  for (let x = 10; x <= 55; x += 9) {
    disc(g, x, 28, 3, c.wheel);
    rect(g, x, 28, 1, 1, c.hub);
  }
  rect(g, 4, 24, 55, 1, c.dark);
  poly(g, [[2, 17], [60, 17], [64, 22], [60, 25], [4, 25], [1, 21]], c.hull);
  rect(g, 2, 17, 58, 1, c.light);
  rect(g, 3, 22, 58, 1, c.dark);
  poly(g, [[18, 8], [38, 7], [44, 12], [42, 17], [16, 17], [14, 12]], c.hull);
  rect(g, 18, 8, 20, 1, c.light);
  rect(g, 16, 15, 26, 1, c.dark);
  rect(g, 24, 6, 6, 2, c.char); // portello aperto
  line(g, 24, 6, 21, 1, 2, c.dark);
  line(g, 43, 12, 59, 17, 2, c.dark); // cannone piegato verso terra
  rect(g, 58, 16, 3, 3, c.dark);
  // bruciature e fori
  for (let i = 0; i < 9; i++) disc(g, 4 + r() * 56, 9 + r() * 14, 1 + r() * 1.6, c.char);
  disc(g, 12, 20, 1.5, c.char);
  disc(g, 50, 19, 1.2, c.char);
  g.restore();
}

/** Elicottero di fianco col muso a destra, grande s (1 = 46 px). */
function drawHeli(g, s, cfg) {
  const P = (pts) => pts.map(([x, y]) => [M + x * s, M + y * s]);
  poly(g, P([[14, 8], [14, 12.5], [0, 10.5], [0, 8.5]]), cfg.body);
  poly(g, P([[0, 3], [3.5, 3], [5, 9], [0, 10.5]]), cfg.body);
  ellipseRows(g, M + 24 * s, M + 10.5 * s, 11.5 * s, 6.5 * s, cfg.body);
  ellipseRows(g, M + 31 * s, M + 9 * s, 5 * s, 3.6 * s, cfg.glass, -Infinity, M + 10 * s);
  rect(g, M + 19 * s, M + 3 * s, 10 * s, Math.max(1, 2 * s), cfg.body);
  rect(g, M + 24 * s, M + 1 * s, Math.max(1, s), Math.max(1, 2 * s), cfg.body);
  rect(g, M + 18 * s, M + 6.5 * s, 12 * s, Math.max(1, s), cfg.light);
  const sk = Math.max(1, Math.round(s));
  rect(g, M + 15 * s, M + 18 * s, 19 * s, sk, cfg.body);
  rect(g, M + 19 * s, M + 15.5 * s, sk, 3 * s, cfg.body);
  rect(g, M + 29 * s, M + 15.5 * s, sk, 3 * s, cfg.body);
}

/** Nuvola a pixel: dischi con il fondo piatto, illuminata dal basso (tramonto). */
function makeCloud(cfg, w, h) {
  const { c, g } = makeCanvas(w + 2, h + 2);
  const base = h;
  let x = 4;
  g.fillStyle = '#fff';
  while (x < w - 4) {
    const r = rnd(h * 0.3, h * 0.62) * (1 - Math.abs(x / w - 0.5) * 0.9);
    disc(g, x, base - r * 0.7, r, '#fff');
    x += rnd(r * 0.6, r * 1.2);
  }
  g.clearRect(0, base + 1, c.width, c.height);
  // colori per altezza: in basso illuminata, in alto in ombra (con dithering tra le fasce)
  const img = g.getImageData(0, 0, c.width, c.height);
  const d = img.data;
  const L = hex(cfg.lit);
  const Mi = hex(cfg.mid);
  const S = hex(cfg.shadow);
  let top = c.height;
  for (let y = 0; y < c.height && top === c.height; y++) for (let xx = 0; xx < c.width; xx++) if (d[(y * c.width + xx) * 4 + 3]) top = y;
  for (let y = 0; y < c.height; y++) {
    for (let xx = 0; xx < c.width; xx++) {
      const i = (y * c.width + xx) * 4;
      if (!d[i + 3]) continue;
      const t = (y - top) / Math.max(1, base - top); // 0 in alto, 1 in basso
      const b = bayer(xx, y);
      const col = t > 0.72 + b * 0.12 ? L : t > 0.3 + b * 0.18 ? Mi : S;
      d[i] = col[0];
      d[i + 1] = col[1];
      d[i + 2] = col[2];
      d[i + 3] = 255 * (cfg.alpha ?? 1);
    }
  }
  g.putImageData(img, 0, 0);
  return c;
}

// ---------- Scena ----------

export class MenuScene {
  constructor(canvas, cfg) {
    this.canvas = canvas;
    this.g = canvas.getContext('2d');
    this.cfg = cfg;
    this.wind = Math.sign(cfg.wind ?? -1) || -1;
    this.viewLeft = 0;
    this.visible = false;
    this.t = 0;
    this.raf = 0;
    this.warm = false;
    this.clouds = [];
    this.helis = [];
    this.flames = [];
    this.smoke = [];
    this.embers = [];
    this.sand = [];
    this.heliTimer = range(cfg.helicopter?.firstDelay, [2, 5]);
    this.cloudTimer = range(cfg.clouds?.interval, [6, 14]);
    this.glint = { timer: range(cfg.soldier?.glint, [4, 9]), on: 0 };
    this.heliCache = new Map();
    this._buildFlag();
    window.addEventListener('resize', () => {
      if (this.visible) this.resize();
    });
  }

  show() {
    if (this.visible) return;
    this.visible = true;
    this.canvas.classList.remove('hidden');
    this.resize();
    if (!this.warm) {
      // all'avvio fumo e fuoco sono già in corso
      this.warm = true;
      for (let i = 0; i < 160; i++) this.update(1 / 20);
    }
    let last = performance.now();
    const frame = (now) => {
      if (!this.visible) return;
      this.update(Math.min(0.1, (now - last) / 1000));
      last = now;
      this.render();
      this.raf = requestAnimationFrame(frame);
    };
    this.raf = requestAnimationFrame(frame);
  }

  hide() {
    this.visible = false;
    cancelAnimationFrame(this.raf);
    this.canvas.classList.add('hidden');
  }

  /** Larghezza in px CSS coperta dal pannello del menu a sinistra: la scena si centra nel resto. */
  setViewLeft(px) {
    if (Math.abs(px - this.viewLeft) < 1) return;
    this.viewLeft = px;
    if (this.visible) this._layout();
  }

  resize() {
    const cw = window.innerWidth;
    const ch = window.innerHeight;
    this.scale = Math.max(1, Math.floor(ch / (this.cfg.targetHeight ?? 190)));
    this.w = Math.ceil(cw / this.scale);
    this.h = Math.ceil(ch / this.scale);
    this.canvas.width = this.w;
    this.canvas.height = this.h;
    this.canvas.style.width = `${this.w * this.scale}px`;
    this.canvas.style.height = `${this.h * this.scale}px`;
    this.g.imageSmoothingEnabled = false;
    this.groundY = this.h - (this.cfg.groundHeight ?? 46);
    this._layout();
  }

  /** Posizioni (dipendono dalla parte visibile) e livelli statici: cielo con sole, dune, terreno, sprite. */
  _layout() {
    const cfg = this.cfg;
    const s = this.scale || 1;
    let vx0 = this.viewLeft / s;
    const minVis = cfg.minVisible ?? 200;
    if (this.w - vx0 < minVis) vx0 = Math.max(0, this.w - minVis);
    this.vx0 = vx0;
    this.fx = Math.round(vx0 + (this.w - vx0) * (cfg.focus ?? 0.5));
    const sun = cfg.sun || {};
    const r = sun.radius ?? 17;
    this.sunX = Math.round(clamp(this.fx + (sun.x ?? -80), vx0 + r + 4, this.w - r - 4));
    this.sunY = this.groundY + (sun.y ?? -12);
    this.sunDir = this.sunX < this.fx ? -1 : 1;
    this.soldierX = this.fx + (cfg.soldier?.x ?? 0);
    this.feetY = this.groundY + (cfg.soldier?.y ?? 30);
    this.tankX = this.fx + (cfg.tank?.x ?? 84);
    this.tankY = this.groundY + (cfg.tank?.y ?? 8);
    this._buildSky();
    this._buildDunes();
    this._buildGround();
    this._buildSprites();
  }

  // ---------- Livelli statici ----------

  _buildSky() {
    const { w, h, groundY } = this;
    const { c, g } = makeCanvas(w, h);
    const stops = (this.cfg.sky?.stops || [[0, '#41507e'], [1, '#ffd48a']]).map(([t, col]) => [t, hex(col)]);
    const at = (t) => {
      for (let i = 1; i < stops.length; i++) {
        if (t <= stops[i][0]) {
          const [t0, c0] = stops[i - 1];
          const [t1, c1] = stops[i];
          return mixRGB(c0, c1, (t - t0) / Math.max(1e-6, t1 - t0));
        }
      }
      return stops[stops.length - 1][1];
    };
    const LEVELS = 24;
    const pal = Array.from({ length: LEVELS }, (_, i) => at(i / (LEVELS - 1)));
    const sun = this.cfg.sun || {};
    const glow = hex(sun.glow || '#ffe2a4');
    const core = hex(sun.core || '#fff6d2');
    const edge = hex(sun.edge || '#ffd27a');
    const R = sun.radius ?? 17;
    const GR = sun.glowRadius ?? 70;
    const GS = sun.glowStrength ?? 0.5;
    const img = g.createImageData(w, h);
    const d = img.data;
    for (let y = 0; y < h; y++) {
      const t = clamp(y / Math.max(1, groundY), 0, 1) * (LEVELS - 1);
      const i0 = Math.floor(t);
      const f = t - i0;
      for (let x = 0; x < w; x++) {
        const b = bayer(x, y);
        let col = pal[Math.min(LEVELS - 1, f > b ? i0 + 1 : i0)];
        const dist = Math.hypot(x + 0.5 - this.sunX, y + 0.5 - this.sunY);
        if (dist < GR) {
          const k = (1 - dist / GR) ** 2 * GS;
          const q = Math.floor(k * 8 + b) / 8; // alone a fasce con dithering
          if (q > 0) col = mixRGB(col, glow, Math.min(1, q));
        }
        if (dist <= R) col = dist > R - 1.6 ? edge : mixRGB(core, edge, Math.max(0, (y - (this.sunY - R)) / (2 * R)) * 0.5);
        const k = (y * w + x) * 4;
        d[k] = col[0];
        d[k + 1] = col[1];
        d[k + 2] = col[2];
        d[k + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
    this.sky = c;
  }

  _ridge(def, x, salt) {
    let y = this.groundY - (def.base ?? 0) - (def.height ?? 10) / 2;
    (def.waves || []).forEach(([f, a], i) => {
      y -= Math.sin(x * f + salt * 1.7 + i * 2.1) * a;
    });
    return y;
  }

  _buildDunes() {
    const { w, h } = this;
    const dcfg = this.cfg.dunes || {};
    const layer = (def, salt, shaded) => {
      const { c, g } = makeCanvas(w, h);
      const col = def.color || '#9c6878';
      const light = def.light || col;
      const dark = def.dark || col;
      for (let x = 0; x < w; x++) {
        const top = Math.round(this._ridge(def, x, salt));
        const slope = this._ridge(def, x + 1, salt) - this._ridge(def, x - 1, salt);
        const lit = this.sunDir < 0 ? slope < 0.05 : slope > -0.05;
        rect(g, x, top, 1, h - top, col);
        rect(g, x, top, 1, lit ? 2 : 1, light);
        if (shaded && !lit) {
          // versante in ombra: puntinato scuro sotto la cresta
          for (let y = top + 2; y < top + 9; y++) if (bayer(x, y) < 0.5 - (y - top) * 0.05) rect(g, x, y, 1, 1, dark);
        }
      }
      return { c, g };
    };
    this.farDunes = layer(dcfg.far || {}, 1, false).c;
    const mid = layer(dcfg.mid || {}, 2, true);
    // rovine sulla duna di mezzo
    const r = mulberry32((this.cfg.seed ?? 1) + 5);
    for (const ru of dcfg.ruins || []) {
      const x0 = Math.round(this.fx + ru.x);
      const base = Math.round(this._ridge(dcfg.mid || {}, x0 + ru.w / 2, 2)) + 3;
      for (let i = 0; i < ru.w; i++) {
        const hh = Math.round(ru.h - (r() < 0.35 ? r() * ru.h * 0.6 : r() * 2));
        rect(mid.g, x0 + i, base - hh, 1, hh, dcfg.ruinColor || '#7e5048');
        if ((this.sunDir < 0 && i === 0) || (this.sunDir > 0 && i === ru.w - 1)) rect(mid.g, x0 + i, base - hh, 1, hh, dcfg.ruinLight || '#a46a58');
      }
      if (ru.w > 12) rect(mid.g, x0 + Math.round(ru.w / 3), base - Math.round(ru.h * 0.6), 3, 4, this.cfg.dunes?.far?.color || '#9c6878');
    }
    this.midDunes = mid.c;
  }

  _buildGround() {
    const { w, h, groundY } = this;
    const gc = this.cfg.ground || {};
    const { c, g } = makeCanvas(w, h);
    const r = mulberry32((this.cfg.seed ?? 1) + 9);
    const base = hex(gc.color || '#c08658');
    const dark = hex(gc.dark || '#9c6a48');
    for (let x = 0; x < w; x++) {
      const top = Math.round(groundY + Math.sin(x * 0.05) * 1.5 + Math.sin(x * 0.13 + 1) * 0.8);
      for (let y = top; y < h; y++) {
        const t = (y - top) / Math.max(1, h - top);
        const col = t * 0.9 > bayer(x, y) + 0.35 ? dark : base;
        rect(g, x, y, 1, 1, css(col));
      }
      rect(g, x, top, 1, 1, gc.light || '#d8a068');
      if (r() < 0.3) rect(g, x, top + 1 + Math.floor(r() * (h - top)), 1, 1, r() < 0.5 ? gc.light || '#d8a068' : gc.dark || '#9c6a48');
    }
    // sassi e ciuffi d'erba secca
    for (let x = 0; x < w; x++) {
      if (r() < (gc.stones ?? 0.012)) {
        const y = groundY + 3 + Math.floor(r() * (h - groundY - 5));
        const sw = 2 + Math.floor(r() * 3);
        rect(g, x, y, sw, 2, gc.stone || '#7a5e4a');
        rect(g, x, y, sw - 1, 1, gc.stoneLight || '#b49a7a');
      }
      if (r() < (gc.tufts ?? 0.006)) {
        const y = groundY + 2 + Math.floor(r() * (h - groundY - 4));
        for (let k = -2; k <= 2; k++) rect(g, x + k, y - (2 - Math.abs(k)) - 1, 1, 3 - Math.abs(k) + 1, gc.grass || '#6e6234');
      }
    }
    this.ground = c;
  }

  _buildSprites() {
    const cfg = this.cfg;
    const sc = cfg.soldier || {};
    const colors = sc.colors || {};
    const key = `${this.sunDir}`;
    if (this._spriteKey === key) return;
    this._spriteKey = key;
    const noise = blobNoise((cfg.seed ?? 1) + 3, 3.2);
    this.soldierFrames = [0, 1].map((oy) => {
      const { c, g } = makeCanvas(60 + M * 2, 92 + M * 2);
      drawSoldier(g, colors, oy);
      camouflage(c, colors.camo, colors.camoSpots || [colors.camo], noise, (x, y) => (y < 52 + M + oy ? y - oy : y));
      finish(c, { tint: sc.shade?.color, tintAmount: sc.shade?.amount ?? 0, rim: sc.rim, rimAmount: sc.rimAmount ?? 0.6, rimDir: this.sunDir, outline: sc.outline });
      return c;
    });
    const tc = cfg.tank || {};
    const tank = makeCanvas(66 + M * 2, 34 + M * 2);
    drawTank(tank.g, tc.colors || {}, (cfg.seed ?? 1) + 7);
    finish(tank.c, { rim: tc.rim, rimAmount: 0.45, rimDir: tc.flip ? -this.sunDir : this.sunDir, outline: sc.outline });
    this.tank = tank.c;
  }

  _buildFlag() {
    const f = this.cfg.flag || {};
    const W = f.width ?? 46;
    const H = f.height ?? 26;
    const r = mulberry32((this.cfg.seed ?? 1) + 13);
    const len = new Array(H);
    let row = 0;
    while (row < H) {
      // strisce di 1-3 righe con lunghezze diverse: bordo libero a brandelli
      const n = 1 + Math.floor(r() * 3);
      let l = W - Math.floor(r() * (f.tatter ?? 10));
      if (r() < 0.15) l = W + 2; // un brandello più lungo
      for (let k = 0; k < n && row < H; k++, row++) len[row] = l - (row >= H - 3 ? Math.floor(r() * 8) + 3 : 0) - (k === n - 1 ? Math.floor(r() * 2) : 0);
    }
    const hole = new Set();
    for (let i = 0; i < (f.holes ?? 8); i++) {
      const hc = 6 + Math.floor(r() * (W - 14));
      const hr = 2 + Math.floor(r() * (H - 4));
      hole.add(`${hr},${hc}`);
      if (r() < 0.6) hole.add(`${hr},${hc + 1}`);
      if (r() < 0.4) hole.add(`${hr + 1},${hc}`);
    }
    const burnt = new Set();
    for (const k of hole) {
      const [hr, hc] = k.split(',').map(Number);
      for (const [dr, dc] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) if (!hole.has(`${hr + dr},${hc + dc}`)) burnt.add(`${hr + dr},${hc + dc}`);
    }
    for (let rr = 0; rr < H; rr++) if (r() < 0.6) burnt.add(`${rr},${len[rr] - 1}`);
    this.flag = { W, H, len, hole, burnt };
  }

  // ---------- Aggiornamento ----------

  update(dt) {
    const cfg = this.cfg;
    this.t += dt;
    if (!this.w) return;
    const wind = this.wind;

    // nuvole
    const cc = cfg.clouds || {};
    if (!this._cloudsInit) {
      this._cloudsInit = true;
      for (let i = 0; i < (cc.initial ?? 3); i++) this._spawnCloud(rnd(this.vx0, this.w));
    }
    this.cloudTimer -= dt;
    if (this.cloudTimer <= 0) {
      this.cloudTimer = range(cc.interval, [6, 14]);
      if (this.clouds.length < (cc.max ?? 6)) this._spawnCloud(wind < 0 ? this.w + 2 : -80);
    }
    for (const c of this.clouds) c.x += c.v * wind * dt;
    this.clouds = this.clouds.filter((c) => c.x > -c.img.width - 4 && c.x < this.w + 90);

    // elicottero
    const hc = cfg.helicopter || {};
    this.heliTimer -= dt;
    if (this.heliTimer <= 0) {
      this.heliTimer = range(hc.interval, [8, 20]);
      this._spawnHeli();
    }
    for (const hl of this.helis) hl.x += hl.v * hl.dir * dt;
    this.helis = this.helis.filter((hl) => hl.x > -80 && hl.x < this.w + 80);

    // fuoco, fumo e scintille del carro armato
    const tc = cfg.tank || {};
    const fire = tc.fire || {};
    const emitters = (fire.emitters || [[27, 5]]).map(([x, y]) => this._tankPoint(x, y));
    this._fireAcc = (this._fireAcc || 0) + dt * (fire.rate ?? 26);
    while (this._fireAcc >= 1 && this.flames.length < (fire.max ?? 220)) {
      this._fireAcc -= 1;
      const e = emitters[Math.floor(Math.random() * emitters.length)];
      const big = e === emitters[0];
      this.flames.push({ x: e.x + rnd(-(fire.spread ?? 3), fire.spread ?? 3), y: e.y, vx: rnd(-4, 4), vy: -range(fire.speed, [14, 30]) * (big ? 1 : 0.6), age: 0, life: range(fire.life, [0.3, 0.7]) * (big ? 1 : 0.7) });
    }
    if (this._fireAcc > 1) this._fireAcc = 0;
    for (const p of this.flames) {
      p.age += dt;
      p.x += (p.vx + wind * 4) * dt;
      p.y += p.vy * dt;
    }
    this.flames = this.flames.filter((p) => p.age < p.life);

    const sm = tc.smoke || {};
    this._smokeAcc = (this._smokeAcc || 0) + dt * (sm.rate ?? 7);
    while (this._smokeAcc >= 1 && this.smoke.length < (sm.max ?? 160)) {
      this._smokeAcc -= 1;
      const e = emitters[Math.random() < 0.7 ? 0 : Math.floor(Math.random() * emitters.length)];
      const [s0, s1] = sm.size || [2, 9];
      this.smoke.push({ x: e.x + rnd(-2, 2), y: e.y - 5, vx: rnd(-2, 2), vy: -range(sm.speed, [8, 14]), age: 0, life: range(sm.life, [6, 10]), r0: s0 * rnd(0.8, 1.2), r1: s1 * rnd(0.7, 1.2) });
    }
    if (this._smokeAcc > 1) this._smokeAcc = 0;
    for (const p of this.smoke) {
      p.age += dt;
      const k = p.age / p.life;
      p.x += (p.vx + wind * (sm.drift ?? 9) * Math.min(1, k * 2.2)) * dt;
      p.y += p.vy * (1 - k * 0.5) * dt;
    }
    this.smoke = this.smoke.filter((p) => p.age < p.life);

    const em = tc.embers || {};
    if (Math.random() < dt * (em.rate ?? 3)) {
      const e = emitters[0];
      this.embers.push({ x: e.x, y: e.y - 2, vx: rnd(-6, 6), vy: -range(em.speed, [18, 34]), age: 0, life: range(em.life, [1, 2.2]) });
    }
    for (const p of this.embers) {
      p.age += dt;
      p.x += (p.vx + wind * 10 * (p.age / p.life)) * dt + Math.sin(this.t * 9 + p.life * 10) * 0.15;
      p.y += p.vy * dt;
      p.vy *= 1 - dt * 0.6;
    }
    this.embers = this.embers.filter((p) => p.age < p.life);

    // sabbia sollevata dal vento
    const sd = cfg.sand || {};
    if (Math.random() < dt * (sd.rate ?? 9) && this.sand.length < (sd.max ?? 60)) {
      this.sand.push({ x: wind < 0 ? this.w + 1 : this.vx0 - 1, y: this.groundY + rnd(-4, this.h - this.groundY), v: range(sd.speed, [40, 85]), ph: Math.random() * 6 });
    }
    for (const p of this.sand) {
      p.x += p.v * wind * dt;
      p.y += Math.sin(this.t * 3 + p.ph) * 4 * dt;
    }
    this.sand = this.sand.filter((p) => p.x > this.vx0 - 4 && p.x < this.w + 4);

    // riflesso sugli occhiali
    const gl = this.glint;
    gl.on = Math.max(0, gl.on - dt);
    gl.timer -= dt;
    if (gl.timer <= 0) {
      gl.timer = range(cfg.soldier?.glint, [4, 9]);
      gl.on = 0.18;
    }
  }

  _spawnCloud(x) {
    const cc = this.cfg.clouds || {};
    const w = Math.round(range(cc.width, [30, 72]));
    const h = Math.round(range(cc.height, [9, 18]));
    const img = makeCloud(cc, w, h);
    const [y0, y1] = cc.yRange || [0.05, 0.45];
    this.clouds.push({ img, x, y: Math.round(this.groundY * rnd(y0, y1)), v: range(cc.speed, [2.5, 6]) * (0.6 + (w / 72) * 0.6) });
  }

  _spawnHeli() {
    const hc = this.cfg.helicopter || {};
    const s = Math.round(range(hc.size, [0.45, 1]) * 20) / 20;
    const dir = Math.random() < 0.5 ? 1 : -1;
    const sprite = this._heliSprite(s, dir);
    const [y0, y1] = hc.yRange || [0.1, 0.48];
    this.helis.push({
      s,
      dir,
      sprite,
      x: dir > 0 ? Math.min(this.vx0, this.w - 200) - sprite.width - 4 : this.w + 4,
      y: Math.round(this.groundY * rnd(y0, y1)),
      v: range(hc.speed, [26, 48]) * (0.5 + s * 0.5),
      ph: Math.random() * 6,
    });
  }

  _heliSprite(s, dir) {
    const key = `${s}:${dir}`;
    if (this.heliCache.has(key)) return this.heliCache.get(key);
    const hc = this.cfg.helicopter || {};
    const { c, g } = makeCanvas(46 * s + M * 2 + 2, 20 * s + M * 2 + 2);
    drawHeli(g, s, hc);
    finish(c, { rim: s > 0.7 ? hc.rim : null, rimAmount: 0.35, rimDir: this.sunDir * dir, tint: hc.haze, tintAmount: (1 - s) * 0.75 });
    let out = c;
    if (dir < 0) {
      const f = makeCanvas(c.width, c.height);
      f.g.scale(-1, 1);
      f.g.drawImage(c, -c.width, 0);
      out = f.c;
    }
    this.heliCache.set(key, out);
    return out;
  }

  /** Punto dello sprite del carro (coordinate senza margine, muso a destra) in coordinate della scena. */
  _tankPoint(x, y) {
    const flip = !!this.cfg.tank?.flip;
    const W = this.tank?.width ?? 70;
    const H = this.tank?.height ?? 38;
    const lx = flip ? W - (x + M) : x + M;
    return { x: Math.round(this.tankX - W / 2 + lx), y: Math.round(this.tankY - H + y + M) };
  }

  // ---------- Disegno ----------

  render() {
    const { g, cfg } = this;
    if (!this.sky) return;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';
    g.drawImage(this.sky, 0, 0);

    for (const c of this.clouds) g.drawImage(c.img, Math.round(c.x), c.y);

    const hc = cfg.helicopter || {};
    for (const hl of this.helis) {
      const x = Math.round(hl.x);
      const y = Math.round(hl.y + Math.sin(this.t * 2 + hl.ph) * 1.2);
      g.drawImage(hl.sprite, x, y);
      // rotore principale (alternanza di due fotogrammi) e di coda
      const s = hl.s;
      const mx = x + M + (hl.dir > 0 ? 24 : 46 - 24) * s;
      const my = y + M + Math.max(0, Math.round(1 * s) - 1);
      const half = 23 * s;
      g.fillStyle = hc.rotor || 'rgba(26,30,36,0.5)';
      if (Math.floor(this.t * 24) % 2) g.fillRect(Math.round(mx - half), my, Math.round(half * 2), 1);
      else {
        g.fillRect(Math.round(mx - half), my, Math.round(half * 0.8), 1);
        g.fillRect(Math.round(mx + half * 0.2), my, Math.round(half * 0.8), 1);
      }
      const tx = x + M + (hl.dir > 0 ? 1.5 : 44.5) * s;
      const ty = y + M + 4 * s;
      g.globalAlpha = Math.floor(this.t * 20) % 2 ? 0.55 : 0.3;
      disc(g, tx, ty, Math.max(1, 3 * s), hc.body || '#2a2e34');
      g.globalAlpha = 1;
    }

    g.drawImage(this.farDunes, 0, 0);
    g.drawImage(this.midDunes, 0, 0);
    g.drawImage(this.ground, 0, 0);

    // carro armato con bagliore del fuoco
    const tc = cfg.tank || {};
    const glow = tc.glow || {};
    const hatch = this._tankPoint(...((tc.fire?.emitters || [[27, 5]])[0]));
    g.globalCompositeOperation = 'lighter';
    const fl = 1 + (Math.sin(this.t * 13) * 0.5 + Math.sin(this.t * 7.3) * 0.5) * (glow.flicker ?? 0.35);
    const gr = glow.radius ?? 26;
    for (const k of [1, 0.66, 0.36]) {
      g.globalAlpha = (glow.alpha ?? 0.14) * fl;
      disc(g, hatch.x, hatch.y + 4, gr * k, glow.color || '#ff9440');
    }
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';
    const tw = this.tank.width;
    const th = this.tank.height;
    const tx = Math.round(this.tankX - tw / 2);
    const ty = Math.round(this.tankY - th);
    if (tc.flip) {
      g.save();
      g.translate(tx + tw, ty);
      g.scale(-1, 1);
      g.drawImage(this.tank, 0, 0);
      g.restore();
    } else g.drawImage(this.tank, tx, ty);

    // fumo: sbuffi pieni (prima i più vecchi, in alto), lato verso il sole più chiaro; si dissolvono alla fine
    const sm = tc.smoke || {};
    const sc0 = hex(sm.color || '#342c2a');
    const sc1 = hex(sm.light || '#8a7672');
    const shl = hex(sm.highlight || '#b48a7c');
    for (let i = 0; i < this.smoke.length; i++) {
      const p = this.smoke[i];
      const k = p.age / p.life;
      const r = p.r0 + (p.r1 - p.r0) * Math.sqrt(k);
      const col = mixRGB(sc0, sc1, k);
      g.globalAlpha = k > 0.8 ? 1 - (k - 0.8) / 0.2 : 1;
      disc(g, p.x + this.sunDir, p.y - 1, r, css(mixRGB(col, shl, 0.55)));
      disc(g, p.x, p.y, r, css(col));
    }
    g.globalAlpha = 1;
    // fiamme: un corpo pieno che tremola sopra ogni punto in fiamme + lingue che salgono
    const fire = tc.fire || {};
    const fcols = fire.colors || ['#fff6c4', '#ffd848', '#ff9a28', '#e04a14', '#7a2a14'];
    const bodies = fire.bodies || [[7, 13]];
    (fire.emitters || [[27, 4]]).forEach(([ex, ey], n) => {
      const e = this._tankPoint(ex, ey);
      const [bw, bh] = bodies[n] || bodies[bodies.length - 1];
      const fh = bh * (0.85 + 0.15 * Math.sin(this.t * 11 + n * 2));
      for (let dy = 0; dy < fh; dy++) {
        const k = dy / fh;
        const hw = (bw / 2) * (1 - k * k) * (0.8 + 0.2 * Math.sin(this.t * 17 + dy * 1.3 + n));
        const sway = Math.round(Math.sin(this.t * 6 + dy * 0.5 + n) * k * 1.5 + this.wind * k * 2);
        g.fillStyle = fcols[Math.min(fcols.length - 2, Math.floor(k * (fcols.length - 1) + 0.3))];
        g.fillRect(Math.round(e.x - hw) + sway, e.y - dy, Math.max(1, Math.round(hw * 2)), 1);
      }
    });
    for (const p of this.flames) {
      const k = p.age / p.life;
      const w = k < 0.4 ? 2 : 1;
      const h = k < 0.3 ? 4 : k < 0.65 ? 3 : 1;
      g.fillStyle = fcols[Math.min(fcols.length - 1, Math.floor(k * fcols.length))];
      g.fillRect(Math.round(p.x - w / 2), Math.round(p.y - h / 2), w, h);
    }
    g.fillStyle = tc.embers?.color || '#ffb048';
    for (const p of this.embers) if (Math.sin(this.t * 25 + p.life * 40) > -0.3) g.fillRect(Math.round(p.x), Math.round(p.y), 1, 1);

    this._drawFlag();

    // soldato (respira: due fotogrammi)
    const sc = cfg.soldier || {};
    const period = sc.breath ?? 3.4;
    const oy = this.t % period > period * 0.55 ? 1 : 0;
    const spr = this.soldierFrames[oy];
    const sx = Math.round(this.soldierX - 28 - M);
    const sy = Math.round(this.feetY - 90 - M);
    this._drawScarf(sx, sy, oy, sc.colors || {}, sc.outline);
    g.drawImage(spr, sx, sy);
    if (this.glint.on > 0) {
      const gx = sx + M + 21;
      const gy = sy + M + 6 + oy;
      g.fillStyle = '#ffffff';
      g.fillRect(gx, gy - 2, 1, 5);
      g.fillRect(gx - 2, gy, 5, 1);
    }

    // sabbia in primo piano
    g.fillStyle = cfg.sand?.color || 'rgba(255,228,176,0.55)';
    for (const p of this.sand) g.fillRect(Math.round(p.x), Math.round(p.y), 2, 1);
  }

  /** Bandiera a brandelli: colonna per colonna con un'onda che cresce verso il bordo libero. */
  _drawFlag() {
    const { g } = this;
    const f = this.cfg.flag || {};
    const fl = this.flag;
    const wave = f.wave || {};
    const cols = f.colors || ['#6e1610', '#9c2218', '#c8301f', '#e8523a'];
    const px = Math.round(this.soldierX + (f.x ?? 17));
    const base = this.feetY - 4;
    const top = base - (f.poleHeight ?? 124);
    rect(g, px, top, 2, base - top, f.pole || '#4e4034');
    rect(g, this.sunDir < 0 ? px : px + 1, top, 1, base - top, f.poleLight || '#a69276');
    rect(g, px - 1, top - 2, 4, 2, f.finial || '#d8b060');
    const dir = this.wind;
    const W = Math.max(...fl.len) + 1;
    for (let c = 0; c < W; c++) {
      const ph = this.t * (wave.speed ?? 5.2) - c * (wave.length ?? 0.3);
      const amp = (wave.amplitude ?? 3.4) * Math.pow(c / fl.W, 0.8);
      const dy = Math.round(Math.sin(ph) * amp + (c / fl.W) * 2);
      const shade = clamp(Math.round(1.6 + Math.cos(ph) * 1.6 * Math.min(1, c / 6 + 0.2)), 0, cols.length - 1);
      const x = px + (dir < 0 ? -1 - c : 2 + c);
      for (let r = 0; r < fl.H; r++) {
        if (c >= fl.len[r]) continue;
        const k = `${r},${c}`;
        if (fl.hole.has(k)) continue;
        g.fillStyle = fl.burnt.has(k) ? f.burnt || '#38100c' : cols[shade];
        g.fillRect(x, top + 1 + r + dy, 1, 1);
      }
    }
  }

  /** Coda della kefiah mossa dal vento. */
  _drawScarf(sx, sy, oy, c, outline) {
    const { g } = this;
    const dir = this.wind;
    const ax = sx + M + (dir < 0 ? 19 : 33);
    const ay = sy + M + 23 + oy;
    for (let i = 0; i < 10; i++) {
      const x = ax + dir * (i + 1);
      const y = Math.round(ay + i * 0.35 + Math.sin(this.t * 9 - i * 0.9) * i * 0.22);
      const h = i < 6 ? 3 : 2;
      rect(g, x, y - 1, 1, h + 2, outline || '#1c120e');
      rect(g, x, y, 1, h, i % 3 === 1 ? c.scarfDark || '#a8987a' : c.scarf || '#d8caa8');
    }
  }
}
