// Mezzi (config/vehicles.json): jeep, carro... guidati da un soldato (umano o bot) con gli stessi comandi
// della fanteria: move = direzione desiderata (spazio schermo), aim = rotazione della torretta,
// firing = arma 0 (mitragliatrice), secondary = arma 1 (razzi), reload.
// - Guida: lo scafo ruota verso la direzione richiesta (turnRate) e accelera solo quando è allineato; oltre
//   reverseAngleDeg va in retromarcia. "turnNeedsSpeed" (jeep): da fermo sterza poco.
// - Corazza ("armor"): i proiettili non fanno danni (scintille); esplosioni e razzi sì (vedi Game).
// - Distrutto: carcassa (frame "wreckFrame") che fuma per wreckTime secondi, poi sparisce; il punto di
//   comparsa della mappa ne crea uno nuovo dopo "respawn" secondi.
// Collisione con la mappa: quadrato hitbox[0] x hitbox[1] (lo scafo ruota, il quadrato no).

import { LocalizedError } from '../engine/errors.js';
import { drawSprite } from '../engine/assets.js';

const DEG = Math.PI / 180;

function angleDiff(a, b) {
  let d = (a - b) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d <= -Math.PI) d += Math.PI * 2;
  return d;
}

/** Catalogo dei tipi di mezzo: "defaults" + voce. */
export class VehicleTypes {
  constructor(cfg = {}) {
    const defaults = cfg.defaults || {};
    this.defs = new Map();
    for (const [id, def] of Object.entries(cfg.vehicles || {})) this.defs.set(id, Object.freeze({ ...defaults, ...def, id }));
  }

  get(id) {
    const v = this.defs.get(id);
    if (!v) throw new LocalizedError('errors.unknownVehicle', { name: id }, `Vehicle not defined in vehicles.json: "${id}"`);
    return v;
  }

  has(id) {
    return this.defs.has(id);
  }
}

/** Sagoma nera dello sprite (per l'ombra a terra), in cache per sprite e frame. */
const silhouettes = new Map();
function silhouette(sprite, frame) {
  const key = `${sprite.name}#${frame}`;
  let c = silhouettes.get(key);
  if (c) return c;
  c = document.createElement('canvas');
  c.width = sprite.fw;
  c.height = sprite.fh;
  const g = c.getContext('2d');
  const sx = (frame % sprite.cols) * sprite.fw;
  const sy = Math.floor(frame / sprite.cols) * sprite.fh;
  g.drawImage(sprite.image, sx, sy, sprite.fw, sprite.fh, 0, 0, sprite.fw, sprite.fh);
  g.globalCompositeOperation = 'source-in';
  g.fillStyle = '#000';
  g.fillRect(0, 0, c.width, c.height);
  c = { name: key, image: c, fw: sprite.fw, fh: sprite.fh, cols: 1, origin: sprite.origin };
  silhouettes.set(key, c);
  return c;
}

export class Vehicle {
  /** spawn = punto della mappa da cui viene (per il rientro), team = squadra iniziale (null = neutro). */
  constructor(def, x, y, angle, team, assets, weapons, spawn = null) {
    this.def = def;
    this.assets = assets;
    this.x = x;
    this.y = y;
    this.angle = angle; // scafo
    this.turret = angle; // torretta
    this.speed = 0; // px/s lungo lo scafo (negativo = retromarcia)
    this.vx = 0;
    this.vy = 0;
    this.hw = (def.hitbox?.[0] ?? 20) / 2;
    this.hh = (def.hitbox?.[1] ?? 20) / 2;
    this.maxHealth = def.health ?? 300;
    this.health = this.maxHealth;
    this.team = team;
    this.spawn = spawn;
    this.driver = null;
    this.destroyed = false;
    this.wreckAge = 0;
    this.removed = false; // da togliere dalla lista (carcassa svanita o mezzo abbandonato)
    this.idle = 0; // secondi senza pilota
    this.lastHitBy = null; // soldato che l'ha colpito per ultimo (merito della distruzione)
    this.aimDistance = null; // pilota bot: distanza dal bersaglio (gittata dei colpi)
    this.trackPhase = 0;
    this.smokeTimer = 0;
    this.time = 0;
    this.guns = (def.weapons || []).map((id) => {
      const w = weapons.get(id);
      return { w, ammo: w.magazine, cooldown: 0, reload: null, side: 1 };
    });
  }

  get isVehicle() {
    return true;
  }

  /** Per l'IA e il CTF: un mezzo distrutto è "morto". */
  get dead() {
    return this.destroyed;
  }

  get occupied() {
    return !!this.driver;
  }

  /** Distanza entro cui un soldato può salire. */
  get enterReach() {
    return Math.max(this.hw, this.hh) + (this.def.enterRadius ?? 12);
  }

  enter(unit) {
    this.driver = unit;
    unit.vehicle = this;
    this.team = unit.team;
    this.idle = 0;
    this.aimDistance = null;
  }

  /** Il pilota scende: restituisce il soldato (che Game riposiziona accanto al mezzo). */
  exit() {
    const u = this.driver;
    this.driver = null;
    if (u) u.vehicle = null;
    return u;
  }

  /** Danno (solo da esplosioni/razzi: la corazza ferma i proiettili, vedi Game). */
  damage(amount, by = null) {
    if (this.destroyed || amount <= 0) return 0;
    if (by) this.lastHitBy = by;
    const before = this.health;
    this.health = Math.max(0, this.health - amount);
    return before - this.health;
  }

  /** Punto di perno della torretta in coordinate mondo. */
  get pivot() {
    const [px, py] = this.def.turretPivot || [0, 0];
    const c = Math.cos(this.angle);
    const s = Math.sin(this.angle);
    return { x: this.x + c * px - s * py, y: this.y + s * px + c * py };
  }

  /** Volata dell'arma "gun" (ai lati alterni per i lanciarazzi con podSpread). */
  muzzleOf(gun) {
    const p = this.pivot;
    // lunghezza della canna: per mezzo (def.muzzles = { idArma: px }) o dell'arma
    const off = this.def.muzzles?.[gun.w.id] ?? gun.w.muzzleOffset ?? 10;
    const side = (gun.w.podSpread ?? 0) * gun.side;
    const c = Math.cos(this.turret);
    const s = Math.sin(this.turret);
    return { x: p.x + c * off - s * side, y: p.y + s * off + c * side };
  }

  /** Avanzamento della ricarica dell'arma i (0..1). */
  reloadProgress(i) {
    const g = this.guns[i];
    return g?.reload ? Math.min(1, g.reload.time / g.reload.duration) : 0;
  }

  /**
   * Un tick: ctrl = { move, aim(vehicle) -> angolo|null, firing, secondary, reload } o null (nessun pilota).
   * game.fireVehicle(vehicle, gun) spara.
   */
  update(dt, game, ctrl) {
    this.time += dt;
    const d = this.def;
    if (this.destroyed) {
      this.wreckAge += dt;
      this.speed *= Math.exp(-6 * dt);
      this._move(dt, game.map);
      this._smoke(dt, game, d.wreckSmoke || 'wreck');
      if (this.wreckAge >= (d.wreckTime ?? 20)) this.removed = true;
      return;
    }
    if (!ctrl) {
      this.idle += dt;
      this.speed *= Math.exp(-(d.idleBrake ?? 4) * dt);
      this._move(dt, game.map);
    } else {
      this.idle = 0;
      this._drive(dt, ctrl);
      this._move(dt, game.map);
      const aim = ctrl.aim(this);
      if (aim !== null && aim !== undefined) {
        const maxTurn = (d.turretTurnRate ?? 4) * dt;
        this.turret += Math.max(-maxTurn, Math.min(maxTurn, angleDiff(aim, this.turret)));
      }
      this._weapons(dt, game, ctrl);
    }
    // danneggiato: fumo dal motore
    if (this.health < this.maxHealth * (d.smokeBelow ?? 0.4)) this._smoke(dt, game, 'damaged');
    if (d.tracks) this.trackPhase += Math.abs(this.speed) * dt;
  }

  _drive(dt, ctrl) {
    const d = this.def;
    const m = ctrl.move || { x: 0, y: 0 };
    const len = Math.min(1, Math.hypot(m.x, m.y));
    const maxSpeed = d.maxSpeed ?? 100;
    let target = 0;
    if (len > 0.05) {
      const want = Math.atan2(m.y, m.x);
      let diff = angleDiff(want, this.angle);
      let dir = 1;
      // richiesta "all'indietro": retromarcia invece di girarsi
      if (Math.abs(diff) > (d.reverseAngleDeg ?? 120) * DEG) {
        diff = angleDiff(want + Math.PI, this.angle);
        dir = -1;
      }
      const k = d.turnNeedsSpeed ? Math.max(d.standTurn ?? 0.3, Math.min(1, Math.abs(this.speed) / (maxSpeed * 0.3))) : 1;
      const maxTurn = (d.turnRate ?? 2.5) * k * dt;
      this.angle += Math.max(-maxTurn, Math.min(maxTurn, diff));
      const align = Math.max(0, Math.cos(diff));
      target = dir * len * maxSpeed * (dir < 0 ? d.reverseFactor ?? 0.5 : 1) * align * align;
    }
    const slowing = Math.abs(target) < Math.abs(this.speed) || Math.sign(target) !== Math.sign(this.speed);
    const a = (slowing ? d.brake ?? 260 : d.accel ?? 150) * dt;
    this.speed += Math.max(-a, Math.min(a, target - this.speed));
  }

  _move(dt, map) {
    const dx = Math.cos(this.angle) * this.speed * dt;
    const dy = Math.sin(this.angle) * this.speed * dt;
    const p = map.moveAndCollide(this.x, this.y, this.hw, this.hh, dx, dy);
    const want = Math.hypot(dx, dy);
    const got = Math.hypot(p.x - this.x, p.y - this.y);
    // urto contro un muro: perde velocità
    if (want > 0.01 && got < want * 0.5) this.speed *= 0.5;
    this.vx = (p.x - this.x) / dt;
    this.vy = (p.y - this.y) / dt;
    this.x = p.x;
    this.y = p.y;
  }

  _weapons(dt, game, ctrl) {
    this.guns.forEach((g, i) => {
      const w = g.w;
      g.cooldown = Math.max(0, g.cooldown - dt);
      if (g.reload) {
        g.reload.time += dt;
        if (g.reload.time >= g.reload.duration) {
          g.ammo = w.magazine;
          g.reload = null;
        }
        return;
      }
      const startReload = () => {
        g.reload = { time: 0, duration: w.reloadTime ?? 2 };
        if (w.reloadSound) game.audio.play(w.reloadSound, this);
      };
      if (ctrl.reload && g.ammo < w.magazine) {
        startReload();
        return;
      }
      if (g.ammo <= 0) {
        startReload(); // i mezzi ricaricano da soli
        return;
      }
      const pressed = i === 0 ? ctrl.firing : !!ctrl.secondary;
      if (!pressed || g.cooldown > 0) return;
      g.cooldown = 1 / (w.fireRate || 8);
      g.ammo--;
      game.fireVehicle(this, g);
      g.side = -g.side;
    });
  }

  _smoke(dt, game, trail) {
    const t = game.effectsCfg?.trails?.[trail];
    if (!t) return;
    this.smokeTimer -= dt;
    if (this.smokeTimer > 0) return;
    this.smokeTimer = t.interval ?? 0.15;
    for (const em of t.emitters || []) game.effects.emit(em, this.x + (Math.random() - 0.5) * this.hw, this.y + (Math.random() - 0.5) * this.hh, 0, 0);
  }

  /** Disegno: ombra, scafo (cingoli animati / carcassa), torretta. */
  draw(ctx) {
    const d = this.def;
    const body = this.assets.sprite(d.sprite, this.destroyed ? null : this.team);
    let frame = 0;
    if (this.destroyed) frame = d.wreckFrame ?? 1;
    else if (d.tracks) frame = Math.floor(this.trackPhase / 3) % 2;
    const [sx, sy] = d.shadow || [3, 4];
    ctx.save();
    ctx.globalAlpha = this.destroyed ? 0.2 : 0.3;
    drawSprite(ctx, silhouette(body, frame), 0, this.x + sx, this.y + sy, this.angle);
    ctx.restore();
    // la carcassa svanisce nell'ultimo secondo
    const fade = this.destroyed ? Math.max(0, Math.min(1, (d.wreckTime ?? 20) - this.wreckAge)) : 1;
    ctx.save();
    ctx.globalAlpha = fade;
    drawSprite(ctx, body, frame, this.x, this.y, this.angle);
    if (d.turretSprite && (!this.destroyed || d.wreckTurret !== false)) {
      const t = this.assets.sprite(d.turretSprite);
      const p = this.pivot;
      drawSprite(ctx, t, this.destroyed ? Math.min(t.frameCount - 1, 1) : 0, p.x, p.y, this.turret);
    }
    ctx.restore();
  }
}
