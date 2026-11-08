// Disegni a pixel della scena del menu (js/menu_scene.js): primitive senza antialiasing e generatori procedurali
// di sagome in controluce: città in rovina, terreno con ostacoli, soldati in marcia, elicottero, caccia, luna,
// nuvole. Colori e misure in config/menu_scene.json.

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

/** Generatore casuale stabile per l'elemento i di una serie (stessa i = stesso risultato). */
export const rngFor = (i, salt) => mulberry32(Math.imul(i, 73856093) ^ Math.imul(salt + 1, 19349663));

export const rnd = (a, b) => a + Math.random() * (b - a);
export const range = (r, d = [0, 1]) => rnd(...(Array.isArray(r) ? r : d));
export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
export const lerp = (a, b, t) => a + (b - a) * t;

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
  if (color) g.fillStyle = color;
  g.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
}

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

export function line(g, x0, y0, x1, y1, w, color) {
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

/**
 * Luce di controluce sulle sagome: i pixel pieni con il vuoto sopra (o di lato, side = -1/+1) prendono il colore
 * della luce, i successivi "depth" pixel sfumano a retino.
 */
export function rimLight(canvas, color, { amount = 0.8, depth = 2, side = 0, sideAmount = 0.5 } = {}) {
  const W = canvas.width;
  const H = canvas.height;
  const g = canvas.getContext('2d', { willReadFrequently: true });
  const img = g.getImageData(0, 0, W, H);
  const d = img.data;
  const src = new Uint8ClampedArray(d);
  const a = (x, y) => (x < 0 || y < 0 || x >= W || y >= H ? 0 : src[(y * W + x) * 4 + 3]);
  const L = hex(color);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      if (!src[i + 3]) continue;
      let k = 0;
      for (let s = 1; s <= depth; s++) {
        if (!a(x, y - s)) {
          k = s === 1 ? amount : amount * (1 - (s - 1) / depth) * (bayer(x, y) < 0.5 ? 1 : 0);
          break;
        }
      }
      if (!k && side && !a(x + side, y)) k = sideAmount;
      if (!k) continue;
      const c = mixRGB([src[i], src[i + 1], src[i + 2]], L, k);
      d[i] = c[0];
      d[i + 1] = c[1];
      d[i + 2] = c[2];
    }
  }
  g.putImageData(img, 0, 0);
}

// ---------- Cielo: luna e nuvole ----------

/** Luna con mari scuri, lato in ombra e un alone a fasce. */
export function makeMoon(cfg) {
  const R = cfg.radius ?? 13;
  const HR = cfg.halo ?? 34;
  const { c, g } = makeCanvas(HR * 2 + 2, HR * 2 + 2);
  const cx = HR + 1;
  const cy = HR + 1;
  const halo = hex(cfg.haloColor || '#c8a8c8');
  for (let y = 0; y < c.height; y++) {
    for (let x = 0; x < c.width; x++) {
      const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
      if (d <= R || d >= HR) continue;
      const k = ((1 - (d - R) / (HR - R)) ** 2) * (cfg.haloAlpha ?? 0.35);
      const q = Math.floor(k * 12 + bayer(x, y)) / 12;
      if (q <= 0) continue;
      g.fillStyle = `rgba(${halo[0]},${halo[1]},${halo[2]},${q})`;
      g.fillRect(x, y, 1, 1);
    }
  }
  disc(g, cx, cy, R, cfg.color || '#f2e6d4');
  const r = mulberry32(cfg.seed ?? 3);
  for (let i = 0; i < 7; i++) {
    const a = r() * Math.PI * 2;
    const dd = r() * R * 0.6;
    disc(g, cx + Math.cos(a) * dd - 1, cy + Math.sin(a) * dd, 1 + r() * R * 0.28, cfg.maria || '#cbb8a8');
  }
  for (let y = -R; y <= R; y++) {
    for (let x = -R; x <= R; x++) {
      if (x * x + y * y > R * R) continue;
      const t = (x + R) / (2 * R);
      if (t > 0.72 + bayer(x + 52, y + 52) * 0.18) {
        g.fillStyle = cfg.shade || '#9a86a0';
        g.fillRect(cx + x, cy + y, 1, 1);
      }
    }
  }
  return c;
}

/** Nuvola notturna a sbuffi: scura in alto, accesa dal basso dal riverbero degli incendi, bordi sfumati a retino. */
export function makeCloudStreak(cfg, w, h, seed) {
  const r = mulberry32(seed);
  const { c, g } = makeCanvas(w + 8, h + 6);
  const base = h + 2;
  const puffs = [];
  let x = 6;
  while (x < w) {
    const k = 1 - Math.abs(x / w - 0.5) * 1.3;
    const ry = Math.max(2, h * (0.35 + r() * 0.5) * Math.max(0.3, k));
    puffs.push([x, base - ry * 0.55, 5 + r() * 9, ry]);
    x += 4 + r() * 8;
  }
  for (const [px, py, rx, ry] of puffs) ellipseRows(g, px, py + r() * 2, rx, ry, '#fff', -Infinity, base + 2);
  const img = g.getImageData(0, 0, c.width, c.height);
  const d = img.data;
  const top = hex(cfg.top);
  const mid = hex(cfg.mid);
  const lit = hex(cfg.lit);
  const W = c.width;
  const a = (xx, yy) => (xx < 0 || yy < 0 || xx >= W || yy >= c.height ? 0 : d[(yy * W + xx) * 4 + 3]);
  const out = new Uint8ClampedArray(d.length);
  for (let y = 0; y < c.height; y++) {
    for (let xx = 0; xx < W; xx++) {
      const i = (y * W + xx) * 4;
      if (!d[i + 3]) continue;
      // bordo: pixel vicini al vuoto diradati a retino
      let edge = 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [2, 0], [-2, 0], [0, -2]]) if (!a(xx + dx, y + dy)) edge++;
      if (edge && bayer(xx, y) < edge * 0.16) continue;
      let below = 0;
      while (y + below + 1 < c.height && d[((y + below + 1) * W + xx) * 4 + 3]) below++;
      const b = bayer(xx, y);
      const t = below / Math.max(1, h * 0.8);
      const col = t < 0.28 + b * 0.14 ? lit : t < 0.6 + b * 0.2 ? mid : top;
      out[i] = col[0];
      out[i + 1] = col[1];
      out[i + 2] = col[2];
      out[i + 3] = 255 * (cfg.alpha ?? 0.9);
    }
  }
  g.putImageData(new ImageData(out, W, c.height), 0, 0);
  return c;
}
// ---------- Città in rovina (un pezzo di strato alla volta) ----------

/**
 * Disegna gli edifici dello strato tra x0 e x1 (coordinate dello strato) sul canvas del pezzo (origine = x0).
 * Ogni edificio dipende solo dal suo indice: i pezzi vicini si raccordano. Restituisce i punti in fiamme
 * [{ x, y, s }] e le luci di segnalazione [{ x, y }] (coordinate dello strato).
 */
export function paintCity(g, x0, x1, baseY, def, salt) {
  const fires = [];
  const beacons = [];
  const S = def.slot ?? 16;
  const maxW = def.width?.[1] ?? 30;
  const col = def.color;
  const win = def.windows || {};
  for (let i = Math.floor((x0 - maxW - S) / S); i <= Math.ceil(x1 / S); i++) {
    const r = rngFor(i, salt);
    if (r() < (def.gap ?? 0.1)) continue;
    const w = Math.round(lerp(def.width?.[0] ?? 8, maxW, r()));
    const bx = Math.round(i * S + r() * S * 0.6) - x0;
    const hh = Math.round(lerp(def.height?.[0] ?? 10, def.height?.[1] ?? 40, r() ** 1.6));
    const kind = r();
    const ruined = r() < (def.ruined ?? 0.5);
    const tops = [];
    let jag = 0;
    for (let k = 0; k < w; k++) {
      if (ruined) {
        if (r() < 0.3) jag = Math.round(r() * hh * 0.45);
        tops.push(hh - jag - (k === 0 || k === w - 1 ? 1 : 0));
      } else tops.push(hh);
    }
    for (let k = 0; k < w; k++) rect(g, bx + k, baseY - tops[k], 1, tops[k] + 60, col);
    const topY = baseY - hh;
    if (!ruined) {
      if (kind < 0.18) {
        // cupola e minareto
        ellipseRows(g, bx + w / 2, topY, w * 0.42, w * 0.36, col, topY - w, topY);
        const mh = Math.round(hh * 0.6);
        const mx = bx + (r() < 0.5 ? 1 : w - 3);
        rect(g, mx, topY - mh, 2, mh, col);
        rect(g, mx - 1, topY - mh - 2, 4, 2, col);
        rect(g, mx, topY - mh - 5, 2, 3, col);
      } else if (kind < 0.32) {
        // torre con antenna e luce rossa
        const ah = 6 + Math.round(r() * 12);
        rect(g, bx + Math.floor(w / 2), topY - ah, 1, ah, col);
        rect(g, bx + Math.floor(w / 2) - 1, topY - 2, 3, 2, col);
        beacons.push({ x: bx + Math.floor(w / 2) + x0, y: topY - ah - 1, ph: r() * 6 });
      } else if (kind < 0.45) {
        // serbatoio d'acqua
        rect(g, bx + 2, topY - 6, w - 4, 4, col);
        rect(g, bx + 3, topY - 2, 1, 2, col);
        rect(g, bx + w - 4, topY - 2, 1, 2, col);
      } else if (kind < 0.6) {
        rect(g, bx + 1, topY - 3, Math.max(2, w * 0.4), 3, col);
      }
    } else {
      // ferri che spuntano dalle rovine
      for (let k = 0; k < 3; k++) {
        if (r() < 0.5) continue;
        const kx = Math.floor(r() * w);
        line(g, bx + kx, baseY - tops[kx], bx + kx + Math.round((r() - 0.5) * 4), baseY - tops[kx] - 2 - r() * 4, 1, col);
      }
      if (r() < (def.fireChance ?? 0.3)) {
        const kx = Math.floor(r() * w);
        fires.push({ x: bx + kx + x0, y: baseY - tops[kx], s: 0.6 + r() * 0.8, ph: r() * 6 });
      }
    }
    // finestre: buie, accese o in fiamme
    const step = win.step ?? 3;
    for (let wy = topY + 3; wy < baseY - 2; wy += step) {
      for (let wx = bx + 2; wx < bx + w - 2; wx += step) {
        const k = wx - bx;
        if (wy < baseY - tops[k] + 2) continue;
        const v = r();
        if (v < (win.lit ?? 0.04)) rect(g, wx, wy, 1, 1, win.litColor || '#ffb050');
        else if (v < (win.lit ?? 0.04) + (win.fire ?? 0.02)) rect(g, wx, wy, 1, 1, win.fireColor || '#ff6a2a');
        else if (v < 0.35 && win.dark) rect(g, wx, wy, 1, 1, win.dark);
      }
    }
  }
  return { fires, beacons };
}

/** Terreno vicino: profilo e ostacoli (reticolati, sacchetti, carcasse, cavalli di Frisia, lampioni, alberi). */
export function paintNear(g, x0, x1, groundAt, def, salt) {
  const col = def.color;
  for (let x = x0; x < x1; x++) rect(g, x - x0, Math.round(groundAt(x)), 1, 400, col);
  const S = def.slot ?? 46;
  for (let i = Math.floor((x0 - 60) / S); i <= Math.ceil(x1 / S); i++) {
    const r = rngFor(i, salt);
    const kind = r();
    const px = Math.round(i * S + r() * S * 0.5);
    const lx = px - x0;
    const gy = Math.round(groundAt(px));
    if (kind < 0.18) {
      // reticolato: paletti con il filo spinato
      const n = 3 + Math.floor(r() * 4);
      for (let k = 0; k < n; k++) {
        const x = lx + k * 9;
        const y = Math.round(groundAt(px + k * 9));
        line(g, x, y, x + (k % 2 ? 1 : -1), y - 9, 1, col);
        if (k + 1 < n) {
          for (const h of [3, 6, 8]) {
            for (let s = 0; s < 9; s++) if ((s + h) % 3) rect(g, x + s, y - h + ((s >> 1) & 1), 1, 1, col);
          }
        }
      }
    } else if (kind < 0.32) {
      // muretto di sacchetti di sabbia
      const n = 3 + Math.floor(r() * 3);
      for (let row = 0; row < 3; row++) {
        for (let k = 0; k < n - row * 0.5; k++) ellipseRows(g, lx + k * 6 + row * 3 + 3, gy - row * 3 - 2, 3.5, 2, col);
      }
    } else if (kind < 0.44) {
      // carcassa d'auto
      poly(g, [[lx, gy - 3], [lx + 3, gy - 7], [lx + 8, gy - 8], [lx + 12, gy - 12], [lx + 20, gy - 12], [lx + 24, gy - 7], [lx + 29, gy - 6], [lx + 30, gy - 2], [lx, gy - 1]], col);
      disc(g, lx + 6, gy - 1, 2.5, col);
      disc(g, lx + 24, gy - 1, 2.5, col);
      g.clearRect(lx + 13, gy - 11, 3, 3);
      g.clearRect(lx + 17, gy - 11, 2, 3);
    } else if (kind < 0.56) {
      // cavalli di Frisia
      for (let k = 0; k < 1 + Math.floor(r() * 2); k++) {
        const x = lx + k * 14;
        line(g, x, gy, x + 8, gy - 9, 1, col);
        line(g, x + 8, gy, x, gy - 9, 1, col);
        line(g, x + 4, gy, x + 4, gy - 10, 1, col);
      }
    } else if (kind < 0.66) {
      // lampione piegato
      line(g, lx, gy, lx + 1, gy - 22, 1, col);
      line(g, lx + 1, gy - 22, lx + 7, gy - 24, 1, col);
      rect(g, lx + 6, gy - 24, 3, 2, col);
    } else if (kind < 0.76) {
      // albero bruciato
      line(g, lx, gy, lx + 1, gy - 18, 2, col);
      line(g, lx + 1, gy - 12, lx - 5, gy - 18, 1, col);
      line(g, lx + 1, gy - 15, lx + 7, gy - 21, 1, col);
      line(g, lx + 4, gy - 18, lx + 6, gy - 24, 1, col);
      line(g, lx - 3, gy - 16, lx - 4, gy - 21, 1, col);
    } else if (kind < 0.9) {
      // cumulo di macerie
      poly(g, [[lx - 2, gy], [lx + 3, gy - 5], [lx + 8, gy - 4], [lx + 11, gy - 8], [lx + 16, gy - 5], [lx + 22, gy]], col);
      line(g, lx + 11, gy - 8, lx + 14, gy - 13, 1, col);
    }
  }
}

/** Primo piano: crinale con sassi e ciuffi d'erba secca. */
export function paintFront(g, x0, x1, groundAt, def, salt) {
  const col = def.color;
  for (let x = x0; x < x1; x++) rect(g, x - x0, Math.round(groundAt(x)), 1, 400, col);
  for (let i = Math.floor(x0 / 7) - 1; i <= Math.ceil(x1 / 7); i++) {
    const r = rngFor(i, salt);
    const x = i * 7 + Math.floor(r() * 7);
    const y = Math.round(groundAt(x));
    const v = r();
    if (v < 0.35) {
      for (let k = -2; k <= 2; k++) line(g, x - x0 + k, y, x - x0 + k * 2, y - 2 - Math.round(r() * 4), 1, col);
    } else if (v < 0.5) ellipseRows(g, x - x0, y, 2 + r() * 3, 1.5 + r() * 1.5, col);
  }
}

/** Primissimo piano (più veloce della camera): erba alta, paletti storti e filo spinato a spirale. */
export function paintFore(g, x0, x1, groundAt, def, salt) {
  const col = def.color;
  for (let x = x0; x < x1; x++) rect(g, x - x0, Math.round(groundAt(x)), 1, 400, col);
  const S = def.slot ?? 70;
  for (let i = Math.floor((x0 - 90) / S); i <= Math.ceil(x1 / S); i++) {
    const r = rngFor(i, salt);
    const px = Math.round(i * S + r() * S * 0.6);
    const lx = px - x0;
    const gy = Math.round(groundAt(px));
    const kind = r();
    if (kind < 0.4) {
      // ciuffi d'erba alta
      for (let k = 0; k < 7; k++) {
        const bx = lx + Math.round((r() - 0.5) * 10);
        line(g, bx, gy, bx + Math.round((r() - 0.3) * 8), gy - 6 - Math.round(r() * 14), 1, col);
      }
    } else if (kind < 0.75) {
      // filo spinato a spirale tra due paletti storti
      const len = 30 + Math.floor(r() * 40);
      line(g, lx, gy, lx - 2, gy - 18, 2, col);
      line(g, lx + len, gy, lx + len + 2, gy - 16, 2, col);
      for (let k = 0; k <= len; k += 5) {
        const cx = lx + k;
        const cy = gy - 8 - Math.sin(k * 0.3) * 1.5;
        for (let a = 0; a < 6.3; a += 0.45) rect(g, cx + Math.cos(a) * 3.5, cy + Math.sin(a) * 5, 1, 1, col);
      }
      for (let k = 0; k < len; k += 2) if (r() < 0.4) rect(g, lx + k, gy - 13 + Math.round(r() * 10), 1, 1, col);
    } else if (kind < 0.85) {
      // paletto spezzato con un elmetto appeso
      line(g, lx, gy, lx + 1, gy - 22, 2, col);
      ellipseRows(g, lx + 1, gy - 22, 4, 3, col, gy - 26, gy - 22);
      rect(g, lx - 4, gy - 22, 10, 1, col);
    }
  }
}

// ---------- Soldati in marcia (sagome) ----------

export const WALKER = { w: 44, h: 80, fx: 18, fy: 76 };

/**
 * Sagoma di un soldato che cammina verso destra (profilo, ~50 px), fotogramma f di n.
 * type: 'rifle' | 'flag' | 'radio' | 'launcher'. Restituisce { canvas, pole, fx, fy } (pole = cima dell'asta).
 */
export function makeWalker(type, f, n, cfg) {
  const { c, g } = makeCanvas(WALKER.w, WALKER.h);
  const col = cfg.color || '#07050a';
  const far = cfg.far || '#22141e';
  const ph = (f / n) * Math.PI * 2;
  const ox = WALKER.fx;
  const oy = WALKER.fy;
  const bob = Math.abs(Math.sin(ph)) < 0.4 ? -1 : 0;
  const P = (x, y) => [ox + x, oy + y + bob];
  const L = (x0, y0, x1, y1, w, color) => line(g, ...P(x0, y0), ...P(x1, y1), w, color);
  const poly2 = (pts, color) => poly(g, pts.map(([x, y]) => P(x, y)), color);
  /** Gamba: coscia e stinco con il ginocchio che si piega quando la gamba avanza, scarpone in avanti. */
  const leg = (p, color) => {
    const th = Math.sin(p) * 0.45;
    const shin = th - 0.55 * Math.max(0, Math.cos(p)) + 0.05;
    const hx = 0;
    const hy = -24;
    const kx = hx + Math.sin(th) * 12;
    const ky = hy + Math.cos(th) * 12;
    const fx = kx + Math.sin(shin) * 12;
    const fy = ky + Math.cos(shin) * 12 - bob;
    poly2([[hx - 2, hy], [hx + 2.5, hy], [kx + 2, ky], [kx - 1.5, ky]], color);
    L(kx, ky, fx, fy, 3, color);
    poly2([[fx - 2, fy - 2], [fx + 1, fy - 2], [fx + 4, fy], [fx + 4, fy + 1], [fx - 2, fy + 1]], color);
  };
  // braccio e gamba lontani (più chiari, dietro)
  leg(ph + Math.PI, far);
  if (type !== 'flag') {
    L(1, -39, 4, -33, 3, far);
    L(4, -33, 9, -30, 2, far);
  }
  // zaino con materassino arrotolato
  poly2([[-9, -40], [-4, -41], [-4, -27], [-8, -28], [-10, -32]], col);
  poly2([[-10, -43], [-4, -43], [-4, -40], [-10, -40]], col);
  // busto con giubbotto, leggermente in avanti
  poly2([[-4, -41], [3, -41], [5, -37], [5, -31], [3, -24], [-3, -24], [-4, -32]], col);
  // collo, testa di profilo ed elmetto
  poly2([[-1, -43], [2, -43], [2, -41], [-1, -41]], col);
  poly2([[-2, -47], [3, -47], [4, -45.5], [5, -44.5], [4, -43.5], [4, -42], [-2, -42]], col);
  ellipseRows(g, ...P(0.5, -46), 4.8, 4, col, oy - 51 + bob, oy - 46 + bob);
  poly2([[-5, -46.5], [6, -46.5], [7, -45.5], [-5, -45.5]], col);
  leg(ph, col);
  let pole = null;
  if (type === 'flag') {
    // fucile a tracolla sulla schiena, asta stretta con due mani
    L(-6, -41, 2, -25, 2, col);
    L(0, -39, 4, -33, 3, col);
    L(4, -33, 6, -30, 2, col);
    L(1, -39, 6, -36, 2, col);
    L(5, -22, 11, -74, 1, col);
    L(5.5, -22, 11.5, -74, 1, col);
    pole = P(11, -74);
  } else {
    // fucile in posizione di pronto: calcio sotto l'ascella, canna in basso in avanti
    L(-2, -34, 8, -30, 3, col);
    L(8, -30, 15, -27, 2, col);
    L(3, -31, 4, -27, 2, col);
    L(-3, -35, -1, -32, 2, col);
    // braccio vicino: spalla, gomito, mano sull'impugnatura
    L(0, -39, -1, -33, 3, col);
    L(-1, -33, 2, -31, 3, col);
    if (type === 'radio') L(-7, -43, -14, -68, 1, col);
    if (type === 'launcher') {
      L(-14, -36, 10, -40, 3, col);
      poly2([[-15, -38], [-12, -38], [-12, -34], [-15, -34]], col);
      poly2([[9, -42], [12, -42], [12, -38], [9, -38]], col);
    }
  }
  rimLight(c, cfg.rim || '#ff9a50', { amount: cfg.rimAmount ?? 0.75, depth: 1, side: -1, sideAmount: cfg.rimSide ?? 0.25 });
  return { canvas: c, pole, fx: ox, fy: oy };
}
// ---------- Velivoli (sagome) ----------

/** Elicottero da trasporto di fianco, muso a destra (le luci di posizione sono disegnate a parte). */
export function makeHeli(cfg) {
  const { c, g } = makeCanvas(50, 20);
  const col = cfg.color || '#0a0810';
  poly(g, [[14, 7], [30, 5], [38, 6], [44, 9], [46, 12], [42, 14], [24, 15], [14, 13]], col);
  poly(g, [[2, 8], [16, 8], [16, 12], [2, 10]], col);
  poly(g, [[0, 3], [3, 3], [5, 10], [1, 10]], col);
  rect(g, 20, 3, 12, 3, col);
  rect(g, 25, 1, 2, 3, col);
  rect(g, 22, 15, 1, 3, col);
  rect(g, 36, 14, 1, 4, col);
  disc(g, 22, 18, 1, col);
  disc(g, 36, 18, 1, col);
  rimLight(c, cfg.rim || '#ff7a4a', { amount: 0.45, depth: 1 });
  rect(g, 38, 8, 3, 2, cfg.cockpit || '#3a4a5a');
  return c;
}

/** Caccia di fianco, muso a destra. */
export function makeJet(cfg) {
  const { c, g } = makeCanvas(22, 8);
  const col = cfg.color || '#0a0810';
  poly(g, [[2, 3], [16, 3], [21, 4], [16, 5], [2, 5]], col);
  poly(g, [[6, 4], [11, 4], [7, 7], [5, 7]], col);
  poly(g, [[1, 0], [4, 0], [6, 3], [2, 3]], col);
  rect(g, 13, 2, 3, 1, col);
  return c;
}
