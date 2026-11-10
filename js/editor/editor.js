// Editor di mappe (editor.html): dimensioni, nome, descrizione, tile, oggetti (spawn, bandiere, armi a terra,
// decorazioni, mezzi), salvataggio/caricamento in JSON (stesso formato di config/levels) e prova della mappa nel
// gioco (index.html?test=1 legge il livello da localStorage, chiave game.json -> editor.testKey).
// Parametri in game.json -> editor; testi in config/lang/*.json -> editor.

import { loadJSON } from '../engine/loader.js';
import { I18n } from '../engine/i18n.js';
import { Assets, drawSprite } from '../engine/assets.js';
import { TileMap } from '../engine/tilemap.js';
import { checkGrid } from '../engine/levelcheck.js';
import { Settings } from '../settings.js';
import { EditorMap, formatLevel, objectKey } from './model.js';
import { MapView } from './view.js';

const $ = (id) => document.getElementById(id);

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

const TOOLS = { pencil: 'KeyB', line: 'KeyL', rect: 'KeyR', rectOutline: 'KeyU', fill: 'KeyG', picker: 'KeyI', erase: 'KeyE' };
const TOOL_ICONS = { pencil: '✎', line: '╱', rect: '■', rectOutline: '□', fill: '▧', picker: '⊙', erase: '⌫' };
/** Oggetti piazzati con un solo clic (niente trascinamento, forme o pennello grande). */
const SINGLE = new Set(['spawn', 'flag', 'vehicle']);

/** Celle di una linea (Bresenham). */
function lineCells(a, b) {
  const out = [];
  let { x, y } = a;
  const dx = Math.abs(b.x - x);
  const dy = -Math.abs(b.y - y);
  const sx = x < b.x ? 1 : -1;
  const sy = y < b.y ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    out.push({ x, y });
    if (x === b.x && y === b.y) break;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y += sy;
    }
  }
  return out;
}

class Editor {
  constructor(env) {
    Object.assign(this, env);
    // armi e mezzi con i "defaults" del loro file già applicati (come in gioco: Weapons / VehicleTypes)
    const withDefaults = (cfg, key) => {
      const d = cfg?.defaults || {};
      return { ...cfg, [key]: Object.fromEntries(Object.entries(cfg?.[key] || {}).map(([id, v]) => [id, { ...d, ...v, id }])) };
    };
    this.weaponsCfg = withDefaults(env.weaponsCfg, 'weapons');
    this.vehiclesCfg = withDefaults(env.vehiclesCfg, 'vehicles');
    env = { ...env, weaponsCfg: this.weaponsCfg, vehiclesCfg: this.vehiclesCfg };
    this.cfg = env.config.editor || {};
    this.teams = Object.keys(env.config.teams || {});
    this.map = new EditorMap({ tilesetDefs: env.assetsCfg.tilesets || {}, teams: this.teams });
    this.view = new MapView($('ed-canvas'), {
      assets: env.assets,
      config: env.config,
      vehicleTypes: env.vehiclesCfg.vehicles || {},
      weapons: env.weaponsCfg.weapons || {},
    });
    this.view.state = { showGrid: true, showObjects: true, preview: false, symmetry: 'none', check: null };
    this.tool = 'pencil';
    this.prevTool = 'pencil';
    this.size = 1;
    this.symmetry = 'none';
    this.current = null; // { type: 'tile', brush } | { type: 'object', obj }
    this.objOpts = { team: null, angleDeg: 0, flagId: 'auto' };
    this.history = [];
    this.future = [];
    this._snap = null;
    this._changed = false;
    this.drag = null;
    this.hover = null;
    this.lastCell = null;
    this.panKey = false;
    this.fileHandle = null;
    this.fileName = null;
    this.dirty = false;
    this.timers = {};
    this.tab = 'tiles';
  }

  t(key, params) {
    return this.i18n.t(key, params);
  }

  /** Traduzione se esiste, altrimenti il testo di riserva (es. l'id di un tipo nuovo non ancora tradotto). */
  label(key, fallback) {
    return this.i18n.has(key) ? this.i18n.t(key) : fallback;
  }

  init() {
    this._buildStatic();
    this._attach();
    const draft = this._readDraft();
    if (draft?.level) {
      try {
        this._load(draft.level, { fileName: draft.fileName || null });
        this.dirty = !!draft.dirty;
        this._status(this.t('editor.status.draftRestored'));
      } catch (e) {
        console.warn('Draft not restored', e);
        this._newMap();
      }
    } else {
      this._newMap();
    }
    this._renderTexts();
  }

  // ---------- Costruzione dell'interfaccia ----------

  _buildStatic() {
    // tileset (anche nel dialogo "nuova mappa")
    for (const id of ['map-tileset', 'new-tileset']) {
      const s = $(id);
      for (const name of Object.keys(this.assetsCfg.tilesets || {})) s.append(new Option(name, name));
    }
    $('brush-size').max = String(this.cfg.maxBrush ?? 9);
    $('brush-size').value = '1';
    const ms = this.cfg.minSize || [24, 14];
    const mx = this.cfg.maxSize || [256, 256];
    for (const [id, i] of [['map-cols', 0], ['map-rows', 1], ['new-cols', 0], ['new-rows', 1]]) {
      $(id).min = String(ms[i]);
      $(id).max = String(mx[i]);
    }
    this.i18n.languageNames().then((names) => {
      const s = $('lang');
      for (const l of this.i18n.available) s.append(new Option(names[l], l));
      s.value = this.i18n.lang;
    });
  }

  _attach() {
    document.body.addEventListener('click', (e) => {
      const b = e.target.closest('[data-cmd]');
      if (b && !b.disabled) this._command(b.dataset.cmd);
      const tool = e.target.closest('[data-tool]');
      if (tool) this._setTool(tool.dataset.tool);
      const tab = e.target.closest('[data-tab]');
      if (tab) this._setTab(tab.dataset.tab);
    });

    $('file-input').addEventListener('change', async (e) => {
      const f = e.target.files?.[0];
      e.target.value = '';
      if (f) this._openText(await f.text(), f.name, null);
    });
    $('open-level').addEventListener('change', async (e) => {
      const lvl = (this.config.levels || []).find((l) => l.id === e.target.value);
      e.target.value = '';
      if (!lvl || !this._confirmDiscard()) return;
      try {
        const data = await loadJSON(lvl.file);
        this._load(data, { fileName: lvl.file.split('/').pop() });
        this._status(this.t('editor.status.opened', { file: lvl.file }));
      } catch (err) {
        this._status(this.i18n.error(err), 'error');
      }
    });
    $('lang').addEventListener('change', async (e) => {
      await this.i18n.setLanguage(e.target.value);
      this.settings.set('lang', this.i18n.lang);
      this._renderTexts();
    });

    // proprietà della mappa
    $('map-name').addEventListener('input', (e) => this._setMeta('name', e.target.value));
    $('map-desc').addEventListener('input', (e) => this._setMeta('description', e.target.value));
    // uscendo dal campo la digitazione successiva è un nuovo passo di "annulla"
    for (const id of ['map-name', 'map-desc']) $(id).addEventListener('blur', () => (this._typingKey = null));
    $('map-fill').addEventListener('change', (e) => this._setMeta('fill', e.target.value, true));
    $('map-weather').addEventListener('change', (e) => this._setMeta('weather', e.target.value || null, true));
    $('map-bg').addEventListener('change', (e) => this._setMeta('background', e.target.value, true));
    $('map-tileset').addEventListener('change', (e) => this._changeTileset(e.target.value));

    // strumenti e vista
    $('brush-size').addEventListener('input', (e) => this._setSize(Number(e.target.value)));
    $('symmetry').addEventListener('change', (e) => {
      this.symmetry = e.target.value;
      this.view.state.symmetry = this.symmetry;
      this.view.invalidate();
    });
    $('show-grid').addEventListener('change', (e) => this._toggleView('showGrid', e.target.checked));
    $('show-objects').addEventListener('change', (e) => this._toggleView('showObjects', e.target.checked));
    $('show-preview').addEventListener('change', (e) => this._toggleView('preview', e.target.checked));

    // dialogo "nuova mappa"
    $('new-tileset').addEventListener('change', () => this._fillNewDialogTiles());
    $('dlg-new').addEventListener('close', () => {
      if ($('dlg-new').returnValue === 'create') this._createFromDialog();
    });

    // canvas
    const c = $('ed-canvas');
    c.addEventListener('pointerdown', (e) => this._onDown(e));
    c.addEventListener('pointermove', (e) => this._onMove(e));
    c.addEventListener('pointerup', (e) => this._onUp(e));
    c.addEventListener('pointercancel', (e) => this._onUp(e));
    c.addEventListener('pointerleave', () => {
      this.hover = null;
      this._updateHover();
    });
    c.addEventListener('contextmenu', (e) => e.preventDefault());
    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      const r = c.getBoundingClientRect();
      this._zoomStep(e.deltaY < 0 ? 1 : -1, e.clientX - r.left, e.clientY - r.top);
    }, { passive: false });

    window.addEventListener('keydown', (e) => this._onKey(e));
    window.addEventListener('keyup', (e) => {
      if (e.code === 'Space') this.panKey = false;
    });
    window.addEventListener('blur', () => (this.panKey = false));
  }

  _command(cmd) {
    switch (cmd) {
      case 'new':
        this._openNewDialog();
        break;
      case 'open':
        this._open();
        break;
      case 'save':
        this._save(false);
        break;
      case 'saveAs':
        this._save(true);
        break;
      case 'undo':
        this._undo();
        break;
      case 'redo':
        this._redo();
        break;
      case 'test':
        this._test();
        break;
      case 'resize':
        this._resize();
        break;
      case 'zoomIn':
        this._zoomStep(1);
        break;
      case 'zoomOut':
        this._zoomStep(-1);
        break;
      case 'fit':
        this.view.fit();
        this._renderZoom();
        break;
    }
  }

  // ---------- Testi (anche al cambio lingua) ----------

  _renderTexts() {
    this.i18n.applyToDOM();
    document.title = `${this.config.title || 'BAF2D'} · ${this.t('editor.title')}`;
    $('ed-message-text').textContent = this.t('loading');
    for (const b of document.querySelectorAll('[data-tool]')) {
      const tool = b.dataset.tool;
      b.textContent = TOOL_ICONS[tool];
      const key = TOOLS[tool].replace('Key', '');
      b.title = `${this.t(`editor.tools.${tool}`)} (${key})`;
      b.setAttribute('aria-label', b.title);
    }
    const help = $('help-list');
    help.textContent = '';
    for (const line of this.i18n.list('editor.help.lines')) help.append(el('li', null, line));
    const open = $('open-level');
    open.textContent = '';
    const first = new Option(this.t('editor.openLevel'), '');
    first.disabled = true;
    open.append(first);
    for (const l of this.config.levels || []) open.append(new Option(this.label(`levels.${l.id}.name`, l.id), l.id));
    open.value = '';
    const weather = $('map-weather');
    weather.textContent = '';
    weather.append(new Option(this.t('editor.map.noWeather'), ''));
    for (const w of Object.keys(this.effectsCfg.weather || {})) weather.append(new Option(this.label(`editor.weather.${w}`, w), w));
    this._renderMeta();
    this._renderPalette();
    this._renderFlags();
    this._runCheck();
    this._renderTool();
    this._renderZoom();
    this._renderUndo();
    this._updateHover();
  }

  /** Nome leggibile di un tile ("grass3" -> "Erba 3"). */
  tileLabel(name) {
    const m = /^(.*?)(\d+)$/.exec(name);
    const base = m ? m[1] : name;
    const text = this.label(`editor.tileNames.${base}`, base);
    return m ? `${text} ${m[2]}` : text;
  }

  brushLabel(b) {
    const br = this.map.brushes[b];
    if (!br) return '';
    if (br.names.length === 1) return this.tileLabel(br.names[0]);
    const base = br.names[0].replace(/\d+$/, '');
    const all = br.names.every((n) => n.replace(/\d+$/, '') === base);
    const name = all ? this.label(`editor.tileNames.${base}`, base) : br.names.map((n) => this.tileLabel(n)).join(' / ');
    return this.t(br.weights ? 'editor.palette.weighted' : 'editor.palette.variants', { name, count: br.names.length });
  }

  objectLabel(o) {
    const teamName = (t) => (t ? this.label(`teams.${t}`, t) : this.t('editor.objects.neutral'));
    switch (o.kind) {
      case 'spawn':
        return this.t('editor.objects.spawnOf', { team: teamName(o.team) });
      case 'flag':
        return o.id ? this.t('editor.objects.flagId', { id: o.id }) : this.t('editor.objects.flag');
      case 'pickup': {
        const p = this.config.pickups?.types?.[o.type];
        if (p?.weapon) {
          const w = this.weaponsCfg.weapons?.[p.weapon];
          return this.label(w?.name || `weapons.${p.weapon}`, p.weapon); // stesso nome dell'HUD in gioco
        }
        if (p?.grenades) return this.t('editor.objects.grenades', { count: p.grenades });
        return o.type;
      }
      case 'prop':
        return this.label(`editor.props.${o.type}`, o.type);
      case 'vehicle': {
        const v = this.vehiclesCfg.vehicles?.[o.type];
        const name = v?.name ? this.label(v.name, o.type) : o.type;
        if (o.angleDeg === undefined) return name;
        return `${name} · ${teamName(o.team)} · ${o.angleDeg}°`;
      }
    }
    return o.kind;
  }

  // ---------- Stato della mappa ----------

  get tileset() {
    return this.assets.tileset(this.map.meta.tileset);
  }

  _newMap() {
    const n = this.cfg.newMap || {};
    const ts = this.assetsCfg.tilesets?.[n.tileset] ? n.tileset : Object.keys(this.assetsCfg.tilesets)[0];
    const defs = this.map.tileDefs(ts);
    const border = n.border ? defs.find((t) => t.solid && !t.shootThrough)?.name : null;
    this._create({ cols: n.cols ?? 97, rows: n.rows ?? 65, tileset: ts, base: this._defaultBase(ts), border, name: this.t('editor.newMap.defaultName') });
  }

  /** Base predefinita: il gruppo di varianti del primo tile percorribile, se c'è. */
  _defaultBase(ts) {
    const defs = this.map.tileDefs(ts);
    const first = defs.find((t) => !t.solid)?.name || defs[0]?.name;
    const group = this._groups(ts).find((g) => g[0] === first);
    return group || first;
  }

  _create({ cols, rows, tileset, base, border, name }) {
    this.map.reset(cols, rows, tileset, base, border);
    this.map.meta.name = name || '';
    this.history = [];
    this.future = [];
    this.fileHandle = null;
    this.fileName = null;
    this.dirty = false;
    this._afterMapChange(true);
    this.current = null;
    this._selectTile(this.map.tiles[Math.floor(rows / 2) * cols + Math.floor(cols / 2)]);
    this.view.fit();
    this._renderZoom();
    this._scheduleSave();
  }

  _load(level, { fileName = null, handle = null } = {}) {
    const { warnings } = this.map.fromLevel(level, this.i18n.lang);
    this.history = [];
    this.future = [];
    this.fileHandle = handle;
    this.fileName = fileName;
    this.dirty = false;
    this._afterMapChange(true);
    if (!this.current || (this.current.type === 'tile' && !this.map.brushValid(this.current.brush))) {
      this.current = null;
      this._selectTile(this.map.tiles[Math.floor(this.map.rows / 2) * this.map.cols + Math.floor(this.map.cols / 2)]);
    }
    this.view.fit();
    this._renderZoom();
    for (const w of warnings) this._status(this.t(w.key, w.params), 'warn');
    this._scheduleSave();
  }

  /** Dopo un cambio che tocca tutta la mappa (nuova, caricata, ridimensionata, annulla/ripeti). */
  _afterMapChange(full) {
    this._typingKey = null;
    if (full) this.view.setMap(this.map, this.tileset);
    this._renderMeta();
    this._renderPalette();
    this._renderFlags();
    this._renderUndo();
    this._scheduleChecks();
  }

  _setMeta(key, value, render = false) {
    if (this.map.meta[key] === value) return;
    // nome e descrizione: tutta la digitazione nello stesso campo è un solo passo di "annulla"
    // (altrimenti ogni lettera fotograferebbe la mappa e riempirebbe la cronologia)
    const text = key === 'name' || key === 'description';
    if (text && this._typingKey === key) {
      this.map.meta[key] = value;
      this.dirty = true;
      this._scheduleSave();
      return;
    }
    this._begin();
    this.map.meta[key] = value;
    this._changed = true;
    this._commit();
    if (text) this._typingKey = key; // azzerato dalla prossima modifica di altro tipo (_commit, _afterMapChange)
    if (key === 'background') this.view.invalidate();
    if (render) this._renderMeta();
  }

  _changeTileset(ts) {
    if (ts === this.map.meta.tileset) return;
    const fallback = this.map.tileDefs(ts).find((t) => !t.solid)?.name || this.map.tileDefs(ts)[0]?.name;
    let missing = 0;
    for (let i = 0; i < this.map.tiles.length; i++) if (!this.map.brushValid(this.map.tiles[i], ts)) missing++;
    if (missing && !confirm(this.t('editor.confirm.tileset', { count: missing, tile: this.tileLabel(fallback) }))) {
      $('map-tileset').value = this.map.meta.tileset;
      return;
    }
    this._begin();
    this.map.changeTileset(ts, fallback);
    this._changed = true;
    this._commit();
    this._afterMapChange(true);
    if (this.current?.type === 'tile' && !this.map.brushValid(this.current.brush)) {
      this.current = null;
      this._selectTile(this.map.brush(this._defaultBase(ts)));
    }
  }

  _resize() {
    const ms = this.cfg.minSize || [24, 14];
    const mx = this.cfg.maxSize || [256, 256];
    const cols = clamp(Math.round(Number($('map-cols').value) || this.map.cols), ms[0], mx[0]);
    const rows = clamp(Math.round(Number($('map-rows').value) || this.map.rows), ms[1], mx[1]);
    if (cols === this.map.cols && rows === this.map.rows) {
      this._renderMeta();
      return;
    }
    this._begin();
    this.map.resize(cols, rows, $('resize-anchor').value, this.map.brush(this.map.meta.fill));
    this._changed = true;
    this._commit();
    this._afterMapChange(true);
    this.view.fit();
    this._renderZoom();
    this._status(this.t('editor.status.resized', { cols, rows }));
  }

  _renderMeta() {
    const m = this.map.meta;
    if (document.activeElement !== $('map-name')) $('map-name').value = m.name || '';
    if (document.activeElement !== $('map-desc')) $('map-desc').value = m.description || '';
    $('map-tileset').value = m.tileset;
    $('map-cols').value = String(this.map.cols);
    $('map-rows').value = String(this.map.rows);
    const fill = $('map-fill');
    fill.textContent = '';
    for (const t of this.map.tileDefs()) fill.append(new Option(this.tileLabel(t.name), t.name));
    fill.value = m.fill;
    $('map-weather').value = m.weather || '';
    $('map-bg').value = /^#[0-9a-f]{6}$/i.test(m.background || '') ? m.background : this.config.display?.background || '#000000';
  }

  // ---------- Annulla / ripeti ----------

  /** Inizio di una modifica: fotografa lo stato (una sola volta per pennellata). */
  _begin() {
    if (!this._snap) this._snap = this.map.snapshot();
  }

  _commit() {
    if (!this._snap) return;
    if (this._changed) {
      this.history.push(this._snap);
      const limit = this.cfg.undoLimit ?? 120;
      if (this.history.length > limit) this.history.splice(0, this.history.length - limit);
      this.future = [];
      this.dirty = true;
      this._renderFlags();
      this._renderUndo();
      this._scheduleChecks();
    }
    this._snap = null;
    this._changed = false;
    this._typingKey = null;
  }

  _undo() {
    if (this._snap || !this.history.length) return;
    this.future.push(this.map.snapshot());
    this.map.restore(this.history.pop());
    this.dirty = true;
    this._afterMapChange(true);
  }

  _redo() {
    if (this._snap || !this.future.length) return;
    this.history.push(this.map.snapshot());
    this.map.restore(this.future.pop());
    this.dirty = true;
    this._afterMapChange(true);
  }

  _renderUndo() {
    document.querySelector('[data-cmd="undo"]').disabled = !this.history.length;
    document.querySelector('[data-cmd="redo"]').disabled = !this.future.length;
  }

  // ---------- Modifiche alle celle ----------

  _setTile(i, b, touched) {
    if (this.map.tiles[i] === b) return;
    this.map.tiles[i] = b;
    touched.push(i);
    this._changed = true;
  }

  _setObj(i, o) {
    if (objectKey(this.map.objects.get(i)) === objectKey(o)) return;
    this.map.setObject(i, o);
    this._changed = true;
  }

  /** Celle del pennello attorno a (x, y) (quadrato di lato "size"). */
  _footprint(x, y, size = this.size) {
    const out = [];
    const o = Math.floor((size - 1) / 2);
    for (let j = 0; j < size; j++) {
      for (let i = 0; i < size; i++) {
        const cx = x - o + i;
        const cy = y - o + j;
        if (this.map.inside(cx, cy)) out.push({ x: cx, y: cy });
      }
    }
    return out;
  }

  _expand(cells) {
    const seen = new Set();
    const out = [];
    for (const c of cells) {
      for (const f of this._footprint(c.x, c.y)) {
        const i = this.map.index(f.x, f.y);
        if (seen.has(i)) continue;
        seen.add(i);
        out.push(f);
      }
    }
    return out;
  }

  /** Celle + celle speculari (simmetria), senza doppioni. */
  _withMirror(cells) {
    const seen = new Set();
    const out = [];
    const add = (x, y) => {
      if (!this.map.inside(x, y)) return;
      const i = this.map.index(x, y);
      if (seen.has(i)) return;
      seen.add(i);
      out.push({ x, y, i });
    };
    for (const c of cells) {
      add(c.x, c.y);
      const m = this.map.mirror(c.x, c.y, this.symmetry);
      if (m) add(m[0], m[1]);
    }
    return out;
  }

  get _currentSingle() {
    return this.current?.type === 'object' && SINGLE.has(this.current.obj.kind);
  }

  /** Applica lo strumento corrente alle celle (erase = toglie gli oggetti). */
  _applyCells(cells, erase = false) {
    const touched = [];
    const cur = this.current;
    if (!cur && !erase) return;
    if (erase) {
      for (const c of this._withMirror(cells)) this._setObj(c.i, null);
    } else if (cur.type === 'tile') {
      for (const c of this._withMirror(cells)) this._setTile(c.i, cur.brush, touched);
    } else if (SINGLE.has(cur.obj.kind)) {
      this._placeSingle(cells[cells.length - 1]);
    } else {
      const o = cur.obj;
      const baseTile = o.kind === 'prop' ? this.cfg.propTiles?.[o.type] : null;
      const tb = baseTile && this.map.tileDef(baseTile) ? this.map.brush(baseTile) : null;
      for (const c of this._withMirror(cells)) {
        this._setObj(c.i, { kind: o.kind, type: o.type });
        if (tb !== null) this._setTile(c.i, tb, touched);
      }
    }
    if (touched.length) this.view.drawCells(touched);
    else this.view.invalidate();
  }

  /** Spawn, bandiere e mezzi: un oggetto per clic (+ quello speculare con la squadra scambiata). */
  _placeSingle(c) {
    const map = this.map;
    const o = this.current.obj;
    const i = map.index(c.x, c.y);
    const m = map.mirror(c.x, c.y, this.symmetry);
    const mi = m ? map.index(m[0], m[1]) : -1;
    const hasMirror = mi >= 0 && mi !== i;
    if (o.kind === 'flag') {
      const ids = [...(this.cfg.flagIds || 'ABCDEFGHIJKLMNOPQRSTUVWXYZ')];
      const here = map.objects.get(i);
      const id = this.objOpts.flagId !== 'auto' ? this.objOpts.flagId : here?.kind === 'flag' ? here.id : map.freeFlagId(ids);
      if (!id) {
        this._status(this.t('editor.status.noFlagIds'), 'warn');
        return;
      }
      // bandiera gemella: quella che stava nella cella speculare della vecchia posizione
      const old = map.flagCells().find((f) => f.id === id);
      let partner = null;
      if (old && hasMirror) {
        const om = map.mirror(old.x, old.y, this.symmetry);
        const po = map.objects.get(map.index(om[0], om[1]));
        if (po?.kind === 'flag' && po.id !== id) partner = po.id;
      }
      this._setObj(i, { kind: 'flag', id });
      if (hasMirror) {
        const there = map.objects.get(mi);
        const mid = there?.kind === 'flag' && there.id !== id ? there.id : partner || map.freeFlagId(ids, id);
        if (mid && mid !== id) {
          const wasOnMap = map.flagCells().some((f) => f.id === mid);
          this._setObj(mi, { kind: 'flag', id: mid });
          if (!wasOnMap) map.flags[mid] = { ...map.flags[mid], owner: map.otherTeam(map.flags[id]?.owner ?? null) };
        }
      }
    } else if (o.kind === 'spawn') {
      this._setObj(i, { kind: 'spawn', team: o.team });
      const other = map.otherTeam(o.team);
      if (hasMirror && other !== o.team) this._setObj(mi, { kind: 'spawn', team: other });
    } else if (o.kind === 'vehicle') {
      const v = { kind: 'vehicle', type: o.type, team: this.objOpts.team, angleDeg: this.objOpts.angleDeg };
      this._setObj(i, v);
      if (hasMirror) this._setObj(mi, map.mirrorObject(v, this.symmetry));
    }
  }

  /** Riempimento: tutte le celle collegate con lo stesso pennello. */
  _flood(x, y) {
    const map = this.map;
    if (this.current?.type !== 'tile') {
      this._applyCells([{ x, y }]);
      return;
    }
    const target = map.tiles[map.index(x, y)];
    if (target === this.current.brush) return;
    const seen = new Uint8Array(map.cols * map.rows);
    const cells = [];
    const stack = [[x, y]];
    seen[map.index(x, y)] = 1;
    while (stack.length) {
      const [cx, cy] = stack.pop();
      cells.push({ x: cx, y: cy });
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = cx + dx;
        const ny = cy + dy;
        if (!map.inside(nx, ny)) continue;
        const ni = map.index(nx, ny);
        if (seen[ni] || map.tiles[ni] !== target) continue;
        seen[ni] = 1;
        stack.push([nx, ny]);
      }
    }
    this._applyCells(cells);
  }

  /** Celle della forma in corso (linea, rettangolo pieno o vuoto) tra a e b. */
  _shapeCells(tool, a, b) {
    if (tool === 'line') return this._expand(lineCells(a, b));
    const x0 = Math.min(a.x, b.x);
    const x1 = Math.max(a.x, b.x);
    const y0 = Math.min(a.y, b.y);
    const y1 = Math.max(a.y, b.y);
    const out = [];
    if (tool === 'rect') {
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (this.map.inside(x, y)) out.push({ x, y });
      return out;
    }
    // contorno spesso quanto il pennello, verso l'interno
    const t = this.size;
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const edge = x - x0 < t || x1 - x < t || y - y0 < t || y1 - y < t;
        if (edge && this.map.inside(x, y)) out.push({ x, y });
      }
    }
    return out;
  }

  /** Contagocce: oggetto (se visibile) o pennello della cella. */
  _pick(x, y) {
    if (!this.map.inside(x, y)) return;
    const i = this.map.index(x, y);
    const o = this.map.objects.get(i);
    if (o && this.view.state.showObjects) {
      if (o.kind === 'vehicle') Object.assign(this.objOpts, { team: o.team ?? null, angleDeg: o.angleDeg ?? 0 });
      if (o.kind === 'flag') this.objOpts.flagId = o.id;
      const base = o.kind === 'flag' ? { kind: 'flag' } : o.kind === 'vehicle' ? { kind: 'vehicle', type: o.type } : { ...o };
      this._selectObject(base);
    } else {
      this._selectTile(this.map.tiles[i]);
    }
    if (this.tool === 'picker') this._setTool(this.prevTool);
  }

  // ---------- Puntatore ----------

  _cellOf(e) {
    const r = $('ed-canvas').getBoundingClientRect();
    return this.view.cellAt(e.clientX - r.left, e.clientY - r.top);
  }

  _onDown(e) {
    const c = $('ed-canvas');
    c.setPointerCapture(e.pointerId);
    c.focus?.();
    document.activeElement?.blur?.();
    if (e.button === 1 || (e.button === 0 && this.panKey)) {
      e.preventDefault();
      this.drag = { type: 'pan', x: e.clientX, y: e.clientY };
      c.classList.add('panning');
      return;
    }
    const cell = this._cellOf(e);
    if (e.button === 2) {
      this._pick(cell.x, cell.y);
      return;
    }
    if (e.button !== 0 || !this.map.inside(cell.x, cell.y)) return;
    const tool = this.tool;
    if (tool === 'picker') {
      this._pick(cell.x, cell.y);
      return;
    }
    if (tool === 'fill') {
      this._begin();
      this._flood(cell.x, cell.y);
      this._commit();
      return;
    }
    if (tool !== 'erase' && this._currentSingle) {
      this._begin();
      this._applyCells([cell]);
      this._commit();
      this.lastCell = cell;
      return;
    }
    if (tool === 'pencil' || tool === 'erase') {
      this._begin();
      const from = e.shiftKey && this.lastCell ? this.lastCell : cell;
      this._applyCells(this._expand(lineCells(from, cell)), tool === 'erase');
      this.drag = { type: 'stroke', last: cell };
      this.lastCell = cell;
      return;
    }
    // linea / rettangoli: anteprima fino al rilascio (linea con Shift: dall'ultimo punto)
    const start = tool === 'line' && e.shiftKey && this.lastCell ? this.lastCell : cell;
    this.drag = { type: 'shape', tool, start, end: cell };
    this.view.state.toolCells = this._shapeCells(tool, start, cell);
    this.view.invalidate();
  }

  _onMove(e) {
    const d = this.drag;
    if (d?.type === 'pan') {
      this.view.pan(e.clientX - d.x, e.clientY - d.y);
      d.x = e.clientX;
      d.y = e.clientY;
      return;
    }
    const cell = this._cellOf(e);
    const same = this.hover && this.hover.x === cell.x && this.hover.y === cell.y;
    this.hover = cell;
    if (same) return;
    if (d?.type === 'stroke') {
      const a = { x: clamp(d.last.x, -1, this.map.cols), y: clamp(d.last.y, -1, this.map.rows) };
      this._applyCells(this._expand(lineCells(a, { x: clamp(cell.x, -1, this.map.cols), y: clamp(cell.y, -1, this.map.rows) })), this.tool === 'erase');
      d.last = cell;
      if (this.map.inside(cell.x, cell.y)) this.lastCell = cell;
    } else if (d?.type === 'shape') {
      d.end = { x: clamp(cell.x, 0, this.map.cols - 1), y: clamp(cell.y, 0, this.map.rows - 1) };
      this.view.state.toolCells = this._shapeCells(d.tool, d.start, d.end);
    }
    this._updateHover();
  }

  _onUp(e) {
    const d = this.drag;
    this.drag = null;
    $('ed-canvas').classList.remove('panning');
    if (!d) return;
    if (d.type === 'stroke') this._commit();
    else if (d.type === 'shape') {
      const cells = this.view.state.toolCells || [];
      this.view.state.toolCells = null;
      if (e.type !== 'pointercancel' && cells.length) {
        this._begin();
        this._applyCells(cells);
        this._commit();
        this.lastCell = d.end;
      }
      this.view.invalidate();
    }
  }

  _updateHover() {
    const h = this.hover;
    const st = this.view.state;
    if (!h || !this.map.inside(h.x, h.y)) {
      st.hoverCells = null;
      $('status-cell').textContent = '';
      this.view.invalidate();
      return;
    }
    const big = ['pencil', 'erase', 'line', 'rectOutline'].includes(this.tool) && !this._currentSingle;
    st.hoverCells = big ? this._footprint(h.x, h.y) : [h];
    const i = this.map.index(h.x, h.y);
    const name = this.map.resolvedName(h.x, h.y);
    const def = this.map.tileDef(name);
    const parts = [`${h.x}, ${h.y}`, this.tileLabel(name)];
    if (def?.solid) parts.push(this.t(def.shootThrough ? 'editor.palette.shootThrough' : 'editor.palette.solid'));
    const o = this.map.objects.get(i);
    if (o) parts.push(this.objectLabel(o));
    $('status-cell').textContent = parts.join(' · ');
    this.view.invalidate();
  }

  // ---------- Tastiera ----------

  _onKey(e) {
    if ($('dlg-new').open) return;
    const typing = e.target instanceof HTMLElement && e.target.matches('input:not([type="checkbox"]):not([type="range"]), textarea, select');
    if (e.ctrlKey || e.metaKey) {
      const k = e.code;
      let done = true;
      if (k === 'KeyZ' && !typing) e.shiftKey ? this._redo() : this._undo();
      else if (k === 'KeyY' && !typing) this._redo();
      else if (k === 'KeyS') this._save(e.shiftKey);
      else if (k === 'KeyO') this._open();
      else if (k === 'Enter' || k === 'NumpadEnter') this._test();
      else done = false;
      if (done) e.preventDefault();
      return;
    }
    if (typing || e.altKey) return;
    const tool = Object.keys(TOOLS).find((t) => TOOLS[t] === e.code);
    if (tool) {
      this._setTool(tool);
      return;
    }
    switch (e.code) {
      case 'Space':
        this.panKey = true;
        e.preventDefault();
        break;
      case 'BracketLeft':
        this._setSize(this.size - 1);
        break;
      case 'BracketRight':
        this._setSize(this.size + 1);
        break;
      case 'Equal':
      case 'NumpadAdd':
        this._zoomStep(1);
        break;
      case 'Minus':
      case 'NumpadSubtract':
        this._zoomStep(-1);
        break;
      case 'Digit0':
      case 'Numpad0':
        this.view.fit();
        this._renderZoom();
        break;
      case 'KeyH':
        $('show-grid').click();
        break;
      case 'KeyO':
        $('show-objects').click();
        break;
      case 'KeyP':
        $('show-preview').click();
        break;
      case 'Escape':
        if (this.drag?.type === 'shape') {
          this.drag = null;
          this.view.state.toolCells = null;
          this.view.invalidate();
        }
        break;
    }
  }

  // ---------- Strumenti e vista ----------

  _setTool(tool) {
    if (!TOOLS[tool]) return;
    if (tool === 'picker' && this.tool !== 'picker') this.prevTool = this.tool;
    this.tool = tool;
    this._renderTool();
    this._updateHover();
  }

  _renderTool() {
    for (const b of document.querySelectorAll('[data-tool]')) b.setAttribute('aria-pressed', String(b.dataset.tool === this.tool));
    $('ed-canvas').dataset.tool = this.tool;
  }

  _setSize(n) {
    this.size = clamp(Math.round(n) || 1, 1, this.cfg.maxBrush ?? 9);
    $('brush-size').value = String(this.size);
    $('brush-size-value').textContent = `${this.size}×${this.size}`;
    this._updateHover();
  }

  _toggleView(key, on) {
    this.view.state[key] = on;
    if (key === 'preview') {
      if (on) this._buildPreview();
      else this.view.preview = null;
    }
    this.view.invalidate();
  }

  _zoomStep(dir, cx, cy) {
    const levels = this.cfg.zoom?.levels || [1];
    let k = 0;
    for (let i = 0; i < levels.length; i++) if (Math.abs(levels[i] - this.view.zoom) < Math.abs(levels[k] - this.view.zoom)) k = i;
    const z = levels[clamp(k + dir, 0, levels.length - 1)];
    this.view.setZoom(z, cx, cy);
    this._renderZoom();
  }

  _renderZoom() {
    $('zoom-value').textContent = `${Math.round(this.view.zoom * 100)}%`;
    this._setSize(this.size);
  }

  // ---------- Tavolozza ----------

  _setTab(tab) {
    this.tab = tab;
    for (const b of document.querySelectorAll('[data-tab]')) b.setAttribute('aria-pressed', String(b.dataset.tab === tab));
    for (const p of document.querySelectorAll('[data-pane]')) p.classList.toggle('hidden', p.dataset.pane !== tab);
    this._renderOptions();
  }

  /** Gruppi di varianti del tileset: "sand", "sand2", "sand3"... -> una lista. */
  _groups(ts = this.map.meta.tileset) {
    const defs = this.map.tileDefs(ts);
    const names = new Set(defs.map((d) => d.name));
    const groups = new Map();
    for (const d of defs) {
      const m = /^(.*?)(\d+)$/.exec(d.name);
      if (!m || !names.has(m[1])) continue;
      if (!groups.has(m[1])) groups.set(m[1], [m[1]]);
      groups.get(m[1]).push(d.name);
    }
    return [...groups.values()];
  }

  _tileIcon(brush, size = 32) {
    const c = el('canvas', 'ed-icon');
    c.width = size;
    c.height = size;
    const g = c.getContext('2d');
    g.imageSmoothingEnabled = false;
    const ts = this.tileset;
    const s = ts.size;
    const names = this.map.brushes[brush]?.names || [];
    const draw = (name, dx, dy, dw) => {
      const t = ts.byName.get(name);
      if (t) g.drawImage(ts.image, (t.index % ts.cols) * s, Math.floor(t.index / ts.cols) * s, s, s, dx, dy, dw, dw);
    };
    if (names.length === 1) draw(names[0], 0, 0, size);
    else for (let k = 0; k < 4; k++) draw(names[k % names.length], (k % 2) * (size / 2), Math.floor(k / 2) * (size / 2), size / 2);
    return c;
  }

  _objectIcon(o, size = 32) {
    const c = el('canvas', 'ed-icon');
    c.width = size;
    c.height = size;
    const g = c.getContext('2d');
    g.imageSmoothingEnabled = false;
    const cfg = this.config;
    const sprite = (name, team) => {
      try {
        return name ? this.assets.sprite(name, team) : null;
      } catch (e) {
        return null;
      }
    };
    let sp = null;
    if (o.kind === 'spawn') {
      g.strokeStyle = cfg.teams?.[o.team]?.color || '#fff';
      g.lineWidth = 2;
      g.beginPath();
      g.arc(size / 2, size / 2, size / 2 - 2, 0, Math.PI * 2);
      g.stroke();
      sp = sprite(cfg.player?.sprite || 'soldier_rifle', o.team);
    } else if (o.kind === 'flag') {
      const look = cfg.ctf?.look || {};
      g.fillStyle = look.baseColor || '#4a4a56';
      g.fillRect(9, 26, 10, 4);
      g.fillStyle = look.poleColor || '#c8c8d0';
      g.fillRect(13, 4, 2, 24);
      g.fillStyle = look.neutralColor || '#f0f0f0';
      g.fillRect(15, 5, 12, 8);
      return c;
    } else if (o.kind === 'pickup') {
      const p = cfg.pickups?.types?.[o.type];
      const w = p?.weapon ? this.weaponsCfg.weapons?.[p.weapon] : null;
      sp = sprite(w?.pickupSprite || (p?.grenades ? cfg.pickups?.grenadeSprite : null));
    } else if (o.kind === 'prop') {
      sp = sprite(cfg.props?.types?.[o.type]?.sprite || o.type);
    } else if (o.kind === 'vehicle') {
      const v = this.vehiclesCfg.vehicles?.[o.type];
      sp = sprite(v?.sprite);
      const tur = sprite(v?.turretSprite);
      if (sp) {
        const k = Math.min(2, (size - 2) / Math.max(sp.fw, sp.fh));
        g.setTransform(k, 0, 0, k, size / 2, size / 2);
        drawSprite(g, sp, 0, 0, 0, 0);
        if (tur) drawSprite(g, tur, 0, (v.turretPivot || [0, 0])[0], (v.turretPivot || [0, 0])[1], 0);
        return c;
      }
    }
    if (sp) {
      const k = Math.min(2, (size - 2) / Math.max(sp.fw, sp.fh));
      g.setTransform(k, 0, 0, k, size / 2, size / 2);
      drawSprite(g, sp, 0, 0, 0, 0);
    }
    return c;
  }

  _paletteButton(icon, title, selected, onClick, key) {
    const b = el('button', 'ed-swatch');
    b.type = 'button';
    b.dataset.sel = key; // per evidenziare la scelta senza ricostruire la tavolozza (_markSelection)
    b.title = title;
    b.setAttribute('aria-label', title);
    b.setAttribute('aria-pressed', String(selected));
    b.append(icon);
    b.addEventListener('click', onClick);
    return b;
  }

  _renderPalette() {
    if (!this.map) return;
    // tile: gruppi di varianti, tile singoli, poi altri pennelli usati nella mappa (es. varianti con pesi)
    const box = $('palette-tiles');
    box.textContent = '';
    const listed = new Set();
    const section = (titleKey, brushes) => {
      if (!brushes.length) return;
      box.append(el('h3', 'ed-sub', this.t(titleKey)));
      const grid = el('div', 'ed-grid');
      for (const b of brushes) {
        listed.add(b);
        const def = this.map.tileDef(this.map.brushes[b].names[0]);
        let title = this.brushLabel(b);
        if (def?.solid) title += ` · ${this.t(def.shootThrough ? 'editor.palette.shootThrough' : 'editor.palette.solid')}`;
        const sel = this.current?.type === 'tile' && this.current.brush === b;
        grid.append(this._paletteButton(this._tileIcon(b), title, sel, () => this._selectTile(b), `tile:${b}`));
      }
      box.append(grid);
    };
    const groups = this._groups().map((g) => this.map.brush(g));
    const singles = this.map.tileDefs().map((d) => this.map.brush(d.name));
    const used = [...new Set(this.map.tiles)].filter((b) => this.map.brushValid(b) && !groups.includes(b) && !singles.includes(b));
    section('editor.palette.groups', groups);
    section('editor.palette.single', singles);
    section('editor.palette.inMap', used);
    if (this.current?.type === 'tile' && !listed.has(this.current.brush)) section('editor.palette.inMap', [this.current.brush]);

    // oggetti
    const obox = $('palette-objects');
    obox.textContent = '';
    const cfg = this.config;
    const groupsObj = [
      ['editor.objects.spawns', this.teams.map((team) => ({ kind: 'spawn', team }))],
      ['editor.objects.flags', [{ kind: 'flag' }]],
      ['editor.objects.pickups', Object.keys(cfg.pickups?.types || {}).map((type) => ({ kind: 'pickup', type }))],
      ['editor.objects.props', Object.keys(cfg.props?.types || {}).map((type) => ({ kind: 'prop', type }))],
      ['editor.objects.vehicles', Object.keys(this.vehiclesCfg.vehicles || {}).map((type) => ({ kind: 'vehicle', type }))],
    ];
    for (const [key, list] of groupsObj) {
      if (!list.length) continue;
      obox.append(el('h3', 'ed-sub', this.t(key)));
      const grid = el('div', 'ed-grid');
      for (const o of list) {
        const sel = this.current?.type === 'object' && objectKey(this.current.obj) === objectKey(o);
        grid.append(this._paletteButton(this._objectIcon(o), this.objectLabel(o), sel, () => this._selectObject(o), `obj:${objectKey(o)}`));
      }
      obox.append(grid);
    }
    this._setTab(this.tab);
    this._renderCurrent();
  }

  _selectTile(b) {
    this.current = { type: 'tile', brush: b };
    if (this.tool === 'erase') this._setTool('pencil');
    this._setTabSilently('tiles');
    this._markSelection(`tile:${b}`);
    this._updateHover();
  }

  _selectObject(o) {
    this.current = { type: 'object', obj: o };
    if (this.tool === 'erase') this._setTool('pencil');
    this._setTabSilently('objects');
    this._markSelection(`obj:${objectKey(o)}`);
    this._updateHover();
  }

  /**
   * Evidenzia la scelta nella tavolozza già costruita (niente icone ridisegnate a ogni clic); se il pulsante non
   * c'è (pennello nuovo, non ancora nella tavolozza) la ricostruisce.
   */
  _markSelection(key) {
    const buttons = document.querySelectorAll('#palette-tiles .ed-swatch, #palette-objects .ed-swatch');
    if (![...buttons].some((b) => b.dataset.sel === key)) {
      this._renderPalette();
      return;
    }
    for (const b of buttons) b.setAttribute('aria-pressed', String(b.dataset.sel === key));
    this._setTab(this.tab);
    this._renderCurrent();
  }

  _setTabSilently(tab) {
    this.tab = tab;
  }

  _renderCurrent() {
    const box = $('current');
    box.textContent = '';
    const cur = this.current;
    if (!cur) return;
    if (cur.type === 'tile') {
      const def = this.map.tileDef(this.map.brushes[cur.brush]?.names[0]);
      box.append(this._tileIcon(cur.brush, 40));
      const info = el('div', 'ed-current-info');
      info.append(el('strong', null, this.brushLabel(cur.brush)));
      info.append(el('span', null, this.t(def?.solid ? (def.shootThrough ? 'editor.palette.shootThrough' : 'editor.palette.solid') : 'editor.palette.walkable')));
      box.append(info);
    } else {
      box.append(this._objectIcon(cur.obj, 40));
      const info = el('div', 'ed-current-info');
      info.append(el('strong', null, this.objectLabel(cur.obj)));
      if (cur.obj.kind === 'prop' && this.cfg.propTiles?.[cur.obj.type] && this.map.tileDef(this.cfg.propTiles[cur.obj.type])) {
        info.append(el('span', null, this.t('editor.objects.withTile', { tile: this.tileLabel(this.cfg.propTiles[cur.obj.type]) })));
      }
      box.append(info);
    }
    this._renderOptions();
  }

  /** Opzioni dell'oggetto scelto: squadra e direzione per i mezzi, lettera per le bandiere. */
  _renderOptions() {
    const box = $('object-options');
    box.textContent = '';
    const o = this.current?.type === 'object' ? this.current.obj : null;
    box.classList.toggle('hidden', !o || this.tab !== 'objects' || !['vehicle', 'flag'].includes(o.kind));
    if (!o) return;
    const field = (labelKey, select) => {
      const l = el('label', 'ed-field');
      l.append(el('span', null, this.t(labelKey)), select);
      box.append(l);
    };
    if (o.kind === 'vehicle') {
      const team = el('select', 'ed-select');
      team.append(new Option(this.t('editor.objects.neutral'), ''));
      for (const t of this.teams) team.append(new Option(this.label(`teams.${t}`, t), t));
      team.value = this.objOpts.team || '';
      team.addEventListener('change', () => (this.objOpts.team = team.value || null));
      field('editor.objects.team', team);
      const angle = el('select', 'ed-select');
      for (const a of this.cfg.angles || [0, 90, 180, 270]) angle.append(new Option(`${a}°`, String(a)));
      angle.value = String(this.objOpts.angleDeg);
      angle.addEventListener('change', () => (this.objOpts.angleDeg = Number(angle.value)));
      field('editor.objects.angle', angle);
    } else if (o.kind === 'flag') {
      const id = el('select', 'ed-select');
      id.append(new Option(this.t('editor.objects.flagAuto'), 'auto'));
      for (const l of this.cfg.flagIds || 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') id.append(new Option(l, l));
      id.value = this.objOpts.flagId;
      id.addEventListener('change', () => (this.objOpts.flagId = id.value));
      field('editor.objects.flagLetter', id);
      box.append(el('p', 'ed-note', this.t('editor.objects.flagHint')));
    }
  }

  // ---------- Bandiere ----------

  _renderFlags() {
    const box = $('flag-list');
    box.textContent = '';
    const flags = this.map.flagCells();
    if (!flags.length) {
      box.append(el('p', 'ed-note', this.t('editor.flags.empty')));
      return;
    }
    const def = this.config.ctf?.flag || {};
    const head = el('div', 'ed-flag-row head');
    for (const k of ['id', 'owner', 'radius', 'captureTime']) head.append(el('span', null, this.t(`editor.flags.${k}`)));
    head.append(el('span'));
    box.append(head);
    const ids = [...(this.cfg.flagIds || 'ABCDEFGHIJKLMNOPQRSTUVWXYZ')];
    for (const f of flags) {
      const s = this.map.flags[f.id] || {};
      const row = el('div', 'ed-flag-row');
      const idSel = el('select', 'ed-select');
      for (const l of new Set([f.id, ...ids])) idSel.append(new Option(l, l));
      idSel.value = f.id;
      idSel.addEventListener('change', () => this._renameFlag(f.id, idSel.value));
      const owner = el('select', 'ed-select');
      owner.append(new Option(this.t('editor.objects.neutral'), ''));
      for (const t of this.teams) owner.append(new Option(this.label(`teams.${t}`, t), t));
      owner.value = s.owner || '';
      owner.addEventListener('change', () => this._flagSetting(f.id, 'owner', owner.value || null));
      const num = (key, placeholder) => {
        const n = el('input', 'ed-num');
        n.type = 'number';
        n.min = '1';
        n.step = '1';
        n.placeholder = String(placeholder ?? '');
        n.value = s[key] !== undefined ? String(s[key]) : '';
        n.addEventListener('change', () => this._flagSetting(f.id, key, n.value === '' ? undefined : Math.max(1, Number(n.value))));
        return n;
      };
      const actions = el('span', 'ed-flag-actions');
      const go = el('button', 'ed-btn icon', '⌖');
      go.type = 'button';
      go.title = this.t('editor.flags.goTo');
      go.addEventListener('click', () => this.view.centerOn(f.x, f.y));
      const del = el('button', 'ed-btn icon', '✕');
      del.type = 'button';
      del.title = this.t('editor.flags.remove');
      del.addEventListener('click', () => {
        this._begin();
        this._setObj(f.i, null);
        this._commit();
        this.view.invalidate();
      });
      actions.append(go, del);
      row.append(idSel, owner, num('radius', def.radius), num('captureTime', def.captureTime), actions);
      box.append(row);
    }
  }

  _flagSetting(id, key, value) {
    this._begin();
    const f = { owner: null, ...this.map.flags[id] };
    if (value === undefined) delete f[key];
    else f[key] = value;
    this.map.flags[id] = f;
    this._changed = true;
    this._commit();
    this.view.invalidate();
  }

  /** Cambia lettera a una bandiera (se la nuova è già usata, le due si scambiano). */
  _renameFlag(from, to) {
    if (from === to) return;
    const map = this.map;
    const a = map.flagCells().find((f) => f.id === from);
    const b = map.flagCells().find((f) => f.id === to);
    if (!a) return;
    this._begin();
    const sa = map.flags[from];
    const sb = map.flags[to];
    map.objects.set(a.i, { kind: 'flag', id: to });
    if (b) map.objects.set(b.i, { kind: 'flag', id: from });
    map.flags[to] = sa || { owner: null };
    if (sb) map.flags[from] = sb;
    else delete map.flags[from];
    this._changed = true;
    this._commit();
    this.view.invalidate();
  }

  // ---------- Controllo ----------

  _scheduleChecks() {
    this._later('check', this.cfg.checkDelay ?? 0.8, () => this._runCheck());
    this._later('save', this.cfg.autosaveDelay ?? 1, () => this._saveDraft());
    if (this.view.state.preview) this._later('preview', this.cfg.previewDelay ?? 0.4, () => this._buildPreview());
  }

  _scheduleSave() {
    this._later('save', this.cfg.autosaveDelay ?? 1, () => this._saveDraft());
  }

  _later(name, seconds, fn) {
    clearTimeout(this.timers[name]);
    this.timers[name] = setTimeout(fn, seconds * 1000);
  }

  /** Problemi della mappa: errori (il gioco non funziona bene) e avvisi (regole delle mappe: vicoli ciechi...). */
  _runCheck() {
    const map = this.map;
    const items = [];
    const at = (x, y) => ({ x, y });
    const spawns = map.spawnCells();
    for (const team of this.teams) {
      const s = spawns.find((p) => p.team === team);
      const name = this.label(`teams.${team}`, team);
      if (!s) items.push({ level: 'error', text: this.t('editor.check.noSpawn', { team: name }) });
      else if (map.isSolid(s.x, s.y)) items.push({ level: 'error', text: this.t('editor.check.spawnSolid', { team: name }), cell: at(s.x, s.y) });
    }
    const flags = map.flagCells();
    if (!flags.length) items.push({ level: 'error', text: this.t('editor.check.noFlags') });
    for (const f of flags) if (map.isSolid(f.x, f.y)) items.push({ level: 'warn', text: this.t('editor.check.flagSolid', { id: f.id }), cell: at(f.x, f.y) });
    const known = {
      pickup: this.config.pickups?.types || {},
      prop: this.config.props?.types || {},
      vehicle: this.vehiclesCfg.vehicles || {},
    };
    for (const [i, o] of map.objects) {
      const x = i % map.cols;
      const y = Math.floor(i / map.cols);
      if (known[o.kind] && !known[o.kind][o.type]) items.push({ level: 'warn', text: this.t('editor.check.unknownObject', { type: o.type }), cell: at(x, y) });
      else if ((o.kind === 'pickup' || o.kind === 'vehicle') && map.isSolid(x, y)) items.push({ level: 'warn', text: this.t('editor.check.objectSolid', { name: this.objectLabel(o) }), cell: at(x, y) });
    }
    let result = null;
    try {
      result = checkGrid(map.walkGrid());
    } catch (e) {
      console.warn('Level check failed', e);
    }
    if (result?.unreachable) {
      const c = result.unreachableCells[0];
      items.push({ level: 'warn', text: this.t('editor.check.unreachable', { count: result.unreachable }), cell: at(c % map.cols, Math.floor(c / map.cols)) });
    }
    for (const d of result?.deadEnds || []) {
      items.push({ level: 'warn', text: this.t('editor.check.deadEnd', { x: d.x, y: d.y, depth: d.depth, width: d.scale }), cell: at(Math.round((d.box[0] + d.box[2]) / 2), Math.round((d.box[1] + d.box[3]) / 2)) });
    }
    this.checkItems = items;
    this.view.state.check = result;
    this.view.invalidate();
    const list = $('check-list');
    list.textContent = '';
    if (!items.length) list.append(el('li', 'ok', this.t('editor.check.ok')));
    for (const it of items) {
      const li = el('li', it.level, it.text);
      if (it.cell) {
        li.classList.add('link');
        li.title = this.t('editor.flags.goTo');
        li.addEventListener('click', () => this.view.centerOn(it.cell.x, it.cell.y));
      }
      list.append(li);
    }
  }

  _buildPreview() {
    try {
      const tm = new TileMap(this.map.toLevel(this.cfg.legendChars), this.tileset);
      this.view.preview = tm.canvas;
    } catch (e) {
      console.warn('Preview failed', e);
      this.view.preview = null;
    }
    this.view.invalidate();
  }

  // ---------- File ----------

  _level() {
    return this.map.toLevel(this.cfg.legendChars);
  }

  _suggestedName() {
    if (this.fileName) return this.fileName;
    const slug = (this.map.meta.name || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');
    return `${slug || 'map'}.json`;
  }

  _confirmDiscard() {
    return !this.dirty || confirm(this.t('editor.confirm.discard'));
  }

  async _save(as) {
    const text = formatLevel(this._level());
    const types = [{ description: this.t('editor.fileType'), accept: { 'application/json': ['.json'] } }];
    if (window.showSaveFilePicker) {
      try {
        if (!this.fileHandle || as) this.fileHandle = await window.showSaveFilePicker({ suggestedName: this._suggestedName(), types });
        const w = await this.fileHandle.createWritable();
        await w.write(text);
        await w.close();
        this.fileName = this.fileHandle.name;
        this._saved();
        return;
      } catch (e) {
        if (e.name === 'AbortError') return;
        console.warn('File System Access save failed, downloading instead', e);
        this.fileHandle = null;
      }
    }
    // riserva: download del file
    const a = el('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    a.download = this._suggestedName();
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    this.fileName = a.download;
    this._saved();
  }

  _saved() {
    this.dirty = false;
    this._saveDraft();
    this._status(this.t('editor.status.saved', { file: this.fileName }));
  }

  async _open() {
    if (!this._confirmDiscard()) return;
    if (window.showOpenFilePicker) {
      try {
        const [h] = await window.showOpenFilePicker({ types: [{ description: this.t('editor.fileType'), accept: { 'application/json': ['.json'] } }] });
        const f = await h.getFile();
        this._openText(await f.text(), f.name, h);
        return;
      } catch (e) {
        if (e.name === 'AbortError') return;
        console.warn('File System Access open failed', e);
      }
    }
    $('file-input').click();
  }

  _openText(text, name, handle) {
    let level;
    try {
      level = JSON.parse(text);
    } catch (e) {
      this._status(this.t('editor.errors.json', { file: name, details: e.message }), 'error');
      return;
    }
    try {
      this._load(level, { fileName: name, handle });
      this._status(this.t('editor.status.opened', { file: name }));
    } catch (e) {
      this._status(e.key ? this.t(e.key, e.params) : e.message, 'error');
    }
  }

  // ---------- Bozza automatica e prova ----------

  _readDraft() {
    try {
      const raw = localStorage.getItem(this.cfg.storageKey || 'baf2d.editor');
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  _saveDraft() {
    try {
      localStorage.setItem(this.cfg.storageKey || 'baf2d.editor', JSON.stringify({ level: this._level(), fileName: this.fileName, dirty: this.dirty }));
    } catch (e) {
      console.warn(`Draft not saved (${e.message})`);
    }
  }

  /** Prova: il livello va in localStorage e index.html?test=1 lo apre (scheda riusata a ogni prova). */
  _test() {
    this._runCheck();
    const errors = (this.checkItems || []).filter((i) => i.level === 'error');
    if (errors.length && !confirm(this.t('editor.confirm.testWithErrors', { errors: errors.map((e) => `• ${e.text}`).join('\n') }))) return;
    try {
      localStorage.setItem(this.cfg.testKey || 'baf2d.editorTest', JSON.stringify(this._level()));
    } catch (e) {
      this._status(this.t('editor.errors.storage'), 'error');
      return;
    }
    const w = window.open(`index.html?test=1&lang=${encodeURIComponent(this.i18n.lang)}`, 'baf2d-test');
    if (!w) this._status(this.t('editor.errors.popup'), 'error');
    else this._status(this.t('editor.status.testing'));
  }

  // ---------- Nuova mappa ----------

  _openNewDialog() {
    if (!this._confirmDiscard()) return;
    const n = this.cfg.newMap || {};
    $('new-name').value = this.t('editor.newMap.defaultName');
    $('new-cols').value = String(n.cols ?? 97);
    $('new-rows').value = String(n.rows ?? 65);
    $('new-tileset').value = this.map.meta.tileset;
    $('new-border-on').checked = n.border !== false;
    this._fillNewDialogTiles();
    $('dlg-new').showModal();
  }

  _fillNewDialogTiles() {
    const ts = $('new-tileset').value;
    const base = $('new-base');
    const border = $('new-border');
    base.textContent = '';
    border.textContent = '';
    for (const g of this._groups(ts)) {
      const b = this.map.brush(g);
      if (!this.map.tileDef(g[0], ts)?.solid) base.append(new Option(this.brushLabel(b), JSON.stringify(g)));
    }
    for (const d of this.map.tileDefs(ts)) {
      const o = new Option(this.tileLabel(d.name), JSON.stringify(d.name));
      if (d.solid) border.append(o);
      else base.append(o);
    }
    const def = this._defaultBase(ts);
    base.value = JSON.stringify(def);
    const wall = this.map.tileDefs(ts).find((t) => t.solid && !t.shootThrough);
    if (wall) border.value = JSON.stringify(wall.name);
  }

  _createFromDialog() {
    const ms = this.cfg.minSize || [24, 14];
    const mx = this.cfg.maxSize || [256, 256];
    const cols = clamp(Math.round(Number($('new-cols').value) || 97), ms[0], mx[0]);
    const rows = clamp(Math.round(Number($('new-rows').value) || 65), ms[1], mx[1]);
    const parse = (v) => {
      try {
        return JSON.parse(v);
      } catch (e) {
        return null;
      }
    };
    this._create({
      cols,
      rows,
      tileset: $('new-tileset').value,
      base: parse($('new-base').value),
      border: $('new-border-on').checked ? parse($('new-border').value) : null,
      name: $('new-name').value.trim(),
    });
    this._status(this.t('editor.status.created', { cols, rows }));
  }

  // ---------- Stato ----------

  _status(text, level = 'info') {
    const s = $('status-msg');
    s.textContent = text;
    s.className = level;
    clearTimeout(this.timers.status);
    this.timers.status = setTimeout(() => {
      s.textContent = '';
      s.className = '';
    }, level === 'info' ? 5000 : 10000);
  }
}

async function boot() {
  const i18n = new I18n();
  let i18nReady = false;
  const msg = $('ed-message');
  try {
    const config = await loadJSON('config/game.json');
    const settings = new Settings(config.menu?.storageKey);
    await i18n.load(config.i18n, settings.get('lang', null));
    i18nReady = true;
    i18n.applyToDOM();
    $('ed-message-text').textContent = i18n.t('loading');
    const [assetsCfg, effectsCfg, weaponsCfg, vehiclesCfg] = await Promise.all([
      loadJSON(config.assets),
      loadJSON(config.effects),
      loadJSON(config.weapons),
      config.vehicles ? loadJSON(config.vehicles) : {},
    ]);
    const assets = new Assets();
    await assets.load(assetsCfg, config.teams);
    const editor = new Editor({ config, i18n, settings, assets, assetsCfg, effectsCfg, weaponsCfg, vehiclesCfg });
    editor.init();
    msg.classList.add('hidden');
    window.BAF2D_EDITOR = editor; // debug da console
  } catch (e) {
    console.error(e);
    $('ed-message-text').textContent = i18nReady ? i18n.error(e) : e.message;
  }
}

boot();
