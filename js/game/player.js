import { Animator, drawSprite } from '../engine/assets.js';

const DEG = Math.PI / 180;

/** Differenza angolare normalizzata in (-PI, PI]. */
function angleDiff(a, b) {
  let d = (a - b) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d <= -Math.PI) d += Math.PI * 2;
  return d;
}

export class Player {
  constructor(cfg, x, y, assets, weapons) {
    this.cfg = cfg;
    this.assets = assets;
    this.weapons = weapons;
    this.x = x;
    this.y = y;
    this.angle = 0; // mira (busto)
    this.speed = cfg.speed ?? 90;
    this.hw = (cfg.hitbox?.[0] ?? 10) / 2;
    this.hh = (cfg.hitbox?.[1] ?? 10) / 2;
    this.maxHealth = cfg.maxHealth ?? 100;
    this.health = this.maxHealth;
    this.cooldown = 0;
    this.triggerHeld = false; // per le armi semiautomatiche (un colpo per pressione)
    this.shotQueued = false;
    this.moving = false;
    this.vx = 0; // velocità effettiva (px/s), ereditata in parte dai bossoli espulsi
    this.vy = 0;
    this.casingTimer = null; // secondi all'espulsione ritardata del bossolo (es. pompa)

    // Busto: lo sprite dipende dall'arma impugnata (vedi equip)
    this.weapon = null;
    this.ammo = 0; // colpi nel caricatore
    this.reload = null; // { time, duration, sound } durante la ricarica
    this.sprite = null;
    this.anim = null;
    this.equip(cfg.weapon);

    // Gambe opzionali su livello separato: ruotano verso la direzione di marcia
    this.legs = cfg.legsSprite ? assets.sprite(cfg.legsSprite) : null;
    this.legsAnim = this.legs ? new Animator(this.legs, 'idle') : null;
    this.legsAngle = 0;
    this.legsTurnSpeed = cfg.legsTurnSpeed ?? 14;

    // Corpo a terra dopo la morte (opzionale)
    this.deadSprite = cfg.deadSprite ? assets.sprite(cfg.deadSprite) : null;
    this.deathAngle = 0;
    this.backpedal = (cfg.backpedalAngleDeg ?? 100) * DEG;
  }

  /**
   * Impugna l'arma con id "id" (config/weapons.json) con "ammo" colpi nel caricatore
   * (default: pieno). Restituisce { id, ammo } dell'arma lasciata (o null), così che
   * un domani possa essere fatta cadere a terra con i colpi rimasti.
   */
  equip(id, ammo) {
    const weapon = this.weapons.get(id);
    const previous = this.weapon ? { id: this.weapon.id, ammo: this.ammo } : null;
    this.weapon = weapon;
    this.ammo = Math.max(0, Math.min(weapon.magazine, ammo ?? weapon.magazine));
    this.reload?.sound?.stop(); // il cambio arma interrompe la ricarica (e il suo suono)
    this.reload = null;
    this.sprite = this.assets.sprite(weapon.bodySprite || this.cfg.sprite);
    this.anim = new Animator(this.sprite, 'idle');
    this.cooldown = 0;
    this.casingTimer = null;
    // triggerHeld resta quello reale: se si stava tenendo premuto, una semiautomatica
    // appena impugnata non spara finché non si rilascia
    this.shotQueued = false;
    return previous;
  }

  get dead() {
    return this.health <= 0;
  }

  /** Subisce "amount" danni; restituisce i danni effettivamente applicati. */
  damage(amount) {
    if (this.dead) return 0;
    const before = this.health;
    this.health = Math.max(0, this.health - Math.max(0, amount));
    if (this.dead) {
      // morto: la ricarica si interrompe e il corpo cade all'indietro rispetto alla mira
      this.reload?.sound?.stop();
      this.reload = null;
      this.deathAngle = this.angle;
    }
    return before - this.health;
  }

  /** Recupera "amount" punti vita (fino al massimo); restituisce quanto recuperato. Non resuscita. */
  heal(amount) {
    if (this.dead) return 0;
    const before = this.health;
    this.health = Math.min(this.maxHealth, this.health + Math.max(0, amount));
    return this.health - before;
  }

  get reloading() {
    return this.reload !== null;
  }

  /** Avanzamento della ricarica 0..1 (0 se non sta ricaricando). */
  get reloadProgress() {
    return this.reload ? Math.min(1, this.reload.time / this.reload.duration) : 0;
  }

  /** Avvia la ricarica se il caricatore non è pieno. */
  startReload(game) {
    const w = this.weapon;
    if (this.reload || this.ammo >= w.magazine) return false;
    this.reload = { time: 0, duration: Math.max(0.01, w.reloadTime), sound: null };
    this.shotQueued = false;
    if (w.reloadSound) this.reload.sound = game.audio.play(w.reloadSound);
    return true;
  }

  _updateReload(dt) {
    if (!this.reload) return;
    this.reload.time += dt;
    if (this.reload.time >= this.reload.duration) {
      this.ammo = this.weapon.magazine;
      this.reload = null;
    }
  }

  update(dt, game) {
    if (this.dead) return; // nessun controllo da morto
    const { input, map, camera } = game;
    const w = this.weapon;

    // Ricarica: avanza il tempo, avvio manuale (R / pulsante touch)
    this._updateReload(dt);
    if (input.wasPressed('reload')) this.startReload(game);

    // Movimento (spazio schermo: su/giù/strafe sx/dx, indipendente dalla mira).
    // Su touch la lunghezza del vettore (0..1) dipende da quanto è spinto lo stick -> velocità analogica.
    // Durante la ricarica la velocità è moltiplicata per reloadMoveFactor (0 = fermo).
    const move = input.getMove();
    if (this.reload) {
      const f = Math.max(0, w.reloadMoveFactor ?? 1);
      move.x *= f;
      move.y *= f;
    }
    const mag = Math.min(1, Math.hypot(move.x, move.y));
    const p = map.moveAndCollide(this.x, this.y, this.hw, this.hh, move.x * this.speed * dt, move.y * this.speed * dt);
    this.vx = (p.x - this.x) / dt;
    this.vy = (p.y - this.y) / dt;
    this.x = p.x;
    this.y = p.y;
    this.moving = mag > 0.05;

    // Mira
    const sx = this.x - Math.round(camera.x);
    const sy = this.y - Math.round(camera.y);
    const aim = input.getAim(sx, sy);
    if (aim !== null) {
      this.angle = aim;
    } else if (this.cfg.faceMoveWhenIdle && input.mode === 'touch' && this.moving) {
      this.angle = Math.atan2(move.y, move.x);
    }

    // Fuoco: automatico finché si tiene premuto, semiautomatico un colpo per pressione
    // (su touch le semiautomatiche possono ripetere tenendo lo stick, vedi input.touch.holdToRepeat)
    this.cooldown = Math.max(0, this.cooldown - dt);
    if (this.casingTimer !== null) {
      this.casingTimer -= dt;
      if (this.casingTimer <= 0) {
        this.casingTimer = null;
        this._ejectCasing(game);
      }
    }
    // Una pressione durante il cooldown resta "in coda" e parte appena l'arma è pronta.
    // Durante la ricarica non si spara; a caricatore vuoto il grilletto fa "click"
    // (e, se l'arma ha autoReload, parte la ricarica).
    const firing = input.isFiring();
    const pressed = firing && !this.triggerHeld;
    const auto = w.auto || (input.mode === 'touch' && input.touchHoldToRepeat);
    if (this.reload) {
      this.shotQueued = false;
    } else if (this.ammo <= 0) {
      this.shotQueued = false;
      if (pressed && w.emptySound) game.audio.play(w.emptySound);
      if (firing && w.autoReload) this.startReload(game);
    } else {
      if (pressed) this.shotQueued = true;
      if ((this.shotQueued || (auto && firing)) && this.cooldown <= 0) {
        this.cooldown = 1 / (w.fireRate || 8);
        this.shotQueued = false;
        this.ammo--;
        game.fire(this);
        // bossolo: subito, o dopo casingDelay (es. azione della pompa)
        if (w.casing) {
          if (w.casingDelay > 0) this.casingTimer = w.casingDelay;
          else this._ejectCasing(game);
        }
      }
    }
    this.triggerHeld = firing;

    // Animazioni
    if (this.reload && this.sprite.animations.reload) {
      // L'animazione di ricarica dura esattamente reloadTime, qualunque sia il suo fps
      this.anim.play('reload');
      this.anim.setProgress(this.reloadProgress);
      if (this.legs) this._updateLegs(dt, move, mag);
    } else if (this.legs) {
      this._updateLegs(dt, move, mag);
      this.anim.play('idle');
      this.anim.update(dt);
    } else if (this.moving) {
      this.anim.play('walk');
      this.anim.update(dt * Math.max(0.4, mag));
    } else {
      this.anim.play('idle');
      this.anim.update(dt);
    }
  }

  _updateLegs(dt, move, mag) {
    let target = this.angle;
    let dir = 1;
    if (this.moving) {
      target = Math.atan2(move.y, move.x);
      // Camminando all'indietro rispetto alla mira le gambe restano girate col busto
      // e il ciclo del passo viene riprodotto al contrario.
      if (Math.abs(angleDiff(target, this.angle)) > this.backpedal) {
        target += Math.PI;
        dir = -1;
      }
    }
    const k = 1 - Math.exp(-this.legsTurnSpeed * dt);
    this.legsAngle += angleDiff(target, this.legsAngle) * k;

    if (this.moving) {
      this.legsAnim.play('walk');
      this.legsAnim.update(dt * Math.max(0.35, mag) * dir);
    } else {
      this.legsAnim.play('idle');
      this.legsAnim.update(dt);
    }
  }

  /**
   * Espelle il bossolo dell'arma dalla finestra di espulsione "casingPort" = [avanti, lato]
   * in pixel nel sistema dello sprite (lato positivo = destra del soldato, che guarda a destra).
   */
  _ejectCasing(game) {
    const w = this.weapon;
    if (!w.casing) return;
    const [f, s] = w.casingPort || [4, 1];
    const c = Math.cos(this.angle);
    const sn = Math.sin(this.angle);
    let x = this.x + c * f - sn * s;
    let y = this.y + sn * f + c * s;
    // attaccato a un muro: il bossolo parte dal centro del giocatore invece che dentro il tile
    if (game.map.isSolidAt(x, y)) {
      x = this.x;
      y = this.y;
    }
    game.effects.casing(w.casing, x, y, this.angle, this.vx, this.vy);
  }

  get muzzle() {
    const off = this.weapon.muzzleOffset ?? 8;
    return { x: this.x + Math.cos(this.angle) * off, y: this.y + Math.sin(this.angle) * off };
  }

  draw(ctx) {
    if (this.dead && this.deadSprite) {
      // corpo a terra: lo sprite ha la testa a sinistra, quindi ruotato come la mira
      // la testa finisce dietro (caduto all'indietro), i piedi restano dov'era il giocatore
      const back = this.cfg.deadOffset ?? 4;
      const x = this.x - Math.cos(this.deathAngle) * back;
      const y = this.y - Math.sin(this.deathAngle) * back;
      drawSprite(ctx, this.deadSprite, 0, x, y, this.deathAngle);
      return;
    }
    if (this.legs) drawSprite(ctx, this.legs, this.legsAnim.frame, this.x, this.y, this.legsAngle);
    drawSprite(ctx, this.sprite, this.anim.frame, this.x, this.y, this.angle);
  }
}
