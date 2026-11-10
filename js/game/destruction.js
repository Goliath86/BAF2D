// Distruzione dei tile: materiali con punti vita (game.json -> "destruction").
// Un tile è distruttibile se nel tileset (assets.json) ha "material": nome di destruction.materials.
// I proiettili lo danneggiano di (danno × material.bullet), le esplosioni di (danno × falloff × tileFactor del
// tipo di esplosione × material.explosion), i mezzi lo sfondano passandoci sopra se il materiale è nella loro
// lista "crush" (vehicles.json).
// Il danno si vede a stadi (crepe disegnate da TileMap); a zero punti vita il tile diventa "leaves"
// (nome di un tile del tileset, o "floor" = il pavimento più comune attorno) con le macerie del materiale sopra.
// La mappa resta così fino alla rivincita (reset).

const DIRS4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const DIRS8 = [...DIRS4, [1, 1], [1, -1], [-1, 1], [-1, -1]];

export class Destruction {
  /**
   * cfg = game.json -> "destruction"; map = TileMap; nav = Nav (aggiornata a ogni tile distrutto);
   * onBreak(tx, ty, material, x, y) = effetti e suoni della rottura (Game).
   */
  constructor(cfg = {}, map, nav, onBreak = null) {
    this.cfg = cfg;
    this.map = map;
    this.nav = nav;
    this.onBreak = onBreak;
    this.enabled = cfg.enabled !== false;
    this.materials = cfg.materials || {};
    this.stages = Math.max(1, cfg.stages ?? 3);
    const n = map.cols * map.rows;
    this.hp = new Float32Array(n); // punti vita rimasti (0 = non distruttibile o già distrutto)
    this.maxHp = new Float32Array(n);
    this.broken = 0; // tile distrutti in questa partita
    this.changed = []; // tile distrutti dall'ultima takeChanged() (per l'IA: ripari spariti)
    for (let ty = 0; ty < map.rows; ty++) {
      for (let tx = 0; tx < map.cols; tx++) {
        // i tile sul bordo della mappa restano: la mappa conserva il suo perimetro
        if (tx === 0 || ty === 0 || tx === map.cols - 1 || ty === map.rows - 1) continue;
        const m = this.materialAt(tx, ty);
        if (!m || !(m.hp > 0)) continue;
        const i = ty * map.cols + tx;
        this.hp[i] = this.maxHp[i] = m.hp;
      }
    }
  }

  /** Materiale del tile (tx, ty) (voce di destruction.materials con "id") o null. */
  materialAt(tx, ty) {
    const t = this.map.tileAt(tx, ty);
    const id = t?.material;
    const m = id ? this.materials[id] : null;
    return m ? { id, ...m } : null;
  }

  /** Il tile (tx, ty) si può ancora danneggiare. */
  destructible(tx, ty) {
    if (!this.enabled || tx < 0 || ty < 0 || tx >= this.map.cols || ty >= this.map.rows) return false;
    return this.hp[ty * this.map.cols + tx] > 0;
  }

  /** Colpo di proiettile sul tile (tx, ty) con danno "damage". */
  bullet(tx, ty, damage) {
    if (!this.destructible(tx, ty)) return;
    const m = this.materialAt(tx, ty);
    this.damage(tx, ty, damage * (m.bullet ?? 0) * (this.cfg.bulletFactor ?? 1));
  }

  /**
   * Esplosione in (x, y): danneggia i tile entro radius (distanza dal bordo del tile) con decadimento
   * lineare fino a minFactor; un tile riparato da un altro tile che ferma i colpi non viene toccato.
   * Le linee di vista si calcolano prima di applicare i danni (un muro che crolla ora non espone quello dietro).
   */
  explosion(x, y, radius, damage, minFactor = 0.2, tileFactor = 1) {
    if (!this.enabled || !(damage > 0) || !(radius > 0)) return;
    const map = this.map;
    const s = map.size;
    const hits = [];
    const tx0 = Math.floor((x - radius) / s);
    const tx1 = Math.floor((x + radius) / s);
    const ty0 = Math.floor((y - radius) / s);
    const ty1 = Math.floor((y + radius) / s);
    for (let ty = ty0; ty <= ty1; ty++) {
      for (let tx = tx0; tx <= tx1; tx++) {
        if (!this.destructible(tx, ty)) continue;
        // punto del tile più vicino all'esplosione
        const px = Math.max(tx * s, Math.min((tx + 1) * s - 0.01, x));
        const py = Math.max(ty * s, Math.min((ty + 1) * s - 0.01, y));
        const d = Math.hypot(px - x, py - y);
        if (d >= radius || !this._reaches(x, y, px, py, tx, ty)) continue;
        const m = this.materialAt(tx, ty);
        const k = 1 - (d / radius) * (1 - minFactor);
        hits.push([tx, ty, damage * k * tileFactor * (m.explosion ?? 1) * (this.cfg.explosionFactor ?? 1)]);
      }
    }
    for (const [tx, ty, n] of hits) this.damage(tx, ty, n);
  }

  /** Dal punto (x, y) si arriva a (px, py) del tile (tx, ty) senza attraversare altri tile che fermano i colpi. */
  _reaches(x, y, px, py, tx, ty) {
    const map = this.map;
    const s = map.size;
    const n = Math.ceil(Math.hypot(px - x, py - y) / 2);
    for (let k = 1; k < n; k++) {
      const t = k / n;
      const cx = Math.floor((x + (px - x) * t) / s);
      const cy = Math.floor((y + (py - y) * t) / s);
      if ((cx !== tx || cy !== ty) && map.blocksShotTile(cx, cy)) return false;
    }
    return true;
  }

  /**
   * Mezzo che spinge contro il tile (tx, ty): lo sfonda se il materiale è tra quelli che il mezzo schiaccia
   * (vehicles.json -> crush, es. ["wood", "foliage"]). true = sfondato.
   */
  crush(tx, ty, materials) {
    if (!this.destructible(tx, ty)) return false;
    const m = this.materialAt(tx, ty);
    if (!materials?.includes(m.id)) return false;
    this.damage(tx, ty, Infinity);
    return true;
  }

  /** Toglie "amount" punti vita al tile: crepe a stadi, a zero il tile si rompe. */
  damage(tx, ty, amount) {
    if (!(amount > 0) || !this.destructible(tx, ty)) return;
    const map = this.map;
    const i = ty * map.cols + tx;
    const before = this._stage(i);
    this.hp[i] = Math.max(0, this.hp[i] - amount);
    if (this.hp[i] <= 0) {
      this._break(tx, ty);
      return;
    }
    const after = this._stage(i);
    if (after !== before) map.setCrack(tx, ty, after / this.stages, this.materialAt(tx, ty)?.crack || map.tileAt(tx, ty)?.crackColor);
  }

  /** Stadio di danno 0..stages-1 (0 = intatto). */
  _stage(i) {
    const max = this.maxHp[i];
    if (!(max > 0)) return 0;
    return Math.min(this.stages - 1, Math.floor((1 - this.hp[i] / max) * this.stages));
  }

  _break(tx, ty) {
    const map = this.map;
    const m = this.materialAt(tx, ty);
    const i = ty * map.cols + tx;
    this.hp[i] = 0;
    const next = this._leaves(tx, ty, m);
    // macerie: colori del materiale, o "tile" = quelli del tile distrutto (mattoni rossi, adobe, sacchi...)
    const debris = m?.debris === 'tile' ? map.tileAt(tx, ty)?.debrisColors : m?.debris;
    map.setTile(tx, ty, next, debris || null);
    this.navDirty = true; // la griglia dei percorsi si ricalcola una volta sola per tick (flush)
    this.broken++;
    this.changed.push({ tx, ty });
    const s = map.size;
    this.onBreak?.(tx, ty, m?.id, (tx + 0.5) * s, (ty + 0.5) * s);
  }

  /** Id del tile che prende il posto di quello distrutto. */
  _leaves(tx, ty, m) {
    const map = this.map;
    const ts = map.tileset;
    const tile = map.tileAt(tx, ty);
    const ref = tile?.destroysTo ?? m?.leaves ?? 'floor';
    if (ref !== 'floor') {
      const t = ts.byName.get(ref);
      if (t && !t.solid) return t.id;
    }
    // "floor": il tile calpestabile più frequente attorno (prima i 4 lati, poi anche le diagonali)
    for (const dirs of [DIRS4, DIRS8]) {
      const count = new Map();
      for (const [dx, dy] of dirs) {
        const n = map.tileAt(tx + dx, ty + dy);
        if (n && !n.solid) count.set(n.id, (count.get(n.id) || 0) + 1);
      }
      let best = null;
      let bestN = 0;
      for (const [id, k] of count) if (k > bestN) { best = id; bestN = k; }
      if (best !== null) return best;
    }
    const fallback = ts.byName.get(m?.fallback) || [...ts.byId.values()].find((t) => !t.solid);
    return fallback ? fallback.id : map.tiles[ty * map.cols + tx];
  }

  /** Fine tick: aggiorna la griglia dei percorsi (Nav) se qualche tile è stato distrutto. */
  flush() {
    if (!this.navDirty) return;
    this.navDirty = false;
    this.nav?.refresh();
  }

  /** Tile distrutti dall'ultima chiamata (svuota la lista). */
  takeChanged() {
    const c = this.changed;
    this.changed = [];
    return c;
  }
}
