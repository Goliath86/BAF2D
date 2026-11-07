// IA dei soldati controllati dal computer (bot). Parametri in game.json -> "bots.ai".
//
// Ogni bot ha un BotBrain che a ogni tick produce gli stessi comandi del giocatore umano
// ({ move, aim, firing, reload, ... }, vedi Player.update). Priorità:
// 1. obiettivo: catturare le bandiere non ancora della squadra (le più vicine, senza ammassarsi
//    tutti sulla stessa); se le possiede tutte le presidia;
// 2. combattimento: spara solo a un nemico in vista (dopo un tempo di reazione); se lo perde di vista
//    continua per un po' a sparare dove l'ha visto l'ultima volta (fuoco di copertura). Ciclo tattico:
//    "expose" (spara da una posizione scoperta) -> "cover" (si ripara dietro un muro, ricarica)
//    -> "peek" (si sporge da un punto vicino che vede il bersaglio) -> "expose"...
//    Chi sta catturando una bandiera combatte restando nell'area di cattura;
// 3. squadra: chi avvista un nemico lo comunica ai compagni entro commRadius che non sono impegnati
//    (né in cattura né con un altro bersaglio). Se più bot vicini ingaggiano lo stesso bersaglio,
//    il primo lo tiene impegnato ("fix") e gli altri lo aggirano ("flank") da lati alterni.
// I colpi dei bot hanno gittata pari alla distanza dal punto mirato (più un piccolo scarto):
// o colpiscono o finiscono a terra vicino al bersaglio (vedi Game._spawnBullet).

const DEG = Math.PI / 180;

/** Valore numerico o intervallo [min, max] -> numero casuale nell'intervallo. */
function rand(v, def = 0) {
  if (v === undefined || v === null) return def;
  if (Array.isArray(v)) return v[0] + Math.random() * (v[1] - v[0]);
  return v;
}

function angleDiff(a, b) {
  let d = (a - b) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d <= -Math.PI) d += Math.PI * 2;
  return d;
}

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

/** Lavagna condivisa di una squadra: bot che ne fanno parte e nemici avvistati. */
export class Squad {
  constructor(team) {
    this.team = team;
    this.brains = [];
    this.contacts = new Map(); // nemico -> { x, y, time }
    this.side = 1; // lato del prossimo aggiramento (alterna -1 / +1)
  }

  /** Un bot vede "enemy": aggiorna la posizione nota. */
  report(enemy, time) {
    let c = this.contacts.get(enemy);
    if (!c) {
      c = { x: 0, y: 0, time: 0 };
      this.contacts.set(enemy, c);
    }
    c.x = enemy.x;
    c.y = enemy.y;
    c.time = time;
  }

  contact(enemy) {
    return this.contacts.get(enemy) || null;
  }

  nextSide() {
    this.side = -this.side;
    return this.side;
  }

  /** Dimentica i nemici morti o non visti da più di "memory" secondi. */
  update(time, memory) {
    for (const [e, c] of this.contacts) if (e.dead || time - c.time > memory) this.contacts.delete(e);
  }
}

export class BotBrain {
  constructor(unit, squad, cfg = {}) {
    this.unit = unit;
    this.squad = squad;
    this.cfg = cfg;
    this.time = 0;
    this.angle = unit.angle;

    this.mode = 'objective'; // 'objective' | 'combat'
    this.role = 'fix'; // in combattimento: 'fix' (ingaggia) | 'flank' (aggira)
    this.target = null; // unità nemica
    this.visible = false;
    this.lastSeen = null; // { x, y, time } ultima posizione nota del bersaglio
    this.reactAt = 0; // da quando può sparare (tempo di reazione)
    this.suppressPoint = null; // dove continuare a sparare dopo aver perso il bersaglio
    this.suppressUntil = 0;
    this.zone = null; // bandiera da non abbandonare (combatte dentro l'area mentre cattura)
    this.alertTimer = 0;

    this.phase = 'expose'; // 'expose' | 'cover' | 'peek'
    this.phaseTimer = 0;
    this.cover = null;
    this.peek = null;
    this.flankPoint = null;
    this.flankSide = 1;
    this.flankAnchor = null; // punto da cui il bersaglio viene tenuto impegnato
    this.flankFor = null; // posizione del bersaglio per cui è stato calcolato flankPoint

    this.path = null;
    this.pathIdx = 0;
    this.dest = null;
    this.repath = 0;
    this.stuck = { time: 0, x: unit.x, y: unit.y };

    this.objective = null; // { flag, point }
    this.objTimer = 0;
    this.holdTimer = 0;
    this.bias = {}; // preferenza casuale per bandiera (i bot non scelgono tutti la stessa)

    this.burstOn = false;
    this.burstTimer = 0;
    this.aimErr = 0;
    this.strafe = 0;
    this.strafeTimer = 0;
  }

  // ---------- Tick ----------

  think(dt, game) {
    const u = this.unit;
    const c = this.cfg;
    this.time += dt;
    this.repath -= dt;

    this._perceive(dt, game);
    this._onHurt(game);

    if (this.target) this._combat(dt, game);
    else this._objectiveTick(dt, game);

    const move = this._steer(dt, game);

    // mira e fuoco
    const aimPt = this._aimPoint(game);
    let desired = this.angle;
    let wantFire = false;
    if (aimPt) {
      wantFire = this._burst(dt, aimPt);
      desired = Math.atan2(aimPt.y - u.y, aimPt.x - u.x) + this.aimErr;
    } else {
      this.burstOn = false;
      const look = this.target && this.lastSeen ? this.lastSeen : null;
      if (look && dist(look, u) > 4) desired = Math.atan2(look.y - u.y, look.x - u.x);
      else if (Math.hypot(move.x, move.y) > 0.1) desired = Math.atan2(move.y, move.x);
    }
    const maxTurn = (c.turnSpeedDeg ?? 600) * DEG * dt;
    const diff = angleDiff(desired, this.angle);
    this.angle += Math.max(-maxTurn, Math.min(maxTurn, diff));
    const onTarget = Math.abs(angleDiff(desired, this.angle)) <= (c.fireConeDeg ?? 6) * DEG;
    const firing = wantFire && onTarget && !u.reloading && u.ammo > 0;
    u.aimDistance = aimPt ? dist(aimPt, u) : null;

    return {
      move,
      aim: () => this.angle,
      firing,
      reload: this._wantReload(wantFire),
      grenade: false,
      repeat: true,
      faceMove: false,
    };
  }

  // ---------- Percezione ----------

  _perceive(dt, game) {
    const u = this.unit;
    const c = this.cfg;
    const nav = game.nav;
    const view = c.viewRange ?? 220;

    let best = null;
    let bestScore = Infinity;
    for (const e of game.units) {
      if (e.dead || e.team === u.team) continue;
      const d = dist(e, u);
      if (d > view || !nav.los(u.x, u.y, e.x, e.y)) continue;
      const s = d * (e === this.target ? c.targetStickiness ?? 0.6 : 1);
      if (s < bestScore) {
        bestScore = s;
        best = e;
      }
    }

    if (best) {
      if (best !== this.target) {
        this._engage(best, game);
        this.reactAt = this.time + rand(c.reactionTime, 0.35);
      } else if (!this.visible) {
        // riavvistato dopo poco: reazione più rapida
        this.reactAt = Math.max(this.reactAt, this.time + rand(c.reactionTime, 0.35) * 0.5);
      }
      this.visible = true;
      this.lastSeen = { x: best.x, y: best.y, time: this.time };
      this.squad.report(best, this.time);
      this.alertTimer -= dt;
      if (this.alertTimer <= 0) {
        this.alertTimer = c.alertInterval ?? 1.5;
        this._alertSquad(best, game);
      }
      return;
    }

    if (this.visible) {
      // appena perso di vista: fuoco di copertura sull'ultima posizione (se aveva già reagito)
      this.visible = false;
      if (this.time >= this.reactAt && this.lastSeen) {
        this.suppressPoint = { x: this.lastSeen.x, y: this.lastSeen.y };
        this.suppressUntil = this.time + rand(c.suppressTime, 1.2);
      }
    }
    if (!this.target) return;
    if (this.target.dead) {
      this._dropTarget();
      return;
    }
    // un compagno lo vede ancora: posizione aggiornata dalla lavagna di squadra
    const k = this.squad.contact(this.target);
    if (k && (!this.lastSeen || k.time > this.lastSeen.time)) this.lastSeen = { x: k.x, y: k.y, time: k.time };
    if (!this.lastSeen || this.time - this.lastSeen.time > (c.memoryTime ?? 6)) this._dropTarget();
  }

  /** Colpito: se non vede chi spara reagisce verso l'origine del colpo (fuoco di risposta) e può ripararsi. */
  _onHurt(game) {
    const u = this.unit;
    const h = u.hurtBy;
    if (!h) return;
    u.hurtBy = null;
    const c = this.cfg;
    const a = h.unit;
    if (a && !a.dead && a.team !== u.team && !this.visible) {
      if (this.target !== a) this._engage(a, game);
      this.lastSeen = { x: h.x, y: h.y, time: this.time };
      this.reactAt = this.time + rand(c.reactionTime, 0.35);
      if (game.nav.los(u.x, u.y, h.x, h.y)) {
        this.suppressPoint = { x: h.x, y: h.y };
        this.suppressUntil = this.time + rand(c.suppressTime, 1.2) * 0.7;
      }
    }
    if (this.target && this.phase === 'expose' && this.role === 'fix' && Math.random() < (c.hurtCoverChance ?? 0.5)) {
      this._goCover();
    }
  }

  _dropTarget() {
    this.target = null;
    this.visible = false;
    this.lastSeen = null;
    this.mode = 'objective';
    this.role = 'fix';
    this.zone = null;
    this.cover = null;
    this.peek = null;
    this.flankPoint = null;
    this.objTimer = 0;
    this._stop();
  }

  /** Inizia a combattere "enemy" visto di persona: ruolo (ingaggio o aggiramento) e allerta ai compagni. */
  _engage(enemy, game) {
    const c = this.cfg;
    const u = this.unit;
    this.target = enemy;
    this.mode = 'combat';
    this.zone = this._capturing(game) ? this.objective.flag : null;
    this.cover = null;
    this.peek = null;
    this.flankPoint = null;
    this.phase = 'expose';
    this.phaseTimer = rand(c.exposeTime, 1.8);
    // compagni vicini che già tengono impegnato lo stesso bersaglio: io lo aggiro
    const near = c.squadRadius ?? 120;
    const fixer = this.squad.brains.find(
      (b) => b !== this && !b.unit.dead && b.target === enemy && b.role === 'fix' && dist(b.unit, u) <= near
    );
    if (fixer && !this.zone) this._setFlank(fixer.unit);
    else this.role = 'fix';
    this.alertTimer = 0;
  }

  _setFlank(anchor) {
    this.role = 'flank';
    this.flankSide = this.squad.nextSide();
    this.flankAnchor = { x: anchor.x, y: anchor.y };
    this.flankPoint = null;
    this.unreachable = false;
  }

  /** Comunica il bersaglio ai compagni entro commRadius che non sono già impegnati. */
  _alertSquad(enemy, game) {
    const u = this.unit;
    const r = this.cfg.commRadius ?? 220;
    for (const b of this.squad.brains) {
      if (b === this || b.unit.dead || dist(b.unit, u) > r || !b.available(game)) continue;
      b.receive(enemy, this);
    }
  }

  /** Libero di accettare un bersaglio comunicato: nessun bersaglio e non sta catturando una bandiera. */
  available(game) {
    return !this.target && !this._capturing(game);
  }

  /** Bersaglio comunicato da un compagno: lo aggira partendo dalla posizione nota. */
  receive(enemy, from) {
    const k = this.squad.contact(enemy);
    this.target = enemy;
    this.mode = 'combat';
    this.visible = false;
    this.zone = null;
    this.lastSeen = k ? { x: k.x, y: k.y, time: k.time } : { x: enemy.x, y: enemy.y, time: this.time };
    this.reactAt = this.time + rand(this.cfg.reactionTime, 0.35);
    this.phase = 'expose';
    this.phaseTimer = rand(this.cfg.exposeTime, 1.8);
    this.cover = null;
    this.peek = null;
    this._setFlank(from.unit);
  }

  // ---------- Obiettivi (bandiere) ----------

  _needsCapture(f) {
    const t = this.unit.team;
    return f.owner !== t || f.claimant !== t || f.progress < 1;
  }

  /** Sta catturando: obiettivo = bandiera da prendere ed è nella sua area (o quasi). */
  _capturing(game) {
    const f = this.objective?.flag;
    if (!f || !this._needsCapture(f)) return false;
    return dist(f, this.unit) <= f.radius + (this.cfg.captureCommit ?? 12);
  }

  _objectiveTick(dt, game) {
    this.objTimer -= dt;
    if (this.objTimer <= 0 || !this.objective) {
      this._chooseObjective(game);
      this.objTimer = rand(this.cfg.objectiveInterval, 1);
    }
    const o = this.objective;
    if (!o?.point) {
      this._stop();
      return;
    }
    if (this._goTo(o.point, game)) {
      // arrivato: resta nell'area, ogni tanto cambia punto (più difficile da colpire);
      // se un compagno gli sta addosso si sposta subito
      this.holdTimer -= dt;
      const crowded = o.flag && this._crowded(this.unit, (this.cfg.holdSpacing ?? 24) * 0.6);
      if (this.holdTimer <= 0 || crowded) {
        this.holdTimer = rand(this.cfg.holdTime, 3);
        if (o.flag) o.point = this._zonePoint(o.flag, game) || o.point;
      }
    }
  }

  _chooseObjective(game) {
    const u = this.unit;
    const c = this.cfg;
    const flags = game.ctf.flags;
    const capture = flags.filter((f) => this._needsCapture(f));
    const pool = capture.length ? capture : flags.filter((f) => f.owner === u.team);
    if (!pool.length) {
      // nessuna bandiera: verso la base nemica
      const enemy = game.ctf.teamIds.find((t) => t !== u.team);
      const b = enemy && game.ctf.bases[enemy];
      this.objective = b ? { flag: null, point: { x: b.x, y: b.y } } : null;
      return;
    }
    const squadSize = c.flagSquad ?? 2;
    let best = null;
    let bestS = Infinity;
    for (const f of pool) {
      if (this.bias[f.id] === undefined) this.bias[f.id] = Math.random() * (c.flagBias ?? 60);
      let s = dist(f, u) + this.bias[f.id];
      const mates = this.squad.brains.filter((b) => b !== this && !b.unit.dead && b.objective?.flag === f).length;
      if (mates >= squadSize) s += (mates - squadSize + 1) * (c.crowdPenalty ?? 150);
      if (f === this.objective?.flag) s -= c.objectiveStickiness ?? 40;
      if (!capture.length && f.contested) s -= 200; // in difesa: prima le bandiere attaccate
      if (s < bestS) {
        bestS = s;
        best = f;
      }
    }
    if (best !== this.objective?.flag || !this.objective.point) {
      this.objective = { flag: best, point: this._zonePoint(best, game) || { x: best.x, y: best.y } };
      this.holdTimer = rand(c.holdTime, 3);
    }
  }

  /**
   * Punto percorribile nell'area di cattura di f, distanziato dai compagni (posizioni e punti già scelti)
   * di almeno holdSpacing px, lontano dal pennone e preferibilmente vicino a un muro (riparo).
   */
  _zonePoint(f, game) {
    const nav = game.nav;
    const c = this.cfg;
    const spacing = c.holdSpacing ?? 24;
    const inner = f.radius * (c.holdInner ?? 0.3);
    const others = [];
    for (const b of this.squad.brains) {
      if (b === this || b.unit.dead) continue;
      others.push(b.unit);
      if (b.objective?.flag === f && b.objective.point) others.push(b.objective.point);
    }
    let best = null;
    let bestS = -Infinity;
    for (let i = 0; i < 24; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = inner + Math.random() * (f.radius * 0.8 - inner);
      const idx = nav.nearestWalkable(f.x + Math.cos(a) * r, f.y + Math.sin(a) * r, 1);
      if (idx < 0) continue;
      const p = nav.center(idx);
      if (!game.ctf.inZone(f, p.x, p.y)) continue;
      // distanza dal compagno più vicino (oltre spacing non conta più)
      let near = spacing;
      for (const o of others) near = Math.min(near, dist(o, p));
      let s = near * 2 - (near < spacing ? 100 : 0);
      if (nav.nearWall(idx)) s += 10;
      if (dist(p, f) < inner) s -= 20;
      s += Math.random() * 4;
      if (s > bestS) {
        bestS = s;
        best = p;
      }
    }
    return best;
  }

  /** Un compagno vivo (diverso da sé) è a meno di r px da p. */
  _crowded(p, r) {
    for (const b of this.squad.brains) {
      if (b !== this && !b.unit.dead && dist(b.unit, p) < r) return true;
    }
    return false;
  }

  // ---------- Combattimento ----------

  _effRange() {
    const w = this.unit.weapon;
    return Math.min(this.cfg.viewRange ?? 220, (w.maxRange ?? 600) * (this.cfg.rangeFactor ?? 0.85));
  }

  _combat(dt, game) {
    const c = this.cfg;
    const u = this.unit;
    if (this.zone && !this._needsCapture(this.zone)) this.zone = null;
    const tgt = this.visible ? this.target : this.lastSeen;
    if (!tgt) return;
    const d = dist(tgt, u);
    const eff = this._effRange();

    if (this.role === 'flank') {
      if (this.visible && d <= eff) {
        this.role = 'fix'; // aggiramento riuscito: ingaggia da qui
        this.phase = 'expose';
        this.phaseTimer = rand(c.exposeTime, 1.8);
      } else {
        const moved = this.flankFor ? dist(this.flankFor, this.lastSeen) : Infinity;
        if (!this.flankPoint || moved > (c.flankRetarget ?? 40)) {
          this.flankFor = { x: this.lastSeen.x, y: this.lastSeen.y };
          this.flankPoint = this._findFlank(game, this.lastSeen, this.flankAnchor || u, this.flankSide);
        }
        if (!this.flankPoint || this._goTo(this.flankPoint, game) || this.unreachable) {
          this.role = 'fix'; // arrivato (o impossibile): ora cerca il bersaglio
          this.phase = 'expose';
          this.phaseTimer = rand(c.exposeTime, 1.8);
        }
        return;
      }
    }

    switch (this.phase) {
      case 'expose': {
        if (this.visible) {
          // troppo lontano per l'arma: avvicinati (ma non fuori dall'area che sta catturando)
          if (d > eff && !this.zone) this._goTo(this.target, game);
          else {
            this._stop();
            this.phaseTimer -= dt;
          }
          const low = u.ammo <= u.weapon.magazine * (c.lowAmmo ?? 0.25);
          if (this.phaseTimer <= 0 || low) this._goCover();
        } else if (this.time < this.suppressUntil) {
          this._stop(); // fuoco di copertura da fermo
        } else if (this.zone) {
          if (this.objective?.point) this._goTo(this.objective.point, game);
        } else if (this._goTo(this.lastSeen, game)) {
          this._stop(); // arrivato dove l'ha visto: aspetta (la memoria scade da sola)
        }
        break;
      }
      case 'cover': {
        if (!this.cover) this.cover = this._findCover(game, this.lastSeen);
        if (!this.cover) {
          this.phase = 'expose';
          this.phaseTimer = rand(c.exposeTime, 1.8);
          break;
        }
        if (this._goTo(this.cover, game)) {
          this.phaseTimer -= dt;
          // scoperto anche qui (il bersaglio si è spostato): cerca un'altra copertura
          if (this.visible && this.time - this.reactAt > 0.6 && !u.reloading) {
            this.cover = null;
            this.phase = 'expose';
            this.phaseTimer = rand(c.exposeTime, 1.8);
          } else if (this.phaseTimer <= 0 && !u.reloading) {
            this.phase = 'peek';
            this.peek = this._findPeek(game, this.lastSeen);
          }
        }
        break;
      }
      case 'peek': {
        if (!this.peek || this.visible || this._goTo(this.peek, game)) {
          this.phase = 'expose';
          this.phaseTimer = rand(c.exposeTime, 1.8);
          this.peek = null;
        }
        break;
      }
    }
  }

  _goCover() {
    this.phase = 'cover';
    this.phaseTimer = rand(this.cfg.coverTime, 1.2);
    this.cover = null;
  }

  /** Il punto p è nascosto alla vista da "from" (anche ai lati del corpo). */
  _hidden(nav, from, p) {
    if (nav.los(from.x, from.y, p.x, p.y)) return false;
    const a = Math.atan2(p.y - from.y, p.x - from.x) + Math.PI / 2;
    const ox = Math.cos(a) * 4;
    const oy = Math.sin(a) * 4;
    return !nav.los(from.x, from.y, p.x + ox, p.y + oy) && !nav.los(from.x, from.y, p.x - ox, p.y - oy);
  }

  /** Copertura vicina: tile raggiungibile nascosto al bersaglio, vicino a un muro e da cui potersi sporgere. */
  _findCover(game, threat) {
    const c = this.cfg;
    const u = this.unit;
    const nav = game.nav;
    const reach = nav.reach(u.x, u.y, c.coverSearch ?? 6);
    const pref = (c.preferredRange ?? [60, 150]);
    const mid = (pref[0] + pref[1]) / 2;
    const others = this.squad.brains.filter((b) => b !== this && !b.unit.dead).map((b) => b.cover || b.unit);
    let best = null;
    let bestS = Infinity;
    for (const i of reach.list) {
      const p = nav.center(i);
      if (this.zone && !game.ctf.inZone(this.zone, p.x, p.y)) continue;
      const dT = dist(p, threat);
      if (dT < (c.minCoverDistance ?? 28)) continue;
      let s = reach.dist(i) + (Math.abs(dT - mid) / 16) * (c.rangeWeight ?? 0.5);
      if (s >= bestS) continue;
      if (!this._hidden(nav, threat, p)) continue;
      if (!nav.nearWall(i)) s += 2;
      for (const o of others) if (dist(o, p) < 12) s += 4;
      if (s >= bestS) continue;
      if (!this._peekable(nav, i, threat)) s += 3;
      if (s < bestS) {
        bestS = s;
        best = p;
      }
    }
    return best;
  }

  /** Esiste un tile entro 2 dal tile i che vede il bersaglio (ci si può sporgere). */
  _peekable(nav, i, threat) {
    const tx = i % nav.cols;
    const ty = Math.floor(i / nav.cols);
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        if ((!dx && !dy) || !nav.walkable(tx + dx, ty + dy)) continue;
        const p = nav.center(nav.index(tx + dx, ty + dy));
        if (nav.los(threat.x, threat.y, p.x, p.y)) return true;
      }
    }
    return false;
  }

  /** Punto vicino (entro peekSearch tile) che vede il bersaglio, il più vicino possibile. */
  _findPeek(game, threat) {
    const u = this.unit;
    const nav = game.nav;
    const reach = nav.reach(u.x, u.y, this.cfg.peekSearch ?? 3);
    const eff = this._effRange();
    let best = null;
    let bestD = Infinity;
    for (const i of reach.list) {
      const d = reach.dist(i);
      if (d >= bestD) continue;
      const p = nav.center(i);
      if (this.zone && !game.ctf.inZone(this.zone, p.x, p.y)) continue;
      if (dist(p, threat) > eff || !nav.los(threat.x, threat.y, p.x, p.y)) continue;
      bestD = d;
      best = p;
    }
    return best;
  }

  /**
   * Punto di aggiramento: ruotato di flankAngleDeg (lato "side") rispetto alla direzione
   * bersaglio -> compagno che lo impegna, a flankDistance dal bersaglio, con vista sul bersaglio.
   */
  _findFlank(game, threat, anchor, side) {
    const c = this.cfg;
    const nav = game.nav;
    const base = Math.atan2(anchor.y - threat.y, anchor.x - threat.x);
    const d = Math.min(c.flankDistance ?? 80, this._effRange() * 0.9);
    for (const s of [side, -side]) {
      const a = base + s * (c.flankAngleDeg ?? 75) * DEG;
      const px = threat.x + Math.cos(a) * d;
      const py = threat.y + Math.sin(a) * d;
      const t0 = nav.tileOf(px, py);
      const tx0 = t0 % nav.cols;
      const ty0 = Math.floor(t0 / nav.cols);
      let best = null;
      let bestD = Infinity;
      const r = c.flankSearch ?? 3;
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (!nav.walkable(tx0 + dx, ty0 + dy)) continue;
          const p = nav.center(nav.index(tx0 + dx, ty0 + dy));
          const dd = Math.hypot(p.x - px, p.y - py);
          if (dd >= bestD || !nav.los(threat.x, threat.y, p.x, p.y)) continue;
          bestD = dd;
          best = p;
        }
      }
      if (best) {
        this.flankSide = s;
        return best;
      }
    }
    return null;
  }

  // ---------- Mira e fuoco ----------

  /** Dove sparare: il bersaglio visibile (con anticipo) oppure, per un po', l'ultima posizione nota. */
  _aimPoint(game) {
    const u = this.unit;
    const c = this.cfg;
    const t = this.target;
    if (t && this.visible && this.time >= this.reactAt) {
      const d = dist(t, u);
      if (d > this._effRange() * 1.05) return null;
      const lead = (d / (u.weapon.bulletSpeed || 300)) * (c.leadFactor ?? 0.6);
      return { x: t.x + t.vx * lead, y: t.y + t.vy * lead, suppress: false };
    }
    if (this.suppressPoint && this.time < this.suppressUntil) {
      const p = this.suppressPoint;
      // niente raffiche contro il muro davanti (es. già al riparo)
      if (!game.nav.los(u.x, u.y, p.x, p.y)) return null;
      return { x: p.x, y: p.y, suppress: true };
    }
    return null;
  }

  /** Raffiche: alterna fuoco e pause; a ogni raffica un nuovo errore di mira. */
  _burst(dt, aimPt) {
    const c = this.cfg;
    this.burstTimer -= dt;
    if (this.burstTimer <= 0) {
      this.burstOn = !this.burstOn;
      this.burstTimer = rand(this.burstOn ? c.burst : c.burstPause, 0.5);
      if (this.burstOn) {
        const t = this.target;
        const speed = t && !aimPt.suppress ? Math.hypot(t.vx, t.vy) / (t.speed || 90) : 0;
        const err = (c.aimErrorDeg ?? 3) + speed * (c.aimErrorMovingDeg ?? 4) + (aimPt.suppress ? c.suppressErrorDeg ?? 5 : 0);
        this.aimErr = (Math.random() + Math.random() - 1) * err * DEG;
      }
    }
    return this.burstOn;
  }

  _wantReload(firing) {
    const u = this.unit;
    const w = u.weapon;
    if (u.reloading) return false;
    if (u.ammo <= 0) return true;
    if (firing) return false;
    if (!this.target) return u.ammo < w.magazine;
    if (this.phase === 'cover' && u.ammo < w.magazine * (this.cfg.coverReload ?? 0.7)) return true;
    return !this.visible && this.time >= this.suppressUntil && u.ammo < w.magazine * 0.5;
  }

  // ---------- Movimento ----------

  /** Va verso p: ricalcola il percorso se la meta cambia (al massimo ogni repathInterval). true = arrivato. */
  _goTo(p, game) {
    const u = this.unit;
    const c = this.cfg;
    const arrive = c.arriveDistance ?? 4;
    if (dist(p, u) <= arrive) {
      this._stop();
      this.dest = { x: p.x, y: p.y };
      return true;
    }
    const changed = !this.dest || dist(this.dest, p) > (c.destTolerance ?? 8);
    if ((changed || !this.path) && this.repath <= 0) {
      this.dest = { x: p.x, y: p.y };
      this.path = game.nav.findPath(u.x, u.y, p.x, p.y, u.hw);
      this.unreachable = this.path === null;
      this.pathIdx = 0;
      this.repath = c.repathInterval ?? 0.5;
      this.stuck = { time: 0, x: u.x, y: u.y };
    }
    return false;
  }

  _stop() {
    this.path = null;
    this.dest = null;
  }

  _steer(dt, game) {
    const u = this.unit;
    const c = this.cfg;
    let mx = 0;
    let my = 0;
    const path = this.path;
    if (path && this.pathIdx < path.length) {
      let wp = path[this.pathIdx];
      let d = dist(wp, u);
      const reach = c.waypointReach ?? 3;
      while (d <= reach && this.pathIdx < path.length - 1) {
        this.pathIdx++;
        wp = path[this.pathIdx];
        d = dist(wp, u);
      }
      if (d <= reach) {
        this.path = null;
      } else {
        // all'ultimo punto rallenta per non oltrepassarlo
        const k = Math.min(1, d / ((u.speed * dt) || 1));
        mx = ((wp.x - u.x) / d) * k;
        my = ((wp.y - u.y) / d) * k;
      }
      // bloccato (es. contro un compagno o un angolo): ricalcola
      const s = this.stuck;
      s.time += dt;
      if (s.time >= 0.6) {
        if (Math.hypot(u.x - s.x, u.y - s.y) < 3) {
          this.path = null;
          this.repath = 0;
        }
        this.stuck = { time: 0, x: u.x, y: u.y };
      }
    } else if (this.mode === 'combat' && this.visible && this.phase === 'expose' && this.target) {
      // fermo a sparare: piccoli passi laterali per non essere un bersaglio fisso
      this.strafeTimer -= dt;
      if (this.strafeTimer <= 0) {
        this.strafeTimer = rand(c.strafeTime, 0.8);
        this.strafe = Math.random() < (c.strafeChance ?? 0.6) ? (Math.random() < 0.5 ? -1 : 1) : 0;
      }
      if (this.strafe) {
        const a = Math.atan2(this.target.y - u.y, this.target.x - u.x) + (Math.PI / 2) * this.strafe;
        const f = c.strafeSpeed ?? 0.45;
        const nx = u.x + Math.cos(a) * 6;
        const ny = u.y + Math.sin(a) * 6;
        const outOfZone = this.zone && !game.ctf.inZone(this.zone, nx, ny);
        if (outOfZone || game.map.rectHitsSolid(nx - u.hw, ny - u.hh, u.hw * 2, u.hh * 2)) this.strafe = -this.strafe;
        else {
          mx = Math.cos(a) * f;
          my = Math.sin(a) * f;
        }
      }
    }

    // separazione dai compagni (non si sovrappongono)
    const sep = c.separation ?? 12;
    for (const b of this.squad.brains) {
      const o = b.unit;
      if (o === u || o.dead) continue;
      const dx = u.x - o.x;
      const dy = u.y - o.y;
      const d = Math.hypot(dx, dy);
      if (d >= sep || d < 1e-3) continue;
      const k = (1 - d / sep) * 0.8;
      mx += (dx / d) * k;
      my += (dy / d) * k;
    }
    const len = Math.hypot(mx, my);
    const max = this.burstOn && this.visible ? c.fireMoveFactor ?? 0.7 : 1;
    if (len > max) {
      mx = (mx / len) * max;
      my = (my / len) * max;
    }
    return { x: mx, y: my };
  }
}
