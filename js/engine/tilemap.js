// Mappa a tile costruita da un livello JSON.
// Il livello usa righe di caratteri + una "legend" che mappa ogni carattere a un tile
// (per nome o id) e, opzionalmente, a uno spawn: { "tile": "floor", "spawn": "blue" }
// o a una bandiera: { "tile": "floor", "flag": "A" }.

import { LocalizedError } from './errors.js';

export class TileMap {
  constructor(level, tileset) {
    this.tileset = tileset;
    this.size = tileset.size;
    this.spawns = {};
    this.flags = []; // bandiere (CTF): { id, x, y } dai caratteri con { "tile", "flag": "A" }

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
          } else if (typeof entry === 'object') {
            id = this._resolveTile(entry.tile);
            if (entry.spawn) {
              this.spawns[entry.spawn] = { x: (x + 0.5) * this.size, y: (y + 0.5) * this.size };
            }
            if (entry.flag) {
              this.flags.push({ id: String(entry.flag), x: (x + 0.5) * this.size, y: (y + 0.5) * this.size });
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

  _resolveTile(ref) {
    if (typeof ref === 'number') return ref;
    const t = this.tileset.byName.get(ref);
    if (!t) throw new LocalizedError('errors.unknownTile', { tile: ref, tileset: this.tileset.name });
    return t.id;
  }

  /** Disegna l'intera mappa una volta su un canvas offscreen. */
  _prerender() {
    const s = this.size;
    const ts = this.tileset;
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.pixelWidth;
    this.canvas.height = this.pixelHeight;
    const g = this.canvas.getContext('2d');
    g.imageSmoothingEnabled = false;
    for (let y = 0; y < this.rows; y++) {
      for (let x = 0; x < this.cols; x++) {
        const tile = ts.byId.get(this.tiles[y * this.cols + x]);
        if (!tile) continue;
        const sx = (tile.index % ts.cols) * s;
        const sy = Math.floor(tile.index / ts.cols) * s;
        g.drawImage(ts.image, sx, sy, s, s, x * s, y * s, s, s);
      }
    }
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
