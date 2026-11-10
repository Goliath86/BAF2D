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

    this._prerender();
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
    const g = this.canvas.getContext('2d');
    g.imageSmoothingEnabled = false;
    this._drawTiles(g, () => true);
    this._drawEdges(g);
    this._drawShadows(g);
  }

  _drawTiles(g, filter) {
    const s = this.size;
    const ts = this.tileset;
    for (let y = 0; y < this.rows; y++) {
      for (let x = 0; x < this.cols; x++) {
        const tile = ts.byId.get(this.tiles[y * this.cols + x]);
        if (!tile || !filter(tile)) continue;
        const sx = (tile.index % ts.cols) * s;
        const sy = Math.floor(tile.index / ts.cols) * s;
        g.drawImage(ts.image, sx, sy, s, s, x * s, y * s, s, s);
      }
    }
  }

  /**
   * Bordi: un tile con "edge": { group, width, colors, dither, foam, round } verso un vicino di un altro gruppo
   * riceve una fascia di "width" px (pixel sparsi con probabilità dither, decrescente verso l'interno;
   * dither 1 = fascia piena) e, se c'è, una riga di "foam" subito dentro. round = angoli esterni arrotondati.
   */
  _drawEdges(g) {
    const s = this.size;
    // distanza intera del pixel (px, py) da un punto (cx, cy): arco degli angoli esterni / interni
    const arc = (px, py, cx, cy, R) => Math.max(0, Math.floor(R - Math.hypot(px + 0.5 - cx, py + 0.5 - cy)));
    const fromCorner = (px, py, cx, cy) => Math.floor(Math.hypot(px + 0.5 - cx, py + 0.5 - cy));
    for (let y = 0; y < this.rows; y++) {
      for (let x = 0; x < this.cols; x++) {
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
  _drawShadows(g) {
    const sh = this.tileset.shadow;
    if (!sh) return;
    const s = this.size;
    const c = document.createElement('canvas');
    c.width = this.pixelWidth;
    c.height = this.pixelHeight;
    const sg = c.getContext('2d');
    sg.fillStyle = sh.color || '#000';
    const dx = sh.dx ?? 3;
    const dy = sh.dy ?? 4;
    for (let y = 0; y < this.rows; y++) {
      for (let x = 0; x < this.cols; x++) {
        if (this.blocksShotTile(x, y)) sg.fillRect(x * s + dx, y * s + dy, s, s);
      }
    }
    g.save();
    g.globalAlpha = sh.alpha ?? 0.3;
    g.drawImage(c, 0, 0);
    g.restore();
    this._drawTiles(g, (t) => t.solid && !t.shootThrough);
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
