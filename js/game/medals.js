// Medaglie (config/medals.json): imprese in partita (serie di uccisioni, uccisioni particolari, bandiere, fine
// partita) con punti bonus. La collezione (quante volte è stata presa ogni medaglia) è salvata in Settings.
// icon(id) = medaglia a pixel (nastrino a strisce + disco/stella/croce di metallo) disegnata via canvas.

export class Medals {
  constructor(cfg = {}, settings = null) {
    this.cfg = cfg;
    this.settings = settings;
    this.key = cfg.storageKey || 'medals';
    this.defs = new Map((cfg.list || []).map((d) => [d.id, d]));
    this._list = Object.freeze([...this.defs.values()]);
    const saved = settings?.get(this.key, {});
    this.collection = saved && typeof saved === 'object' ? { ...saved } : {};
    this.icons = new Map();
  }

  /** Definizioni nell'ordine del file (array condiviso, sola lettura). */
  get list() {
    return this._list;
  }

  get(id) {
    return this.defs.get(id) || null;
  }

  count(id) {
    return this.collection[id] || 0;
  }

  /** Medaglie diverse ottenute almeno una volta. */
  get owned() {
    return this.list.filter((d) => this.count(d.id) > 0).length;
  }

  /** Registra una medaglia presa (salvata subito). */
  add(id) {
    this.collection[id] = this.count(id) + 1;
    this.settings?.set(this.key, this.collection);
  }

  /** Icona della medaglia a 1 px per pixel (da ingrandire con scala intera). */
  icon(id) {
    if (this.icons.has(id)) return this.icons.get(id);
    const def = this.get(id) || {};
    const W = 15;
    const H = 23;
    const grid = Array.from({ length: H }, () => new Array(W).fill(null));
    const set = (x, y, c) => {
      if (x >= 0 && y >= 0 && x < W && y < H) grid[y][x] = c;
    };
    // nastrino a strisce verticali, più scuro in basso
    const rib = def.ribbon?.length ? def.ribbon : ['#24427a', '#e8e8f0', '#24427a'];
    for (let y = 1; y <= 7; y++) {
      for (let x = 2; x <= 12; x++) {
        const c = rib[Math.min(rib.length - 1, Math.floor(((x - 2) / 11) * rib.length))];
        set(x, y, y === 7 ? shade(c, 0.7) : y === 1 ? shade(c, 1.15) : c);
      }
    }
    const metal = this.cfg.metals?.[def.metal] || this.cfg.metals?.gold || ['#fff0b0', '#ffd36b', '#d8a032', '#8a5e14'];
    // anello che regge la medaglia
    set(6, 8, metal[2]);
    set(7, 8, metal[1]);
    set(8, 8, metal[2]);
    const cx = 7;
    const cy = 15;
    const inShape = shapeTest(def.shape || 'disc', cx, cy);
    for (let y = 9; y < H - 1; y++) {
      for (let x = 1; x < W - 1; x++) {
        if (!inShape(x + 0.5, y + 0.5)) continue;
        // luce da in alto a sinistra: riflesso, campo, ombra; bordo interno più scuro
        const k = (x - cx) + (y - cy);
        let t = k < -4 ? 0 : k < 1 ? 1 : k < 5 ? 2 : 3;
        const edge = !inShape(x + 1.5, y + 0.5) || !inShape(x + 0.5, y + 1.5);
        if (edge) t = Math.max(t, 3);
        set(x, y, metal[t]);
      }
    }
    // emblema al centro: una piccola stella incisa
    for (const [dx, dy] of [[0, -2], [-1, -1], [0, -1], [1, -1], [-2, 0], [-1, 0], [0, 0], [1, 0], [2, 0], [-1, 1], [1, 1], [-1, 2], [1, 2]]) {
      set(cx + dx, cy + dy, metal[(dx + dy) < 0 ? 2 : 3]);
    }
    set(cx - 1, cy - 1, metal[0]);
    // contorno esterno
    const out = this.cfg.outline || '#0b0b12';
    const filled = grid.map((r) => r.map((c) => c !== null));
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (filled[y][x]) continue;
        if ((filled[y - 1]?.[x]) || (filled[y + 1]?.[x]) || filled[y][x - 1] || filled[y][x + 1]) grid[y][x] = out;
      }
    }
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    const g = c.getContext('2d');
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (!grid[y][x]) continue;
        g.fillStyle = grid[y][x];
        g.fillRect(x, y, 1, 1);
      }
    }
    this.icons.set(id, c);
    return c;
  }
}

function shade(hex, k) {
  const n = parseInt(hex.slice(1), 16);
  const f = (v) => Math.max(0, Math.min(255, Math.round(v * k)));
  return `rgb(${f((n >> 16) & 255)},${f((n >> 8) & 255)},${f(n & 255)})`;
}

/** Forma della medaglia: (x, y) -> dentro? */
function shapeTest(shape, cx, cy) {
  if (shape === 'star') {
    const pts = [];
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + (i * Math.PI) / 5;
      const r = i % 2 ? 3.1 : 6.9;
      pts.push([cx + 0.5 + Math.cos(a) * r, cy + 0.5 + Math.sin(a) * r]);
    }
    return (x, y) => {
      let c = false;
      for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
        const [xi, yi] = pts[i];
        const [xj, yj] = pts[j];
        if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
      }
      return c;
    };
  }
  if (shape === 'cross') {
    // croce con i bracci che si allargano verso l'esterno
    return (x, y) => {
      const dx = Math.abs(x - cx - 0.5);
      const dy = Math.abs(y - cy - 0.5);
      if (dx > 6 || dy > 6) return false;
      return dx <= 1.5 + dy * 0.45 || dy <= 1.5 + dx * 0.45 ? Math.min(dx, dy) <= 1.5 + Math.max(dx, dy) * 0.45 : false;
    };
  }
  return (x, y) => (x - cx - 0.5) ** 2 + (y - cy - 0.5) ** 2 <= 5.8 * 5.8;
}
