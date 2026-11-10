// Mappa a tile costruita da un livello JSON.
// Il livello usa righe di caratteri + una "legend" che mappa ogni carattere a un tile
// (per nome o id) e, opzionalmente, a uno spawn: { "tile": "floor", "spawn": "blue" }
// o a una bandiera: { "tile": "floor", "flag": "A" }, o a un oggetto raccoglibile: { "tile": "floor", "pickup": "shotgun" },
// o a un oggetto decorativo: { "tile": "sand", "prop": "palm" }.
// Un tile può essere una lista ("tile": ["sand", "sand2", "sand3"], anche come valore diretto della legend):
// ogni cella ne sceglie uno a caso ma in modo stabile (stessa mappa = stesso risultato), per evitare ripetizioni.
// "variantWeights" (opzionale, accanto a "tile") = pesi delle varianti.

import { LocalizedError } from './errors.js';

/** Numero pseudo-casuale stabile 0..1 per la cella (x, y) e un "sale". */
export function cellRandom(x, y, salt = 0) {
  let h = (x * 374761393 + y * 668265263 + salt * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

export class TileMap {
  constructor(level, tileset) {
    this.tileset = tileset;
    this.size = tileset.size;
    this.spawns = {};
    this.flags = []; // bandiere (CTF): { id, x, y } dai caratteri con { "tile", "flag": "A" }
    this.pickups = []; // oggetti raccoglibili fissi: { type, x, y } da { "tile", "pickup": "shotgun" }
    this.props = []; // oggetti decorativi: { type, x, y, tx, ty } da { "tile", "prop": "palm" }
    this.vehicles = []; // punti di comparsa dei mezzi: { type, team, angle, x, y } da { "tile", "vehicle": "jeep" }

    const rows = level.map || [];
    this.rows = rows.length;
    this.cols = rows.reduce((m, r) => Math.max(m, r.length), 0);
    this.pixelWidth = this.cols * this.size;
    this.pixelHeight = this.rows * this.size;
    this.tiles = new Int32Array(this.cols * this.rows);

    const fillId = this._resolveTile(level.fill ?? 0);
    const legend = level.legend || {};

    for (let y = 0; y < this.rows; y++) {
      for (let x = 0; x < this.cols; x++) {
        const ch = rows[y][x];
        let id = fillId;
        if (ch !== undefined) {
          const entry = legend[ch];
          if (entry === undefined) {
            console.warn(`Carattere "${ch}" non presente nella legend (riga ${y}, colonna ${x})`);
          } else if (Array.isArray(entry)) {
            id = this._pick(entry, null, x, y);
          } else if (typeof entry === 'object') {
            id = this._pick(entry.tile, entry.variantWeights, x, y);
            if (entry.vehicle) {
              // punto di comparsa di un mezzo (squadra iniziale "team", direzione "angleDeg")
              this.vehicles.push({
                type: String(entry.vehicle),
                team: entry.team ?? null,
                angle: ((entry.angleDeg ?? 0) * Math.PI) / 180,
                x: (x + 0.5) * this.size,
                y: (y + 0.5) * this.size,
              });
            }
            if (entry.prop) {
              this.props.push({ type: String(entry.prop), x: (x + 0.5) * this.size, y: (y + 0.5) * this.size, tx: x, ty: y });
            }
            if (entry.spawn) {
              this.spawns[entry.spawn] = { x: (x + 0.5) * this.size, y: (y + 0.5) * this.size };
            }
            if (entry.flag) {
              this.flags.push({ id: String(entry.flag), x: (x + 0.5) * this.size, y: (y + 0.5) * this.size });
            }
            if (entry.pickup) {
              this.pickups.push({ type: String(entry.pickup), x: (x + 0.5) * this.size, y: (y + 0.5) * this.size });
            }
          } else {
            id = this._resolveTile(entry);
          }
        }
        this.tiles[y * this.cols + x] = id;
      }
    }

    // distruzione: tile originali (reset alla rivincita), crepe (0..1 + colore) e macerie dei tile distrutti
    this.original = Int32Array.from(this.tiles);
    this.cracks = new Map(); // indice cella -> { level, color }
    this.debris = new Map(); // indice cella -> [colori]
    this._prerender();
  }

  /** Torna alla mappa del livello (nuova partita): tile originali, niente crepe né macerie. */
  reset() {
    if (!this.cracks.size && !this.debris.size && this.tiles.every((t, i) => t === this.original[i])) return;
    this.tiles.set(this.original);
    this.cracks.clear();
    this.debris.clear();
    this._renderRegion(0, 0, this.cols - 1, this.rows - 1);
  }

  /** Sostituisce il tile (tx, ty) (es. muro distrutto -> pavimento), con le macerie "debris" (colori) sopra. */
  setTile(tx, ty, id, debris = null) {
    if (tx < 0 || ty < 0 || tx >= this.cols || ty >= this.rows) return;
    const i = ty * this.cols + tx;
    this.tiles[i] = id;
    this.cracks.delete(i);
    if (debris?.length) this.debris.set(i, debris);
    else this.debris.delete(i);
    // il tile cambia bordi e ombre dei vicini: si ridisegna il blocco 3x3
    this._renderRegion(tx - 1, ty - 1, tx + 1, ty + 1);
  }

  /** Crepe sul tile (tx, ty): level 0..1 (0 = intatto), color = colore delle crepe. */
  setCrack(tx, ty, level, color) {
    if (tx < 0 || ty < 0 || tx >= this.cols || ty >= this.rows) return;
    const i = ty * this.cols + tx;
    if (level > 0) this.cracks.set(i, { level, color: color || '#1a1410' });
    else this.cracks.delete(i);
    this._renderRegion(tx, ty, tx, ty);
  }

  /** Tile (o lista di varianti, con pesi opzionali) per la cella (x, y). */
  _pick(ref, weights, x, y) {
    if (!Array.isArray(ref)) return this._resolveTile(ref);
    const w = Array.isArray(weights) && weights.length === ref.length ? weights : ref.map(() => 1);
    const total = w.reduce((s, v) => s + v, 0);
    let r = cellRandom(x, y, 7) * total;
    for (let i = 0; i < ref.length; i++) {
      r -= w[i];
      if (r < 0) return this._resolveTile(ref[i]);
    }
    return this._resolveTile(ref[ref.length - 1]);
  }

  _resolveTile(ref) {
    if (typeof ref === 'number') return ref;
    const t = this.tileset.byName.get(ref);
    if (!t) throw new LocalizedError('errors.unknownTile', { tile: ref, tileset: this.tileset.name });
    return t.id;
  }

  /** Disegna l'intera mappa una volta su un canvas offscreen: tile, bordi tra gruppi, ombre dei muri. */
  _prerender() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.pixelWidth;
    this.canvas.height = this.pixelHeight;
    this._renderRegion(0, 0, this.cols - 1, this.rows - 1);
  }

  /**
   * (Ri)disegna le celle da (x0, y0) a (x1, y1) comprese: tile, macerie, bordi, ombre (anche quelle che vi
   * proiettano le celle vicine), crepe. Il disegno è ritagliato sul rettangolo, il resto del canvas non cambia.
   */
  _renderRegion(x0, y0, x1, y1) {
    x0 = Math.max(0, x0);
    y0 = Math.max(0, y0);
    x1 = Math.min(this.cols - 1, x1);
    y1 = Math.min(this.rows - 1, y1);
    if (x1 < x0 || y1 < y0) return;
    const s = this.size;
    const g = this.canvas.getContext('2d');
    g.imageSmoothingEnabled = false;
    const r = { x0, y0, x1, y1 };
    const px = x0 * s;
    const py = y0 * s;
    const w = (x1 - x0 + 1) * s;
    const h = (y1 - y0 + 1) * s;
    g.save();
    g.beginPath();
    g.rect(px, py, w, h);
    g.clip();
    g.clearRect(px, py, w, h);
    this._drawTiles(g, () => true, r);
    this._drawDebris(g, r);
    this._drawEdges(g, r);
    this._drawShadows(g, r);
    this._drawCracks(g, r);
    g.restore();
  }

  _drawTiles(g, filter, r) {
    const s = this.size;
    const ts = this.tileset;
    for (let y = r.y0; y <= r.y1; y++) {
      for (let x = r.x0; x <= r.x1; x++) {
        const tile = ts.byId.get(this.tiles[y * this.cols + x]);
        if (!tile || !filter(tile)) continue;
        const sx = (tile.index % ts.cols) * s;
        const sy = Math.floor(tile.index / ts.cols) * s;
        g.drawImage(ts.image, sx, sy, s, s, x * s, y * s, s, s);
      }
    }
  }

  /** Macerie dei tile distrutti: schegge di 1-2 px nei colori del materiale, con un'ombra di 1 px. */
  _drawDebris(g, r) {
    const s = this.size;
    for (const [i, colors] of this.debris) {
      const tx = i % this.cols;
      const ty = Math.floor(i / this.cols);
      if (tx < r.x0 || tx > r.x1 || ty < r.y0 || ty > r.y1) continue;
      const n = 12 + Math.floor(cellRandom(tx, ty, 31) * 8);
      for (let k = 0; k < n; k++) {
        const x = tx * s + 1 + Math.floor(cellRandom(tx, ty, 40 + k) * (s - 3));
        const y = ty * s + 1 + Math.floor(cellRandom(tx, ty, 80 + k) * (s - 3));
        const big = cellRandom(tx, ty, 120 + k) < 0.35;
        const cw = big ? 2 : 1;
        const ch = big && cellRandom(tx, ty, 160 + k) < 0.5 ? 2 : 1;
        g.fillStyle = 'rgba(0,0,0,0.35)';
        g.fillRect(x + 1, y + 1, cw, ch);
        g.fillStyle = colors[Math.floor(cellRandom(tx, ty, 200 + k) * colors.length)];
        g.fillRect(x, y, cw, ch);
      }
    }
  }

  /**
   * Crepe dei tile danneggiati: linee spezzate a pixel che partono dai bordi (più numerose e lunghe col danno)
   * e qualche scheggia mancante più scura.
   */
  _drawCracks(g, r) {
    const s = this.size;
    for (const [i, c] of this.cracks) {
      const tx = i % this.cols;
      const ty = Math.floor(i / this.cols);
      if (tx < r.x0 || tx > r.x1 || ty < r.y0 || ty > r.y1) continue;
      const ox = tx * s;
      const oy = ty * s;
      g.fillStyle = c.color;
      const lines = 1 + Math.round(c.level * 4);
      for (let k = 0; k < lines; k++) {
        // partenza da un lato, direzione verso l'interno
        const side = Math.floor(cellRandom(tx, ty, 300 + k) * 4);
        const t = 2 + Math.floor(cellRandom(tx, ty, 310 + k) * (s - 4));
        let x = side === 0 ? t : side === 1 ? t : side === 2 ? 0 : s - 1;
        let y = side === 0 ? 0 : side === 1 ? s - 1 : t;
        const dx = side === 2 ? 1 : side === 3 ? -1 : 0;
        const dy = side === 0 ? 1 : side === 1 ? -1 : 0;
        const len = 3 + Math.floor((4 + c.level * 8) * cellRandom(tx, ty, 320 + k));
        for (let step = 0; step < len; step++) {
          if (x < 0 || y < 0 || x >= s || y >= s) break;
          g.fillRect(ox + x, oy + y, 1, 1);
          // avanza verso l'interno deviando di lato a caso
          const j = cellRandom(tx, ty, 400 + k * 31 + step);
          x += dx || (j < 0.33 ? -1 : j > 0.66 ? 1 : 0);
          y += dy || (j < 0.33 ? -1 : j > 0.66 ? 1 : 0);
        }
      }
      // schegge mancanti
      g.fillStyle = 'rgba(0,0,0,0.3)';
      const chips = Math.round(c.level * 6);
      for (let k = 0; k < chips; k++) {
        const x = Math.floor(cellRandom(tx, ty, 500 + k) * (s - 2));
        const y = Math.floor(cellRandom(tx, ty, 520 + k) * (s - 2));
        g.fillRect(ox + x, oy + y, 2, 1 + (k % 2));
      }
    }
  }

  /**
   * Bordi: un tile con "edge": { group, width, colors, dither, foam, round } verso un vicino di un altro gruppo
   * riceve una fascia di "width" px (pixel sparsi con probabilità dither, decrescente verso l'interno;
   * dither 1 = fascia piena) e, se c'è, una riga di "foam" subito dentro. round = angoli esterni arrotondati.
   */
  _drawEdges(g, r) {
    const s = this.size;
    // distanza intera del pixel (px, py) da un punto (cx, cy): arco degli angoli esterni / interni
    const arc = (px, py, cx, cy, R) => Math.max(0, Math.floor(R - Math.hypot(px + 0.5 - cx, py + 0.5 - cy)));
    const fromCorner = (px, py, cx, cy) => Math.floor(Math.hypot(px + 0.5 - cx, py + 0.5 - cy));
    for (let y = r.y0; y <= r.y1; y++) {
      for (let x = r.x0; x <= r.x1; x++) {
        const tile = this.tileAt(x, y);
        const e = tile?.edge;
        if (!e) continue;
        const group = e.group || tile.name;
        const other = (dx, dy) => {
          const n = this.tileAt(x + dx, y + dy);
          return !!n && (n.edge?.group || n.name) !== group;
        };
        const sides = { t: other(0, -1), b: other(0, 1), l: other(-1, 0), r: other(1, 0) };
        // angoli interni: i due lati sono dello stesso gruppo ma la diagonale no
        const diag = {
          tl: !sides.t && !sides.l && other(-1, -1),
          tr: !sides.t && !sides.r && other(1, -1),
          bl: !sides.b && !sides.l && other(-1, 1),
          br: !sides.b && !sides.r && other(1, 1),
        };
        if (!sides.t && !sides.b && !sides.l && !sides.r && !diag.tl && !diag.tr && !diag.bl && !diag.br) continue;
        const w = e.width ?? 2;
        const cols = e.colors || ['#000'];
        const dither = e.dither ?? 1;
        const R = e.round ? (e.round === true ? 6 : e.round) : 0;
        const ox = x * s;
        const oy = y * s;
        for (let py = 0; py < s; py++) {
          for (let px = 0; px < s; px++) {
            // distanza dal lato "esterno" più vicino
            let d = Infinity;
            if (sides.t) d = Math.min(d, py);
            if (sides.b) d = Math.min(d, s - 1 - py);
            if (sides.l) d = Math.min(d, px);
            if (sides.r) d = Math.min(d, s - 1 - px);
            // angoli esterni arrotondati: nel quadrato d'angolo la distanza dal bordo segue un arco di raggio R
            if (R) {
              if (sides.t && sides.l && px < R && py < R) d = arc(px, py, R, R, R);
              else if (sides.t && sides.r && px >= s - R && py < R) d = arc(px, py, s - R, R, R);
              else if (sides.b && sides.l && px < R && py >= s - R) d = arc(px, py, R, s - R, R);
              else if (sides.b && sides.r && px >= s - R && py >= s - R) d = arc(px, py, s - R, s - R, R);
            }
            // angoli interni: fascia a quarto di cerchio attorno allo spigolo
            if (diag.tl) d = Math.min(d, fromCorner(px, py, 0, 0));
            if (diag.tr) d = Math.min(d, fromCorner(px, py, s, 0));
            if (diag.bl) d = Math.min(d, fromCorner(px, py, 0, s));
            if (diag.br) d = Math.min(d, fromCorner(px, py, s, s));
            const rnd = cellRandom(ox + px, oy + py, 11);
            if (d < w) {
              if (rnd < dither * (1 - d / w) + (dither >= 1 ? 1 : 0)) {
                g.fillStyle = cols[Math.floor(cellRandom(ox + px, oy + py, 12) * cols.length)];
                g.fillRect(ox + px, oy + py, 1, 1);
              }
            } else if (e.foam && d === w && rnd < (e.foamDensity ?? 0.7)) {
              g.fillStyle = e.foam;
              g.fillRect(ox + px, oy + py, 1, 1);
            }
          }
        }
      }
    }
  }

  /**
   * Ombre: i tile che fermano i colpi (muri, casse, rocce) proiettano un'ombra spostata di (dx, dy) px sul
   * terreno (tileset.shadow = { color, alpha, dx, dy }). Disegnata su un canvas a parte (le ombre vicine non si
   * sommano), poi i tile solidi vengono ridisegnati sopra.
   */
  _drawShadows(g, r) {
    const sh = this.tileset.shadow;
    if (!sh) return;
    const s = this.size;
    const dx = sh.dx ?? 3;
    const dy = sh.dy ?? 4;
    // canvas grande quanto la regione (le ombre vicine non si sommano); proiettano anche le celle appena fuori
    const ox = r.x0 * s;
    const oy = r.y0 * s;
    const c = document.createElement('canvas');
    c.width = (r.x1 - r.x0 + 1) * s;
    c.height = (r.y1 - r.y0 + 1) * s;
    const sg = c.getContext('2d');
    sg.fillStyle = sh.color || '#000';
    const mx = Math.ceil(Math.abs(dx) / s);
    const my = Math.ceil(Math.abs(dy) / s);
    for (let y = r.y0 - my; y <= r.y1 + my; y++) {
      for (let x = r.x0 - mx; x <= r.x1 + mx; x++) {
        if (x < 0 || y < 0 || x >= this.cols || y >= this.rows) continue;
        if (this.blocksShotTile(x, y)) sg.fillRect(x * s + dx - ox, y * s + dy - oy, s, s);
      }
    }
    g.save();
    g.globalAlpha = sh.alpha ?? 0.3;
    g.drawImage(c, ox, oy);
    g.restore();
    this._drawTiles(g, (t) => t.solid && !t.shootThrough, r);
  }

  tileAt(tx, ty) {
    if (tx < 0 || ty < 0 || tx >= this.cols || ty >= this.rows) return null;
    return this.tileset.byId.get(this.tiles[ty * this.cols + tx]) || null;
  }

  /** Fuori mappa conta come solido. */
  isSolidTile(tx, ty) {
    if (tx < 0 || ty < 0 || tx >= this.cols || ty >= this.rows) return true;
    const t = this.tileAt(tx, ty);
    return !!t && t.solid;
  }

  isSolidAt(px, py) {
    return this.isSolidTile(Math.floor(px / this.size), Math.floor(py / this.size));
  }

  /**
   * Il tile ferma colpi e vista (solido e senza "shootThrough", es. l'acqua blocca il passaggio
   * ma non i proiettili). Fuori mappa = sì.
   */
  blocksShotTile(tx, ty) {
    if (tx < 0 || ty < 0 || tx >= this.cols || ty >= this.rows) return true;
    const t = this.tileAt(tx, ty);
    return !!t && t.solid && !t.shootThrough;
  }

  blocksShotAt(px, py) {
    return this.blocksShotTile(Math.floor(px / this.size), Math.floor(py / this.size));
  }

  rectHitsSolid(left, top, w, h) {
    const s = this.size;
    const x0 = Math.floor(left / s);
    const y0 = Math.floor(top / s);
    const x1 = Math.floor((left + w - 1e-6) / s);
    const y1 = Math.floor((top + h - 1e-6) / s);
    for (let ty = y0; ty <= y1; ty++) {
      for (let tx = x0; tx <= x1; tx++) {
        if (this.isSolidTile(tx, ty)) return true;
      }
    }
    return false;
  }

  /**
   * Muove un AABB (centro x,y, semi-dimensioni hw,hh) risolvendo le collisioni
   * asse per asse (permette di "scivolare" lungo i muri).
   * Presuppone spostamenti per tick inferiori alla dimensione di un tile.
   */
  moveAndCollide(x, y, hw, hh, dx, dy) {
    const s = this.size;
    const eps = 1e-4;

    if (dx !== 0) {
      x += dx;
      if (this.rectHitsSolid(x - hw, y - hh, hw * 2, hh * 2)) {
        if (dx > 0) x = Math.floor((x + hw) / s) * s - hw - eps;
        else x = (Math.floor((x - hw) / s) + 1) * s + hw + eps;
      }
    }

    if (dy !== 0) {
      y += dy;
      if (this.rectHitsSolid(x - hw, y - hh, hw * 2, hh * 2)) {
        if (dy > 0) y = Math.floor((y + hh) / s) * s - hh - eps;
        else y = (Math.floor((y - hh) / s) + 1) * s + hh + eps;
      }
    }

    return { x, y };
  }

  /** Disegna solo la porzione visibile (ctx già traslato di -camX, -camY). */
  draw(ctx, camX, camY, viewW, viewH) {
    const sx = Math.max(0, camX);
    const sy = Math.max(0, camY);
    const w = Math.min(this.pixelWidth, camX + viewW) - sx;
    const h = Math.min(this.pixelHeight, camY + viewH) - sy;
    if (w <= 0 || h <= 0) return;
    ctx.drawImage(this.canvas, sx, sy, w, h, sx, sy, w, h);
  }
}
