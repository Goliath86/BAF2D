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
  constructor(cfg, x, y, assets, weapons, grenadeTypes, team = null) {
    this.cfg = cfg;
    this.assets = assets;
    this.weapons = weapons;
    this.team = team; // id della squadra (game.json -> teams): sceglie le varianti "sprite@squadra"

    // Granate: tipo (weapons.json -> grenades), scorta iniziale e massima
    this.grenadeType = grenadeTypes.get(cfg.grenade || 'frag');
    this.maxGrenades = cfg.maxGrenades ?? 9;
    this.grenades = Math.min(this.maxGrenades, cfg.grenades ?? 2);
    this.throwCooldown = 0;
    this.x = x;
    this.y = y;
    this.angle = 0; // mira (busto)
    this.speed = cfg.speed ?? 90;
    this.hw = (cfg.hitbox?.[0] ?? 10) / 2;
    this.hh = (cfg.hitbox?.[1] ?? 10) / 2;
    this.maxHealth = cfg.maxHealth ?? 100;
    this.health = this.maxHealth;
    this.hurtBy = null; // { unit, x, y } dell'ultimo colpo subito (letto e azzerato dall'IA)
    // Punteggi: danni ricevuti per soldato (assist), chi ha dato il colpo mortale, record in classifica
    this.damageLog = new Map();
    this.killer = null;
    this.killCause = null; // come è morto (medaglie), vedi damage()
    this.combatant = null;
    // Soldati dell'IA: gittata dei colpi = distanza dal punto mirato (null = regole del giocatore umano)
    this.aimDistance = null;
    this.throwDistance = null; // gittata della granata scelta dall'IA (px)
    this.isBot = false;
    // a bordo di un mezzo: posizione = quella del mezzo (Game._syncDriver), niente disegno né colpi ricevuti
    this.vehicle = null;
    this.vehicleBrain = null; // IA di guida (bot)
    this.cooldown = 0;
    this.triggerHeld = false; // per le armi semiautomatiche (un colpo per pressione)
    this.shotQueued = false;
    this.moving = false;
    this.vx = 0; // velocità effettiva (px/s), ereditata in parte dai bossoli espulsi
    this.vy = 0;
    // corsa (cfg.sprint = { factor, drain, recover, minRestart }): fiato 0..1, a zero si riprende solo da minRestart
    this.stamina = 1;
    this.sprinting = false;
    this.winded = false;
    // soppressione 0..1: colpi che passano vicino (Game._suppress); allarga la rosa dei colpi, i bot si riparano
    this.suppression = 0;
    this.suppressHold = 0;
    this.casingTimer = null; // secondi all'espulsione ritardata del bossolo (es. pompa)
    // rinculo: gradi in più sulla rosa, crescono a ogni colpo (recoilDeg fino a recoilMaxDeg) e calano col tempo
    this.bloom = 0;
    // giocatore umano (Game._spawnPlayer): onDealt(bersaglio, danni, morto) = colpo a segno, onHurt(danni, source)
    this.onDealt = null;
    this.onHurt = null;

    // Busto: lo sprite dipende dall'arma impugnata (vedi equip)
    this.weapon = null;
    this.ammo = 0; // colpi nel caricatore
    this.reload = null; // { time, duration, sound } durante la ricarica
    this.sprite = null;
    this.anim = null;
    // Seconda arma: un'arma "special" (lanciarazzi) si porta in più di quella principale; quella non in mano sta
    // in holster = { id, ammo }. reserve = colpi di scorta delle armi con munizioni contate ("reserve" nel def;
    // senza, munizioni infinite).
    this.holster = null;
    this.reserve = {};
    this.switchCooldown = 0; // dopo un cambio d'arma non si spara per un attimo
    this.resupplyFlash = 0; // s di evidenza della scorta nell'HUD dopo un rifornimento
    this.equip(cfg.weapon);
    this.fillReserve(this.weapon.id);

    // Gambe opzionali su livello separato: ruotano verso la direzione di marcia
    this.legs = cfg.legsSprite ? assets.sprite(cfg.legsSprite) : null;
    this.legsAnim = this.legs ? new Animator(this.legs, 'idle') : null;
    this.legsAngle = 0;
    this.legsTurnSpeed = cfg.legsTurnSpeed ?? 14;

    // Corpo a terra dopo la morte (opzionale, lo disegna Game come cadavere)
    this.deadSprite = cfg.deadSprite ? assets.sprite(cfg.deadSprite, team) : null;
    this.deathAngle = 0;
    this.backpedal = (cfg.backpedalAngleDeg ?? 100) * DEG;
  }

  /** Cambia squadra (debug): aggiorna gli sprite di busto e corpo. */
  setTeam(team) {
    this.team = team;
    this.sprite = this.assets.sprite(this.weapon.bodySprite || this.cfg.sprite, team);
    this.anim.sprite = this.sprite;
    if (this.cfg.deadSprite) this.deadSprite = this.assets.sprite(this.cfg.deadSprite, team);
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
    this.sprite = this.assets.sprite(weapon.bodySprite || this.cfg.sprite, this.team);
    this.anim = new Animator(this.sprite, 'idle');
    this.cooldown = 0;
    this.casingTimer = null;
    this.bloom = 0;
    // triggerHeld resta quello reale: se si stava tenendo premuto, una semiautomatica
    // appena impugnata non spara finché non si rilascia
    this.shotQueued = false;
    return previous;
  }

  // ---------- Due armi: principale + speciale ----------

  /** Id dell'arma principale (in mano o nella fondina) e dell'arma speciale (o null). */
  get primaryId() {
    if (!this.weapon.special) return this.weapon.id;
    return this.holster && !this.weapons.get(this.holster.id).special ? this.holster.id : null;
  }

  get specialId() {
    if (this.weapon.special) return this.weapon.id;
    return this.holster && this.weapons.get(this.holster.id).special ? this.holster.id : null;
  }

  /** Porta un'arma che ferisce i mezzi (in mano o nella fondina). */
  get hasAntiVehicle() {
    const id = this.specialId;
    return !!this.weapon.antiVehicle || (!!id && !!this.weapons.get(id).antiVehicle);
  }

  /** Scambia l'arma in mano con quella nella fondina. */
  switchWeapon() {
    if (!this.holster || this.switchCooldown > 0) return false;
    const h = this.holster;
    this.holster = this.equip(h.id, h.ammo);
    this.switchCooldown = this.cfg.switchTime ?? 0.5;
    return true;
  }

  /** Dà un'arma speciale nella fondina (es. bot anticarro a inizio vita), con la scorta piena. */
  giveSpecial(id) {
    const w = this.weapons.get(id);
    this.holster = { id, ammo: w.magazine };
    this.fillReserve(id);
  }

  // ---------- Munizioni di scorta ----------

  /** Scorta piena per l'arma "id" (armi con "reserve" nel def). */
  fillReserve(id) {
    const w = this.weapons.get(id);
    if (w.reserve !== undefined) this.reserve[id] = w.reserve;
  }

  /** Colpi nel caricatore dell'arma "id" che porta (in mano o nella fondina), o null se non la porta. */
  loadedOf(id) {
    if (this.weapon.id === id) return this.ammo;
    return this.holster?.id === id ? this.holster.ammo : null;
  }

  /** Colpi che mancano alla scorta dell'arma "id" (fino a "reserve"), 0 se è piena, non la porta o è infinita. */
  ammoMissing(id) {
    const w = this.weapons.get(id);
    if (w.reserve === undefined || this.loadedOf(id) === null) return 0;
    return Math.max(0, w.reserve - (this.reserve[id] ?? 0));
  }

  /** Aggiunge fino a "n" colpi alla scorta dell'arma "id" (al massimo "reserve"); restituisce quanti ne ha presi. */
  addAmmo(id, n) {
    const got = Math.min(Math.max(0, Math.floor(n)), this.ammoMissing(id));
    if (got > 0) this.reserve[id] = (this.reserve[id] ?? 0) + got;
    return got;
  }

  /** L'arma in mano non ha più colpi (né nel caricatore né di scorta) e non sta ricaricando. */
  get outOfAmmo() {
    const w = this.weapon;
    return w.reserve !== undefined && this.ammo <= 0 && !this.reload && (this.reserve[w.id] ?? 0) <= 0;
  }

  /** Munizioni dell'arma principale rispetto al massimo, 0..1 (1 = piena o infinita). */
  get primaryAmmoRatio() {
    const id = this.primaryId;
    if (!id) return 1;
    const w = this.weapons.get(id);
    if (w.reserve === undefined) return 1;
    const max = w.reserve + w.magazine;
    return max > 0 ? Math.min(1, ((this.loadedOf(id) ?? 0) + (this.reserve[id] ?? 0)) / max) : 1;
  }

  /**
   * Raccoglie l'arma "id" (ammo nel caricatore, reserve di scorta; default pieni). Un'arma speciale si aggiunge
   * a quella principale (e va in mano); un'arma normale sostituisce la principale. Restituisce le armi lasciate
   * [{ id, ammo, reserve }] da far cadere a terra.
   */
  pickUp(id, ammo, reserve) {
    const w = this.weapons.get(id);
    const dropped = [];
    const info = (p) => {
      if (!p) return;
      dropped.push({ id: p.id, ammo: p.ammo, reserve: this.reserve[p.id] });
      if (p.id !== id) delete this.reserve[p.id];
    };
    if (w.special) {
      if (this.weapon.special) info(this.equip(id, ammo)); // sostituisce la speciale in mano
      else {
        if (this.holster && this.weapons.get(this.holster.id).special) info(this.holster);
        this.holster = this.equip(id, ammo); // la principale va nella fondina
      }
    } else if (this.weapon.special && this.holster) {
      info(this.holster); // in mano la speciale: si cambia la principale nella fondina
      this.holster = { id, ammo: ammo ?? w.magazine };
    } else {
      info(this.equip(id, ammo));
    }
    // la scorta arriva con l'arma (default piena)
    if (w.reserve !== undefined) this.reserve[id] = reserve ?? w.reserve;
    return dropped;
  }

  /** Arma speciale senza più colpi (né in canna né di scorta): si butta e si torna alla principale. */
  _discardEmptySpecial() {
    const w = this.weapon;
    if (!w.special || this.reload || this.ammo > 0 || (this.reserve[w.id] ?? 0) > 0 || !this.holster) return;
    delete this.reserve[w.id];
    const h = this.holster;
    this.holster = null;
    this.equip(h.id, h.ammo);
    this.switchCooldown = this.cfg.switchTime ?? 0.5;
  }

  get dead() {
    return this.health <= 0;
  }

  /**
   * Subisce "amount" danni; restituisce i danni effettivamente applicati.
   * source (opzionale) = { unit, x, y } di chi ha colpito: l'IA lo usa per reagire a chi non vede;
   * source.by = soldato a cui va il merito se diverso da unit (es. chi ha lanciato la granata).
   */
  damage(amount, source = null) {
    if (this.dead) return 0;
    if (source) this.hurtBy = source;
    const before = this.health;
    this.health = Math.max(0, this.health - Math.max(0, amount));
    const dealt = before - this.health;
    const by = source?.by ?? source?.unit ?? null;
    if (by && by !== this && dealt > 0) this.damageLog.set(by, (this.damageLog.get(by) || 0) + dealt);
    if (this.dead) {
      // morto: la ricarica si interrompe e il corpo cade all'indietro rispetto alla mira
      this.reload?.sound?.stop();
      this.reload = null;
      this.deathAngle = this.angle;
      this.killer = by;
      // come è morto (medaglie): bullet/grenade/rocket/runover/vehicle, arma e posizione di chi ha colpito
      this.killCause = source ? { cause: source.cause ?? null, weapon: source.weapon ?? null, x: source.x, y: source.y } : null;
    }
    if (dealt > 0) {
      this.onHurt?.(dealt, source);
      if (by && by !== this) by.onDealt?.(this, dealt, this.dead);
    }
    return dealt;
  }

  /**
   * Rosa attuale dei colpi (gradi): spreadDeg dell'arma (× stillSpread da fermo), + moveSpreadDeg in proporzione
   * alla velocità, + rinculo accumulato, + extraDeg (soppressione).
   */
  spreadDeg(extraDeg = 0) {
    const w = this.weapon;
    const move = Math.min(1, Math.hypot(this.vx, this.vy) / (this.speed || 1));
    const base = (w.spreadDeg || 0) * (move < 0.05 ? w.stillSpread ?? 1 : 1);
    return base + (w.moveSpreadDeg || 0) * move + this.bloom + extraDeg;
  }

  /** Recupera "amount" punti vita (fino al massimo); restituisce quanto recuperato. Non resuscita. */
  heal(amount) {
    if (this.dead) return 0;
    const before = this.health;
    this.health = Math.min(this.maxHealth, this.health + Math.max(0, amount));
    return this.health - before;
  }

  /** Aggiunge granate alla scorta (fino a maxGrenades); restituisce quante ne ha prese. */
  addGrenades(n) {
    const before = this.grenades;
    this.grenades = Math.min(this.maxGrenades, this.grenades + Math.max(0, n));
    return this.grenades - before;
  }

  /** Lancia una granata se ce ne sono, l'arma non è in ricarica e il cooldown è finito. */
  throwGrenade(game) {
    if (this.grenades <= 0 || this.reload || this.throwCooldown > 0) return false;
    this.grenades--;
    this.throwCooldown = this.grenadeType.throwCooldown ?? 0.6;
    game.throwGrenade(this);
    return true;
  }

  get reloading() {
    return this.reload !== null;
  }

  /** Avanzamento della ricarica 0..1 (0 se non sta ricaricando). */
  get reloadProgress() {
    return this.reload ? Math.min(1, this.reload.time / this.reload.duration) : 0;
  }

  /** Può ricaricare ora: non sta già ricaricando, caricatore non pieno e (armi a munizioni contate) c'è scorta. */
  get canReload() {
    const w = this.weapon;
    if (this.reload || this.ammo >= w.magazine) return false;
    return w.reserve === undefined || (this.reserve[w.id] ?? 0) > 0;
  }

  /** Avvia la ricarica se il caricatore non è pieno. */
  startReload(game) {
    const w = this.weapon;
    if (this.reload || this.ammo >= w.magazine) return false;
    // armi con munizioni contate: serve scorta
    if (w.reserve !== undefined && (this.reserve[w.id] ?? 0) <= 0) return false;
    this.reload = { time: 0, duration: Math.max(0.01, w.reloadTime), sound: null, dropped: false };
    this.shotQueued = false;
    if (w.reloadSound) this.reload.sound = game.audio.play(w.reloadSound, this);
    return true;
  }

  _updateReload(dt, game) {
    if (!this.reload) return;
    this.reload.time += dt;
    // il caricatore vuoto cade a terra a una frazione della ricarica (reloadDropAt)
    const w = this.weapon;
    if (w.reloadDrop && !this.reload.dropped && this.reloadProgress >= (w.reloadDropAt ?? 0.3)) {
      this.reload.dropped = true;
      this._eject(game, w.reloadDrop, w.reloadDropPort);
    }
    if (this.reload.time >= this.reload.duration) {
      if (w.reserve !== undefined) {
        // munizioni contate: si prende dalla scorta solo quello che manca
        const take = Math.min(w.magazine - this.ammo, this.reserve[w.id] ?? 0);
        this.ammo += take;
        this.reserve[w.id] = (this.reserve[w.id] ?? 0) - take;
      } else {
        this.ammo = w.magazine;
      }
      this.reload = null;
    }
  }

  /**
   * ctrl = comandi del tick, dal giocatore umano (Game._humanControl) o dall'IA (BotBrain.think):
   * { move: {x, y} lunghezza 0..1, aim(unit) -> angolo | null, firing, reload, grenade,
   *   repeat (semiautomatiche a ripetizione tenendo premuto), faceMove (senza mira guarda dove cammina) }
   */
  update(dt, game, ctrl) {
    if (this.dead) return; // nessun controllo da morto
    const { map } = game;

    // Cambio d'arma (Q / pulsante touch / IA); arma speciale scarica e senza scorta: via
    this.switchCooldown = Math.max(0, this.switchCooldown - dt);
    if (ctrl.switchWeapon) this.switchWeapon();
    this._discardEmptySpecial();
    const w = this.weapon;

    // Ricarica: avanza il tempo, avvio manuale (R / pulsante touch / IA)
    this._updateReload(dt, game);
    if (ctrl.reload) this.startReload(game);

    // Movimento (spazio schermo: su/giù/strafe sx/dx, indipendente dalla mira).
    // Su touch la lunghezza del vettore (0..1) dipende da quanto è spinto lo stick -> velocità analogica.
    // Durante la ricarica la velocità è moltiplicata per reloadMoveFactor (0 = fermo).
    const move = { x: ctrl.move.x, y: ctrl.move.y };
    if (this.reload) {
      const f = Math.max(0, w.reloadMoveFactor ?? 1);
      move.x *= f;
      move.y *= f;
    }
    const mag = Math.min(1, Math.hypot(move.x, move.y));
    const speedFactor = this._updateSprint(dt, ctrl, mag);
    this._updateSuppression(dt);
    const speed = this.speed * speedFactor;
    const p = map.moveAndCollide(this.x, this.y, this.hw, this.hh, move.x * speed * dt, move.y * speed * dt);
    this.vx = (p.x - this.x) / dt;
    this.vy = (p.y - this.y) / dt;
    this.x = p.x;
    this.y = p.y;
    this.moving = mag > 0.05;

    // Mira (calcolata dopo lo spostamento: per il mouse conta la posizione sullo schermo)
    const aim = ctrl.aim(this);
    if (aim !== null) {
      this.angle = aim;
    } else if (this.cfg.faceMoveWhenIdle && ctrl.faceMove && this.moving) {
      this.angle = Math.atan2(move.y, move.x);
    }

    // Granata (G / pulsante touch), verso la mira appena aggiornata
    this.throwCooldown = Math.max(0, this.throwCooldown - dt);
    if (ctrl.grenade) this.throwGrenade(game);

    // Fuoco: automatico finché si tiene premuto, semiautomatico un colpo per pressione
    // (su touch le semiautomatiche possono ripetere tenendo lo stick, vedi input.touch.holdToRepeat)
    this.cooldown = Math.max(0, this.cooldown - dt);
    this.bloom = Math.max(0, this.bloom - (w.recoilRecoverDeg ?? 8) * dt);
    if (this.casingTimer !== null) {
      this.casingTimer -= dt;
      if (this.casingTimer <= 0) {
        this.casingTimer = null;
        this._eject(game, w.casing, w.casingPort);
      }
    }
    // Una pressione durante il cooldown resta "in coda" e parte appena l'arma è pronta.
    // Durante la ricarica non si spara; a caricatore vuoto il grilletto fa "click"
    // (e, se l'arma ha autoReload, parte la ricarica). autoReloadEmpty (opzione del giocatore umano):
    // la ricarica parte da sola appena il caricatore si svuota, senza premere nulla.
    // correndo non si spara (premere il grilletto interrompe la corsa dal tick successivo)
    const firing = !!ctrl.firing && !this.sprinting;
    const pressed = firing && !this.triggerHeld;
    const auto = w.auto || !!ctrl.repeat;
    if (this.reload) {
      this.shotQueued = false;
    } else if (this.ammo <= 0) {
      this.shotQueued = false;
      if (pressed && w.emptySound) game.audio.play(w.emptySound, this);
      if ((firing && w.autoReload) || (this.autoReloadEmpty && this.cooldown <= 0)) this.startReload(game);
    } else {
      if (pressed) this.shotQueued = true;
      if ((this.shotQueued || (auto && firing)) && this.cooldown <= 0 && this.switchCooldown <= 0) {
        this.cooldown = 1 / (w.fireRate || 8);
        this.shotQueued = false;
        this.ammo--;
        game.fire(this);
        // rinculo: il colpo appena sparato usa la rosa di prima, i successivi si allargano
        this.bloom = Math.min(w.recoilMaxDeg ?? 0, this.bloom + (w.recoilDeg ?? 0));
        // bossolo: subito, o dopo casingDelay (es. azione della pompa)
        if (w.casing) {
          if (w.casingDelay > 0) this.casingTimer = w.casingDelay;
          else this._eject(game, w.casing, w.casingPort);
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

  /**
   * Corsa (ctrl.sprint): solo muovendosi, senza ricaricare né sparare; consuma il fiato in sprint.drain s e lo
   * recupera in sprint.recover s; finito il fiato si torna a correre solo da sprint.minRestart.
   * Restituisce il moltiplicatore della velocità.
   */
  _updateSprint(dt, ctrl, mag) {
    const sc = this.cfg.sprint;
    if (!sc) return 1;
    if (this.winded && this.stamina >= (sc.minRestart ?? 0.3)) this.winded = false;
    this.sprinting = !!ctrl.sprint && mag > 0.3 && !this.reload && !ctrl.firing && !this.winded && this.stamina > 0;
    if (this.sprinting) {
      this.stamina = Math.max(0, this.stamina - dt / (sc.drain ?? 5));
      if (this.stamina <= 0) this.winded = true;
      return sc.factor ?? 1.4;
    }
    this.stamina = Math.min(1, this.stamina + dt / (sc.recover ?? 6));
    return 1;
  }

  /** Colpo nemico passato vicino: soppressione + amount (fino a 1), resta per hold s poi cala di decay al secondo. */
  suppress(amount, hold = 0.4) {
    if (this.dead) return;
    this.suppression = Math.min(1, this.suppression + amount);
    this.suppressHold = Math.max(this.suppressHold, hold);
  }

  _updateSuppression(dt) {
    if (this.suppressHold > 0) {
      this.suppressHold -= dt;
      return;
    }
    this.suppression = Math.max(0, this.suppression - dt * (this.cfg.suppressionDecay ?? 0.6));
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
      // di corsa il passo è più rapido, come la velocità
      const run = this.sprinting ? this.cfg.sprint?.factor ?? 1.4 : 1;
      this.legsAnim.update(dt * Math.max(0.35, mag) * dir * run);
    } else {
      this.legsAnim.play('idle');
      this.legsAnim.update(dt);
    }
  }

  /**
   * Fa uscire dall'arma un oggetto di tipo "type" (casings in effects.json: bossolo, caricatore...)
   * dal punto "port" = [avanti, lato] in pixel nel sistema dello sprite
   * (lato positivo = destra del soldato, che guarda a destra).
   */
  _eject(game, type, port) {
    if (!type) return;
    const [f, s] = port || [4, 1];
    const c = Math.cos(this.angle);
    const sn = Math.sin(this.angle);
    let x = this.x + c * f - sn * s;
    let y = this.y + sn * f + c * s;
    // attaccato a un muro: il bossolo parte dal centro del giocatore invece che dentro il tile
    if (game.map.isSolidAt(x, y)) {
      x = this.x;
      y = this.y;
    }
    game.effects.casing(type, x, y, this.angle, this.vx, this.vy);
  }

  get muzzle() {
    const off = this.weapon.muzzleOffset ?? 8;
    return { x: this.x + Math.cos(this.angle) * off, y: this.y + Math.sin(this.angle) * off };
  }

  /** Parti disegnate, dal basso: [sprite, frame, angolo] (per ombra e luce sul bordo, vedi UnitLighting). */
  drawParts() {
    const parts = [];
    if (this.legs) parts.push([this.legs, this.legsAnim.frame, this.legsAngle]);
    parts.push([this.sprite, this.anim.frame, this.angle]);
    return parts;
  }

  draw(ctx) {
    if (this.dead || this.vehicle) return; // il corpo a terra è un cadavere di Game; a bordo si vede il mezzo
    for (const [sprite, frame, angle] of this.drawParts()) drawSprite(ctx, sprite, frame, this.x, this.y, angle);
  }
}
