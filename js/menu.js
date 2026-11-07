// Menu del gioco (DOM): principale, nuova partita, opzioni, pausa e fine partita.
// Mentre il menu è aperto dietro gira una partita dimostrativa (tutti bot, senza HUD né audio):
// il pannello copre la sinistra, la battaglia si vede a destra (Game.viewOffsetX sposta la visuale).
// Game resta senza DOM: qui si chiamano game.setup / restart e si leggono onMatchEnd / onRestart.

import { TileMap } from './engine/tilemap.js';
import { keyName } from './engine/input.js';

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
   * levels = [{ id, file, data }] (data = JSON del livello); settings = Settings;
   * fullscreen() = richiesta di schermo intero + landscape (solo touch, dentro un gesto).
   */
  constructor({ config, i18n, game, input, audio, assets, display, levels, settings, fullscreen }) {
    Object.assign(this, { config, i18n, game, input, audio, assets, display, levels, settings, fullscreen });
    this.cfg = config.menu || {};
    this.root = $('menu');
    this.panel = this.root.querySelector('.menu-panel');
    this.screens = {};
    for (const s of this.root.querySelectorAll('.menu-screen')) this.screens[s.dataset.screen] = s;
    this.stack = []; // schermate aperte (l'ultima è visibile; "Indietro" torna alla precedente)
    this.mode = 'menu'; // 'menu' | 'playing' | 'paused' | 'ended'
    this.rebinding = null; // { action, slot } mentre si aspetta un tasto
    this.teamIds = Object.keys(config.teams || {});

    // ultima configurazione usata (salvata) o valori di default da game.json -> menu
    const last = settings.get('newGame', {});
    const range = (r, def) => ({ min: r?.min ?? 0, max: r?.max ?? 8, def: r?.default ?? def });
    this.limits = { allies: range(this.cfg.allies, 3), enemies: range(this.cfg.enemies, 4) };
    this.choice = {
      level: this._level(last.level)?.id || this._level(this.cfg.level)?.id || levels[0].id,
      team: this.teamIds.includes(last.team) ? last.team : this.teamIds.includes(this.cfg.team) ? this.cfg.team : this.teamIds[0],
      allies: clamp(last.allies ?? this.limits.allies.def, this.limits.allies.min, this.limits.allies.max),
      enemies: clamp(last.enemies ?? this.limits.enemies.def, this.limits.enemies.min, this.limits.enemies.max),
    };

    this._buildMaps();
    this._buildTeams();
    this._buildSteppers();
    this._buildOptions();
    this._attach();
    this._renderTexts();
  }

  _level(id) {
    return this.levels.find((l) => l.id === id) || null;
  }

  // ---------- Flusso di gioco ----------

  /** Menu principale con la partita dimostrativa dietro. */
  showMain() {
    const a = this.cfg.attract || {};
    const lvl = this._level(a.level) || this._level(this.choice.level);
    const { game } = this;
    document.body.classList.remove('match-over', 'match-victory', 'match-defeat', 'match-draw');
    $('overlay-matchend').classList.add('hidden');
    this.input.enabled = false;
    this.input.releaseAll();
    this.audio.setMuted(true);
    this.mode = 'menu';
    this.stack = [];
    this._open('main');
    this._renderCareer($('menu-career'), game.career.xp);
    game.setup({ level: lvl.data, team: a.team, allies: a.allies ?? 3, enemies: a.enemies ?? 4, attract: true });
    game.running = true;
    this._updatePauseButton();
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
    game.setup({ level: lvl.data, team: c.team, allies: c.allies, enemies: c.enemies, attract: false });
    game.running = true;
    this._play();
  }

  pause() {
    if (this.mode !== 'playing') return;
    this.mode = 'paused';
    this.game.suspended = true;
    this.input.enabled = false;
    this.input.releaseAll();
    this.stack = [];
    this._open('pause');
    this._updatePauseButton();
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
    this._updatePauseButton();
  }

  /** Callback del gioco (main.js li collega a game.onMatchEnd / onRestart). */
  onMatchEnd(outcome) {
    this.mode = 'ended';
    this._updatePauseButton();
    const ov = $('overlay-matchend');
    $('matchend-title').textContent = this.i18n.t(`matchEnd.${outcome}`);
    $('matchend-subtitle').textContent = this.i18n.t(`matchEnd.${outcome}Subtitle`);
    const summary = this.game.matchSummary;
    this._renderScoreboard($('scoreboard'), summary);
    this._renderCareer($('matchend-career'), summary.xpAfter, summary.xpBefore);
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
    const parts = [];
    if (xpBefore !== null) parts.push(i18n.t('career.gained', { xp: xp - xpBefore }));
    parts.push(p.next ? i18n.t('career.progress', { xp, next: p.next.xp }) : i18n.t('career.xp', { xp }));
    parts.push(p.next ? i18n.t('career.next', { rank: i18n.t(`ranks.${p.next.id}.name`) }) : i18n.t('career.maxRank'));
    info.append(name, bar, el('div', 'career-xp', parts.join(' · ')));
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
    this._layout();
    // tastiera: fuoco sul primo pulsante (con il mouse il fuoco non si vede, :focus-visible)
    const first = this.screens[name].querySelector('.menu-item:not([disabled]), .map-card:not([disabled])');
    first?.focus({ preventScroll: true });
    this.screens[name].scrollTop = 0;
  }

  _hide() {
    this._cancelRebind();
    this.root.classList.add('hidden');
  }

  /** Sposta la visuale della partita dimostrativa nella parte di schermo non coperta dal pannello. */
  _layout() {
    const { game } = this;
    if (this.mode !== 'menu') return;
    const k = this.cfg.attract?.panelOffset ?? 0.5;
    game.viewOffsetX = (this.panel.offsetWidth * k) / this.display.cssPerPixel;
  }

  _updatePauseButton() {
    const b = $('pause-button');
    b.classList.toggle('hidden', this.mode !== 'playing');
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
  }

  _mapInfo() {
    const info = el('div', 'map-info');
    info.append(el('strong', 'map-name'), el('span', 'map-meta'), el('span', 'map-desc'));
    return info;
  }

  /** Anteprima: la mappa pre-renderizzata dal TileMap, rimpicciolita, con basi e bandiere. */
  _thumbnail(level) {
    const k = this.cfg.thumbTile ?? 4;
    const map = new TileMap(level, this.assets.tileset(level.tileset));
    const c = el('canvas', 'map-thumb');
    c.width = map.cols * k;
    c.height = map.rows * k;
    const g = c.getContext('2d');
    g.imageSmoothingEnabled = true;
    g.drawImage(map.canvas, 0, 0, c.width, c.height);
    g.imageSmoothingEnabled = false;
    const teams = this.config.teams || {};
    const dot = (x, y, size, color) => {
      const px = Math.round((x / map.size) * k - size / 2);
      const py = Math.round((y / map.size) * k - size / 2);
      g.fillStyle = '#0b0b12';
      g.fillRect(px - 1, py - 1, size + 2, size + 2);
      g.fillStyle = color;
      g.fillRect(px, py, size, size);
    };
    for (const [team, p] of Object.entries(map.spawns)) dot(p.x, p.y, k + 2, teams[team]?.color || '#fff');
    const owners = level.flags || {};
    for (const f of map.flags) {
      const owner = owners[f.id]?.owner;
      dot(f.x, f.y, k, teams[owner]?.light || this.config.ctf?.look?.neutralColor || '#f0f0f0');
    }
    c.dataset.cols = map.cols;
    c.dataset.rows = map.rows;
    c.dataset.flags = map.flags.length;
    return c;
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
        this.choice[key] = clamp(this.choice[key] + d, l.min, l.max);
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
    for (const { card, lvl } of this.mapCards) card.setAttribute('aria-pressed', String(lvl.id === c.level));
    for (const { id, b } of this.teamButtons) b.setAttribute('aria-pressed', String(id === c.team));
    for (const [key, s] of Object.entries(this.steppers)) {
      const l = this.limits[key];
      s.value.textContent = String(c[key]);
      s.minus.disabled = c[key] <= l.min;
      s.plus.disabled = c[key] >= l.max;
    }
    $('newgame-summary').textContent = this.i18n.t('newGame.summary', { allies: c.allies, enemies: c.enemies });
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
      card.querySelector('.map-name').textContent = i18n.t(`levels.${lvl.id}.name`);
      card.querySelector('.map-meta').textContent = `${i18n.t('newGame.flags', { count: flags })} · ${i18n.t('newGame.size', { cols, rows })}`;
      card.querySelector('.map-desc').textContent = i18n.t(`levels.${lvl.id}.description`);
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
  }

  // ---------- Eventi ----------

  _attach() {
    this.root.addEventListener('click', (e) => {
      const t = e.target.closest('button');
      if (!t || t.disabled) return;
      if (t.dataset.go) this._open(t.dataset.go);
      else if (t.hasAttribute('data-back')) this._back();
      else if (t.dataset.action === 'start') this.startMatch();
      else if (t.dataset.action === 'resume') this.resume();
      else if (t.dataset.action === 'quit') this.showMain();
      else if (t.dataset.action === 'resetKeys') this._resetKeys();
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

    // pausa da touch
    const pb = $('pause-button');
    pb.addEventListener('pointerdown', (e) => e.stopPropagation()); // niente stick sotto il pulsante
    pb.addEventListener('click', () => this.pause());

    // tastiera: in "capture" per arrivare prima di Input
    window.addEventListener('keydown', (e) => this._onKey(e), true);
    window.addEventListener('resize', () => {
      this._layout();
      this._updatePauseButton();
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
