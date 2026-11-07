import { Camera } from '../engine/camera.js';
import { drawSprite } from '../engine/assets.js';
import { TileMap } from '../engine/tilemap.js';
import { Player } from './player.js';
import { Effects } from './effects.js';
import { Hud } from './hud.js';
import { Grenades } from './grenades.js';
import { Ctf } from './ctf.js';
import { Nav } from './nav.js';
import { BotBrain, Squad } from './ai.js';
import { Scores } from './scores.js';
import { Pickups } from './pickups.js';
import { keyName } from '../engine/input.js';

const STEP = 1 / 60; // update a timestep fisso
const BULLET_SUBSTEP = 2; // px: passo massimo del controllo collisioni dei proiettili
const WALL_DECAL_INSET = 3; // px: distanza del buco dalla faccia del muro colpita

/** Valore numerico o intervallo [min, max] -> numero casuale nell'intervallo. */
function rand(v, def = 0) {
  if (v === undefined || v === null) return def;
  if (Array.isArray(v)) return v[0] + Math.random() * (v[1] - v[0]);
  return v;
}

export class Game {
  /** La partita vera e propria si prepara con setup() (mappa, squadra, numero di bot). */
  constructor({ config, assets, audio, display, input, effectsCfg, weapons, grenadeTypes, i18n, career }) {
    this.config = config;
    this.i18n = i18n; // per i testi di HUD/menu: this.i18n.t('chiave')
    this.assets = assets;
    this.audio = audio;
    this.display = display;
    this.input = input;

    this.running = false;
    this.suspended = false; // pausa del giocatore (menu di pausa): niente update, la scena resta disegnata
    this.attract = false; // partita dimostrativa dietro al menu: anche il "giocatore" è un bot, niente HUD
    this.viewOffsetX = 0; // px di gioco: sposta la visuale (il menu laterale copre la parte sinistra)
    this.debug = !!config.debug;
    this.background = config.display?.background || '#000';

    this.map = null;
    this.weapons = weapons;

    // Modalità Capture The Flag: squadre, bandiere, ticket (game.json -> teams / ctf)
    this.teams = config.teams || {};
    this.ctf = null;
    this.playerTeam = null;
    this.grenadeTypes = grenadeTypes;

    this.bullets = [];
    this.grenades = new Grenades(assets, audio);
    this.shake = { time: 0, duration: 0, amount: 0 }; // scossa della camera (esplosioni)
    this.effects = new Effects(effectsCfg, assets, audio);
    this.crosshair = assets.sprites.get('crosshair') || null;
    this.camera = new Camera(config.camera);

    // Morte e rientro (game.json -> death), fine partita (matchEnd).
    // onMatchEnd(outcome) / onRestart: callback impostati da main.js per la schermata (DOM).
    this.deathCfg = config.death || {};
    this.matchCfg = config.matchEnd || {};
    this.onMatchEnd = null;
    this.onRestart = null;
    this.corpses = [];

    // Soldati controllati dall'IA (game.json -> bots) e colpi sui soldati (combat)
    this.nav = null;
    this.botsCfg = config.bots || {};
    this.aiCfg = this.botsCfg.ai || {};
    this.combat = config.combat || {};
    this.bots = []; // { unit, brain, team, weapon, respawn }
    this.botCounts = this.botsCfg.teams || {}; // { squadra: numero di bot }
    this.squads = {};
    this.playerBrain = null; // IA del giocatore nella partita dimostrativa
    this.time = 0; // secondi di gioco (memoria dell'IA)

    // Punteggi della partita (game.json -> scoring) e carriera del giocatore (gradi, ranks.js)
    this.scoringCfg = config.scoring || {};
    this.scores = new Scores(this.scoringCfg);
    this.scores.onAward = (rec, type, n) => this._onAward(rec, type, n);
    this.career = career;
    this.ranks = career.ranks;
    this.playerRecord = null;
    this.matchStartXp = 0;

    // Armi e granate a terra (game.json -> pickups); pickupOffer = arma che il giocatore può raccogliere ora
    this.pickupsCfg = config.pickups || {};
    this.pickups = new Pickups(this.pickupsCfg, assets, weapons);
    this.pickupOffer = null;

    this._fps = { value: 0, frames: 0, time: 0 };
  }

  /**
   * Prepara una partita: level = JSON del livello, team = squadra del giocatore,
   * allies / enemies = bot compagni / avversari, attract = partita dimostrativa (tutti bot, niente HUD né audio).
   */
  setup({ level, team, allies = 0, enemies = 4, attract = false }) {
    this.level = level;
    this.map = new TileMap(level, this.assets.tileset(level.tileset));
    this.ctf = new Ctf(this.config.ctf, this.teams, this.map, level);
    this.nav = new Nav(this.map);
    this.playerTeam = this.teams[team] ? team : this.ctf.teamIds[0] || null;
    const enemy = this.ctf.teamIds.find((t) => t !== this.playerTeam);
    this.botCounts = { [this.playerTeam]: Math.max(0, allies | 0) };
    if (enemy) this.botCounts[enemy] = Math.max(0, enemies | 0);
    this.attract = !!attract;
    this.suspended = false;
    this._reset();
  }

  /** Stato di una nuova partita: ticket e bandiere iniziali, giocatore alla base, niente proiettili/effetti. */
  _reset() {
    this.ctf.reset();
    this.squads = {};
    for (const t of this.ctf.teamIds) this.squads[t] = new Squad(t);
    this.playerBrain = null;
    this._resetScores();
    const base = this.ctf.spawnPoint(this.playerTeam, null);
    this._spawnPlayer(base.x, base.y);
    this.hud = new Hud(this.config.hud, this.i18n, this.assets);
    this.bullets.length = 0;
    this.grenades.clear();
    this.shake.time = 0;
    this.effects.clear();
    this.corpses.length = 0;
    this.pickups.reset(this.map);
    this.pickupOffer = null;
    this.respawn = null; // { time, delay, x, y } mentre il giocatore è morto
    this.ended = null; // { time, shown, outcome } a partita finita
    this._spawnBots();
    this._snapCamera();
  }

  _snapCamera() {
    const { display } = this;
    this.camera.snap(this.player.x - this.viewOffsetX, this.player.y, 0, display.width, display.height, this.map);
  }

  /** Classifica vuota: record del giocatore (grado della carriera) e nomi fittizi per i bot. */
  _resetScores() {
    this.scores.reset();
    this.matchStartXp = this.career.xp;
    const names = [...this.i18n.list('scoreboard.botNames')];
    for (let i = names.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [names[i], names[j]] = [names[j], names[i]];
    }
    this._botNames = names;
    this._botNameIndex = 0;
    this.playerRecord = this.scores.add({
      name: this.attract ? this._nextBotName() : this.i18n.t('scoreboard.you'),
      team: this.playerTeam,
      human: !this.attract,
      rank: this.career.rankIndex,
    });
  }

  _nextBotName() {
    const i = this._botNameIndex++;
    const list = this._botNames;
    if (!list.length) return `Bot ${i + 1}`;
    // lista finita: si riparte con un numero (es. "Ricci 2")
    const round = Math.floor(i / list.length);
    return round ? `${list[i % list.length]} ${round + 1}` : list[i];
  }

  /** Grado casuale di un bot: attorno a quello del giocatore (scoring.botRankSpread). */
  _botRank() {
    const s = this.scoringCfg.botRankSpread ?? 2;
    const r = this.career.rankIndex + Math.round((Math.random() * 2 - 1) * s);
    return Math.max(0, Math.min(this.ranks.count - 1, r));
  }

  /** Punti assegnati: per il giocatore umano messaggio "+N", suono e carriera (con eventuali promozioni). */
  _onAward(rec, type, n) {
    if (rec !== this.playerRecord || this.attract) return;
    const c = this.scoringCfg;
    this.hud.popup(`+${n} ${this.i18n.t(`score.events.${type}`)}`, c.popupColors?.[type]);
    if (type === 'kill' && c.killSound) this.audio.play(c.killSound);
    for (const i of this.career.add(n)) {
      rec.rank = i;
      const rank = this.ranks.get(i);
      this.hud.promote({ name: this.i18n.t(`ranks.${rank.id}.name`), insignia: this.ranks.insignia(i) });
      if (c.promotionSound) this.audio.play(c.promotionSound);
    }
  }

  /** Riepilogo per la schermata di fine partita (Menu). */
  get matchSummary() {
    return {
      ranking: this.scores.ranking(),
      player: this.playerRecord,
      xpBefore: this.matchStartXp,
      xpAfter: this.career.xp,
    };
  }

  _spawnPlayer(x, y) {
    this.player = new Player(this.config.player, x, y, this.assets, this.weapons, this.grenadeTypes, this.playerTeam);
    this.player.combatant = this.playerRecord;
    if (!this.attract) return;
    // partita dimostrativa: il giocatore è guidato da un BotBrain come gli altri soldati
    this.player.isBot = true;
    const squad = this.squads[this.playerTeam];
    const brain = new BotBrain(this.player, squad, this.aiCfg);
    const i = squad.brains.indexOf(this.playerBrain);
    if (i >= 0) squad.brains[i] = brain;
    else squad.brains.push(brain);
    this.playerBrain = brain;
  }

  /** Tutti i soldati (giocatore + bot), vivi o morti: { x, y, team, dead, ... }. */
  get units() {
    const list = [this.player];
    for (const b of this.bots) list.push(b.unit);
    return list;
  }

  /** Bot di inizio partita: botCounts = { squadra: numero } (da setup), armi a rotazione da bots.weapons. */
  _spawnBots() {
    this.bots.length = 0;
    const teams = this.botCounts || {};
    const weapons = (this.botsCfg.weapons || [this.config.player.weapon]).filter((id) => this.weapons.get(id));
    for (const [team, count] of Object.entries(teams)) {
      if (!this.squads[team]) {
        console.warn(`bots.teams: unknown team "${team}"`);
        continue;
      }
      for (let i = 0; i < count; i++) {
        const slot = { team, weapon: weapons[i % weapons.length] || this.config.player.weapon, unit: null, brain: null, respawn: null };
        slot.record = this.scores.add({ name: this._nextBotName(), team, rank: this._botRank() });
        this.bots.push(slot);
        this._spawnBot(slot, null);
      }
    }
  }

  /** (Ri)crea il soldato del bot "slot": su una bandiera della squadra se ce n'è una, altrimenti alla base. */
  _spawnBot(slot, near) {
    const cfg = { ...this.config.player, ...(this.botsCfg.player || {}), weapon: slot.weapon };
    const hw = (cfg.hitbox?.[0] ?? 10) / 2;
    const hh = (cfg.hitbox?.[1] ?? 10) / 2;
    const pos = this.ctf.spawnPoint(slot.team, near, hw, hh, { preferFlags: true, spread: this.botsCfg.baseSpread || [6, 22] });
    const unit = new Player(cfg, pos.x, pos.y, this.assets, this.weapons, this.grenadeTypes, slot.team);
    unit.isBot = true;
    unit.combatant = slot.record;
    // guarda verso il centro della mappa
    unit.angle = Math.atan2(this.map.pixelHeight / 2 - pos.y, this.map.pixelWidth / 2 - pos.x);
    unit.legsAngle = unit.angle;
    const squad = this.squads[slot.team];
    const brain = new BotBrain(unit, squad, this.aiCfg);
    const i = squad.brains.indexOf(slot.brain);
    if (i >= 0) squad.brains[i] = brain;
    else squad.brains.push(brain);
    slot.unit = unit;
    slot.brain = brain;
    slot.respawn = null;
  }

  _updateBots(dt) {
    for (const b of this.bots) {
      if (!b.unit.dead) {
        b.unit.update(dt, this, b.brain.think(dt, this));
        continue;
      }
      if (!b.respawn) {
        // appena morto: punti, cadavere, ticket in meno, conto alla rovescia
        this.scores.onDeath(b.unit, this.ctf);
        this._addCorpse(b.unit);
        this.ctf.onDeath(b.team);
        b.respawn = { time: 0, delay: this.botsCfg.respawnDelay ?? this.deathCfg.respawnDelay ?? 5, x: b.unit.x, y: b.unit.y };
      } else if ((b.respawn.time += dt) >= b.respawn.delay) {
        this._spawnBot(b, b.respawn);
      }
    }
    for (const s of Object.values(this.squads)) s.update(this.time, this.aiCfg.memoryTime ?? 6);
  }

  /** Comandi del giocatore umano per Player.update (tastiera/mouse o stick touch). */
  _humanControl() {
    const { input, camera } = this;
    return {
      move: input.getMove(),
      aim: (u) => input.getAim(u.x - Math.round(camera.x), u.y - Math.round(camera.y)),
      firing: input.isFiring(),
      reload: input.wasPressed('reload'),
      grenade: input.wasPressed('grenade'),
      repeat: input.mode === 'touch' && input.touchHoldToRepeat,
      faceMove: input.mode === 'touch',
    };
  }

  /** Nuova partita (dalla schermata di fine partita). */
  restart() {
    if (!this.canRestart) return;
    this._reset();
    this.onRestart?.();
  }

  get isMatchOver() {
    return this.ended !== null;
  }

  /** La schermata di fine partita è visibile da almeno restartDelay secondi. */
  get canRestart() {
    const e = this.ended;
    const m = this.matchCfg;
    return !!e && e.shown && e.time >= (m.delay ?? 2) + (m.restartDelay ?? 0.8);
  }

  get paused() {
    // In portrait su touch il gioco è in pausa (overlay "ruota il dispositivo")
    return this.input.isTouchDevice && this.display.isPortrait;
  }

  start() {
    let last = performance.now();
    let acc = 0;
    const frame = (now) => {
      let dt = (now - last) / 1000;
      last = now;
      if (dt > 0.25) dt = 0.25;
      this._countFps(dt);

      if (this.running && !this.suspended && !this.paused && this.map) {
        acc += dt;
        while (acc >= STEP) {
          this.update(STEP);
          acc -= STEP;
        }
      } else {
        acc = 0;
      }
      this.render();
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }

  _countFps(dt) {
    const f = this._fps;
    f.frames++;
    f.time += dt;
    if (f.time >= 0.5) {
      f.value = Math.round(f.frames / f.time);
      f.frames = 0;
      f.time = 0;
    }
  }

  // ---------- Update ----------

  update(dt) {
    const { input, display } = this;
    if (input.wasPressed('debug')) this.debug = !this.debug;
    if (input.wasPressed('debugNextWeapon')) this._cycleWeapon();
    if (input.wasPressed('debugHurt')) this.player.damage(this.config.debugDamage ?? 10);
    if (input.wasPressed('debugHeal')) this.player.heal(this.config.debugDamage ?? 10);
    if (input.wasPressed('debugGrenade')) this.player.addGrenades(1);
    if (input.wasPressed('debugTeam')) this._cycleTeam();
    if (input.wasPressed('debugScore')) this.scores.award(this.playerRecord, 'debug');

    this.time += dt;
    if (!this.ended) {
      const ctrl = this.playerBrain && !this.player.dead ? this.playerBrain.think(dt, this) : this._humanControl();
      this.player.update(dt, this, ctrl);
      this._updateBots(dt);
      if (this.player.dead && !this.respawn) this._onPlayerDeath();
      this._updatePickups(dt);
      if (this.respawn) this._updateRespawn(dt);
      this.ctf.update(dt, this.units);
      for (const e of this.ctf.takeEvents()) this._onFlagEvent(e);
      if (this.ctf.result) this._endMatch();
    } else {
      this._updateMatchEnd(dt);
    }
    for (const c of this.corpses) c.time += dt;
    this.hud.update(dt, this.player);
    this._updateBullets(dt);
    this.grenades.update(dt, this.map, (g) => this.explode(g.def, g.x, g.y, g.owner));
    this.effects.update(dt, this.map);
    this.shake.time = Math.max(0, this.shake.time - dt);

    this.camera.follow(this.player.x - this.viewOffsetX, this.player.y, this.player.angle, display.width, display.height, this.map, dt);
    // ascoltatore dei suoni posizionali = centro della visuale
    this.audio.listener = { x: this.camera.x + display.width / 2, y: this.camera.y + display.height / 2 };
    input.endFrame();
  }

  // ---------- Granate ----------

  /**
   * Lancia una granata di "player" verso la mira. Desktop con mouse: tocca terra la prima volta
   * sotto il mirino (tra minRange e maxRange); touch o senza mouse: a defaultRange px;
   * bot: a player.throwDistance px (scelta dall'IA).
   */
  throwGrenade(player) {
    const def = player.grenadeType;
    let dist = def.defaultRange ?? 90;
    if (player.isBot) {
      dist = player.throwDistance ?? dist;
    } else if (this.input.mode === 'desktop' && this.input.mouse.seen) {
      const m = this.input.mouseGame;
      dist = Math.hypot(m.x + Math.round(this.camera.x) - player.x, m.y + Math.round(this.camera.y) - player.y);
    }
    dist = Math.min(def.maxRange ?? 150, Math.max(def.minRange ?? 20, dist));

    // punto di lancio: la mano ([avanti, lato]); se è dentro un muro, il centro del giocatore
    const [f, s] = def.hand || [6, -3];
    const c = Math.cos(player.angle);
    const sn = Math.sin(player.angle);
    let x = player.x + c * f - sn * s;
    let y = player.y + sn * f + c * s;
    if (this.map.isSolidAt(x, y)) {
      x = player.x;
      y = player.y;
    }
    this.grenades.spawn(def, x, y, player.angle, dist, player.vx, player.vy, player);
  }

  /** Esplosione della granata "def" in (x, y) lanciata da "owner": effetti, scossa della camera, danni. */
  explode(def, x, y, owner = null) {
    if (def.explosion) this.effects.explosion(def.explosion, x, y, this.map);
    if (def.shake) {
      this.shake.amount = def.shake.amount ?? 3;
      this.shake.duration = def.shake.time ?? 0.4;
      this.shake.time = this.shake.duration;
    }
    // danno ai soldati (giocatore e bot, di qualunque squadra): decresce con la distanza
    // fino a minDamageFactor sul bordo, i muri riparano
    if (def.hurtsPlayer === false) return;
    const radius = def.blastRadius ?? 40;
    for (const p of this.units) {
      const d = Math.hypot(p.x - x, p.y - y);
      if (p.dead || d >= radius || !this._lineOfSight(x, y, p.x, p.y)) continue;
      const k = 1 - (d / radius) * (1 - (def.minDamageFactor ?? 0.2));
      // unit: null = l'IA non "vede" chi l'ha lanciata; by = a chi vanno uccisione e assist
      p.damage(Math.round((def.damage ?? 80) * k), { unit: null, x, y, by: owner });
    }
  }

  /** true se il segmento (x0,y0)-(x1,y1) non attraversa tile solidi (passi da 2 px). */
  _lineOfSight(x0, y0, x1, y1) {
    const n = Math.ceil(Math.hypot(x1 - x0, y1 - y0) / 2);
    for (let i = 1; i < n; i++) {
      const t = i / n;
      if (this.map.isSolidAt(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t)) return false;
    }
    return true;
  }

  // ---------- Morte, rientro e fine partita ----------

  /** Il giocatore è appena morto: cadavere a terra, ticket in meno, conto alla rovescia per il rientro. */
  _onPlayerDeath() {
    const p = this.player;
    this.scores.onDeath(p, this.ctf);
    this._addCorpse(p);
    this.ctf.onDeath(p.team);
    this.respawn = { time: 0, delay: this.deathCfg.respawnDelay ?? 5, x: p.x, y: p.y };
  }

  _addCorpse(p) {
    this.corpses.push(this._makeCorpse(p));
    const max = this.deathCfg.maxCorpses ?? 12;
    while (this.corpses.length > max) this.corpses.shift();
  }

  _updateRespawn(dt) {
    const r = this.respawn;
    r.time += dt;
    if (r.time < r.delay) return;
    // rientro alla bandiera della squadra più vicina al punto della morte, o alla base
    const p = this.player;
    const pos = this.ctf.spawnPoint(this.playerTeam, r, p.hw, p.hh);
    this._spawnPlayer(pos.x, pos.y);
    this.respawn = null;
    if (this.deathCfg.respawnSound) this.audio.play(this.deathCfg.respawnSound);
    this._snapCamera();
  }

  /** Cadavere del soldato p: corpo, pozza che si allarga e arma caduta. */
  _makeCorpse(p) {
    const g = this.deathCfg;
    const a = p.deathAngle;
    if (p.cfg.deathSound) this.audio.play(p.cfg.deathSound, p);

    // corpo: lo sprite ha la testa a sinistra, quindi ruotato come la mira la testa finisce
    // dietro (caduto all'indietro), i piedi restano dov'era il soldato
    const back = p.cfg.deadOffset ?? 4;
    const body = p.deadSprite ? { sprite: p.deadSprite, x: p.x - Math.cos(a) * back, y: p.y - Math.sin(a) * back, angle: a } : null;

    // pozza sotto il corpo (si allarga in poolTime secondi)
    const poolSprite = g.poolSprite && this.assets.sprites.get(g.poolSprite);
    const pool = poolSprite
      ? { sprite: poolSprite, x: p.x - Math.cos(a) * back, y: p.y - Math.sin(a) * back, angle: Math.floor(Math.random() * 4) * (Math.PI / 2) }
      : null;

    // l'arma cade a terra davanti al corpo da un lato, le granate dall'altro: diventano oggetti raccoglibili
    const dist = g.dropDistance ?? 9;
    const first = Math.random() < 0.5 ? -1 : 1;
    const spot = (side) => {
      // prova il lato richiesto, poi l'altro, se l'oggetto finirebbe dentro un muro
      for (const s of [side, -side]) {
        const da = a + s * (0.5 + Math.random() * 0.6);
        const x = p.x + Math.cos(da) * dist;
        const y = p.y + Math.sin(da) * dist;
        if (!this.map.isSolidAt(x, y)) return { x, y, side: s };
      }
      return { x: p.x, y: p.y, side };
    };
    if (g.dropWeapon !== false) {
      const s = spot(first);
      this.pickups.dropWeapon(p.weapon.id, p.ammo, s.x, s.y, a + s.side * (0.8 + Math.random()));
    }
    if (g.dropGrenades !== false && p.grenades > 0) {
      const s = spot(-first);
      this.pickups.dropGrenades(p.grenades, s.x, s.y);
    }

    return { time: 0, body, pool };
  }

  // ---------- Oggetti a terra ----------

  /** Granate raccolte passandoci sopra (tutti); scambio d'arma del giocatore umano con l'azione "pickup". */
  _updatePickups(dt) {
    this.pickups.update(dt, this.units, (u, n) => {
      if (this.pickupsCfg.grenadeSound) this.audio.play(this.pickupsCfg.grenadeSound, u);
      if (u === this.player && !this.attract) this.hud.popup(this.i18n.t('pickup.grenades', { count: n }), this.pickupsCfg.popupColor);
    });
    const p = this.player;
    this.pickupOffer = !p.dead && !this.attract ? this.pickups.nearestWeapon(p) : null;
    if (this.pickupOffer && this.input.wasPressed('pickup')) this._swapWeapon(p, this.pickupOffer);

    // bot (e giocatore della partita dimostrativa) arrivati sull'arma scelta dall'IA
    const r = (this.pickupsCfg.radius ?? 9) + 2;
    const brains = this.bots.map((b) => b.brain);
    if (this.playerBrain) brains.push(this.playerBrain);
    for (const br of brains) {
      const it = br?.pickupNow;
      if (!it) continue;
      br.pickupNow = null;
      const u = br.unit;
      if (u.dead || !this.pickups.list.includes(it) || Math.hypot(u.x - it.x, u.y - it.y) > r) continue;
      this._swapWeapon(u, it);
    }
  }

  /** Testo dell'HUD sopra un'arma raccoglibile: "[E] Raccogli Fucile a pompa" (su touch senza tasto). */
  _pickupPrompt() {
    const it = this.pickupOffer;
    if (!it) return null;
    const w = this.weapons.get(it.weapon);
    const weapon = this.i18n.t(w.name || w.id);
    if (this.input.mode === 'touch') return this.i18n.t('hud.pickupTouch', { weapon });
    return this.i18n.t('hud.pickup', { key: keyName(this.input.bindings.pickup?.[0], this.i18n), weapon });
  }

  /** L'unità prende l'arma "item" (con i colpi rimasti) e lascia a terra quella che impugnava. */
  _swapWeapon(u, item) {
    this.pickups.take(item);
    const prev = u.equip(item.weapon, item.ammo ?? undefined);
    if (prev) this.pickups.dropWeapon(prev.id, prev.ammo, u.x, u.y, u.angle + Math.PI / 2);
    if (this.pickupsCfg.weaponSound) this.audio.play(this.pickupsCfg.weaponSound, u);
    if (u === this.player && !this.attract) {
      this.hud.popup(this.i18n.t(u.weapon.name || u.weapon.id), this.pickupsCfg.popupColor);
      this.pickupOffer = null;
    }
  }

  _drawCorpses(ctx) {
    const poolTime = this.deathCfg.poolTime ?? 2.5;
    for (const c of this.corpses) {
      if (c.pool) {
        // frame della pozza in base al tempo: si allarga fino all'ultimo frame
        const k = Math.min(1, c.time / poolTime);
        const frame = Math.min(c.pool.sprite.frameCount - 1, Math.floor(k * c.pool.sprite.frameCount));
        drawSprite(ctx, c.pool.sprite, frame, c.pool.x, c.pool.y, c.pool.angle);
      }
    }
    for (const c of this.corpses) {
      if (c.body) drawSprite(ctx, c.body.sprite, 0, c.body.x, c.body.y, c.body.angle);
    }
  }

  /** Cattura/neutralizzazione di una bandiera: suono e messaggio dal punto di vista del giocatore. */
  _onFlagEvent(e) {
    const c = this.config.ctf || {};
    const mine = e.team === this.playerTeam;
    const flag = e.flag.id;
    this.scores.onFlagEvent(e);
    let key;
    let sound;
    let team;
    if (e.type === 'captured') {
      key = mine ? 'hud.flag.captured' : 'hud.flag.enemyCaptured';
      sound = mine ? c.capturedSound : c.lostSound;
      team = e.team;
    } else {
      key = mine ? 'hud.flag.lost' : 'hud.flag.neutralized';
      sound = mine ? c.lostSound : c.neutralizedSound;
      team = e.by;
    }
    if (sound) this.audio.play(sound);
    this.hud.notify(this.i18n.t(key, { flag }), this.teams[team]?.color);
  }

  _endMatch() {
    const w = this.ctf.result.winner;
    const outcome = w === null ? 'draw' : w === this.playerTeam ? 'victory' : 'defeat';
    this.ended = { time: 0, shown: false, outcome };
    this.respawn = null;
    this.pickupOffer = null;
    this.scores.endMatch(w);
  }

  _updateMatchEnd(dt) {
    const e = this.ended;
    e.time += dt;
    if (this.attract) {
      // partita dimostrativa: ricomincia da sola
      if (e.time >= (this.matchCfg.delay ?? 2)) this._reset();
      return;
    }
    if (!e.shown && e.time >= (this.matchCfg.delay ?? 2)) {
      e.shown = true;
      this.onMatchEnd?.(e.outcome);
    }
    if (this.canRestart && this.input.wasPressed('confirm')) this.restart();
  }

  /** Debug: passa il giocatore alla squadra successiva. */
  _cycleTeam() {
    const ids = this.ctf.teamIds;
    if (!ids.length) return;
    this.playerTeam = ids[(ids.indexOf(this.playerTeam) + 1) % ids.length];
    this.player.setTeam(this.playerTeam);
    this.playerRecord.team = this.playerTeam;
  }

  // ---------- Proiettili ----------
  // Ogni proiettile ha una gittata ("range") fissata al momento dello sparo:
  // - desktop con mouse: distanza dal mouse (con imprecisione) -> impatto sul terreno sotto il mirino;
  // - touch (o senza mouse): fino al bordo dello schermo visibile al momento dello sparo.
  // Se prima incontra un tile solido, impatto sul muro.

  /** Un colpo dell'arma impugnata: un suono e "pellets" proiettili (>1 = fucile a pompa). */
  fire(player) {
    const w = player.weapon;
    if (w.sound) this.audio.play(w.sound, player);
    // vampata e fumo alla volata (non se la canna è dentro un muro)
    const m = player.muzzle;
    if (w.muzzleFlash && !this.map.isSolidAt(m.x, m.y)) this.effects.muzzle(w.muzzleFlash, m.x, m.y, player.angle);
    const n = Math.max(1, Math.round(w.pellets || 1));
    for (let i = 0; i < n; i++) this._spawnBullet(player, w);
  }

  _spawnBullet(player, w) {
    const spread = ((w.spreadDeg || 0) * Math.PI) / 180;
    const a = player.angle + (Math.random() - 0.5) * spread;
    const dx = Math.cos(a);
    const dy = Math.sin(a);
    const m = player.muzzle;
    const minRange = w.minRange ?? 4;

    let range;
    if (player.aimDistance !== null) {
      // bot: fino al punto mirato più un piccolo scarto -> o colpisce o cade a terra vicino al bersaglio
      range = player.aimDistance - (w.muzzleOffset ?? 8) + rand(this.aiCfg.shotOvershoot, 6);
    } else if (this.input.mode === 'desktop' && this.input.mouse.seen) {
      const mouse = this.input.mouseGame;
      const tx = mouse.x + Math.round(this.camera.x);
      const ty = mouse.y + Math.round(this.camera.y);
      const dist = Math.hypot(tx - player.x, ty - player.y) - (w.muzzleOffset ?? 8);
      const jitter = 1 + (Math.random() * 2 - 1) * (w.rangeJitter || 0);
      range = dist * jitter;
    } else {
      range = this._rangeToScreenEdge(m.x, m.y, dx, dy, w.screenMargin ?? 3);
    }
    range = Math.min(w.maxRange ?? 600, Math.max(minRange, range, 0.5));

    // Canna dentro un muro (giocatore attaccato alla parete): impatto immediato
    if (this.map.isSolidAt(m.x, m.y)) {
      const n = Math.abs(dx) > Math.abs(dy) ? { x: -Math.sign(dx), y: 0 } : { x: 0, y: -Math.sign(dy) };
      this._wallImpact(m.x, m.y, player.x, player.y, n.x, n.y);
      return;
    }

    const sprite = this.assets.sprite(w.bulletSprite || 'bullet');
    // damage: danno del singolo proiettile/pallino (verrà applicato ai bersagli colpiti)
    // team/owner: i colpi non feriscono la propria squadra; il bersaglio sa da dove arrivano (IA)
    this.bullets.push({
      x: m.x, y: m.y, dx, dy, angle: a, speed: w.bulletSpeed || 300, range, sprite,
      damage: w.damage ?? 0, team: player.team, owner: player,
    });
  }

  /** Soldato colpito dal proiettile b nella posizione attuale (null se nessuno). */
  _unitHit(b) {
    const pad = this.combat.hitPadding ?? 1;
    const ff = !!this.combat.friendlyFire;
    for (const u of this.units) {
      if (u.dead || u === b.owner || (!ff && u.team === b.team)) continue;
      if (Math.abs(b.x - u.x) <= u.hw + pad && Math.abs(b.y - u.y) <= u.hh + pad) return u;
    }
    return null;
  }

  _hitUnit(b, u) {
    const o = b.owner;
    u.damage(b.damage, o ? { unit: o, x: o.x, y: o.y } : null);
    this.effects.impact(this.combat.hitImpact || 'flesh', b.x, b.y, b.x, b.y, b.dx, b.dy);
  }

  /** Debug: passa all'arma successiva del catalogo. */
  _cycleWeapon() {
    const ids = this.weapons.ids;
    const i = ids.indexOf(this.player.weapon.id);
    this.player.equip(ids[(i + 1) % ids.length]);
  }

  /** Distanza lungo (dx,dy) da (x,y) al bordo dell'area visibile (meno un margine). */
  _rangeToScreenEdge(x, y, dx, dy, margin) {
    const left = Math.round(this.camera.x) + margin;
    const top = Math.round(this.camera.y) + margin;
    const right = left + this.display.width - margin * 2;
    const bottom = top + this.display.height - margin * 2;
    let t = Infinity;
    if (dx > 0) t = Math.min(t, (right - x) / dx);
    else if (dx < 0) t = Math.min(t, (left - x) / dx);
    if (dy > 0) t = Math.min(t, (bottom - y) / dy);
    else if (dy < 0) t = Math.min(t, (top - y) / dy);
    return Math.max(0, t);
  }

  _updateBullets(dt) {
    const map = this.map;
    for (let i = this.bullets.length - 1; i >= 0; i--) {
      const b = this.bullets[i];
      let travel = b.speed * dt;
      let done = false;
      while (travel > 0 && !done) {
        const step = Math.min(travel, BULLET_SUBSTEP, b.range);
        const px = b.x;
        const py = b.y;
        b.x += b.dx * step;
        b.y += b.dy * step;
        b.range -= step;
        travel -= step;

        const hit = this._unitHit(b);
        if (hit) {
          this._hitUnit(b, hit);
          done = true;
        } else if (map.isSolidAt(b.x, b.y)) {
          const n = this._surfaceNormal(px, py, b.x, b.y, b.dx, b.dy);
          this._wallImpact(b.x, b.y, px, py, n.x, n.y);
          done = true;
        } else if (b.range <= 1e-6) {
          // a fine corsa conta anche un soldato appena oltre (mirino/punto mirato sul suo corpo)
          if (!this._hitJustBeyond(b)) this._groundImpact(b.x, b.y);
          done = true;
        }
      }
      if (done) this.bullets.splice(i, 1);
    }
  }

  /** Prosegue di combat.endHitReach px dalla fine della corsa: se incontra un soldato lo colpisce. */
  _hitJustBeyond(b) {
    const reach = this.combat.endHitReach ?? 6;
    const x0 = b.x;
    const y0 = b.y;
    let hit = null;
    for (let s = 2; s <= reach && !hit; s += 2) {
      b.x = x0 + b.dx * s;
      b.y = y0 + b.dy * s;
      if (this.map.isSolidAt(b.x, b.y)) break;
      hit = this._unitHit(b);
    }
    if (hit) this._hitUnit(b, hit);
    b.x = x0;
    b.y = y0;
    return !!hit;
  }

  /** Normale della faccia del tile solido attraversata passando da (px,py) a (x,y). */
  _surfaceNormal(px, py, x, y, dx, dy) {
    const s = this.map.size;
    const ptx = Math.floor(px / s);
    const pty = Math.floor(py / s);
    const tx = Math.floor(x / s);
    const ty = Math.floor(y / s);
    if (tx !== ptx && this.map.isSolidTile(tx, pty)) return { x: -Math.sign(dx), y: 0 };
    if (ty !== pty) return { x: 0, y: -Math.sign(dy) };
    return { x: -Math.sign(dx), y: 0 };
  }

  /** (x,y) = punto dentro il tile solido (buco); (ex,ey) = punto fuori, da cui partono le particelle. */
  _wallImpact(x, y, ex, ey, nx, ny) {
    const s = this.map.size;
    const tx = Math.floor(x / s);
    const ty = Math.floor(y / s);
    const tile = this.map.tileAt(tx, ty);
    // Il buco va un po' dentro la faccia colpita, così non sborda sul pavimento
    const inset = WALL_DECAL_INSET;
    if (nx < 0) x = tx * s + inset;
    else if (nx > 0) x = (tx + 1) * s - inset;
    if (ny < 0) y = ty * s + inset;
    else if (ny > 0) y = (ty + 1) * s - inset;
    this.effects.impact(tile?.impact || 'wall', x, y, ex, ey, nx, ny);
  }

  _groundImpact(x, y) {
    const tile = this.map.tileAt(Math.floor(x / this.map.size), Math.floor(y / this.map.size));
    this.effects.impact(tile?.impact || 'ground', x, y);
  }

  // ---------- Render ----------

  render() {
    const { display, input } = this;
    const ctx = display.ctx;
    const W = display.width;
    const H = display.height;

    ctx.fillStyle = this.background;
    ctx.fillRect(0, 0, W, H);
    if (!this.map) {
      display.uiCtx.clearRect(0, 0, display.cssWidth, display.cssHeight);
      return;
    }

    // scossa della camera: spostamento casuale di pixel interi, si attenua fino a zero
    let sx = 0;
    let sy = 0;
    const sh = this.shake;
    if (sh.time > 0 && this.running) {
      const a = sh.amount * (sh.time / sh.duration);
      sx = Math.round((Math.random() * 2 - 1) * a);
      sy = Math.round((Math.random() * 2 - 1) * a);
    }
    const cx = Math.round(this.camera.x) + sx;
    const cy = Math.round(this.camera.y) + sy;
    ctx.save();
    ctx.translate(-cx, -cy);

    this.map.draw(ctx, cx, cy, W, H);
    this.effects.drawDecals(ctx);
    this.ctf.drawZones(ctx);
    this.effects.drawCasings(ctx, false); // bossoli a terra
    this.grenades.draw(ctx, false); // granate a terra
    this.pickups.drawPads(ctx);
    this._drawCorpses(ctx);
    this.pickups.draw(ctx, this.attract ? null : this.pickupOffer);
    // pennoni e soldati ordinati per y: chi sta più in alto sullo schermo è "dietro"
    // (a parità di y prima il pennone; sort stabile)
    const sorted = [...this.ctf.flags, ...this.units.filter((u) => !u.dead)].sort((a, b) => a.y - b.y);
    for (const o of sorted) {
      if (o.draw) o.draw(ctx);
      else this.ctf.drawFlag(ctx, o);
    }
    if (this.debug) this._drawBotDebug(ctx);
    this.effects.drawCasings(ctx, true); // bossoli in volo
    this.grenades.draw(ctx, true); // granate in volo
    for (const b of this.bullets) drawSprite(ctx, b.sprite, 0, b.x, b.y, b.angle);
    this.effects.drawFlashes(ctx);
    this.effects.drawParticles(ctx);
    this.effects.drawBlasts(ctx); // sopra il fumo, altrimenti ne coprirebbe il nucleo

    ctx.restore();

    const live = this.running && !this.attract; // partita del giocatore (non la dimostrativa del menu)
    const playing = live && !this.suspended && !this.ended && !this.player.dead;
    if (playing && input.mode === 'desktop' && input.mouse.seen && this.crosshair) {
      const m = input.mouseGame;
      drawSprite(ctx, this.crosshair, 0, m.x, m.y);
    }

    // UI ad alta risoluzione
    const ui = display.uiCtx;
    ui.clearRect(0, 0, display.cssWidth, display.cssHeight);
    if (playing && input.mode === 'touch') {
      const p = this.player;
      input.sticks.draw(ui, {
        reload: { label: String(p.ammo), progress: p.reloadProgress, alert: p.ammo === 0 && !p.reloading },
        grenade: { badge: String(p.grenades), disabled: p.grenades <= 0 },
        pickup: { hidden: !this.pickupOffer }, // compare solo sopra un'arma raccoglibile
      });
    }
    if (live) {
      const r = this.respawn;
      const pr = this.ranks.progress(this.career.xp);
      this.hud.draw(ui, display, this.player, {
        ctf: this.ctf,
        team: this.playerTeam,
        zone: this.ended ? null : this.ctf.zoneStatus(this.player),
        respawnIn: r ? Math.max(0, r.delay - r.time) : null,
        rank: {
          insignia: this.ranks.insignia(pr.index),
          name: this.i18n.t(`ranks.${pr.rank.id}.short`),
          ratio: pr.ratio,
          score: this.playerRecord.score,
        },
        screen: { x: this.player.x - cx, y: this.player.y - cy }, // posizione del giocatore sullo schermo (px di gioco)
        pickup: playing ? this._pickupPrompt() : null,
      });
    }
    if (this.debug) this._drawDebug(ui);
  }

  /** Debug (F3), in coordinate mondo: percorso dei bot, copertura/aggiramento, ultima posizione nota del bersaglio. */
  _drawBotDebug(ctx) {
    ctx.save();
    ctx.globalAlpha = 0.8;
    for (const { unit: u, brain: b } of this.bots) {
      if (u.dead) continue;
      ctx.fillStyle = this.teams[u.team]?.light || '#fff';
      if (b.path) {
        let x = u.x;
        let y = u.y;
        for (let i = b.pathIdx; i < b.path.length; i++) {
          const p = b.path[i];
          const n = Math.max(1, Math.ceil(Math.hypot(p.x - x, p.y - y) / 3));
          for (let k = 0; k < n; k++) ctx.fillRect(Math.round(x + ((p.x - x) * k) / n), Math.round(y + ((p.y - y) * k) / n), 1, 1);
          x = p.x;
          y = p.y;
        }
      }
      const mark = (p, color) => {
        if (!p) return;
        ctx.fillStyle = color;
        ctx.fillRect(Math.round(p.x) - 2, Math.round(p.y) - 2, 5, 1);
        ctx.fillRect(Math.round(p.x) - 2, Math.round(p.y) + 2, 5, 1);
      };
      mark(b.cover, '#4f4');
      mark(b.peek, '#ff4');
      mark(b.flankPoint, '#f4f');
      if (b.target && b.lastSeen) mark(b.lastSeen, b.visible ? '#f44' : '#f84');
      mark(b.throwPlan?.point, '#fa0');
      mark(b.evade?.point, '#4ff');
      mark(b.weaponGoal, '#fff');
    }
    ctx.restore();
  }

  _drawDebug(ui) {
    const { display, input, player, effects } = this;
    const mv = input.getMove();
    const lines = [
      `FPS ${this._fps.value}`,
      `mode ${input.mode}${input.isTouchDevice ? ' (touch device)' : ''}`,
      `res ${display.width}x${display.height} x${display.scale} dpr ${display.dpr}`,
      `pos ${player.x.toFixed(1)}, ${player.y.toFixed(1)}`,
      `move ${mv.x.toFixed(2)}, ${mv.y.toFixed(2)}`,
      `aim ${((player.angle * 180) / Math.PI).toFixed(0)}° fire ${input.isFiring() ? 'Y' : 'N'}`,
      `weapon ${player.weapon.id} (F4: next) dmg ${player.weapon.damage}`,
      `ammo ${player.ammo}/${player.weapon.magazine}${player.reloading ? ` reloading ${Math.round(player.reloadProgress * 100)}%` : ''}`,
      `health ${player.health}/${player.maxHealth} (F5: hurt, F6: heal)`,
      `grenades ${player.grenades} (G: throw, F7: +1) live ${this.grenades.list.length} blasts ${effects.blasts.length}`,
      `team ${this.playerTeam} (F8: switch) tickets ${this.ctf.teamIds.map((t) => `${t} ${this.ctf.tickets[t]}`).join(' / ')}`,
      `flags ${this.ctf.flags.map((f) => `${f.id}:${f.owner || '-'} ${Math.round(f.progress * 100)}%`).join('  ')}`,
      `score ${this.playerRecord.score} career xp ${this.career.xp} rank ${this.career.rankIndex} (F9: +${this.scoringCfg.points?.debug ?? 0})`,
      `bots ${this.bots.map((b) => (b.unit.dead ? 'x' : `${b.brain.mode === 'combat' ? `${b.brain.role}/${b.brain.phase}` : 'obj'}`)).join(' ')}`,
      `bullets ${this.bullets.length} decals ${effects.decals.length} particles ${effects.particles.length} casings ${effects.casings.length} flashes ${effects.flashes.length}`,
    ];
    const top = Math.round(this.hud.topHeight(display)); // sotto l'HUD
    ui.save();
    ui.font = '12px monospace';
    ui.textBaseline = 'top';
    ui.textAlign = 'left';
    ui.fillStyle = 'rgba(0,0,0,0.5)';
    ui.fillRect(4, top, 300, lines.length * 14 + 8);
    ui.fillStyle = '#9f9';
    lines.forEach((l, i) => ui.fillText(l, 10, top + 5 + i * 14));
    ui.restore();
  }
}
