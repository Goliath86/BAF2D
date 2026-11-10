// IA dei soldati controllati dal computer (bot). Parametri in game.json -> "bots.ai".
//
// Ogni bot ha un BotBrain che a ogni tick produce gli stessi comandi del giocatore umano
// ({ move, aim, firing, reload, ... }, vedi Player.update). Priorità:
// 1. obiettivo: la Squad divide i bot in coppie (il dispari fa un terzetto) e manda ogni gruppo su una
//    bandiera diversa (Squad.plan): prima quelle da catturare, in difesa i gruppi che avanzano o se una
//    bandiera è attaccata. Chi è più avanti va incontro al compagno rimasto indietro;
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
// 4. granate: ogni tanto (grenadeInterval) valuta un lancio sul bersaglio, anche nascosto dietro un angolo
//    (punto d'arrivo in vista sia dal bot sia dal bersaglio), mai se un compagno o lui stesso sarebbero
//    nell'esplosione; scappa dalle granate vicine (di chiunque) dopo un tempo di reazione.
// 5. armi a terra: ogni tanto cerca un'arma che valuta meglio della sua (weaponValues + preferenza personale
//    casuale weaponBias) entro weaponSearch px (weaponCombatReach se sta combattendo) e va a prenderla;
//    arrivato imposta pickupNow e Game fa lo scambio (Game._updatePickups).
// 6. mezzi nemici (Squad.armor): chi non ha l'anticarro li segnala alla squadra; se i bot con un lanciarazzi
//    sono pochi, i più vicini a un lanciarazzi a terra vanno a prenderlo ovunque sia (launcherHunt); chi ce
//    l'ha va a caccia del mezzo avvistato; i gruppi senza anticarro evitano le bandiere presidiate da un mezzo.

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
    for (const [e, c] of this.contacts) if (e.dead || e.destroyed || time - c.time > memory) this.contacts.delete(e);
  }

  // ---------- Piano anticarro ----------

  /**
   * Con mezzi nemici in campo (ogni antiArmor.interval s): se i bot con un'arma anticarro sono meno di
   * perVehicle per mezzo, manda i più vicini senza anticarro a prendere un lanciarazzi a terra ovunque sia
   * (brain.launcherHunt, evitando quelli vicini al mezzo); chi ha già l'anticarro ed è libero va a caccia
   * del mezzo avvistato più vicino (posizione dalla lavagna di squadra, entro seekRange).
   */
  armor(game, cfg, dt) {
    const ac = cfg.antiArmor || {};
    this.armorTimer = (this.armorTimer ?? 0) - dt;
    if (this.armorTimer > 0) return;
    this.armorTimer = ac.interval ?? 1;
    const team = this.team;
    const threats = game.vehicles.filter((v) => !v.destroyed && v.occupied && v.team !== team);
    const active = this.brains.filter((b) => !b.unit.dead && !b.unit.vehicle);
    for (const b of active) {
      if (b.launcherHunt && (!threats.length || b.antiVehicle || !game.pickups?.list.includes(b.launcherHunt))) b.launcherHunt = null;
    }
    if (!threats.length) return;

    // 1. a caccia del mezzo: chi ha l'anticarro, è libero e conosce la posizione di un mezzo
    const seek = ac.seekRange ?? 900;
    for (const b of active) {
      if (!b.antiVehicle || !b.available(game)) continue;
      let best = null;
      let bestD = seek;
      for (const v of threats) {
        const k = this.contact(v);
        if (!k) continue;
        const d = dist(k, b.unit);
        if (d < bestD) { bestD = d; best = v; }
      }
      if (best) b.seekVehicle(best, this.contact(best));
    }

    // 2. a prendere un lanciarazzi
    const carriers = active.filter((b) => b.antiVehicle).length;
    const hunters = active.filter((b) => b.launcherHunt).length;
    let need = Math.ceil(threats.length * (ac.perVehicle ?? 2)) - carriers - hunters;
    if (need <= 0 || !game.pickups) return;
    const claimed = new Set(this.brains.map((b) => b.launcherHunt || b.weaponGoal).filter(Boolean));
    const launchers = game.pickups.list.filter((it) => it.kind === 'weapon' && !claimed.has(it) && game.weapons.get(it.weapon)?.antiVehicle);
    const free = active.filter((b) => !b.antiVehicle && !b.launcherHunt && !b._capturing(game));
    const near = ac.threatRadius ?? 120;
    while (need > 0 && launchers.length && free.length) {
      let bb = -1;
      let bl = -1;
      let bs = Infinity;
      free.forEach((b, i) => {
        launchers.forEach((it, j) => {
          if (b.skipsPickup(it)) return; // l'ha appena lasciato perdere: irraggiungibile per lui
          let s = dist(it, b.unit);
          // lanciarazzi vicino a un mezzo nemico: meglio un altro
          if (threats.some((v) => dist(v, it) < near)) s += ac.threatPenalty ?? 400;
          if (s < bs) { bs = s; bb = i; bl = j; }
        });
      });
      if (bb < 0) break;
      const b = free.splice(bb, 1)[0];
      const it = launchers.splice(bl, 1)[0];
      b.huntLauncher(it, ac.huntTime ?? 30);
      need--;
    }
  }

  // ---------- Piano di squadra: gruppi (coppie/terzetti) distribuiti sulle bandiere ----------

  /** Gruppo del bot "brain" ({ members, flag, bias }) o null. I gruppi sono legati al combattente (unit.combatant). */
  groupOf(brain) {
    return this.groups?.find((g) => g.members.includes(brain)) || null;
  }

  /**
   * Ogni planInterval s (o quando cambia lo stato delle bandiere) rifà i gruppi e assegna una bandiera a ciascuno:
   * coppie stabili (il dispari forma un terzetto), una sola bandiera per gruppo, gruppi sparsi sulle bandiere
   * (spreadPenalty per ogni gruppo già mandato sulla stessa), in difesa solo se avanzano gruppi o se attaccata.
   */
  plan(game, cfg, dt) {
    const flags = game.ctf.flags;
    const key = flags.map((f) => `${f.owner}${f.claimant}${f.progress >= 1 ? 1 : 0}${f.contested ? 1 : 0}`).join('|');
    this.planTimer = (this.planTimer ?? 0) - dt;
    if (this.planTimer > 0 && key === this.planKey) return;
    this.planTimer = cfg.planInterval ?? 2.5;
    this.planKey = key;

    const active = this.brains.filter((b) => !b.unit.dead && !b.unit.vehicle);
    const id = (b) => b.unit.combatant || b.unit;
    const maxSize = cfg.maxGroup ?? 3;
    const breakDist = cfg.groupBreak ?? 360;
    const pairRadius = cfg.pairRadius ?? 500;

    // 1. gruppi precedenti: restano insieme i membri vivi vicini al primo (i cervelli cambiano al rientro)
    const free = new Set(active);
    const groups = [];
    for (const old of this.groups || []) {
      const members = [];
      for (const oid of old.ids) {
        const b = active.find((x) => id(x) === oid && free.has(x));
        if (b && (!members.length || dist(b.unit, members[0].unit) <= breakDist)) members.push(b);
      }
      if (members.length < 2) continue;
      for (const b of members) free.delete(b);
      groups.push({ members, flag: old.flag, bias: old.bias });
    }
    // 2. i liberi: coppia col libero più vicino, altrimenti terzo in un gruppo vicino; se nessuno è vicino,
    //    coppia col libero più vicino comunque (si ritrovano sull'obiettivo); da soli solo se non c'è altri
    const centroid = (g) => {
      let x = 0;
      let y = 0;
      for (const m of g.members) { x += m.unit.x; y += m.unit.y; }
      return { x: x / g.members.length, y: y / g.members.length };
    };
    const trio = cfg.trioPenalty ?? 150;
    while (free.size) {
      const b = free.values().next().value;
      free.delete(b);
      let best = null;
      let bestD = Infinity;
      for (const o of free) {
        const d = dist(o.unit, b.unit);
        if (d < bestD) { bestD = d; best = o; }
      }
      let join = null;
      let joinD = Infinity;
      for (const g of groups) {
        if (g.members.length >= maxSize) continue;
        const d = dist(centroid(g), b.unit) + trio;
        if (d < joinD) { joinD = d; join = g; }
      }
      if (best && (bestD <= pairRadius || !join || bestD <= joinD)) {
        free.delete(best);
        groups.push({ members: [b, best], flag: null, bias: {} });
      } else if (join) join.members.push(b);
      else groups.push({ members: [b], flag: null, bias: {} });
    }

    // 3. bandiere: da prendere; in difesa le proprie (costano defendCost in più, meno se attaccate)
    const team = this.team;
    const needs = (f) => f.owner !== team || f.claimant !== team || f.progress < 1;
    const capture = flags.filter(needs);
    const defend = flags.filter((f) => !needs(f));
    const load = new Map();
    // bandiere presidiate da un mezzo nemico avvistato: i gruppi senza anticarro ci vanno solo se non c'è altro
    const armorNear = (f) => [...this.contacts.keys()].some((e) => e.isVehicle && !e.destroyed && e.occupied
      && dist(this.contacts.get(e), f) < f.radius + (cfg.antiArmor?.flagRadius ?? 60));
    // bandiera minacciata: contesa o con nemici avvistati di recente vicino (lavagna di squadra)
    const threatR = cfg.defendThreatRadius ?? 160;
    const threatened = (f) => f.contested
      || [...this.contacts].some(([e, k]) => !e.dead && !e.destroyed && dist(k, f) < f.radius + threatR);
    const cost = (g, f, c) => {
      if (g.bias[f.id] === undefined) g.bias[f.id] = Math.random() * (cfg.flagBias ?? 60);
      let s = dist(c, f) + g.bias[f.id];
      const noAT = !g.members.some((m) => m.antiVehicle);
      if (noAT && armorNear(f)) s += cfg.antiArmor?.flagAvoid ?? 600;
      if (!needs(f)) {
        s += (cfg.defendCost ?? 350) - (f.contested ? cfg.contestedBonus ?? 500 : 0);
        // difesa di una bandiera tranquilla solo se ogni bandiera da prendere (raggiungibile per il gruppo:
        // senza anticarro non quelle presidiate da un mezzo) ha già un gruppo; altrimenti si attacca
        if (!threatened(f) && capture.some((cf) => !load.get(cf) && !(noAT && armorNear(cf)))) s += cfg.idleDefendPenalty ?? 5000;
      }
      if (g.flag === f) s -= cfg.groupStickiness ?? 150;
      return s + (load.get(f) || 0) * (cfg.spreadPenalty ?? 800);
    };
    const pool = [...capture, ...defend];
    const todo = groups.map((g) => ({ g, c: centroid(g) }));
    while (todo.length && pool.length) {
      let bi = -1;
      let bf = null;
      let bs = Infinity;
      todo.forEach(({ g, c }, i) => {
        for (const f of pool) {
          const s = cost(g, f, c);
          if (s < bs) { bs = s; bi = i; bf = f; }
        }
      });
      const { g } = todo.splice(bi, 1)[0];
      g.flag = bf;
      load.set(bf, (load.get(bf) || 0) + Math.min(1, g.members.length / 2));
    }
    for (const g of groups) g.ids = g.members.map(id);
    this.groups = groups;
  }

  /** Compagno di gruppo da aspettare: vivo, a piedi, lontano più di leash ma entro range. */
  straggler(brain, leash, range) {
    const g = this.groupOf(brain);
    if (!g) return null;
    let worst = null;
    let worstD = leash;
    for (const m of g.members) {
      if (m === brain || m.unit.dead || m.unit.vehicle || m.target) continue;
      const d = dist(m.unit, brain.unit);
      if (d > worstD && d <= range) { worstD = d; worst = m; }
    }
    return worst;
  }
}

export class BotBrain {
  constructor(unit, squad, cfg = {}) {
    this.unit = unit;
    this.squad = squad;
    this.cfg = cfg;
    this.time = 0; // tempo di gioco (aggiornato in think)
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
    this.bias = {}; // preferenza casuale per bandiera (solo senza piano di squadra)
    this.waitTime = 0; // da quanto va incontro al compagno di coppia

    this.burstOn = false;
    this.burstTimer = 0;
    this.aimErr = 0;
    this.strafe = 0;
    this.strafeTimer = 0;

    // granate: prossima valutazione di un lancio, lancio in preparazione, fuga da una granata
    this.grenadeTimer = rand(cfg.grenadeFirstDelay, 3);
    this.throwPlan = null; // { point, until }
    this.evade = null; // { g, point, retarget }
    this.grenadeReaction = rand(cfg.grenadeReaction, 0.4);

    // armi a terra: oggetto da raggiungere, scadenza, prossima ricerca, preferenze personali
    this.weaponGoal = null;
    this.weaponGoalUntil = 0;
    this.weaponTimer = rand(cfg.weaponScanInterval, 1.5);
    this.weaponBias = {};
    this.pickupNow = null; // oggetto da raccogliere in questo tick (letto da Game)
    this.launcherHunt = null; // lanciarazzi a terra da andare a prendere ovunque sia (Squad.armor)

    // mezzi: guidatore per indole (vehicles.driverChance), mezzo da raggiungere, salita (letta da Game),
    // riparo da un mezzo nemico (senza armi anticarro)
    const vc = cfg.vehicles || {};
    this.wantsToDrive = Math.random() < (vc.driverChance ?? 0.5);
    this.vehicleGoal = null;
    this.vehicleGoalUntil = 0;
    this.vehicleTimer = rand(vc.scanInterval, 2);
    this.enterNow = null;
    this.hide = null; // { v, point, retarget }
    this.enemyArmor = false; // ci sono mezzi nemici in campo (le armi anticarro valgono di più)
  }

  /** Porta un'arma che ferisce i mezzi (lanciarazzi, in mano o nella fondina). */
  get antiVehicle() {
    return !!this.unit.hasAntiVehicle;
  }

  /**
   * Vale la pena attaccare il mezzo v: con un'arma anticarro, o con le armi leggere se la sua corazza lascia
   * passare almeno vehicles.fightBulletFactor del danno (elicottero sì; la jeep, appena scalfibile, no: ci si ripara).
   */
  canHurt(v) {
    const k = v?.def?.bulletFactor ?? 0;
    return this.antiVehicle || (k > 0 && k >= (this.cfg.vehicles?.fightBulletFactor ?? 0));
  }

  /**
   * Arma giusta per il bersaglio: quella anticarro contro i mezzi, la principale contro i soldati (e senza
   * bersaglio). true = cambiare arma in questo tick.
   */
  _wantSwitch() {
    const u = this.unit;
    if (!u.holster || u.switchCooldown > 0) return false;
    const wantAnti = !!this.target?.isVehicle;
    const holding = !!u.weapon.antiVehicle;
    return wantAnti !== holding;
  }

  // ---------- Tick ----------

  think(dt, game) {
    const u = this.unit;
    const c = this.cfg;
    // orologio = tempo di gioco, lo stesso della lavagna di squadra (Squad.update lo usa per dimenticare i
    // contatti: con un orologio proprio di ogni bot gli avvistamenti sparivano subito)
    this.time = game.time;
    this.repath -= dt;

    this._perceive(dt, game);
    this._onHurt(game);

    this.enemyArmor = game.vehicles.some((v) => !v.destroyed && v.occupied && v.team !== u.team);
    this._weapons = game.weapons;
    // una granata vicina ha la precedenza su tutto: via dall'esplosione; poi un mezzo nemico (senza anticarro)
    if (this._grenadeDanger(dt, game)) this._goTo(this.evade.point, game);
    else if (this._vehicleDanger(dt, game)) this._goTo(this.hide.point, game);
    else if (this._weaponTick(dt, game)) {
      // sta andando a prendere un'arma (mira e fuoco continuano sotto)
    } else if (!this.target && this._boardTick(dt, game)) {
      // sta andando verso un mezzo libero
    } else if (this.target) this._combat(dt, game);
    else this._objectiveTick(dt, game);
    this._considerGrenade(dt, game);

    const move = this._steer(dt, game);

    // mira e fuoco (durante la preparazione di un lancio: mira al punto d'arrivo, niente fuoco)
    const plan = this.throwPlan;
    const aimPt = plan || this.evade ? null : this._aimPoint(game); // in fuga dalla granata corre e basta
    let desired = this.angle;
    let wantFire = false;
    if (plan) {
      this.burstOn = false;
      desired = Math.atan2(plan.point.y - u.y, plan.point.x - u.x);
    } else if (aimPt) {
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
    // lanciarazzi: mai contro un bersaglio troppo vicino (l'esplosione colpirebbe anche lui)
    if (wantFire && u.weapon.projectile && aimPt && dist(aimPt, u) < (u.weapon.minSafeRange ?? 50)) wantFire = false;
    // un mezzo con un'arma che non lo scalfisce: niente colpi sprecati (sta cambiando arma);
    // l'elicottero (corazza leggera) si può colpire anche col fucile
    if (this.target?.isVehicle && !u.weapon.antiVehicle && !((this.target.def?.bulletFactor ?? 0) > 0)) wantFire = false;
    const switchWeapon = this._wantSwitch();
    const firing = wantFire && onTarget && !u.reloading && u.ammo > 0;
    u.aimDistance = aimPt ? dist(aimPt, u) : null;

    // lancio: quando è girato verso il punto (la granata rotola un po' dopo il primo rimbalzo: grenadeRangeFactor)
    let grenade = false;
    if (plan) {
      if (Math.abs(angleDiff(desired, this.angle)) <= (c.grenadeConeDeg ?? 8) * DEG) {
        grenade = true;
        u.throwDistance = dist(plan.point, u) * (c.grenadeRangeFactor ?? 0.8);
        this.throwPlan = null;
      } else if (this.time > plan.until) {
        this.throwPlan = null;
      }
    }

    return {
      move,
      aim: () => this.angle,
      firing,
      reload: !plan && !switchWeapon && this._wantReload(wantFire),
      grenade,
      switchWeapon,
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
      // chi è a bordo di un mezzo non si vede: conta il mezzo (sotto)
      if (e.dead || e.vehicle || e.team === u.team) continue;
      const d = dist(e, u);
      if (d > view || !nav.los(u.x, u.y, e.x, e.y)) continue;
      const s = d * (e === this.target ? c.targetStickiness ?? 0.6 : 1);
      if (s < bestScore) {
        bestScore = s;
        best = e;
      }
    }
    // mezzi nemici: bersagli solo se li può scalfire (arma anticarro, o elicottero a corazza leggera), con
    // priorità; gli altri li segnala alla squadra (chi ha un lanciarazzi andrà a cercarli)
    if (this.target?.isVehicle && !this.canHurt(this.target)) {
      this._dropTarget(); // ha cambiato arma: il mezzo non è più un bersaglio utile
      return;
    }
    for (const v of game.vehicles) {
      if (v.destroyed || !v.occupied || v.team === u.team) continue;
      const d = dist(v, u);
      if (d > view || !nav.los(u.x, u.y, v.x, v.y)) continue;
      if (!this.canHurt(v)) {
        this.squad.report(v, this.time);
        continue;
      }
      const s = d * (c.vehicles?.targetPriority ?? 0.6) * (v === this.target ? c.targetStickiness ?? 0.6 : 1);
      if (s < bestScore) {
        bestScore = s;
        best = v;
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
    let a = h.unit;
    // colpito da un mezzo: il bersaglio è il mezzo (solo con un'arma anticarro; altrimenti ci pensa il riparo)
    if (a?.vehicle) a = this.canHurt(a.vehicle) ? a.vehicle : null;
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

  /** Piano anticarro: va a prendere il lanciarazzi "it" (anche lontano e combattendo) entro "time" s. */
  huntLauncher(it, time) {
    this.launcherHunt = it;
    this.weaponGoal = it;
    this.weaponGoalUntil = this.time + time;
    this.unreachable = false;
  }

  /** Piano anticarro: ha un'arma anticarro e va verso l'ultima posizione nota del mezzo "v". */
  seekVehicle(v, k) {
    this.target = v;
    this.mode = 'combat';
    this.visible = false;
    this.zone = null;
    this.role = 'fix';
    this.lastSeen = { x: k.x, y: k.y, time: k.time };
    this.reactAt = this.time + rand(this.cfg.reactionTime, 0.35);
    this.phase = 'expose';
    this.phaseTimer = rand(this.cfg.exposeTime, 1.8);
    this.cover = null;
    this.peek = null;
    this.flankPoint = null;
  }

  /** Bersaglio comunicato da un compagno: lo aggira partendo dalla posizione nota. */
  receive(enemy, from) {
    if (enemy.isVehicle && !this.canHurt(enemy)) return; // senza anticarro un mezzo corazzato non si attacca
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
    // in coppia: chi è più avanti verso l'obiettivo va incontro al compagno rimasto indietro
    // (non durante la cattura, al massimo pairWaitMax s di fila)
    const c = this.cfg;
    const mate = !this._capturing(game) && this.waitTime < (c.pairWaitMax ?? 4)
      ? this.squad.straggler(this, c.pairLeash ?? 64, c.pairWaitRange ?? 450)
      : null;
    if (mate && dist(this.unit, o.point) + 16 < dist(mate.unit, o.point)) {
      this.waitTime += dt;
      this._goTo(mate.unit, game);
      return;
    }
    if (!mate) this.waitTime = 0;
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
    // bandiera decisa dal piano di squadra (Squad.plan) per il gruppo di questo bot
    const planned = this.squad.groupOf(this)?.flag;
    if (planned && flags.includes(planned)) {
      if (planned !== this.objective?.flag || !this.objective.point) {
        this.objective = { flag: planned, point: this._zonePoint(planned, game) || { x: planned.x, y: planned.y } };
        this.holdTimer = rand(c.holdTime, 3);
      }
      return;
    }
    // senza piano (es. primo tick): la più vicina, evitando di ammassarsi
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

  // ---------- Armi a terra ----------

  /** Valore dell'arma "id" per questo bot: weaponValues + preferenza personale casuale (±weaponBias). */
  _weaponValue(id) {
    const c = this.cfg;
    if (this.weaponBias[id] === undefined) this.weaponBias[id] = (Math.random() * 2 - 1) * (c.weaponBias ?? 0.5);
    // con mezzi nemici in campo le armi anticarro valgono di più
    const anti = this.enemyArmor && this._weapons?.get(id)?.antiVehicle ? c.vehicles?.antiVehicleBonus ?? 1.5 : 0;
    return (c.weaponValues?.[id] ?? 1) + this.weaponBias[id] + anti;
  }

  // ---------- Mezzi ----------

  /**
   * Senza arma anticarro, un mezzo nemico in vista entro vehicles.fearRange: corre al riparo (punto nascosto al
   * mezzo o fuori portata, come per le granate). true finché si sta riparando.
   */
  _vehicleDanger(dt, game) {
    const u = this.unit;
    const vc = this.cfg.vehicles || {};
    if (this.antiVehicle) {
      this.hide = null;
      return false;
    }
    const range = vc.fearRange ?? 130;
    let threat = null;
    let best = Infinity;
    for (const v of game.vehicles) {
      // un elicottero (corazza leggera) si combatte col fucile invece di scappare
      if (v.destroyed || !v.occupied || v.team === u.team || this.canHurt(v)) continue;
      const d = dist(v, u);
      if (d < range && d < best && game.nav.los(v.x, v.y, u.x, u.y)) {
        best = d;
        threat = v;
      }
    }
    const h = this.hide;
    if (!threat) {
      // riparo raggiunto o mezzo sparito: fine
      if (h && (h.v.destroyed || dist(h.point, u) <= (this.cfg.arriveDistance ?? 4) || this.time > h.until)) {
        this.hide = null;
        this._stop();
        this.repath = 0;
      }
      return !!this.hide;
    }
    if (!h || h.v !== threat || (h.retarget -= dt) <= 0) {
      this.hide = { v: threat, point: this._evadePoint(game, threat, range), retarget: 0.6, until: this.time + 4 };
      this.repath = 0;
    }
    return true;
  }

  /**
   * Indole da guidatore e niente bersaglio: va verso il mezzo libero più vicino (entro vehicles.search px, anche
   * nemico se vuoto) e ci sale (enterNow, letto da Game). true = il movimento di questo tick è per il mezzo.
   */
  _boardTick(dt, game) {
    const vc = this.cfg.vehicles || {};
    const u = this.unit;
    if (!this.wantsToDrive || !game.vehicles.length) return false;
    let goal = this.vehicleGoal;
    if (goal && (goal.destroyed || goal.removed || goal.driver || this.time > this.vehicleGoalUntil || this.unreachable)) {
      if (goal.claimedBy === this) goal.claimedBy = null;
      goal = this.vehicleGoal = null;
      this.vehicleTimer = rand(vc.scanInterval, 2);
    }
    if (!goal) {
      if ((this.vehicleTimer -= dt) > 0) return false;
      this.vehicleTimer = rand(vc.scanInterval, 2);
      if (this._capturing(game)) return false;
      let bestD = vc.search ?? 320;
      for (const v of game.vehicles) {
        if (v.destroyed || v.driver || !v.grounded) continue;
        const other = v.claimedBy;
        if (other && other !== this && !other.unit.dead && !other.unit.vehicle && other.vehicleGoal === v) continue;
        if (v.team && v.team !== u.team && vc.stealEmpty === false) continue;
        const d = dist(v, u);
        if (d < bestD) {
          bestD = d;
          goal = v;
        }
      }
      if (!goal) return false;
      this.vehicleGoal = goal;
      goal.claimedBy = this;
      this.vehicleGoalUntil = this.time + (vc.goalTime ?? 12);
      this.unreachable = false;
    }
    if (dist(goal, u) <= goal.enterReach) {
      this.enterNow = goal;
      this.vehicleGoal = null;
      this._stop();
      return true;
    }
    this._goTo(goal, game);
    return true;
  }

  /** Ricerca / raggiungimento di un'arma migliore a terra. true = il movimento di questo tick è per l'arma. */
  _weaponTick(dt, game) {
    const c = this.cfg;
    const u = this.unit;
    this.pickupNow = null;
    if (c.pickWeapons === false || !game.pickups) return false;
    const fighting = this.target && this.visible;
    const combatReach = c.weaponCombatReach ?? 28;
    // piano anticarro: il lanciarazzi assegnato dalla squadra si va a prendere anche combattendo
    if (this.launcherHunt && (this.antiVehicle || !game.pickups.list.includes(this.launcherHunt) || this.time > this.weaponGoalUntil || this.unreachable)) {
      this.launcherHunt = null;
      this.weaponGoal = null;
    }
    if (this.launcherHunt) this.weaponGoal = this.launcherHunt;
    let goal = this.weaponGoal;
    if (goal && goal !== this.launcherHunt && (!game.pickups.list.includes(goal) || this.time > this.weaponGoalUntil || this.unreachable
      || (fighting && dist(goal, u) > combatReach))) {
      goal = this.weaponGoal = null;
    }
    if (!goal) {
      if ((this.weaponTimer -= dt) > 0) return false;
      this.weaponTimer = rand(c.weaponScanInterval, 1.5);
      const reach = fighting ? combatReach : c.weaponSearch ?? 110;
      // armi normali: confronto con la principale; arma speciale (lanciarazzi): si aggiunge se non ne ha una
      // (più ambita se ci sono mezzi nemici)
      const primary = u.primaryId;
      const own = primary ? this._weaponValue(primary) : 0;
      const hasSpecial = !!u.specialId;
      const minGain = c.weaponMinGain ?? 0.3;
      // non lascia l'area della bandiera che sta catturando
      const hold = this.zone || (this._capturing(game) ? this.objective.flag : null);
      let bestS = -Infinity;
      for (const it of game.pickups.list) {
        if (it.kind !== 'weapon' || it.weapon === primary || this.skipsPickup(it)) continue;
        const special = !!game.weapons.get(it.weapon).special;
        if (special && hasSpecial) continue;
        const d = dist(it, u);
        const gain = special
          ? (c.specialValue ?? 0.8) + (this.enemyArmor ? c.vehicles?.antiVehicleBonus ?? 1.5 : 0)
          : this._weaponValue(it.weapon) - own;
        if (d > reach || gain < minGain) continue;
        // un compagno ci sta già andando
        if (this.squad.brains.some((b) => b !== this && !b.unit.dead && b.weaponGoal === it)) continue;
        if (hold && !game.ctf.inZone(hold, it.x, it.y)) continue;
        const s = gain * 100 - d;
        if (s > bestS) {
          bestS = s;
          goal = it;
        }
      }
      if (!goal) return false;
      this.weaponGoal = goal;
      this.weaponGoalUntil = this.time + (c.weaponGoalTime ?? 6);
      this.unreachable = false;
    }
    const d = dist(goal, u);
    // Game accetta lo scambio fino a pickups.radius + 2 px
    if (d <= Math.max(2, game.pickupsCfg?.radius ?? 9)) {
      this.pickupNow = goal;
      this.weaponGoal = null;
      this.pickupClose = 0;
      this._stop();
      return true;
    }
    // ultimo tratto dritto verso l'arma: se è in un punto che la griglia non raggiunge esattamente (es. caduta
    // contro un muro) il percorso finirebbe al centro del tile vicino, troppo lontano per raccoglierla;
    // se dopo pickupGiveUp s non ci arriva, la lascia perdere per un po'
    if (d <= (c.pickupDirectReach ?? 28) && game.nav.los(u.x, u.y, goal.x, goal.y)) {
      this.pickupClose = (this.pickupClose || 0) + dt;
      if (this.pickupClose > (c.pickupGiveUp ?? 2.5)) {
        this._skipPickup(goal);
        return false;
      }
      this.path = [{ x: goal.x, y: goal.y }];
      this.pathIdx = 0;
      this.dest = { x: goal.x, y: goal.y };
      return true;
    }
    this.pickupClose = 0;
    this._goTo(goal, game);
    return true;
  }

  /** Arma a terra irraggiungibile: niente più caccia né ricerca su quella per pickupSkipTime s. */
  _skipPickup(it) {
    (this.skipPickups ||= new Map()).set(it, this.time + (this.cfg.pickupSkipTime ?? 20));
    if (this.launcherHunt === it) this.launcherHunt = null;
    this.weaponGoal = null;
    this.pickupClose = 0;
    this._stop();
  }

  /** L'arma a terra "it" è da ignorare (non raggiunta di recente). */
  skipsPickup(it) {
    return (this.skipPickups?.get(it) ?? -Infinity) > this.time;
  }

  // ---------- Granate ----------

  /** Distanza di sicurezza da una granata: blastRadius × grenadeSafeFactor + grenadeAvoidMargin. */
  _grenadeSafeRadius(g) {
    const c = this.cfg;
    return (g.def.blastRadius ?? 40) * (c.grenadeSafeFactor ?? 1.6) + (c.grenadeAvoidMargin ?? 10);
  }

  /**
   * Stima del punto in cui la granata si fermerà: resto del volo + rotolamento (la velocità a terra decade
   * con groundDrag, al primo contatto si riduce di "friction"); se c'è un muro in mezzo si ferma prima.
   */
  _grenadeRest(g, nav) {
    const d = g.def;
    const airborne = g.z > 0 || g.vz > 0;
    let t = 0;
    if (airborne) {
      const grav = d.gravity ?? 300;
      t = (g.vz + Math.sqrt(g.vz * g.vz + 2 * grav * Math.max(0, g.z))) / grav;
    }
    const k = t + (airborne ? d.friction ?? 0.5 : 1) / (d.groundDrag ?? 5);
    let x = g.x + g.vx * k;
    let y = g.y + g.vy * k;
    if (!nav.los(g.x, g.y, x, y)) {
      // muro: indietro a passi di 3 px fino a un punto libero in vista
      const n = Math.ceil(Math.hypot(x - g.x, y - g.y) / 3);
      for (let i = n - 1; i >= 0; i--) {
        const px = g.x + ((x - g.x) * i) / n;
        const py = g.y + ((y - g.y) * i) / n;
        if (nav.los(g.x, g.y, px, py)) {
          x = px;
          y = py;
          break;
        }
      }
    }
    return { x, y };
  }

  /**
   * Granata vista (entro viewRange e in linea di vista, notata dopo grenadeReaction s) che si fermerà a meno
   * della distanza di sicurezza: prepara this.evade = { g, rest, point } verso un punto sicuro e continua a
   * scappare finché non lo raggiunge o la granata scoppia. Restituisce true finché c'è pericolo.
   */
  _grenadeDanger(dt, game) {
    const u = this.unit;
    const c = this.cfg;
    const nav = game.nav;
    const view = c.viewRange ?? 220;
    let threat = null;
    let rest = null;
    let best = Infinity;
    for (const g of game.grenades.list) {
      if (g.time < this.grenadeReaction || dist(g, u) > view) continue;
      const seen = nav.los(g.x, g.y, u.x, u.y);
      if (!seen && this.evade?.g !== g) continue; // già in fuga da questa: continua anche senza vederla
      const r = this.evade?.g === g ? this.evade.rest : this._grenadeRest(g, nav);
      const d = dist(r, u);
      if (d >= this._grenadeSafeRadius(g) || !nav.los(r.x, r.y, u.x, u.y) || d >= best) continue;
      best = d;
      threat = g;
      rest = r;
    }
    const e = this.evade;
    // nessun pericolo: finisce la fuga solo una volta arrivato (o se la granata è scoppiata)
    if (!threat && e && game.grenades.list.includes(e.g) && dist(e.point, u) > (c.arriveDistance ?? 4)) {
      threat = e.g;
      rest = e.rest;
    }
    if (!threat) {
      if (e) {
        this.evade = null;
        this._stop();
        this.repath = 0;
      }
      return false;
    }
    // la granata si muove ancora: ogni tanto ristima dove si ferma e ricalcola il punto sicuro
    if (!e || e.g !== threat || (e.retarget -= dt) <= 0) {
      const r = this._grenadeRest(threat, nav);
      this.evade = { g: threat, rest: r, point: this._evadePoint(game, r, this._grenadeSafeRadius(threat)), retarget: 0.25 };
      this.throwPlan = null;
      this.repath = 0;
    }
    return true;
  }

  /** Punto raggiungibile più vicino lontano almeno "radius" da g o al riparo (con un piccolo bonus al riparo). */
  _evadePoint(game, g, radius) {
    const u = this.unit;
    const nav = game.nav;
    const coverBonus = this.cfg.grenadeCoverBonus ?? 1.5; // tile di percorso che vale la pena fare in più per un riparo
    const reach = nav.reach(u.x, u.y, Math.ceil(radius / nav.size) + 4);
    let best = null;
    let bestS = Infinity;
    for (const i of reach.list) {
      const d = reach.dist(i);
      if (d - coverBonus >= bestS) continue;
      const p = nav.center(i);
      const hidden = this._hidden(nav, g, p);
      if (!hidden && dist(p, g) < radius) continue;
      const s = d - (hidden ? coverBonus : 0);
      if (s < bestS) {
        bestS = s;
        best = p;
      }
    }
    if (best) return best;
    // nessun punto sicuro raggiungibile: lontano dalla granata in linea retta
    const a = Math.atan2(u.y - g.y, u.x - g.x);
    return { x: u.x + Math.cos(a) * radius, y: u.y + Math.sin(a) * radius };
  }

  /**
   * Ogni grenadeInterval s, con un bersaglio noto da poco, cerca un punto d'arrivo: il bersaglio stesso o un
   * punto vicino (per lanciare dietro un angolo) in vista dal bot e dal bersaglio, entro la gittata, abbastanza
   * lontano da sé e senza compagni nel raggio. Più probabile se il bersaglio è al riparo o ci sono più nemici.
   */
  _considerGrenade(dt, game) {
    const u = this.unit;
    const c = this.cfg;
    if (this.throwPlan || (this.grenadeTimer -= dt) > 0) return;
    this.grenadeTimer = rand(c.grenadeInterval, 6);
    if (c.grenades === false || u.grenades <= 0 || u.reloading || u.throwCooldown > 0) return;
    if (this.evade || !this.target || this.time < this.reactAt || !this.lastSeen) return;
    const mem = c.grenadeMemory ?? 3;
    if (this.time - this.lastSeen.time > mem) return;
    const seen = this.visible ? { x: this.target.x, y: this.target.y } : this.lastSeen;

    const nav = game.nav;
    const def = u.grenadeType;
    const R = def.blastRadius ?? 40;
    const minD = Math.max(def.minRange ?? 20, R * (c.grenadeSelfSafety ?? 1.25));
    const maxD = (def.maxRange ?? 150) * 0.95;
    const margin = c.grenadeFriendlyMargin ?? 14;
    const mates = game.units.filter((o) => o !== u && !o.dead && o.team === u.team);
    // nemici noti (lavagna di squadra) + il bersaglio
    const enemies = new Map();
    for (const [e, k] of this.squad.contacts) if (!e.dead && this.time - k.time <= mem) enemies.set(e, k);
    enemies.set(this.target, seen);

    const candidates = [seen];
    for (const f of [0.35, 0.65]) {
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2;
        candidates.push({ x: seen.x + Math.cos(a) * R * f, y: seen.y + Math.sin(a) * R * f });
      }
    }
    let best = null;
    let bestS = -Infinity;
    let bestHits = 0;
    for (const p of candidates) {
      if (game.map.isSolidAt(p.x, p.y)) continue;
      const d = dist(p, u);
      if (d < minD || d > maxD) continue;
      if (!nav.los(u.x, u.y, p.x, p.y) || !nav.los(p.x, p.y, seen.x, seen.y)) continue;
      if (mates.some((m) => dist(m, p) < R + margin)) continue;
      let hits = 0;
      for (const e of enemies.values()) if (dist(e, p) < R * 0.8 && nav.los(p.x, p.y, e.x, e.y)) hits++;
      if (!hits) continue;
      const s = hits * 100 - dist(p, seen);
      if (s > bestS) {
        bestS = s;
        best = p;
        bestHits = hits;
      }
    }
    if (!best) return;
    let chance = this.visible ? c.grenadeChanceVisible ?? 0.2 : c.grenadeChanceHidden ?? 0.6;
    if (bestHits >= 2) chance += c.grenadeChanceGroup ?? 0.3;
    if (Math.random() < chance) this.throwPlan = { point: { x: best.x, y: best.y }, until: this.time + (c.grenadeAimTime ?? 0.8) };
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
        const tSpeed = Math.abs((t?.isVehicle ? t.def.maxSpeed : t?.speed) || 90);
        const speed = t && !aimPt.suppress ? Math.min(1.5, Math.hypot(t.vx, t.vy) / tSpeed) : 0;
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
