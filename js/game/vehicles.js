// Mezzi (config/vehicles.json): jeep, carro... guidati da un soldato (umano o bot) con gli stessi comandi
// della fanteria: move = direzione desiderata (spazio schermo), aim = rotazione della torretta,
// firing = arma 0 (mitragliatrice), secondary = arma 1 (razzi), reload.
// - Guida: lo scafo ruota verso la direzione richiesta (turnRate) e accelera solo quando è allineato; oltre
//   reverseAngleDeg va in retromarcia. "turnNeedsSpeed" (jeep): da fermo sterza poco.
// - Corazza ("armor"): i proiettili non fanno danni (scintille); esplosioni e razzi sì (vedi Game).
// - Distrutto: carcassa (frame "wreckFrame") che fuma per wreckTime secondi, poi sparisce; il punto di
//   comparsa della mappa ne crea uno nuovo dopo "respawn" secondi.
// Collisione con la mappa: quadrato hitbox[0] x hitbox[1] (lo scafo ruota, il quadrato no).
// - Elicotteri ("flying"): quota alt 0..1 (0 = a terra). Con un pilota decolla (climbRate), senza pilota o con
//   "landing" atterra (descendRate) se sotto c'è spazio libero. In volo (airborne) passa sopra muri e acqua
//   (resta solo dentro la mappa), si muove in qualunque direzione con inerzia (move = velocità in spazio
//   schermo) e il muso (con le armi fisse) ruota verso la mira; i suoi colpi passano sopra i muri.
//   Rotore che gira (rotorSprite), ombra a terra spostata con la quota. Da fermo a terra si sale e si scende.

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
    // elicotteri: quota 0..1, rotore (angolo e velocità 0..1), richiesta di atterraggio
    this.alt = 0;
    this.rotor = 0;
    this.rotorSpeed = 0;
    this.landing = false;
    this.landBlocked = false;
    this.throttle = 0; // acceleratore 0..1 (regime del motore)
    // IA di guida: bandiera e punto scelti (letti dalle IA degli altri mezzi), azzerati quando il pilota scende
    this.brainObjective = null;
    this.brainPoint = null;
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

  /** Elicottero in volo: niente collisioni con la mappa, non investe, non lo toccano le esplosioni a terra. */
  get airborne() {
    return !!this.def.flying && this.alt > (this.def.airborneAlt ?? 0.35);
  }

  /** Disegnato sopra tutto (chiome comprese), con l'ombra a terra separata. */
  get high() {
    return !!this.def.flying && this.alt > 0.15;
  }

  /** Elicottero fermo a terra: si può salire e scendere. */
  get grounded() {
    return !this.def.flying || this.alt <= 0.001;
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
    // un mezzo vuoto non "occupa" più la bandiera scelta dalla sua IA
    this.brainObjective = null;
    this.brainPoint = null;
    if (u) u.vehicle = null;
    return u;
  }

  /** Danno (esplosioni/razzi; proiettili solo × bulletFactor, vedi Game). by.onDealt = segno di colpo a segno. */
  damage(amount, by = null) {
    if (this.destroyed || amount <= 0) return 0;
    if (by) this.lastHitBy = by;
    const before = this.health;
    this.health = Math.max(0, this.health - amount);
    const dealt = before - this.health;
    if (dealt > 0) by?.onDealt?.(this, dealt, this.health <= 0);
    return dealt;
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

  /** Regime del motore 0..1: velocità rispetto alla massima, un po' di più con l'acceleratore premuto. */
  get rpm() {
    const v = Math.abs(this.speed) / (this.def.maxSpeed || 100);
    if (this.def.flying) return Math.min(1, this.rotorSpeed * 0.55 + this.alt * 0.2 + v * 0.25);
    return Math.min(1, Math.max(v, (this.throttle || 0) * (this.def.throttleRev ?? 0.35)));
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
    if (d.flying) {
      this._fly(dt, game, ctrl);
      return;
    }
    if (this.destroyed) {
      this.wreckAge += dt;
      this.speed *= Math.exp(-6 * dt);
      this._move(dt, game.map, game);
      this._smoke(dt, game, d.wreckSmoke || 'wreck');
      if (this.wreckAge >= (d.wreckTime ?? 20)) this.removed = true;
      return;
    }
    if (!ctrl) {
      this.throttle = 0;
      this.idle += dt;
      this.speed *= Math.exp(-(d.idleBrake ?? 4) * dt);
      this._move(dt, game.map, game);
    } else {
      this.idle = 0;
      this._drive(dt, ctrl);
      this._move(dt, game.map, game);
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

  /**
   * Elicottero: quota (decollo con pilota, atterraggio senza o su richiesta se c'è spazio), rotore, volo libero
   * con inerzia, muso verso la mira (armi fisse: turret = angle), armi solo in volo. Distrutto: precipita.
   */
  _fly(dt, game, ctrl) {
    const d = this.def;
    const map = game.map;
    if (this.destroyed) {
      this.alt = Math.max(0, this.alt - (d.fallRate ?? 2) * dt);
      this.rotorSpeed = Math.max(0, this.rotorSpeed - dt * 0.8);
      this.rotor += this.rotorSpeed * (d.rotorRate ?? 30) * dt;
      const k = Math.exp(-3 * dt);
      this.vx *= k;
      this.vy *= k;
      this._freeMove(dt, map);
      this.wreckAge += dt;
      this._smoke(dt, game, d.wreckSmoke || 'wreck');
      if (this.wreckAge >= (d.wreckTime ?? 20)) this.removed = true;
      return;
    }
    // atterraggio possibile solo su terreno libero (niente solidi né altri mezzi sotto)
    const clear = !map.rectHitsSolid(this.x - this.hw, this.y - this.hh, this.hw * 2, this.hh * 2)
      && !game.vehicles.some((o) => o !== this && !o.destroyed && !o.high
        && Math.abs(o.x - this.x) < o.hw + this.hw && Math.abs(o.y - this.y) < o.hh + this.hh);
    const wantDown = !ctrl || this.landing;
    this.landBlocked = wantDown && !clear && this.alt > 0;
    let target = wantDown && clear ? 0 : 1;
    if (wantDown && !clear && !ctrl) target = Math.max(this.alt, 0.5); // senza pilota sopra un muro: resta in hovering
    const rate = target > this.alt ? d.climbRate ?? 0.8 : d.descendRate ?? 0.7;
    // il rotore deve girare prima del decollo
    const spin = ctrl || this.alt > 0 ? 1 : 0;
    this.rotorSpeed += Math.max(-dt * 0.5, Math.min(dt * (d.spinUp ?? 0.9), spin - this.rotorSpeed));
    if (target > this.alt && this.rotorSpeed < 0.8) target = this.alt;
    this.alt += Math.max(-rate * dt, Math.min(rate * dt, target - this.alt));
    this.rotor += this.rotorSpeed * (d.rotorRate ?? 30) * dt;

    // movimento: solo in volo (a terra si ferma)
    const maxSpeed = d.maxSpeed ?? 120;
    let tx = 0;
    let ty = 0;
    if (ctrl && this.airborne) {
      const m = ctrl.move || { x: 0, y: 0 };
      const len = Math.min(1, Math.hypot(m.x, m.y));
      if (len > 0.05) {
        tx = (m.x / Math.hypot(m.x, m.y)) * len * maxSpeed;
        ty = (m.y / Math.hypot(m.x, m.y)) * len * maxSpeed;
      }
      this.throttle = len;
    } else {
      this.throttle = 0;
    }
    const accel = (this.airborne ? d.accel ?? 140 : d.brake ?? 260) * dt;
    const ddx = tx - this.vx;
    const ddy = ty - this.vy;
    const dl = Math.hypot(ddx, ddy);
    if (dl > accel) {
      this.vx += (ddx / dl) * accel;
      this.vy += (ddy / dl) * accel;
    } else {
      this.vx = tx;
      this.vy = ty;
    }
    if (this.airborne) this._freeMove(dt, map);
    else {
      // vicino a terra: collisioni normali (non si atterra dentro un muro)
      const p = map.moveAndCollide(this.x, this.y, this.hw, this.hh, this.vx * dt, this.vy * dt);
      this.x = p.x;
      this.y = p.y;
    }
    this.speed = Math.hypot(this.vx, this.vy);

    if (ctrl) {
      this.idle = 0;
      const aim = ctrl.aim(this);
      if (aim !== null && aim !== undefined && this.alt > 0.2) {
        const maxTurn = (d.turnRate ?? 2.5) * dt;
        this.angle += Math.max(-maxTurn, Math.min(maxTurn, angleDiff(aim, this.angle)));
      }
      this.turret = this.angle;
      if (this.airborne) this._weapons(dt, game, ctrl);
    } else {
      this.idle += dt;
      this.turret = this.angle;
    }
    if (this.health < this.maxHealth * (d.smokeBelow ?? 0.4)) this._smoke(dt, game, 'damaged');
  }

  /** Spostamento in volo: nessuna collisione, solo i bordi della mappa. */
  _freeMove(dt, map) {
    this.x = Math.max(this.hw, Math.min(map.pixelWidth - this.hw, this.x + this.vx * dt));
    this.y = Math.max(this.hh, Math.min(map.pixelHeight - this.hh, this.y + this.vy * dt));
  }

  _drive(dt, ctrl) {
    if (ctrl.drive) {
      this._driveRelative(dt, ctrl.drive);
      return;
    }
    const d = this.def;
    const m = ctrl.move || { x: 0, y: 0 };
    const len = Math.min(1, Math.hypot(m.x, m.y));
    this.throttle = len; // acceleratore premuto (il motore "sale di giri" anche da fermo)
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
    this._approachSpeed(dt, target);
  }

  /**
   * Guida relativa al mezzo (tastiera): throttle > 0 avanti, < 0 freno e poi retromarcia; steer gira il mezzo.
   * I mezzi a ruote (turnNeedsSpeed) sterzano solo in movimento e in retromarcia al contrario, come un'auto;
   * i cingolati girano anche da fermi.
   */
  _driveRelative(dt, drive) {
    const d = this.def;
    const maxSpeed = d.maxSpeed ?? 100;
    const throttle = Math.max(-1, Math.min(1, drive.throttle || 0));
    const steer = Math.max(-1, Math.min(1, drive.steer || 0));
    this.throttle = Math.max(Math.abs(throttle), Math.abs(steer) * 0.5);
    let turn = steer * (d.turnRate ?? 2.5) * dt;
    if (d.turnNeedsSpeed) {
      turn *= Math.max(d.standTurn ?? 0.3, Math.min(1, Math.abs(this.speed) / (maxSpeed * 0.3)));
      if (this.speed < -1) turn = -turn;
    }
    this.angle += turn;
    const target = throttle >= 0 ? throttle * maxSpeed : throttle * maxSpeed * (d.reverseFactor ?? 0.5);
    this._approachSpeed(dt, target);
  }

  /** Porta la velocità verso target: accelerazione accel, frenata brake (anche quando si inverte il senso). */
  _approachSpeed(dt, target) {
    const d = this.def;
    const slowing = Math.abs(target) < Math.abs(this.speed) || Math.sign(target) !== Math.sign(this.speed);
    const a = (slowing ? d.brake ?? 260 : d.accel ?? 150) * dt;
    this.speed += Math.max(-a, Math.min(a, target - this.speed));
  }

  _move(dt, map, game = null) {
    const d = this.def;
    const dx = Math.cos(this.angle) * this.speed * dt;
    const dy = Math.sin(this.angle) * this.speed * dt;
    const p = map.moveAndCollide(this.x, this.y, this.hw, this.hh, dx, dy);
    const want = Math.hypot(dx, dy);
    const got = Math.hypot(p.x - this.x, p.y - this.y);
    if (want > 0.01 && got < want * 0.5) {
      // contro un tile che si lascia schiacciare (def.crush = materiali: staccionate, siepi...): lo sfonda e
      // rallenta un po'; contro un muro vero perde metà della velocità
      if (d.crush?.length && game?.destruction && this._crush(map, game.destruction, dx, dy)) this.speed *= d.crushSlow ?? 0.75;
      else this.speed *= 0.5;
    }
    this.vx = (p.x - this.x) / dt;
    this.vy = (p.y - this.y) / dt;
    this.x = p.x;
    this.y = p.y;
  }

  /** Sfonda i tile schiacciabili (def.crush) che lo scafo spostato di (dx, dy) andrebbe a toccare. true = almeno uno. */
  _crush(map, destruction, dx, dy) {
    const s = map.size;
    const ahead = 2; // px oltre il punto voluto: il tile contro cui preme
    const x = this.x + dx + Math.sign(dx) * ahead;
    const y = this.y + dy + Math.sign(dy) * ahead;
    let any = false;
    for (let ty = Math.floor((y - this.hh) / s); ty <= Math.floor((y + this.hh - 1e-6) / s); ty++) {
      for (let tx = Math.floor((x - this.hw) / s); tx <= Math.floor((x + this.hw - 1e-6) / s); tx++) {
        if (map.isSolidTile(tx, ty) && destruction.crush(tx, ty, this.def.crush)) any = true;
      }
    }
    return any;
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

  /** Ombra a terra (per gli elicotteri si allontana con la quota, rotore compreso). */
  drawShadow(ctx) {
    const d = this.def;
    const body = this.assets.sprite(d.sprite, this.destroyed ? null : this.team);
    const frame = this._frame();
    const [sx, sy] = d.shadow || [3, 4];
    const k = 1 + this.alt * (d.shadowLift ?? 5);
    ctx.save();
    ctx.globalAlpha = this.destroyed ? 0.2 : 0.3 - this.alt * 0.08;
    drawSprite(ctx, silhouette(body, frame), 0, this.x + sx * k, this.y + sy * k, this.angle);
    if (d.rotorSprite && !this.destroyed) {
      const r = this.assets.sprite(d.rotorSprite);
      const hub = this._rotorHub();
      ctx.globalAlpha = 0.18 - this.alt * 0.06;
      drawSprite(ctx, silhouette(r, this.rotorSpeed > 0.6 ? 1 : 0), 0, hub.x + sx * k, hub.y + sy * k, this.rotor);
    }
    ctx.restore();
  }

  _frame() {
    const d = this.def;
    if (this.destroyed) return d.wreckFrame ?? 1;
    if (d.tracks) return Math.floor(this.trackPhase / 3) % 2;
    return 0;
  }

  /** Mozzo del rotore principale in coordinate mondo (def.rotorPivot rispetto al centro). */
  _rotorHub() {
    const [px, py] = this.def.rotorPivot || [0, 0];
    const c = Math.cos(this.angle);
    const s = Math.sin(this.angle);
    return { x: this.x + c * px - s * py, y: this.y + s * px + c * py };
  }

  /**
   * Disegno: ombra (se il mezzo è a terra: in volo la disegna Game sotto i soldati), scafo (cingoli animati /
   * carcassa), torretta, rotore (pale; disco sfocato quando gira veloce).
   */
  draw(ctx) {
    const d = this.def;
    const body = this.assets.sprite(d.sprite, this.destroyed ? null : this.team);
    const frame = this._frame();
    if (!this.high) this.drawShadow(ctx);
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
    if (d.rotorSprite && (!this.destroyed || this.rotorSpeed > 0)) {
      const r = this.assets.sprite(d.rotorSprite);
      const hub = this._rotorHub();
      if (this.rotorSpeed > 0.6) {
        // pale veloci: disco sfocato + due posizioni delle pale semitrasparenti
        ctx.globalAlpha = fade * 0.4;
        drawSprite(ctx, r, 1, hub.x, hub.y, 0);
        ctx.globalAlpha = fade * 0.28;
        drawSprite(ctx, r, 0, hub.x, hub.y, this.rotor);
        drawSprite(ctx, r, 0, hub.x, hub.y, this.rotor + Math.PI / (d.rotorBlades ?? 2)); // a metà tra le pale
      } else {
        drawSprite(ctx, r, 0, hub.x, hub.y, this.rotor);
      }
    }
    ctx.restore();
  }
}
