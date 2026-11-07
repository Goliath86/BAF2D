// IA di un bot alla guida di un mezzo (game.json -> bots.ai.vehicle). Produce i comandi del mezzo
// ({ move, aim, firing, secondary, reload }, vedi Vehicle.update):
// - obiettivo: va verso la bandiera da catturare più vicina (percorsi A* con spazio libero adatto al mezzo,
//   Nav.clearanceFor) e resta nell'area finché non è presa; ogni mezzo della squadra punta a una bandiera
//   diversa se può (soprattutto in difesa) e a un punto lontano dagli altri mezzi; nell'area con un compagno
//   addosso si ferma, e se resta bloccato più volte lascia la bandiera ad altri per un po';
// - combattimento: bersaglio = soldato nemico a piedi o mezzo nemico in vista; mitragliatrice contro la
//   fanteria (a raffiche), razzi contro i mezzi (e a volte contro gruppi di soldati); rallenta mentre spara;
// - bloccato (contro un muro o un altro mezzo): retromarcia per un attimo, poi ricalcola il percorso.

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
const DEG = Math.PI / 180;

export class VehicleBrain {
  constructor(vehicle, unit, squad, cfg = {}) {
    this.v = vehicle;
    this.unit = unit;
    this.squad = squad;
    this.cfg = cfg;
    this.time = 0;
    this.target = null;
    this.visible = false;
    this.lastSeen = null;
    this.reactAt = 0;
    this.objective = null; // { flag, point }
    this.objTimer = 0;
    this.avoid = new Map(); // bandiera -> fino a quando evitarla (irraggiungibile)
    this.path = null;
    this.pathIdx = 0;
    this.dest = null;
    this.repath = 0;
    this.stuck = { time: 0, x: vehicle.x, y: vehicle.y };
    this.reverse = 0;
    this.burstOn = false;
    this.burstTimer = 0;
    this.rocketTimer = rand(cfg.rocketInterval, 1);
    this.aimErr = 0;
    this.aimAngle = vehicle.turret;
  }

  get hasRockets() {
    return this.v.guns.some((g) => g.w.projectile);
  }

  think(dt, game) {
    const c = this.cfg;
    const v = this.v;
    this.time += dt;
    this.repath -= dt;
    this.rocketTimer -= dt;
    this._perceive(game);

    // movimento verso l'obiettivo
    this.objTimer -= dt;
    if (this.objTimer <= 0 || !this.objective || !this._needsCapture(this.objective.flag)) {
      this._chooseObjective(game);
      this.objTimer = rand(c.objectiveInterval, 2);
    }
    let move = this._follow(game);
    if (this.visible && this.target) {
      const f = c.fightMoveFactor ?? 0.5;
      move = { x: move.x * f, y: move.y * f };
    }
    move = this._unstick(dt, move, game);

    // mira e fuoco
    let firing = false;
    let secondary = false;
    const t = this.target;
    if (t && this.visible && this.time >= this.reactAt) {
      const d = dist(t, v);
      const rocketGun = v.guns.find((g) => g.w.projectile);
      const mg = v.guns.find((g) => !g.w.projectile);
      const useRocket = rocketGun && d >= (rocketGun.w.minSafeRange ?? 60) && d <= (rocketGun.w.maxRange ?? 380) * 0.95
        && (t.isVehicle || this._group(game, t) >= 2);
      const gun = t.isVehicle ? rocketGun : useRocket && Math.random() < 0.02 ? rocketGun : mg;
      if (gun) {
        const speed = gun.w.bulletSpeed || 300;
        const lead = (d / speed) * (c.leadFactor ?? 0.6);
        const ax = t.x + (t.vx || 0) * lead;
        const ay = t.y + (t.vy || 0) * lead;
        const p = v.pivot;
        this.aimAngle = Math.atan2(ay - p.y, ax - p.x) + this.aimErr;
        v.aimDistance = Math.hypot(ax - p.x, ay - p.y);
        const onTarget = Math.abs(angleDiff(this.aimAngle, v.turret)) <= (c.fireConeDeg ?? 6) * DEG;
        if (gun === mg && !t.isVehicle && d <= (mg.w.maxRange ?? 600) * 0.8) {
          firing = onTarget && this._burst(dt);
        }
        if (useRocket && onTarget && this.rocketTimer <= 0) {
          secondary = true;
          this.rocketTimer = rand(c.rocketInterval, 1);
        }
      }
    } else {
      this.burstOn = false;
      v.aimDistance = null;
      // senza bersaglio la torretta guarda dove va il mezzo (o verso l'ultima posizione nota)
      const look = this.target && this.lastSeen ? this.lastSeen : null;
      if (look) this.aimAngle = Math.atan2(look.y - v.y, look.x - v.x);
      else if (Math.hypot(move.x, move.y) > 0.1) this.aimAngle = Math.atan2(move.y, move.x);
    }
    const reload = !this.visible && v.guns.some((g) => !g.reload && g.ammo < g.w.magazine * 0.5);
    return { move, aim: () => this.aimAngle, firing, secondary, reload };
  }

  /** Soldati nemici a piedi entro 30 px dal bersaglio (per decidere un razzo contro un gruppo). */
  _group(game, t) {
    let n = 0;
    for (const u of game.units) if (!u.dead && !u.vehicle && u.team !== this.v.team && dist(u, t) < 30) n++;
    return n;
  }

  _perceive(game) {
    const c = this.cfg;
    const v = this.v;
    const nav = game.nav;
    const view = c.viewRange ?? 260;
    const rockets = this.hasRockets;
    let best = null;
    let bestS = Infinity;
    const consider = (e, k) => {
      const d = dist(e, v);
      if (d > view || !nav.los(v.x, v.y, e.x, e.y)) return;
      const s = d * k * (e === this.target ? c.targetStickiness ?? 0.7 : 1);
      if (s < bestS) {
        bestS = s;
        best = e;
      }
    };
    for (const e of game.units) if (!e.dead && !e.vehicle && e.team !== v.team) consider(e, 1);
    // mezzi nemici: bersagli solo con i razzi (la mitragliatrice non li scalfisce)
    if (rockets) for (const o of game.vehicles) if (o !== v && !o.destroyed && o.occupied && o.team !== v.team) consider(o, 0.5);
    if (best) {
      if (best !== this.target) {
        this.reactAt = this.time + rand(c.reactionTime, 0.4);
        this.target = best;
      }
      this.visible = true;
      this.lastSeen = { x: best.x, y: best.y, time: this.time };
      return;
    }
    this.visible = false;
    if (this.target && (this.target.dead || !this.lastSeen || this.time - this.lastSeen.time > (c.memoryTime ?? 4))) {
      this.target = null;
      this.lastSeen = null;
    }
  }

  _burst(dt) {
    const c = this.cfg;
    this.burstTimer -= dt;
    if (this.burstTimer <= 0) {
      this.burstOn = !this.burstOn;
      this.burstTimer = rand(this.burstOn ? c.burst : c.burstPause, 0.6);
      if (this.burstOn) this.aimErr = (Math.random() + Math.random() - 1) * (c.aimErrorDeg ?? 3) * DEG;
    }
    return this.burstOn;
  }

  // ---------- Obiettivi ----------

  _needsCapture(f) {
    if (!f) return false;
    const t = this.v.team;
    return f.owner !== t || f.claimant !== t || f.progress < 1;
  }

  _chooseObjective(game) {
    const v = this.v;
    const flags = game.ctf.flags.filter((f) => !(this.avoid.get(f) > this.time));
    const capture = flags.filter((f) => this._needsCapture(f));
    // tutte prese: presidia quelle contese o la più vicina
    const pool = capture.length ? capture : flags.filter((f) => f.contested || f.owner === v.team);
    if (!pool.length) {
      this.objective = null;
      return;
    }
    let best = null;
    let bestS = Infinity;
    const c = this.cfg;
    for (const f of pool) {
      let s = dist(f, v);
      // un altro mezzo della squadra ci sta già andando: due mezzi nella stessa area si ostacolano
      // (in difesa ancora di più: meglio presidiare un'altra bandiera)
      const mates = game.vehicles.filter((o) => o !== v && !o.destroyed && o.team === v.team && o.brainObjective === f).length;
      s += mates * (this._needsCapture(f) ? c.crowdPenalty ?? 600 : c.defendCrowdPenalty ?? 2000);
      if (!this._needsCapture(f) && f.contested) s -= c.contestedBonus ?? 400;
      if (f === this.objective?.flag) s -= 60;
      if (s < bestS) {
        bestS = s;
        best = f;
      }
    }
    if (best !== this.objective?.flag) {
      this.objective = { flag: best, point: this._zonePoint(best, game) };
      this.path = null;
    }
    v.brainObjective = best;
    v.brainPoint = this.objective.point;
  }

  /**
   * Punto nell'area della bandiera con spazio per il mezzo, lontano dagli altri mezzi della squadra
   * (posizioni e punti già scelti, fino a vehicleSpacing px) e un po' spostato dal pennone.
   */
  _zonePoint(f, game) {
    const v = this.v;
    const nav = game.nav;
    const spacing = this.cfg.vehicleSpacing ?? 56;
    const minClear = nav.clearanceFor(Math.max(v.hw, v.hh));
    const others = [];
    for (const o of game.vehicles) {
      if (o === v || o.destroyed || o.team !== v.team) continue;
      others.push(o);
      if (o.brainObjective === f && o.brainPoint) others.push(o.brainPoint);
    }
    let best = null;
    let bestS = -Infinity;
    for (let i = 0; i < 20; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = f.radius * (0.25 + Math.random() * 0.45);
      const idx = nav.nearestWalkable(f.x + Math.cos(a) * r, f.y + Math.sin(a) * r, 2, minClear);
      if (idx < 0) continue;
      const p = nav.center(idx);
      if (!game.ctf.inZone(f, p.x, p.y)) continue;
      let near = spacing;
      for (const o of others) near = Math.min(near, dist(o, p));
      const s = near + Math.random() * 4;
      if (s > bestS) {
        bestS = s;
        best = p;
      }
    }
    if (best) return best;
    const a = Math.random() * Math.PI * 2;
    return { x: f.x + Math.cos(a) * f.radius * 0.35, y: f.y + Math.sin(a) * f.radius * 0.35 };
  }

  /** Un altro mezzo della squadra è a contatto (o quasi) con questo. */
  _mateTouching(game) {
    const v = this.v;
    const gap = this.cfg.contactGap ?? 10;
    return game.vehicles.some((o) => o !== v && !o.destroyed && o.team === v.team
      && Math.abs(o.x - v.x) < o.hw + v.hw + gap && Math.abs(o.y - v.y) < o.hh + v.hh + gap);
  }

  /** Vettore di movimento lungo il percorso verso l'obiettivo (0 se arrivato). */
  _follow(game) {
    const v = this.v;
    const o = this.objective;
    if (!o) return { x: 0, y: 0 };
    const arrive = o.flag ? o.flag.radius * 0.5 : 12;
    // arrivato: vicino al punto, oppure già nell'area con un compagno addosso (non spingersi a vicenda)
    const inZone = o.flag && game.ctf.inZone(o.flag, v.x, v.y);
    if (inZone && (dist(o.point, v) <= arrive || this._mateTouching(game))) {
      this.path = null;
      return { x: 0, y: 0 };
    }
    const nav = game.nav;
    if ((!this.path || !this.dest || dist(this.dest, o.point) > 8) && this.repath <= 0) {
      this.dest = { x: o.point.x, y: o.point.y };
      const minClear = nav.clearanceFor(Math.max(v.hw, v.hh));
      this.path = nav.findPath(v.x, v.y, o.point.x, o.point.y, Math.max(v.hw, v.hh), undefined, minClear);
      this.pathIdx = 0;
      this.repath = this.cfg.repathInterval ?? 1;
      if (!this.path) {
        // irraggiungibile per questo mezzo: evitala per un po'
        this.avoid.set(o.flag, this.time + 15);
        this.objective = null;
        this.objTimer = 0;
        return { x: 0, y: 0 };
      }
    }
    if (!this.path) return { x: 0, y: 0 };
    let wp = this.path[this.pathIdx];
    const reach = this.cfg.waypointReach ?? 10;
    while (wp && dist(wp, v) <= reach && this.pathIdx < this.path.length - 1) wp = this.path[++this.pathIdx];
    if (!wp) return { x: 0, y: 0 };
    const d = dist(wp, v);
    if (d < 1) return { x: 0, y: 0 };
    return { x: (wp.x - v.x) / d, y: (wp.y - v.y) / d };
  }

  /**
   * Bloccato mentre vuole muoversi: retromarcia per un attimo e nuovo percorso. Se a bloccarlo è un compagno
   * sceglie un altro punto nell'area; dopo stuckLimit blocchi di fila lascia la bandiera ad altri per un po'.
   */
  _unstick(dt, move, game) {
    const v = this.v;
    const c = this.cfg;
    if (this.reverse > 0) {
      this.reverse -= dt;
      return { x: -Math.cos(v.angle), y: -Math.sin(v.angle) };
    }
    const s = this.stuck;
    s.time += dt;
    if (s.time >= (c.stuckTime ?? 1.2)) {
      const wants = Math.hypot(move.x, move.y) > 0.2;
      if (wants && Math.hypot(v.x - s.x, v.y - s.y) < 4) {
        this.reverse = c.reverseTime ?? 0.7;
        this.path = null;
        this.repath = 0;
        this.stuckCount = (this.stuckCount || 0) + 1;
        const o = this.objective;
        if (o?.flag && this.stuckCount >= (c.stuckLimit ?? 3)) {
          this.avoid.set(o.flag, this.time + (c.stuckAvoidTime ?? 12));
          this.objective = null;
          this.objTimer = 0;
          this.stuckCount = 0;
        } else if (o?.flag && this._mateTouching(game)) {
          o.point = this._zonePoint(o.flag, game);
          v.brainPoint = o.point;
        }
      } else if (Math.hypot(v.x - s.x, v.y - s.y) >= 16) this.stuckCount = 0;
      this.stuck = { time: 0, x: v.x, y: v.y };
    }
    return move;
  }
}
