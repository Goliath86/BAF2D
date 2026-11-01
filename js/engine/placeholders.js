// Generazione procedurale di grafica placeholder in stile pixel-art.
// Usata quando un asset in assets.json ha "src": null o l'immagine non viene trovata.

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function rect(g, x, y, w, h, color) {
  g.fillStyle = color;
  g.fillRect(x, y, w, h);
}

/** Disco "pixelato": riempie i pixel il cui centro cade nel cerchio. */
function disc(g, cx, cy, r, color) {
  g.fillStyle = color;
  const r2 = r * r;
  for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) {
    for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      if (dx * dx + dy * dy <= r2) g.fillRect(x, y, 1, 1);
    }
  }
}

/** Ellisse "pixelata" (assi allineati). */
function ellipse(g, cx, cy, rx, ry, color) {
  g.fillStyle = color;
  for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
    for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
      const dx = (x + 0.5 - cx) / rx;
      const dy = (y + 0.5 - cy) / ry;
      if (dx * dx + dy * dy <= 1) g.fillRect(x, y, 1, 1);
    }
  }
}

/** Linea di Bresenham con pennello quadrato di lato "size". */
function line(g, x0, y0, x1, y1, color, size = 1) {
  g.fillStyle = color;
  const dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    g.fillRect(x0, y0, size, size);
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

function hexToRgb(hex) {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Contorno di 1px attorno ai pixel opachi della regione (stile pixel-art). */
function addOutline(g, x0, w, h, color) {
  const img = g.getImageData(x0, 0, w, h);
  const d = img.data;
  const src = new Uint8ClampedArray(d);
  const [r, gr, b] = hexToRgb(color);
  const opaque = (x, y) => x >= 0 && y >= 0 && x < w && y < h && src[(y * w + x) * 4 + 3] > 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      if (src[i + 3] > 0) continue;
      if (opaque(x - 1, y) || opaque(x + 1, y) || opaque(x, y - 1) || opaque(x, y + 1)) {
        d[i] = r;
        d[i + 1] = gr;
        d[i + 2] = b;
        d[i + 3] = 255;
      }
    }
  }
  g.putImageData(img, x0, 0);
}

/** PRNG deterministico, per dettagli "casuali" ma stabili. */
function rng(seed) {
  let s = (seed * 9301 + 49297) % 233280 || 1;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

// ---------- Sprite ----------
// Convenzione: gli sprite orientabili guardano verso DESTRA (angolo 0).

const SPRITE_SHAPES = {
  /**
   * Soldato moderno, parte superiore (ruota verso la mira): zaino, spalle in mimetica,
   * giubbotto tattico, fucile imbracciato, guanti, elmetto. Frame unico.
   */
  soldier_body(g, w, h, p) {
    const cx = Math.floor(w / 2);
    const cy = Math.floor(h / 2);
    const r = rng(11);

    const bx = cx - 1; // centro del busto (leggermente arretrato rispetto al pivot)

    // zaino (dietro, verso sinistra)
    rect(g, bx - 6, cy - 3, 3, 6, p.pack);
    rect(g, bx - 6, cy - 3, 1, 6, p.packDark);
    rect(g, bx - 5, cy - 1, 2, 1, p.packDark);

    // spalle in mimetica
    ellipse(g, bx, cy, 3, 6, p.uniform);
    for (let k = 0; k < 14; k++) {
      const x = bx - 3 + Math.floor(r() * 6);
      const y = cy - 6 + Math.floor(r() * 12);
      const dx = (x + 0.5 - bx) / 3;
      const dy = (y + 0.5 - cy) / 6;
      if (dx * dx + dy * dy <= 0.8) rect(g, x, y, 1, 1, k % 2 ? p.camo : p.camo2);
    }

    // giubbotto tattico con tasche
    rect(g, bx - 2, cy - 4, 3, 8, p.vest);
    rect(g, bx, cy - 4, 1, 2, p.vestDark);
    rect(g, bx, cy + 2, 1, 2, p.vestDark);

    // braccia: destra (in basso) verso l'impugnatura, sinistra (in alto) verso l'astina
    line(g, bx, cy + 4, cx + 2, cy + 1, p.uniform, 2);
    line(g, bx, cy - 6, cx + 5, cy - 2, p.uniform, 2);

    // fucile (canna centrata sull'asse dello sprite, punta sul bordo destro)
    rect(g, cx - 2, cy - 1, w - cx + 2, 2, p.rifle);
    rect(g, cx + 1, cy - 1, w - cx - 4, 1, p.rifleLight);
    rect(g, cx + 4, cy + 1, 2, 2, p.rifleDark); // caricatore
    rect(g, w - 1, cy - 1, 1, 2, p.rifleDark); // volata

    // guanti sopra il fucile
    rect(g, cx + 2, cy, 2, 2, p.glove);
    rect(g, cx + 6, cy - 2, 2, 2, p.glove);

    // elmetto
    disc(g, bx, cy, 3.5, p.helmetDark);
    disc(g, bx, cy, 2.7, p.helmet);
    rect(g, bx - 2, cy - 2, 2, 1, p.helmetLight);
    rect(g, bx - 2, cy - 1, 1, 1, p.helmetLight);
    rect(g, bx + 2, cy - 1, 1, 2, p.helmetDark); // bordo frontale
  },

  /**
   * Soldato moderno, gambe (ruotano verso la direzione di marcia).
   * Frame 0 = fermo; frame 1..walkFrames = ciclo del passo.
   * Il piede che avanza (sollevato) è più chiaro di quello in appoggio.
   */
  soldier_legs(g, w, h, p, frame) {
    const cx = Math.floor(w / 2);
    const cy = Math.floor(h / 2);
    const n = p.walkFrames || 8;
    const stride = p.stride ?? 5;

    let offL = 2;
    let offR = 1;
    let liftL = false;
    let liftR = false;
    if (frame > 0) {
      const ph = ((frame - 1) / n) * Math.PI * 2;
      offL = Math.round(Math.sin(ph) * stride);
      offR = -offL;
      liftL = Math.cos(ph) > 0;
      liftR = !liftL;
    }

    const leg = (y0, off, lifted) => {
      const foot = cx + off;
      const x0 = Math.min(cx - 2, foot);
      const x1 = Math.max(cx + 1, foot);
      rect(g, x0, y0, x1 - x0 + 1, 3, p.trousers);
      rect(g, x0, y0 + 2, x1 - x0 + 1, 1, p.trousersDark);
      // anfibio
      const bx = off >= 0 ? foot - 1 : foot - 2;
      rect(g, bx, y0, 4, 3, lifted ? p.bootLight : p.boot);
      rect(g, off >= 0 ? bx + 3 : bx, y0, 1, 3, p.bootDark); // punta / tacco
    };
    leg(cy - 4, offL, liftL); // gamba sinistra (in alto, guardando a destra)
    leg(cy + 1, offR, liftR); // gamba destra
  },

  player(g, w, h, p, frame) {
    const cx = w / 2;
    const cy = h / 2;
    // piedi (animazione camminata: frame 1 e 2 alternano il piede avanti)
    const step = frame === 1 ? 2 : frame === 2 ? -2 : 0;
    rect(g, cx - 2 + step, cy - 6, 4, 3, p.outline);
    rect(g, cx - 1 + step, cy - 5, 2, 1, p.feet);
    rect(g, cx - 2 - step, cy + 3, 4, 3, p.outline);
    rect(g, cx - 1 - step, cy + 4, 2, 1, p.feet);
    // corpo
    disc(g, cx, cy, 5.5, p.outline);
    disc(g, cx, cy, 4.5, p.body);
    // arma
    rect(g, cx + 1, cy - 2, w - cx - 1, 4, p.outline);
    rect(g, cx + 2, cy - 1, w - cx - 3, 2, p.gun);
    // testa
    disc(g, cx - 0.5, cy, 2.5, p.head);
  },

  bullet(g, w, h, p) {
    rect(g, 0, 1, w, h - 2, p.color);
    rect(g, 1, 0, w - 2, h, p.color);
    rect(g, 2, 1, w - 3, h - 2, p.core);
  },

  /** Foro di proiettile (decal). Ogni frame è una variante diversa. */
  hole(g, w, h, p, frame) {
    const r = rng(frame * 7 + 3);
    const cx = w / 2;
    const cy = h / 2;
    disc(g, cx, cy, 2.6, p.rim);
    disc(g, cx + (r() - 0.5), cy + (r() - 0.5), 1.6, p.center);
    const dirs = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
    const extra = p.cracks || p.chips;
    if (!extra) return;
    for (let k = 0; k < 3; k++) {
      const [dx, dy] = dirs[Math.floor(r() * dirs.length)];
      const x = Math.floor(cx) + dx * 2;
      const y = Math.floor(cy) + dy * 2;
      if (p.cracks) {
        // crepa: linea che parte dal bordo del foro
        rect(g, x, y, 1, 1, p.cracks);
        rect(g, x + dx, y + dy, 1, 1, p.cracks);
      } else {
        // schegge di terreno sparse attorno
        rect(g, x + dx, y + dy, 1, 1, p.chips);
      }
    }
  },

  crosshair(g, w, h, p) {
    const c = Math.floor(w / 2);
    // contorno
    rect(g, c - 1, 0, 3, 4, p.outline);
    rect(g, c - 1, h - 4, 3, 4, p.outline);
    rect(g, 0, c - 1, 4, 3, p.outline);
    rect(g, w - 4, c - 1, 4, 3, p.outline);
    // linee
    rect(g, c, 1, 1, 2, p.color);
    rect(g, c, h - 3, 1, 2, p.color);
    rect(g, 1, c, 2, 1, p.color);
    rect(g, w - 3, c, 2, 1, p.color);
    rect(g, c, c, 1, 1, p.color);
  },

  circle(g, w, h, p) {
    disc(g, w / 2, h / 2, Math.min(w, h) / 2, p.outline || '#000');
    disc(g, w / 2, h / 2, Math.min(w, h) / 2 - 1, p.color || '#f0f');
  },

  rect(g, w, h, p) {
    rect(g, 0, 0, w, h, p.outline || '#000');
    rect(g, 1, 1, w - 2, h - 2, p.color || '#f0f');
  },
};

function countFrames(animations) {
  let max = 0;
  for (const a of Object.values(animations || {})) {
    for (const f of a.frames || []) max = Math.max(max, f);
  }
  return max + 1;
}

export function createSpritePlaceholder(def) {
  const fw = def.frameWidth || 16;
  const fh = def.frameHeight || 16;
  const p = def.placeholder || {};
  const frames = p.frames || countFrames(def.animations);
  const painter = SPRITE_SHAPES[p.shape] || SPRITE_SHAPES.rect;
  const c = makeCanvas(fw * frames, fh);
  const g = c.getContext('2d', { willReadFrequently: !!p.autoOutline });
  for (let i = 0; i < frames; i++) {
    g.save();
    g.translate(i * fw, 0);
    painter(g, fw, fh, p, i);
    g.restore();
    if (p.autoOutline) addOutline(g, i * fw, fw, fh, p.autoOutline);
  }
  return c;
}

// ---------- Tile ----------

const TILE_STYLES = {
  floor(g, s, p, seed) {
    rect(g, 0, 0, s, s, p.color);
    const r = rng(seed + 1);
    for (let i = 0; i < s / 2; i++) {
      rect(g, Math.floor(r() * s), Math.floor(r() * s), 1, 1, p.detail);
    }
    rect(g, 0, s - 1, s, 1, p.edge);
    rect(g, s - 1, 0, 1, s, p.edge);
  },

  wall(g, s, p) {
    rect(g, 0, 0, s, s, p.color);
    // mattoni
    const bh = s / 4;
    for (let row = 0; row < 4; row++) {
      const y = row * bh;
      rect(g, 0, y + bh - 1, s, 1, p.dark);
      const off = row % 2 === 0 ? 0 : s / 4;
      for (let x = off; x < s; x += s / 2) rect(g, x, y, 1, bh - 1, p.dark);
    }
    rect(g, 0, 0, s, 1, p.light);
    rect(g, 0, 0, 1, s, p.light);
  },

  crate(g, s, p) {
    rect(g, 0, 0, s, s, p.dark);
    rect(g, 1, 1, s - 2, s - 2, p.color);
    rect(g, 1, 1, s - 2, 2, p.light);
    rect(g, 1, s - 3, s - 2, 2, p.light);
    for (let i = 3; i < s - 3; i++) {
      rect(g, i, i, 1, 1, p.dark);
      rect(g, s - 1 - i, i, 1, 1, p.dark);
    }
    rect(g, 0, 0, s, 1, p.dark);
    rect(g, 0, s - 1, s, 1, p.dark);
  },

  flat(g, s, p) {
    rect(g, 0, 0, s, s, p.color || '#f0f');
  },
};

/** Genera un tileset in una riga: il tile con indice i sta alla colonna i. */
export function createTilesetPlaceholder(def) {
  const s = def.tileSize || 16;
  const tiles = def.tiles || [];
  const maxIndex = tiles.reduce((m, t) => Math.max(m, t.index ?? t.id), 0);
  const c = makeCanvas((maxIndex + 1) * s, s);
  const g = c.getContext('2d');
  for (const t of tiles) {
    const p = t.placeholder || {};
    const painter = TILE_STYLES[p.style] || TILE_STYLES.flat;
    g.save();
    g.translate((t.index ?? t.id) * s, 0);
    painter(g, s, p, t.id);
    g.restore();
  }
  return c;
}
