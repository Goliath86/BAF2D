// Ritratto del soldato del giocatore visto di fronte, a figura intera, in pixel art procedurale (schermata
// "Soldato" del menu). Ogni parte è una maschera (poligoni/ellissi) riempita con una scala di 6 toni generata dal
// colore base (ombre più fredde, luci più calde), luce da in alto a sinistra con ombreggiatura cilindrica,
// contorno scuro selettivo e ombra portata sulle parti sotto. Le stoffe usano la mimetica scelta.
// look = scelte del giocatore (config/soldier.json -> options), weapon = profilo dell'arma (rifle/shotgun/pistol).

import { hash2, vnoise, bayer, hex } from './menu_art.js';

export const PORTRAIT = { w: 128, h: 196 };

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// ---------- Colori ----------

function rgb2hsl([r, g, b]) {
  r /= 255;
  g /= 255;
  b /= 255;
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  const l = (mx + mn) / 2;
  if (mx === mn) return [0, 0, l];
  const d = mx - mn;
  const s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
  let h;
  if (mx === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (mx === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return [h * 60, s, l];
}

function hsl2rgb(h, s, l) {
  const f = (n) => {
    const k = (n + h / 30) % 12;
    const a = s * Math.min(l, 1 - l);
    return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))));
  };
  return [f(0), f(8), f(4)];
}

const towards = (h, target, deg) => {
  let d = ((target - h + 540) % 360) - 180;
  return (h + clamp(d, -deg, deg) + 360) % 360;
};

/** Scala di 6 toni: 0 contorno, 1 ombra profonda, 2 ombra, 3 base, 4 luce, 5 riflesso. */
export function ramp(base) {
  const [h, s, l] = rgb2hsl(Array.isArray(base) ? base : hex(base));
  const t = (dl, hue, deg, ds) => hsl2rgb(towards(h, hue, deg), clamp(s + ds, 0, 1), clamp(l + dl, 0, 1));
  return [
    t(-Math.min(0.34, l * 0.72), 235, 18, -s * 0.3),
    t(-Math.min(0.2, l * 0.45), 230, 12, -s * 0.22),
    t(-Math.min(0.1, l * 0.24), 225, 6, -s * 0.12),
    hsl2rgb(h, s, l),
    t(Math.min(0.08, (1 - l) * 0.3), 50, 6, -0.02),
    t(Math.min(0.16, (1 - l) * 0.5), 50, 10, -0.06),
  ];
}

// ---------- Tela con maschere ----------

class Canvas {
  constructor(w, h) {
    this.w = w;
    this.h = h;
    this.data = new Uint8ClampedArray(w * h * 4);
  }

  mask() {
    return new Uint8Array(this.w * this.h);
  }

  poly(pts, m = this.mask()) {
    let y0 = Infinity;
    let y1 = -Infinity;
    for (const p of pts) {
      y0 = Math.min(y0, p[1]);
      y1 = Math.max(y1, p[1]);
    }
    for (let y = Math.max(0, Math.floor(y0)); y <= Math.min(this.h - 1, Math.ceil(y1)); y++) {
      const yc = y + 0.5;
      const xs = [];
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i];
        const b = pts[(i + 1) % pts.length];
        if ((a[1] <= yc && b[1] > yc) || (b[1] <= yc && a[1] > yc)) xs.push(a[0] + ((yc - a[1]) / (b[1] - a[1])) * (b[0] - a[0]));
      }
      xs.sort((p, q) => p - q);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        for (let x = Math.max(0, Math.round(xs[k])); x < Math.min(this.w, Math.round(xs[k + 1])); x++) m[y * this.w + x] = 1;
      }
    }
    return m;
  }

  ell(cx, cy, rx, ry, m = this.mask()) {
    for (let y = Math.max(0, Math.floor(cy - ry)); y <= Math.min(this.h - 1, Math.ceil(cy + ry)); y++) {
      for (let x = Math.max(0, Math.floor(cx - rx)); x <= Math.min(this.w - 1, Math.ceil(cx + rx)); x++) {
        const dx = (x + 0.5 - cx) / rx;
        const dy = (y + 0.5 - cy) / ry;
        if (dx * dx + dy * dy <= 1) m[y * this.w + x] = 1;
      }
    }
    return m;
  }

  rect(x0, y0, x1, y1, m = this.mask()) {
    for (let y = Math.max(0, y0); y < Math.min(this.h, y1); y++) for (let x = Math.max(0, x0); x < Math.min(this.w, x1); x++) m[y * this.w + x] = 1;
    return m;
  }

  or(...ms) {
    const m = this.mask();
    for (const a of ms) for (let i = 0; i < m.length; i++) m[i] |= a[i];
    return m;
  }

  and(a, b) {
    const m = this.mask();
    for (let i = 0; i < m.length; i++) m[i] = a[i] & b[i];
    return m;
  }

  minus(a, b) {
    const m = this.mask();
    for (let i = 0; i < m.length; i++) m[i] = a[i] & !b[i];
    return m;
  }

  set(x, y, c, a = 255) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const i = (y * this.w + x) * 4;
    if (a >= 255 || this.data[i + 3] === 0) {
      this.data[i] = c[0];
      this.data[i + 1] = c[1];
      this.data[i + 2] = c[2];
      this.data[i + 3] = Math.max(this.data[i + 3], a);
      return;
    }
    const k = a / 255;
    this.data[i] += (c[0] - this.data[i]) * k;
    this.data[i + 1] += (c[1] - this.data[i + 1]) * k;
    this.data[i + 2] += (c[2] - this.data[i + 2]) * k;
  }

  get(x, y) {
    const i = (y * this.w + x) * 4;
    return [this.data[i], this.data[i + 1], this.data[i + 2], this.data[i + 3]];
  }

  /** Scurisce (k < 1) o schiarisce (k > 1) i pixel dipinti, con un filo di blu nelle ombre. */
  tint(x, y, k) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const i = (y * this.w + x) * 4;
    if (!this.data[i + 3]) return;
    this.data[i] *= k;
    this.data[i + 1] *= k;
    this.data[i + 2] *= k < 1 ? k + (1 - k) * 0.25 : k;
  }

  /** Righe e colonne occupate dalla maschera: estremi per l'ombreggiatura cilindrica. */
  spans(m) {
    const { w, h } = this;
    const row = new Float32Array(h * 2).fill(-1);
    let top = h;
    let bottom = -1;
    for (let y = 0; y < h; y++) {
      let a = -1;
      let b = -1;
      for (let x = 0; x < w; x++) {
        if (!m[y * w + x]) continue;
        if (a < 0) a = x;
        b = x;
      }
      row[y * 2] = a;
      row[y * 2 + 1] = b;
      if (a >= 0) {
        top = Math.min(top, y);
        bottom = Math.max(bottom, y);
      }
    }
    return { row, top, bottom };
  }

  inside(m, x, y) {
    return x >= 0 && y >= 0 && x < this.w && y < this.h && m[y * this.w + x] === 1;
  }

  /**
   * Dipinge una parte: ombra portata sotto (shadow), riempimento con toni (colorAt(x, y, tone) -> [r,g,b]),
   * contorno scuro (outline). light: cyl = forza della luce laterale, vert = sfumatura dall'alto, bias = spinta.
   */
  part(m, colorAt, opt = {}) {
    const { w, h } = this;
    const L = { cyl: 1, vert: 0.5, bias: 0, ...opt.light };
    const sp = this.spans(m);
    if (sp.bottom < 0) return;
    // ombra portata (in basso a destra) sui pixel già dipinti
    if (opt.shadow !== false) {
      for (let y = sp.top; y <= Math.min(h - 1, sp.bottom + 2); y++) {
        for (let x = 0; x < w; x++) {
          if (m[y * w + x]) continue;
          if (this.inside(m, x - 1, y - 1) || this.inside(m, x, y - 1) || (opt.shadow === 'deep' && this.inside(m, x - 1, y - 2))) this.tint(x, y, 0.72);
        }
      }
    }
    for (let y = sp.top; y <= sp.bottom; y++) {
      const a = sp.row[y * 2];
      const b = sp.row[y * 2 + 1];
      const vy = (y - sp.top) / Math.max(1, sp.bottom - sp.top);
      for (let x = a; x <= b; x++) {
        if (!m[y * w + x]) continue;
        const u = b > a ? (x - a) / (b - a) : 0.5;
        let t = 3 + L.cyl * (0.42 - u) * 2.3 + L.vert * (0.35 - vy) + L.bias + (opt.tone ? opt.tone(x, y, u, vy) : 0);
        t += (bayer(x, y) - 0.5) * (opt.dither ?? 0.45);
        let tone = clamp(Math.round(t), 1, 5);
        const edge = !this.inside(m, x - 1, y) || !this.inside(m, x + 1, y) || !this.inside(m, x, y - 1) || !this.inside(m, x, y + 1);
        if (edge && opt.outline !== false) {
          // contorno: pieno in basso e a destra (lato in ombra), più leggero sul lato in luce
          const lit = !this.inside(m, x - 1, y) || !this.inside(m, x, y - 1);
          tone = lit && opt.outline !== 'full' ? Math.max(1, tone - 2) : 0;
        }
        const c = colorAt(x, y, tone);
        if (c) this.set(x, y, c, opt.alpha ?? 255);
      }
    }
  }

  /** Linea di pixel (Bresenham) con colore o funzione (x, y) -> colore. */
  line(x0, y0, x1, y1, c) {
    x0 = Math.round(x0);
    y0 = Math.round(y0);
    x1 = Math.round(x1);
    y1 = Math.round(y1);
    const dx = Math.abs(x1 - x0);
    const dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (let n = 0; n < 500; n++) {
      const col = typeof c === 'function' ? c(x0, y0) : c;
      if (col) this.set(x0, y0, col);
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

  /** Piega della stoffa: solco scuro con il bordo chiaro sopra, solo dentro la maschera. */
  fold(m, x0, y0, x1, y1, k = 0.78) {
    const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
    for (let s = 0; s <= n; s++) {
      const x = Math.round(x0 + ((x1 - x0) * s) / n);
      const y = Math.round(y0 + ((y1 - y0) * s) / n);
      if (this.inside(m, x, y)) this.tint(x, y, k);
      if (this.inside(m, x, y - 1) && s % 2 === 0) this.tint(x, y - 1, 1.1);
    }
  }

  toCanvas() {
    const c = document.createElement('canvas');
    c.width = this.w;
    c.height = this.h;
    const g = c.getContext('2d');
    g.putImageData(new ImageData(this.data, this.w, this.h), 0, 0);
    return c;
  }
}

// ---------- Mimetiche ----------

const PATTERNS = {
  solid: (x, y, s) => (hash2(x, y, s) < 0.06 ? 1 : hash2(x, y, s + 1) < 0.05 ? 2 : 0),
  blotch: (x, y, s) => {
    const a = vnoise(x, y * 1.3, 7, s);
    const b = vnoise(x + 40, y, 5, s + 1);
    if (a > 0.66) return 1;
    if (b > 0.68) return 2;
    if (a < 0.24 && b < 0.4) return 3;
    return 0;
  },
  desert: (x, y, s) => {
    const a = vnoise(x * 1.4, y, 9, s);
    const b = vnoise(x, y, 4, s + 2);
    if (a > 0.64) return 1;
    if (a < 0.28) return 3;
    return b > 0.78 ? 2 : 0;
  },
  multicam: (x, y, s) => {
    const a = vnoise(x, y, 8, s) + (vnoise(x, y, 3, s + 5) - 0.5) * 0.35;
    const b = vnoise(x * 1.6, y * 0.7, 4, s + 1);
    if (b > 0.76 && hash2(x >> 1, y >> 1, s) < 0.7) return 2;
    if (a > 0.6) return 1;
    if (a < 0.3) return 3;
    return 0;
  },
  digital: (x, y, s) => {
    const bx = x >> 1;
    const by = y >> 1;
    const a = vnoise(bx, by, 4, s) + (hash2(bx, by, s) - 0.5) * 0.3;
    if (a > 0.66) return 2;
    if (a > 0.5) return 1;
    if (a < 0.26) return 3;
    return 0;
  },
  tiger: (x, y, s) => {
    const v = Math.sin((y + vnoise(x, y, 9, s) * 14) / 2.6 + x * 0.08);
    if (v > 0.62 && vnoise(x, y, 6, s + 3) > 0.35) return 1;
    if (v < -0.75) return 2;
    return hash2(x, y, s) < 0.04 ? 3 : 0;
  },
};

// ---------- Armi (profilo, coordinate locali: u lungo l'arma verso la volata, v verso il basso) ----------

const WEAPONS = {
  rifle: [
    ['polymer', [[0, -3], [14, -3], [19, -2], [19, 3], [14, 4], [3, 8], [0, 8]]],
    ['rubber', [[0, -3], [2, -3], [2, 8], [0, 8]]],
    ['metal', [[18, -1], [44, -1], [44, 4], [38, 5], [18, 4]]],
    ['metal', [[18, -5.5], [47, -5.5], [47, -1], [18, -1]], 1],
    ['polymer', [[25, 4], [31, 4], [29.5, 13], [23.5, 13]]],
    ['metal', [[31, 4], [38, 4], [38, 6.5], [31, 6.5]]],
    ['metal', [[33, 5], [40, 5], [42.5, 16], [35.5, 17]], -1],
    ['polymer', [[45, -5.5], [69, -5.5], [69, 3], [45, 3]]],
    ['metal', [[69, -2], [78, -2], [78, 1], [69, 1]]],
    ['metal', [[76, -3], [82, -3], [82, 2], [76, 2]], -1],
    ['metal', [[63, -9], [65.5, -9], [65.5, -5], [63, -5]]],
    ['polymer', [[26, -12.5], [38, -12.5], [38, -6], [26, -6]], 1],
    ['metal', [[29, -6], [35, -6], [35, -5], [29, -5]]],
    ['polymer', [[56, 3], [60.5, 3], [60.5, 11], [56, 11]]],
  ],
  shotgun: [
    ['stock', [[0, -3], [21, -2], [23, 2], [21, 4], [3, 9], [0, 9]]],
    ['rubber', [[0, -3], [2, -3], [2, 9], [0, 9]]],
    ['metal', [[20, -4.5], [41, -4.5], [41, 4], [20, 4]], 1],
    ['metal', [[26, 4], [34, 4], [34, 7], [26, 7]]],
    ['metal', [[41, -3.5], [85, -3.5], [85, -0.5], [41, -0.5]], 1],
    ['metal', [[41, -0.5], [77, -0.5], [77, 3], [41, 3]], -1],
    ['stock', [[50, -1.5], [67, -1.5], [67, 5.5], [50, 5.5]]],
  ],
  pistol: [
    ['polymer', [[2, 1], [8, 1], [6.5, 12], [0, 12]]],
    ['metal', [[0, -3.5], [21, -3.5], [21, 1], [0, 1]], 1],
    ['polymer', [[4, 1], [21, 1], [21, 3], [4, 3]]],
    ['polymer', [[8, 3], [13, 3], [13, 6], [8, 6]]],
  ],
};

function inPoly(pts, u, v) {
  let c = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [ui, vi] = pts[i];
    const [uj, vj] = pts[j];
    if (vi > v !== vj > v && u < ((uj - ui) * (v - vi)) / (vj - vi) + ui) c = !c;
  }
  return c;
}

/** Arma di profilo ruotata (origine = calcio, ang = direzione della canna), con dettagli e riflessi. */
function drawWeapon(cv, type, ox, oy, ang, mats) {
  const parts = WEAPONS[type] || WEAPONS.rifle;
  const ca = Math.cos(ang);
  const sa = Math.sin(ang);
  const ramps = {};
  const rampOf = (k) => (ramps[k] ||= ramp(mats[k] || mats.polymer));
  const bounds = parts.map(([, pts]) => {
    let v0 = Infinity;
    let v1 = -Infinity;
    for (const p of pts) {
      v0 = Math.min(v0, p[1]);
      v1 = Math.max(v1, p[1]);
    }
    return [v0, v1];
  });
  const m = cv.mask();
  const info = new Map();
  for (let y = 0; y < cv.h; y++) {
    for (let x = 0; x < cv.w; x++) {
      const dx = x + 0.5 - ox;
      const dy = y + 0.5 - oy;
      const u = dx * ca + dy * sa;
      const v = -dx * sa + dy * ca;
      if (u < -2 || u > 90 || v < -14 || v > 18) continue;
      for (let i = parts.length - 1; i >= 0; i--) {
        if (!inPoly(parts[i][1], u, v)) continue;
        m[y * cv.w + x] = 1;
        info.set(y * cv.w + x, [i, u, v]);
        break;
      }
    }
  }
  cv.part(
    m,
    (x, y, tone) => {
      const [i, u, v] = info.get(y * cv.w + x);
      const [mat, , bias = 0] = parts[i];
      const [v0, v1] = bounds[i];
      let t = tone === 0 ? 0 : 3 + bias;
      if (t) {
        if (v - v0 < 1.1) t += 1;
        else if (v1 - v < 1.3) t -= 1;
        // dettagli: tacche del paramano, slitta, zigrinatura della pompa
        if (type === 'rifle' && i === 7 && Math.floor(u) % 4 === 0 && v > -3 && v < 1) t -= 1;
        if (type === 'rifle' && i === 3 && v - v0 < 1.1 && Math.floor(u) % 2) t -= 1;
        if (type === 'shotgun' && i === 6 && Math.floor(u) % 2 === 0) t -= 1;
        if (type === 'pistol' && i === 1 && u < 6 && Math.floor(u) % 2 === 0) t -= 1;
        if (type === 'rifle' && i === 11 && u > 36.5) return v > -10 && v < -8 ? [196, 64, 50] : [70, 110, 120];
      }
      return rampOf(mat)[clamp(t, 0, 5)];
    },
    { light: { cyl: 0, vert: 0 }, dither: 0, shadow: 'deep' },
  );
  // fucile a pompa: cartucce di scorta sul fianco del castello
  if (type === 'shotgun') {
    for (let k = 0; k < 4; k++) {
      for (let s = 0; s < 3; s++) {
        const u = 23 + k * 4 + 1;
        const v = -2 + s;
        const x = Math.round(ox + u * ca - v * sa);
        const y = Math.round(oy + u * sa + v * ca);
        cv.set(x, y, s === 2 ? [196, 160, 80] : s === 0 ? [150, 40, 34] : [190, 60, 48]);
      }
    }
  }
  return m;
}

// ---------- Il soldato ----------

/**
 * Disegna il soldato: look = { camo, vest, vestColor, headgear, eyewear, beard, beardColor, skin, gloves, boots,
 * headset, shemagh, kneepads } (id delle opzioni), cfg = config/soldier.json, weapon = rifle|shotgun|pistol.
 */
export function drawSoldier(look, cfg, weapon = 'rifle') {
  const O = cfg.options || {};
  const mats = cfg.materials || {};
  const cv = new Canvas(PORTRAIT.w, PORTRAIT.h);
  const camo = O.camo?.[look.camo] || Object.values(O.camo || {})[0] || { pattern: 'solid', colors: ['#5a6040'] };
  const camoR = camo.colors.map((c) => ramp(c));
  const pat = PATTERNS[camo.pattern] || PATTERNS.solid;
  const cloth = (x, y, t) => camoR[Math.min(camoR.length - 1, pat(x, y, 17))][t];
  const vestHex = O.vestColor?.[look.vestColor];
  const vestR = ramp(vestHex && vestHex !== 'camo' ? vestHex : camo.colors[0]);
  const vestCol = vestHex === 'camo' ? cloth : (x, y, t) => vestR[t];
  const skinR = ramp(O.skin?.[look.skin] || '#d9a57f');
  const glovesHex = O.gloves?.[look.gloves];
  const gloveR = glovesHex ? ramp(glovesHex) : skinR;
  const bootR = ramp(O.boots?.[look.boots] || '#b49b73');
  const beardR = ramp(O.beardColor?.[look.beardColor] || '#4b3020');
  const R = (name) => ramp(mats[name] || '#333');
  const polyR = R('polymer');
  const metalR = R('metal');
  const rubberR = R('rubber');
  const on = (k) => look[k] === 'on';

  // ombra a terra
  const ground = cv.ell(64, 189, 31, 4);
  for (let i = 0; i < ground.length; i++) if (ground[i]) cv.set(i % cv.w, Math.floor(i / cv.w), [10, 10, 14], 90);

  // antenna della radio dietro la spalla (tattico pesante)
  if (look.vest === 'heavy') {
    cv.line(87, 50, 93, 6, [34, 36, 34]);
    cv.line(88, 50, 94, 6, [20, 22, 22]);
    cv.set(93, 5, [20, 22, 22]);
  }

  // ---- gambe, ginocchiere, anfibi ----
  const legL = cv.poly([[42, 97], [64, 97], [63.5, 112], [61.5, 145], [60, 170], [47, 170], [44.5, 145], [41.5, 118]]);
  const legR = cv.poly([[86, 97], [64, 97], [64.5, 112], [66.5, 145], [68, 170], [81, 170], [83.5, 145], [86.5, 118]]);
  cv.part(legL, cloth, { light: { cyl: 0.9, vert: 0.2 } });
  cv.part(legR, cloth, { light: { cyl: 0.9, vert: 0.2, bias: -0.25 } });
  // tasche laterali con patta, pieghe all'inguine e alle ginocchia
  for (const [x0, x1, legM] of [[41.5, 50, legL], [78, 86.5, legR]]) {
    const pocket = cv.and(cv.poly([[x0, 116], [x1, 116], [x1, 133], [x0 + 1, 133]]), legM);
    cv.part(pocket, cloth, { light: { cyl: 0.6, vert: 0.8, bias: 0.15 } });
    const flap = cv.and(cv.rect(Math.round(x0), 115, Math.round(x1), 119), legM);
    cv.part(flap, cloth, { light: { cyl: 0.6, vert: 0, bias: 0.35 } });
  }
  cv.fold(legL, 60, 104, 56, 112);
  cv.fold(legR, 68, 104, 72, 112);
  cv.fold(legL, 50, 138, 56, 140);
  cv.fold(legR, 78, 138, 72, 140);
  cv.fold(legL, 47, 158, 52, 160);
  cv.fold(legL, 55, 153, 59, 151);
  cv.fold(legR, 81, 158, 76, 160);
  cv.fold(legR, 73, 153, 69, 151);
  // pantaloni rimboccati sugli anfibi
  for (const [a, b] of [[45.5, 61.5], [66.5, 82.5]]) {
    const cuff = cv.poly([[a + 0.5, 163], [b - 0.5, 163], [b + 0.5, 171], [a - 0.5, 171]]);
    cv.part(cuff, cloth, { light: { cyl: 1, vert: 0, bias: -0.2 }, tone: (x) => (x % 3 === 0 ? -0.8 : 0) });
  }
  if (on('kneepads')) {
    for (const [cx, b] of [[53, 0], [75, -0.3]]) {
      const pad = cv.ell(cx, 146, 7.5, 7);
      cv.part(pad, (x, y, t) => polyR[t], { light: { cyl: 1.1, vert: 0.9, bias: 0.4 + b }, shadow: 'deep' });
      cv.line(cx - 4, 143, cx + 4, 143, polyR[1]);
      cv.set(cx - 2, 141, polyR[5]);
      cv.set(cx - 3, 142, polyR[4]);
      for (const sx of [-8, 7]) cv.line(cx + sx, 145, cx + sx + 1, 148, polyR[0]);
    }
  }
  for (const [cx, b] of [[53.5, 0], [74.5, -0.3]]) {
    const shaft = cv.poly([[cx - 7, 170], [cx + 7, 170], [cx + 7.5, 180], [cx - 7.5, 180]]);
    const toe = cv.and(cv.ell(cx + (cx < 64 ? -0.5 : 0.5), 183, 9, 5.8), cv.rect(0, 176, 128, 187));
    const boot = cv.or(shaft, toe);
    cv.part(boot, (x, y, t) => bootR[t], { light: { cyl: 1.1, vert: 0.6, bias: b }, shadow: 'deep' });
    // lacci incrociati, puntale lucido, suola
    for (let y = 171; y <= 181; y += 2) {
      cv.set(Math.round(cx - 2), y, bootR[0]);
      cv.set(Math.round(cx + 1), y, bootR[0]);
      cv.set(Math.round(cx - 1), y, bootR[4]);
      cv.set(Math.round(cx), y + 1, bootR[4]);
    }
    cv.set(Math.round(cx - 4), 183, bootR[5]);
    cv.set(Math.round(cx - 3), 182, bootR[5]);
    const sole = cv.poly([[cx - 9.5, 185], [cx + 9.5, 185], [cx + 9, 188.5], [cx - 9, 188.5]]);
    cv.part(sole, (x, y, t) => rubberR[t], { light: { cyl: 0.6, vert: 0 }, shadow: false });
  }

  // ---- busto (maglia da combattimento) ----
  const torso = cv.poly([[45, 43], [83, 43], [93, 49], [92, 64], [86, 100], [42, 100], [36, 64], [35, 49]]);
  cv.part(torso, cloth, { light: { cyl: 1, vert: 0.3 } });

  // ---- cinturone, fondina cosciale ----
  const belt = cv.poly([[41, 95], [87, 95], [87.5, 104], [40.5, 104]]);
  cv.part(belt, vestCol, { light: { cyl: 0.8, vert: 0.6, bias: -0.2 }, tone: (x, y) => (y === 99 ? -0.8 : 0) });
  const buckle = cv.rect(59, 96, 69, 103);
  cv.part(buckle, (x, y, t) => metalR[t], { light: { cyl: 0.8, vert: 0.8, bias: 0.3 } });
  cv.line(60, 99, 67, 99, metalR[1]);
  cv.set(60, 97, metalR[5]);
  for (const [x0, x1] of [[42, 49], [79, 86]]) {
    const pouch = cv.poly([[x0, 96], [x1, 96], [x1 + 0.5, 109], [x0 - 0.5, 109]]);
    cv.part(pouch, vestCol, { light: { cyl: 1, vert: 0.8, bias: 0.1 }, shadow: 'deep' });
    cv.part(cv.rect(x0, 96, x1, 99), vestCol, { light: { cyl: 0.8, vert: 0, bias: 0.4 } });
  }
  if (weapon !== 'pistol') {
    // fondina cosciale con la pistola, cinghie attorno alla coscia
    for (const y of [114, 124]) cv.part(cv.and(cv.rect(41, y, 60, y + 2), legL), (x, y2, t) => rubberR[t], { light: { cyl: 1, vert: 0 } });
    const holster = cv.poly([[40.5, 105], [50, 105], [51, 128], [42, 129]]);
    cv.part(holster, (x, y, t) => polyR[t], { light: { cyl: 1, vert: 0.6, bias: 0.2 }, shadow: 'deep' });
    const grip = cv.poly([[42, 100], [48, 100], [49, 106], [42.5, 106]]);
    cv.part(grip, (x, y, t) => polyR[t], { light: { cyl: 1, vert: 0.8, bias: 0.4 } });
    cv.line(43, 108, 49, 108, polyR[1]);
  }

  // ---- tattico ----
  drawVest(cv, look.vest, vestCol, cloth, { polyR, metalR, rubberR });

  // ---- braccia, arma, mani ----
  const shoulderL = cv.or(cv.poly([[34, 47], [46, 46], [45, 68], [43, 86], [31, 86], [30.5, 66]]), cv.ell(40, 52, 7.5, 7.5));
  const shoulderR = cv.or(cv.poly([[82, 46], [94, 47], [97.5, 66], [97, 88], [85, 88], [83, 68]]), cv.ell(88, 52, 7.5, 7.5));
  cv.part(shoulderL, cloth, { light: { cyl: 1.1, vert: 0.4 } });
  cv.part(shoulderR, cloth, { light: { cyl: 1.1, vert: 0.4, bias: -0.2 } });
  // tasche sulle maniche con la toppa
  for (const [x0, b] of [[34, 0.3], [87, 0]]) {
    const pk = cv.poly([[x0, 58], [x0 + 8, 58], [x0 + 8, 70], [x0 + 0.5, 70]]);
    cv.part(cv.and(pk, x0 < 64 ? shoulderL : shoulderR), cloth, { light: { cyl: 0.6, vert: 0.6, bias: b } });
    const patch = cv.rect(x0 + 2, 60, x0 + 7, 64);
    const patchR = ramp(x0 < 64 ? '#3b4048' : '#5a4e3a'); // scala calcolata una volta, non per pixel
    cv.part(patch, (x, y, t) => patchR[t], { light: { cyl: 0.5, vert: 0.5 }, shadow: false });
  }
  cv.fold(shoulderL, 33, 78, 40, 80);
  cv.fold(shoulderR, 95, 79, 88, 81);

  let handL;
  let handR;
  let foreL;
  let foreR;
  if (weapon === 'pistol') {
    foreL = cv.poly([[31, 83], [43, 83], [60, 103], [54, 110]]);
    foreR = cv.poly([[97, 83], [85, 83], [68, 103], [74, 110]]);
    cv.part(foreL, cloth, { light: { cyl: 1, vert: 0.3 } });
    cv.part(foreR, cloth, { light: { cyl: 1, vert: 0.3, bias: -0.2 } });
    handL = cv.poly([[54, 101], [64, 100], [65, 112], [58, 114], [53, 109]]);
    handR = cv.poly([[64, 100], [74, 101], [75, 109], [70, 114], [64, 112]]);
  } else {
    // braccio destro (a sinistra) all'impugnatura, sinistro (a destra) sotto il paramano
    foreL = cv.poly([[31, 83], [43, 83], [55, 103], [47, 109]]);
    cv.part(foreL, cloth, { light: { cyl: 1, vert: 0.3 } });
    cv.fold(foreL, 35, 90, 41, 88);
    const ang = 0.5;
    // cinghia dal paramano alla spalla sinistra
    cv.line(84, 112, 84, 60, rubberR[2]);
    cv.line(85, 112, 85, 60, rubberR[3]);
    drawWeapon(cv, weapon === 'shotgun' ? 'shotgun' : 'rifle', 28, 89, ang, mats);
    foreR = cv.poly([[85, 85], [97.5, 85], [86, 118], [79, 115]]);
    cv.part(foreR, cloth, { light: { cyl: 1, vert: 0.3, bias: -0.2 } });
    cv.fold(foreR, 92, 92, 88, 96);
    handL = cv.poly([[45, 102], [55, 101], [58, 109], [54, 115], [46, 113]]);
    handR = cv.poly([[74, 114], [84, 112], [87, 119], [82, 125], [75, 123]]);
  }
  // polsini
  for (const [m, x0, y0, x1, y1] of weapon === 'pistol' ? [[foreL, 52, 102, 57, 110], [foreR, 71, 102, 76, 110]] : [[foreL, 45, 100, 54, 110], [foreR, 78, 110, 88, 118]]) {
    cv.part(cv.and(cv.rect(x0, y0, x1, y1), m), cloth, { light: { cyl: 0.8, vert: 0, bias: -0.4 }, shadow: false });
  }
  for (const [m, b] of [[handL, 0.2], [handR, 0]]) {
    cv.part(m, (x, y, t) => gloveR[t], { light: { cyl: 1, vert: 0.6, bias: b }, shadow: 'deep', dither: 0.2 });
  }
  // dita: solchi tra le falangi e nocche in luce
  const fingers = (x0, y0, n, dx, dy, len) => {
    for (let k = 0; k < n; k++) {
      const x = x0 + dx * k;
      const y = y0 + dy * k;
      cv.line(x, y, x + len, y + 0.6, gloveR[1]);
      cv.set(Math.round(x), Math.round(y - 1), gloveR[5]);
    }
  };
  if (weapon === 'pistol') {
    // pistola puntata in basso davanti alle mani, pollici incrociati sopra il carrello
    drawWeapon(cv, 'pistol', 62.5, 106, 1.42, mats);
    fingers(55, 103, 4, 0, 2.2, 4);
    fingers(68, 103, 4, 0, 2.2, 4);
    cv.part(cv.poly([[58, 102], [66, 104], [65, 107], [57, 105]]), (x, y, t) => gloveR[t], { light: { cyl: 1, vert: 0.6, bias: 0.3 }, shadow: 'deep' });
  } else {
    fingers(48, 105, 4, 0.4, 2.2, 6);
    fingers(77, 117, 3, 1.5, 1.6, 5);
    if (glovesHex) cv.line(48, 103, 53, 102, gloveR[4]); // paranocche
  }

  // ---- collo, colletto, shemagh, testa ----
  // collo in ombra sotto la testa: pelle più scura e meno satura (le ombre rosse sembrano scottature)
  const neck = cv.poly([[58.5, 36], [69.5, 36], [70.5, 47], [57.5, 47]]);
  const [sh, ss, sl] = rgb2hsl(skinR[3]);
  const neckR = ramp(hsl2rgb(sh, ss * 0.6, sl * 0.8));
  cv.part(neck, (x, y, t) => neckR[Math.min(t, 4)], { light: { cyl: 1.2, vert: 0, bias: 0 }, shadow: false, dither: 0.2 });
  if (on('shemagh')) {
    const [c1, c2] = (mats.shemagh || ['#d8cfb8', '#3b3a36']).map((c) => ramp(c));
    const sh = cv.poly([[51, 40], [77, 40], [81, 46], [78, 53], [64, 56], [50, 53], [47, 46]]);
    cv.part(sh, (x, y, t) => ((((x >> 1) + (y >> 1)) & 1) && ((x + y) & 1) ? c2 : c1)[t], { light: { cyl: 1, vert: 0.7, bias: 0.2 } });
    cv.fold(sh, 52, 47, 60, 50);
    cv.fold(sh, 76, 47, 68, 50);
    cv.fold(sh, 58, 53, 70, 53);
  } else {
    for (const pts of [[[52, 42], [59, 44], [60, 50], [50, 50]], [[76, 42], [69, 44], [68, 50], [78, 50]]]) {
      cv.part(cv.poly(pts), cloth, { light: { cyl: 0.6, vert: 0.6, bias: 0.3 } });
    }
  }
  drawHead(cv, look, { skinR, beardR, cloth, polyR, metalR, rubberR, mats, on, camo: camoR });

  return cv.toCanvas();
}

/** Tattico: slick (solo piastre), rig (pettorina sulla maglia), standard, heavy (pieno di tasche). */
function drawVest(cv, style, vestCol, cloth, { polyR, metalR, rubberR }) {
  const molle = (m, y0, y1) => {
    for (let y = y0; y <= y1; y += 4) {
      for (let x = 0; x < cv.w; x++) {
        if (!cv.inside(m, x, y)) continue;
        cv.tint(x, y, 0.8);
        if (x % 6 === 0) cv.tint(x, y + 1, 0.85);
      }
    }
  };
  const pouch = (x0, y0, w, h, open, bias = 0) => {
    const body = cv.poly([[x0, y0], [x0 + w, y0], [x0 + w + 0.4, y0 + h], [x0 - 0.4, y0 + h]]);
    if (open) {
      // caricatore che spunta, elastico con la linguetta
      const mag = cv.rect(Math.round(x0 + 1), y0 - 3, Math.round(x0 + w - 1), y0 + 1);
      cv.part(mag, (x, y, t) => metalR[t], { light: { cyl: 0.8, vert: 0.5, bias: 0.3 } });
    }
    cv.part(body, vestCol, { light: { cyl: 1, vert: 0.9, bias }, shadow: 'deep' });
    if (!open) {
      const flap = cv.rect(Math.round(x0), y0, Math.round(x0 + w), y0 + 4);
      cv.part(flap, vestCol, { light: { cyl: 0.8, vert: 0.4, bias: bias + 0.4 } });
    }
    const tx = Math.round(x0 + w / 2 - 1);
    cv.part(cv.rect(tx, y0 + (open ? -1 : 3), tx + 2, y0 + (open ? 1 : 6)), (x, y, t) => rubberR[t], { light: { cyl: 0.5, vert: 0.5, bias: 0.6 } });
    // cuciture verticali
    for (let y = y0 + 6; y < y0 + h - 1; y += 2) {
      cv.tint(Math.round(x0 + 1), y, 1.12);
      cv.tint(Math.round(x0 + w - 2), y, 0.9);
    }
  };
  const grenade = (cx, cy) => {
    const g = cv.ell(cx, cy, 3.6, 4.2);
    cv.part(g, vestCol, { light: { cyl: 1, vert: 1, bias: 0.2 }, shadow: 'deep' });
    cv.part(cv.rect(cx - 1, cy - 6, cx + 2, cy - 3), (x, y, t) => metalR[t], { light: { cyl: 0.6, vert: 0.3, bias: 0.2 } });
  };
  const straps = (pts) => {
    for (const p of pts) cv.part(cv.poly(p), vestCol, { light: { cyl: 1, vert: 0.5, bias: 0.2 }, shadow: 'deep' });
  };

  if (style === 'rig') {
    straps([[[48, 42], [55, 42], [53, 68], [47, 68]], [[80, 42], [73, 42], [75, 68], [81, 68]]]);
    const panel = cv.poly([[44, 66], [84, 66], [85, 91], [43, 91]]);
    cv.part(panel, vestCol, { light: { cyl: 1, vert: 0.4 }, shadow: 'deep' });
    molle(panel, 70, 90);
    for (let k = 0; k < 4; k++) pouch(46 + k * 9.5, 72, 7, 17, k % 3 !== 0);
    pouch(48, 66, 6, 6, false, 0.2);
    pouch(74, 66, 6, 6, false, 0);
    return;
  }

  // portapiastre: fasce laterali, spallacci imbottiti, piastra frontale
  for (const p of [[[37.5, 63], [45, 63], [45, 95], [39, 95]], [[83, 63], [90.5, 63], [89, 95], [83, 95]]]) {
    cv.part(cv.poly(p), vestCol, { light: { cyl: 0.6, vert: 0.3, bias: -0.3 } });
  }
  straps([[[47, 41], [57, 41], [58, 52], [46, 52]], [[81, 41], [71, 41], [70, 52], [82, 52]]]);
  const plate = cv.poly([[46, 48], [82, 48], [85, 54], [85, 93], [81, 97], [47, 97], [43, 93], [43, 54]]);
  cv.part(plate, vestCol, { light: { cyl: 0.9, vert: 0.5, bias: 0.1 }, shadow: 'deep' });
  // maniglia di trascinamento sullo spallaccio, bordino
  cv.line(48, 52, 56, 52, vestCol(0, 0, 1) || rubberR[1]);
  molle(plate, 58, 94);

  if (style === 'slick') {
    // pannello in velcro e piccola tasca amministrativa
    const panel = cv.rect(48, 64, 80, 92);
    cv.part(panel, vestCol, { light: { cyl: 0.6, vert: 0.4, bias: -0.15 }, tone: (x, y) => (hash2(x, y, 3) < 0.25 ? -0.7 : 0) });
    pouch(55, 53, 18, 9, false, 0.1);
    const patch = cv.rect(59, 70, 70, 77);
    const patchR = ramp('#454a3c');
    cv.part(patch, (x, y, t) => patchR[t], { light: { cyl: 0.4, vert: 0.4 }, shadow: false });
    cv.line(60, 73, 68, 73, ramp('#7d8466')[4]);
    return;
  }

  if (style === 'standard') {
    pouch(54, 52, 20, 12, false, 0.1);
    const patch = cv.rect(57, 54, 71, 58);
    const patchR = ramp('#43483a');
    cv.part(patch, (x, y, t) => patchR[t], { light: { cyl: 0.4, vert: 0.4 }, shadow: false });
    for (let k = 0; k < 3; k++) pouch(50.5 + k * 9.5, 72, 8, 19, true, 0.05 * (1 - k));
    // radio sul fianco
    const radio = cv.poly([[84, 62], [91, 62], [91, 84], [84, 84]]);
    cv.part(radio, vestCol, { light: { cyl: 1, vert: 0.6, bias: -0.1 }, shadow: 'deep' });
    cv.part(cv.rect(86, 58, 89, 63), (x, y, t) => polyR[t], { light: { cyl: 0.8, vert: 0.4 } });
    return;
  }

  // pesante: due file di tasche, granate, kit medico, tubo dell'idratazione
  pouch(45.5, 52, 8, 11, false, 0.25);
  grenade(59, 58);
  grenade(68, 58);
  pouch(74.5, 52, 9, 11, false, -0.05);
  const medR = ramp('#8b2a24');
  cv.part(cv.rect(76, 54, 83, 57), (x, y, t) => medR[t],{ light: { cyl: 0.5, vert: 0.4, bias: 0.3 }, shadow: false });
  cv.set(79, 55, [230, 220, 210]);
  cv.set(78, 55, [230, 220, 210]);
  cv.set(80, 55, [230, 220, 210]);
  cv.set(79, 54, [230, 220, 210]);
  cv.set(79, 56, [230, 220, 210]);
  for (let k = 0; k < 4; k++) pouch(45.5 + k * 9.5, 72, 7.5, 20, true, 0.05 * (1 - k));
  for (let y = 44; y < 78; y++) {
    const x = 50 + Math.round(Math.sin(y * 0.15) * 1.2);
    cv.set(x, y, rubberR[2]);
    cv.set(x + 1, y, rubberR[3]);
  }
  cv.part(cv.rect(49, 77, 53, 80), (x, y, t) => rubberR[t], { light: { cyl: 0.6, vert: 0.4, bias: 0.4 } });
}

/** Testa: orecchie, volto (occhi, naso, bocca), barba, occhiali, cuffie, copricapo. */
function drawHead(cv, look, { skinR, beardR, cloth, polyR, metalR, rubberR, mats, on }) {
  const ear = (cx) => {
    const m = cv.ell(cx, 31, 2, 3.4);
    cv.part(m, (x, y, t) => skinR[t], { light: { cyl: 1, vert: 0.5, bias: -0.3 }, shadow: false });
    cv.set(cx < 64 ? Math.round(cx) : Math.round(cx) - 1, 31, skinR[1]);
  };
  ear(54.5);
  ear(73.5);
  const face = cv.poly([[56, 19], [72, 19], [73.5, 26], [73, 33], [70.5, 38.5], [66.5, 42], [61.5, 42], [57.5, 38.5], [55, 33], [54.5, 26]]);
  cv.part(face, (x, y, t) => skinR[t], {
    light: { cyl: 1.2, vert: 0.2, bias: 0.15 },
    shadow: false,
    dither: 0.3,
    // zigomi in luce, guance incavate in ombra
    tone: (x, y) => (y >= 33 && y <= 36 && x > 66 ? -0.6 : 0) + (y >= 30 && y <= 31 && x < 60 ? 0.4 : 0),
  });
  // ombra della tesa sulla fronte
  for (let x = 55; x < 74; x++) {
    cv.tint(x, 24, 0.7);
    cv.tint(x, 25, 0.84);
  }
  const brow = beardR[1];
  // sopracciglia, occhi (bianco, iride, palpebra), naso, bocca
  for (const [a, dir] of [[57, 1], [67, -1]]) {
    for (let k = 0; k < 4; k++) cv.set(a + k, 27 - (k === (dir > 0 ? 1 : 2) ? 1 : 0), brow);
  }
  const eyeW = hex(mats.eye || '#d6d0c6');
  const iris = hex(mats.iris || '#3b2a1e');
  for (const [a, irisX] of [[58, 60], [67, 68]]) {
    cv.line(a, 28, a + 3, 28, skinR[1]);
    cv.set(a, 29, skinR[1]);
    cv.set(a + 1, 29, eyeW);
    cv.set(a + 2, 29, eyeW);
    cv.set(a + 3, 29, skinR[2]);
    cv.set(irisX, 29, iris);
    cv.set(a + 1, 30, skinR[2]);
    cv.set(a + 2, 30, skinR[2]);
  }
  cv.set(64, 29, skinR[4]);
  for (let y = 29; y <= 33; y++) cv.set(65, y, skinR[2]);
  cv.set(64, 33, skinR[5]);
  cv.set(63, 34, skinR[4]);
  cv.set(62, 35, skinR[1]);
  cv.set(63, 35, skinR[2]);
  cv.set(65, 35, skinR[1]);
  cv.set(66, 34, skinR[2]);
  // bocca: fessura scura, labbro inferiore appena in luce, ombra sotto il labbro
  cv.line(61, 37, 66, 37, skinR[1]);
  cv.set(60, 37, skinR[2]);
  cv.set(67, 37, skinR[2]);
  cv.line(62, 38, 65, 38, skinR[4]);
  cv.line(62, 39, 65, 39, skinR[2]);
  // sotto il mento, ombra sul collo
  for (let x = 59; x <= 69; x++) {
    cv.set(x, 43, skinR[1]);
    if (x > 59 && x < 69) cv.set(x, 44, skinR[2]);
  }
  // barba
  const b = look.beard;
  if (b && b !== 'none') {
    const jaw = cv.and(face, cv.or(cv.rect(0, 34, 128, 60), cv.rect(0, 31, 59, 34), cv.rect(70, 31, 128, 34)));
    const mouth = cv.rect(61, 37, 68, 39);
    let m;
    if (b === 'stubble') m = jaw;
    else if (b === 'goatee') m = cv.minus(cv.or(cv.poly([[60, 36.5], [68, 36.5], [67.5, 42.5], [64, 44], [60.5, 42.5]]), cv.rect(60, 35, 68, 37)), mouth);
    else if (b === 'short') m = cv.minus(cv.or(jaw, cv.rect(60, 35, 68, 37)), mouth);
    else m = cv.minus(cv.or(jaw, cv.rect(59, 35, 69, 37), cv.poly([[56, 36], [72, 36], [70, 45], [64, 48.5], [58, 45]])), mouth);
    if (b === 'stubble') {
      for (let i = 0; i < m.length; i++) {
        if (!m[i]) continue;
        const x = i % cv.w;
        const y = Math.floor(i / cv.w);
        if (hash2(x, y, 5) < 0.45) cv.set(x, y, beardR[2], 150);
      }
    } else {
      cv.part(m, (x, y, t) => beardR[t], {
        light: { cyl: 1, vert: 0.5, bias: 0.2 },
        shadow: false,
        tone: (x, y) => (hash2(x, y >> 1, 9) > 0.62 ? 0.9 : 0) - (hash2(x, y, 10) > 0.8 ? 0.9 : 0),
      });
      cv.line(61, 38, 67, 38, beardR[2]);
      cv.line(63, 38, 65, 38, skinR[2]); // labbro inferiore
      cv.line(61, 37, 66, 37, beardR[0]);
    }
  }

  // occhiali
  const ew = look.eyewear;
  if (ew === 'sunglasses') {
    const lensR = ramp(mats.lens || '#16191d');
    for (const a of [56.5, 66.5]) {
      const l = cv.poly([[a, 27], [a + 6, 27], [a + 5.5, 31.5], [a + 0.5, 31.5]]);
      cv.part(l, (x, y, t) => lensR[t], { light: { cyl: 0.4, vert: 1.4, bias: 0.2 }, shadow: 'deep', outline: 'full' });
      cv.set(Math.round(a + 1), 28, [150, 170, 190]);
      cv.set(Math.round(a + 2), 28, [110, 130, 150]);
      cv.set(Math.round(a + 1), 29, [90, 105, 125]);
    }
    cv.line(62, 28, 66, 28, lensR[0]);
    cv.line(55, 28, 56, 28, lensR[0]);
    cv.line(72, 28, 73, 28, lensR[0]);
  } else if (ew === 'ballistic') {
    const am = ramp(mats.amber || '#c88a2c');
    const l = cv.poly([[55, 26.5], [73, 26.5], [72.5, 31.5], [66, 32], [64, 30.5], [62, 32], [55.5, 31.5]]);
    cv.part(l, (x, y, t) => am[t], { light: { cyl: 0.8, vert: 1.2, bias: 0.2 }, shadow: 'deep', alpha: 225 });
    cv.line(57, 27, 61, 27, am[5]);
    cv.line(67, 27, 70, 27, am[5]);
    cv.set(58, 28, [255, 245, 220]);
  }

  // cuffie con il microfono
  if (on('headset')) {
    const hr = ramp(mats.headset || '#3b4030');
    for (const cx of [51.5, 76.5]) {
      const cup = cv.or(cv.ell(cx, 30.5, 4.2, 5.8), cv.rect(Math.round(cx - 3), 26, Math.round(cx + 3), 36));
      cv.part(cup, (x, y, t) => hr[t], { light: { cyl: 1.2, vert: 0.8, bias: cx < 64 ? 0.2 : -0.1 }, shadow: 'deep' });
      cv.line(Math.round(cx - 1), 28, Math.round(cx - 1), 33, hr[1]);
    }
    cv.line(51, 35, 58, 38, rubberR[1]);
    cv.part(cv.rect(58, 37, 61, 40), (x, y, t) => rubberR[t], { light: { cyl: 0.6, vert: 0.5, bias: 0.5 } });
  }

  // maschera (goggles): alzata sull'elmetto (y0 = 14) oppure, con cappellino o boonie, indossata sugli occhi
  const goggles = (y0, strap) => {
    if (look.eyewear !== 'goggles') return;
    cv.part(strap, (x, y, t) => rubberR[t], { light: { cyl: 1, vert: 0 }, shadow: false });
    const frame = cv.poly([[53, y0], [75, y0], [74, y0 + 7], [66, y0 + 7], [64, y0 + 5.5], [62, y0 + 7], [54, y0 + 7]]);
    cv.part(frame, (x, y, t) => rubberR[t], { light: { cyl: 0.8, vert: 0.8, bias: 0.3 }, shadow: 'deep' });
    const lensR = ramp(mats.lens || '#16191d');
    for (const a of [55, 66]) {
      const l = cv.rect(a, y0 + 1, a + 7, y0 + 6);
      cv.part(l, (x, y, t) => lensR[t], { light: { cyl: 0.4, vert: 1.4, bias: 0.4 }, shadow: false, outline: false });
      cv.set(a + 1, y0 + 2, [160, 180, 200]);
      cv.set(a + 2, y0 + 2, [120, 140, 160]);
    }
  };
  // elastico sugli occhi: attorno alla testa, visibile ai lati del volto
  const eyeStrap = (y0) => cv.or(cv.rect(50, y0 + 2, 54, y0 + 4), cv.rect(74, y0 + 2, 78, y0 + 4));

  // copricapo
  const hg = look.headgear;
  if (hg === 'boonie') {
    const crown = cv.and(cv.ell(64, 17, 12.5, 9.5), cv.rect(0, 0, 128, 24));
    cv.part(crown, cloth, { light: { cyl: 1, vert: 0.7, bias: 0.1 }, shadow: false });
    cv.part(cv.and(crown, cv.rect(0, 19, 128, 22)), cloth, { light: { cyl: 1, vert: 0, bias: -0.5 }, shadow: false });
    const brim = cv.minus(cv.ell(64, 23.5, 21, 4.6), cv.rect(0, 0, 128, 20));
    cv.part(brim, cloth, { light: { cyl: 0.8, vert: 1.2, bias: 0 }, shadow: 'deep' });
    for (let x = 46; x < 82; x += 3) cv.tint(x, 25, 0.82);
    goggles(26, eyeStrap(26));
    return;
  }
  if (hg === 'cap') {
    const crown = cv.and(cv.ell(64, 19.5, 12.5, 9.5), cv.rect(0, 0, 128, 24));
    cv.part(crown, cloth, { light: { cyl: 1.1, vert: 0.8, bias: 0.2 }, shadow: false });
    cv.fold(crown, 64, 11, 64, 22, 0.85);
    cv.part(cv.rect(62, 10, 66, 12), cloth, { light: { cyl: 0.5, vert: 0, bias: 0.6 }, shadow: false });
    const visor = cv.poly([[52, 22.5], [76, 22.5], [74, 27], [54, 27]]);
    cv.part(visor, cloth, { light: { cyl: 0.8, vert: 1.4, bias: -0.1 }, shadow: 'deep' });
    // toppa col velcro
    const velcro = ramp('#3e4235');
    cv.part(cv.rect(59, 14, 69, 19), (x, y, t) => velcro[t], { light: { cyl: 0.4, vert: 0.4 }, shadow: false });
    goggles(26, eyeStrap(26));
    return;
  }
  // elmetto balistico con la copertura mimetica, binari laterali, attacco per il visore, elastici
  const dome = cv.minus(cv.and(cv.ell(64, 21.5, 14.5, 13), cv.rect(0, 0, 128, 26)), cv.or(cv.rect(0, 22, 53, 30), cv.rect(76, 22, 128, 30)));
  cv.part(dome, cloth, { light: { cyl: 1.1, vert: 0.9, bias: 0.15 }, shadow: false });
  cv.part(cv.and(dome, cv.rect(0, 24, 128, 26)), cloth, { light: { cyl: 1, vert: 0, bias: -0.7 }, shadow: false });
  for (const x0 of [49, 76]) {
    cv.part(cv.rect(x0, 15, x0 + 3, 23), (x, y, t) => polyR[t], { light: { cyl: 0.8, vert: 0.5, bias: 0.2 } });
    for (let y = 16; y < 23; y += 2) cv.set(x0 + 1, y, polyR[1]);
  }
  const coverR = ramp('#3f4336');
  cv.part(cv.rect(58, 10, 70, 14), (x, y, t) => coverR[t],{ light: { cyl: 0.5, vert: 0.4 }, shadow: false, tone: (x, y) => (hash2(x, y, 4) < 0.3 ? -0.7 : 0) });
  for (const y of [15, 21]) cv.fold(dome, 51, y + 2, 77, y + 2, 0.7);
  const shroud = cv.poly([[60, 16], [68, 16], [69, 22], [59, 22]]);
  cv.part(shroud, (x, y, t) => metalR[t], { light: { cyl: 0.9, vert: 0.7, bias: 0.2 }, shadow: 'deep' });
  cv.set(61, 19, metalR[1]);
  cv.set(66, 19, metalR[1]);
  if (hg === 'helmetNvg') {
    // visore notturno ribaltato in su sul supporto
    const arm = cv.rect(62, 8, 66, 17);
    cv.part(arm, (x, y, t) => metalR[t], { light: { cyl: 0.8, vert: 0.4, bias: 0.1 } });
    const glassR = ramp(mats.glass || '#253a2c');
    for (const cx of [59, 69]) {
      const tube = cv.ell(cx, 7, 4.3, 4.3);
      cv.part(tube, (x, y, t) => rubberR[t], { light: { cyl: 1, vert: 0.8, bias: 0.4 }, shadow: 'deep' });
      const lens = cv.ell(cx, 7, 2.2, 2.2);
      cv.part(lens, (x, y, t) => glassR[t],{ light: { cyl: 1, vert: 1, bias: 0.3 }, shadow: false, outline: false });
      cv.set(cx - 1, 6, [140, 220, 160]);
    }
  }
  // maschera alzata sull'elmetto, elastico attorno
  goggles(14, cv.and(dome, cv.rect(0, 17, 128, 19)));
}
