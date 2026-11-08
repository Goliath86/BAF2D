// Disegni a pixel della scena del menu (js/menu_scene.js): primitive senza antialiasing, rifiniture
// (mimetica, ombre, luce di controluce, contorno) e gli sprite procedurali: soldato a mezzo busto,
// carro armato distrutto, elicottero d'attacco (Apache), nuvole. Colori in config/menu_scene.json.

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
export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export function hex(c) {
  const h = String(c).replace('#', '');
  const n = parseInt(h.length === 3 ? h.replace(/./g, '$&$&') : h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
export const mixRGB = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
export const css = (c) => `rgb(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])})`;

export function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.ceil(w));
  c.height = Math.max(1, Math.ceil(h));
  const g = c.getContext('2d', { willReadFrequently: true });
  g.imageSmoothingEnabled = false;
  return { c, g };
}

// ---------- Primitive a pixel ----------

export function rect(g, x, y, w, h, color) {
  g.fillStyle = color;
  g.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
}

export function disc(g, cx, cy, r, color) {
  g.fillStyle = color;
  const ir = Math.ceil(r);
  for (let dy = -ir; dy <= ir; dy++) {
    const k = r * r - dy * dy;
    if (k < 0) continue;
    const hw = Math.floor(Math.sqrt(k) + 0.25);
    g.fillRect(Math.round(cx) - hw, Math.round(cy) + dy, hw * 2 + 1, 1);
  }
}

/** Righe di un'ellisse, solo tra yMin e yMax. */
export function ellipseRows(g, cx, cy, rx, ry, color, yMin = -Infinity, yMax = Infinity) {
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

/** Poligono pieno (scanline, pari-dispari). */
export function poly(g, pts, color) {
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

/** Linea spessa w pixel. */
export function line(g, x0, y0, x1, y1, w, color) {
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

/** Arto: quadrilatero tra due punti con larghezze w0 e w1. */
export function limb(g, x0, y0, x1, y1, w0, w1, color) {
  const len = Math.hypot(x1 - x0, y1 - y0) || 1;
  const nx = -(y1 - y0) / len;
  const ny = (x1 - x0) / len;
  poly(g, [[x0 + nx * w0 / 2, y0 + ny * w0 / 2], [x1 + nx * w1 / 2, y1 + ny * w1 / 2], [x1 - nx * w1 / 2, y1 - ny * w1 / 2], [x0 - nx * w0 / 2, y0 - ny * w0 / 2]], color);
}

/** Rumore a macchie stabile 0..1. */
export function blobNoise(seed, cell) {
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

/** Ricolora i pixel di colore esatto "base" con fn(x, y) -> [r,g,b] | null. */
export function recolor(canvas, base, fn) {
  const g = canvas.getContext('2d', { willReadFrequently: true });
  const img = g.getImageData(0, 0, canvas.width, canvas.height);
  const d = img.data;
  const B = hex(base);
  for (let y = 0; y < canvas.height; y++) {
    for (let x = 0; x < canvas.width; x++) {
      const i = (y * canvas.width + x) * 4;
      if (d[i + 3] === 0 || d[i] !== B[0] || d[i + 1] !== B[1] || d[i + 2] !== B[2]) continue;
      const c = fn(x, y);
      if (c) {
        d[i] = c[0];
        d[i + 1] = c[1];
        d[i + 2] = c[2];
      }
    }
  }
  g.putImageData(img, 0, 0);
}

/** Mimetica a macchie sui pixel di colore "base" (spots: 2-4 colori). */
export function camouflage(canvas, base, spots, noise, shift = (x, y) => y) {
  const S = spots.map(hex);
  recolor(canvas, base, (x, y0) => {
    const y = shift(x, y0);
    const v = noise(x, y);
    const w = noise(x + 37, y + 11);
    const u = noise(x * 1.7 + 71, y * 1.7 + 5);
    if (v < 0.3) return S[0];
    if (w < 0.24) return S[1 % S.length];
    if (v > 0.74) return S[2 % S.length];
    if (S[3] && u < 0.2) return S[3];
    return null;
  });
}

/** Ombre e luci dipinte su maschere (alpha = intensità) applicate allo sprite. */
function applyMasks(canvas, shadowMask, lightMask, shadowColor, lightColor) {
  const W = canvas.width;
  const H = canvas.height;
  const g = canvas.getContext('2d', { willReadFrequently: true });
  const img = g.getImageData(0, 0, W, H);
  const d = img.data;
  const sm = shadowMask.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, W, H).data;
  const lm = lightMask.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, W, H).data;
  const S = hex(shadowColor);
  const L = hex(lightColor);
  for (let i = 0; i < d.length; i += 4) {
    if (!d[i + 3]) continue;
    let c = [d[i], d[i + 1], d[i + 2]];
    if (sm[i + 3]) c = mixRGB(c, S, sm[i + 3] / 255);
    if (lm[i + 3]) c = mixRGB(c, L, lm[i + 3] / 255);
    d[i] = c[0];
    d[i + 1] = c[1];
    d[i + 2] = c[2];
  }
  g.putImageData(img, 0, 0);
}

/**
 * Rifinitura: tinta (tint), luce sul lato del sole larga rimWidth px (rimDir -1 = sinistra, +1 = destra; più
 * debole in alto), contorno di 1 px (outline). Lo sprite deve avere un margine trasparente.
 */
export function finish(canvas, { tint, tintAmount = 0, rim, rimAmount = 0.6, rimDir = 0, rimWidth = 1, outline }) {
  const W = canvas.width;
  const H = canvas.height;
  const g = canvas.getContext('2d', { willReadFrequently: true });
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
          let side = 0;
          if (rimDir) for (let k = 1; k <= rimWidth && !side; k++) if (!a(x + rimDir * k, y)) side = k;
          const top = !a(x, y - 1);
          if (side) c = mixRGB(c, R, rimAmount * (side === 1 ? 1 : 0.5));
          else if (top) c = mixRGB(c, R, rimAmount * 0.45);
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

/** Aggiunge un contorno di 1 px (colore color) attorno ai pixel pieni di un livello. */
function outlineLayer(canvas, color) {
  const W = canvas.width;
  const H = canvas.height;
  const g = canvas.getContext('2d', { willReadFrequently: true });
  const img = g.getImageData(0, 0, W, H);
  const d = img.data;
  const src = new Uint8ClampedArray(d);
  const a = (x, y) => (x < 0 || y < 0 || x >= W || y >= H ? 0 : src[(y * W + x) * 4 + 3]);
  const O = hex(color);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      if (src[i + 3] || !(a(x - 1, y) || a(x + 1, y) || a(x, y - 1) || a(x, y + 1))) continue;
      d[i] = O[0];
      d[i + 1] = O[1];
      d[i + 2] = O[2];
      d[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
}

// ---------- Soldato a mezzo busto (primo piano) ----------

export const BUST = { w: 240, h: 300, margin: 3 };

/** Punti di una curva quadratica (p0 -> p2, controllo p1). */
function quad(p0, p1, p2, n = 18) {
  const out = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const a = (1 - t) * (1 - t);
    const b = 2 * (1 - t) * t;
    const cc = t * t;
    out.push([a * p0[0] + b * p1[0] + cc * p2[0], a * p0[1] + b * p1[1] + cc * p2[1]]);
  }
  return out;
}

/** Punto dentro un poligono (pari-dispari). */
export function insidePoly(pts, x, y) {
  let ins = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i];
    const [xj, yj] = pts[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) ins = !ins;
  }
  return ins;
}

/** Lenti degli occhiali (coordinate dello sprite senza margine): servono anche al riflesso animato. */
export const BUST_LENSES = [
  [[79, 109], [117, 109], [117, 125], [112, 131], [84, 131], [79, 125]],
  [[123, 109], [161, 109], [161, 125], [156, 131], [128, 131], [123, 125]],
];

/**
 * Ritratto a mezzo busto, visto di fronte, luce calda da sinistra: elmetto con copertura in mimetica digitale,
 * slitta del visore, pannelli a velcro, binari laterali ed elastici; cuffie con microfono e cavi; occhiali
 * avvolgenti col tramonto riflesso; sopracciglia aggrottate, rughe, barba e baffi a ciocche; kefiah con trama e
 * pieghe; spallacci con fettucce MOLLE, radio con antenna, laccio emostatico, caricatori; fucile in primo piano
 * con calcio, castello, mirino olografico, slitte, torcia; guanti con paranocche. Restituisce il canvas rifinito.
 */
export function buildBust(sc, sunDir, seed) {
  const c = sc.colors || {};
  const M = BUST.margin;
  const W = BUST.w + M * 2;
  const H = BUST.h + M * 2;
  const main = makeCanvas(W, H);
  const shade = makeCanvas(W, H);
  const light = makeCanvas(W, H);
  for (const k of [main, shade, light]) k.g.translate(M, M);
  let g = main.g;
  let sg = shade.g;
  let lg = light.g;
  const r = mulberry32(seed);
  const A = (a) => `rgba(0,0,0,${a})`;
  const S = (pts, a = 0.5) => poly(sg, pts, A(a));
  const Sr = (x, y, w, h, a = 0.5) => rect(sg, x, y, w, h, A(a));
  const Sl = (x0, y0, x1, y1, w = 1, a = 0.5) => line(sg, x0, y0, x1, y1, w, A(a));
  const Sp = (pts, w = 1, a = 0.5) => {
    for (let i = 0; i + 1 < pts.length; i++) line(sg, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], w, A(a));
  };
  const L = (pts, a = 0.35) => poly(lg, pts, A(a));
  const Lr = (x, y, w, h, a = 0.35) => rect(lg, x, y, w, h, A(a));
  const Ll = (x0, y0, x1, y1, w = 1, a = 0.35) => line(lg, x0, y0, x1, y1, w, A(a));
  const Lp = (pts, w = 1, a = 0.35) => {
    for (let i = 0; i + 1 < pts.length; i++) line(lg, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], w, A(a));
  };
  const path = (pts, w, col) => {
    for (let i = 0; i + 1 < pts.length; i++) line(g, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], w, col);
  };
  const mirrorX = (pts) => pts.map(([x, y]) => [240 - x, y]);
  let ty = 0; // spostamento verticale delle parti in corso (fucile e mani)
  /** Disegna fn spostato in basso di d px (parti e maschere di ombra/luce). */
  const shiftY = (d, fn) => {
    ty += d;
    sg.save();
    lg.save();
    sg.translate(0, d);
    lg.translate(0, d);
    fn();
    sg.restore();
    lg.restore();
    ty -= d;
  };
  /**
   * Parte su un livello a sé: colori, texture (mimetica, trame, barba...), ombre e luci proprie (le chiamate
   * S/L dentro fn valgono solo per questa parte), poi un contorno interno e l'incollaggio sul resto.
   */
  const part = (fn, outline = c.inline || '#3a281c') => {
    const Lc = makeCanvas(W, H);
    const Ls = makeCanvas(W, H);
    const Ll = makeCanvas(W, H);
    for (const k of [Lc, Ls, Ll]) k.g.translate(M, M + ty);
    const prev = [g, sg, lg];
    [g, sg, lg] = [Lc.g, Ls.g, Ll.g];
    fn();
    [g, sg, lg] = prev;
    textures(Lc.c);
    applyMasks(Lc.c, Ls.c, Ll.c, sc.shadowColor || '#2a1630', sc.lightColor || '#ffd8a0');
    outlineLayer(Lc.c, outline);
    main.g.save();
    main.g.setTransform(1, 0, 0, 1, 0, 0);
    main.g.drawImage(Lc.c, 0, 0);
    main.g.restore();
  };

  // ===== texture (applicate a ogni parte): mimetica digitale, trama della kefiah, barba a ciocche, pelle, lenti =====
  const textures = (cv) => {
    const camoN = blobNoise(seed + 3, 7);
    const helmN = blobNoise(seed + 5, 6);
    const digital = (noise, spots) => {
      const Sx = spots.map(hex);
      return (x, y) => {
        const bx = Math.floor(x / 3) * 3;
        const by = Math.floor(y / 3) * 3;
        const v = noise(bx, by);
        const w = noise(bx + 53, by + 17);
        if (v < 0.3) return Sx[0];
        if (w < 0.26) return Sx[1 % Sx.length];
        if (v > 0.72) return Sx[2 % Sx.length];
        return null;
      };
    };
    recolor(cv, c.camo, digital(camoN, c.camoSpots || [c.camo]));
    recolor(cv, c.helmet, digital(helmN, c.helmetSpots || [c.helmet]));
    const scN = blobNoise(seed + 11, 5);
    const scDark = hex(c.scarfPattern);
    const scMid = hex(c.scarfDark);
    const scLight = hex(c.scarfLight || c.scarf);
    recolor(cv, c.scarf, (x, y) => {
      const bx = Math.floor(x / 4);
      const by = Math.floor(y / 4);
      const v = scN(bx * 4, by * 4);
      if (v < 0.28 || ((bx + by * 2) % 7 === 0 && v < 0.5)) return scDark;
      if (v > 0.7) return scMid;
      return (x + y) % 3 === 0 ? scLight : null;
    });
    const hairN = blobNoise(seed + 13, 2);
    const BD = hex(c.beardDark);
    const BL = hex(c.beardLight);
    const BH = hex(c.beardHighlight || c.beardLight);
    const MD = hex(c.mustacheDark || c.beardDark);
    const strands = (x, y, dark, mid, lightC) => {
      const v = hairN(x * 2.4, y * 0.45);
      const w = hairN(x * 2.4 + 40, y * 0.45 + 9);
      if (v < 0.32) return dark;
      if (v > 0.8) return lightC;
      if (w > 0.78) return BH;
      return mid;
    };
    recolor(cv, c.beard, (x, y) => strands(x, y, BD, hex(c.beard), BL));
    recolor(cv, c.mustache, (x, y) => strands(x, y, MD, hex(c.mustache), BL));
    const skinN = blobNoise(seed + 17, 1.3);
    const SKM = hex(c.skinMid);
    recolor(cv, c.skin, (x, y) => (skinN(x, y) < 0.18 ? SKM : null));
    const lens = (c.lens || ['#2a2038', '#4a2a4c', '#8a3a56', '#c8564c', '#f08a52', '#ffc272']).map(hex);
    const GL = hex(c.glintSoft || '#ffd0a8');
    recolor(cv, c.lensMark, (x, y0) => {
      const y = y0 - M;
      const t = clamp((y - 109) / 22, 0, 0.999);
      let col = lens[Math.floor(t * lens.length)];
      if (t > 0.6 && t < 0.7) col = mixRGB(col, lens[0], 0.6); // riflesso dell'orizzonte
      const d = (x - M - y * 0.7 + 400) % 34;
      if (t < 0.55 && d < 3) col = mixRGB(col, GL, 0.55);
      if (bayer(x, y0) < 0.25 && t > 0.2 && t < 0.6) col = mixRGB(col, lens[Math.min(lens.length - 1, Math.floor(t * lens.length) + 1)], 0.5);
      return col;
    });
  };

  // ===== spalle e camicia mimetica =====
  part(() => {
    poly(g, [[0, 224], [22, 206], [62, 194], [178, 194], [218, 206], [240, 224], [240, 300], [0, 300]], c.camo);
    S([[178, 196], [218, 206], [240, 224], [240, 300], [196, 300]], 0.35);
    Sl(6, 236, 22, 256, 1, 0.45);
    Sl(10, 230, 26, 240, 1, 0.35);
    Sl(222, 238, 234, 258, 1, 0.45);
    Ll(4, 228, 22, 212, 2, 0.35);
  });

  // ===== giubbotto: spallacci con fettucce, pannello frontale =====
  const leftStrap = [[30, 212], [80, 204], [94, 300], [20, 300]];
  const rightStrap = mirrorX(leftStrap).reverse();
  const front = [[88, 244], [152, 244], [160, 300], [80, 300]];
  /** Fettucce MOLLE dentro un poligono: strisce orizzontali con cuciture verticali. */
  const molle = (pts, y0, y1) => {
    for (let y = y0; y < y1; y += 6) {
      for (let x = 0; x < 240; x++) {
        if (!insidePoly(pts, x + 0.5, y + 0.5)) continue;
        rect(g, x, y, 1, 1, c.vestDark);
        rect(g, x, y + 1, 1, 1, c.vestLight);
        if ((x + Math.floor(y / 6) * 3) % 9 === 0) rect(g, x, y + 2, 1, 3, c.vestDark);
      }
    }
  };
  part(() => {
    poly(g, leftStrap, c.vest);
    poly(g, rightStrap, c.vest);
    poly(g, front, c.vest);
    molle(leftStrap, 214, 300);
    molle(rightStrap, 214, 300);
    molle(front, 250, 300);
    // bordature dei lati degli spallacci
    path([[30, 212], [20, 300]], 2, c.vestDark);
    path([[80, 204], [94, 300]], 2, c.vestDark);
    path([[160, 204], [146, 300]], 2, c.vestDark);
    path([[210, 212], [220, 300]], 2, c.vestDark);
    S(rightStrap, 0.3);
    S([[70, 206], [80, 204], [94, 300], [84, 300]], 0.3);
    Sr(20, 230, 200, 8, 0.3); // ombra sotto la kefiah
  });

  // laccio emostatico e anello a D sullo spallaccio sinistro
  part(() => {
    rect(g, 42, 222, 12, 30, c.tourniquet);
    rect(g, 42, 222, 12, 2, c.tourniquetLight);
    for (let y = 228; y < 250; y += 4) rect(g, 43, y, 10, 1, c.tourniquetLight);
    rect(g, 44, 250, 8, 5, c.tourniquetTab);
    rect(g, 60, 228, 8, 3, c.metal);
    rect(g, 60, 231, 2, 6, c.metal);
    rect(g, 66, 231, 2, 6, c.metal);
    rect(g, 60, 236, 8, 2, c.metal);
  });

  // radio sullo spallaccio destro, antenna e cavo verso le cuffie
  part(() => {
    // antenna (dietro la testa, sale oltre la spalla)
    line(g, 190, 226, 218, 92, 4, c.antenna);
    for (let i = 0; i < 14; i++) {
      const y = 214 - i * 9;
      const x = 190 + ((226 - y) / 134) * 28;
      rect(g, x - 1, y, 4, 1, c.antennaLight);
    }
    rect(g, 215, 88, 6, 6, c.antenna);
    rect(g, 183, 214, 8, 14, c.antenna);
    // radio
    rect(g, 164, 224, 34, 46, c.radio);
    rect(g, 164, 224, 34, 2, c.radioLight);
    rect(g, 168, 230, 26, 12, c.radioDark);
    for (let y = 231; y < 242; y += 2) rect(g, 169, y, 24, 1, c.radio);
    rect(g, 170, 246, 10, 6, c.display);
    rect(g, 171, 247, 3, 1, c.displayLight);
    disc(g, 172, 220, 3, c.radioDark);
    disc(g, 182, 221, 2, c.radioDark);
    rect(g, 171, 219, 2, 1, c.radioLight);
    // tasca: elastici sopra la radio
    rect(g, 162, 256, 38, 4, c.vest);
    rect(g, 162, 256, 38, 1, c.vestLight);
    rect(g, 162, 264, 38, 4, c.vest);
    S([[190, 224], [198, 224], [198, 270], [190, 270]], 0.35);
  });

  // caricatori nelle tasche aperte (in basso al centro)
  part(() => {
    for (const x of [122, 138]) {
      rect(g, x, 262, 12, 38, c.mag);
      rect(g, x, 262, 12, 2, c.magLight);
      for (let y = 268; y < 300; y += 3) rect(g, x + 1, y, 10, 1, c.magDark);
    }
    rect(g, 118, 276, 36, 24, c.vest);
    rect(g, 118, 276, 36, 1, c.vestLight);
    rect(g, 132, 276, 2, 24, c.vestDark);
  });

  // ===== kefiah avvolta attorno al collo =====
  const scarf = [[66, 182], [174, 182], [202, 196], [216, 214], [208, 232], [182, 244], [150, 252], [120, 256], [90, 252], [58, 244], [32, 232], [24, 214], [38, 196]];
  part(() => {
  poly(g, scarf, c.scarf);
  // pieghe: ombre curve con il bordo superiore illuminato
  for (const [a, b, cc, w] of [
    [[40, 204], [120, 236], [200, 204], 3],
    [[30, 220], [120, 254], [210, 220], 3],
    [[56, 192], [120, 214], [184, 192], 2],
    [[70, 236], [96, 226], [118, 252], 2],
    [[150, 228], [170, 238], [190, 232], 2],
  ]) {
    Sp(quad(a, b, cc), w, 0.28);
    Sp(quad([a[0], a[1] + w], [b[0], b[1] + w], [cc[0], cc[1] + w]), 1, 0.15);
    Lp(quad([a[0], a[1] - w], [b[0], b[1] - w], [cc[0], cc[1] - w]), 1, 0.35);
  }
  S([[150, 186], [174, 182], [202, 196], [216, 214], [208, 232], [182, 244], [160, 248]], 0.35);
  });

  // ===== testa: viso =====
  const face = [[76, 90], [164, 90], [167, 128], [164, 160], [154, 184], [136, 200], [104, 200], [86, 184], [76, 160], [73, 128]];
  part(() => {
    poly(g, face, c.skin);
    // fronte: rughe
    for (const [x0, y0, x1, y1] of [[92, 99], [126, 99], [100, 95]].map(([x, y], i) => [x, y, x + [18, 20, 40][i], y + [-1, 1, 0][i]])) line(g, x0, y0, x1, y1, 1, c.skinMid);
    // sopracciglia aggrottate e ruga tra le sopracciglia
    poly(g, [[82, 99], [115, 102], [116, 106], [84, 104]], c.brows);
    poly(g, [[124, 102], [158, 99], [156, 104], [124, 106]], c.brows);
    for (let x = 84; x < 114; x += 3) rect(g, x, 99 + Math.round((x - 82) * 0.09), 2, 1, c.browsLight);
    for (let x = 126; x < 156; x += 3) rect(g, x, 102 - Math.round((x - 124) * 0.09), 2, 1, c.browsLight);
    line(g, 118, 97, 118, 106, 1, c.skinShadow);
    line(g, 121, 97, 122, 106, 1, c.skinShadow);
    // naso
    poly(g, [[116, 122], [124, 122], [130, 146], [134, 152], [128, 157], [112, 157], [106, 152], [110, 146]], c.skin);
    path([[110, 146], [106, 152], [111, 157]], 1, c.skinShadow);
    path([[130, 146], [134, 152], [129, 157]], 1, c.skinShadow);
    ellipseRows(g, 114, 153.5, 3, 1.6, c.skinDark);
    ellipseRows(g, 126, 153.5, 3, 1.6, c.skinDark);
    // pieghe naso-labiali, zampe di gallina
    path([[105, 150], [99, 160], [95, 168]], 1, c.skinShadow);
    path([[135, 150], [141, 160], [145, 168]], 1, c.skinShadow);
    for (const [x, y, dx, dy] of [[74, 118, -4, -2], [74, 122, -5, 0], [74, 126, -4, 2], [166, 118, 4, -2], [166, 122, 5, 0], [166, 126, 4, 2]]) line(g, x, y, x + dx, y + dy, 1, c.skinShadow);
    // barba (ciocche più avanti) con il bordo irregolare
    const beard = [[74, 138], [86, 147], [100, 153], [107, 158], [133, 158], [140, 153], [154, 147], [166, 138], [168, 160], [161, 183], [149, 201], [133, 213], [107, 213], [91, 201], [79, 183], [72, 160]];
    poly(g, beard, c.beard);
    for (let i = 0; i < 70; i++) {
      // ciuffi che sporgono in basso e peluria sulle guance
      const t = r();
      if (i < 40) {
        const x = 82 + t * 76;
        const yb = 212 - Math.abs(x - 120) * 0.55;
        line(g, x, yb - 2, x + (r() - 0.5) * 3, yb + 2 + r() * 4, 1, c.beard);
      } else {
        const x = 76 + t * 88;
        const yt = 140 + Math.abs(x - 120) * -0.05 + (x < 107 ? (107 - x) * -0.2 + 12 : x > 133 ? (x - 133) * -0.2 + 12 : 17);
        rect(g, x, yt - 2 - r() * 4, 1, 2, c.beard);
      }
    }
    // baffi
    poly(g, [[104, 158], [120, 156], [136, 158], [147, 168], [143, 177], [136, 170], [120, 168], [104, 170], [97, 177], [93, 168]], c.mustache);
    // bocca
    rect(g, 108, 171, 24, 2, c.lips);
    rect(g, 110, 173, 20, 3, c.lipsLight);
    rect(g, 113, 176, 14, 1, c.lips);
    // occhiali avvolgenti: montatura, lenti, aste
    poly(g, [[76, 106], [119, 107], [119, 126], [113, 134], [83, 134], [76, 126]], c.frame);
    poly(g, [[121, 107], [164, 106], [164, 126], [157, 134], [127, 134], [121, 126]], c.frame);
    rect(g, 76, 106, 88, 3, c.frame);
    rect(g, 116, 108, 8, 6, c.frame);
    line(g, 76, 110, 64, 114, 3, c.frame);
    line(g, 164, 110, 176, 114, 3, c.frame);
    rect(g, 78, 106, 40, 1, c.frameLight);
    for (const lens of BUST_LENSES) poly(g, lens, c.lensMark);
  // ombre del viso: sotto l'elmetto, lato destro, sotto gli occhiali, attorno al naso
  Sr(73, 90, 96, 6, 0.6);
  Sr(73, 96, 96, 3, 0.35);
  S([[146, 96], [164, 90], [167, 128], [164, 160], [150, 152], [146, 132]], 0.4);
  Sr(80, 134, 80, 4, 0.35);
  S([[123, 124], [130, 146], [134, 152], [128, 157], [122, 157]], 0.4);
  Sr(108, 157, 24, 3, 0.45);
  S([[136, 158], [147, 168], [143, 177], [154, 186], [161, 183], [168, 160], [166, 140]], 0.3);
  L([[80, 136], [100, 136], [97, 148], [82, 146]], 0.3);
  Ll(117, 124, 112, 146, 2, 0.45);
  Lr(115, 148, 5, 2, 0.5);
  Ll(80, 96, 112, 95, 1, 0.3);
  // volume: ombra graduata a retino verso destra e sotto l'elmetto, luce su naso e zigomo sinistro
  for (let y = 96; y < 200; y++) {
    for (let x = 136; x < 168; x++) if (bayer(x, y) < (x - 136) / 34) Sr(x, y, 1, 1, 0.3);
  }
  for (let y = 99; y < 106; y++) for (let x = 74; x < 166; x++) if (bayer(x, y) < 1 - (y - 99) / 7) Sr(x, y, 1, 1, 0.3);
  S([[78, 140], [96, 146], [92, 160], [76, 156]], 0.2);
  Ll(119, 112, 119, 124, 2, 0.4);
  Lr(84, 92, 22, 2, 0.25);
  Ll(84, 138, 96, 136, 1, 0.45);
  });

  // ===== elmetto =====
  part(() => {
    ellipseRows(g, 120, 96, 78, 94, c.helmet, 2, 91);
    rect(g, 43, 88, 154, 5, c.helmetEdge);
    rect(g, 43, 88, 154, 1, c.helmetEdgeLight);
    // pannelli a velcro con cuciture
    for (const pts of [[[56, 42], [94, 28], [98, 54], [60, 66]], mirrorX([[56, 42], [94, 28], [98, 54], [60, 66]])]) {
      poly(g, pts, c.velcro);
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i];
        const b = pts[(i + 1) % pts.length];
        const n = Math.round(Math.hypot(b[0] - a[0], b[1] - a[1]) / 3);
        for (let k = 0; k < n; k += 1) {
          const t = k / n;
          rect(g, a[0] + (b[0] - a[0]) * t + (pts[2][0] - a[0]) * 0.06, a[1] + (b[1] - a[1]) * t + (pts[2][1] - a[1]) * 0.06, 1, 1, c.velcroLight);
        }
      }
    }
    // toppa a infrarossi sul velcro di destra
    rect(g, 150, 38, 18, 11, c.patch);
    for (let x = 151; x < 167; x += 3) rect(g, x, 39, 1, 9, c.patchLight);
    // binari laterali con fessure
    for (const pts of [[[42, 50], [58, 44], [62, 90], [45, 92]], mirrorX([[42, 50], [58, 44], [62, 90], [45, 92]])]) {
      poly(g, pts, c.rail);
      const xm = (pts[0][0] + pts[1][0]) / 2;
      for (let y = 54; y < 88; y += 6) rect(g, xm - 5 + (y - 54) * 0.06 * Math.sign(120 - xm), y, 10, 2, c.railDark);
      rect(g, xm - 6, 48, 12, 1, c.railLight);
    }
    // elastici sulla calotta
    path(quad([50, 72], [70, 18], [104, 10]), 2, c.cord);
    path(quad([190, 72], [170, 18], [136, 10]), 2, c.cord);
    path(quad([62, 82], [120, 74], [178, 82]), 2, c.cord);
    for (const [x, y] of [[50, 72], [190, 72], [62, 82], [178, 82]]) disc(g, x, y, 2, c.cordHook);
    // slitta del visore notturno
    rect(g, 100, 3, 40, 40, c.rail);
    rect(g, 104, 7, 32, 22, c.railMid);
    rect(g, 110, 11, 20, 12, c.railDark);
    rect(g, 112, 13, 16, 2, c.railMid);
    rect(g, 104, 7, 32, 1, c.railLight);
    disc(g, 106, 34, 2, c.railLight);
    disc(g, 134, 34, 2, c.railLight);
    rect(g, 106, 34, 1, 1, c.railDark);
    rect(g, 134, 34, 1, 1, c.railDark);
    rect(g, 108, 40, 24, 10, c.rail);
    rect(g, 114, 42, 12, 6, c.railMid);
    for (let x = 115; x < 125; x += 2) rect(g, x, 43, 1, 4, c.railDark);
    rect(g, 98, 30, 3, 8, c.railMid);
    rect(g, 139, 30, 3, 8, c.railMid);
    // rivetti sul bordo
    for (const x of [70, 96, 144, 170]) rect(g, x, 86, 2, 2, c.metal);
    S([[140, 6], [184, 34], [198, 70], [197, 92], [150, 92], [146, 44]], 0.35);
    L([[54, 46], [80, 16], [98, 8], [96, 18], [72, 30], [60, 50]], 0.35);
  });

  // ===== cuffie con microfono e cavi =====
  part(() => {
    for (const [cx, side] of [[50, -1], [190, 1]]) {
      rect(g, cx - 4, 86, 8, 18, c.cupDark); // braccio verso il binario
      rect(g, cx - 3, 88, 2, 14, c.cupLight);
      ellipseRows(g, cx, 132, 21, 31, c.cupDark);
      ellipseRows(g, cx, 132, 18, 28, c.cup);
      ellipseRows(g, cx + side * 2, 133, 12, 20, c.cupMid);
      for (let y = 118; y < 150; y += 3) rect(g, cx + side * 2 - 7, y, 14, 1, c.cupDark);
      rect(g, cx - side * 14 - 3, 110, 6, 5, c.cupDark); // pulsanti
      rect(g, cx - side * 14 - 3, 117, 6, 5, c.cupDark);
      rect(g, cx - side * 14 - 2, 111, 4, 1, c.cupLight);
      rect(g, cx - side * 14 - 2, 118, 4, 1, c.cupLight);
      rect(g, cx - 2, 160, 4, 6, c.cupDark); // uscita del cavo
    }
    S([[60, 104], [72, 120], [70, 160], [56, 162]], 0.35);
    S([[200, 104], [212, 120], [210, 160], [196, 162]], 0.4);
    L([[30, 120], [36, 106], [40, 108], [34, 126]], 0.4);
  });
  // cavi: dalle cuffie al petto, con un'ansa
  part(() => {
    path(quad([50, 166], [30, 190], [44, 206]), 2, c.cable);
    path(quad([44, 206], [58, 220], [48, 232]), 2, c.cable);
    path(quad([190, 166], [214, 180], [204, 200]), 2, c.cable);
    path(quad([204, 200], [192, 214], [176, 222]), 2, c.cable);
  });
  // microfono a stelo dalla cuffia destra alla bocca
  part(() => {
    path(quad([176, 150], [170, 178], [152, 182]), 3, c.cupDark);
    ellipseRows(g, 146, 183, 7, 5.5, c.mic);
    for (let x = 141; x < 152; x += 2) rect(g, x, 180 + ((x >> 1) & 1), 1, 1, c.micLight);
  });

  // ===== fucile in primo piano (con braccia e guanti: spostati in basso sul petto) =====
  shiftY(30, () => {
  const B0 = [-6, 186];
  const dx = 0.931;
  const dy = 0.365;
  const nx = -0.365;
  const ny = 0.931;
  const R = (u, v) => [B0[0] + dx * u + nx * v, B0[1] + dy * u + ny * v];
  const rp = (pts, col) => poly(g, pts.map(([u, v]) => R(u, v)), col);
  const rb = (u0, u1, v0, v1, col) => rp([[u0, v0], [u1, v0], [u1, v1], [u0, v1]], col);
  const rpx = (u, v, col, w = 1, h = 1) => {
    const [x, y] = R(u, v);
    rect(g, x, y, w, h, col);
  };
  const rsh = (pts, a = 0.4) => poly(sg, pts.map(([u, v]) => R(u, v)), A(a));
  const rli = (pts, a = 0.35) => poly(lg, pts.map(([u, v]) => R(u, v)), A(a));
  part(() => {
    // calcio regolabile con appoggiaguancia
    rp([[-24, -15], [32, -13], [40, -5], [40, 11], [28, 13], [-24, 13]], c.furniture);
    rb(-2, 30, -18, -13, c.furnitureDark);
    rb(6, 26, -4, 3, c.furnitureDark);
    rb(14, 18, 5, 12, c.gun);
    for (let u = -20; u < 28; u += 4) rpx(u, 8, c.furnitureLight);
    // tubo del calcio
    rb(40, 62, -5, 5, c.gun);
    rb(40, 62, -5, -4, c.gunLight);
    // castello inferiore, pozzetto, caricatore
    rb(60, 134, -2, 10, c.gun);
    rb(92, 114, 8, 17, c.gun);
    rp([[94, 16], [112, 16], [117, 56], [99, 56]], c.mag);
    for (let v = 22; v < 54; v += 5) rp([[96 + v * 0.1, v], [112 + v * 0.12, v], [112 + v * 0.12, v + 1], [96 + v * 0.1, v + 1]], c.magDark);
    // impugnatura e grilletto
    rp([[118, 10], [131, 10], [138, 36], [125, 36]], c.furniture);
    for (let v = 16; v < 34; v += 3) rp([[120 + v * 0.27, v], [130 + v * 0.27, v], [130 + v * 0.27, v + 1], [120 + v * 0.27, v + 1]], c.furnitureDark);
    rb(108, 124, 10, 12, c.gun);
    rb(112, 114, 9, 14, c.gunLight);
    // castello superiore: finestra di espulsione, manetta, slitta
    rb(58, 136, -13, -2, c.gunMid);
    rb(58, 66, -16, -12, c.gun);
    rb(96, 114, -8, -4, c.gunDark);
    rb(100, 104, -7, -5, c.brass);
    for (let u = 60; u < 136; u += 3) rb(u, u + 2, -16, -13, c.gun);
    rb(64, 70, -4, 0, c.gunLight);
    // mirino olografico
    rb(78, 120, -21, -16, c.gun);
    rp([[78, -44], [118, -44], [122, -36], [122, -21], [78, -21]], c.optic);
    rb(84, 114, -40, -25, c.opticDark);
    rb(86, 112, -38, -27, c.opticGlass);
    rb(86, 112, -38, -35, c.opticGlassLight);
    rb(116, 121, -34, -30, c.gunLight);
    rb(116, 121, -28, -24, c.gunLight);
    rb(80, 92, -24, -21, c.opticDark);
    for (const [u, v] of [[81, -42], [115, -42], [81, -23], [96, -19], [110, -19]]) rpx(u, v, c.gunLight, 2, 2);
    // paramano con fessure M-LOK, slitta superiore, torcia
    rb(134, 262, -13, 8, c.gun);
    rb(134, 262, -13, -11, c.gunMid);
    for (let u = 136; u < 262; u += 3) rb(u, u + 2, -16, -13, c.gun);
    for (let u = 142; u < 256; u += 16) {
      rb(u, u + 9, -6, 2, c.gunDark);
      rb(u + 1, u + 8, -5, -4, c.gunMid);
    }
    rb(196, 230, 8, 16, c.gunMid);
    rb(196, 230, 8, 9, c.gunLight);
    rb(226, 232, 6, 18, c.gun);
    rb(232, 234, 8, 16, c.lightLens);
    // anello della cinghia
    rb(40, 46, 5, 12, c.metal);
    rli([[-24, -15], [262, -16], [262, -14], [-24, -13]], 0.4);
    rsh([[-24, 9], [262, 6], [262, 8], [-24, 13]], 0.4);
    rsh([[78, -21], [122, -21], [122, -18], [78, -18]], 0.3);
  });

  // ===== avambracci e mani (coordinate del fucile: u lungo l'arma, v verso il basso) =====
  /** Dito: capsula da (u0,v0) a (u1,v1) larga w, punta più scura. */
  const finger = (u0, v0, u1, v1, w) => {
    const [x0, y0] = R(u0, v0);
    const [x1, y1] = R(u1, v1);
    limb(g, x0, y0, x1, y1, w, w, c.gloves);
    disc(g, x0, y0, w / 2 - 0.5, c.gloves);
    disc(g, x1, y1, w / 2 - 0.5, c.gloves);
    const [xt, yt] = R(u1 + (u1 - u0) * 0.02, v1 + (v1 - v0) * 0.02);
    disc(g, xt, yt, Math.max(1, w / 2 - 1.5), c.glovesDark);
    // cucitura lungo il dito
    const [xa, ya] = R(u0 + (u1 - u0) * 0.15, v0 + (v1 - v0) * 0.15);
    const [xb, yb] = R(u0 + (u1 - u0) * 0.8, v0 + (v1 - v0) * 0.8);
    line(g, xa, ya, xb, yb, 1, c.glovesLight);
  };
  const wristR = R(80, 44);
  const wristL = R(206, 40);
  // avambraccio destro (da in basso a sinistra) e sinistro (da in basso a destra)
  part(() => {
    limb(g, wristR[0] - 46, wristR[1] + 60, wristR[0], wristR[1], 50, 30, c.camo);
    Sl(wristR[0] - 30, wristR[1] + 40, wristR[0] - 6, wristR[1] + 18, 1, 0.45);
    Sl(wristR[0] - 36, wristR[1] + 30, wristR[0] - 20, wristR[1] + 22, 1, 0.35);
    S([[wristR[0] - 10, wristR[1] - 4], [wristR[0] + 14, wristR[1] + 8], [wristR[0] - 20, wristR[1] + 70], [wristR[0] - 40, wristR[1] + 60]], 0.3);
  });
  part(() => {
    limb(g, wristL[0] + 50, wristL[1] + 50, wristL[0], wristL[1], 52, 30, c.camo);
    Sl(wristL[0] + 12, wristL[1] + 14, wristL[0] + 36, wristL[1] + 30, 1, 0.45);
    S([[wristL[0] + 6, wristL[1] - 14], [wristL[0] + 30, wristL[1] - 2], [wristL[0] + 76, wristL[1] + 40], [wristL[0] + 40, wristL[1] + 60]], 0.4);
  });
  // mano destra sull'impugnatura: dorso con paranocche, tre dita attorno all'impugnatura, indice lungo il
  // ponticello, pollice sul castello
  part(() => {
    rp([[70, 34], [86, 22], [100, 50], [84, 60]], c.cuff);
    rp([[74, 38], [86, 30], [89, 36], [77, 44]], c.cuffLight);
    rp([[84, 24], [112, 8], [116, 36], [100, 50], [88, 46]], c.gloves);
    finger(104, 2, 120, 1, 6); // pollice
    finger(108, 10, 128, 10, 5); // indice sul ponticello
    for (const v of [16, 22, 28]) finger(110, v, 136 + v * 0.27, v + 1, 6);
    rp([[102, 12], [112, 10], [114, 34], [104, 38]], c.knuckle);
    for (const v of [14, 20, 26, 32]) rp([[103, v], [113, v - 0.5], [113.5, v + 1], [103.5, v + 1.5]], c.knuckleLight);
    rp([[90, 24], [100, 18], [102, 22], [92, 28]], c.glovesLight);
    rsh([[96, 26], [114, 22], [116, 36], [100, 50], [92, 46]], 0.35);
    rli([[84, 24], [100, 14], [102, 18], [88, 28]], 0.35);
  });
  // mano sinistra sul paramano: pollice lungo il paramano, quattro dita che lo avvolgono, dorso sotto
  part(() => {
    rp([[192, 30], [214, 24], [222, 46], [200, 54]], c.cuff);
    rp([[196, 34], [212, 30], [214, 36], [198, 40]], c.cuffLight);
    rp([[166, 6], [206, 4], [212, 30], [172, 36]], c.gloves);
    finger(170, 6, 150, 4, 6.5); // pollice
    for (const u of [174, 181, 188, 195]) finger(u, 10, u - 2, -14, 6.5);
    rp([[170, 8], [200, 6], [202, 14], [172, 16]], c.knuckle);
    for (const u of [176, 183, 190, 197]) rp([[u - 2, 8], [u + 3, 8], [u + 3, 9], [u - 2, 9]], c.knuckleLight);
    rsh([[194, -16], [202, -16], [212, 30], [196, 32]], 0.35);
    rli([[166, 6], [172, 6], [174, 34], [170, 34]], 0.35);
  });
  });
  Sr(0, 286, 240, 14, 0.25); // il basso dell'inquadratura più scuro

  applyMasks(main.c, shade.c, light.c, sc.shadowColor || '#2a1630', sc.lightColor || '#ffd8a0');
  finish(main.c, { tint: sc.shade?.color, tintAmount: sc.shade?.amount ?? 0, rim: sc.rim, rimAmount: sc.rimAmount ?? 0.6, rimDir: sunDir, rimWidth: 2, outline: sc.outline });
  return main.c;
}

// ---------- Carro armato distrutto ----------

export function drawTank(g, c, seed, M) {
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
  rect(g, 24, 6, 6, 2, c.char);
  line(g, 24, 6, 21, 1, 2, c.dark);
  line(g, 43, 12, 59, 17, 2, c.dark);
  rect(g, 58, 16, 3, 3, c.dark);
  for (let i = 0; i < 9; i++) disc(g, 4 + r() * 56, 9 + r() * 14, 1 + r() * 1.6, c.char);
  disc(g, 12, 20, 1.5, c.char);
  disc(g, 50, 19, 1.2, c.char);
  g.restore();
}

// ---------- Elicottero d'attacco (Apache), di fianco col muso a destra ----------

export const HELI = { length: 66, height: 30 };

export function drawApache(g, s, cfg, M) {
  const P = (pts) => pts.map(([x, y]) => [M + x * s, M + y * s]);
  const R = (x, y, w, h, col) => rect(g, M + x * s, M + y * s, Math.max(1, w * s), Math.max(1, h * s), col);
  const body = cfg.body;
  const dark = cfg.dark || body;
  // trave di coda, deriva, stabilizzatore
  poly(g, P([[16, 11], [17, 16.5], [3, 14.5], [2, 11.5]]), body);
  poly(g, P([[0, 3], [4.5, 3], [6.5, 12], [2, 15], [0, 14]]), body);
  poly(g, P([[-1, 14], [8, 14], [8, 15.5], [-1, 15.5]]), dark);
  // fusoliera stretta e muso
  poly(g, P([[15, 10], [34, 8], [46, 9], [56, 11], [62, 14], [61, 16.5], [56, 18.5], [44, 20], [24, 19], [15, 16.5]]), body);
  // cabine in tandem (pilota dietro e più in alto, artigliere davanti)
  poly(g, P([[35, 4.5], [45, 5.5], [47, 10], [35, 10]]), cfg.glass);
  poly(g, P([[47, 8.5], [55, 9.5], [59, 13], [47, 13]]), cfg.glass);
  R(40, 4.5, 1, 5.5, dark);
  R(52, 9, 1, 4, dark);
  R(35, 10, 24, 1, dark);
  // gondole dei motori con scarico
  poly(g, P([[24, 9], [34, 8.5], [36, 10.5], [34, 13], [24, 13]]), cfg.light || body);
  R(22, 9.5, 3, 3, dark);
  R(26, 11, 7, 1, dark);
  // alette con lanciarazzi e missili
  R(27, 16, 16, 1.6, dark);
  poly(g, P([[28, 17.5], [35, 17.5], [35.5, 22], [28, 22]]), body);
  R(28, 18, 1, 3.5, dark);
  R(37, 18, 7, 1.5, dark);
  R(37, 20.5, 7, 1.5, dark);
  R(43, 18, 1, 4, cfg.light || body);
  // cannoncino sotto il muso
  R(53, 18.5, 3, 3, dark);
  R(55, 21, 7, 1, dark);
  // mozzo e albero del rotore
  R(33, 1.5, 5, 2, dark);
  R(35, 3, 1.5, 5, dark);
  // carrello: ruote principali e ruotino di coda
  R(43, 20, 1, 4, dark);
  R(50, 19.5, 1, 4.5, dark);
  disc(g, M + 43.5 * s, M + 24.5 * s, Math.max(1, 1.6 * s), dark);
  disc(g, M + 50.5 * s, M + 24.5 * s, Math.max(1, 1.6 * s), dark);
  R(4, 15.5, 1, 2.5, dark);
  disc(g, M + 4.5 * s, M + 18.5 * s, Math.max(0.6, 1 * s), dark);
}

// ---------- Nuvole ----------

export function makeCloud(cfg, w, h) {
  const { c, g } = makeCanvas(w + 2, h + 2);
  const base = h;
  let x = 4;
  while (x < w - 4) {
    const rr = rnd(h * 0.3, h * 0.62) * (1 - Math.abs(x / w - 0.5) * 0.9);
    disc(g, x, base - rr * 0.7, rr, '#fff');
    x += rnd(rr * 0.6, rr * 1.2);
  }
  g.clearRect(0, base + 1, c.width, c.height);
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
      const t = (y - top) / Math.max(1, base - top);
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
