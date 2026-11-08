// Disegni a pixel della scena del menu (js/menu_scene.js): primitive senza antialiasing, rifiniture
// (mimetica, ombre, luce di controluce, contorno) e gli sprite procedurali: soldato in primo piano,
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

// ---------- Soldato in primo piano ----------

export const SOLDIER = { w: 126, h: 190, margin: 3, feet: 185 };

/**
 * Soldato visto di fronte, luce da sinistra: elmetto con copertura mimetica e slitta per il visore, occhiali da sole
 * con il riflesso del tramonto, barba, kefiah, giubbotto porta-piastre con fettucce e tasche, radio, fucile con
 * ottica tenuto di traverso, guanti, fondina cosciale, ginocchiere, anfibi; piede destro su una maceria.
 * oy = respiro (busto e braccia scendono di 1 px). Restituisce un canvas rifinito.
 */
export function buildSoldier(sc, oy, sunDir, seed) {
  const c = sc.colors || {};
  const M = SOLDIER.margin;
  const W = SOLDIER.w + M * 2;
  const H = SOLDIER.h + M * 2;
  const main = makeCanvas(W, H);
  const shade = makeCanvas(W, H);
  const light = makeCanvas(W, H);
  for (const k of [main, shade, light]) k.g.translate(M, M);
  let g = main.g;
  const sg = shade.g;
  const lg = light.g;
  const U = (y) => y + oy;
  const r = mulberry32(seed);
  // ombra / luce: stesse forme, sulle maschere (a = intensità)
  const S = (pts, a = 0.5) => poly(sg, pts, `rgba(0,0,0,${a})`);
  const Sr = (x, y, w, h, a = 0.5) => rect(sg, x, y, w, h, `rgba(0,0,0,${a})`);
  const Sl = (x0, y0, x1, y1, w = 1, a = 0.5) => line(sg, x0, y0, x1, y1, w, `rgba(0,0,0,${a})`);
  const Lr = (x, y, w, h, a = 0.35) => rect(lg, x, y, w, h, `rgba(0,0,0,${a})`);
  const Ll = (x0, y0, x1, y1, w = 1, a = 0.35) => line(lg, x0, y0, x1, y1, w, `rgba(0,0,0,${a})`);
  /** Ombra sul lato destro di un arto (lontano dalla luce). */
  const limbShade = (x0, y0, x1, y1, w0, w1, a = 0.45) => {
    const len = Math.hypot(x1 - x0, y1 - y0) || 1;
    let nx = -(y1 - y0) / len;
    let ny = (x1 - x0) / len;
    if (nx < 0) {
      nx = -nx;
      ny = -ny;
    }
    poly(sg, [[x0 + nx * w0 * 0.05, y0 + ny * w0 * 0.05], [x1 + nx * w1 * 0.05, y1 + ny * w1 * 0.05], [x1 + nx * w1 / 2, y1 + ny * w1 / 2], [x0 + nx * w0 / 2, y0 + ny * w0 / 2]], `rgba(0,0,0,${a})`);
    // luce sul lato sinistro
    poly(lg, [[x0 - nx * w0 / 2, y0 - ny * w0 / 2], [x1 - nx * w1 / 2, y1 - ny * w1 / 2], [x1 - nx * (w1 / 2 - 2), y1 - ny * (w1 / 2 - 2)], [x0 - nx * (w0 / 2 - 2), y0 - ny * (w0 / 2 - 2)]], 'rgba(0,0,0,0.3)');
  };

  /**
   * Parte disegnata su un livello a sé e incollata con un contorno interno (inline): separa braccia, fucile,
   * gambe e testa dal resto anche quando i colori sono simili.
   */
  const part = (fn) => {
    const L = makeCanvas(W, H);
    L.g.translate(M, M);
    const prev = g;
    g = L.g;
    fn();
    g = prev;
    outlineLayer(L.c, c.inline || sc.outline || '#2a1c14');
    main.g.save();
    main.g.setTransform(1, 0, 0, 1, 0, 0);
    main.g.drawImage(L.c, 0, 0);
    main.g.restore();
  };

  // ===== maceria sotto il piede alzato =====
  const block = (x, y, w, h, col, lt, dk) => {
    rect(g, x, y, w, h, col);
    rect(g, x, y, w, 1, lt);
    rect(g, x, y, 1, h, lt);
    rect(g, x, y + h - 1, w, 1, dk);
    rect(g, x + w - 1, y, 1, h, dk);
  };
  line(g, 84, 168, 78, 150, 1, c.rebar);
  line(g, 112, 170, 120, 154, 1, c.rebar);
  line(g, 120, 154, 123, 156, 1, c.rebar);
  block(70, 172, 22, 14, c.concrete, c.concreteLight, c.concreteDark);
  block(104, 175, 20, 11, c.brick, c.brickLight, c.concreteDark);
  block(86, 165, 28, 21, c.concrete, c.concreteLight, c.concreteDark);
  block(112, 168, 13, 8, c.concrete, c.concreteLight, c.concreteDark);
  block(78, 168, 10, 6, c.concreteLight, c.concreteLight, c.concrete);
  for (let i = 0; i < 18; i++) rect(g, 72 + r() * 50, 167 + r() * 18, 1 + r() * 2, 1, r() < 0.5 ? c.concreteDark : c.concreteLight);
  for (const [x, y] of [[92, 178], [100, 170], [116, 172], [76, 180]]) rect(g, x, y, 3, 2, c.concreteDark);
  for (let x = 105; x < 123; x += 4) rect(g, x, 179 + ((x >> 2) & 1), 3, 1, c.concreteDark); // fughe dei mattoni
  Sr(104, 182, 20, 4, 0.4);
  Sr(86, 182, 28, 4, 0.35);

  // ===== gamba d'appoggio (a sinistra di chi guarda) =====
  part(() => {
  poly(g, [[34, 118], [60, 118], [58, 150], [38, 150]], c.camo);
  poly(g, [[38, 150], [57, 150], [55, 172], [40, 172]], c.camo);
  limbShade(47, 118, 47, 150, 26, 20);
  limbShade(47, 150, 47, 172, 19, 15);
  // tasca laterale e fondina cosciale
  rect(g, 34, 126, 9, 14, c.camo);
  Sr(34, 126, 9, 1, 0.5);
  Sr(34, 139, 9, 1, 0.5);
  Sl(36, 128, 41, 128, 1, 0.4);
  rect(g, 28, 120, 10, 22, c.holster);
  rect(g, 29, 112, 8, 9, c.holster); // impugnatura della pistola
  rect(g, 30, 113, 6, 1, c.gunLight);
  rect(g, 28, 124, 10, 2, c.strap);
  rect(g, 28, 134, 10, 2, c.strap);
  rect(g, 37, 124, 6, 2, c.strap);
  rect(g, 37, 134, 6, 2, c.strap);
  Sr(34, 120, 4, 22, 0.35);
  // pieghe
  Sl(42, 140, 52, 145, 1, 0.35);
  Sl(44, 160, 52, 158, 1, 0.3);
  // ginocchiera
  poly(g, [[38, 146], [56, 146], [57, 156], [37, 156]], c.pads);
  rect(g, 39, 146, 16, 1, c.padsLight);
  rect(g, 40, 148, 14, 6, c.padsMid);
  rect(g, 37, 152, 2, 2, c.strap);
  rect(g, 55, 152, 2, 2, c.strap);
  // anfibio
  poly(g, [[38, 170], [57, 170], [60, 184], [35, 184]], c.boots);
  rect(g, 34, 183, 27, 3, c.sole);
  rect(g, 39, 170, 17, 2, c.bootsDark);
  for (let y = 172; y < 181; y += 2) {
    rect(g, 44, y, 6, 1, c.laces);
    rect(g, 45, y + 1, 4, 1, c.bootsDark);
  }
  Lr(36, 181, 10, 2, 0.4);
  S([[52, 172], [57, 172], [60, 184], [54, 184]], 0.35);
  });

  // ===== gamba alzata sulla maceria =====
  part(() => {
  poly(g, [[62, 117], [88, 116], [104, 124], [108, 138], [92, 142], [70, 130]], c.camo);
  S([[88, 125], [107, 128], [108, 138], [92, 142]], 0.4);
  Sl(74, 126, 90, 130, 1, 0.35);
  poly(g, [[91, 139], [107, 139], [105, 156], [93, 156]], c.camo);
  limbShade(99, 139, 99, 156, 16, 12);
  poly(g, [[89, 124], [107, 124], [109, 140], [87, 140]], c.pads);
  rect(g, 90, 124, 16, 1, c.padsLight);
  rect(g, 91, 127, 14, 10, c.padsMid);
  rect(g, 87, 132, 2, 3, c.strap);
  rect(g, 107, 132, 2, 3, c.strap);
  poly(g, [[90, 154], [108, 154], [111, 165], [87, 165]], c.boots);
  rect(g, 86, 164, 26, 3, c.sole);
  rect(g, 91, 154, 16, 2, c.bootsDark);
  for (let y = 156; y < 163; y += 2) {
    rect(g, 96, y, 6, 1, c.laces);
    rect(g, 97, y + 1, 4, 1, c.bootsDark);
  }
  S([[104, 156], [108, 156], [111, 165], [105, 165]], 0.35);
  });

  // ===== fianchi e cinturone =====
  poly(g, [[36, 112], [88, 112], [90, 124], [34, 124]], c.camo);
  Sr(56, 120, 12, 6, 0.4); // cavallo
  rect(g, 34, U(107), 56, 7, c.belt);
  rect(g, 34, U(107), 56, 1, c.beltLight);
  for (let x = 38; x < 88; x += 6) rect(g, x, U(109), 1, 3, c.beltDark);
  rect(g, 57, U(107), 10, 7, c.buckle);
  rect(g, 58, U(108), 8, 1, c.buckleLight);
  rect(g, 61, U(110), 2, 2, c.beltDark);
  rect(g, 70, U(108), 9, 10, c.vest); // tasca sul cinturone
  rect(g, 70, U(108), 9, 2, c.vestLight);
  Sr(77, U(108), 2, 10, 0.4);

  // ===== busto =====
  poly(g, [[28, U(54)], [96, U(54)], [99, U(64)], [96, U(110)], [28, U(110)], [25, U(64)]], c.camo);
  disc(g, 31, U(62), 9, c.camo);
  disc(g, 93, U(62), 9, c.camo);
  // giubbotto porta-piastre
  poly(g, [[38, U(56)], [86, U(56)], [88, U(108)], [36, U(108)]], c.vest);
  rect(g, 40, U(48), 11, 10, c.vest); // spallacci
  rect(g, 73, U(48), 11, 10, c.vest);
  rect(g, 40, U(48), 11, 1, c.vestLight);
  rect(g, 73, U(48), 11, 1, c.vestLight);
  // fettucce MOLLE
  for (let y = 64; y < 106; y += 5) {
    for (let x = 38; x < 86; x++) {
      if ((x - 38) % 7 === 6) continue;
      rect(g, x, U(y), 1, 1, c.vestDark);
    }
    Lr(38, U(y + 1), 48, 1, 0.12);
  }
  for (let y = 58; y < 64; y++) rect(g, 39, U(y), 46, 1, y === 58 ? c.vestLight : c.vest);
  // tasca amministrativa con toppa
  rect(g, 50, U(60), 24, 16, c.vest);
  rect(g, 50, U(60), 24, 1, c.vestLight);
  rect(g, 50, U(75), 24, 1, c.vestDark);
  rect(g, 73, U(60), 1, 16, c.vestDark);
  rect(g, 53, U(62), 18, 7, c.velcro);
  rect(g, 55, U(63), 14, 5, c.patch);
  for (let x = 56; x < 68; x += 2) rect(g, x, U(65), 1, 1, c.patchText);
  rect(g, 55, U(63), 14, 1, c.patchLight);
  rect(g, 52, U(71), 20, 1, c.vestDark); // cerniera
  // tasche portacaricatori
  for (const px of [41, 55, 69]) {
    rect(g, px, U(84), 13, 20, c.vest);
    rect(g, px, U(84), 13, 5, c.vestLight);
    rect(g, px, U(89), 13, 1, c.vestDark);
    rect(g, px + 5, U(88), 3, 3, c.strap);
    rect(g, px + 12, U(84), 1, 20, c.vestDark);
    rect(g, px, U(103), 13, 1, c.vestDark);
    Sr(px + 9, U(90), 3, 13, 0.25);
  }
  // radio sullo spallaccio sinistro (di chi guarda) con antenna e cavo
  rect(g, 34, U(60), 9, 18, c.radio);
  rect(g, 34, U(60), 9, 1, c.radioLight);
  rect(g, 35, U(63), 7, 1, c.radioDark);
  rect(g, 37, U(57), 2, 3, c.gun);
  line(g, 38, U(57), 30, U(14), 1, c.gun);
  rect(g, 30, U(13), 1, 2, c.gun);
  for (let i = 0; i < 6; i++) rect(g, 43 + i, U(66 + (i % 2)), 1, 1, c.gun);
  // laccio emostatico sullo spallaccio destro
  rect(g, 77, U(50), 6, 11, c.tourniquet);
  rect(g, 77, U(53), 6, 1, c.gun);
  rect(g, 78, U(60), 4, 2, c.tourniquetTab);
  // ombre del busto
  S([[76, U(56)], [86, U(56)], [88, U(108)], [80, U(108)]], 0.4);
  Sr(36, U(104), 52, 4, 0.3);
  Sr(38, U(56), 48, 3, 0.45); // sotto la kefiah

  // ===== braccia (parte alta) =====
  part(() => {
    limb(g, 31, U(60), 25, U(94), 17, 14, c.camo);
    disc(g, 31, U(62), 8, c.camo);
  });
  limbShade(31, U(60), 25, U(94), 17, 14);
  part(() => {
    limb(g, 93, U(60), 100, U(90), 17, 14, c.camo);
    disc(g, 93, U(62), 8, c.camo);
  });
  limbShade(93, U(60), 100, U(90), 17, 14);
  // tasca e toppa sulla spalla
  rect(g, 24, U(66), 12, 12, c.camo);
  rect(g, 25, U(67), 10, 7, c.velcro);
  rect(g, 26, U(68), 8, 5, c.patch2);
  rect(g, 27, U(69), 6, 1, c.patchLight);
  rect(g, 89, U(66), 12, 12, c.camo);
  rect(g, 90, U(67), 10, 7, c.velcro);
  Sr(98, U(66), 3, 12, 0.35);
  // pieghe delle maniche
  Sl(24, U(84), 32, U(82), 1, 0.4);
  Sl(26, U(88), 31, U(87), 1, 0.35);
  Sl(95, U(82), 103, U(84), 1, 0.4);

  // ===== kefiah e collo =====
  rect(g, 52, U(38), 20, 10, c.skinShadow);
  poly(g, [[44, U(40)], [80, U(40)], [88, U(48)], [85, U(56)], [62, U(61)], [39, U(56)], [36, U(48)]], c.scarf);
  S([[62, U(52)], [84, U(46)], [88, U(48)], [85, U(56)], [62, U(61)]], 0.35);
  Sl(42, U(48), 60, U(54), 1, 0.4);
  Sl(64, U(54), 82, U(48), 1, 0.4);
  Sl(46, U(44), 58, U(47), 1, 0.3);

  // ===== testa =====
  part(() => {
  // orecchie
  ellipseRows(g, 45.5, U(27), 3, 5, c.skin);
  ellipseRows(g, 78.5, U(27), 3, 5, c.skin);
  rect(g, 45, U(25), 1, 4, c.skinShadow);
  rect(g, 78, U(25), 1, 4, c.skinShadow);
  // viso
  poly(g, [[47, U(15)], [77, U(15)], [77, U(31)], [75, U(37)], [70, U(42)], [64, U(44)], [60, U(44)], [54, U(42)], [49, U(37)], [47, U(31)]], c.skin);
  // ombra sotto l'elmetto e luce/ombra sul viso
  Sr(47, U(15), 30, 4, 0.55);
  Sr(47, U(19), 30, 1, 0.3);
  S([[71, U(19)], [77, U(19)], [77, U(31)], [75, U(37)], [71, U(36)]], 0.35);
  Lr(48, U(28), 4, 3, 0.35);
  // sopracciglia
  rect(g, 49, U(20), 9, 1, c.beardDark);
  rect(g, 66, U(20), 9, 1, c.beardDark);
  // naso
  rect(g, 61, U(27), 3, 5, c.skin);
  rect(g, 64, U(27), 1, 5, c.skinShadow);
  rect(g, 61, U(28), 1, 3, c.skinLight);
  rect(g, 60, U(31), 5, 1, c.skinShadow);
  rect(g, 60, U(32), 1, 1, c.skinDark);
  rect(g, 64, U(32), 1, 1, c.skinDark);
  // zigomi
  rect(g, 49, U(29), 4, 1, c.skinLight);
  rect(g, 72, U(29), 4, 1, c.skinShadow);
  // barba
  poly(g, [[47, U(30)], [51, U(32)], [55, U(33)], [69, U(33)], [73, U(32)], [77, U(30)], [77, U(35)], [74, U(40)], [69, U(45)], [62, U(47)], [55, U(45)], [50, U(40)], [47, U(35)]], c.beard);
  // bordo sfumato della barba sulle guance
  for (let x = 47; x < 78; x++) {
    const yb = 30 + (x < 55 ? (55 - x) * -0.1 + 2 : x > 69 ? (x - 69) * -0.1 + 2 : 3);
    if (bayer(x, 1) < 0.5) rect(g, x, U(Math.round(yb) - 1), 1, 1, c.beard);
  }
  // baffi e bocca
  poly(g, [[55, U(33)], [69, U(33)], [71, U(37)], [67, U(35)], [57, U(35)], [53, U(37)]], c.beardDark);
  rect(g, 58, U(36), 8, 1, c.lips);
  rect(g, 59, U(37), 6, 1, c.lipsLight);
  rect(g, 58, U(38), 8, 1, c.beardDark);
  // tessitura della barba
  for (let i = 0; i < 70; i++) {
    const x = 48 + Math.floor(r() * 29);
    const y = 34 + Math.floor(r() * 12);
    rect(g, x, U(y), 1, 1, r() < 0.55 ? c.beardLight : c.beardDark);
  }
  S([[69, U(33)], [77, U(31)], [77, U(35)], [74, U(40)], [69, U(45)], [65, U(46)]], 0.35);
  // occhiali da sole avvolgenti con il riflesso del tramonto
  const lens = c.lens || ['#2a2038', '#4a2a4c', '#8a3a56', '#c8564c', '#f08a52', '#ffc272'];
  poly(g, [[46, U(21)], [61, U(21)], [61, U(27)], [59, U(29)], [49, U(29)], [46, U(26)]], c.frame);
  poly(g, [[63, U(21)], [78, U(21)], [78, U(26)], [75, U(29)], [65, U(29)], [63, U(27)]], c.frame);
  rect(g, 60, U(22), 4, 2, c.frame);
  line(g, 46, U(22), 44, U(23), 1, c.frame);
  line(g, 78, U(22), 80, U(23), 1, c.frame);
  for (let y = 22; y <= 28; y++) {
    const col = lens[Math.min(lens.length - 1, Math.floor(((y - 22) / 7) * lens.length))];
    rect(g, 47, U(y), y >= 27 ? 11 : 13, 1, col);
    rect(g, y >= 27 ? 66 : 64, U(y), y >= 27 ? 11 : 13, 1, col);
  }
  for (const lx of [48, 65]) {
    rect(g, lx + 2, U(22), 1, 1, c.glint);
    rect(g, lx + 1, U(23), 1, 1, c.glint);
    rect(g, lx + 8, U(25), 2, 1, c.glintSoft);
  }

  // ===== elmetto =====
  ellipseRows(g, 62, U(20), 23.5, 20, c.helmet, U(0), U(17));
  rect(g, 38, U(14), 48, 4, c.helmet);
  rect(g, 38, U(17), 48, 2, c.helmetDark); // bordo
  rect(g, 39, U(18), 7, 6, c.helmet); // fianchi alti
  rect(g, 78, U(18), 7, 6, c.helmet);
  rect(g, 39, U(23), 7, 1, c.helmetDark);
  rect(g, 78, U(23), 7, 1, c.helmetDark);
  // binari laterali e slitta del visore notturno
  rect(g, 39, U(9), 4, 9, c.rail);
  rect(g, 81, U(9), 4, 9, c.rail);
  for (let y = 10; y < 17; y += 2) {
    rect(g, 39, U(y), 4, 1, c.railLight);
    rect(g, 81, U(y), 4, 1, c.railLight);
  }
  rect(g, 56, U(5), 12, 8, c.rail);
  rect(g, 57, U(6), 10, 1, c.railLight);
  rect(g, 59, U(8), 6, 3, c.gun);
  rect(g, 57, U(11), 2, 1, c.railLight);
  rect(g, 65, U(11), 2, 1, c.railLight);
  // elastico e toppa a velcro
  rect(g, 40, U(10), 44, 2, c.band);
  rect(g, 69, U(3), 8, 5, c.velcro);
  rect(g, 70, U(4), 6, 3, c.patch2);
  // sottogola
  line(g, 44, U(19), 48, U(36), 1, c.strap);
  line(g, 80, U(19), 76, U(36), 1, c.strap);
  rect(g, 46, U(30), 3, 2, c.buckle);
  });
  // ombra e luce dell'elmetto
  S([[66, U(1)], [74, U(3)], [84, U(10)], [86, U(18)], [70, U(18)]], 0.35);
  Lr(44, U(4), 8, 2, 0.35);
  Lr(41, U(6), 4, 3, 0.25);

  // ===== fucile tenuto di traverso =====
  // asse dal calcio (B) alla volata; u lungo l'arma, v perpendicolare (+ verso il caricatore)
  const B = [24, U(118)];
  const dx = 0.672;
  const dy = -0.739;
  const nx = 0.739;
  const ny = 0.672;
  const R = (u, v) => [B[0] + dx * u + nx * v, B[1] + dy * u + ny * v];
  const rp = (pts, col) => poly(g, pts.map(([u, v]) => R(u, v)), col);
  const rb = (u0, u1, v0, v1, col) => rp([[u0, v0], [u1, v0], [u1, v1], [u0, v1]], col);
  const rpx = (u, v, col) => {
    const [x, y] = R(u, v);
    rect(g, x, y, 1, 1, col);
  };
  const rsh = (pts, a = 0.4) => poly(sg, pts.map(([u, v]) => R(u, v)), `rgba(0,0,0,${a})`);
  part(() => {
  // calcio e tubo
  rp([[0, -5], [4, -6], [20, -5], [20, 3], [14, 5], [0, 5]], c.furniture);
  rb(0, 2, -5, 5, c.gun);
  rb(20, 29, -2.5, 1.5, c.gun);
  rb(6, 16, 1, 3, c.furnitureDark);
  // castello inferiore, ponticello, impugnatura
  rb(28, 50, -1.5, 4.5, c.gun);
  rp([[31, 4], [38, 4], [36, 14], [29, 14]], c.furniture);
  rp([[36, 4], [43, 4], [43, 7], [37, 7]], c.gun);
  rb(37, 42, 5, 6, c.furnitureDark);
  // caricatore
  rp([[44, 4], [51, 4], [53, 20], [46, 20]], c.mag);
  rp([[45, 18], [53, 18], [53.5, 21], [45.5, 21]], c.furnitureDark);
  for (let v = 7; v < 18; v += 3) rpx(50, v, c.magDark);
  // castello superiore e manetta d'armamento
  rb(26, 53, -6, -1.5, c.gunMid);
  rb(26, 29, -6.5, -5, c.gun);
  rpx(44, -3, c.gunLight);
  // ottica con lenti
  rb(34, 49, -12, -7, c.gun);
  rb(33, 35, -13, -6, c.gunMid);
  rb(48, 50, -13, -6, c.gunMid);
  rb(38, 44, -7, -6, c.gunMid);
  rpx(49, -10, c.optic);
  rpx(49, -9, c.optic);
  rpx(40, -11, c.gunLight);
  // paramano con slitte, impugnatura verticale
  rb(53, 84, -6, 3, c.furniture);
  for (let u = 55; u < 83; u += 3) {
    rpx(u, -5, c.furnitureDark);
    rpx(u, 2, c.furnitureDark);
  }
  rb(53, 84, -6, -5, c.gun);
  rp([[61, 3], [67, 3], [66, 13], [62, 13]], c.gun);
  // canna, blocco gas, mirino, spegnifiamma
  rb(84, 102, -2.5, 0.5, c.gun);
  rb(87, 91, -4.5, 0.5, c.gunMid);
  rb(88, 90, -10, -4, c.gun);
  rb(102, 109, -3, 1, c.gunMid);
  for (const u of [104, 106]) rpx(u, -1, c.gun);
  // cinghia
  for (let i = 0; i < 22; i++) {
    const [x, y] = R(8 + i * 0.4, 5 + i * 0.9);
    rect(g, x, y, 2, 1, c.sling);
  }
  });
  rsh([[0, 2], [109, 0], [109, 1], [0, 5]], 0.35);

  // ===== avambracci e mani sul fucile =====
  const wristR = R(32, 13);
  const wristL = R(64, 13);
  part(() => limb(g, 25, U(94), wristR[0], wristR[1], 13, 11, c.camo));
  limbShade(25, U(94), wristR[0], wristR[1], 13, 11);
  part(() => limb(g, 100, U(90), wristL[0], wristL[1], 13, 11, c.camo));
  limbShade(100, U(90), wristL[0], wristL[1], 13, 11);
  Sl(28, U(98), 36, U(102), 1, 0.4);
  Sl(92, U(84), 86, U(90), 1, 0.4);
  // guanti: dita attorno all'impugnatura e all'impugnatura verticale
  const glove = (u0, u1, v0, v1) => {
    rp([[u0, v0], [u1, v0], [u1 + 1, v1], [u0 - 1, v1]], c.gloves);
    for (let v = v0 + 2; v < v1; v += 2.5) rp([[u0, v], [u1, v], [u1, v + 0.8], [u0, v + 0.8]], c.glovesDark);
    rp([[u0, v0], [u1, v0], [u1, v0 + 1], [u0, v0 + 1]], c.glovesLight);
    rsh([[u1 - 3, v0], [u1, v0], [u1 + 1, v1], [u1 - 3, v1]], 0.35);
  };
  part(() => {
    rb(26, 32, 12, 16, c.cuff);
    rb(30, 35, -2, 4, c.gloves); // pollice sul castello
    glove(29, 40, 4, 14);
  });
  part(() => {
    rb(60, 67, 12, 16, c.cuff);
    rb(58, 66, -8, -4, c.gloves); // pollice sul paramano
    glove(58, 70, 2, 13);
  });

  // ===== rifiniture =====
  const noise = blobNoise(seed + 3, 3.4);
  const hnoise = blobNoise(seed + 5, 3);
  const upper = (x, y) => (y < 112 + M + oy ? y - oy : y);
  camouflage(main.c, c.camo, c.camoSpots || [c.camo], noise, upper);
  camouflage(main.c, c.helmet, c.helmetSpots || [c.helmet], hnoise, upper);
  // kefiah a quadretti
  const SC = hex(c.scarf);
  const SD = hex(c.scarfDark);
  const SP = hex(c.scarfPattern);
  recolor(main.c, c.scarf, (x, y0) => {
    const y = upper(x, y0);
    if ((x + y) % 6 === 0 || (x - y + 60) % 6 === 0) return SP;
    if (x % 6 === 3 && y % 2 === 0) return SD;
    return SC;
  });
  applyMasks(main.c, shade.c, light.c, sc.shadowColor || '#2a1830', sc.lightColor || '#ffd8a0');
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
