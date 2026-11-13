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

const smooth = (t) => t * t * (3 - 2 * t);

/**
 * Rumore a valori come valueNoise(x / scale, y / scale, salt), ma con i nodi calcolati una volta per il rettangolo
 * di pixel (ox, oy, w, h): nodi in coordinate globali, quindi regioni diverse combaciano. (Calcolarli alla prima
 * lettura è risultato più lento: il controllo su ogni lettura costa più dei nodi risparmiati.)
 */
class NoiseGrid {
  constructor(salt, scale, ox, oy, w, h) {
    this.scale = scale;
    this.ix0 = Math.floor(ox / scale);
    this.iy0 = Math.floor(oy / scale);
    this.gw = Math.floor((ox + w) / scale) - this.ix0 + 2;
    const gh = Math.floor((oy + h) / scale) - this.iy0 + 2;
    this.v = new Float32Array(this.gw * gh);
    for (let j = 0; j < gh; j++) {
      for (let i = 0; i < this.gw; i++) this.v[j * this.gw + i] = cellRandom(this.ix0 + i, this.iy0 + j, salt);
    }
  }

  at(x, y) {
    const fx = x / this.scale;
    const fy = y / this.scale;
    const ix = Math.floor(fx);
    const iy = Math.floor(fy);
    const tx = fx - ix;
    const ty = fy - iy;
    const sx = tx * tx * (3 - 2 * tx);
    const sy = ty * ty * (3 - 2 * ty);
    const k = (iy - this.iy0) * this.gw + (ix - this.ix0);
    const a = this.v[k];
    const b = this.v[k + 1];
    const c = this.v[k + this.gw];
    const d = this.v[k + this.gw + 1];
    return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
  }
}

/** Mappe già disegnate per livello e tileset (la fusione dei terreni costa: la seconda partita la riusa). */
const renderCache = new WeakMap();

export class TileMap {
  /**
   * opts.blend = false: niente fusione dei terreni (anteprime piccole, controlli: si disegna più in fretta).
   * opts.deferred = true: il canvas non viene disegnato (lo fa TileMap.prewarm a pezzi).
   */
  constructor(level, tileset, opts = {}) {
    this.tileset = tileset;
    this.blend = opts.blend !== false;
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
    this._prerender(level, !!opts.deferred);
  }

  /** Torna alla mappa del livello (nuova partita): tile originali, niente crepe né macerie. */
  reset() {
    if (!this.cracks.size && !this.debris.size && this.tiles.every((t, i) => t === this.original[i])) return;
    this.tiles.set(this.original);
    this.cracks.clear();
    this.debris.clear();
    if (this.pristine) {
      // copia della mappa intatta (ridisegnarla da capo costa, con la fusione dei terreni)
      const g = this.canvas.getContext('2d');
      g.clearRect(0, 0, this.pixelWidth, this.pixelHeight);
      g.drawImage(this.pristine, 0, 0);
    } else {
      this._renderRegion(0, 0, this.cols - 1, this.rows - 1);
    }
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
  _prerender(level, deferred = false) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.pixelWidth;
    this.canvas.height = this.pixelHeight;
    // con la fusione dei terreni: copia intatta in cache per livello e tileset (partite successive e rivincita)
    const cached = this._cacheable(level) ? renderCache.get(level)?.get(this.tileset) : null;
    if (cached) {
      this.canvas.getContext('2d').drawImage(cached, 0, 0);
      this.pristine = cached;
      return;
    }
    if (deferred) return;
    this._renderRegion(0, 0, this.cols - 1, this.rows - 1);
    this._storeCache(level);
  }

  _cacheable(level) {
    return this.blend && !!this.tileset.terrains && !!level && typeof level === 'object';
  }

  /** Mette in cache una copia della mappa appena disegnata (intatta) per il livello. */
  _storeCache(level) {
    if (!this._cacheable(level)) return;
    const copy = document.createElement('canvas');
    copy.width = this.pixelWidth;
    copy.height = this.pixelHeight;
    copy.getContext('2d').drawImage(this.canvas, 0, 0);
    const byTileset = renderCache.get(level) || new Map();
    byTileset.set(this.tileset, copy);
    renderCache.set(level, byTileset);
    this.pristine = copy;
  }

  /**
   * Disegna in anticipo la mappa del livello (con la fusione dei terreni, che costa qualche centinaio di ms) a
   * blocchi di celle in pezzi brevi: la partita che parte dopo la trova in cache. Per il menu, quando si sceglie
   * una mappa. Restituisce una funzione che annulla il lavoro non ancora fatto.
   */
  static prewarm(level, tileset, block = [24, 4]) {
    const none = () => {};
    if (!tileset?.terrains || renderCache.get(level)?.has(tileset)) return none;
    let map;
    try {
      map = new TileMap(level, tileset, { deferred: true });
    } catch (e) {
      return none; // livello non valido: se ne accorgerà chi lo apre
    }
    // blocchi di celle (pochi ms l'uno), riga per riga
    const [bw, bh] = block;
    let bx = 0;
    let by = 0;
    let cancelled = false;
    // pezzi da ~8 ms in coda (setTimeout): tra un pezzo e l'altro il browser disegna i fotogrammi del menu.
    // (requestIdleCallback con la scena del menu sempre animata arriva troppo di rado)
    const step = () => {
      if (cancelled || renderCache.get(level)?.has(tileset)) return; // annullato o già disegnata da una partita
      const end = performance.now() + 8;
      do {
        map._renderRegion(bx, by, Math.min(map.cols - 1, bx + bw - 1), Math.min(map.rows - 1, by + bh - 1));
        bx += bw;
        if (bx >= map.cols) {
          bx = 0;
          by += bh;
        }
      } while (by < map.rows && performance.now() < end);
      if (by < map.rows) setTimeout(step, 0);
      else map._storeCache(level);
    };
    setTimeout(step, 0);
    return () => {
      cancelled = true;
    };
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
    this._drawBlend(g, r);
    this._drawDebris(g, r);
    this._drawEdges(g, r);
    this._drawShadows(g, r);
    this._drawHeight(g, r);
    this._drawCracks(g, r);
    g.restore();
  }

  /** Altezza (px della faccia) del tile che ferma i colpi in (tx, ty), 0 = piatto o non bloccante. */
  _heightAt(tx, ty) {
    if (!this.blocksShotTile(tx, ty)) return 0;
    const t = this.tileAt(tx, ty);
    if (!t) return this.tileset.height?.face ?? 0; // fuori mappa: come un muro
    return t.height ?? this.tileset.height?.face ?? 0;
  }

  /**
   * Altezza finta (vista leggermente dall'alto) dei tile che fermano i colpi, senza cambiare le collisioni
   * (tileset.height = { face, shade: [alto, basso], color, lip, lipColor, rim, rimColor, dark, ao: { size, alpha } },
   * "height" sul tile = px della faccia, 0 = piatto):
   * - faccia sud nelle ultime "face" righe della cella (se sotto non c'è un altro tile alto): la texture si scurisce
   *   verso il basso, con un filo di luce sul bordo della cima ("lip") e una riga scura dove tocca terra;
   * - bordi della cima: chiari dal lato della luce, scuri dal lato opposto (luce dalle ombre: tileset.shadow);
   * - occlusione alla base: il terreno accanto ai tile alti si scurisce per "ao.size" px.
   */
  _drawHeight(g, r) {
    const H = this.tileset.height;
    if (!H) return;
    const s = this.size;
    const sh = this.tileset.shadow || { dx: 2, dy: 3 };
    // lato illuminato in orizzontale: la luce viene dal lato opposto all'ombra
    const litWest = (sh.dx ?? 1) >= 0;
    const [shTop, shBot] = H.shade || [0.25, 0.5];
    const color = H.color || '#000';
    const lip = H.lip ?? 0.2;
    const rim = H.rim ?? 0.15;
    const dark = H.dark ?? 0.3;
    const ao = H.ao || null;
    const fill = (x, y, w, h, c, a) => {
      if (a <= 0 || w <= 0 || h <= 0) return;
      g.globalAlpha = Math.min(1, a);
      g.fillStyle = c;
      g.fillRect(x, y, w, h);
    };
    g.save();
    for (let y = r.y0; y <= r.y1; y++) {
      for (let x = r.x0; x <= r.x1; x++) {
        const ox = x * s;
        const oy = y * s;
        const h = this._heightAt(x, y);
        if (h > 0) {
          const f = Math.min(s - 2, h);
          const south = this._heightAt(x, y + 1) > 0;
          const north = this._heightAt(x, y - 1) > 0;
          const west = this._heightAt(x - 1, y) > 0;
          const east = this._heightAt(x + 1, y) > 0;
          const top = south ? s : s - f; // righe della cima
          // bordi della cima verso il terreno: luce (nord e lato illuminato), ombra (lato opposto)
          if (!north) fill(ox, oy, s, 1, H.lipColor || '#fff', rim);
          const litSide = litWest ? !west : !east;
          const darkSide = litWest ? !east : !west;
          const lx = litWest ? ox : ox + s - 1;
          const dxp = litWest ? ox + s - 1 : ox;
          if (litSide) fill(lx, oy + (north ? 0 : 1), 1, top - (north ? 0 : 1), H.lipColor || '#fff', rim);
          if (darkSide) fill(dxp, oy, 1, s, color, dark);
          if (!south) {
            // faccia: sfumatura verso il basso, filo di luce sul bordo della cima, contatto col terreno
            for (let k = 0; k < f; k++) fill(ox, oy + top + k, s, 1, color, shTop + ((shBot - shTop) * k) / Math.max(1, f - 1));
            fill(ox, oy + top - 1, s, 1, H.lipColor || '#fff', lip);
            fill(ox, oy + s - 1, s, 1, color, Math.min(1, shBot + 0.15));
          }
          continue;
        }
        // occlusione alla base: terreno a ridosso dei tile alti (più forte sotto, dove c'è la faccia)
        if (!ao || !ao.size) continue;
        const n = ao.size;
        for (let k = 0; k < n; k++) {
          const a = (ao.alpha ?? 0.2) * (1 - k / n);
          if (this._heightAt(x, y - 1) > 0) fill(ox, oy + k, s, 1, color, a * 1.3);
          if (this._heightAt(x, y + 1) > 0) fill(ox, oy + s - 1 - k, s, 1, color, a * 0.7);
          if (this._heightAt(x - 1, y) > 0) fill(ox + k, oy, 1, s, color, a);
          if (this._heightAt(x + 1, y) > 0) fill(ox + s - 1 - k, oy, 1, s, color, a);
        }
      }
    }
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

  /** Pixel del tileset (per copiare la texture di un terreno dentro una cella vicina), in cache sul tileset. */
  _tilesetPixels() {
    const ts = this.tileset;
    if (!ts._pixels) {
      const c = document.createElement('canvas');
      c.width = ts.image.width;
      c.height = ts.image.height;
      const cg = c.getContext('2d', { willReadFrequently: true });
      cg.drawImage(ts.image, 0, 0);
      ts._pixels = cg.getImageData(0, 0, c.width, c.height);
    }
    return ts._pixels;
  }

  /**
   * Fusione dei terreni (tileset.terrains + "terrain" sui tile): ai confini tra terreni diversi il bordo non segue
   * più il lato del tile. Ogni pixel delle celle di confine sceglie il terreno col punteggio più alto:
   * copertura (appartenenza delle celle ammorbidita su 3x3, poi interpolata tra i centri con smoothstep: angoli
   * arrotondati, scalini diagonali) + rumore stabile × blend.amp × terrains.<t>.amp (bordo irregolare)
   * + terrains.<t>.bias. Il pixel conquistato prende la texture di un tile vicino di quel terreno.
   * "spill": false = il terreno non esce dalle sue celle. terrains.<t>.rim.<altro terreno | "*"> =
   * { colors, width, dither }: fascia lungo il confine dal lato di <t> (riva bagnata, schiuma, bordo della trincea).
   * Varianti dello stesso terreno (sand, sand2...): con blend.variants > 0 si mescolano a chiazze irregolari invece
   * di formare una scacchiera (terrains.<t>.variants: false per non farlo).
   * I tile senza "terrain" (muri, pavimenti delle case) restano netti e non partecipano.
   */
  _drawBlend(g, r) {
    const ts = this.tileset;
    const T = ts.terrains;
    if (!T || !this.blend) return;
    const s = this.size;
    const cfg = ts.blend || {};
    const amp = cfg.amp ?? 0.3;
    const scale = cfg.scale ?? 6;
    const vamp = cfg.variants ?? 0;
    const vscale = cfg.variantScale ?? scale * 1.6;
    const names = Object.keys(T);
    const defs = names.map((n) => T[n]);
    const nT = names.length;
    const index = new Map(names.map((n, i) => [n, i]));

    // griglia del terreno e del tile per la regione + 2 celle di margine (-1 = nessun terreno / fuori mappa)
    const gx0 = r.x0 - 2;
    const gy0 = r.y0 - 2;
    const GW = r.x1 - r.x0 + 5;
    const GH = r.y1 - r.y0 + 5;
    const N = GW * GH;
    const terr = new Int8Array(N).fill(-1);
    const tid = new Int32Array(N).fill(-1);
    for (let y = 0; y < GH; y++) {
      for (let x = 0; x < GW; x++) {
        const t = this.tileAt(gx0 + x, gy0 + y);
        if (!t) continue;
        tid[y * GW + x] = t.id;
        const k = t.terrain ? index.get(t.terrain) : undefined;
        if (k !== undefined) terr[y * GW + x] = k;
      }
    }
    // appartenenza ammorbidita (binomiale 3x3) per terreno
    const mem = new Float32Array(nT * N);
    const BW = [1, 2, 1];
    for (let y = 1; y < GH - 1; y++) {
      for (let x = 1; x < GW - 1; x++) {
        const c = y * GW + x;
        for (let j = -1; j <= 1; j++) {
          for (let i = -1; i <= 1; i++) {
            const k = terr[c + j * GW + i];
            if (k >= 0) mem[k * N + c] += (BW[i + 1] * BW[j + 1]) / 16;
          }
        }
      }
    }

    const src = this._tilesetPixels();
    const ox = r.x0 * s;
    const oy = r.y0 * s;
    const W = (r.x1 - r.x0 + 1) * s;
    const H = (r.y1 - r.y0 + 1) * s;
    let img = null;
    // rumore con i nodi precalcolati per la regione: bordo dei terreni (2 ottave) e chiazze delle varianti
    const lo = [];
    const hi = [];
    const vg = [];
    const terrainNoise = (k, x, y) => {
      if (!lo[k]) {
        lo[k] = new NoiseGrid(1000 + k * 37, scale, ox, oy, W, H);
        hi[k] = new NoiseGrid(1097 + k * 37, scale * 0.4, ox, oy, W, H);
      }
      return (lo[k].at(x, y) * 0.7 + hi[k].at(x, y) * 0.3) * 2 - 1;
    };
    const variantNoise = (id, x, y) => (vg[id] ||= new NoiseGrid(5000 + id * 13, vscale, ox, oy, W, H)).at(x, y) * 2 - 1;
    const vids = [0, 0, 0, 0];
    const vsc = [0, 0, 0, 0];
    // costanti per terreno e fasce di confine per coppia (vincitore, concorrente)
    const ampK = defs.map((d) => amp * (d.amp ?? 1));
    const biasK = defs.map((d) => d.bias ?? 0);
    const spillK = defs.map((d) => d.spill !== false);
    const mixK = defs.map((d) => vamp > 0 && d.variants !== false);
    const rimK = [];
    for (let a = 0; a < nT; a++) for (let b = 0; b < nT; b++) rimK[a * nT + b] = a === b ? null : defs[a].rim?.[names[b]] ?? defs[a].rim?.['*'] ?? null;
    // fascia di confine più larga, come differenza di punteggio (d px = differenza · s / 2)
    const rimReach = (2 * Math.max(0, ...rimK.map((rm) => rm?.width ?? 0))) / s;
    const cand = new Int8Array(nT); // terreni candidati della cella
    const score = new Float64Array(nT);
    const active = new Uint8Array(nT);
    const corner = [0, 0, 0, 0]; // indici di griglia delle 4 celle vicine al pixel
    const cw = [0, 0, 0, 0]; // loro pesi
    const vbw = [0, 0, 0, 0]; // peso della cella scelta per ogni variante distinta
    // per ogni pixel del tile: le 4 celle vicine (spostamento -1/0 della prima) e i pesi smoothstep
    const pdx = new Int8Array(s * s);
    const pdy = new Int8Array(s * s);
    const pw = new Float32Array(s * s * 4);
    for (let py = 0; py < s; py++) {
      for (let px = 0; px < s; px++) {
        const p = py * s + px;
        const fx = (px + 0.5) / s - 0.5;
        const fy = (py + 0.5) / s - 0.5;
        pdx[p] = Math.floor(fx);
        pdy[p] = Math.floor(fy);
        const u = smooth(fx - pdx[p]);
        const v = smooth(fy - pdy[p]);
        pw[p * 4] = (1 - u) * (1 - v);
        pw[p * 4 + 1] = u * (1 - v);
        pw[p * 4 + 2] = (1 - u) * v;
        pw[p * 4 + 3] = u * v;
      }
    }
    // primo pixel di ogni tile nel tileset (id -> offset in src.data / 4)
    const srcBase = [];
    for (const t of ts.byId.values()) srcBase[t.id] = Math.floor(t.index / ts.cols) * s * src.width + (t.index % ts.cols) * s;
    const rgb = (rim) => (rim._rgb ||= rim.colors.map((h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]));

    for (let cy = r.y0; cy <= r.y1; cy++) {
      for (let cx = r.x0; cx <= r.x1; cx++) {
        const c = (cy - gy0) * GW + (cx - gx0);
        const own = terr[c];
        if (own < 0) continue;
        // confine tra terreni (anche in diagonale) o tra varianti dello stesso terreno
        let border = false;
        let variant = false;
        const mixVariants = mixK[own];
        for (let j = -1; j <= 1; j++) {
          for (let i = -1; i <= 1; i++) {
            const n = c + j * GW + i;
            if (terr[n] < 0) continue;
            if (terr[n] !== own) border = true;
            else if (mixVariants && tid[n] !== tid[c]) variant = true;
          }
        }
        if (!border && !variant) continue;
        // candidati: terreni con appartenenza ammorbidita > 0 nelle celle 3x3 (le 4 vicine di ogni pixel)
        let nc = 0;
        if (border) {
          for (let k = 0; k < nT; k++) {
            let any = k === own;
            for (let j = -1; j <= 1 && !any; j++) {
              for (let i = -1; i <= 1; i++) {
                if (mem[k * N + c + j * GW + i] > 0) {
                  any = true;
                  break;
                }
              }
            }
            if (any) cand[nc++] = k;
          }
        }
        img ||= g.getImageData(ox, oy, W, H);
        const out = img.data;
        for (let py = 0; py < s; py++) {
          for (let px = 0; px < s; px++) {
            const X = cx * s + px;
            const Y = cy * s + py;
            const p = py * s + px;
            const g0 = c + pdy[p] * GW + pdx[p];
            corner[0] = g0;
            corner[1] = g0 + 1;
            corner[2] = g0 + GW;
            corner[3] = g0 + GW + 1;
            cw[0] = pw[p * 4];
            cw[1] = pw[p * 4 + 1];
            cw[2] = pw[p * 4 + 2];
            cw[3] = pw[p * 4 + 3];

            // terreno del pixel
            let best = own;
            let bestS = 0;
            let second = -1;
            let secondS = -Infinity;
            // pixel di confine lontano dal confine: la cella vince comunque (né rumore né fascia possono cambiarlo)
            let decided = false;
            if (border) {
              let fOwn = 0;
              let fOther = 0;
              let ampMax = 0;
              for (let m = 0; m < nc; m++) {
                const k = cand[m];
                const base = k * N;
                const f = mem[base + corner[0]] * cw[0] + mem[base + corner[1]] * cw[1] + mem[base + corner[2]] * cw[2] + mem[base + corner[3]] * cw[3];
                score[k] = f;
                if (k === own) fOwn = f + biasK[k];
                else if (f > 0) {
                  fOther = Math.max(fOther, f + biasK[k]);
                  ampMax = Math.max(ampMax, ampK[k]);
                }
              }
              decided = fOwn - fOther > ampK[own] + ampMax + rimReach;
            }
            if (border && !decided) {
              bestS = -Infinity;
              for (let m = 0; m < nc; m++) {
                const k = cand[m];
                const f = score[k];
                active[k] = f > 0 || k === own ? 1 : 0;
                if (!active[k]) continue;
                score[k] = f + ampK[k] * terrainNoise(k, X, Y) + biasK[k];
                if ((k === own || spillK[k]) && score[k] > bestS) {
                  bestS = score[k];
                  best = k;
                }
              }
              // concorrente per la fascia di confine (anche un terreno che non esce dalle sue celle)
              for (let m = 0; m < nc; m++) {
                const k = cand[m];
                if (active[k] && k !== best && score[k] > secondS) {
                  secondS = score[k];
                  second = k;
                }
              }
            }
            if (best === own && second < 0) {
              // resta il terreno della cella, senza fascia: cambia solo la variante, che vince comunque
              // se pesa più di (1 + 2·variants) / 2
              if (!mixK[own]) continue;
              let wOwn = 0;
              for (let q = 0; q < 4; q++) if (tid[corner[q]] === tid[c]) wOwn += cw[q];
              if (wOwn >= 0.5 + vamp) continue;
            }

            // tile da cui copiare la texture: tra le celle vicine di quel terreno, la variante col punteggio più
            // alto (peso + rumore per variante) o la più pesante
            let pick = -1;
            let pickS = -Infinity;
            const mixHere = mixK[best];
            // pesi sommati per variante distinta (il rumore si calcola una volta per variante)
            let nv = 0;
            for (let q = 0; q < 4; q++) {
              const n = corner[q];
              if (terr[n] !== best) continue;
              let m = 0;
              while (m < nv && tid[vids[m]] !== tid[n]) m++;
              if (m === nv) {
                vids[nv] = n;
                vbw[nv] = cw[q];
                vsc[nv++] = cw[q];
              } else {
                vsc[m] += cw[q];
                if (cw[q] > vbw[m]) {
                  vids[m] = n; // cella più pesante della variante
                  vbw[m] = cw[q];
                }
              }
            }
            for (let m = 0; m < nv; m++) {
              const sc = vsc[m] + (mixHere && nv > 1 ? vamp * variantNoise(tid[vids[m]], X, Y) : 0);
              if (sc > pickS) {
                pickS = sc;
                pick = vids[m];
              }
            }
            if (pick < 0) {
              // terreno arrivato dall'ammorbidimento senza celle tra le 4 vicine: la più vicina nel 3x3
              let bd = Infinity;
              for (let j = -1; j <= 1; j++) {
                for (let i = -1; i <= 1; i++) {
                  const n = c + j * GW + i;
                  if (terr[n] !== best) continue;
                  const d = Math.abs((cx + i + 0.5) * s - X) + Math.abs((cy + j + 0.5) * s - Y);
                  if (d < bd) {
                    bd = d;
                    pick = n;
                  }
                }
              }
              if (pick < 0) pick = c;
            }
            const rimDef = second >= 0 ? rimK[best * nT + second] : null;
            if (tid[pick] === tid[c] && !rimDef) continue; // pixel invariato

            const k4 = ((Y - oy) * W + (X - ox)) * 4;
            if (tid[pick] !== tid[c]) {
              const q = (srcBase[tid[pick]] + py * src.width + px) * 4;
              out[k4] = src.data[q];
              out[k4 + 1] = src.data[q + 1];
              out[k4 + 2] = src.data[q + 2];
              out[k4 + 3] = 255;
            }
            if (rimDef) {
              // distanza approssimata dal confine in px (la differenza di copertura cresce di ~2/s per px)
              const d = Math.max(0, ((bestS - secondS) * s) / 2);
              const width = rimDef.width ?? 2;
              const dither = rimDef.dither ?? 1;
              if (d < width && cellRandom(X, Y, 11) < (dither >= 1 ? 1 : dither * (1 - d / width))) {
                const col = rgb(rimDef);
                const cc = col[Math.floor(cellRandom(X, Y, 12) * col.length)];
                out[k4] = cc[0];
                out[k4 + 1] = cc[1];
                out[k4 + 2] = cc[2];
                out[k4 + 3] = 255;
              }
            }
          }
        }
      }
    }
    if (img) g.putImageData(img, ox, oy);
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
