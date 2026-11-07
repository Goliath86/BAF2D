// Gradi del soldato e carriera del giocatore.
// - Ranks: catalogo dei gradi (game.json -> ranks.list, ordinati per "xp" = punti di carriera necessari)
//   e insegne disegnate a pixel (strati di gallone/arco/barra/stella, colori in ranks.colors).
// - Career: punti di carriera del giocatore salvati in localStorage (Settings, chiave "career"):
//   ogni punto guadagnato in partita si somma, quindi il grado cresce di partita in partita.
// Nomi dei gradi in lang -> ranks.<id>.name (completo) e ranks.<id>.short (abbreviato, per l'HUD).

// Forme delle insegne: "X" = colore principale, "o" = colore scuro. step = righe tra due copie
// impilate (gallone e arco); inline = copie affiancate (stelle) con "gap" px di spazio.
const SHAPES = {
  chevron: {
    rows: ['....X....', '...XXX...', '..XX.XX..', '.Xo...oX.', 'Xo.....oX'],
    step: 4,
  },
  rocker: {
    rows: ['.X.....X.', '.oXXXXXo.'],
    step: 3,
  },
  bar: {
    rows: ['XXXXXXXXX', 'ooooooooo'],
    step: 3,
  },
  star: {
    rows: ['..X..', 'XXXXX', '.XXX.', '.o.o.'],
    inline: true,
    gap: 1,
  },
};

/** Griglia di caratteri di uno strato dell'insegna: { shape, count }. */
function layerGrid(layer) {
  const s = SHAPES[layer.shape];
  if (!s) {
    console.warn(`ranks: unknown insignia shape "${layer.shape}"`);
    return [];
  }
  const n = Math.max(1, layer.count ?? 1);
  const w = s.rows[0].length;
  const h = s.rows.length;
  let grid;
  if (s.inline) {
    const gap = s.gap ?? 1;
    const W = n * w + (n - 1) * gap;
    grid = Array.from({ length: h }, () => Array(W).fill('.'));
    for (let k = 0; k < n; k++) {
      s.rows.forEach((row, y) => {
        for (let x = 0; x < w; x++) if (row[x] !== '.') grid[y][k * (w + gap) + x] = row[x];
      });
    }
  } else {
    const H = h + (n - 1) * s.step;
    grid = Array.from({ length: H }, () => Array(w).fill('.'));
    for (let k = 0; k < n; k++) {
      s.rows.forEach((row, y) => {
        for (let x = 0; x < w; x++) if (row[x] !== '.') grid[k * s.step + y][x] = row[x];
      });
    }
  }
  return grid.map((r) => r.map((c) => (c === '.' ? null : { c, color: layer.color })));
}

export class Ranks {
  /** cfg = game.json -> "ranks": { list: [{ id, xp, insignia: [{ shape, count, color }] }], colors, outline } */
  constructor(cfg = {}) {
    this.cfg = cfg;
    this.list = (cfg.list || []).map((r) => ({ ...r, xp: Math.max(0, r.xp ?? 0), insignia: r.insignia || [] }));
    this.list.sort((a, b) => a.xp - b.xp);
    if (!this.list.length) this.list = [{ id: 'private', xp: 0, insignia: [] }];
    this.list.forEach((r, i) => (r.index = i));
    this.colors = cfg.colors || {};
    this._cache = new Map();
  }

  get count() {
    return this.list.length;
  }

  get(i) {
    return this.list[Math.max(0, Math.min(this.list.length - 1, i | 0))];
  }

  /** Indice del grado raggiunto con "xp" punti di carriera. */
  indexFor(xp) {
    let i = 0;
    while (i + 1 < this.list.length && xp >= this.list[i + 1].xp) i++;
    return i;
  }

  /** { index, rank, next (null all'ultimo grado), ratio 0..1 verso il prossimo grado }. */
  progress(xp) {
    const index = this.indexFor(xp);
    const rank = this.list[index];
    const next = this.list[index + 1] || null;
    const ratio = next ? Math.min(1, Math.max(0, (xp - rank.xp) / (next.xp - rank.xp))) : 1;
    return { index, rank, next, ratio };
  }

  /**
   * Insegna del grado i: canvas a 1 px = 1 pixel di gioco, con contorno scuro di 1 px
   * (leggibile sopra qualunque sfondo). Gli strati sono impilati dall'alto, centrati, 1 px di spazio.
   */
  insignia(i) {
    const rank = this.get(i);
    if (this._cache.has(rank.index)) return this._cache.get(rank.index);
    const grids = rank.insignia.map(layerGrid).filter((g) => g.length);
    const W = Math.max(1, ...grids.map((g) => g[0].length));
    const H = Math.max(1, grids.reduce((s, g) => s + g.length, 0) + Math.max(0, grids.length - 1));
    // maschera completa (W x H) con gli strati centrati
    const cells = Array.from({ length: H }, () => Array(W).fill(null));
    let y0 = 0;
    for (const g of grids) {
      const x0 = Math.floor((W - g[0].length) / 2);
      g.forEach((row, y) => row.forEach((cell, x) => cell && (cells[y0 + y][x0 + x] = cell)));
      y0 += g.length + 1;
    }

    const c = document.createElement('canvas');
    c.width = W + 2;
    c.height = H + 2;
    const ctx = c.getContext('2d');
    const filled = (x, y) => x >= 0 && y >= 0 && x < W && y < H && cells[y][x];
    ctx.fillStyle = this.cfg.outline || '#0b0b12';
    for (let y = -1; y <= H; y++) {
      for (let x = -1; x <= W; x++) {
        if (filled(x, y)) continue;
        let near = false;
        for (let dy = -1; dy <= 1 && !near; dy++) for (let dx = -1; dx <= 1 && !near; dx++) near = !!filled(x + dx, y + dy);
        if (near) ctx.fillRect(x + 1, y + 1, 1, 1);
      }
    }
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const cell = cells[y][x];
        if (!cell) continue;
        const [main, dark] = this.colors[cell.color] || ['#ffd36b', '#b88a2a'];
        ctx.fillStyle = cell.c === 'o' ? dark : main;
        ctx.fillRect(x + 1, y + 1, 1, 1);
      }
    }
    this._cache.set(rank.index, c);
    return c;
  }
}

/** Punti di carriera del giocatore (persistenti) e gradi raggiunti. */
export class Career {
  constructor(settings, ranks) {
    this.settings = settings;
    this.ranks = ranks;
    const d = settings?.get('career', {}) || {};
    this.xp = Math.max(0, Math.floor(Number(d.xp) || 0));
  }

  get rankIndex() {
    return this.ranks.indexFor(this.xp);
  }

  /** Aggiunge n punti e salva; restituisce gli indici dei gradi appena raggiunti (in ordine). */
  add(n) {
    if (!(n > 0)) return [];
    const before = this.rankIndex;
    this.xp += Math.round(n);
    this.settings?.set('career', { xp: this.xp });
    const after = this.rankIndex;
    const promoted = [];
    for (let i = before + 1; i <= after; i++) promoted.push(i);
    return promoted;
  }
}
