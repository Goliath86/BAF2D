// Oggetti raccoglibili a terra (game.json -> "pickups"):
// - armi e granate lasciate dai soldati caduti (spariscono dopo "life" secondi, lampeggiando negli ultimi
//   "blinkTime");
// - punti fissi della mappa (legend del livello: { "tile": "floor", "pickup": "shotgun" }, tipi in
//   pickups.types) che fanno ricomparire l'oggetto "respawn" secondi dopo la raccolta.
// Le granate si raccolgono passandoci sopra (qualunque soldato, fino a maxGrenades); le armi solo con
// l'azione "pickup" (scambio: l'arma impugnata resta a terra), vedi Game._updatePickups.

import { drawSprite } from '../engine/assets.js';

export class Pickups {
  constructor(cfg = {}, assets, weapons) {
    this.cfg = cfg;
    this.types = cfg.types || {};
    this.assets = assets;
    this.weapons = weapons;
    this.list = []; // { kind: 'weapon'|'grenades', weapon, ammo, count, x, y, angle, age, life, spawner }
    this.spawners = []; // { def, x, y, item, timer }
    this.time = 0;
  }

  /** Nuova partita: niente oggetti lasciati, punti fissi della mappa pieni. */
  reset(map) {
    this.list = [];
    this.spawners = [];
    for (const p of map.pickups || []) {
      const def = this.types[p.type];
      if (!def) {
        console.warn(`Level pickup: unknown type "${p.type}" (game.json -> pickups.types)`);
        continue;
      }
      if (def.weapon && !this.weapons.ids.includes(def.weapon)) {
        console.warn(`Pickup "${p.type}": unknown weapon "${def.weapon}"`);
        continue;
      }
      const s = { def, x: p.x, y: p.y, item: null, timer: 0 };
      this.spawners.push(s);
      this._fill(s);
    }
  }

  _fill(s) {
    const d = s.def;
    const item = d.weapon
      ? this._item('weapon', s.x, s.y, { weapon: d.weapon, ammo: null, angle: d.angle ?? -0.35 })
      : this._item('grenades', s.x, s.y, { count: d.grenades ?? 2 });
    item.life = null; // resta finché qualcuno non lo prende
    item.spawner = s;
    s.item = item;
    this.list.push(item);
  }

  _item(kind, x, y, extra) {
    return { kind, x, y, angle: 0, age: 0, life: this.cfg.life ?? 30, spawner: null, weapon: null, ammo: null, count: 0, ...extra };
  }

  /** Arma lasciata a terra (ammo = colpi nel caricatore, reserve = scorta per le armi a munizioni contate). */
  dropWeapon(id, ammo, x, y, angle = 0, reserve = null) {
    // un'arma a munizioni contate completamente scarica non vale la pena lasciarla
    const w = this.weapons.get(id);
    if (w.reserve !== undefined && !ammo && !reserve) return;
    this.list.push(this._item('weapon', x, y, { weapon: id, ammo, angle, reserve }));
    this._trim();
  }

  /** Granate lasciate a terra. */
  dropGrenades(count, x, y) {
    if (count <= 0) return;
    this.list.push(this._item('grenades', x, y, { count }));
    this._trim();
  }

  /** Al massimo maxDropped oggetti lasciati (i più vecchi spariscono; i punti fissi non contano). */
  _trim() {
    const max = this.cfg.maxDropped ?? 16;
    let dropped = this.list.filter((i) => !i.spawner).length;
    for (let k = 0; k < this.list.length && dropped > max; ) {
      if (!this.list[k].spawner) {
        this.list.splice(k, 1);
        dropped--;
      } else k++;
    }
  }

  /** Toglie l'oggetto: se viene da un punto fisso parte il conto alla rovescia per farlo ricomparire. */
  take(item) {
    const i = this.list.indexOf(item);
    if (i >= 0) this.list.splice(i, 1);
    const s = item.spawner;
    if (s) {
      s.item = null;
      s.timer = s.def.respawn ?? 25;
    }
  }

  /** Colpi che l'arma a terra "it" contiene (caricatore + scorta; null = pieni). */
  ammoIn(it) {
    const w = this.weapons.get(it.weapon);
    return (it.ammo ?? w.magazine) + (it.reserve ?? w.reserve ?? 0);
  }

  /**
   * Munizioni prese passando sopra a un'arma uguale a una di quelle che l'unità porta: si tolgono prima dalla
   * scorta dell'oggetto, poi dal caricatore; vuoto = sparisce. Restituisce i colpi presi.
   */
  _scavenge(it, u) {
    const w = this.weapons.get(it.weapon);
    if (w.reserve === undefined || u.loadedOf(it.weapon) === null) return 0;
    const got = u.addAmmo(it.weapon, this.ammoIn(it));
    if (got <= 0) return 0;
    let rest = got;
    const fromReserve = Math.min(rest, it.reserve ?? w.reserve ?? 0);
    it.reserve = (it.reserve ?? w.reserve ?? 0) - fromReserve;
    rest -= fromReserve;
    it.ammo = (it.ammo ?? w.magazine) - rest;
    if (this.ammoIn(it) <= 0) this.take(it);
    return got;
  }

  /**
   * Avanza età e punti fissi; granate e munizioni (armi uguali alle proprie) raccolte da chi ci passa sopra:
   * onGrenades(unit, quante) e onAmmo(unit, colpi, idArma) per ogni raccolta.
   */
  update(dt, units, onGrenades, onAmmo) {
    this.time += dt;
    for (const s of this.spawners) {
      if (!s.item && (s.timer -= dt) <= 0) this._fill(s);
    }
    const r = this.cfg.radius ?? 9;
    for (let i = this.list.length - 1; i >= 0; i--) {
      const it = this.list[i];
      it.age += dt;
      if (it.life !== null && it.age >= it.life) {
        this.list.splice(i, 1);
        continue;
      }
      if (it.kind === 'weapon') {
        for (const u of units) {
          if (u.dead || u.vehicle || Math.hypot(u.x - it.x, u.y - it.y) > r) continue;
          const n = this._scavenge(it, u);
          if (n > 0) onAmmo?.(u, n, it.weapon);
          if (!this.list.includes(it)) break;
        }
        continue;
      }
      if (it.kind !== 'grenades') continue;
      for (const u of units) {
        if (u.dead || u.vehicle || u.grenades >= u.maxGrenades || Math.hypot(u.x - it.x, u.y - it.y) > r) continue;
        const n = u.addGrenades(it.count);
        it.count -= n;
        onGrenades?.(u, n);
        if (it.count <= 0) {
          this.take(it);
          break;
        }
      }
    }
  }

  /**
   * Arma a terra più vicina all'unità (entro radius) diversa da quelle che porta, o null (da un'arma uguale si
   * prendono solo i colpi, passandoci sopra: vedi update).
   */
  nearestWeapon(unit) {
    const r = this.cfg.radius ?? 9;
    let best = null;
    let bestD = r;
    for (const it of this.list) {
      if (it.kind !== 'weapon') continue;
      if (it.weapon === unit.primaryId || it.weapon === unit.specialId) continue;
      const d = Math.hypot(unit.x - it.x, unit.y - it.y);
      if (d <= bestD) {
        bestD = d;
        best = it;
      }
    }
    return best;
  }

  // ---------- Disegno (ctx in coordinate mondo) ----------

  /** Piazzole dei punti fissi (sotto a tutto, anche vuote). */
  drawPads(ctx) {
    const c = this.cfg;
    if (c.pad === false) return;
    const h = Math.floor((c.padSize ?? 12) / 2);
    ctx.fillStyle = c.padColor || 'rgba(255,211,107,0.35)';
    for (const s of this.spawners) {
      const x = Math.round(s.x) - h;
      const y = Math.round(s.y) - h;
      const w = h * 2;
      // angoli a "L" di 3 px
      const e = w - 3;
      ctx.fillRect(x, y, 3, 1);
      ctx.fillRect(x, y, 1, 3);
      ctx.fillRect(x + e, y, 3, 1);
      ctx.fillRect(x + w - 1, y, 1, 3);
      ctx.fillRect(x, y + w - 1, 3, 1);
      ctx.fillRect(x, y + e, 1, 3);
      ctx.fillRect(x + e, y + w - 1, 3, 1);
      ctx.fillRect(x + w - 1, y + e, 1, 3);
    }
  }

  /** Oggetti; "highlight" = oggetto offerto al giocatore (freccetta che oscilla sopra). */
  draw(ctx, highlight = null) {
    const c = this.cfg;
    const blinkTime = c.blinkTime ?? 5;
    const gSprite = this.assets.sprites.get(c.grenadeSprite || 'grenade');
    for (const it of this.list) {
      if (it.life !== null && it.life - it.age < blinkTime && Math.floor(it.age * 8) % 2 === 0) continue;
      if (it.kind === 'weapon') {
        const w = this.weapons.get(it.weapon);
        const sprite = w.pickupSprite && this.assets.sprites.get(w.pickupSprite);
        if (sprite) drawSprite(ctx, sprite, 0, it.x, it.y, it.angle);
      } else if (gSprite) {
        // una granata per unità (fino a 3), leggermente sfalsate
        const n = Math.min(3, it.count);
        for (let k = 0; k < n; k++) drawSprite(ctx, gSprite, 0, it.x - (n - 1) * 2 + k * 4, it.y + (k % 2) * 2 - 1, 0);
      }
    }
    if (highlight) {
      const x = Math.round(highlight.x);
      const y = Math.round(highlight.y) - 9 - (Math.floor(this.time * 4) % 2);
      ctx.fillStyle = '#000';
      ctx.fillRect(x - 3, y - 1, 7, 1);
      ctx.fillRect(x - 3, y, 1, 1);
      ctx.fillRect(x + 3, y, 1, 1);
      ctx.fillStyle = c.highlightColor || '#ffd36b';
      ctx.fillRect(x - 2, y, 5, 1);
      ctx.fillRect(x - 1, y + 1, 3, 1);
      ctx.fillRect(x, y + 2, 1, 1);
    }
  }
}
