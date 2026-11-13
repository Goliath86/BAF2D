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
import { Props } from './props.js';
import { Weather } from './weather.js';
import { Vehicle } from './vehicles.js';
import { VehicleBrain } from './vehicle_ai.js';
import { Rockets } from './rockets.js';
import { Destruction } from './destruction.js';
import { keyName } from '../engine/input.js';
import { UnitLighting } from '../engine/lighting.js';
import { Lights } from './lights.js';
import { configureRotation, drawRotated } from '../engine/rotsprite.js';

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
  constructor({ config, assets, audio, display, input, effectsCfg, weapons, grenadeTypes, i18n, career, vehicleTypes, rocketTypes, medals = null, debugTools = false }) {
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
    // tasti di debug F4..F9 (arma, vita, granate, squadra, punti di carriera): solo con ?debug=1 o game.json -> debug
    this.debugTools = !!debugTools || !!config.debug;
    this.background = config.display?.background || '#000';

    this.map = null;
    this.weapons = weapons;
    // medaglie del giocatore umano (config/medals.json, collezione salvata) e quelle prese nella partita in corso
    this.medals = medals;
    this.medalsCfg = medals?.cfg || {};
    this.matchMedals = [];
    this.medalState = null;

    // Modalità Capture The Flag: squadre, bandiere, ticket (game.json -> teams / ctf)
    this.teams = config.teams || {};
    this.ctf = null;
    this.playerTeam = null;
    this.grenadeTypes = grenadeTypes;

    this.bullets = [];
    this.grenades = new Grenades(assets, audio);
    this.shake = { time: 0, duration: 0, amount: 0 }; // scossa della camera (esplosioni)
    // segno di colpo a segno del giocatore: { kind: hit|armor|kill, age, life, x, y } (hud.hitMarker)
    this.hitMarker = null;
    this.hitSoundAt = -1;
    this.crosshairGap = null; // apertura del mirino dinamico (px di gioco, smorzata)
    this.effects = new Effects(effectsCfg, assets, audio);
    this.effectsCfg = effectsCfg;
    // decorazioni della mappa (game.json -> props) e meteo del livello (preparati in setup)
    this.props = new Props(config.props, assets);
    this.weather = new Weather(null);
    this.lighting = new UnitLighting(config.lighting); // ombra portata e luce sul bordo dei soldati
    // luci dinamiche (aloni, fuochi, bandiere, fari) e buio dell'ora del giorno
    this.lights = new Lights(config.lights);
    this.effects.lights = this.lights;
    configureRotation(config.display?.rotation); // rotazione di qualità dei soldati (passi, cache)
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
    // ricarica automatica a caricatore vuoto per il giocatore umano (opzione; default game.json -> player.autoReload)
    this.autoReload = !!config.player?.autoReload;
    // soldato personalizzato dal menu (schermata "Soldato"): arma di partenza e nome in classifica
    this.loadout = { weapon: null, name: '' };

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
    // munizioni contate: rifornimento alle bandiere possedute e alla base (game.json -> ammo)
    this.ammoCfg = config.ammo || {};
    this.pickups = new Pickups(this.pickupsCfg, assets, weapons);
    this.pickupOffer = null;

    // Mezzi (config/vehicles.json) con i loro punti di comparsa nella mappa, razzi (weapons.json -> rockets)
    this.vehicleTypes = vehicleTypes;
    this.rocketTypes = rocketTypes;
    this.vehicles = [];
    this.vehicleSpawns = []; // { type, def, team, x, y, angle, vehicle, timer }
    this.vehicleOffer = null; // mezzo su cui il giocatore può salire ora
    this.enteredAt = -1; // quando il giocatore è salito (per mostrare "[E] Scendi" per qualche secondo)
    this.rockets = new Rockets(assets, this.effects, effectsCfg);
    this.engines = new Map(); // mezzo -> suono continuo del motore (audio.loop)

    // squadra del giocatore (game.json -> squad): compagni bot che seguono i suoi ordini; ordine attuale
    this.squadCfg = config.squad || {};
    this.squadOrder = { type: 'follow' };
    // elenco delle uccisioni (HUD): { killer, kTeam, victim, vTeam, how, mine, age }
    this.killFeed = [];
    // schermata di rientro (DOM, menu.js): aperta/chiusa con questi callback quando il giocatore muore/rientra
    this.onDeployOpen = null;
    this.onDeployClose = null;

    this._fps = { value: 0, frames: 0, time: 0 };
  }

  /**
   * Prepara una partita: level = JSON del livello, team = squadra del giocatore,
   * allies / enemies = bot compagni / avversari, attract = partita dimostrativa (tutti bot, niente HUD né audio).
   */
  setup({ level, team, allies = 0, enemies = 4, tickets = null, timeLimit = null, timeOfDay = null, attract = false }) {
    this.level = level;
    // ora del giorno (game.json -> lights.times): dal menu, altrimenti quella del livello, altrimenti il default
    this.lights.setTime(timeOfDay || level.timeOfDay || this.config.lights?.default || null);
    this.map = new TileMap(level, this.assets.tileset(level.tileset));
    // tickets (opzionale, dal menu) = ticket iniziali di ogni squadra al posto di ctf.tickets (vale anche per la rivincita);
    // timeLimit (s, dal menu; 0 = nessun limite, null = ctf.timeLimit)
    const ctfCfg = { ...this.config.ctf };
    if (tickets > 0) ctfCfg.tickets = Math.round(tickets);
    if (timeLimit !== null && timeLimit !== undefined) ctfCfg.timeLimit = Math.max(0, Number(timeLimit) || 0);
    this.ctf = new Ctf(ctfCfg, this.teams, this.map, level);
    // decorazioni e meteo del livello (level.weather = tipo in effects.json -> weather)
    this.props.reset(this.map);
    this.weather = new Weather(level.weather ? this.effectsCfg.weather?.[level.weather] : null);
    if (level.weather && !this.weather.active) console.warn(`Level weather "${level.weather}" not found in effects.json`);
    this.effects.wind = this.weather.active ? this.weather.wind : null;
    this.background = level.background || this.config.display?.background || '#000';
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
    // mappa intatta a ogni partita (i tile distrutti tornano alla rivincita)
    this.map.reset();
    this.nav.refresh();
    const dc = this.config.destruction || {};
    this.destruction = new Destruction({ ...dc, enabled: dc.enabled !== false && this.level.destructible !== false }, this.map, this.nav,
      (tx, ty, material, x, y) => this._onTileBreak(tx, ty, material, x, y));
    this.ctf.reset();
    this.squads = {};
    for (const t of this.ctf.teamIds) this.squads[t] = new Squad(t);
    this.playerBrain = null;
    this._resetScores();
    const base = this.ctf.spawnPoint(this.playerTeam, null);
    this._spawnPlayer(base.x, base.y);
    this.hud = new Hud(this.config.hud, this.i18n, this.assets);
    this.hitMarker = null;
    this.bullets.length = 0;
    this.grenades.clear();
    this.shake.time = 0;
    this.effects.clear();
    this.lights.clear();
    this.corpses.length = 0;
    this.pickups.reset(this.map);
    this.pickupOffer = null;
    this.rockets.clear();
    this._silenceEngines();
    this._resetVehicles();
    if (this.respawn) this.onDeployClose?.();
    this.respawn = null; // { time, delay, x, y, choice, confirmed } mentre il giocatore è morto
    this.ended = null; // { time, shown, outcome } a partita finita
    this.squadOrder = { type: 'follow' };
    this.killFeed = [];
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
    this.matchMedals = [];
    this.medalState = { anyKill: false, chain: 0, lastKill: -1e9, streak: 0, lastKiller: null, counts: {}, given: new Set() };
    this.playerRecord = this.scores.add({
      name: this.attract ? this._nextBotName() : this.loadout.name || this.i18n.t('scoreboard.you'),
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
    if (type === 'medal') return this._careerPoints(n);
    this._medalCount(type);
    this.hud.popup(`+${n} ${this.i18n.t(`score.events.${type}`)}`, c.popupColors?.[type]);
    if (type === 'kill' && c.killSound) this.audio.play(c.killSound);
    this._careerPoints(n);
  }

  /** Punti di carriera del giocatore: salvati subito, con le eventuali promozioni (fascia + suono). */
  _careerPoints(n) {
    const c = this.scoringCfg;
    const rec = this.playerRecord;
    for (const i of this.career.add(n)) {
      rec.rank = i;
      const rank = this.ranks.get(i);
      this.hud.promote({ name: this.i18n.t(`ranks.${rank.id}.name`), insignia: this.ranks.insignia(i) });
      if (c.promotionSound) this.audio.play(c.promotionSound);
    }
  }

  // ---------- Medaglie (config/medals.json, solo per il giocatore umano) ----------

  /** Un soldato è appena morto: uccisioni del giocatore (serie, causa, distanza, vendetta) o sua morte. */
  _medalsOnDeath(victim) {
    const st = this.medalState;
    if (this.attract || !this.medals || !st) return;
    const k = victim.killer;
    const isPlayer = (u) => u && u === this.player;
    const enemyKill = k && k !== victim && k.team !== victim.team;
    if (enemyKill && !st.anyKill && isPlayer(k)) this._medalTrigger('first');
    if (enemyKill) st.anyKill = true;
    if (victim === this.player) {
      // morto: la serie riparte, ci si ricorda di chi ci ha ucciso (per la vendetta)
      st.streak = 0;
      st.chain = 0;
      st.lastKiller = enemyKill ? k.combatant : null;
      return;
    }
    if (!enemyKill || !isPlayer(k)) return;
    const cause = victim.killCause || {};
    st.chain = this.time - st.lastKill <= (this.medalsCfg.chainWindow ?? 4) ? st.chain + 1 : 1;
    st.lastKill = this.time;
    st.streak++;
    this._medalTrigger('chain', st.chain);
    this._medalTrigger('streak', st.streak);
    if (cause.cause) this._medalTrigger('cause', cause.cause);
    if (cause.cause === 'bullet') this._medalTrigger('distance', Math.hypot(victim.x - (cause.x ?? k.x), victim.y - (cause.y ?? k.y)));
    if (st.lastKiller && victim.combatant === st.lastKiller) {
      st.lastKiller = null;
      this._medalTrigger('revenge');
    }
  }

  /** Conteggi di partita (difese, catture) per le medaglie "count". */
  _medalCount(type) {
    const st = this.medalState;
    if (!st) return;
    st.counts[type] = (st.counts[type] || 0) + 1;
    this._medalTrigger('count', type);
  }

  /** Assegna le medaglie il cui trigger corrisponde all'evento (kind, valore). */
  _medalTrigger(kind, value = true) {
    const st = this.medalState;
    if (this.attract || !this.medals || !st) return;
    for (const def of this.medals.list) {
      const t = def.trigger || {};
      let ok = false;
      if (kind === 'first') ok = !!t.first;
      else if (kind === 'chain') ok = t.chain === value;
      else if (kind === 'streak') ok = t.streak === value;
      else if (kind === 'cause') ok = t.cause === value;
      else if (kind === 'distance') ok = t.distance > 0 && value >= t.distance;
      else if (kind === 'revenge') ok = !!t.revenge;
      else if (kind === 'vehicle') ok = !!t.vehicle;
      else if (kind === 'count') ok = t.count === value && (st.counts[value] || 0) === (t.n ?? 1);
      else if (kind === 'end') ok = t.end === value;
      if (ok) this._awardMedal(def);
    }
  }

  /** Medaglia presa: collezione, fascia sull'HUD, suono, punti in classifica e carriera. */
  _awardMedal(def) {
    this.medals.add(def.id);
    this.matchMedals.push(def.id);
    const n = def.points ?? 0;
    this.hud.promote({
      title: this.i18n.t('hud.medal'),
      name: this.i18n.t(`medals.${def.id}.name`),
      insignia: this.medals.icon(def.id),
      sub: n ? `+${n}` : '',
      time: this.medalsCfg.bannerTime ?? 2.6,
      medal: true,
    });
    if (this.medalsCfg.sound) this.audio.play(this.medalsCfg.sound);
    if (n) {
      this.playerRecord.score += n;
      this._onAward(this.playerRecord, 'medal', n);
    }
  }

  /** Riepilogo per la schermata di fine partita (Menu). */
  get matchSummary() {
    return {
      ranking: this.scores.ranking(),
      player: this.playerRecord,
      xpBefore: this.matchStartXp,
      xpAfter: this.career.xp,
      medals: [...this.matchMedals],
    };
  }

  /** Soldato del giocatore dal menu: { weapon (id con "loadout" in weapons.json), name } (vale dalla prossima partita). */
  setLoadout({ weapon = null, name = '' } = {}) {
    const ok = weapon && this.weapons.has(weapon) && this.weapons.get(weapon).loadout;
    this.loadout = { weapon: ok ? weapon : null, name: String(name || '').trim() };
  }

  _spawnPlayer(x, y) {
    // arma di partenza scelta nel menu (non nella partita dimostrativa)
    const w = !this.attract && this.loadout.weapon;
    const cfg = w ? { ...this.config.player, weapon: w } : this.config.player;
    this.player = new Player(cfg, x, y, this.assets, this.weapons, this.grenadeTypes, this.playerTeam);
    this.player.combatant = this.playerRecord;
    this.player.autoReloadEmpty = this.autoReload && !this.attract;
    this.squads[this.playerTeam]?.replan(); // la squadra segue il nuovo soldato del giocatore
    if (!this.attract) {
      // colpi a segno (segno sul mirino + suono) e colpi subiti (indicatore della direzione)
      this.player.onDealt = (target, dealt, killed) => this._onPlayerHit(target, killed);
      this.player.onHurt = (dealt, source) => this._onPlayerHurt(dealt, source);
      return;
    }
    // partita dimostrativa: il giocatore è guidato da un BotBrain come gli altri soldati
    this.player.isBot = true;
    const squad = this.squads[this.playerTeam];
    const brain = new BotBrain(this.player, squad, this.aiCfg);
    brain.time = this.time; // orologio = tempo di gioco (anche prima del primo think)
    const i = squad.brains.indexOf(this.playerBrain);
    if (i >= 0) squad.brains[i] = brain;
    else squad.brains.push(brain);
    this.playerBrain = brain;
  }

  /** Opzione "ricarica automatica" (dal menu): vale subito anche per il soldato in campo. */
  setAutoReload(on) {
    this.autoReload = !!on;
    if (this.player) this.player.autoReloadEmpty = this.autoReload && !this.attract;
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
    const weapons = (this.botsCfg.weapons || [this.config.player.weapon]).filter((id) => {
      const ok = String(id).split('+').every((w) => this.weapons.has(w));
      if (!ok) console.warn(`bots.weapons: unknown weapon in "${id}"`);
      return ok;
    });
    for (const [team, count] of Object.entries(teams)) {
      if (!this.squads[team]) {
        console.warn(`bots.teams: unknown team "${team}"`);
        continue;
      }
      for (let i = 0; i < count; i++) {
        const slot = { team, weapon: weapons[i % weapons.length] || this.config.player.weapon, unit: null, brain: null, respawn: null };
        // i primi compagni del giocatore umano formano la sua squadra (squad.size, lui compreso)
        slot.playerSquad = !this.attract && team === this.playerTeam && i < (this.squadCfg.size ?? 4) - 1;
        slot.record = this.scores.add({ name: this._nextBotName(), team, rank: this._botRank() });
        this.bots.push(slot);
        this._spawnBot(slot, null);
      }
    }
  }

  /** (Ri)crea il soldato del bot "slot": su una bandiera della squadra se ce n'è una, altrimenti alla base. */
  _spawnBot(slot, near) {
    // bots.weapons: "rifle" oppure "rifle+launcher" (arma principale + arma speciale nella fondina)
    const [primary, special] = String(slot.weapon).split('+');
    const cfg = { ...this.config.player, ...(this.botsCfg.player || {}), weapon: primary };
    const hw = (cfg.hitbox?.[0] ?? 10) / 2;
    const hh = (cfg.hitbox?.[1] ?? 10) / 2;
    // all'inizio (near = null) nessun controllo dei nemici: si parte dalle proprie bandiere
    const enemies = near ? this._enemiesOf(slot.team) : null;
    const pos = this.ctf.spawnPoint(slot.team, near, hw, hh, { preferFlags: true, spread: this.botsCfg.baseSpread || [6, 22], enemies });
    const unit = new Player(cfg, pos.x, pos.y, this.assets, this.weapons, this.grenadeTypes, slot.team);
    unit.isBot = true;
    unit.combatant = slot.record;
    unit.playerSquad = !!slot.playerSquad;
    const extra = special && this.weapons.has(special) ? special : this._antiArmorFor(slot);
    if (extra) unit.giveSpecial(extra);
    // guarda verso il centro della mappa
    unit.angle = Math.atan2(this.map.pixelHeight / 2 - pos.y, this.map.pixelWidth / 2 - pos.x);
    unit.legsAngle = unit.angle;
    const squad = this.squads[slot.team];
    const brain = new BotBrain(unit, squad, this.aiCfg);
    brain.time = this.time; // orologio = tempo di gioco (anche prima del primo think)
    const i = squad.brains.indexOf(slot.brain);
    if (i >= 0) squad.brains[i] = brain;
    else squad.brains.push(brain);
    slot.unit = unit;
    slot.brain = brain;
    slot.respawn = null;
  }

  /**
   * Anticarro garantito (bots.ensureAntiArmor = { weapon, min }): sulle mappe con mezzi, se nella squadra di "slot" i bot
   * con un'arma anticarro sono meno di "min", il bot che (ri)entra riceve "weapon" come arma speciale. Così anche
   * con pochi bot (le armi a rotazione di bots.weapons danno il lanciarazzi solo al quarto) qualcuno può
   * fermare i mezzi nemici.
   */
  _antiArmorFor(slot) {
    const a = this.botsCfg.ensureAntiArmor;
    if (!a?.weapon || !this.weapons.has(a.weapon) || !this.vehicleSpawns?.length) return null;
    // mezzi che la squadra avversaria può guidare: suoi o neutrali
    if (!this.vehicleSpawns.some((s) => s.team !== slot.team)) return null;
    let have = 0;
    for (const b of this.bots) {
      if (b === slot || b.team !== slot.team) continue;
      const u = b.unit;
      if (u && !u.dead ? u.hasAntiVehicle : String(b.weapon).includes('+')) have++;
    }
    return have < (a.min ?? 1) ? a.weapon : null;
  }

  _updateBots(dt) {
    // tile distrutti: chi si riparava lì dietro cerca un altro riparo
    const broken = this.destruction?.takeChanged();
    if (broken?.length) {
      for (const s of Object.values(this.squads)) for (const b of s.brains) b.onMapChanged?.(broken, this.map.size);
    }
    // piano di squadra: coppie/terzetti distribuiti sulle bandiere (letto da BotBrain._chooseObjective)
    // e piano anticarro (chi va a prendere un lanciarazzi, chi va a caccia dei mezzi nemici)
    for (const s of Object.values(this.squads)) {
      s.plan(this, this.aiCfg, dt);
      s.armor(this, this.aiCfg, dt);
    }
    for (const b of this.bots) {
      if (!b.unit.dead) {
        const u = b.unit;
        if (u.vehicle) {
          // alla guida: comanda il mezzo con la sua IA di guida
          u.vehicle.update(dt, this, u.vehicleBrain.think(dt, this));
          this._syncDriver(u.vehicle);
          continue;
        }
        u.update(dt, this, b.brain.think(dt, this));
        if (b.brain.enterNow) {
          this._enterVehicle(u, b.brain.enterNow);
          b.brain.enterNow = null;
        }
        continue;
      }
      if (!b.respawn) {
        // appena morto: punti, cadavere, ticket in meno, conto alla rovescia
        this._medalsOnDeath(b.unit);
        this.scores.onDeath(b.unit, this.ctf);
        this._feedDeath(b.unit);
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
    const move = input.getMove();
    // corsa: tasto (Maiusc) o, su touch, stick sinistro spinto fino in fondo (input.touch.sprintThreshold)
    const sprint = input.isDown('sprint')
      || (input.mode === 'touch' && Math.hypot(move.x, move.y) >= (this.config.input?.touch?.sprintThreshold ?? 0.97));
    return {
      move,
      sprint,
      aim: (u) => input.getAim(u.x - Math.round(camera.x), u.y - Math.round(camera.y)),
      firing: input.isFiring(),
      reload: input.wasPressed('reload'),
      grenade: input.wasPressed('grenade'),
      switchWeapon: input.wasPressed('switchWeapon'),
      repeat: input.mode === 'touch' && input.touchHoldToRepeat,
      faceMove: input.mode === 'touch',
    };
  }

  /** Giocatore: a piedi (Player.update) o alla guida di un mezzo; umano o IA (partita dimostrativa). */
  _updatePlayer(dt) {
    const p = this.player;
    if (p.vehicle && !p.dead) {
      const v = p.vehicle;
      v.update(dt, this, this.playerBrain ? p.vehicleBrain.think(dt, this) : this._humanVehicleControl());
      this._syncDriver(v);
      return;
    }
    const ctrl = this.playerBrain && !p.dead ? this.playerBrain.think(dt, this) : this._humanControl();
    p.update(dt, this, ctrl);
    if (this.playerBrain?.enterNow) {
      this._enterVehicle(p, this.playerBrain.enterNow);
      this.playerBrain.enterNow = null;
    }
  }

  /**
   * Comandi del giocatore umano alla guida: da tastiera drive = acceleratore (avanti/indietro) + sterzo
   * (sinistra/destra); su touch move = direzione sullo schermo. Mira = torretta, fuoco / G = razzi, R.
   */
  _humanVehicleControl() {
    const { input, camera } = this;
    return {
      move: input.getMove(),
      drive: input.getDrive(),
      aim: (v) => {
        const p = v.pivot;
        return input.getAim(p.x - Math.round(camera.x), p.y - Math.round(camera.y));
      },
      firing: input.isFiring(),
      secondary: input.isDown('grenade') || input.wasPressed('grenade'),
      reload: input.wasPressed('reload'),
    };
  }

  // ---------- Mezzi ----------

  /** Nuova partita: un mezzo su ogni punto di comparsa della mappa. */
  _resetVehicles() {
    this.vehicles = [];
    this.vehicleOffer = null;
    this.vehicleSpawns = [];
    for (const s of this.map.vehicles || []) {
      if (!this.vehicleTypes?.has(s.type)) {
        console.warn(`Level vehicle: unknown type "${s.type}" (vehicles.json)`);
        continue;
      }
      const spawn = { ...s, def: this.vehicleTypes.get(s.type), vehicle: null, timer: 0 };
      this.vehicleSpawns.push(spawn);
      this._spawnVehicle(spawn);
    }
  }

  _spawnVehicle(s) {
    const v = new Vehicle(s.def, s.x, s.y, s.angle, s.team, this.assets, this.weapons, s);
    this.vehicles.push(v);
    s.vehicle = v;
    s.timer = 0;
  }

  /** Mezzi senza pilota, distruzioni, urti con soldati e altri mezzi, carcasse, rientri. */
  _updateVehicles(dt) {
    for (const v of this.vehicles) if (!v.driver || v.destroyed) v.update(dt, this, null);
    for (const v of this.vehicles) if (!v.destroyed && v.health <= 0) this._destroyVehicle(v);
    // elicottero atterrato su richiesta del pilota: scende
    for (const v of this.vehicles) if (v.exitOnLand && v.driver && v.grounded) this._exitVehicle(v.driver);
    this._vehicleContacts();
    // punti di comparsa: nuovo mezzo "respawn" secondi dopo la distruzione (o l'abbandono lontano dalla base)
    for (const s of this.vehicleSpawns) {
      const v = s.vehicle;
      if (v && !v.destroyed && !v.removed && !v.driver && v.idle >= (s.def.abandonTime ?? 60) && Math.hypot(v.x - s.x, v.y - s.y) > 48) {
        v.removed = true;
      }
      if (v && !v.destroyed && !v.removed) continue;
      if ((s.timer += dt) < (s.def.respawn ?? 30)) continue;
      const busy = this.units.some((u) => !u.dead && Math.hypot(u.x - s.x, u.y - s.y) < 24)
        || this.vehicles.some((o) => !o.destroyed && !o.removed && Math.hypot(o.x - s.x, o.y - s.y) < 24);
      if (!busy) this._spawnVehicle(s);
    }
    this.vehicles = this.vehicles.filter((v) => !v.removed);
  }

  /** Il pilota segue il mezzo (posizione, mira = torretta, velocità per l'IA avversaria). */
  _syncDriver(v) {
    const u = v.driver;
    if (!u) return;
    u.x = v.x;
    u.y = v.y;
    u.angle = v.turret;
    u.vx = v.vx;
    u.vy = v.vy;
  }

  /** Il soldato u sale sul mezzo v (se libero e vicino). */
  _enterVehicle(u, v) {
    if (!v || v.driver || v.destroyed || u.dead || u.vehicle || !v.grounded) return false;
    if (Math.hypot(u.x - v.x, u.y - v.y) > v.enterReach + 4) return false;
    u.reload?.sound?.stop();
    u.reload = null;
    v.enter(u);
    if (u.isBot) {
      const squad = this.squads[u.team];
      u.vehicleBrain = new VehicleBrain(v, u, squad, this.aiCfg.vehicle || {});
    }
    if (u === this.player) this.enteredAt = this.time;
    if (v.def.enterSound) this.audio.play(v.def.enterSound, v);
    this._syncDriver(v);
    return true;
  }

  /**
   * Il soldato scende accanto al mezzo (un lato libero dai muri e dagli altri mezzi). Elicottero in volo:
   * prima atterra (v.landing; ripremendo si annulla), il pilota scende da solo appena tocca terra.
   */
  _exitVehicle(u) {
    const v = u.vehicle;
    if (!v) return;
    if (!v.grounded) {
      v.landing = !v.landing;
      v.exitOnLand = v.landing;
      return;
    }
    v.landing = false;
    v.exitOnLand = false;
    const c = Math.cos(v.angle);
    const s = Math.sin(v.angle);
    const out = Math.max(v.hw, v.hh) + u.hw + 3;
    let spot = { x: v.x, y: v.y };
    for (const [fx, fy] of [[0, 1], [0, -1], [-1, 0], [1, 0], [-1, 1], [-1, -1]]) {
      const x = v.x + (c * fx - s * fy) * out;
      const y = v.y + (s * fx + c * fy) * out;
      if (this.map.rectHitsSolid(x - u.hw, y - u.hh, u.hw * 2, u.hh * 2)) continue;
      if (this.vehicleAt(x, y, u.hw)) continue;
      spot = { x, y };
      break;
    }
    v.exit();
    u.vehicleBrain = null;
    u.x = spot.x;
    u.y = spot.y;
    if (v.def.exitSound) this.audio.play(v.def.exitSound, v);
  }

  /** Mezzo distrutto: esplosione, muore chi è a bordo, punti a chi l'ha distrutto, resta la carcassa. */
  _destroyVehicle(v) {
    v.destroyed = true;
    v.wreckAge = 0;
    const by = v.lastHitBy;
    const d = v.def;
    if (v.driver) {
      const u = v.exit();
      u.vehicleBrain = null;
      u.x = v.x;
      u.y = v.y;
      u.damage(1e6, { unit: by, x: by?.x ?? v.x, y: by?.y ?? v.y, cause: 'vehicle' });
    }
    if (by && by.team !== v.team && by.combatant) this.scores.award(by.combatant, 'vehicle');
    if (by && by === this.player && by.team !== v.team) this._medalTrigger('vehicle');
    this.explode({ ...(d.blast || {}), explosion: d.explosion, shake: d.shake }, v.x, v.y, by, v, 'vehicle');
  }

  /**
   * Urti: i soldati a piedi vengono spinti fuori dai mezzi (o investiti, se nemici e il mezzo corre);
   * due mezzi che si toccano si separano e rallentano.
   */
  _vehicleContacts() {
    // un elicottero in volo non urta niente (solo gli altri elicotteri in volo)
    const live = this.vehicles.filter((v) => !v.destroyed);
    for (const v of live) {
      if (v.high) continue;
      const run = v.def.runover || {};
      for (const u of this.units) {
        if (u.dead || u.vehicle) continue;
        const ox = v.hw + u.hw - Math.abs(u.x - v.x);
        const oy = v.hh + u.hh - Math.abs(u.y - v.y);
        if (ox <= 0 || oy <= 0) continue;
        if (v.driver && u.team !== v.team && Math.abs(v.speed) >= (run.minSpeed ?? 45)) {
          u.damage(run.damage ?? 200, { unit: v.driver, x: v.x, y: v.y, cause: 'runover' });
          if (u.dead) {
            this.effects.impact(this.combat.hitImpact || 'flesh', u.x, u.y);
            continue;
          }
        }
        const dx = ox < oy ? ox * Math.sign(u.x - v.x || 1) : 0;
        const dy = ox < oy ? 0 : oy * Math.sign(u.y - v.y || 1);
        const p = this.map.moveAndCollide(u.x, u.y, u.hw, u.hh, dx, dy);
        u.x = p.x;
        u.y = p.y;
      }
    }
    for (let i = 0; i < live.length; i++) {
      for (let j = i + 1; j < live.length; j++) {
        const a = live[i];
        const b = live[j];
        if (a.high !== b.high) continue;
        const ox = a.hw + b.hw - Math.abs(a.x - b.x);
        const oy = a.hh + b.hh - Math.abs(a.y - b.y);
        if (ox <= 0 || oy <= 0) continue;
        const sx = ox < oy ? (ox / 2) * Math.sign(a.x - b.x || 1) : 0;
        const sy = ox < oy ? 0 : (oy / 2) * Math.sign(a.y - b.y || 1);
        for (const [v, k] of [[a, 1], [b, -1]]) {
          if (v.airborne) {
            v.x += sx * k;
            v.y += sy * k;
          } else {
            const p = this.map.moveAndCollide(v.x, v.y, v.hw, v.hh, sx * k, sy * k);
            v.x = p.x;
            v.y = p.y;
          }
          v.speed *= 0.6;
          if (v.driver) this._syncDriver(v);
        }
      }
    }
  }

  /** Mezzo (non distrutto) che contiene il punto (x, y) con margine pad, escluso "exclude". */
  vehicleAt(x, y, pad = 0, exclude = null) {
    for (const v of this.vehicles) {
      if (v.destroyed || v === exclude) continue;
      if (Math.abs(x - v.x) <= v.hw + pad && Math.abs(y - v.y) <= v.hh + pad) return v;
    }
    return null;
  }

  /** Soldato a piedi colpibile da un colpo della squadra "team" nel punto (x, y). */
  soldierAt(x, y, team, owner) {
    const pad = this.combat.hitPadding ?? 1;
    const ff = !!this.combat.friendlyFire;
    for (const u of this.units) {
      if (u.dead || u.vehicle || u === owner || (!ff && u.team === team)) continue;
      if (Math.abs(x - u.x) <= u.hw + pad && Math.abs(y - u.y) <= u.hh + pad) return u;
    }
    return null;
  }

  /** true se a e b sono la stessa squadra e il fuoco amico è disattivato. */
  sameTeamNoFF(a, b) {
    return !this.combat.friendlyFire && a !== null && a === b;
  }

  /** Il mezzo spara con l'arma "gun" (mitragliatrice: proiettili; lanciarazzi: razzi). */
  fireVehicle(v, gun) {
    const w = gun.w;
    const m = v.muzzleOf(gun);
    const p = v.pivot;
    this.fire({
      weapon: w,
      angle: v.turret,
      muzzle: m,
      x: p.x,
      y: p.y,
      team: v.team,
      aimDistance: v.driver?.isBot ? v.aimDistance : null,
      owner: v.driver,
      fromVehicle: v,
      vx: v.vx,
      vy: v.vy,
    });
    if (w.casing) this.effects.casing(w.casing, p.x, p.y, v.turret, v.vx, v.vy);
  }

  /** Nuova partita (dalla schermata di fine partita). */
  restart() {
    if (!this.canRestart) return;
    this._reset();
    this.onRestart?.();
  }

  /** Toglie la partita (menu con la scena animata al posto della dimostrativa): niente update né disegno. */
  unload() {
    this.running = false;
    this.suspended = false;
    this.attract = false;
    this.ended = null;
    this.map = null;
    if (this.engines.size) this._silenceEngines();
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
        // pausa / dispositivo in verticale: i motori tacciono (ripartono alla ripresa)
        if (this.engines.size) this._silenceEngines();
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
    if (this.debugTools) {
      if (input.wasPressed('debugNextWeapon')) this._cycleWeapon();
      if (input.wasPressed('debugHurt')) this.player.damage(this.config.debugDamage ?? 10);
      if (input.wasPressed('debugHeal')) this.player.heal(this.config.debugDamage ?? 10);
      if (input.wasPressed('debugGrenade')) this.player.addGrenades(1);
      if (input.wasPressed('debugTeam')) this._cycleTeam();
      if (input.wasPressed('debugScore')) this.scores.award(this.playerRecord, 'debug');
    }

    this.time += dt;
    if (!this.ended) {
      this._updatePlayer(dt);
      this._updateBots(dt);
      this._updateVehicles(dt);
      // ordine alla squadra (T / pulsante touch)
      if (!this.attract && !this.player.dead && this.input.wasPressed('squadOrder')) this._issueOrder();
      if (this.player.dead && !this.respawn) this._onPlayerDeath();
      this._updatePickups(dt);
      if (this.respawn) this._updateRespawn(dt);
      // chi pilota un elicottero in volo non conta per le bandiere
      this.ctf.update(dt, this.units.filter((u) => !u.vehicle?.airborne));
      for (const e of this.ctf.takeEvents()) this._onFlagEvent(e);
      if (this.ctf.result) this._endMatch();
    } else {
      this._updateMatchEnd(dt);
    }
    // cadaveri: spariscono dopo death.corpseTime secondi (dissolvenza negli ultimi corpseFade)
    const corpseTime = this.deathCfg.corpseTime ?? 12;
    for (const c of this.corpses) c.time += dt;
    if (corpseTime > 0) this.corpses = this.corpses.filter((c) => c.time < corpseTime);
    const feedLife = this.hud.cfg.killFeed?.life ?? 6;
    for (const k of this.killFeed) k.age += dt;
    if (this.killFeed.length && this.killFeed[0].age >= feedLife) this.killFeed = this.killFeed.filter((k) => k.age < feedLife);
    this.hud.update(dt, this.player);
    if (this.hitMarker && (this.hitMarker.age += dt) >= this.hitMarker.life) this.hitMarker = null;
    if (this.ended) {
      // a partita finita i mezzi si fermano per inerzia
      for (const v of this.vehicles) {
        v.update(dt, this, null);
        if (v.driver) this._syncDriver(v);
      }
    }
    this._updateBullets(dt);
    this.rockets.update(dt, this, (r, x, y, v) => {
      // colpo diretto su un mezzo + esplosione
      if (v) v.damage(r.def.directDamage ?? 0, r.owner);
      this.explode(r.def, x, y, r.owner, null, 'rocket');
    });
    this.grenades.update(dt, this.map, (g) => this.explode(g.def, g.x, g.y, g.owner, null, 'grenade'));
    this.destruction?.flush(); // tile distrutti in questo tick: griglia dei percorsi aggiornata
    this.effects.update(dt, this.map);
    this.lights.update(dt);
    this.shake.time = Math.max(0, this.shake.time - dt);

    this.camera.follow(this.player.x - this.viewOffsetX, this.player.y, this.player.angle, display.width, display.height, this.map, dt);
    this.props.update(dt, this.attract ? null : this.player);
    this.weather.update(dt, { x: this.camera.x, y: this.camera.y, w: display.width, h: display.height });
    // ascoltatore dei suoni posizionali = centro della visuale
    this.audio.listener = { x: this.camera.x + display.width / 2, y: this.camera.y + display.height / 2 };
    this._updateEngines();
    input.endFrame();
  }

  /**
   * Rumore dei motori: acceso per i mezzi con un pilota e abbastanza vicini da sentirsi (def.engineSound),
   * con il regime che segue la velocità; spento per gli altri.
   */
  _updateEngines() {
    const want = new Set();
    if (!this.attract) {
      for (const v of this.vehicles) {
        if (!v.destroyed && v.driver && v.def.engineSound && this.audio.gainAt(v) > 0.01) want.add(v);
      }
    }
    for (const [v, h] of this.engines) {
      if (!want.has(v)) {
        h.stop();
        this.engines.delete(v);
      }
    }
    for (const v of want) {
      let h = this.engines.get(v);
      if (!h) {
        h = this.audio.loop(v.def.engineSound);
        if (!h) continue; // audio non ancora attivo o muto: si riprova al prossimo tick
        this.engines.set(v, h);
      }
      h.set(v.rpm, v);
    }
  }

  _silenceEngines() {
    for (const h of this.engines.values()) h.stop();
    this.engines.clear();
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

  /**
   * Esplosione "def" (granata, razzo, mezzo distrutto) in (x, y) causata da "owner": effetti, scossa della
   * camera, danni. exclude = mezzo da non danneggiare (quello che sta esplodendo).
   */
  explode(def, x, y, owner = null, exclude = null, cause = 'explosion') {
    if (def.explosion) this.effects.explosion(def.explosion, x, y, this.map);
    if (def.shake) {
      this.shake.amount = def.shake.amount ?? 3;
      this.shake.duration = def.shake.time ?? 0.4;
      this.shake.time = this.shake.duration;
    }
    // danno ai soldati a piedi (giocatore e bot, di qualunque squadra): decresce con la distanza
    // fino a minDamageFactor sul bordo, i muri riparano; chi è a bordo di un mezzo è protetto
    const radius = def.blastRadius ?? 40;
    // tile distruttibili (muri, casse, sacchi...): danno × tileFactor del tipo di esplosione (razzi: più alto);
    // le linee di vista per i soldati qui sotto usano ancora la mappa di prima del crollo (il muro ha riparato)
    const blocked = new Set();
    for (const p of this.units) {
      if (!p.dead && !p.vehicle && Math.hypot(p.x - x, p.y - y) < radius && !this._lineOfSight(x, y, p.x, p.y)) blocked.add(p);
    }
    this.destruction?.explosion(x, y, radius, def.damage ?? 80, def.minDamageFactor ?? 0.2, def.tileFactor ?? 1);
    const falloff = (d) => 1 - (d / radius) * (1 - (def.minDamageFactor ?? 0.2));
    for (const p of this.units) {
      const d = Math.hypot(p.x - x, p.y - y);
      if (p.dead || p.vehicle || d >= radius || blocked.has(p)) continue;
      // unit: null = l'IA non "vede" chi l'ha lanciata; by = a chi vanno uccisione e assist
      p.damage(Math.round((def.damage ?? 80) * falloff(d)), { unit: null, x, y, by: owner, cause });
    }
    // mezzi: distanza dal bordo dello scafo, danno × vehicleFactor (granate: ridotto, razzi: pieno)
    const vf = def.vehicleFactor ?? 1;
    if (vf <= 0) return;
    for (const v of this.vehicles) {
      if (v.destroyed || v === exclude) continue;
      const d = Math.max(0, Math.hypot(v.x - x, v.y - y) - Math.max(v.hw, v.hh));
      // elicottero in volo: solo un'esplosione a contatto (razzo che lo colpisce), non quelle a terra
      if (v.airborne && d > 4) continue;
      if (d >= radius || (d > 4 && !this._lineOfSight(x, y, v.x, v.y))) continue;
      v.damage(Math.round((def.damage ?? 80) * falloff(d) * vf), owner);
    }
  }

  /**
   * Un tile è stato distrutto: effetto e suono del materiale (effects.json -> breaks), via i buchi dei proiettili
   * rimasti su quel tile, piccola scossa se vicino alla visuale (muri).
   */
  _onTileBreak(tx, ty, material, x, y) {
    const s = this.map.size;
    this.effects.removeDecalsIn(tx * s, ty * s, s, s);
    const def = this.effectsCfg.breaks?.[material];
    if (def) this.effects.breakTile(def, x, y);
    if (def?.shake && !this.attract) {
      const c = this.camera;
      const near = x > c.x - 40 && y > c.y - 40 && x < c.x + this.display.width + 40 && y < c.y + this.display.height + 40;
      if (near && this.shake.time <= 0) {
        this.shake.amount = def.shake.amount ?? 1;
        this.shake.duration = def.shake.time ?? 0.2;
        this.shake.time = this.shake.duration;
      }
    }
  }

  /** true se il segmento (x0,y0)-(x1,y1) non attraversa tile solidi (passi da 2 px). */
  _lineOfSight(x0, y0, x1, y1) {
    const n = Math.ceil(Math.hypot(x1 - x0, y1 - y0) / 2);
    for (let i = 1; i < n; i++) {
      const t = i / n;
      if (this.map.blocksShotAt(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t)) return false;
    }
    return true;
  }

  // ---------- Morte, rientro e fine partita ----------

  /** Il giocatore è appena morto: cadavere a terra, ticket in meno, conto alla rovescia per il rientro. */
  _onPlayerDeath() {
    const p = this.player;
    this._medalsOnDeath(p);
    this.scores.onDeath(p, this.ctf);
    this._feedDeath(p);
    this._addCorpse(p);
    this.ctf.onDeath(p.team);
    this.squads[this.playerTeam]?.replan(); // senza capo la squadra torna al piano di squadra
    const k = p.killer && p.killer !== p ? p.killer : null;
    this.respawn = {
      time: 0, delay: this.deathCfg.respawnDelay ?? 5, x: p.x, y: p.y,
      killer: k?.combatant?.name ?? null, how: this._killHow(p),
      choice: null, confirmed: false,
    };
    this.respawn.choice = this._defaultDeploy();
    // schermata di rientro (giocatore umano): scelta del punto; senza schermata si rientra da soli
    if (!this.attract) this.onDeployOpen?.();
  }

  // ---------- Schermata di rientro ----------

  /**
   * Punti di rientro per il giocatore: base, bandiere possedute (non contese e senza nemici entro
   * ctf.spawnSafeRadius), compagni di squadra vivi a piedi e non in combattimento.
   * [{ id, kind: 'base'|'flag'|'mate', label, x, y, ok, reason }] (reason = chiave i18n se non disponibile).
   */
  deployOptions() {
    const team = this.playerTeam;
    const ctf = this.ctf;
    const enemies = this._enemiesOf(team);
    const R = ctf.cfg.spawnSafeRadius ?? 0;
    const out = [];
    const base = ctf.bases[team];
    if (base) out.push({ id: 'base', kind: 'base', label: this.i18n.t('deploy.base'), x: base.x, y: base.y, ok: true });
    for (const f of ctf.flags) {
      if (f.owner !== team) continue;
      let reason = null;
      if (Object.keys(f.present).some((t) => t !== team)) reason = 'deploy.contested';
      else if (R > 0 && enemies.some((e) => Math.hypot(e.x - f.x, e.y - f.y) < R)) reason = 'deploy.enemiesNear';
      out.push({ id: `flag:${f.id}`, kind: 'flag', label: this.i18n.t('deploy.flag', { flag: f.id }), x: f.x, y: f.y, ok: !reason, reason, flag: f });
    }
    for (const b of this.bots) {
      if (!b.playerSquad) continue;
      const u = b.unit;
      let reason = null;
      if (!u || u.dead) reason = 'deploy.mateDead';
      else if (u.vehicle) reason = 'deploy.mateInVehicle';
      else if ((b.brain?.target && b.brain.visible) || (u.suppression ?? 0) > 0.3) reason = 'deploy.mateFighting';
      out.push({ id: `mate:${b.record.id}`, kind: 'mate', label: b.record.name, x: u?.x ?? 0, y: u?.y ?? 0, ok: !reason, reason, unit: u });
    }
    return out;
  }

  /** Punto di rientro predefinito: la bandiera disponibile più vicina al punto della morte, o la base. */
  _defaultDeploy() {
    const r = this.respawn;
    let best = 'base';
    let bestD = Infinity;
    for (const o of this.deployOptions()) {
      if (!o.ok || o.kind === 'mate') continue;
      const d = r ? Math.hypot(o.x - r.x, o.y - r.y) : 0;
      if (d < bestD) {
        bestD = d;
        best = o.id;
      }
    }
    return best;
  }

  /** Scelta dalla schermata di rientro: punto "id" (confirm = rientra appena possibile). */
  chooseDeploy(id, confirm = false) {
    const r = this.respawn;
    if (!r) return;
    r.choice = id;
    if (confirm) r.confirmed = true;
  }

  /** Secondi al rientro (0 = si può già rientrare), null se il giocatore è vivo. */
  get deployWait() {
    const r = this.respawn;
    return r ? Math.max(0, r.delay - r.time) : null;
  }

  /** Posizione di rientro per l'opzione "id" (se ancora disponibile), altrimenti null. */
  _deployPoint(id) {
    const o = this.deployOptions().find((x) => x.id === id && x.ok);
    if (!o) return null;
    const p = this.player;
    if (o.kind === 'base') return { x: o.x, y: o.y };
    if (o.kind === 'flag') return this.ctf._freePoint(o.flag, o.flag.spawnDistance, p.hw, p.hh);
    return this.ctf._freePoint(o.unit, this.squadCfg.spawnDistance || [10, 20], p.hw, p.hh);
  }

  // ---------- Squadra del giocatore ----------

  /**
   * Ordine alla squadra (azione squadOrder): su desktop la bandiera sotto il mirino, su touch la più vicina al
   * giocatore; ripetuto sulla stessa bandiera (o senza bandiera) = "seguitemi".
   */
  _issueOrder() {
    if (!this.bots.some((b) => b.playerSquad)) return;
    const { input, player } = this;
    let target = null;
    if (input.mode === 'desktop' && input.mouse.seen) {
      const mx = input.mouseGame.x + Math.round(this.camera.x);
      const my = input.mouseGame.y + Math.round(this.camera.y);
      let bestD = Infinity;
      for (const f of this.ctf.flags) {
        const d = Math.hypot(f.x - mx, f.y - my);
        if (d < f.radius + (this.squadCfg.orderPick ?? 24) && d < bestD) {
          bestD = d;
          target = f;
        }
      }
    } else {
      let bestD = Infinity;
      for (const f of this.ctf.flags) {
        const d = Math.hypot(f.x - player.x, f.y - player.y);
        if (d < bestD) {
          bestD = d;
          target = f;
        }
      }
    }
    const o = this.squadOrder;
    if (target && !(o.type === 'flag' && o.flag === target)) this.squadOrder = { type: 'flag', flag: target };
    else this.squadOrder = { type: 'follow' };
    this.squads[this.playerTeam]?.replan();
    this.hud.notify(this._orderText(), this.squadCfg.color);
    if (this.squadCfg.orderSound) this.audio.play(this.squadCfg.orderSound);
  }

  /** Testo dell'ordine attuale: "Squadra: seguitemi" / "attaccate B" / "difendete B". */
  _orderText() {
    const o = this.squadOrder;
    if (o.type !== 'flag') return this.i18n.t('squad.follow');
    const key = o.flag.owner === this.playerTeam && o.flag.progress >= 1 ? 'squad.defend' : 'squad.attack';
    return this.i18n.t(key, { flag: o.flag.id });
  }

  // ---------- Elenco delle uccisioni ----------

  /** Il soldato "victim" è morto: riga dell'elenco (chi, con cosa, chi). */
  _feedDeath(victim) {
    if (this.attract) return;
    const k = victim.killer && victim.killer !== victim ? victim.killer : null;
    const fc = this.hud?.cfg?.killFeed || {};
    this.killFeed.push({
      killer: k?.combatant?.name ?? null,
      kTeam: k?.team ?? null,
      victim: victim.combatant?.name ?? '?',
      vTeam: victim.team,
      how: this._killHow(victim),
      mine: victim === this.player || k === this.player,
      age: 0,
    });
    while (this.killFeed.length > (fc.max ?? 5)) this.killFeed.shift();
  }

  /** Come è morto "victim" (testo breve): arma, granata, razzo, mezzo, investito... */
  _killHow(victim) {
    const c = victim.killCause || {};
    const k = victim.killer;
    const t = (key) => this.i18n.t(key);
    const wname = (id) => {
      const w = id && this.weapons.has(id) ? this.weapons.get(id) : null;
      return w ? t(w.name || w.id) : '';
    };
    switch (c.cause) {
      case 'bullet': {
        const w = c.weapon && this.weapons.has(c.weapon) ? this.weapons.get(c.weapon) : null;
        // armi del mezzo: il nome del mezzo
        if (w?.vehicleOnly && k?.vehicle) return t(k.vehicle.def.name || 'killfeed.vehicle');
        return wname(c.weapon);
      }
      case 'grenade':
        return t('killfeed.grenade');
      case 'rocket':
        return k?.vehicle ? t(k.vehicle.def.name || 'killfeed.rocket') : t('killfeed.rocket');
      case 'runover':
        return t('killfeed.runover');
      case 'vehicle':
        return t('killfeed.vehicle');
      default:
        return c.cause ? t('killfeed.explosion') : '';
    }
  }

  _addCorpse(p) {
    this.corpses.push(this._makeCorpse(p));
    const max = this.deathCfg.maxCorpses ?? 12;
    while (this.corpses.length > max) this.corpses.shift();
  }

  /** Soldati nemici di "team" vivi (anche a bordo dei mezzi): posizioni per scegliere un rientro sicuro. */
  _enemiesOf(team) {
    return this.units.filter((u) => u && !u.dead && u.team !== team);
  }

  _updateRespawn(dt) {
    const r = this.respawn;
    r.time += dt;
    if (r.time < r.delay) return;
    // con la schermata di rientro (giocatore umano) si aspetta la conferma; senza (dimostrativa) si rientra da soli
    const ui = !this.attract && this.onDeployOpen;
    if (ui && !r.confirmed) return;
    // punto scelto (se nel frattempo non è più disponibile: il predefinito), altrimenti la regola di sempre
    const p = this.player;
    const pos = (ui && (this._deployPoint(r.choice) || this._deployPoint(this._defaultDeploy())))
      || this.ctf.spawnPoint(this.playerTeam, r, p.hw, p.hh, { enemies: this._enemiesOf(this.playerTeam) });
    this._spawnPlayer(pos.x, pos.y);
    this.respawn = null;
    this.onDeployClose?.();
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
    // posa a caso tra le varianti dello sprite, ognuna con i suoi frame di caduta (death.fallTime)
    const back = p.cfg.deadOffset ?? 4;
    const pick = (s) => Math.floor(Math.random() * s.variants) * (s.frameCount / s.variants);
    const body = p.deadSprite
      ? {
          sprite: p.deadSprite,
          x: p.x - Math.cos(a) * back,
          y: p.y - Math.sin(a) * back,
          from: { x: p.x, y: p.y }, // durante la caduta scivola da dov'era in piedi
          angle: a + (Math.random() - 0.5) * 0.5,
          pose: pick(p.deadSprite),
        }
      : null;

    // pozza sotto il corpo (si allarga in poolTime secondi), forma a caso tra le varianti
    const poolSprite = g.poolSprite && this.assets.sprites.get(g.poolSprite);
    const pool = poolSprite
      ? { sprite: poolSprite, x: p.x - Math.cos(a) * back, y: p.y - Math.sin(a) * back, angle: Math.floor(Math.random() * 4) * (Math.PI / 2), first: pick(poolSprite) }
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
      this.pickups.dropWeapon(p.weapon.id, p.ammo, s.x, s.y, a + s.side * (0.8 + Math.random()), p.reserve[p.weapon.id] ?? null);
      // seconda arma (fondina): cade poco più in là
      if (p.holster) {
        const h = p.holster;
        this.pickups.dropWeapon(h.id, h.ammo, s.x + Math.cos(a) * 6, s.y + Math.sin(a) * 6, a + Math.PI / 3, p.reserve[h.id] ?? null);
      }
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
    const mine = (u) => u === this.player && !this.attract;
    this.pickups.update(dt, this.units, {
      grenades: (u, n) => {
        if (this.pickupsCfg.grenadeSound) this.audio.play(this.pickupsCfg.grenadeSound, u);
        if (mine(u)) this.hud.popup(this.i18n.t('pickup.grenades', { count: n }), this.pickupsCfg.popupColor);
      },
      ammo: (u, n) => {
        // munizioni prese da un'arma uguale a terra
        if (this.ammoCfg.sound) this.audio.play(this.ammoCfg.sound, u);
        u.resupplyFlash = this.ammoCfg.flashTime ?? 0.8;
        if (mine(u)) this.hud.popup(this.i18n.t('pickup.ammo', { count: n }), this.pickupsCfg.popupColor);
      },
      box: (u, got) => {
        // cassa di munizioni
        if (this.ammoCfg.sound) this.audio.play(this.ammoCfg.sound, u);
        if (got.rounds > 0) u.resupplyFlash = this.ammoCfg.flashTime ?? 0.8;
        if (!mine(u)) return;
        const key = got.rounds > 0 ? (got.grenades > 0 ? 'pickup.boxBoth' : 'pickup.ammo') : 'pickup.grenades';
        this.hud.popup(this.i18n.t(key, { count: got.rounds || got.grenades, grenades: got.grenades }), this.pickupsCfg.popupColor);
      },
    });
    this._updateResupply(dt);
    const p = this.player;
    // azione "pickup" (E): scendere dal mezzo, salire su un mezzo vicino (precedenza) o raccogliere un'arma
    const pressed = this.input.wasPressed('pickup');
    this.vehicleOffer = null;
    this.pickupOffer = null;
    if (!p.dead && !this.attract) {
      if (p.vehicle) {
        if (pressed) this._exitVehicle(p);
      } else {
        let best = null;
        let bestD = Infinity;
        for (const v of this.vehicles) {
          if (v.destroyed || v.driver || !v.grounded) continue;
          const d = Math.hypot(v.x - p.x, v.y - p.y);
          if (d <= v.enterReach && d < bestD) {
            bestD = d;
            best = v;
          }
        }
        this.vehicleOffer = best;
        if (best) {
          if (pressed) {
            this._enterVehicle(p, best);
            this.vehicleOffer = null;
          }
        } else {
          this.pickupOffer = this.pickups.nearestWeapon(p);
          if (this.pickupOffer && pressed) this._swapWeapon(p, this.pickupOffer);
        }
      }
    }

    // bot (e giocatore della partita dimostrativa) arrivati sull'arma scelta dall'IA
    const r = (this.pickupsCfg.radius ?? 9) + 2;
    const brains = this.bots.map((b) => b.brain);
    if (this.playerBrain) brains.push(this.playerBrain);
    for (const br of brains) {
      const it = br?.pickupNow;
      if (!it) continue;
      br.pickupNow = null;
      const u = br.unit;
      if (it.kind !== 'weapon') continue; // casse e granate si prendono passandoci sopra
      if (u.dead || !this.pickups.list.includes(it) || Math.hypot(u.x - it.x, u.y - it.y) > r) continue;
      this._swapWeapon(u, it);
    }
  }

  // ---------- Rifornimento di munizioni ----------

  /**
   * Punti di rifornimento della squadra: la base (raggio ammo.baseRadius) e, se ammo.flags non è false, le bandiere
   * possedute e non contese (area di cattura). Elenco di { x, y, flag? }.
   */
  resupplyPoints(team) {
    const c = this.ammoCfg;
    if (c.resupply === false || !this.ctf) return [];
    const list = [];
    const base = this.ctf.bases[team];
    if (base) list.push({ x: base.x, y: base.y, flag: null });
    if (c.flags !== false) {
      for (const f of this.ctf.flags) if (f.owner === team && !f.contested) list.push({ x: f.x, y: f.y, flag: f });
    }
    return list;
  }

  /** L'unità è in un punto di rifornimento della sua squadra. */
  inResupply(u) {
    for (const p of this.resupplyPoints(u.team)) {
      if (p.flag ? this.ctf.inZone(p.flag, u.x, u.y) : Math.hypot(u.x - p.x, u.y - p.y) <= (this.ammoCfg.baseRadius ?? 48)) return true;
    }
    return false;
  }

  /**
   * Soldati a piedi in un punto di rifornimento: ogni ammo.interval s ogni arma che portano riceve "resupply" colpi
   * (weapons.json, default un caricatore) fino al massimo; ogni ammo.grenadeEvery rifornimenti anche una granata.
   */
  _updateResupply(dt) {
    const c = this.ammoCfg;
    const interval = c.interval ?? 2.5;
    for (const u of this.units) {
      if (u.resupplyFlash > 0) u.resupplyFlash = Math.max(0, u.resupplyFlash - dt);
      if (u.dead || u.vehicle || interval <= 0 || !this.inResupply(u)) {
        u.resupplyTimer = 0;
        u.resupplying = false;
        continue;
      }
      u.resupplyTimer = (u.resupplyTimer || 0) + dt;
      if (u.resupplyTimer < interval) continue;
      u.resupplyTimer -= interval;
      let got = 0;
      for (const id of [u.weapon.id, u.holster?.id]) {
        if (!id) continue;
        const w = this.weapons.get(id);
        got += u.addAmmo(id, w.resupply ?? w.magazine);
      }
      u.resupplyCount = (u.resupplyCount || 0) + 1;
      if (c.grenadeEvery > 0 && u.resupplyCount % c.grenadeEvery === 0) got += u.addGrenades(1);
      if (got <= 0) continue;
      u.resupplyFlash = c.flashTime ?? 0.8;
      if (c.sound) this.audio.play(c.sound, u);
      // scritta solo al primo rifornimento di una sosta
      if (u === this.player && !this.attract && !u.resupplying) this.hud.popup(this.i18n.t('pickup.resupply'), this.pickupsCfg.popupColor);
      u.resupplying = true;
    }
  }

  /** Scritta lampeggiante "RICARICA!" a caricatore vuoto (a piedi, se si può ricaricare), o null. */
  _reloadPrompt() {
    const p = this.player;
    if (p.dead || p.vehicle) return null;
    // niente più colpi: dove rifornirsi
    if (p.outOfAmmo) {
      if (!p.holster) return this.i18n.t('hud.noAmmo');
      if (this.input.mode === 'touch') return this.i18n.t('hud.noAmmoSwitchTouch');
      return this.i18n.t('hud.noAmmoSwitch', { key: keyName(this.input.bindings.switchWeapon?.[0], this.i18n) });
    }
    if (p.ammo > 0 || !p.canReload) return null;
    if (this.input.mode === 'touch') return this.i18n.t('hud.reloadPromptTouch');
    return this.i18n.t('hud.reloadPrompt', { key: keyName(this.input.bindings.reload?.[0], this.i18n) });
  }

  /**
   * Testo dell'HUD sotto il soldato: "[E] Raccogli Fucile a pompa", "[E] Sali: Jeep", e "[E] Scendi" per qualche
   * secondo dopo essere saliti (su touch senza il tasto: c'è il pulsante). In elicottero: "[E] Atterra e scendi",
   * "Atterraggio..." o "Qui non si può atterrare".
   */
  _pickupPrompt() {
    const touch = this.input.mode === 'touch';
    const key = keyName(this.input.bindings.pickup?.[0], this.i18n);
    const p = this.player;
    const v = p.vehicle;
    if (v?.def.flying && !v.grounded) {
      if (v.landBlocked) return this.i18n.t('hud.cantLand');
      if (v.landing) return this.i18n.t(touch ? 'hud.landingTouch' : 'hud.landing', { key });
      if (this.time - this.enteredAt > (this.config.hud?.pickup?.exitHintTime ?? 4)) return null;
      return this.i18n.t(touch ? 'hud.landTouch' : 'hud.land', { key });
    }
    if (p.vehicle) {
      if (this.time - this.enteredAt > (this.config.hud?.pickup?.exitHintTime ?? 4)) return null;
      return this.i18n.t(touch ? 'hud.exitTouch' : 'hud.exit', { key });
    }
    if (this.vehicleOffer) {
      const vehicle = this.i18n.t(this.vehicleOffer.def.name || this.vehicleOffer.def.id);
      return this.i18n.t(touch ? 'hud.enterTouch' : 'hud.enter', { key, vehicle });
    }
    const it = this.pickupOffer;
    if (!it) return null;
    const w = this.weapons.get(it.weapon);
    const weapon = this.i18n.t(w.name || w.id);
    if (touch) return this.i18n.t('hud.pickupTouch', { weapon });
    return this.i18n.t('hud.pickup', { key, weapon });
  }

  /** L'unità prende l'arma "item" (con i colpi rimasti) e lascia a terra quella che impugnava. */
  _swapWeapon(u, item) {
    // (da un'arma uguale alle proprie si prendono solo i colpi passandoci sopra: Pickups.update)
    if (item.weapon === u.primaryId || item.weapon === u.specialId) return;
    this.pickups.take(item);
    const dropped = u.pickUp(item.weapon, item.ammo ?? undefined, item.reserve ?? undefined);
    for (const d of dropped) this.pickups.dropWeapon(d.id, d.ammo, u.x, u.y, u.angle + Math.PI / 2, d.reserve ?? null);
    if (this.pickupsCfg.weaponSound) this.audio.play(this.pickupsCfg.weaponSound, u);
    if (u === this.player && !this.attract) {
      this.hud.popup(this.i18n.t(u.weapon.name || u.weapon.id), this.pickupsCfg.popupColor);
      this.pickupOffer = null;
    }
  }

  /** Opacità del cadavere c: 1, poi scende a 0 negli ultimi death.corpseFade secondi di death.corpseTime. */
  _corpseAlpha(c) {
    const life = this.deathCfg.corpseTime ?? 12;
    if (life <= 0) return 1;
    const fade = Math.min(life, this.deathCfg.corpseFade ?? 2);
    return Math.max(0, Math.min(1, (life - c.time) / fade));
  }

  _drawCorpses(ctx) {
    const poolTime = this.deathCfg.poolTime ?? 2.5;
    ctx.save();
    for (const c of this.corpses) {
      if (c.pool) {
        // frame della pozza in base al tempo: si allarga fino all'ultimo frame
        const k = Math.min(1, c.time / poolTime);
        const n = c.pool.sprite.frameCount / c.pool.sprite.variants;
        const frame = (c.pool.first ?? 0) + Math.min(n - 1, Math.floor(k * n));
        ctx.globalAlpha = this._corpseAlpha(c);
        drawSprite(ctx, c.pool.sprite, frame, c.pool.x, c.pool.y, c.pool.angle);
      }
    }
    const fallTime = this.deathCfg.fallTime ?? 0;
    for (const c of this.corpses) {
      ctx.globalAlpha = this._corpseAlpha(c);
      const b = c.body;
      if (!b) continue;
      // caduta: frame dal soldato che si accascia al corpo disteso, mentre scivola all'indietro
      const n = b.sprite.frameCount / b.sprite.variants;
      const k = fallTime > 0 ? Math.min(1, c.time / fallTime) : 1;
      const frame = (b.pose ?? 0) + Math.min(n - 1, Math.floor(k * n));
      const x = b.from ? b.from.x + (b.x - b.from.x) * k : b.x;
      const y = b.from ? b.from.y + (b.y - b.from.y) * k : b.y;
      drawRotated(ctx, b.sprite, frame, x, y, b.angle);
    }
    ctx.restore();
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
    if (this.respawn) this.onDeployClose?.();
    this.respawn = null;
    this.pickupOffer = null;
    this.vehicleOffer = null;
    this.scores.endMatch(w);
    // medaglie di fine partita: primo in classifica, vittoria senza mai morire
    if (!this.attract) {
      if (this.scores.ranking()[0] === this.playerRecord) this._medalTrigger('end', 'mvp');
      if (outcome === 'victory' && this.playerRecord.deaths === 0) this._medalTrigger('end', 'untouchable');
    }
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

  /**
   * Un colpo: un suono e "pellets" proiettili (>1 = fucile a pompa) o un razzo (weapon.projectile = "rocket").
   * shooter = il soldato (Player) oppure, per le armi dei mezzi, { weapon, angle, muzzle, x, y, team,
   * aimDistance, owner (pilota), fromVehicle, vx, vy } (vedi fireVehicle).
   */
  fire(shooter) {
    const w = shooter.weapon;
    if (w.sound) this.audio.play(w.sound, shooter);
    // vampata e fumo alla volata (non se la canna è dentro un muro)
    const m = shooter.muzzle;
    const air = !!shooter.fromVehicle?.airborne; // dall'elicottero in volo: sopra i muri
    if (w.muzzleFlash && (air || !this.map.blocksShotAt(m.x, m.y))) this.effects.muzzle(w.muzzleFlash, m.x, m.y, shooter.angle);
    if (w.projectile === 'rocket') {
      this._spawnRocket(shooter, w);
      return;
    }
    const n = Math.max(1, Math.round(w.pellets || 1));
    for (let i = 0; i < n; i++) this._spawnBullet(shooter, w);
  }

  /**
   * Gittata di un colpo lungo (dx, dy) dalla volata m: bot = fino al punto mirato (+ scarto); desktop con
   * mouse = distanza dal mirino (± rangeJitter); touch = fino al bordo dello schermo.
   */
  _shotRange(s, w, m, dx, dy) {
    let range;
    if (s.aimDistance !== null && s.aimDistance !== undefined) {
      // bot: fino al punto mirato più un piccolo scarto -> o colpisce o cade a terra vicino al bersaglio
      range = s.aimDistance - (w.muzzleOffset ?? 8) + rand(this.aiCfg.shotOvershoot, 6);
    } else if (this.input.mode === 'desktop' && this.input.mouse.seen) {
      const mouse = this.input.mouseGame;
      const tx = mouse.x + Math.round(this.camera.x);
      const ty = mouse.y + Math.round(this.camera.y);
      const dist = Math.hypot(tx - s.x, ty - s.y) - (w.muzzleOffset ?? 8);
      const jitter = 1 + (Math.random() * 2 - 1) * (w.rangeJitter || 0);
      range = dist * jitter;
    } else {
      range = this._rangeToScreenEdge(m.x, m.y, dx, dy, w.screenMargin ?? 3);
    }
    return Math.min(w.maxRange ?? 600, Math.max(w.minRange ?? 4, range, 0.5));
  }

  _spawnBullet(shooter, w) {
    // sotto il fuoco nemico (soppressione) la rosa si allarga di combat.suppression.spreadDeg;
    // i soldati aggiungono movimento e rinculo (Player.spreadDeg), le armi dei mezzi usano solo quella dell'arma
    const sup = (shooter.suppression || 0) * (this.combat.suppression?.spreadDeg ?? 0);
    const deg = typeof shooter.spreadDeg === 'function' ? shooter.spreadDeg(sup) : (w.spreadDeg || 0) + sup;
    const spread = (deg * Math.PI) / 180;
    const a = shooter.angle + (Math.random() - 0.5) * spread;
    const dx = Math.cos(a);
    const dy = Math.sin(a);
    const m = shooter.muzzle;
    const range = this._shotRange(shooter, w, m, dx, dy);

    // Canna dentro un muro (giocatore attaccato alla parete): impatto immediato (non dall'elicottero in volo)
    const fromAir = !!shooter.fromVehicle?.airborne;
    if (!fromAir && this.map.blocksShotAt(m.x, m.y)) {
      const n = Math.abs(dx) > Math.abs(dy) ? { x: -Math.sign(dx), y: 0 } : { x: 0, y: -Math.sign(dy) };
      this._wallImpact(m.x, m.y, shooter.x, shooter.y, n.x, n.y);
      return;
    }

    const sprite = this.assets.sprite(w.bulletSprite || 'bullet');
    // damage: danno del singolo proiettile/pallino (verrà applicato ai bersagli colpiti)
    // team/owner: i colpi non feriscono la propria squadra; il bersaglio sa da dove arrivano (IA)
    this.bullets.push({
      x: m.x, y: m.y, dx, dy, angle: a, speed: w.bulletSpeed || 300, range, sprite,
      damage: w.damage ?? 0, team: shooter.team, owner: shooter.owner ?? shooter, fromVehicle: shooter.fromVehicle ?? null, weapon: w.id,
      fromAir,
    });
  }

  /** Razzo (lanciarazzi a spalla o del carro): con la canna dentro un muro esplode subito. */
  _spawnRocket(shooter, w) {
    const def = this.rocketTypes.get(w.rocket);
    const owner = shooter.owner ?? shooter;
    const deg = typeof shooter.spreadDeg === 'function' ? shooter.spreadDeg() : w.spreadDeg || 0;
    const a = shooter.angle + (Math.random() - 0.5) * (deg * Math.PI) / 180;
    const m = shooter.muzzle;
    if (!shooter.fromVehicle?.airborne && this.map.blocksShotAt(m.x, m.y)) {
      this.explode(def, m.x, m.y, owner, null, 'rocket');
      return;
    }
    const range = this._shotRange(shooter, w, m, Math.cos(a), Math.sin(a));
    this.rockets.spawn(def, m.x, m.y, a, range, shooter.team, owner, shooter.fromVehicle ?? null);
  }

  /** Soldato a piedi colpito dal proiettile b nella posizione attuale (null se nessuno). */
  _unitHit(b) {
    return this.soldierAt(b.x, b.y, b.team, b.owner);
  }

  /**
   * Proiettile su un mezzo: scintille; danno pieno se senza corazza, ridotto di bulletFactor se a corazza
   * leggera (elicottero), nessuno se corazzato. Niente danno dalla propria squadra (senza fuoco amico).
   */
  _hitVehicle(b, v) {
    const nx = Math.abs(b.x - v.x) / (v.hw || 1) > Math.abs(b.y - v.y) / (v.hh || 1) ? Math.sign(b.x - v.x) : 0;
    const ny = nx === 0 ? Math.sign(b.y - v.y) : 0;
    this.effects.impact(v.def.impact || 'metal', b.x, b.y, b.x, b.y, nx, ny);
    if (!this.combat.friendlyFire && v.occupied && v.team === b.team) return;
    const k = v.def.armor === false ? 1 : v.def.bulletFactor ?? 0;
    if (k > 0) v.damage(b.damage * k, b.owner);
  }

  _hitUnit(b, u) {
    const o = b.owner;
    u.damage(b.damage, o ? { unit: o, x: o.x, y: o.y, cause: 'bullet', weapon: b.weapon } : null);
    this.effects.impact(this.combat.hitImpact || 'flesh', b.x, b.y, b.x, b.y, b.dx, b.dy);
  }

  // ---------- Riscontro dei colpi (giocatore umano) ----------

  /**
   * Il giocatore ha fatto danno a target (soldato o mezzo, anche con granate, razzi o investendolo): segno sul
   * mirino (hud.hitMarker: hit = soldato, armor = mezzo, kill = uccisione/distruzione) e suono, non più di uno
   * ogni soundGap s (i pallini della pompa arrivano insieme). Niente segno sui compagni.
   */
  _onPlayerHit(target, killed) {
    if (!target || target.team === this.player.team) return;
    const hc = this.config.hud?.hitMarker || {};
    if (hc.show === false) return;
    const kind = killed ? 'kill' : target instanceof Player ? 'hit' : 'armor';
    const cur = this.hitMarker;
    // un'uccisione appena segnata non viene coperta dai colpi successivi dello stesso istante
    if (cur?.kind === 'kill' && !killed && cur.age < (hc.killHold ?? 0.15)) return;
    const life = (kind === 'kill' ? hc.killLife : hc.life) ?? (kind === 'kill' ? 0.5 : 0.22);
    this.hitMarker = { kind, age: 0, life, x: target.x, y: target.y };
    if (killed || this.time - this.hitSoundAt >= (hc.soundGap ?? 0.06)) {
      this.hitSoundAt = this.time;
      const snd = kind === 'kill' ? hc.killSound : kind === 'armor' ? hc.armorSound : hc.sound;
      if (snd) this.audio.play(snd);
    }
  }

  /** Il giocatore ha subito danno da source (x, y = da dove arriva): indicatore della direzione nell'HUD. */
  _onPlayerHurt(dealt, source) {
    const p = this.player;
    if (!source || source.x === undefined || source.x === null) return;
    const dx = source.x - p.x;
    const dy = source.y - p.y;
    if (Math.hypot(dx, dy) < 4) return; // esplosione addosso: nessuna direzione
    this.hud.hurtFrom(Math.atan2(dy, dx), dealt / (p.maxHealth || 100));
  }

  /**
   * Mirino del giocatore in (mx, my) px di gioco: con hud.crosshair.dynamic si apre con la rosa dei colpi (rinculo,
   * movimento, soppressione) alla distanza del mirino, altrimenti lo sprite "crosshair".
   */
  _drawCrosshair(ctx, mx, my, cx, cy, dt) {
    const xc = this.config.hud?.crosshair || {};
    if (!xc.dynamic) {
      if (this.crosshair) drawSprite(ctx, this.crosshair, 0, mx, my);
      return;
    }
    const p = this.player;
    const minGap = xc.minGap ?? 1;
    let gap = minGap;
    if (!p.vehicle) {
      const sup = (p.suppression || 0) * (this.combat.suppression?.spreadDeg ?? 0);
      const half = (p.spreadDeg(sup) / 2) * (Math.PI / 180);
      const dist = Math.max(0, Math.hypot(mx + cx - p.x, my + cy - p.y) - (p.weapon.muzzleOffset ?? 8));
      gap = Math.min(xc.maxGap ?? 10, Math.max(minGap, dist * Math.tan(half) * (xc.scale ?? 1)));
    }
    // apertura smorzata (niente scatti da un colpo all'altro)
    const k = 1 - Math.exp(-(xc.smoothing ?? 18) * dt);
    this.crosshairGap = this.crosshairGap === null ? gap : this.crosshairGap + (gap - this.crosshairGap) * k;
    const g = Math.round(this.crosshairGap);
    const arm = xc.arm ?? 2;
    const x = Math.round(mx);
    const y = Math.round(my);
    // contorno, poi bracci e punto centrale (stesso disegno dello sprite: braccio di 1 px con bordo di 1 px)
    ctx.fillStyle = xc.outline || '#000000';
    ctx.fillRect(x - 1, y - g - arm - 1, 3, arm + 2);
    ctx.fillRect(x - 1, y + g, 3, arm + 2);
    ctx.fillRect(x - g - arm - 1, y - 1, arm + 2, 3);
    ctx.fillRect(x + g, y - 1, arm + 2, 3);
    if (g > 1) ctx.fillRect(x - 1, y - 1, 3, 3);
    ctx.fillStyle = xc.color || '#ffffff';
    ctx.fillRect(x, y - g - arm, 1, arm);
    ctx.fillRect(x, y + g + 1, 1, arm);
    ctx.fillRect(x - g - arm, y, arm, 1);
    ctx.fillRect(x + g + 1, y, arm, 1);
    ctx.fillRect(x, y, 1, 1);
    return g;
  }

  /**
   * Segno di colpo a segno: quattro trattini in diagonale attorno a (x, y) a distanza gap + 2, più lunghi e rossi
   * per un'uccisione; svanisce nell'ultimo tratto della sua durata.
   */
  _drawHitMarker(ctx, x, y, gap) {
    const m = this.hitMarker;
    const hc = this.config.hud?.hitMarker || {};
    const colors = hc.colors || {};
    const color = colors[m.kind] || { hit: '#ffffff', armor: '#ffb43a', kill: '#ff3a2a' }[m.kind];
    const len = m.kind === 'kill' ? hc.killLength ?? 3 : hc.length ?? 2;
    const fade = hc.fade ?? 0.4;
    const left = 1 - m.age / m.life;
    ctx.globalAlpha = Math.min(1, left / fade);
    const o = Math.max(2, gap + (hc.offset ?? 2));
    const px = Math.round(x);
    const py = Math.round(y);
    for (const pass of [0, 1]) {
      ctx.fillStyle = pass === 0 ? hc.shadow || '#000000' : color;
      const s = pass === 0 ? 1 : 0; // ombra di 1 px in basso a destra
      for (let i = 0; i < len; i++) {
        const d = o + i;
        ctx.fillRect(px + d + s, py + d + s, 1, 1);
        ctx.fillRect(px - d + s, py + d + s, 1, 1);
        ctx.fillRect(px + d + s, py - d + s, 1, 1);
        ctx.fillRect(px - d + s, py - d + s, 1, 1);
      }
    }
    ctx.globalAlpha = 1;
  }

  /** Debug: passa all'arma successiva del catalogo. */
  _cycleWeapon() {
    const ids = this.weapons.ids.filter((id) => !this.weapons.get(id).vehicleOnly);
    const i = ids.indexOf(this.player.weapon.id);
    this.player.equip(ids[(i + 1) % ids.length]);
    this.player.fillReserve(this.player.weapon.id);
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

  /**
   * Soppressione: il colpo b, passato da (x0, y0) a (b.x, b.y) in questo tick, sfiora i soldati nemici entro
   * combat.suppression.radius px (ognuno una volta sola per colpo).
   */
  _suppress(b, x0, y0) {
    const sc = this.combat.suppression;
    if (!sc || b.fromAir) return;
    const R = sc.radius ?? 14;
    const dx = b.x - x0;
    const dy = b.y - y0;
    const len2 = dx * dx + dy * dy || 1;
    for (const u of this.units) {
      if (u.dead || u.vehicle || u.team === b.team || u === b.owner) continue;
      if (Math.abs(u.x - b.x) > R + 40 || Math.abs(u.y - b.y) > R + 40) continue;
      const t = Math.max(0, Math.min(1, ((u.x - x0) * dx + (u.y - y0) * dy) / len2));
      if (Math.hypot(u.x - (x0 + dx * t), u.y - (y0 + dy * t)) > R) continue;
      if (b.near?.has(u)) continue;
      (b.near ||= new Set()).add(u);
      u.suppress(sc.amount ?? 0.2, sc.hold ?? 0.4);
    }
  }

  _updateBullets(dt) {
    const map = this.map;
    for (let i = this.bullets.length - 1; i >= 0; i--) {
      const b = this.bullets[i];
      const bx0 = b.x;
      const by0 = b.y;
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
        let veh = hit ? null : this.vehicleAt(b.x, b.y, 0, b.fromVehicle);
        // un elicottero amico in volo: il colpo gli passa sotto
        if (veh?.high && veh.team === b.team && !this.combat.friendlyFire) veh = null;
        if (hit) {
          this._hitUnit(b, hit);
          done = true;
        } else if (veh) {
          this._hitVehicle(b, veh);
          done = true;
        } else if (!b.fromAir && map.blocksShotAt(b.x, b.y)) {
          const n = this._surfaceNormal(px, py, b.x, b.y, b.dx, b.dy);
          this._wallImpact(b.x, b.y, px, py, n.x, n.y);
          // il colpo rovina il tile (casse, staccionate, sacchi...: dipende dal materiale)
          this.destruction?.bullet(Math.floor(b.x / map.size), Math.floor(b.y / map.size), b.damage);
          done = true;
        } else if (b.range <= 1e-6) {
          // a fine corsa conta anche un soldato appena oltre (mirino/punto mirato sul suo corpo)
          if (!this._hitJustBeyond(b)) this._groundImpact(b.x, b.y);
          done = true;
        }
      }
      this._suppress(b, bx0, by0);
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
      if (this.map.blocksShotAt(b.x, b.y)) break;
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
    if (tx !== ptx && this.map.blocksShotTile(tx, pty)) return { x: -Math.sign(dx), y: 0 };
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

  /**
   * Luci del fotogramma (game.json -> lights): fuochi, razzi in volo, bandiere in cattura (lampeggio del colore di
   * chi la sta prendendo, ambra se contesa) e, col buio, fari dei mezzi guidati e alone attorno al giocatore.
   */
  _addLights() {
    const L = this.lights;
    const c = this.config.lights || {};
    this.effects.addFireLights(L);
    if (c.rocket) for (const r of this.rockets.list) L.add(r.x, r.y, c.rocket);
    if (c.flag) {
      const H = this.ctf.look?.poleHeight ?? 22;
      const blink = 0.5 + 0.5 * Math.sin(this.ctf.time * Math.PI * 2 * (c.flag.blinkHz ?? 2.5));
      for (const f of this.ctf.flags) {
        if (!f.activity) continue;
        const color = f.activity === 'contested' ? c.flag.contested || '#ffb627' : this.teams[f.activity]?.light || '#ffffff';
        L.add(f.x, f.y - H - 1, { ...c.flag, color }, blink);
      }
    }
    if (!L.dark) return;
    if (c.headlights) {
      for (const v of this.vehicles) {
        if (v.destroyed || !v.driver || v.high) continue;
        // fari: tre aloni sempre più larghi davanti al muso
        const h = c.headlights;
        const step = h.step ?? 14;
        for (let i = 1; i <= (h.count ?? 3); i++) {
          L.add(v.x + Math.cos(v.angle) * step * i, v.y + Math.sin(v.angle) * step * i, h, 1 - (i - 1) * 0.2, 0.6 + i * 0.25);
        }
      }
    }
    // il giocatore vede attorno a sé (visore notturno): toglie un po' di buio, nessun alone
    if (c.player && !this.attract && this.player && !this.player.dead) {
      const p = this.player.vehicle || this.player;
      L.add(p.x, p.y, c.player);
    }
  }

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
    const view = { x: cx, y: cy, w: W, h: H };
    const wind = this.weather.active ? this.weather.wind : null;
    this.props.drawGround(ctx, view, wind); // ombre, cespugli, sassi
    for (const v of this.vehicles) if (v.high) v.drawShadow(ctx); // ombre degli elicotteri in volo
    this.weather.drawGround(ctx); // sabbia che scorre rasoterra
    this.ctf.drawZones(ctx);
    this.effects.drawCasings(ctx, false); // bossoli a terra
    this.grenades.draw(ctx, false); // granate a terra
    this.pickups.drawPads(ctx);
    this._drawCorpses(ctx);
    this.effects.drawFires(ctx); // fuochi rimasti accesi dopo le esplosioni
    this.pickups.draw(ctx, this.attract ? null : this.pickupOffer);
    // pennoni e soldati ordinati per y: chi sta più in alto sullo schermo è "dietro"
    // (a parità di y prima il pennone; sort stabile)
    // carcasse dei mezzi a terra, sotto tutto il resto
    for (const v of this.vehicles) if (v.destroyed && !v.high) v.draw(ctx);
    const liveVehicles = this.vehicles.filter((v) => !v.destroyed && !v.high);
    const soldiers = this.units.filter((u) => !u.dead && !u.vehicle);
    // ombre portate dei soldati tutte insieme, sotto a soldati, mezzi e pennoni
    this.lighting.drawShadows(ctx, this.map, view, soldiers, (u) => u.drawParts());
    const sorted = [...this.ctf.flags, ...liveVehicles, ...soldiers].sort((a, b) => a.y - b.y);
    for (const o of sorted) {
      if (o.drawParts) {
        o.draw(ctx);
        this.lighting.drawRim(ctx, this.map, o.x, o.y, o.drawParts());
      } else if (o.draw) o.draw(ctx);
      else this.ctf.drawFlag(ctx, o);
    }
    this.effects.drawCasings(ctx, true); // bossoli in volo
    this.grenades.draw(ctx, true); // granate in volo
    for (const b of this.bullets) drawSprite(ctx, b.sprite, 0, b.x, b.y, b.angle);
    this.rockets.draw(ctx);
    this.effects.drawFlashes(ctx);
    this.effects.drawParticles(ctx);
    this.effects.drawBlasts(ctx); // sopra il fumo, altrimenti ne coprirebbe il nucleo
    this.props.drawOverhead(ctx, view, wind); // chiome delle palme sopra i soldati
    for (const v of this.vehicles) if (v.high) v.draw(ctx); // elicotteri in volo sopra a tutto
    // luci: buio dell'ora del giorno e aloni (illuminano terreno, muri, soldati e fumo)
    this._addLights();
    this.lights.draw(ctx, view);
    if (!this.attract) this._drawSquadMarks(ctx);
    if (this.debug) this._drawBotDebug(ctx);
    this.weather.drawAir(ctx); // granelli e polvere nell'aria

    ctx.restore();
    this.weather.drawTint(ctx, W, H);
    this.lights.drawTint(ctx, W, H);

    const live = this.running && !this.attract; // partita del giocatore (non la dimostrativa del menu)
    const playing = live && !this.suspended && !this.ended && !this.player.dead;
    // tempo reale tra due disegni (smorzamento del mirino dinamico)
    const now = performance.now();
    const rdt = this.renderAt ? Math.min(0.1, (now - this.renderAt) / 1000) : 0;
    this.renderAt = now;
    if (playing && input.mode === 'desktop' && input.mouse.seen) {
      const m = input.mouseGame;
      const gap = this._drawCrosshair(ctx, m.x, m.y, cx, cy, rdt) ?? 1;
      if (this.hitMarker) this._drawHitMarker(ctx, m.x, m.y, gap);
    } else if (playing && this.hitMarker) {
      // touch / senza mouse: il segno compare sul bersaglio colpito
      this._drawHitMarker(ctx, this.hitMarker.x - cx, this.hitMarker.y - cy, 1);
    }

    // UI ad alta risoluzione
    const ui = display.uiCtx;
    ui.clearRect(0, 0, display.cssWidth, display.cssHeight);
    if (playing && input.mode === 'touch') {
      const p = this.player;
      const v = p.vehicle;
      if (v) {
        // alla guida: ricarica = arma principale, "granata" = razzi, raccogli = scendi
        const g0 = v.guns[0];
        const g1 = v.guns[1];
        input.sticks.draw(ui, {
          reload: { label: String(g0?.ammo ?? 0), progress: v.reloadProgress(0), alert: g0 && g0.ammo === 0 && !g0.reload },
          grenade: g1
            ? { icon: 'rocket', badge: String(g1.ammo), progress: v.reloadProgress(1), disabled: !!g1.reload }
            : { icon: 'rocket', disabled: true },
          pickup: { hidden: false, icon: 'exit' },
          switchWeapon: { hidden: true },
        });
      } else {
        input.sticks.draw(ui, {
          reload: { label: String(p.ammo), progress: p.reloadProgress, alert: p.ammo === 0 && !p.reloading },
          grenade: { badge: String(p.grenades), disabled: p.grenades <= 0 },
          // compare solo sopra un'arma raccoglibile o vicino a un mezzo libero
          pickup: { hidden: !this.pickupOffer && !this.vehicleOffer, icon: this.vehicleOffer ? 'enter' : 'pickup' },
          switchWeapon: { hidden: !p.holster }, // solo con due armi
          squadOrder: { hidden: !this.bots.some((b) => b.playerSquad) },
        });
      }
    }
    if (live) {
      const r = this.respawn;
      const pr = this.ranks.progress(this.career.xp);
      this.hud.draw(ui, display, this.player, {
        ctf: this.ctf,
        team: this.playerTeam,
        zone: this.ended ? null : this.ctf.zoneStatus(this.player),
        respawnIn: r && !this.onDeployOpen ? Math.max(0, r.delay - r.time) : null, // con la schermata di rientro: lì
        rank: {
          insignia: this.ranks.insignia(pr.index),
          name: this.i18n.t(`ranks.${pr.rank.id}.short`),
          ratio: pr.ratio,
          score: this.playerRecord.score,
        },
        screen: { x: this.player.x - cx, y: this.player.y - cy }, // posizione del giocatore sullo schermo (px di gioco)
        pickup: playing ? this._pickupPrompt() : null,
        reloadPrompt: playing ? this._reloadPrompt() : null,
        vehicle: this.player.vehicle ? this._vehicleHud(this.player.vehicle) : null,
        holster: this._holsterHud(),
        minimap: this._minimapHud(),
        killFeed: this.killFeed,
        compactFeed: input.mode === 'touch', // su touch: senza l'arma (non arriva ai pulsanti)
        squad: this.bots.some((b) => b.playerSquad) ? this._squadHud() : null,
        stamina: this.player.cfg.sprint && !this.player.vehicle && this.player.stamina < 1 ? this.player.stamina : null,
        suppression: playing ? this.player.suppression : 0,
      });
    }
    if (this.debug) this._drawDebug(ui);
  }

  /** Segno sopra la testa dei compagni di squadra (colore squad.color), anche quando sono a bordo di un mezzo. */
  _drawSquadMarks(ctx) {
    const color = this.squadCfg.color || '#7cf07c';
    ctx.fillStyle = color;
    for (const b of this.bots) {
      const u = b.unit;
      if (!b.playerSquad || !u || u.dead) continue;
      const x = Math.round(u.x);
      const y = Math.round(u.y) - (u.vehicle ? 16 : 10);
      // triangolino verso il basso, 5x3 px, con ombra
      ctx.globalAlpha = 0.5;
      ctx.fillStyle = '#000';
      ctx.fillRect(x - 1, y + 1, 5, 1);
      ctx.fillRect(x, y + 2, 3, 1);
      ctx.fillRect(x + 1, y + 3, 1, 1);
      ctx.globalAlpha = 1;
      ctx.fillStyle = color;
      ctx.fillRect(x - 2, y, 5, 1);
      ctx.fillRect(x - 1, y + 1, 3, 1);
      ctx.fillRect(x, y + 2, 1, 1);
    }
  }

  /** Dati della minimappa: mappa, bandiere, giocatore, compagni (squadra a parte), nemici avvistati, mezzi. */
  _minimapHud() {
    const team = this.playerTeam;
    const sq = this.squads[team];
    const mm = this.hud.cfg.minimap || {};
    const memory = mm.enemyMemory ?? 3;
    const enemies = [];
    if (sq) {
      for (const [e, k] of sq.contacts) {
        if (e.dead || e.destroyed || this.time - k.time > memory) continue;
        enemies.push({ x: k.x, y: k.y, vehicle: !!e.isVehicle });
      }
    }
    const allies = [];
    const squad = [];
    for (const b of this.bots) {
      const u = b.unit;
      if (!u || u.dead || u.team !== team) continue;
      (b.playerSquad ? squad : allies).push({ x: u.x, y: u.y });
    }
    const p = this.player;
    return {
      map: this.map,
      ctf: this.ctf,
      team,
      player: p.dead ? null : { x: p.x, y: p.y, angle: p.vehicle ? p.vehicle.angle : p.angle },
      allies,
      squad,
      enemies,
      vehicles: this.vehicles.filter((v) => !v.destroyed && (v.team === team || !v.occupied)).map((v) => ({ x: v.x, y: v.y, team: v.occupied ? v.team : null })),
      order: this.squadOrder.type === 'flag' ? this.squadOrder.flag : null,
    };
  }

  /** Riga della squadra nell'HUD: ordine attuale (+ tasto su desktop). */
  _squadHud() {
    const key = this.input.mode === 'touch' ? null : keyName(this.input.bindings.squadOrder?.[0], this.i18n);
    return { text: this._orderText(), key };
  }

  /** Arma nella fondina per l'HUD: "[Q] Lanciarazzi" (su touch senza tasto), o null. */
  _holsterHud() {
    const p = this.player;
    if (!p.holster || p.vehicle || p.dead) return null;
    const w = this.weapons.get(p.holster.id);
    const name = this.i18n.t(w.name || w.id);
    if (this.input.mode === 'touch') return name;
    return this.i18n.t('hud.holster', { key: keyName(this.input.bindings.switchWeapon?.[0], this.i18n), weapon: name });
  }

  /** Dati del mezzo guidato per l'HUD: nome, corazza, armi (nome, colpi, ricarica). */
  _vehicleHud(v) {
    return {
      name: this.i18n.t(v.def.name || v.def.id),
      health: v.health,
      maxHealth: v.maxHealth,
      guns: v.guns.map((g, i) => ({
        name: this.i18n.t(g.w.name || g.w.id),
        ammo: g.ammo,
        magazine: g.w.magazine,
        reloading: !!g.reload,
        progress: v.reloadProgress(i),
      })),
    };
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
