// Menu del gioco (DOM): principale, nuova partita, opzioni, pausa e fine partita.
// Mentre il menu è aperto dietro gira una partita dimostrativa (tutti bot, senza HUD né audio):
// il pannello copre la sinistra, la battaglia si vede a destra (Game.viewOffsetX sposta la visuale).
// Game resta senza DOM: qui si chiamano game.setup / restart e si leggono onMatchEnd / onRestart.

import { TileMap } from './engine/tilemap.js';
import { keyName } from './engine/input.js';
import { MenuScene } from './menu_scene.js';
import { drawSoldier, PORTRAIT } from './soldier_art.js';
import { DeployScreen } from './deploy.js';
import { mapPicture, mapThumb } from './map_preview.js';

// scelte del soldato nell'ordine della schermata (il nome è a parte)
const SOLDIER_FIELDS = ['weapon', 'camo', 'vest', 'vestColor', 'headgear', 'eyewear', 'beard', 'beardColor', 'skin', 'gloves', 'boots', 'headset', 'shemagh', 'kneepads'];

const $ = (id) => document.getElementById(id);

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export class Menu {
  /**
   * levels = [{ id, file, data }] (data = JSON del livello); testId = id della mappa di prova dall'editor (o null);
   * sceneCfg = config/menu_scene.json (scena animata al posto della partita dimostrativa, o null); settings = Settings;
   * fullscreen() = richiesta di schermo intero + landscape (solo touch, dentro un gesto);
   * soldierCfg = config/soldier.json (personalizzazione del soldato del giocatore).
   */
  constructor({ config, i18n, game, input, audio, assets, display, levels, testId = null, sceneCfg = null, settings, fullscreen, soldierCfg = {} }) {
    Object.assign(this, { config, i18n, game, input, audio, assets, display, levels, testId, settings, fullscreen, soldierCfg });
    this.cfg = config.menu || {};
    this.root = $('menu');
    this.panel = this.root.querySelector('.menu-panel');
    this.screens = {};
    for (const s of this.root.querySelectorAll('.menu-screen')) this.screens[s.dataset.screen] = s;
    this.stack = []; // schermate aperte (l'ultima è visibile; "Indietro" torna alla precedente)
    this.mode = 'menu'; // 'menu' | 'playing' | 'paused' | 'ended'
    this.rebinding = null; // { action, slot } mentre si aspetta un tasto
    this.teamIds = Object.keys(config.teams || {});
    this.scene = sceneCfg ? new MenuScene($('menu-scene'), sceneCfg, i18n) : null;
    // schermata di rientro dopo la morte del giocatore (aperta/chiusa dal gioco)
    this.deploy = new DeployScreen({ game, i18n });
    game.onDeployOpen = () => this._syncDeploy();
    game.onDeployClose = () => this._syncDeploy();

    // ultima configurazione usata (salvata) o valori di default da game.json -> menu
    const last = settings.get('newGame', {});
    const range = (r, def, max = 8, step = 1) => ({ min: r?.min ?? 0, max: r?.max ?? max, def: r?.default ?? def, step: r?.step ?? step });
    const ticketsDef = typeof config.ctf?.tickets === 'number' ? config.ctf.tickets : 400;
    this.limits = {
      allies: range(this.cfg.allies, 3),
      enemies: range(this.cfg.enemies, 4),
      tickets: range(this.cfg.tickets, ticketsDef, 1000, 50), // ticket per squadra (chi li esaurisce perde)
      // tempo limite in minuti (0 = nessuno): allo scadere vince chi ha più ticket
      timeLimit: range(this.cfg.timeLimit, Math.round((config.ctf?.timeLimit ?? 0) / 60), 60, 5),
    };
    // ora del giorno: indice in game.json -> lights.times (giorno, tramonto, notte)
    // (più i cicli lenti di lights.cycles, es. dal giorno alla notte)
    this.timeIds = [...Object.keys(config.lights?.times || { day: null }), ...Object.keys(config.lights?.cycles || {})];
    this.limits.timeOfDay = { min: 0, max: this.timeIds.length - 1, def: Math.max(0, this.timeIds.indexOf(config.lights?.default)), step: 1 };
    // meteo: "level" = quello della mappa, "clear" = sereno, altri = tipi di effects.json -> weather (game.json -> menu.weathers)
    this.weatherIds = this.cfg.weathers?.length ? this.cfg.weathers : ['level'];
    this.limits.weather = { min: 0, max: this.weatherIds.length - 1, def: 0, step: 1 };
    // difficoltà: indice in game.json -> bots.difficulty.levels (bravura dei bot contro il giocatore)
    const dc = config.bots?.difficulty || {};
    this.difficultyIds = Object.keys(dc.levels || { normal: null });
    this.limits.difficulty = { min: 0, max: this.difficultyIds.length - 1, def: Math.max(0, this.difficultyIds.indexOf(dc.default)), step: 1 };
    // valore salvato o di default, nei limiti e sul passo dello stepper
    const pick = (key) => {
      const l = this.limits[key];
      const v = Number(last[key] ?? l.def);
      return clamp(l.min + Math.round(((Number.isFinite(v) ? v : l.def) - l.min) / l.step) * l.step, l.min, l.max);
    };
    this.choice = {
      level: this._level(last.level)?.id || this._level(this.cfg.level)?.id || levels[0].id,
      team: this.teamIds.includes(last.team) ? last.team : this.teamIds.includes(this.cfg.team) ? this.cfg.team : this.teamIds[0],
      allies: pick('allies'),
      enemies: pick('enemies'),
      tickets: pick('tickets'),
      timeLimit: pick('timeLimit'),
      timeOfDay: pick('timeOfDay'),
      weather: pick('weather'),
      difficulty: pick('difficulty'),
    };

    this._buildMaps();
    this._buildTeams();
    this._buildSteppers();
    this._buildOptions();
    this.look = this._loadLook();
    this._buildSoldier();
    this._applyLoadout();
    this._attach();
    this._renderTexts();
  }

  _level(id) {
    return this.levels.find((l) => l.id === id) || null;
  }

  // ---------- Flusso di gioco ----------

  /** Menu principale con la scena animata (o la partita dimostrativa) dietro. */
  showMain() {
    const a = this.cfg.attract || {};
    // con una mappa di prova dall'editor la partita dimostrativa si gioca su quella
    const lvl = this._level(this.testId) || this._level(a.level) || this._level(this.choice.level);
    const { game } = this;
    document.body.classList.remove('match-over', 'match-victory', 'match-defeat', 'match-draw');
    $('overlay-matchend').classList.add('hidden');
    this.input.enabled = false;
    this.input.releaseAll();
    this.audio.setMuted(true);
    this.mode = 'menu';
    this._syncDeploy();
    this.stack = [];
    this._open('main');
    this._renderCareer($('menu-career'), game.career.xp);
    if (this.scene) {
      game.unload(); // la partita non serve più: dietro c'è la scena
      game.viewOffsetX = 0;
    } else {
      game.setup({ level: lvl.data, team: a.team, allies: a.allies ?? 3, enemies: a.enemies ?? 4, attract: true });
      game.running = true;
    }
    this._updateScene();
    this._updatePauseButton();
  }

  /** Apre "Nuova partita" con la mappa "id" già scelta (prova dall'editor). */
  openNewGame(id) {
    if (this._level(id)) this.choice.level = id;
    this._renderChoice();
    this._open('newGame');
  }

  /** "Inizia": partita con mappa, squadra e numero di bot scelti. */
  startMatch() {
    const c = this.choice;
    const lvl = this._level(c.level);
    if (!lvl) return;
    this.settings.set('newGame', { ...c });
    if (this.input.isTouchDevice) this.fullscreen?.();
    this.audio.unlock();
    this.audio.setMuted(false);
    this._hide();
    const { game } = this;
    game.viewOffsetX = 0;
    game.setup({
      level: lvl.data,
      team: c.team,
      allies: c.allies,
      enemies: c.enemies,
      tickets: c.tickets,
      timeLimit: c.timeLimit * 60,
      timeOfDay: this.timeIds[c.timeOfDay] ?? null,
      weather: this.weatherIds[c.weather] ?? null,
      difficulty: this.difficultyIds[c.difficulty] ?? null,
      attract: false,
    });
    game.running = true;
    this._play();
  }

  /**
   * "Inizia" dal pulsante: schermata di briefing (mappa che scorre, nome, condizioni, obiettivo, consiglio) che
   * copre la preparazione della partita; il gioco resta fermo finché il giocatore non preme un tasto o tocca lo
   * schermo, accettati solo a partita pronta e dopo menu.briefing.minTime s. startMatch() resta sincrona (la usano
   * anche i test).
   */
  launch() {
    if (this.briefing) return;
    const lvl = this._level(this.choice.level);
    if (!lvl) return;
    // gesti dell'utente: schermo intero e audio vanno chiesti adesso, non dopo i fotogrammi d'attesa
    if (this.input.isTouchDevice) this.fullscreen?.();
    this.audio.unlock();
    const bc = this.cfg.briefing || {};
    const b = (this.briefing = { start: performance.now(), ready: false, timer: 0 });
    this._fillBriefing(lvl);
    const ov = $('overlay-briefing');
    ov.classList.remove('hidden', 'closing', 'ready');
    // due fotogrammi: la schermata si vede prima del lavoro pesante (fusione dei terreni se non in cache)
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (this.briefing !== b) return;
      this.startMatch();
      this.game.suspended = true;
      this.input.enabled = false;
      this._briefingMap();
      // partita pronta: dopo almeno minTime s dall'apertura (un tasto premuto prima non la salta) si aspetta
      // un tasto o un tocco del giocatore, senza partire da sola
      const wait = Math.max(0, (bc.minTime ?? 2.2) * 1000 - (performance.now() - b.start));
      b.timer = setTimeout(() => {
        if (this.briefing !== b) return;
        b.ready = true;
        ov.classList.add('ready');
        $('briefing-status').textContent = this.i18n.t(this.input.mode === 'touch' ? 'briefing.readyTouch' : 'briefing.ready');
      }, wait);
    }));
  }

  /** Testi del briefing: mappa, squadra, bot, ora, meteo, obiettivo e un consiglio a caso. */
  _fillBriefing(lvl) {
    const { i18n } = this;
    const c = this.choice;
    $('briefing-name').textContent = this._levelText(lvl, 'name');
    const tags = $('briefing-tags');
    tags.textContent = '';
    const tag = (text, color) => {
      const t = el('li', 'briefing-tag', text);
      if (color) t.style.setProperty('--team', color);
      tags.append(t);
    };
    tag(i18n.t(`teams.${c.team}`), this.config.teams?.[c.team]?.color);
    tag(i18n.t('briefing.versus', { allies: c.allies + 1, enemies: c.enemies }));
    tag(i18n.t(`newGame.times.${this.timeIds[c.timeOfDay]}`));
    const wid = this.weatherIds[c.weather];
    const w = wid === 'level' || !wid ? lvl.data.weather : wid === 'clear' ? null : wid;
    tag(w ? i18n.t(`editor.weather.${w}`) : i18n.t('newGame.weathers.clear'));
    const did = this.difficultyIds[c.difficulty];
    if (did) tag(i18n.t(`newGame.difficulties.${did}`));
    $('briefing-status').textContent = i18n.t('briefing.deploying');
    const tips = i18n.list('tips');
    $('briefing-tip').textContent = tips.length ? i18n.t('briefing.tip', { tip: tips[Math.floor(Math.random() * tips.length)] }) : '';
    const cv = $('briefing-map');
    cv.getAnimations?.().forEach((a) => a.cancel());
    cv.style.opacity = '0';
  }

  /**
   * Illustrazione della mappa della partita appena preparata (come appare in gioco, con il colore del meteo) a
   * pixel ingranditi, che scorre lentamente dalla base del giocatore verso il centro.
   */
  _briefingMap() {
    const { game } = this;
    if (!game.map) return;
    const cv = $('briefing-map');
    const { canvas } = mapPicture({ map: game.map, props: game.props, grade: game.atmosphere.grade, config: this.config });
    cv.width = canvas.width;
    cv.height = canvas.height;
    cv.getContext('2d').drawImage(canvas, 0, 0);
    const bc = this.cfg.briefing || {};
    const k = bc.scale ?? 2;
    cv.style.width = `${canvas.width * k}px`;
    cv.style.height = `${canvas.height * k}px`;
    const box = cv.parentElement.getBoundingClientRect();
    const from = { x: game.player.x, y: game.player.y };
    const to = { x: game.map.pixelWidth / 2, y: game.map.pixelHeight / 2 };
    const at = (p, f) => {
      const x = p.x + (to.x - p.x) * f;
      const y = p.y + (to.y - p.y) * f;
      // il punto al centro del riquadro, senza uscire dalla mappa
      const tx = Math.min(0, Math.max(box.width - canvas.width * k, box.width / 2 - x * k));
      const ty = Math.min(0, Math.max(box.height - canvas.height * k, box.height / 2 - y * k));
      return `translate(${Math.round(tx)}px, ${Math.round(ty)}px)`;
    };
    cv.style.opacity = '1';
    cv.animate?.([{ transform: at(from, 0) }, { transform: at(from, bc.pan ?? 0.6) }], { duration: (bc.panTime ?? 14) * 1000, easing: 'linear', fill: 'forwards' });
  }

  /** Chiude il briefing (dissolvenza a tendina) e fa partire il gioco. */
  _endBriefing() {
    const b = this.briefing;
    if (!b || !b.ready) return;
    clearTimeout(b.timer);
    this.briefing = null;
    const ov = $('overlay-briefing');
    ov.classList.add('closing');
    setTimeout(() => {
      if (!this.briefing) ov.classList.add('hidden');
    }, (this.cfg.briefing?.outTime ?? 0.45) * 1000);
    if (this.mode === 'playing') {
      this.game.suspended = false;
      this._play();
    }
  }

  pause() {
    if (this.mode !== 'playing') return;
    this.mode = 'paused';
    this.game.suspended = true;
    this.input.enabled = false;
    this.input.releaseAll();
    this.stack = [];
    this._syncDeploy(); // in pausa la schermata di rientro si chiude (si riapre alla ripresa)
    this._open('pause');
    this._updatePauseButton();
  }

  /**
   * Schermata di rientro visibile solo in partita con il giocatore morto (game.respawn); mentre è aperta
   * l'input del gioco è spento (tasti e tocchi vanno alla schermata).
   */
  _syncDeploy() {
    const want = this.mode === 'playing' && !!this.game.respawn && !this.game.attract;
    if (want === this.deploy.visible) return;
    if (want) {
      this.input.releaseAll();
      this.input.enabled = false;
      this.deploy.open();
    } else {
      this.deploy.close();
      if (this.mode === 'playing') {
        this.input.releaseAll();
        this.input.enabled = true;
      }
    }
  }

  resume() {
    if (this.mode !== 'paused') return;
    this._hide();
    this.game.suspended = false;
    this._play();
  }

  _play() {
    this.mode = 'playing';
    document.activeElement?.blur?.(); // Spazio/Invio non devono premere un pulsante rimasto a fuoco
    this.input.releaseAll();
    this.input.enabled = true;
    this._syncDeploy(); // ripresa con il giocatore morto: di nuovo la schermata di rientro
    this._updatePauseButton();
  }

  /** Callback del gioco (main.js li collega a game.onMatchEnd / onRestart). */
  onMatchEnd(outcome) {
    this.mode = 'ended';
    this._syncDeploy();
    this._updatePauseButton();
    const ov = $('overlay-matchend');
    $('matchend-title').textContent = this.i18n.t(`matchEnd.${outcome}`);
    // finita per tempo scaduto: sottotitolo apposito (vince chi aveva più ticket)
    const byTime = this.game.ctf?.result?.reason === 'time';
    $('matchend-subtitle').textContent = this.i18n.t(`matchEnd.${outcome}${byTime ? 'Time' : ''}Subtitle`);
    // illustrazione: dove si è combattuto di più, con i caduti
    const art = this.game.battleArt();
    const cv = $('matchend-art');
    if (art) {
      cv.width = art.width;
      cv.height = art.height;
      cv.getContext('2d').drawImage(art, 0, 0);
    }
    const lvl = this._level(this.choice.level);
    $('matchend-place').textContent = lvl ? this.i18n.t('matchEnd.place', { map: this._levelText(lvl, 'name') }) : '';
    const summary = this.game.matchSummary;
    this._renderScoreboard($('scoreboard'), summary);
    this._renderCareer($('matchend-career'), summary.xpAfter, summary.xpBefore);
    this._renderMatchMedals($('matchend-medals'), summary.medals);
    ov.dataset.outcome = outcome;
    document.body.classList.add('match-over', `match-${outcome}`);
    ov.classList.remove('hidden');
  }

  onRestart() {
    document.body.classList.remove('match-over', 'match-victory', 'match-defeat', 'match-draw');
    $('overlay-matchend').classList.add('hidden');
    if (this.mode === 'ended') this._play();
  }

  // ---------- Punteggi e carriera ----------

  /** Insegna del grado "index" come canvas DOM ingrandito di "scale" (pixel nitidi). */
  _insignia(index, scale) {
    const src = this.game.ranks.insignia(index);
    const c = el('canvas', 'insignia');
    c.width = src.width;
    c.height = src.height;
    c.getContext('2d').drawImage(src, 0, 0);
    c.style.width = `${src.width * scale}px`;
    c.style.height = `${src.height * scale}px`;
    return c;
  }

  /**
   * Scheda del grado: insegna, nome, barra verso il prossimo grado e punti di carriera.
   * xpBefore (opzionale, fine partita) = punti a inizio partita: mostra i punti guadagnati e "Promosso!".
   */
  _renderCareer(box, xp, xpBefore = null) {
    const { i18n } = this;
    const ranks = this.game.ranks;
    const p = ranks.progress(xp);
    box.textContent = '';
    box.append(this._insignia(p.index, box.classList.contains('compact') ? 2 : 3));
    const info = el('div', 'career-info');
    const name = el('div', 'career-rank', i18n.t(`ranks.${p.rank.id}.name`));
    if (xpBefore !== null && p.index > ranks.indexFor(xpBefore)) name.append(el('span', 'career-badge', i18n.t('career.promoted')));
    const bar = el('div', 'career-bar');
    const fill = el('span');
    fill.style.width = `${Math.round(p.ratio * 100)}%`;
    bar.append(fill);
    // fine partita: la barra si riempie dai punti di inizio partita (da zero se promosso)
    if (xpBefore !== null && xp > xpBefore) {
      const was = ranks.indexFor(xpBefore) === p.index ? ranks.progress(xpBefore).ratio : 0;
      fill.style.width = `${Math.round(was * 100)}%`;
      bar.classList.add('animated');
      setTimeout(() => {
        fill.style.width = `${Math.round(p.ratio * 100)}%`;
      }, (this.cfg.careerFillDelay ?? 0.6) * 1000);
    }
    const parts = [];
    if (xpBefore !== null) parts.push(i18n.t('career.gained', { xp: xp - xpBefore }));
    parts.push(p.next ? i18n.t('career.progress', { xp, next: p.next.xp }) : i18n.t('career.xp', { xp }));
    parts.push(p.next ? i18n.t('career.next', { rank: i18n.t(`ranks.${p.next.id}.name`) }) : i18n.t('career.maxRank'));
    info.append(name, bar, el('div', 'career-xp', parts.join(' · ')));
    // promosso: cosa si è sbloccato per il soldato
    if (xpBefore !== null) {
      const list = this._unlocksBetween(ranks.indexFor(xpBefore), p.index);
      if (list.length) {
        const names = list.map((u) => `${this._soldierValueText(u.key, u.id)} (${i18n.t(`soldier.fields.${u.key}`)})`);
        info.append(el('div', 'career-unlocks', i18n.t('career.unlocked', { list: names.join(', ') })));
      }
    }
    box.append(info);
  }

  /** Classifica di fine partita: tutti i soldati per punti, in due colonne se sono tanti. */
  _renderScoreboard(box, summary) {
    const { i18n } = this;
    const teams = this.config.teams || {};
    const list = summary.ranking;
    box.textContent = '';
    const cols = list.length > (this.cfg.scoreboardColumn ?? 9) ? 2 : 1;
    const per = Math.ceil(list.length / cols);
    const stats = ['kills', 'deaths', 'assists', 'captures', 'score'];
    for (let c = 0; c < cols; c++) {
      const col = el('div', 'score-col');
      const head = el('div', 'score-row score-head');
      head.append(el('span', 'score-pos', i18n.t('scoreboard.position')), el('span'), el('span', 'score-name', i18n.t('scoreboard.name')));
      for (const s of stats) {
        const h = el('span', `score-stat score-${s}`, i18n.t(`scoreboard.${s}`));
        h.title = i18n.t(`scoreboard.${s}Title`);
        head.append(h);
      }
      col.append(head);
      list.slice(c * per, (c + 1) * per).forEach((rec, i) => {
        const pos = c * per + i + 1;
        const row = el('div', 'score-row');
        row.style.setProperty('--i', String(pos)); // entrata in sequenza (CSS)
        if (rec === summary.player) row.classList.add('me');
        if (pos === 1) row.classList.add('first');
        row.style.setProperty('--team', teams[rec.team]?.color || '#888');
        const name = el('span', 'score-name', rec.name);
        name.title = `${i18n.t(`ranks.${this.game.ranks.get(rec.rank).id}.name`)} ${rec.name}`;
        row.append(el('span', 'score-pos', String(pos)), this._insignia(rec.rank, 1), name);
        for (const s of stats) row.append(el('span', `score-stat score-${s}`, String(rec[s])));
        col.append(row);
      });
      box.append(col);
    }
  }

  // ---------- Schermate ----------

  _open(name) {
    this.stack.push(name);
    this._showScreen();
  }

  _back() {
    if (this.stack.length > 1) {
      this.stack.pop();
      this._showScreen();
    } else if (this.mode === 'paused') {
      this.resume();
    }
  }

  _showScreen() {
    this._cancelRebind();
    const name = this.stack[this.stack.length - 1];
    for (const [n, s] of Object.entries(this.screens)) s.classList.toggle('active', n === name);
    this.panel.classList.toggle('wide', this.screens[name].classList.contains('wide'));
    this.root.classList.remove('hidden');
    this.root.classList.toggle('paused', this.mode === 'paused');
    if (name === 'options') this._renderKeys();
    if (name === 'medals') this._renderMedals();
    this._soldierAnim(name === 'soldier');
    this._layout();
    this._updateScene();
    // tastiera: fuoco sul primo pulsante (con il mouse il fuoco non si vede, :focus-visible)
    const first = this.screens[name].querySelector('.menu-item:not([disabled]), .map-card:not([disabled])');
    first?.focus({ preventScroll: true });
    this.screens[name].scrollTop = 0;
  }

  _hide() {
    this._cancelRebind();
    this._soldierAnim(false);
    this.root.classList.add('hidden');
    this._updateScene();
  }

  /** La scena animata gira solo nel menu principale (non in pausa né in partita). */
  _updateScene() {
    if (!this.scene) return;
    const on = this.mode === 'menu' && !this.root.classList.contains('hidden');
    this.root.classList.toggle('with-scene', on);
    if (on) this.scene.show();
    else this.scene.hide();
  }

  /** Sposta la visuale della partita dimostrativa nella parte di schermo non coperta dal pannello. */
  _layout() {
    const { game } = this;
    if (this.mode !== 'menu') return;
    // scena: si centra nella parte non coperta dal pannello (il pannello largo di Nuova partita non la sposta)
    if (this.scene && !this.panel.classList.contains('wide')) this.scene.setViewLeft(this.panel.offsetWidth);
    const k = this.cfg.attract?.panelOffset ?? 0.5;
    game.viewOffsetX = (this.panel.offsetWidth * k) / this.display.cssPerPixel;
  }

  _updatePauseButton() {
    const b = $('pause-button');
    b.classList.toggle('hidden', this.mode !== 'playing' || !!this.briefing);
    // sotto l'HUD in alto a sinistra (vita e granate)
    const top = this.game.hud ? Math.round(this.game.hud.topHeight(this.display)) : 40;
    b.style.top = `${top + 4}px`;
  }

  // ---------- Nuova partita ----------

  _buildMaps() {
    const list = $('map-list');
    this.mapCards = [];
    for (const lvl of this.levels) {
      const card = el('button', 'map-card');
      card.type = 'button';
      card.dataset.level = lvl.id;
      card.append(this._thumbnail(lvl.data), this._mapInfo());
      card.addEventListener('click', () => {
        this.choice.level = lvl.id;
        this._renderChoice();
      });
      list.append(card);
      this.mapCards.push({ card, lvl });
    }
    // mappa procedurale: per ora solo annunciata ("menu.procedural": true la renderà selezionabile)
    const proc = el('button', 'map-card procedural');
    proc.type = 'button';
    proc.disabled = !this.cfg.procedural;
    proc.append(this._proceduralThumb(), this._mapInfo());
    list.append(proc);
    this.procCard = proc;
    this._richThumbs();
  }

  _mapInfo() {
    const info = el('div', 'map-info');
    info.append(el('strong', 'map-name'), el('span', 'map-meta'), el('span', 'map-desc'));
    return info;
  }

  /**
   * Anteprima veloce: la mappa senza fusione dei terreni, rimpicciolita, con basi e bandiere. Poco dopo l'avvio
   * _richThumbs la ridisegna sul posto "come in partita" (fusione, decorazioni, colore della mappa).
   */
  _thumbnail(level) {
    const map = new TileMap(level, this.assets.tileset(level.tileset), { blend: false });
    return mapThumb({ level, map, ...this._thumbOpts(), target: el('canvas', 'map-thumb') });
  }

  _thumbOpts() {
    return { k: this.cfg.thumbTile ?? 4, teams: this.config.teams || {}, neutral: this.config.ctf?.look?.neutralColor || '#f0f0f0' };
  }

  /**
   * Anteprime ricche, una mappa alla volta: TileMap.prewarm la disegna a pezzi (resta in cache anche per la
   * partita), poi la si illustra e si ridisegna la card. Parte dopo menu.previews.delay ms dall'avvio.
   */
  _richThumbs() {
    const pv = this.cfg.previews || {};
    if (pv.rich === false) return;
    const queue = this.mapCards.slice();
    const next = () => {
      const item = queue.shift();
      if (!item) return;
      const { lvl, card } = item;
      const tileset = this.assets.tileset(lvl.data.tileset);
      TileMap.prewarm(lvl.data, tileset, undefined, () => {
        try {
          const { canvas, map } = mapPicture({ level: lvl.data, assets: this.assets, config: this.config });
          mapThumb({ level: lvl.data, map, picture: canvas, ...this._thumbOpts(), target: card.querySelector('canvas') });
          card.classList.add('rich');
        } catch (e) {
          console.warn(`Map preview "${lvl.id}" not drawn`, e);
        }
        setTimeout(next, pv.gap ?? 60);
      });
    };
    setTimeout(next, pv.delay ?? 800);
  }

  /** Anteprima della mappa procedurale: rumore a blocchi con un "?" disegnato a pixel. */
  _proceduralThumb() {
    const k = this.cfg.thumbTile ?? 4;
    const c = el('canvas', 'map-thumb');
    const cols = 40;
    const rows = 26;
    c.width = cols * k;
    c.height = rows * k;
    const g = c.getContext('2d');
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const edge = x === 0 || y === 0 || x === cols - 1 || y === rows - 1;
        g.fillStyle = edge || rnd() < 0.12 ? '#3d3127' : rnd() < 0.5 ? '#2a2f3a' : '#262b35';
        g.fillRect(x * k, y * k, k, k);
      }
    }
    const q = ['.###.', '#...#', '...#.', '..#..', '.....', '..#..'];
    const s = k * 2;
    const ox = Math.round(c.width / 2 - (5 * s) / 2);
    const oy = Math.round(c.height / 2 - (6 * s) / 2);
    for (let y = 0; y < q.length; y++) {
      for (let x = 0; x < 5; x++) {
        if (q[y][x] !== '#') continue;
        g.fillStyle = '#0b0b12';
        g.fillRect(ox + x * s + k / 2, oy + y * s + k / 2, s, s);
        g.fillStyle = '#ffd36b';
        g.fillRect(ox + x * s, oy + y * s, s, s);
      }
    }
    return c;
  }

  _buildTeams() {
    const box = $('team-choice');
    this.teamButtons = this.teamIds.map((id) => {
      const b = el('button', 'seg team');
      b.type = 'button';
      b.style.setProperty('--team', this.config.teams[id].color);
      b.style.setProperty('--team-dark', this.config.teams[id].dark || '#000');
      b.addEventListener('click', () => {
        this.choice.team = id;
        this._renderChoice();
      });
      box.append(b);
      return { id, b };
    });
  }

  _buildSteppers() {
    this.steppers = {};
    for (const box of this.root.querySelectorAll('[data-stepper]')) {
      const key = box.dataset.stepper;
      const minus = el('button', 'step', '−');
      const value = el('span', 'step-value');
      const plus = el('button', 'step', '+');
      minus.type = plus.type = 'button';
      const change = (d) => {
        const l = this.limits[key];
        this.choice[key] = clamp(this.choice[key] + d * l.step, l.min, l.max);
        this._renderChoice();
      };
      minus.addEventListener('click', () => change(-1));
      plus.addEventListener('click', () => change(1));
      box.append(minus, value, plus);
      this.steppers[key] = { minus, value, plus };
    }
  }

  _renderChoice() {
    const c = this.choice;
    // la mappa scelta si disegna in anticipo nei momenti liberi (fusione dei terreni): "Inizia" parte subito
    const lvl = this._level(c.level);
    if (lvl && lvl.id !== this._warmId) {
      this._cancelWarm?.();
      this._warmId = lvl.id;
      this._cancelWarm = TileMap.prewarm(lvl.data, this.assets.tileset(lvl.data.tileset));
    }
    for (const { card, lvl } of this.mapCards) card.setAttribute('aria-pressed', String(lvl.id === c.level));
    for (const { id, b } of this.teamButtons) b.setAttribute('aria-pressed', String(id === c.team));
    for (const [key, s] of Object.entries(this.steppers)) {
      const l = this.limits[key];
      s.value.textContent = this._stepperText(key, c[key]);
      s.minus.disabled = c[key] <= l.min;
      s.plus.disabled = c[key] >= l.max;
    }
    const time = c.timeLimit > 0 ? this.i18n.t('newGame.summaryTime', { minutes: c.timeLimit }) : '';
    $('newgame-summary').textContent = this.i18n.t('newGame.summary', { allies: c.allies, enemies: c.enemies, tickets: c.tickets }) + time;
  }

  /** Valore mostrato da uno stepper: il tempo limite in minuti ("Nessuno" a 0), gli altri così come sono. */
  _stepperText(key, v) {
    if (key === 'timeOfDay') return this.i18n.t(`newGame.times.${this.timeIds[v]}`);
    if (key === 'weather') return this.i18n.t(`newGame.weathers.${this.weatherIds[v]}`);
    if (key === 'difficulty') return this.i18n.t(`newGame.difficulties.${this.difficultyIds[v]}`);
    if (key !== 'timeLimit') return String(v);
    return v > 0 ? this.i18n.t('newGame.minutes', { n: v }) : this.i18n.t('newGame.noLimit');
  }

  // ---------- Soldato (personalizzazione) ----------

  /** Armi sceglibili come arma di partenza: weapons.json -> "loadout": true. */
  get _loadoutWeapons() {
    const w = this.game.weapons;
    return w.ids.filter((id) => w.get(id).loadout);
  }

  /** Valori possibili di una scelta: armi, lista o chiavi di config/soldier.json -> options. */
  _soldierValues(key) {
    if (key === 'weapon') return this._loadoutWeapons;
    const o = this.soldierCfg.options?.[key];
    return Array.isArray(o) ? o : Object.keys(o || {});
  }

  /** Scelte salvate (localStorage), con i default di soldier.json per quelle mancanti o non più valide. */
  _loadLook() {
    const def = this.soldierCfg.defaults || {};
    const saved = this.settings.get(this.soldierCfg.storageKey || 'soldier', {}) || {};
    const look = { name: this._cleanName(saved.name ?? def.name ?? '') };
    for (const key of SOLDIER_FIELDS) {
      const values = this._soldierValues(key);
      // valori esistenti e già sbloccati dal grado del giocatore
      const ok = (v) => values.includes(v) && !this._locked(key, v);
      look[key] = ok(saved[key]) ? saved[key] : ok(def[key]) ? def[key] : values.find((v) => !this._locked(key, v)) ?? values[0];
    }
    return look;
  }

  /** Indice del grado che sblocca il valore (soldier.json -> unlocks.<scelta>.<valore> = id del grado), 0 = libero. */
  _unlockIndex(key, id) {
    const rid = this.soldierCfg.unlocks?.[key]?.[id];
    if (!rid) return 0;
    return this.game.ranks.list.find((r) => r.id === rid)?.index ?? 0;
  }

  _locked(key, id) {
    return this.game.career.rankIndex < this._unlockIndex(key, id);
  }

  /** Valori sbloccati salendo dal grado "from" (escluso) al grado "to" (incluso): [{ key, id, rank }]. */
  _unlocksBetween(from, to) {
    const out = [];
    for (const key of SOLDIER_FIELDS) {
      for (const id of this._soldierValues(key)) {
        const r = this._unlockIndex(key, id);
        if (r > from && r <= to) out.push({ key, id, rank: r });
      }
    }
    return out;
  }

  _cleanName(s) {
    return String(s).replace(/[\u0000-\u001f<>]/g, '').slice(0, this.soldierCfg.nameMaxLength ?? 16);
  }

  _saveLook() {
    this.settings.set(this.soldierCfg.storageKey || 'soldier', { ...this.look });
    this._applyLoadout();
  }

  /** Arma di partenza e nome in classifica per le prossime partite. */
  _applyLoadout() {
    this.game.setLoadout({ weapon: this.look.weapon, name: this.look.name.trim() });
  }

  _buildSoldier() {
    const input = $('soldier-name');
    input.maxLength = this.soldierCfg.nameMaxLength ?? 16;
    input.value = this.look.name;
    input.addEventListener('input', () => {
      const clean = this._cleanName(input.value);
      if (clean !== input.value) input.value = clean;
      this.look.name = clean;
      this._saveLook();
      this._renderTape();
    });
    // Invio conferma il nome (toglie il fuoco), senza avviare altro
    input.addEventListener('keydown', (e) => {
      if (e.code === 'Enter' || e.code === 'NumpadEnter') input.blur();
    });
    const rows = $('soldier-rows');
    this.soldierRows = {};
    for (const key of SOLDIER_FIELDS) {
      const row = el('div', 'pick-row');
      const label = el('h3', 'menu-label');
      const box = el('div', 'stepper');
      const prev = el('button', 'step', '‹');
      const value = el('span', 'step-value');
      const next = el('button', 'step', '›');
      prev.type = next.type = 'button';
      // si vedono anche i valori bloccati (anteprima), ma si salvano solo quelli sbloccati
      const change = (d) => {
        const values = this._soldierValues(key);
        const i = values.indexOf(this.view[key]);
        const v = values[(i + d + values.length) % values.length];
        this.view[key] = v;
        if (!this._locked(key, v)) {
          this.look[key] = v;
          this._saveLook();
        }
        this._renderSoldier();
      };
      prev.addEventListener('click', () => change(-1));
      next.addEventListener('click', () => change(1));
      box.append(prev, value, next);
      const lock = el('span', 'pick-lock');
      row.append(label, box, lock);
      rows.append(row);
      // caratteristiche dell'arma subito sotto la sua scelta
      if (key === 'weapon') rows.append($('soldier-stats'));
      this.soldierRows[key] = { row, label, value, prev, next, lock };
    }
  }

  /** "Casuale": aspetto a caso tra i valori sbloccati (arma e nome restano). */
  _randomSoldier() {
    for (const key of SOLDIER_FIELDS) {
      if (key === 'weapon') continue;
      const values = this._soldierValues(key).filter((v) => !this._locked(key, v));
      this.look[key] = values[Math.floor(Math.random() * values.length)];
    }
    this.view = { ...this.look };
    this._saveLook();
    this._renderSoldier();
  }

  _soldierValueText(key, id) {
    if (key === 'weapon') return this.i18n.t(this.game.weapons.get(id).name);
    return this.i18n.t(`soldier.values.${key}.${id}`);
  }

  _renderTape() {
    $('soldier-tape').textContent = this.look.name.trim();
  }

  _renderSoldier() {
    const { i18n } = this;
    this.view ||= { ...this.look };
    for (const [key, r] of Object.entries(this.soldierRows)) {
      const v = this.view[key];
      const locked = this._locked(key, v);
      r.label.textContent = i18n.t(`soldier.fields.${key}`);
      r.value.textContent = this._soldierValueText(key, v);
      r.row.classList.toggle('locked', locked);
      r.lock.textContent = locked ? i18n.t('soldier.locked', { rank: i18n.t(`ranks.${this.game.ranks.get(this._unlockIndex(key, v)).id}.name`) }) : '';
      r.prev.title = r.prev.ariaLabel = `${i18n.t('soldier.previous')} (${r.label.textContent})`;
      r.next.title = r.next.ariaLabel = `${i18n.t('soldier.next')} (${r.label.textContent})`;
    }
    $('soldier-name').placeholder = i18n.t('soldier.namePlaceholder');
    this._renderTape();
    this._renderStats();
    const w = this.game.weapons.get(this.view.weapon);
    this.soldierArt = drawSoldier(this.view, this.soldierCfg, w.portrait || 'rifle');
    this._drawSoldierPreview();
  }

  /** Caratteristiche dell'arma scelta, con barre rispetto alle altre armi di partenza. */
  _renderStats() {
    const { i18n } = this;
    const all = this._loadoutWeapons.map((id) => this.game.weapons.get(id));
    const w = this.game.weapons.get(this.view.weapon);
    const stats = [
      ['damage', (x) => x.damage * (x.pellets || 1), (x) => (x.pellets > 1 ? `${x.damage}×${x.pellets}` : String(x.damage))],
      ['rate', (x) => x.fireRate, (x) => String(Math.round(x.fireRate * 60))],
      ['magazine', (x) => x.magazine, (x) => String(x.magazine)],
      ['range', (x) => x.maxRange, (x) => String(x.maxRange)],
      ['reload', (x) => 1 / x.reloadTime, (x) => `${x.reloadTime}s`],
    ];
    const box = $('soldier-stats');
    box.textContent = '';
    for (const [id, val, text] of stats) {
      const max = Math.max(...all.map(val));
      const row = el('div', 'stat-row');
      const bar = el('div', 'stat-bar');
      const fill = el('span');
      fill.style.width = `${Math.round((val(w) / max) * 100)}%`;
      bar.append(fill);
      row.append(el('span', '', i18n.t(`soldier.stats.${id}`)), bar, el('b', '', text(w)));
      box.append(row);
    }
    box.append(el('div', 'stat-mode', i18n.t(w.auto ? 'soldier.stats.auto' : 'soldier.stats.semi')));
  }

  /** Disegna il ritratto nel riquadro con la scala intera più grande che ci sta (frame 1 = respiro). */
  _drawSoldierPreview(frame = this.soldierFrame || 0) {
    const art = this.soldierArt;
    const c = $('soldier-canvas');
    const box = c.parentElement;
    if (!art || !box.clientHeight) return;
    const tape = $('soldier-tape').offsetHeight + 12;
    const s = Math.max(1, Math.floor(Math.min((box.clientHeight - tape - 8) / PORTRAIT.h, (box.clientWidth - 8) / PORTRAIT.w)));
    if (c.width !== art.width || c.height !== art.height) {
      c.width = art.width;
      c.height = art.height;
    }
    c.style.width = `${art.width * s}px`;
    c.style.height = `${art.height * s}px`;
    const g = c.getContext('2d');
    g.clearRect(0, 0, c.width, c.height);
    g.drawImage(art, 0, 0);
    // respiro: busto, braccia e testa salgono di un pixel (la parte sotto il cinturone resta ferma)
    const cut = this.soldierCfg.breathCut ?? 56;
    if (frame) g.drawImage(art, 0, 0, art.width, cut, 0, -1, art.width, cut);
  }

  _soldierAnim(on) {
    clearInterval(this.soldierTimer);
    this.soldierTimer = 0;
    if (!on) return;
    this.view = { ...this.look }; // entrando si riparte dalle scelte salvate
    this._renderSoldier();
    this.soldierFrame = 0;
    this.soldierTimer = setInterval(() => {
      this.soldierFrame = 1 - this.soldierFrame;
      this._drawSoldierPreview();
    }, (this.soldierCfg.breathPeriod ?? 1.6) * 500);
  }

  // ---------- Medaglie ----------

  /** Icona di una medaglia come canvas DOM ingrandito di "scale". */
  _medalIcon(id, scale) {
    const src = this.game.medals.icon(id);
    const c = el('canvas', 'medal-icon');
    c.width = src.width;
    c.height = src.height;
    c.getContext('2d').drawImage(src, 0, 0);
    c.style.width = `${src.width * scale}px`;
    c.style.height = `${src.height * scale}px`;
    return c;
  }

  /** Medagliere: tutte le medaglie, quelle mai prese in grigio. */
  _renderMedals() {
    const { i18n } = this;
    const m = this.game.medals;
    const grid = $('medal-grid');
    grid.textContent = '';
    if (!m) return;
    $('medal-summary').textContent = i18n.t('medalBook.summary', { owned: m.owned, total: m.list.length });
    for (const def of m.list) {
      const n = m.count(def.id);
      const card = el('div', n ? 'medal-card' : 'medal-card missing');
      const info = el('div', 'medal-info');
      const name = el('strong', 'medal-name', i18n.t(`medals.${def.id}.name`));
      if (n) name.append(el('span', 'medal-count', `×${n}`));
      info.append(name, el('span', 'medal-desc', i18n.t(`medals.${def.id}.desc`)), el('span', 'medal-points', `+${def.points ?? 0}`));
      card.append(this._medalIcon(def.id, 3), info);
      grid.append(card);
    }
  }

  /** Fine partita: medaglie prese (raggruppate, con quante volte). */
  _renderMatchMedals(box, ids = []) {
    box.textContent = '';
    if (!ids.length || !this.game.medals) return;
    const counts = new Map();
    for (const id of ids) counts.set(id, (counts.get(id) || 0) + 1);
    box.append(el('span', 'medal-strip-title', this.i18n.t('matchEnd.medals')));
    for (const [id, n] of counts) {
      const item = el('span', 'medal-strip-item');
      item.title = this.i18n.t(`medals.${id}.desc`);
      item.append(this._medalIcon(id, window.innerHeight <= 540 ? 1 : 2), el('span', '', n > 1 ? `${this.i18n.t(`medals.${id}.name`)} ×${n}` : this.i18n.t(`medals.${id}.name`)));
      box.append(item);
    }
  }

  // ---------- Opzioni ----------

  _buildOptions() {
    // lingua: pulsanti col nome di ogni lingua nella lingua stessa (meta.name)
    const box = $('lang-choice');
    this.langButtons = [];
    this.i18n.languageNames().then((names) => {
      for (const lang of this.i18n.available) {
        const b = el('button', 'seg', names[lang]);
        b.type = 'button';
        b.lang = lang;
        b.addEventListener('click', async () => {
          await this.i18n.setLanguage(lang);
          this.settings.set('lang', lang);
          this._renderTexts();
        });
        box.append(b);
        this.langButtons.push({ lang, b });
      }
      this._renderLang();
    });

    // volume
    const slider = $('volume');
    slider.value = String(Math.round(this.audio.volume * 100));
    const show = () => ($('volume-value').textContent = `${slider.value}%`);
    show();
    slider.addEventListener('input', () => {
      this.audio.setVolume(Number(slider.value) / 100);
      show();
    });
    slider.addEventListener('change', () => {
      this.settings.set('volume', Number(slider.value) / 100);
      this.audio.unlock();
      this.audio.preview(this.cfg.volumeSound || 'dry_fire');
    });

    // ricarica automatica a caricatore vuoto (sì / no)
    const auto = $('autoreload-choice');
    const renderAuto = () => {
      for (const b of auto.querySelectorAll('[data-value]')) b.setAttribute('aria-pressed', String((b.dataset.value === 'on') === this.game.autoReload));
    };
    for (const b of auto.querySelectorAll('[data-value]')) {
      b.addEventListener('click', () => {
        const on = b.dataset.value === 'on';
        this.game.setAutoReload(on);
        this.settings.set('autoReload', on);
        renderAuto();
      });
    }
    renderAuto();

    // numeri dei danni (sì / no)
    const nums = $('damagenumbers-choice');
    const renderNums = () => {
      for (const b of nums.querySelectorAll('[data-value]')) b.setAttribute('aria-pressed', String((b.dataset.value === 'on') === !!this.game.damageNumbers));
    };
    for (const b of nums.querySelectorAll('[data-value]')) {
      b.addEventListener('click', () => {
        const on = b.dataset.value === 'on';
        this.game.setDamageNumbers(on);
        this.settings.set('damageNumbers', on);
        renderNums();
      });
    }
    renderNums();

    // qualità grafica (alta / bassa)
    const quality = $('quality-choice');
    const renderQuality = () => {
      for (const b of quality.querySelectorAll('[data-value]')) b.setAttribute('aria-pressed', String(b.dataset.value === this.game.quality));
    };
    for (const b of quality.querySelectorAll('[data-value]')) {
      b.addEventListener('click', () => {
        this.game.setQuality(b.dataset.value);
        this.settings.set('quality', b.dataset.value);
        renderQuality();
      });
    }
    renderQuality();

    // grana della pellicola (sì / no)
    const grain = $('grain-choice');
    const renderGrain = () => {
      for (const b of grain.querySelectorAll('[data-value]')) b.setAttribute('aria-pressed', String((b.dataset.value === 'on') === !!this.game.atmosphere.grain));
    };
    for (const b of grain.querySelectorAll('[data-value]')) {
      b.addEventListener('click', () => {
        const on = b.dataset.value === 'on';
        this.game.setGrain(on);
        this.settings.set('grain', on);
        renderGrain();
      });
    }
    renderGrain();

    // mirino: un pulsante per stile (game.json -> hud.crosshair.styles) con l'anteprima disegnata a pixel
    const cross = $('crosshair-choice');
    const renderCross = () => {
      for (const b of cross.querySelectorAll('[data-value]')) b.setAttribute('aria-pressed', String(b.dataset.value === this.game.crosshairStyle));
    };
    for (const style of this.config.hud?.crosshair?.styles || []) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'seg';
      b.dataset.value = style;
      b.dataset.i18nTitle = `options.crosshairs.${style}`;
      b.title = this.i18n.t(`options.crosshairs.${style}`);
      b.append(this._crosshairPreview(style));
      b.addEventListener('click', () => {
        this.game.setCrosshairStyle(style);
        this.settings.set('crosshair', style);
        renderCross();
      });
      cross.append(b);
    }
    renderCross();
  }

  /** Anteprima del mirino "style": lo stesso disegno del gioco su un canvas piccolo, ingrandito a pixel netti. */
  _crosshairPreview(style) {
    const c = document.createElement('canvas');
    c.width = 15;
    c.height = 15;
    c.className = 'crosshair-preview';
    this.game._drawCrosshairShape(c.getContext('2d'), 7, 7, 3, style); // un po' aperto, per far vedere la forma
    return c;
  }

  _renderLang() {
    for (const { lang, b } of this.langButtons) b.setAttribute('aria-pressed', String(lang === this.i18n.lang));
  }

  /** Azioni con tasti modificabili: game.json -> input.rebindable. */
  get _rebindable() {
    return (this.config.input?.rebindable || []).filter((a) => this.input.defaultBindings[a]);
  }

  _renderKeys() {
    const list = $('key-list');
    list.textContent = '';
    for (const action of this._rebindable) {
      const row = el('div', 'key-row');
      row.append(el('span', 'key-action', this.i18n.t(`options.actions.${action}`)));
      const codes = this.input.bindings[action] || [];
      for (let slot = 0; slot < 2; slot++) {
        const b = el('button', 'key-slot', this._keyName(codes[slot]));
        b.type = 'button';
        if (!codes[slot]) b.classList.add('unbound');
        b.addEventListener('click', (e) => {
          e.stopPropagation();
          this._startRebind(action, slot, b);
        });
        row.append(b);
      }
      list.append(row);
    }
  }

  _keyName(code) {
    return keyName(code, this.i18n);
  }

  _startRebind(action, slot, button) {
    this._cancelRebind();
    this.rebinding = { action, slot, button };
    button.classList.add('listening');
    button.textContent = this.i18n.t('options.pressKey');
    $('key-hint').textContent = this.i18n.t('options.pressKeyHint');
  }

  _cancelRebind() {
    if (!this.rebinding) return;
    this.rebinding = null;
    $('key-hint').textContent = '';
    this._renderKeys();
  }

  /** Assegna "code" (null = rimuovi) all'azione in ascolto, togliendolo dalle altre azioni modificabili. */
  _assignKey(code) {
    const { action, slot } = this.rebinding;
    const actions = this._rebindable;
    const custom = {};
    for (const a of actions) custom[a] = [...(this.input.bindings[a] || [])].slice(0, 2);
    if (code) for (const a of actions) custom[a] = custom[a].map((c) => (c === code ? null : c));
    custom[action][slot] = code;
    for (const a of actions) {
      custom[a] = [custom[a][0] ?? null, custom[a][1] ?? null];
      // slot vuoto in prima posizione: il secondo tasto sale
      if (!custom[a][0] && custom[a][1]) custom[a] = [custom[a][1], null];
    }
    this.settings.set('keys', custom);
    this.input.setBindings(custom);
    this.rebinding = null;
    $('key-hint').textContent = '';
    this._renderKeys();
  }

  _resetKeys() {
    this.settings.set('keys', {});
    this.input.setBindings({});
    this._cancelRebind();
    this._renderKeys();
  }

  // ---------- Testi (anche al cambio lingua) ----------

  _renderTexts() {
    const { i18n } = this;
    $('menu-version').textContent = i18n.t('menu.version', { version: this.config.version || '0.0.0' });
    for (const { card, lvl } of this.mapCards) {
      const { flags, cols, rows } = card.querySelector('canvas').dataset;
      const name = card.querySelector('.map-name');
      name.textContent = this._levelText(lvl, 'name');
      if (lvl.test) name.append(el('span', 'map-badge', i18n.t('newGame.testMap')));
      card.querySelector('.map-meta').textContent = `${i18n.t('newGame.flags', { count: flags })} · ${i18n.t('newGame.size', { cols, rows })}`;
      card.querySelector('.map-desc').textContent = this._levelText(lvl, 'description');
    }
    const p = this.procCard;
    const name = p.querySelector('.map-name');
    name.textContent = i18n.t('newGame.procedural');
    if (!this.cfg.procedural) name.append(el('span', 'map-badge', i18n.t('newGame.comingSoon')));
    p.querySelector('.map-meta').textContent = '';
    p.querySelector('.map-desc').textContent = i18n.t('newGame.proceduralDesc');
    for (const { id, b } of this.teamButtons) b.textContent = i18n.t(`teams.${id}`);
    for (const [key, s] of Object.entries(this.steppers)) {
      s.minus.title = s.minus.ariaLabel = `${i18n.t('newGame.decrease')} (${i18n.t(`newGame.${key}`)})`;
      s.plus.title = s.plus.ariaLabel = `${i18n.t('newGame.increase')} (${i18n.t(`newGame.${key}`)})`;
    }
    this._renderChoice();
    this._renderLang();
    this._renderCareer($('menu-career'), this.game.career.xp);
    if (this.stack[this.stack.length - 1] === 'options') this._renderKeys();
    if (this.stack[this.stack.length - 1] === 'soldier') this._renderSoldier();
    if (this.stack[this.stack.length - 1] === 'medals') this._renderMedals();
  }

  /**
   * Nome / descrizione di una mappa: dal file lingua (levels.<id>.name) se c'è, altrimenti dal livello stesso
   * ("name" / "description": testo o { lingua: testo }, es. mappe fatte con l'editor).
   */
  _levelText(lvl, field) {
    const key = `levels.${lvl.id}.${field}`;
    if (this.i18n.has(key)) return this.i18n.t(key);
    const v = lvl.data?.[field];
    if (typeof v === 'string') return v;
    if (v && typeof v === 'object') return v[this.i18n.lang] ?? v[this.i18n.defaultLang] ?? '';
    return field === 'name' ? lvl.id : '';
  }

  // ---------- Eventi ----------

  _attach() {
    this.root.addEventListener('click', (e) => {
      const t = e.target.closest('button');
      if (!t || t.disabled) return;
      if (t.dataset.go) this._open(t.dataset.go);
      else if (t.hasAttribute('data-back')) this._back();
      else if (t.dataset.action === 'start') this.launch();
      else if (t.dataset.action === 'resume') this.resume();
      else if (t.dataset.action === 'quit') this.showMain();
      else if (t.dataset.action === 'resetKeys') this._resetKeys();
      else if (t.dataset.action === 'randomSoldier') this._randomSoldier();
      else if (t.dataset.action === 'editor') location.href = this.config.editor?.page || 'editor.html';
    });
    // un clic fuori dal tasto in ascolto annulla la modifica
    this.root.addEventListener('pointerdown', (e) => {
      if (this.rebinding && !e.target.closest('.key-slot.listening')) this._cancelRebind();
    });
    // primo tocco nel menu: schermo intero + landscape (serve un gesto dell'utente)
    this.root.addEventListener('pointerup', (e) => {
      if (e.pointerType === 'touch' && !document.fullscreenElement) this.fullscreen?.();
    });

    // fine partita: rivincita o menu principale (dopo matchEnd.restartDelay, vedi game.canRestart)
    const end = $('overlay-matchend');
    end.addEventListener('pointerdown', (e) => e.stopPropagation()); // il clic non deve sparare
    end.addEventListener('click', (e) => {
      const a = e.target.closest('button')?.dataset.action;
      if (!a || !this.game.canRestart) return;
      if (a === 'rematch') this.game.restart();
      else if (a === 'menu') this.showMain();
    });

    // briefing: un clic/tocco a partita pronta lo chiude (e non arriva al gioco: niente colpi né stick)
    const brief = $('overlay-briefing');
    brief.addEventListener('pointerdown', (e) => e.stopPropagation());
    brief.addEventListener('click', () => {
      if (this.briefing?.ready) this._endBriefing();
    });

    // pausa da touch
    const pb = $('pause-button');
    pb.addEventListener('pointerdown', (e) => e.stopPropagation()); // niente stick sotto il pulsante
    pb.addEventListener('click', () => this.pause());

    // tastiera: in "capture" per arrivare prima di Input
    window.addEventListener('keydown', (e) => this._onKey(e), true);
    window.addEventListener('resize', () => {
      this._layout();
      this._updatePauseButton();
      if (this.soldierTimer) this._drawSoldierPreview();
    });
  }

  _onKey(e) {
    if (this.rebinding) {
      e.preventDefault();
      e.stopImmediatePropagation();
      if (e.code === 'Escape') this._cancelRebind();
      else if (e.code === 'Delete') this._assignKey(null);
      else if (!this._reserved(e.code)) this._assignKey(e.code);
      return;
    }
    // briefing: tasti fermati; a partita pronta un tasto lo chiude
    if (this.briefing) {
      e.preventDefault();
      e.stopImmediatePropagation();
      if (!e.repeat && this.briefing.ready) this._endBriefing();
      return;
    }
    const pauseKey = (this.input.bindings.pause || []).includes(e.code);
    if (this.mode === 'playing') {
      if (pauseKey && !e.repeat && !this.game.ended) {
        e.preventDefault();
        this.pause();
      }
      return;
    }
    if (this.root.classList.contains('hidden')) return;
    if (e.code === 'Escape' || (this.mode === 'paused' && pauseKey && this.stack.length === 1)) {
      e.preventDefault();
      this._back();
    } else if (e.code === 'ArrowDown' || e.code === 'ArrowUp') {
      if (e.target instanceof HTMLInputElement) return; // lo slider del volume usa le frecce
      e.preventDefault();
      this._moveFocus(e.code === 'ArrowDown' ? 1 : -1);
    }
  }

  /** Tasti di azioni non modificabili (debug F3..., conferma): non assegnabili. */
  _reserved(code) {
    const free = new Set(this._rebindable);
    return Object.entries(this.input.bindings).some(([a, codes]) => !free.has(a) && codes.includes(code));
  }

  _moveFocus(dir) {
    const screen = this.screens[this.stack[this.stack.length - 1]];
    const items = [...screen.querySelectorAll('button:not([disabled]), input')];
    if (!items.length) return;
    const i = items.indexOf(document.activeElement);
    items[(i + dir + items.length) % items.length].focus();
  }
}
