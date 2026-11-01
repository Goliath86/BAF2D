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
  const g = c.getContext('2d');
  for (let i = 0; i < frames; i++) {
    g.save();
    g.translate(i * fw, 0);
    painter(g, fw, fh, p, i);
    g.restore();
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
