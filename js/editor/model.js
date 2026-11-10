// Modello dati dell'editor di mappe: griglia di "pennelli" (un tile o una lista di varianti con pesi),
// un oggetto opzionale per cella (spawn, bandiera, arma a terra, decorazione, mezzo) e le proprietà del livello.
// Importa ed esporta il formato dei livelli del gioco (config/levels/*.json: righe di caratteri + legend),
// che è anche il formato di salvataggio: un file salvato si riapre e si continua.

import { cellRandom } from '../engine/tilemap.js';

/** Campi del livello gestiti dall'editor; gli altri vengono conservati così come sono (extra). */
const KNOWN = new Set(['name', 'description', 'tileset', 'fill', 'weather', 'background', 'legend', 'flags', 'map']);

/** Ordine di priorità se una voce della legend ha più oggetti (l'editor ne tiene uno per cella). */
const OBJECT_FIELDS = ['vehicle', 'flag', 'spawn', 'pickup', 'prop'];

/** Chiave stabile di un oggetto (per confronti e per la legend). */
export function objectKey(o) {
  if (!o) return '';
  switch (o.kind) {
    case 'vehicle':
      return `vehicle:${o.type}:${o.team ?? ''}:${o.angleDeg ?? 0}`;
    case 'flag':
      return `flag:${o.id}`;
    case 'spawn':
      return `spawn:${o.team}`;
    default:
      return `${o.kind}:${o.type}`;
  }
}

const normAngle = (a) => ((Math.round(a) % 360) + 360) % 360;

/** Testo localizzabile del livello: stringa o { lingua: testo }. */
function textOf(v, lang) {
  if (typeof v === 'string') return v;
  if (v && typeof v === 'object') return v[lang] ?? v.en ?? Object.values(v).find((s) => typeof s === 'string') ?? '';
  return '';
}

export class EditorMap {
  /**
   * tilesetDefs = assets.json -> tilesets (definizioni grezze: nomi, id, solidità);
   * teams = id delle squadre (game.json -> teams), per gli scambi di squadra della simmetria.
   */
  constructor({ tilesetDefs, teams }) {
    this.tilesetDefs = tilesetDefs;
    this.teams = teams;
    this.brushes = []; // { key, names: string[], weights: number[] | null }
    this.brushIndex = new Map();
    this.hints = new Map(); // chiave combinazione -> carattere usato nel file importato (export stabile)
    this.reset(24, 14, Object.keys(tilesetDefs)[0]);
  }

  // ---------- Tileset e pennelli ----------

  tileDefs(tileset = this.meta.tileset) {
    return this.tilesetDefs[tileset]?.tiles || [];
  }

  /** Definizione del tile per nome (indice per tileset: il controllo la chiede per ogni cella). */
  tileDef(name, tileset = this.meta.tileset) {
    this._byName ||= new Map();
    let idx = this._byName.get(tileset);
    if (!idx) {
      idx = new Map();
      for (const t of this.tileDefs(tileset)) if (!idx.has(t.name)) idx.set(t.name, t); // come find(): vince il primo
      this._byName.set(tileset, idx);
    }
    return idx.get(name) || null;
  }

  /** Nome del tile da un riferimento della legend (nome o id numerico); null se non esiste. */
  tileName(ref, tileset = this.meta.tileset) {
    const defs = this.tileDefs(tileset);
    const t = typeof ref === 'number' ? defs.find((d) => d.id === ref) : defs.find((d) => d.name === ref);
    return t ? t.name : null;
  }

  /** Indice del pennello per un tile (nome) o una lista di varianti con pesi opzionali. */
  brush(tile, weights = null) {
    const names = Array.isArray(tile) ? tile.slice() : [tile];
    let w = Array.isArray(weights) && weights.length === names.length ? weights.slice() : null;
    if (w && w.every((v) => v === w[0])) w = null; // pesi tutti uguali = nessun peso
    const key = JSON.stringify([names, w]);
    let i = this.brushIndex.get(key);
    if (i === undefined) {
      i = this.brushes.length;
      this.brushes.push({ key, names, weights: w });
      this.brushIndex.set(key, i);
    }
    return i;
  }

  /** Il pennello usa solo tile del tileset indicato. */
  brushValid(i, tileset = this.meta.tileset) {
    const b = this.brushes[i];
    return !!b && b.names.every((n) => this.tileDef(n, tileset));
  }

  /** Tile effettivo della cella (stessa scelta stabile delle varianti di TileMap._pick). */
  resolvedName(x, y, b = this.tiles[y * this.cols + x]) {
    const br = this.brushes[b];
    if (!br) return null;
    if (br.names.length === 1) return br.names[0];
    const w = br.weights || br.names.map(() => 1);
    const total = w.reduce((s, v) => s + v, 0);
    let r = cellRandom(x, y, 7) * total;
    for (let i = 0; i < br.names.length; i++) {
      r -= w[i];
      if (r < 0) return br.names[i];
    }
    return br.names[br.names.length - 1];
  }

  isSolid(x, y) {
    const d = this.tileDef(this.resolvedName(x, y));
    return !d || !!d.solid;
  }

  // ---------- Griglia ----------

  /** Mappa nuova: tutta "base", con un bordo di "border" se indicato (nomi di tile). */
  reset(cols, rows, tileset, base = null, border = null) {
    this.cols = cols;
    this.rows = rows;
    this.meta = { name: '', description: '', tileset, fill: null, weather: null, background: null };
    const defs = this.tileDefs(tileset);
    // base: nome di un tile o lista di varianti
    const baseRef = base || defs.find((t) => !t.solid)?.name || defs[0]?.name;
    this.meta.fill = border || defs.find((t) => t.solid)?.name || (Array.isArray(baseRef) ? baseRef[0] : baseRef);
    const b = this.brush(baseRef);
    this.tiles = new Int32Array(cols * rows).fill(b);
    if (border) {
      const w = this.brush(border);
      for (let x = 0; x < cols; x++) {
        this.tiles[x] = w;
        this.tiles[(rows - 1) * cols + x] = w;
      }
      for (let y = 0; y < rows; y++) {
        this.tiles[y * cols] = w;
        this.tiles[y * cols + cols - 1] = w;
      }
    }
    this.objects = new Map(); // indice cella -> oggetto
    this.flags = {}; // id bandiera -> { owner, ...impostazioni } (anche di bandiere tolte: tornano se rimesse)
    this.extra = {};
    this.hints = new Map();
  }

  inside(x, y) {
    return x >= 0 && y >= 0 && x < this.cols && y < this.rows;
  }

  index(x, y) {
    return y * this.cols + x;
  }

  /** Cella speculare secondo la simmetria: 'rotate' (180°), 'horizontal' (sinistra-destra), 'vertical'. */
  mirror(x, y, mode) {
    if (mode === 'rotate') return [this.cols - 1 - x, this.rows - 1 - y];
    if (mode === 'horizontal') return [this.cols - 1 - x, y];
    if (mode === 'vertical') return [x, this.rows - 1 - y];
    return null;
  }

  otherTeam(team) {
    if (!team || this.teams.length !== 2) return team;
    const i = this.teams.indexOf(team);
    return i < 0 ? team : this.teams[1 - i];
  }

  /** Oggetto speculare (squadra scambiata, direzione dei mezzi riflessa); le bandiere le gestisce l'editor. */
  mirrorObject(o, mode) {
    if (o.kind === 'spawn') return { ...o, team: this.otherTeam(o.team) };
    if (o.kind === 'vehicle') {
      const a = o.angleDeg ?? 0;
      const angleDeg = normAngle(mode === 'rotate' ? a + 180 : mode === 'horizontal' ? 180 - a : -a);
      return { ...o, team: this.otherTeam(o.team), angleDeg };
    }
    return { ...o };
  }

  /** Lettera libera per una nuova bandiera (dopo "after" se indicata). */
  freeFlagId(ids, after = null) {
    const used = new Set(this.flagCells().map((f) => f.id));
    const start = after ? ids.indexOf(after) + 1 : 0;
    for (let k = 0; k < ids.length; k++) {
      const id = ids[(start + k) % ids.length];
      if (!used.has(id)) return id;
    }
    return null;
  }

  /** Bandiere sulla mappa: [{ id, i, x, y }] in ordine di id. */
  flagCells() {
    const out = [];
    for (const [i, o] of this.objects) if (o.kind === 'flag') out.push({ id: o.id, i, x: i % this.cols, y: Math.floor(i / this.cols) });
    return out.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  }

  spawnCells() {
    const out = [];
    for (const [i, o] of this.objects) if (o.kind === 'spawn') out.push({ team: o.team, i, x: i % this.cols, y: Math.floor(i / this.cols) });
    return out;
  }

  /**
   * Mette un oggetto (null = toglie). Spawn e bandiere sono unici (per squadra / per id): quello vecchio
   * viene tolto. Restituisce gli indici delle celle cambiate.
   */
  setObject(i, o) {
    const changed = [i];
    if (o && (o.kind === 'spawn' || o.kind === 'flag')) {
      for (const [j, other] of this.objects) {
        if (j !== i && other.kind === o.kind && (o.kind === 'spawn' ? other.team === o.team : other.id === o.id)) {
          this.objects.delete(j);
          changed.push(j);
        }
      }
      if (o.kind === 'flag' && !this.flags[o.id]) this.flags[o.id] = { owner: null };
    }
    if (o) this.objects.set(i, o);
    else this.objects.delete(i);
    return changed;
  }

  /** Cambia dimensioni; anchor 'center' = si aggiunge/toglie su tutti i lati, 'topLeft' = a destra e in basso. */
  resize(cols, rows, anchor, brush) {
    const ox = anchor === 'center' ? Math.floor((cols - this.cols) / 2) : 0;
    const oy = anchor === 'center' ? Math.floor((rows - this.rows) / 2) : 0;
    const tiles = new Int32Array(cols * rows).fill(brush);
    const objects = new Map();
    for (let y = 0; y < this.rows; y++) {
      for (let x = 0; x < this.cols; x++) {
        const nx = x + ox;
        const ny = y + oy;
        if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
        tiles[ny * cols + nx] = this.tiles[y * this.cols + x];
        const o = this.objects.get(y * this.cols + x);
        if (o) objects.set(ny * cols + nx, o);
      }
    }
    this.cols = cols;
    this.rows = rows;
    this.tiles = tiles;
    this.objects = objects;
  }

  /** Sostituisce i tile assenti nel nuovo tileset con "fallback"; restituisce quante celle sono cambiate. */
  changeTileset(tileset, fallback) {
    const fb = this.brush(fallback);
    const remap = new Map();
    let n = 0;
    for (let i = 0; i < this.tiles.length; i++) {
      const b = this.tiles[i];
      if (!remap.has(b)) remap.set(b, this.brushValid(b, tileset) ? b : fb);
      const nb = remap.get(b);
      if (nb !== b) n++;
      this.tiles[i] = nb;
    }
    this.meta.tileset = tileset;
    if (!this.tileDef(this.meta.fill)) this.meta.fill = fallback;
    return n;
  }

  // ---------- Annulla / ripeti ----------

  snapshot() {
    return {
      cols: this.cols,
      rows: this.rows,
      tiles: this.tiles.slice(),
      objects: new Map(this.objects), // gli oggetti non vengono mai modificati sul posto
      flags: JSON.parse(JSON.stringify(this.flags)),
      meta: { ...this.meta },
    };
  }

  restore(s) {
    this.cols = s.cols;
    this.rows = s.rows;
    this.tiles = s.tiles.slice();
    this.objects = new Map(s.objects);
    this.flags = JSON.parse(JSON.stringify(s.flags));
    this.meta = { ...s.meta };
  }

  // ---------- Controlli ----------

  /** Griglia [y][x] delle celle percorribili (per levelcheck.checkGrid). */
  walkGrid() {
    const out = [];
    for (let y = 0; y < this.rows; y++) {
      const row = new Array(this.cols);
      for (let x = 0; x < this.cols; x++) row[x] = !this.isSolid(x, y);
      out.push(row);
    }
    return out;
  }

  // ---------- Import / export ----------

  /**
   * Carica un livello del gioco. Restituisce { warnings: [{ key, params }] } (tile sconosciuti, oggetti
   * multipli nella stessa cella). Lancia un errore con "key" se il tileset non esiste.
   */
  fromLevel(level, lang = 'en') {
    const warnings = [];
    const tileset = level.tileset;
    if (!this.tilesetDefs[tileset]) {
      const e = new Error(`Unknown tileset "${tileset}"`);
      e.key = 'editor.errors.tileset';
      e.params = { tileset: String(tileset) };
      throw e;
    }
    if (!Array.isArray(level.map) || !level.map.length) {
      const e = new Error('Level without "map"');
      e.key = 'editor.errors.noMap';
      throw e;
    }
    const rows = level.map.length;
    const cols = level.map.reduce((m, r) => Math.max(m, String(r).length), 0);
    this.reset(cols, rows, tileset);
    const defs = this.tileDefs(tileset);
    const fallbackName = this.tileName(level.fill ?? 0, tileset) || defs.find((t) => !t.solid)?.name || defs[0].name;
    this.meta.fill = fallbackName;
    this.meta.name = textOf(level.name, lang);
    this.meta.description = textOf(level.description, lang);
    this.meta.weather = level.weather ?? null;
    this.meta.background = level.background ?? null;
    for (const [k, v] of Object.entries(level)) if (!KNOWN.has(k)) this.extra[k] = v;
    for (const [id, f] of Object.entries(level.flags || {})) this.flags[id] = { owner: null, ...f };

    const unknown = new Set();
    const resolveTiles = (ref) => {
      const list = Array.isArray(ref) ? ref : [ref];
      const names = list.map((r) => {
        const n = this.tileName(r, tileset);
        if (!n) unknown.add(String(r));
        return n || fallbackName;
      });
      return names;
    };
    // voce della legend -> { brush, obj }
    const legend = level.legend || {};
    const cache = new Map();
    const multi = new Set();
    const decode = (ch) => {
      if (cache.has(ch)) return cache.get(ch);
      const e = legend[ch];
      let out;
      if (e === undefined) out = { brush: this.brush(fallbackName), obj: null };
      else if (Array.isArray(e) || typeof e !== 'object') out = { brush: this.brush(resolveTiles(e)), obj: null };
      else {
        const names = resolveTiles(e.tile ?? fallbackName);
        const brush = this.brush(names.length === 1 ? names[0] : names, e.variantWeights);
        const found = OBJECT_FIELDS.filter((f) => e[f] !== undefined && e[f] !== null);
        if (found.length > 1) multi.add(ch);
        let obj = null;
        switch (found[0]) {
          case 'vehicle':
            obj = { kind: 'vehicle', type: String(e.vehicle), team: e.team ?? null, angleDeg: normAngle(e.angleDeg ?? 0) };
            break;
          case 'flag':
            obj = { kind: 'flag', id: String(e.flag) };
            break;
          case 'spawn':
            obj = { kind: 'spawn', team: String(e.spawn) };
            break;
          case 'pickup':
            obj = { kind: 'pickup', type: String(e.pickup) };
            break;
          case 'prop':
            obj = { kind: 'prop', type: String(e.prop) };
            break;
        }
        out = { brush, obj };
      }
      const combo = `${this.brushes[out.brush].key}|${objectKey(out.obj)}`;
      if (!this.hints.has(combo) && ch.length === 1) this.hints.set(combo, ch);
      cache.set(ch, out);
      return out;
    };

    for (let y = 0; y < rows; y++) {
      const row = String(level.map[y]);
      for (let x = 0; x < cols; x++) {
        const { brush, obj } = decode(row[x] ?? '\u0000');
        const i = y * cols + x;
        this.tiles[i] = brush;
        if (obj) this.setObject(i, obj);
      }
    }
    if (unknown.size) warnings.push({ key: 'editor.warnings.unknownTiles', params: { tiles: [...unknown].join(', '), tile: fallbackName } });
    if (multi.size) warnings.push({ key: 'editor.warnings.multiObjects', params: { chars: [...multi].join(' ') } });
    return { warnings };
  }

  /** Livello nel formato del gioco. legendChars = caratteri preferiti per la legend (game.json -> editor). */
  toLevel(legendChars = '.#') {
    // combinazioni pennello + oggetto presenti, con il numero di celle
    const combos = new Map();
    const cellCombo = new Array(this.tiles.length);
    for (let i = 0; i < this.tiles.length; i++) {
      const b = this.tiles[i];
      const obj = this.objects.get(i) || null;
      const key = `${this.brushes[b].key}|${objectKey(obj)}`;
      let c = combos.get(key);
      if (!c) combos.set(key, (c = { key, brush: b, obj, count: 0, ch: null }));
      c.count++;
      cellCombo[i] = c;
    }

    // caratteri: quelli del file importato, poi la lettera della bandiera / il numero della squadra, poi i preferiti
    const used = new Set(['\u0000']);
    const take = (c, ch) => {
      if (!ch || ch.length !== 1 || used.has(ch) || ch === ' ' || ch === '\\') return false;
      c.ch = ch;
      used.add(ch);
      return true;
    };
    const list = [...combos.values()].sort((a, b) => b.count - a.count);
    for (const c of list) take(c, this.hints.get(c.key));
    for (const c of list) {
      if (c.ch || !c.obj) continue;
      if (c.obj.kind === 'flag') take(c, c.obj.id);
      else if (c.obj.kind === 'spawn') take(c, String(this.teams.indexOf(c.obj.team) + 1));
    }
    const pool = [...legendChars];
    let code = 0xc0;
    const next = () => {
      while (pool.length) {
        const ch = pool.shift();
        if (!used.has(ch) && ch !== ' ' && ch !== '\\') return ch;
      }
      while (used.has(String.fromCharCode(code)) || code === 0xd7 || code === 0xf7) code++;
      return String.fromCharCode(code++);
    };
    for (const c of list) if (!c.ch) take(c, next());

    // legend nell'ordine: senza oggetti (più usati prima), poi con oggetti
    const legend = {};
    const entryOf = (c) => {
      const br = this.brushes[c.brush];
      const tile = br.names.length === 1 ? br.names[0] : br.names;
      if (!c.obj && !br.weights) return tile;
      const e = { tile };
      if (br.weights) e.variantWeights = br.weights;
      const o = c.obj;
      if (o?.kind === 'vehicle') {
        e.vehicle = o.type;
        if (o.team) e.team = o.team;
        e.angleDeg = o.angleDeg ?? 0;
      } else if (o?.kind === 'flag') e.flag = o.id;
      else if (o?.kind === 'spawn') e.spawn = o.team;
      else if (o) e[o.kind] = o.type;
      return e;
    };
    const order = { '': 0, spawn: 1, prop: 2, pickup: 3, vehicle: 4, flag: 5 };
    const sorted = list.slice().sort((a, b) => order[a.obj?.kind ?? ''] - order[b.obj?.kind ?? ''] || (a.obj && b.obj ? objectKey(a.obj).localeCompare(objectKey(b.obj)) : b.count - a.count));
    for (const c of sorted) legend[c.ch] = entryOf(c);

    const map = [];
    for (let y = 0; y < this.rows; y++) {
      let row = '';
      for (let x = 0; x < this.cols; x++) row += cellCombo[y * this.cols + x].ch;
      map.push(row);
    }

    const flags = {};
    for (const f of this.flagCells()) flags[f.id] = { owner: null, ...this.flags[f.id] };

    const level = { name: this.meta.name, description: this.meta.description, tileset: this.meta.tileset, fill: this.meta.fill };
    if (this.meta.weather) level.weather = this.meta.weather;
    if (this.meta.background) level.background = this.meta.background;
    Object.assign(level, this.extra);
    level.legend = legend;
    level.flags = flags;
    level.map = map;
    return level;
  }
}

/** JSON del livello leggibile come i file in config/levels: una voce della legend e una riga della mappa per riga. */
export function formatLevel(level) {
  const lines = ['{'];
  const keys = Object.keys(level);
  keys.forEach((k, n) => {
    const last = n === keys.length - 1 ? '' : ',';
    const v = level[k];
    if ((k === 'legend' || k === 'flags') && v && typeof v === 'object' && Object.keys(v).length) {
      const entries = Object.entries(v);
      lines.push(`  ${JSON.stringify(k)}: {`);
      entries.forEach(([ek, ev], j) => lines.push(`    ${JSON.stringify(ek)}: ${JSON.stringify(ev)}${j === entries.length - 1 ? '' : ','}`));
      lines.push(`  }${last}`);
    } else if (k === 'map' && Array.isArray(v)) {
      lines.push(`  "map": [`);
      v.forEach((r, j) => lines.push(`    ${JSON.stringify(r)}${j === v.length - 1 ? '' : ','}`));
      lines.push(`  ]${last}`);
    } else {
      lines.push(`  ${JSON.stringify(k)}: ${JSON.stringify(v)}${last}`);
    }
  });
  lines.push('}');
  return lines.join('\n') + '\n';
}
