// Scena animata dietro al menu principale: ripresa dall'alto della camera termica di un drone che sorvola di notte
// una città in guerra nel deserto. Il mondo (strade, isolati, rovine, accampamenti) è infinito e procedurale
// (js/menu_art.js, pezzi da 128 px disegnati su richiesta); sopra si muovono mezzi e pattuglie, scoppiano scontri a
// fuoco, esplosioni con crateri e incendi, passa un elicottero che lancia i flare. Tutto è disegnato in calore e poi
// convertito nella tavolozza del sensore (bianco caldo / nero caldo) con grana, retino, guadagno automatico
// (il lampo delle esplosioni abbaglia) e vignettatura; sopra l'HUD del drone (mirino, aggancio del bersaglio,
// rotta, coordinate). La camera segue il bersaglio agganciato. Parametri in config/menu_scene.json.

import {
  bayer, rnd, range, clamp, lerp, pick, hex, makeCanvas, heat, disc, ring, line,
  City, paintChunk, vehicleHeat, heatCanvas, heliHeat, drawText, textWidth,
} from './menu_art.js';

const CHUNK = 128;
const TAU = Math.PI * 2;

const angDiff = (a, b) => {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
};

export class MenuScene {
  constructor(canvas, cfg, i18n = null) {
    this.canvas = canvas;
    this.g = canvas.getContext('2d');
    this.cfg = cfg;
    this.i18n = i18n;
    this.city = new City(cfg.city || {}, cfg.seed ?? 11);
    this.chunks = new Map();
    this.viewLeft = 0;
    this.visible = false;
    this.raf = 0;
    this.t = 0;
    // centro della visuale in coordinate del mondo: si parte sopra un incrocio
    this.cx = this.city.roadX(2) + 30;
    this.cy = this.city.roadY(2) + 20;
    this.vx = 0;
    this.vy = 0;
    this.drift = Math.random() * TAU;
    for (const k of ['vehicles', 'squads', 'dogs', 'wrecks', 'craters', 'fires', 'smoke', 'exhaust', 'tracks', 'tracers', 'muzzles', 'sparks', 'booms', 'rockets', 'flares', 'helis', 'fights', 'queue']) this[k] = [];
    const T = (r, d) => range(r, d);
    this.timers = {
      boom: T(cfg.explosions?.firstDelay, [1.5, 3]),
      fight: T(cfg.firefight?.firstDelay, [0.5, 1.5]),
      heli: T(cfg.helicopter?.firstDelay, [5, 9]),
      mode: T(cfg.sensor?.modeInterval, [24, 36]),
    };
    this.flash = 0;
    this.dip = 0;
    this.shake = 0;
    this.glitch = 0;
    this.modeIdx = 0;
    this.track = null;
    this.trackAge = 0;
    this.trackDur = 0;
    this.trackNo = 1 + Math.floor(Math.random() * 20);
    this.recBase = 3600 + Math.floor(Math.random() * 7200);
    this.sprites = new Map();
    this._buildLuts();
    window.addEventListener('resize', () => {
      if (this.visible) this.resize();
    });
  }

  show() {
    if (this.visible) return;
    this.visible = true;
    this.canvas.classList.remove('hidden');
    this.resize();
    if (!this.warm) {
      // all'avvio mezzi, pattuglie, fumo e incendi sono già in scena
      this.warm = true;
      for (let i = 0; i < 160; i++) this.update(1 / 20);
    }
    let last = performance.now();
    const frame = (now) => {
      if (!this.visible) return;
      this.update(Math.min(0.1, (now - last) / 1000));
      last = now;
      this.render();
      this.raf = requestAnimationFrame(frame);
    };
    this.raf = requestAnimationFrame(frame);
  }

  hide() {
    this.visible = false;
    cancelAnimationFrame(this.raf);
    this.canvas.classList.add('hidden');
  }

  /** Larghezza in px CSS coperta dal pannello del menu: mirino e HUD stanno nella parte scoperta. */
  setViewLeft(px) {
    if (Math.abs(px - this.viewLeft) < 1) return;
    this.viewLeft = px;
    if (this.visible) this._layout();
  }

  resize() {
    const cw = window.innerWidth;
    const ch = window.innerHeight;
    this.scale = Math.max(1, Math.round(ch / (this.cfg.targetHeight ?? 240)));
    this.w = Math.ceil(cw / this.scale);
    this.h = Math.ceil(ch / this.scale);
    this.canvas.width = this.w;
    this.canvas.height = this.h;
    this.canvas.style.width = `${this.w * this.scale}px`;
    this.canvas.style.height = `${this.h * this.scale}px`;
    this.g.imageSmoothingEnabled = false;
    this.heatLayer = makeCanvas(this.w, this.h, true);
    this.out = this.g.createImageData(this.w, this.h);
    // vignettatura (moltiplicatore per pixel)
    const vs = this.cfg.sensor?.vignette ?? 0.5;
    this.vig = new Float32Array(this.w * this.h);
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        const dx = (x / this.w - 0.5) * 2;
        const dy = (y / this.h - 0.5) * 2;
        this.vig[y * this.w + x] = 1 - clamp((Math.hypot(dx * 0.85, dy) - 0.55) / 0.8, 0, 1) * vs;
      }
    }
    this._layout();
  }

  _layout() {
    const s = this.scale || 1;
    this.vx0 = Math.min(this.viewLeft / s, this.w * 0.6);
    this.vis = this.w - this.vx0;
    this.vcx = Math.round(this.vx0 + this.vis / 2);
    this.vcy = Math.round(this.h / 2);
  }

  /** Tavolozze del sensore: per ogni modo una tabella di `levels` colori (poi retinati tra un livello e l'altro). */
  _buildLuts() {
    const sc = this.cfg.sensor || {};
    const L = sc.levels ?? 40;
    const pals = this.cfg.palettes || { white: [[0, '#000000'], [1, '#ffffff']] };
    this.modes = (sc.modes || Object.keys(pals)).filter((m) => pals[m]);
    this.luts = {};
    for (const m of this.modes) {
      const stops = pals[m].map(([t, c]) => [t, hex(c)]);
      const lut = new Uint8Array(L * 3);
      for (let i = 0; i < L; i++) {
        const t = i / (L - 1);
        let c = stops[stops.length - 1][1];
        for (let s = 1; s < stops.length; s++) {
          if (t <= stops[s][0]) {
            const k = (t - stops[s - 1][0]) / Math.max(1e-6, stops[s][0] - stops[s - 1][0]);
            c = stops[s - 1][1].map((v, j) => v + (stops[s][1][j] - v) * k);
            break;
          }
        }
        lut[i * 3] = c[0];
        lut[i * 3 + 1] = c[1];
        lut[i * 3 + 2] = c[2];
      }
      this.luts[m] = lut;
    }
    this.levels = L;
  }

  _t(key, params, fallback) {
    const k = `menuScene.${key}`;
    const s = this.i18n ? this.i18n.t(k, params) : null;
    if (!s || s === k) return fallback.replace(/\{(\w+)\}/g, (m, p) => (params && p in params ? params[p] : m));
    return s;
  }

  // ---------- Mondo ----------

  _chunk(i, j) {
    const key = `${i},${j}`;
    let ch = this.chunks.get(key);
    if (!ch) {
      ch = { i, j, ...paintChunk(this.city, i * CHUNK, j * CHUNK, CHUNK, this.cfg) };
      for (const f of ch.fires) f.ph = Math.random() * 10;
      this.chunks.set(key, ch);
    }
    return ch;
  }

  /** Pezzi visibili (con un margine) e scarto di quelli lontani. */
  _visibleChunks() {
    const x0 = this.cx - this.vcx;
    const y0 = this.cy - this.vcy;
    const i0 = Math.floor((x0 - 16) / CHUNK);
    const i1 = Math.floor((x0 + this.w + 16) / CHUNK);
    const j0 = Math.floor((y0 - 16) / CHUNK);
    const j1 = Math.floor((y0 + this.h + 16) / CHUNK);
    const out = [];
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) out.push(this._chunk(i, j));
    if (this.chunks.size > (i1 - i0 + 5) * (j1 - j0 + 5)) {
      for (const [k, ch] of this.chunks) if (ch.i < i0 - 2 || ch.i > i1 + 2 || ch.j < j0 - 2 || ch.j > j1 + 2) this.chunks.delete(k);
    }
    return out;
  }

  _onScreen(x, y, m = 0) {
    const sx = x - (this.cx - this.vcx);
    const sy = y - (this.cy - this.vcy);
    return sx > this.vx0 - m && sx < this.w + m && sy > -m && sy < this.h + m;
  }

  // ---------- Chi si muove sulle strade (mezzi, pattuglie, cani) ----------

  _roadW(axis, k) {
    return axis === 'x' ? this.city.widthY(k) : this.city.widthX(k);
  }

  _place(m) {
    const c = this.city;
    const w = this._roadW(m.axis, m.k);
    const off = m.kind === 'vehicle' ? m.dir * Math.max(2, Math.round(w / 4)) : m.side * (w / 2 + 1.5);
    if (m.axis === 'x') {
      m.x = m.pos;
      m.y = c.roadY(m.k) + off;
    } else {
      m.x = c.roadX(m.k) - (m.kind === 'vehicle' ? off : -off);
      m.y = m.pos;
    }
  }

  _initNext(m) {
    const c = this.city;
    const k = m.axis === 'x' ? c.colAt(m.pos) : c.rowAt(m.pos);
    const at = m.axis === 'x' ? c.roadX(k) : c.roadY(k);
    m.next = m.dir > 0 ? k + 1 : at < m.pos ? k : k - 1;
  }

  _spawnMover(kind, near = false) {
    const cfg = this.cfg;
    const def = kind === 'vehicle' ? cfg.vehicles || {} : kind === 'squad' ? cfg.squads || {} : cfg.dogs || {};
    const [r0, r1] = def.spawnRadius || [170, 280];
    const a = Math.random() * TAU;
    const r = near ? rnd(0, r1) : rnd(r0, r1);
    const px = this.cx + Math.cos(a) * r;
    const py = this.cy + Math.sin(a) * r;
    const road = this.city.nearestRoad(px, py);
    const m = { kind, axis: road.axis, k: road.k, pos: road.axis === 'x' ? px : py, dir: Math.random() < 0.5 ? 1 : -1, side: Math.random() < 0.5 ? 1 : -1, dist: 0, ph: Math.random() * 10 };
    if (kind === 'vehicle') {
      const types = def.types || { truck: { speed: 22, weight: 1 } };
      let tot = 0;
      for (const v of Object.values(types)) tot += v.weight ?? 1;
      let q = Math.random() * tot;
      for (const [id, v] of Object.entries(types)) {
        q -= v.weight ?? 1;
        if (q <= 0) {
          m.type = id;
          m.base = v.speed ?? 20;
          break;
        }
      }
      m.type ||= Object.keys(types)[0];
      m.base ||= 20;
      m.tur = 0;
    } else if (kind === 'squad') {
      m.base = def.speed ?? 5;
      m.n = Math.round(range(def.size, [3, 6]));
    } else {
      m.base = def.speed ?? 10;
    }
    m.speed = m.base;
    this._initNext(m);
    this._place(m);
    m.dx = m.x;
    m.dy = m.y;
    m.ang = m.axis === 'x' ? (m.dir > 0 ? 0 : Math.PI) : m.dir > 0 ? Math.PI / 2 : -Math.PI / 2;
    if (kind === 'squad') {
      // scia della pattuglia: i compagni camminano sulle posizioni passate del capofila
      m.hist = [];
      const sp = cfg.squads?.spacing ?? 5;
      const back = m.n * sp + 2;
      for (let s = back; s >= 0; s--) {
        const pos = m.pos - m.dir * s;
        m.hist.push(m.axis === 'x' ? [pos, m.y] : [m.x, pos]);
      }
    }
    return m;
  }

  _moveMover(m, dt) {
    const c = this.city;
    if (!m.halt) {
      m.pos += m.dir * m.speed * dt;
      const at = m.axis === 'x' ? c.roadX(m.next) : c.roadY(m.next);
      if ((m.dir > 0 && m.pos >= at) || (m.dir < 0 && m.pos <= at)) {
        const straight = this.cfg[m.kind === 'vehicle' ? 'vehicles' : m.kind === 'squad' ? 'squads' : 'dogs']?.straight ?? 0.55;
        if (Math.random() < straight) m.next += m.dir;
        else {
          const oldK = m.k;
          const newPos = m.axis === 'x' ? c.roadY(oldK) : c.roadX(oldK);
          m.axis = m.axis === 'x' ? 'y' : 'x';
          m.k = m.next;
          m.pos = newPos;
          m.dir = Math.random() < 0.5 ? 1 : -1;
          m.next = oldK + m.dir;
        }
      }
    }
    this._place(m);
    const k = Math.min(1, dt * 7);
    const ox = m.dx;
    const oy = m.dy;
    m.dx += (m.x - m.dx) * k;
    m.dy += (m.y - m.dy) * k;
    const mv = Math.hypot(m.dx - ox, m.dy - oy);
    m.dist += mv;
    m.mvx = (m.dx - ox) / Math.max(1e-4, dt);
    m.mvy = (m.dy - oy) / Math.max(1e-4, dt);
    if (mv > 0.02) m.ang += angDiff(m.ang, Math.atan2(m.dy - oy, m.dx - ox)) * Math.min(1, dt * 9);
    return mv;
  }

  // ---------- Aggiornamento ----------

  update(dt) {
    const cfg = this.cfg;
    this.t += dt;
    if (!this.w) return;
    this.flash = Math.max(0, this.flash - dt * 7);
    this.dip = Math.max(0, this.dip - dt / (cfg.sensor?.agcRecover ?? 1.4));
    this.shake = Math.max(0, this.shake - dt * 3);

    this._updateCamera(dt);
    this._updatePopulation(dt);
    this._updateFights(dt);
    this._updateEvents(dt);
    this._updateParticles(dt);

    // cambio di polarità del sensore (bianco caldo <-> nero caldo) con un disturbo
    this.timers.mode -= dt;
    if (this.timers.mode <= 0 && this.modes.length > 1) {
      this.timers.mode = range(cfg.sensor?.modeInterval, [24, 36]);
      this.glitch = cfg.sensor?.glitch ?? 0.35;
      this.switched = false;
    }
    if (this.glitch > 0) {
      this.glitch -= dt;
      if (!this.switched && this.glitch < (cfg.sensor?.glitch ?? 0.35) / 2) {
        this.switched = true;
        this.modeIdx = (this.modeIdx + 1) % this.modes.length;
      }
    }
  }

  _updateCamera(dt) {
    const cc = this.cfg.camera || {};
    // aggancio: un mezzo o una pattuglia vicino al centro, cambiato ogni tanto
    this.trackAge += dt;
    const lost = this.track && !this.vehicles.includes(this.track) && !this.squads.includes(this.track);
    if (!this.track || lost || this.trackAge > this.trackDur) this._pickTrack();
    let tx;
    let ty;
    if (this.track) {
      const lead = cc.lead ?? 1.2;
      tx = this.track.dx + (this.track.mvx || 0) * lead;
      ty = this.track.dy + (this.track.mvy || 0) * lead;
    } else {
      this.drift += Math.sin(this.t * 0.1) * dt * 0.2;
      tx = this.cx + Math.cos(this.drift) * 40;
      ty = this.cy + Math.sin(this.drift) * 40;
    }
    const f = cc.follow ?? 0.9;
    const max = cc.maxSpeed ?? 45;
    let wx = (tx - this.cx) * f;
    let wy = (ty - this.cy) * f;
    const sp = Math.hypot(wx, wy);
    if (sp > max) {
      wx *= max / sp;
      wy *= max / sp;
    }
    const k = Math.min(1, dt * (cc.smooth ?? 1.6));
    this.vx += (wx - this.vx) * k;
    this.vy += (wy - this.vy) * k;
    this.cx += this.vx * dt;
    this.cy += this.vy * dt;
  }

  _pickTrack() {
    const cands = [];
    for (const v of this.vehicles) cands.push([v, this.cfg.camera?.vehicleWeight ?? 3]);
    for (const s of this.squads) cands.push([s, 1]);
    let best = null;
    let bestW = 0;
    for (const [m, w0] of cands) {
      if (m === this.track) continue;
      const d = Math.hypot(m.dx - this.cx, m.dy - this.cy);
      if (d > (this.cfg.camera?.trackRadius ?? 170)) continue;
      const w = (w0 / (1 + d / 50)) * (0.5 + Math.random());
      if (w > bestW) {
        best = m;
        bestW = w;
      }
    }
    if (!best && this.track && (this.vehicles.includes(this.track) || this.squads.includes(this.track))) best = this.track;
    if (best !== this.track) {
      this.track = best;
      this.trackAge = 0;
      this.trackNo = (this.trackNo % 99) + 1;
    }
    this.trackDur = range(this.cfg.camera?.trackTime, [9, 15]);
  }

  _updatePopulation(dt) {
    const cfg = this.cfg;
    const far = cfg.population?.despawn ?? 460;
    const near = !this.populated;
    this.populated = true;
    const keep = (m) => Math.hypot(m.dx - this.cx, m.dy - this.cy) < far;
    this.vehicles = this.vehicles.filter(keep);
    this.squads = this.squads.filter((s) => keep(s) || s.fight);
    this.dogs = this.dogs.filter(keep);
    while (this.vehicles.length < (cfg.vehicles?.count ?? 6)) this.vehicles.push(this._spawnMover('vehicle', near));
    while (this.squads.length < (cfg.squads?.count ?? 4)) this.squads.push(this._spawnMover('squad', near));
    while (this.dogs.length < (cfg.dogs?.count ?? 2)) this.dogs.push(this._spawnMover('dog', near));

    // mezzi: in coda dietro a chi va piano sulla stessa corsia; scarico caldo e (cingolati) tracce
    for (const v of this.vehicles) {
      let sp = v.base;
      for (const o of this.vehicles) {
        if (o === v || o.axis !== v.axis || o.k !== v.k || o.dir !== v.dir) continue;
        const gap = (o.pos - v.pos) * v.dir;
        if (gap > 0 && gap < 24) sp = Math.min(sp, gap < 15 ? 0 : o.speed);
      }
      v.speed += (sp - v.speed) * Math.min(1, dt * 3);
      const mv = this._moveMover(v, dt);
      const spr = vehicleHeat(v.type);
      const ca = Math.cos(v.ang);
      const sa = Math.sin(v.ang);
      const loc = (lx, ly) => [v.dx + lx * ca - ly * sa, v.dy + lx * sa + ly * ca];
      v.emit = (v.emit || 0) + dt * (cfg.vehicles?.exhaust ?? 14);
      while (v.emit > 1) {
        v.emit--;
        const [ex, ey] = loc(spr.engine[0] - spr.w / 2, spr.engine[1] - spr.h / 2);
        this.exhaust.push({ x: ex + rnd(-0.5, 0.5), y: ey + rnd(-0.5, 0.5), vx: -ca * 3 + rnd(-2, 2), vy: -sa * 3 + rnd(-2, 2), age: 0, life: rnd(0.8, 1.6) });
      }
      if (v.type === 'tank' || v.type === 'apc') {
        v.trackAcc = (v.trackAcc || 0) + mv;
        while (v.trackAcc > 1.5) {
          v.trackAcc -= 1.5;
          const hw = spr.h / 2 - 1;
          for (const s of [-1, 1]) {
            const [x, y] = loc(-spr.w / 2, s * hw);
            this.tracks.push({ x: Math.round(x), y: Math.round(y), age: 0 });
          }
        }
        // la torretta si guarda intorno (o punta lo scontro più vicino)
        const fight = this.fights.find((f) => Math.hypot(f.ex - v.dx, f.ey - v.dy) < 90);
        const want = fight ? Math.atan2(fight.ey - v.dy, fight.ex - v.dx) : v.ang + Math.sin(this.t * 0.25 + v.ph) * 1.1;
        v.tur += angDiff(v.tur, want) * Math.min(1, dt * 1.2);
      }
    }
    if (this.tracks.length > 1800) this.tracks.splice(0, this.tracks.length - 1800);

    // pattuglie: la scia del capofila, i compagni la seguono
    for (const s of this.squads) {
      this._moveMover(s, dt);
      const last = s.hist[s.hist.length - 1];
      if (Math.hypot(s.dx - last[0], s.dy - last[1]) >= 1) {
        s.hist.push([s.dx, s.dy]);
        const need = s.n * (cfg.squads?.spacing ?? 5) + 4;
        if (s.hist.length > need) s.hist.splice(0, s.hist.length - need);
      }
    }
    // cani randagi: corrono, si fermano ad annusare
    for (const d of this.dogs) {
      d.wait = (d.wait ?? rnd(1, 4)) - dt;
      if (d.wait <= 0) {
        d.halt = !d.halt;
        d.wait = d.halt ? rnd(1, 3) : rnd(2, 6);
      }
      this._moveMover(d, dt);
    }
  }

  /** Posizioni dei membri di una pattuglia: [{ x, y, a }]. */
  _members(s) {
    const sp = this.cfg.squads?.spacing ?? 5;
    const out = [];
    for (let i = 0; i < s.n; i++) {
      const idx = Math.max(0, s.hist.length - 1 - i * sp);
      const p = s.hist[idx];
      const q = s.hist[Math.max(0, idx - 2)];
      const a = Math.hypot(p[0] - q[0], p[1] - q[1]) > 0.5 ? Math.atan2(p[1] - q[1], p[0] - q[0]) : s.ang;
      out.push({ x: p[0], y: p[1], a });
    }
    return out;
  }

  _updateFights(dt) {
    const fc = this.cfg.firefight || {};
    this.timers.fight -= dt;
    if (this.timers.fight <= 0) {
      this.timers.fight = range(fc.interval, [3, 7]);
      const free = this.squads.filter((s) => !s.fight && this._onScreen(s.dx, s.dy, -10));
      if (free.length && this.fights.length < (fc.max ?? 2)) {
        const s = pick(free);
        // nemico dall'altra parte della strada, dentro l'isolato
        const w = this._roadW(s.axis, s.k);
        const across = -s.side * (w / 2 + rnd(12, 32));
        const along = rnd(-18, 18);
        const [ex, ey] = s.axis === 'x' ? [s.dx + along, s.dy + across] : [s.dx + across, s.dy + along];
        const f = { squad: s, ex, ey, age: 0, dur: range(fc.duration, [4, 8]), cdS: 0.3, cdE: rnd(0.6, 1.2), rpgAt: Math.random() < (fc.rpgChance ?? 0.3) ? rnd(1.5, 3.5) : -1 };
        s.fight = f;
        s.halt = true;
        this.fights.push(f);
      }
    }
    const shot = (x0, y0, x1, y1) => {
      const d = Math.hypot(x1 - x0, y1 - y0);
      const v = fc.tracerSpeed ?? 190;
      this.tracers.push({ x: x0, y: y0, vx: ((x1 - x0) / d) * v, vy: ((y1 - y0) / d) * v, age: 0, life: d / v });
      this.muzzles.push({ x: x0, y: y0, age: 0 });
    };
    for (const f of this.fights) {
      f.age += dt;
      const mem = this._members(f.squad);
      f.cdS -= dt;
      while (f.cdS <= 0) {
        f.cdS += range(fc.rate, [0.06, 0.3]);
        const m = pick(mem);
        const a = Math.atan2(f.ey - m.y, f.ex - m.x);
        shot(m.x + Math.cos(a) * 3, m.y + Math.sin(a) * 3, f.ex + rnd(-5, 5), f.ey + rnd(-5, 5));
      }
      f.cdE -= dt;
      while (f.cdE <= 0) {
        f.cdE += range(fc.enemyRate, [0.1, 0.45]);
        const m = pick(mem);
        const sx = f.ex + rnd(-3, 3);
        const sy = f.ey + rnd(-3, 3);
        shot(sx, sy, m.x + rnd(-6, 6), m.y + rnd(-6, 6));
      }
      if (f.rpgAt > 0 && f.age >= f.rpgAt) {
        f.rpgAt = -1;
        const m = pick(mem);
        const tx = m.x + rnd(-10, 10);
        const ty = m.y + rnd(-10, 10);
        const d = Math.hypot(tx - f.ex, ty - f.ey);
        const v = fc.rocketSpeed ?? 80;
        this.rockets.push({ x: f.ex, y: f.ey, vx: ((tx - f.ex) / d) * v, vy: ((ty - f.ey) / d) * v, age: 0, life: d / v });
        this.muzzles.push({ x: f.ex, y: f.ey, age: -0.05, big: true });
      }
      if (f.age > f.dur) {
        f.squad.fight = null;
        f.squad.halt = false;
      }
    }
    this.fights = this.fights.filter((f) => f.age <= f.dur);
  }

  _updateEvents(dt) {
    const cfg = this.cfg;
    const ex = cfg.explosions || {};
    // esplosioni: su un mezzo (distrutto), vicino al bersaglio agganciato o a caso nella visuale; a volte a salve
    this.timers.boom -= dt;
    if (this.timers.boom <= 0) {
      this.timers.boom = range(ex.interval, [4, 9]);
      const targets = this.vehicles.filter((v) => v !== this.track && this._onScreen(v.dx, v.dy, -8));
      if (targets.length && Math.random() < (ex.destroyChance ?? 0.35)) this._destroy(pick(targets));
      else {
        let x;
        let y;
        if (this.track && Math.random() < 0.6) {
          const a = Math.random() * TAU;
          const d = rnd(30, 80);
          x = this.track.dx + Math.cos(a) * d;
          y = this.track.dy + Math.sin(a) * d;
        } else {
          x = this.cx - this.vcx + rnd(this.vx0 + 10, this.w - 10);
          y = this.cy - this.vcy + rnd(10, this.h - 10);
        }
        const R = range(ex.radius, [5, 10]);
        this._boom(x, y, R);
        if (Math.random() < (ex.salvoChance ?? 0.3)) {
          const n = 1 + Math.floor(Math.random() * 3);
          for (let i = 0; i < n; i++) this.queue.push({ at: this.t + rnd(0.25, 1.2) * (i + 1), x: x + rnd(-30, 30), y: y + rnd(-30, 30), R: R * rnd(0.6, 1) });
        }
      }
    }
    for (const q of this.queue) if (this.t >= q.at) this._boom(q.x, q.y, q.R);
    this.queue = this.queue.filter((q) => this.t < q.at);

    // elicottero che attraversa la visuale (a volte lancia i flare)
    const hc = cfg.helicopter || {};
    this.timers.heli -= dt;
    if (this.timers.heli <= 0) {
      this.timers.heli = range(hc.interval, [14, 26]);
      const a = Math.random() * TAU;
      const d = hc.distance ?? 280;
      const side = rnd(-50, 50);
      this.helis.push({
        x: this.cx - Math.cos(a) * d - Math.sin(a) * side,
        y: this.cy - Math.sin(a) * d + Math.cos(a) * side,
        a, v: range(hc.speed, [40, 55]), age: 0, life: (d * 2) / range(hc.speed, [40, 55]) + 2,
        flareAt: Math.random() < (hc.flareChance ?? 0.6) ? rnd(0.35, 0.6) : -1,
        emit: 0,
      });
    }
    for (const hl of this.helis) {
      hl.age += dt;
      hl.x += Math.cos(hl.a) * hl.v * dt;
      hl.y += Math.sin(hl.a) * hl.v * dt;
      hl.a += Math.sin(this.t * 0.4 + hl.v) * 0.05 * dt;
      // scarico rovente delle turbine
      hl.emit += dt * 16;
      while (hl.emit > 1) {
        hl.emit--;
        const ca = Math.cos(hl.a);
        const sa = Math.sin(hl.a);
        for (const s of [-3, 3]) {
          this.exhaust.push({ x: hl.x - ca * 3 - sa * s, y: hl.y - sa * 3 + ca * s, vx: -ca * 14 + rnd(-3, 3), vy: -sa * 14 + rnd(-3, 3), age: 0, life: rnd(0.25, 0.5), hot: true, small: true });
        }
      }
      if (hl.flareAt > 0 && hl.age / hl.life > hl.flareAt) {
        hl.flareAt = -1;
        const n = Math.round(range(hc.flares, [8, 12]));
        for (let i = 0; i < n; i++) {
          const s = i % 2 ? 1 : -1;
          const spread = rnd(0.6, 1.6);
          const back = hl.a + Math.PI + s * spread;
          const v = rnd(25, 50);
          this.flares.push({ x: hl.x, y: hl.y, vx: Math.cos(hl.a) * hl.v * 0.6 + Math.cos(back) * v, vy: Math.sin(hl.a) * hl.v * 0.6 + Math.sin(back) * v, age: -i * 0.08, life: rnd(2.2, 3.4), tt: 0 });
        }
      }
    }
    this.helis = this.helis.filter((hl) => hl.age < hl.life);
  }

  _destroy(v) {
    this.vehicles = this.vehicles.filter((o) => o !== v);
    const spr = vehicleHeat(v.type);
    this.wrecks.push({ type: v.type, x: v.dx, y: v.dy, ang: v.ang, tur: v.tur, age: 0, life: this.cfg.explosions?.wreckLife ?? 80 });
    this._boom(v.dx, v.dy, Math.max(spr.w, spr.h) * 0.75, true);
  }

  _boom(x, y, R, big = false) {
    const ex = this.cfg.explosions || {};
    this.booms.push({ x, y, R, age: 0 });
    const n = Math.round(14 + R * 2.5);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU;
      const v = rnd(30, 110) * (R / 8);
      this.sparks.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, age: 0, life: rnd(0.4, 1.3) });
    }
    for (let i = 0; i < 4 + R * 0.6; i++) {
      const a = Math.random() * TAU;
      const v = rnd(4, 14);
      this.smoke.push({ x: x + Math.cos(a) * R * 0.4, y: y + Math.sin(a) * R * 0.4, vx: Math.cos(a) * v, vy: Math.sin(a) * v, age: 0, life: rnd(4, 8), r0: R * 0.4, r1: R * rnd(1, 1.8), h0: 0.5 });
    }
    this.craters.push({ x, y, r: R * 0.7, age: 0, life: ex.craterLife ?? 90 });
    if (big || Math.random() < (ex.fireChance ?? 0.6)) this.fires.push({ x, y, s: clamp(R / 8, 0.5, 1.6), age: 0, life: range(ex.fireLife, [18, 40]), ph: Math.random() * 10 });
    const k = R / 8;
    this.flash = Math.min(1, this.flash + (ex.flash ?? 0.5) * k);
    this.dip = Math.min(this.cfg.sensor?.agcMax ?? 0.55, this.dip + (this.cfg.sensor?.agcDip ?? 0.35) * k);
    this.shake = Math.min(1, this.shake + 0.5 * k);
  }

  _updateParticles(dt) {
    const fc = this.cfg.fires || {};
    const sm = fc.smoke || {};
    const [wx, wy] = fc.wind || [6, 3];
    // fumo dagli incendi (fissi dei pezzi di città e nuovi) nella visuale
    const emit = (f, s) => {
      if (Math.random() < dt * (fc.smokeRate ?? 3) * s && this.smoke.length < (sm.max ?? 500)) {
        this.smoke.push({ x: f.x + rnd(-1, 1), y: f.y + rnd(-1, 1), vx: rnd(-1.5, 1.5), vy: rnd(-1.5, 1.5), age: 0, life: range(sm.life, [6, 11]), r0: 1 + s, r1: range(sm.size, [4, 9]) * s, h0: sm.heat ?? 0.55 });
      }
    };
    for (const ch of this._visibleChunks()) for (const f of ch.fires) emit(f, f.s);
    for (const f of this.fires) {
      f.age += dt;
      emit(f, f.s * (1 - f.age / f.life));
    }
    this.fires = this.fires.filter((f) => f.age < f.life);
    for (const w of this.wrecks) {
      w.age += dt;
      emit(w, 1.2 * (1 - w.age / w.life));
    }
    this.wrecks = this.wrecks.filter((w) => w.age < w.life);
    for (const p of this.smoke) {
      p.age += dt;
      const k = Math.min(1, p.age / 2);
      p.x += (p.vx * (1 - k) + wx * k) * dt;
      p.y += (p.vy * (1 - k) + wy * k) * dt;
    }
    this.smoke = this.smoke.filter((p) => p.age < p.life);
    for (const p of this.exhaust) {
      p.age += dt;
      p.x += (p.vx + wx * 0.5) * dt;
      p.y += (p.vy + wy * 0.5) * dt;
    }
    this.exhaust = this.exhaust.filter((p) => p.age < p.life);
    if (this.exhaust.length > 700) this.exhaust.splice(0, this.exhaust.length - 700);
    for (const p of this.tracks) p.age += dt;
    this.tracks = this.tracks.filter((p) => p.age < (this.cfg.vehicles?.trackLife ?? 12));
    for (const c of this.craters) c.age += dt;
    this.craters = this.craters.filter((c) => c.age < c.life);
    for (const b of this.booms) b.age += dt;
    this.booms = this.booms.filter((b) => b.age < 1);
    for (const m of this.muzzles) m.age += dt;
    this.muzzles = this.muzzles.filter((m) => m.age < (m.big ? 0.12 : 0.05));
    // traccianti: all'arrivo scintille e polvere
    for (const p of this.tracers) {
      p.age += dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (p.age >= p.life) {
        for (let i = 0; i < 3; i++) {
          const a = Math.random() * TAU;
          this.sparks.push({ x: p.x, y: p.y, vx: Math.cos(a) * rnd(10, 30), vy: Math.sin(a) * rnd(10, 30), age: 0, life: rnd(0.1, 0.3) });
        }
      }
    }
    this.tracers = this.tracers.filter((p) => p.age < p.life);
    for (const r of this.rockets) {
      r.age += dt;
      r.x += r.vx * dt;
      r.y += r.vy * dt;
      this.exhaust.push({ x: r.x, y: r.y, vx: rnd(-3, 3), vy: rnd(-3, 3), age: 0, life: rnd(0.8, 1.5), hot: true });
      if (r.age >= r.life) this._boom(r.x, r.y, rnd(3.5, 5));
    }
    this.rockets = this.rockets.filter((r) => r.age < r.life);
    for (const p of this.sparks) {
      p.age += dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= 1 - Math.min(1, dt * 2.5);
      p.vy *= 1 - Math.min(1, dt * 2.5);
    }
    this.sparks = this.sparks.filter((p) => p.age < p.life);
    // flare: frenano, bruciano bianchi e lasciano una scia di fumo caldo
    for (const f of this.flares) {
      f.age += dt;
      if (f.age < 0) continue;
      f.x += f.vx * dt;
      f.y += f.vy * dt;
      f.vx *= 1 - Math.min(1, dt * 1.3);
      f.vy *= 1 - Math.min(1, dt * 1.3);
      f.tt += dt;
      while (f.tt > 0.04) {
        f.tt -= 0.04;
        this.smoke.push({ x: f.x, y: f.y, vx: rnd(-1, 1), vy: rnd(-1, 1), age: 0, life: rnd(1.5, 2.6), r0: 0.6, r1: 2.5, h0: 0.45, thin: true });
      }
    }
    this.flares = this.flares.filter((f) => f.age < f.life);
  }

  // ---------- Disegno (in calore, poi tavolozza del sensore) ----------

  _glow(g, x, y, r, v, alpha) {
    g.globalCompositeOperation = 'lighter';
    g.globalAlpha = alpha;
    const c = heat(v);
    for (const k of [1, 0.62, 0.34]) disc(g, x, y, r * k, c);
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';
  }

  _sprite(type, phase, k = 1) {
    const key = `${type}:${phase}:${k}`;
    let c = this.sprites.get(key);
    if (!c) {
      c = type === 'heli' ? heatCanvas(heliHeat(), k) : heatCanvas(vehicleHeat(type, phase), k);
      this.sprites.set(key, c);
    }
    return c;
  }

  /** Sprite ruotato attorno al centro; angoli quasi retti arrotondati (pixel netti). */
  _drawRot(g, img, x, y, a) {
    const q = Math.round(a / (Math.PI / 2));
    if (Math.abs(a - q * (Math.PI / 2)) < 0.06) a = q * (Math.PI / 2);
    g.save();
    g.translate(Math.round(x), Math.round(y));
    g.rotate(a);
    g.drawImage(img, -Math.floor(img.width / 2), -Math.floor(img.height / 2));
    g.restore();
  }

  render() {
    if (!this.w || !this.heatLayer) return;
    const cfg = this.cfg;
    const { w, h } = this;
    const g = this.heatLayer.g;
    const sh = this.shake > 0.05 ? Math.round(rnd(-2, 2) * this.shake) : 0;
    const ox = Math.round(this.cx - this.vcx) + sh;
    const oy = Math.round(this.cy - this.vcy) + (this.shake > 0.05 ? Math.round(rnd(-2, 2) * this.shake) : 0);
    this.ox = ox;
    this.oy = oy;
    const S = (x, y) => [Math.round(x - ox), Math.round(y - oy)];
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';
    g.fillStyle = '#000';
    g.fillRect(0, 0, w, h);

    const chunks = this._visibleChunks();
    for (const ch of chunks) g.drawImage(ch.canvas, ch.i * CHUNK - ox, ch.j * CHUNK - oy);

    // tracce calde dei cingoli e crateri freschi che si raffreddano
    g.globalCompositeOperation = 'lighter';
    g.fillStyle = heat(cfg.vehicles?.trackHeat ?? 0.09);
    const tl = cfg.vehicles?.trackLife ?? 12;
    for (const p of this.tracks) {
      g.globalAlpha = 1 - p.age / tl;
      g.fillRect(p.x - ox, p.y - oy, 1, 1);
    }
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';
    for (const c of this.craters) {
      const [x, y] = S(c.x, c.y);
      if (x < -20 || y < -20 || x > w + 20 || y > h + 20) continue;
      const k = c.age / c.life;
      const hot = Math.max(0, 1 - c.age / 12);
      g.globalAlpha = k > 0.75 ? (1 - k) / 0.25 : 1;
      disc(g, x, y, c.r + 1.5, heat(0.36 + hot * 0.3));
      disc(g, x, y, c.r, heat(0.16 + hot * 0.7));
      if (hot > 0) disc(g, x, y, c.r * 0.5, heat(0.2 + hot * 0.8));
    }
    g.globalAlpha = 1;

    // carcasse: roventi, poi si raffreddano
    for (const wk of this.wrecks) {
      const [x, y] = S(wk.x, wk.y);
      const k = wk.age / wk.life;
      this._drawRot(g, this._sprite(wk.type, 0, 0.9), x, y, wk.ang);
      g.globalAlpha = Math.max(0, 1 - k * 1.3);
      this._drawRot(g, this._sprite(wk.type, 0, 2.2), x, y, wk.ang);
      g.globalAlpha = 1;
    }

    // mezzi
    for (const v of this.vehicles) {
      const [x, y] = S(v.dx, v.dy);
      if (x < -30 || y < -30 || x > w + 30 || y > h + 30) continue;
      const spr = vehicleHeat(v.type);
      const phase = v.type === 'tank' ? Math.floor(v.dist / 1.5) % 3 : 0;
      this._drawRot(g, this._sprite(v.type, phase, cfg.vehicles?.heat ?? 1.3), x, y, v.ang);
      if (spr.turret) {
        const ca = Math.cos(v.ang);
        const sa = Math.sin(v.ang);
        const lx = spr.turret[0] - spr.w / 2 + 0.5;
        const ly = spr.turret[1] - spr.h / 2 + 0.5;
        const tx = x + lx * ca - ly * sa;
        const ty = y + lx * sa + ly * ca;
        const big = v.type === 'tank';
        const len = big ? 11 : 6;
        line(g, tx, ty, tx + Math.cos(v.tur) * len, ty + Math.sin(v.tur) * len, heat(big ? 0.36 : 0.33));
        disc(g, tx, ty, big ? 3.2 : 1.6, heat(0.47));
        if (big) {
          g.fillStyle = heat(0.58);
          g.fillRect(Math.round(tx - Math.cos(v.tur) * 1.5), Math.round(ty - Math.sin(v.tur) * 1.5), 1, 1);
        }
      }
    }

    // pattuglie e cani
    for (const s of this.squads) {
      const mem = this._members(s);
      mem.forEach((m, i) => {
        const a = s.fight ? Math.atan2(s.fight.ey - m.y, s.fight.ex - m.x) : m.a;
        this._drawSoldier(g, m.x - ox, m.y - oy, a, s.halt ? 0 : Math.floor((s.dist + i * 2.5) / 2.5) % 2);
      });
    }
    for (const d of this.dogs) this._drawDog(g, d.dx - ox, d.dy - oy, d.ang, d.halt ? 0 : Math.floor(d.dist / 1.5) % 2);

    // incendi (dei pezzi, nuovi, sulle carcasse)
    for (const ch of chunks) for (const f of ch.fires) this._drawFire(g, f.x - ox, f.y - oy, f.s, f.ph);
    for (const f of this.fires) this._drawFire(g, f.x - ox, f.y - oy, f.s * Math.min(1, (f.life - f.age) / 5), f.ph);
    for (const wk of this.wrecks) this._drawFire(g, wk.x - ox, wk.y - oy, 1.1 * (1 - wk.age / wk.life), wk.x);

    // scarichi caldi
    g.globalCompositeOperation = 'lighter';
    for (const p of this.exhaust) {
      const k = p.age / p.life;
      g.globalAlpha = (p.hot ? 0.4 : 0.1) * (1 - k);
      g.fillStyle = heat(p.hot ? 0.9 : 0.6);
      const r = p.small ? 0.5 + k : p.hot ? 1 + k * 2 : 0.5 + k * 1.5;
      if (r < 1) g.fillRect(Math.round(p.x - ox), Math.round(p.y - oy), 1, 1);
      else disc(g, p.x - ox, p.y - oy, r);
    }
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';

    // fumo (caldo vicino al fuoco, si raffredda salendo)
    for (const p of this.smoke) {
      const k = p.age / p.life;
      const [x, y] = S(p.x, p.y);
      const r = p.r0 + (p.r1 - p.r0) * Math.sqrt(k);
      if (x < -r || y < -r || x > w + r || y > h + r) continue;
      g.globalAlpha = (p.thin ? 0.16 : cfg.fires?.smoke?.alpha ?? 0.2) * (k < 0.08 ? k / 0.08 : 1 - k);
      disc(g, x, y, r, heat(p.h0 * (1 - k * 0.45)));
    }
    g.globalAlpha = 1;

    // traccianti, razzi, vampate, scintille
    for (const p of this.tracers) {
      const [x, y] = S(p.x, p.y);
      line(g, x, y, x - p.vx * 0.014, y - p.vy * 0.014, heat(1));
    }
    for (const r of this.rockets) {
      const [x, y] = S(r.x, r.y);
      disc(g, x, y, 1, heat(1));
      this._glow(g, x, y, 4, 0.5, 0.3);
    }
    for (const m of this.muzzles) {
      if (m.age < 0) continue;
      const [x, y] = S(m.x, m.y);
      g.fillStyle = heat(1);
      g.fillRect(x, y, 1, 1);
      this._glow(g, x, y, m.big ? 6 : 2.5, 0.8, m.big ? 0.4 : 0.3);
    }
    g.fillStyle = heat(1);
    for (const p of this.sparks) {
      g.globalAlpha = 1 - p.age / p.life;
      g.fillRect(Math.round(p.x - ox), Math.round(p.y - oy), 1, 1);
    }
    g.globalAlpha = 1;

    // esplosioni: lampo, palla di fuoco, onda d'urto
    for (const b of this.booms) {
      const [x, y] = S(b.x, b.y);
      const k = b.age;
      if (k < 0.08) {
        disc(g, x, y, b.R * (0.4 + (k / 0.08) * 0.8), heat(1));
        this._glow(g, x, y, b.R * 3.5, 1, 0.3);
      } else {
        const f = (k - 0.08) / 0.92;
        const r = b.R * Math.pow(1 - f, 0.6) * 1.2;
        this._glow(g, x, y, b.R * 3 * (1 - f), 0.9, 0.15);
        if (r > 0.5) disc(g, x, y, r, heat(lerp(1, 0.65, f)));
        if (r > 2) disc(g, x, y, r * 0.55, heat(1));
      }
      if (k < 0.45) {
        g.globalAlpha = 1 - k / 0.45;
        ring(g, x, y, b.R * 0.6 + k * 150, heat(0.75));
        g.globalAlpha = 1;
      }
    }

    // elicotteri (sopra al fumo) e flare
    for (const hl of this.helis) {
      const [x, y] = S(hl.x, hl.y);
      if (x < -40 || y < -40 || x > w + 40 || y > h + 40) continue;
      this._glow(g, x, y, 12, 0.35, 0.05);
      this._drawRot(g, this._sprite('heli', 0, this.cfg.helicopter?.heat ?? 1.5), x, y, hl.a);
      // rotore: disco sfocato e quattro pale che girano
      const ca = Math.cos(hl.a);
      const sa = Math.sin(hl.a);
      const spr = heliHeat();
      const lx = spr.rotor[0] - spr.w / 2;
      const rx = x + lx * ca;
      const ry = y + lx * sa;
      this._glow(g, rx, ry, 19, 0.3, 0.035);
      g.globalAlpha = 0.18;
      ring(g, rx, ry, 19, heat(0.5));
      const ra = this.t * 23;
      g.globalAlpha = 0.32;
      for (let i = 0; i < 4; i++) {
        const a = ra + (i * Math.PI) / 2;
        line(g, rx, ry, rx + Math.cos(a) * 19, ry + Math.sin(a) * 19, heat(0.5));
      }
      g.globalAlpha = 1;
      const tx = x + (spr.tail[0] - spr.w / 2) * ca - (spr.tail[1] - spr.h / 2) * sa;
      const ty = y + (spr.tail[0] - spr.w / 2) * sa + (spr.tail[1] - spr.h / 2) * ca;
      const ta = this.t * 40;
      line(g, tx - Math.cos(ta) * 3 * ca, ty - Math.cos(ta) * 3 * sa, tx + Math.cos(ta) * 3 * ca, ty + Math.cos(ta) * 3 * sa, heat(0.45));
    }
    for (const f of this.flares) {
      if (f.age < 0) continue;
      const [x, y] = S(f.x, f.y);
      const k = f.age / f.life;
      disc(g, x, y, k < 0.8 ? 1 : 0.5, heat(1));
      this._glow(g, x, y, 6 * (1 - k * 0.6), 1, 0.3);
    }

    this._post();
    this._hud();
  }

  _drawSoldier(g, x, y, a, step) {
    const fx = Math.round(Math.cos(a));
    const fy = Math.round(Math.sin(a));
    const px = -fy;
    const py = fx;
    x = Math.round(x);
    y = Math.round(y);
    this._glow(g, x, y, 2.6, 0.5, 0.18);
    const P = (dx, dy, v) => {
      g.fillStyle = heat(v);
      g.fillRect(x + dx, y + dy, 1, 1);
    };
    // gambe (alternate nel passo), spalle, testa, fucile (metallo più freddo)
    P(-fx + px * (step ? 1 : 0), -fy + py * (step ? 1 : 0), 0.72);
    if (!step) P(-fx - px, -fy - py, 0.68);
    P(px, py, 0.84);
    P(-px, -py, 0.84);
    P(0, 0, 1);
    P(fx + px, fy + py, 0.5);
    P(fx * 2 + px, fy * 2 + py, 0.42);
  }

  _drawDog(g, x, y, a, step) {
    const fx = Math.round(Math.cos(a));
    const fy = Math.round(Math.sin(a));
    x = Math.round(x);
    y = Math.round(y);
    const P = (dx, dy, v) => {
      g.fillStyle = heat(v);
      g.fillRect(x + dx, y + dy, 1, 1);
    };
    P(0, 0, 0.8);
    P(-fx, -fy, 0.76);
    P(fx, fy, 0.9);
    P(-fx * 2 + (step ? -fy : fy), -fy * 2 + (step ? fx : -fx), 0.55);
  }

  _drawFire(g, x, y, s, ph) {
    if (s <= 0.05) return;
    const { w, h } = this;
    if (x < -30 || y < -30 || x > w + 30 || y > h + 30) return;
    const fl = 0.8 + 0.2 * Math.sin(this.t * 11 + ph) * Math.sin(this.t * 6.7 + ph * 2);
    this._glow(g, x, y, s * 10 * fl, 0.5, 0.07);
    disc(g, x, y, s * 2.4 * fl, heat(0.78));
    for (let i = 0; i < 3; i++) {
      const a = ph + i * 2.1 + Math.sin(this.t * 3 + i) * 0.6;
      disc(g, x + Math.cos(a) * s * 1.2, y + Math.sin(a) * s * 1.2, s * (0.8 + 0.4 * Math.sin(this.t * 9 + i * 3 + ph)), heat(1));
    }
  }

  /** Dal calore ai colori del sensore: guadagno automatico, lampo, grana, retino, disturbi, vignettatura. */
  _post() {
    const { w, h } = this;
    const sc = this.cfg.sensor || {};
    const src = this.heatLayer.g.getImageData(0, 0, w, h).data;
    const dst = this.out.data;
    const lut = this.luts[this.modes[this.modeIdx % this.modes.length]];
    const L = this.levels;
    const level = sc.level ?? 0.3;
    const gain = (sc.gain ?? 1.15) * (1 - this.dip);
    const add = this.flash * (sc.flashAdd ?? 0.45);
    const glitch = this.glitch > 0;
    const grain = (sc.grain ?? 0.04) * (glitch ? 4 : 1);
    let seed = (Math.random() * 4294967295) >>> 0;
    for (let y = 0; y < h; y++) {
      let shift = 0;
      if (glitch && Math.random() < 0.35) shift = Math.round(rnd(-8, 8));
      // righe del sensore leggermente diverse (rumore a strisce)
      const row = Math.sin(y * 12.9898 + this.t * 3) * (sc.rowNoise ?? 0.006);
      for (let x = 0; x < w; x++) {
        const sx = clamp(x + shift, 0, w - 1);
        const i = y * w + x;
        let v = src[(y * w + sx) * 4] / 255;
        v = (v - level) * gain + level + add + row;
        seed ^= seed << 13;
        seed ^= seed >>> 17;
        seed ^= seed << 5;
        v += (((seed >>> 0) & 1023) / 1023 - 0.5) * grain;
        let q = v * (L - 1);
        if (q < 0) q = 0;
        else if (q > L - 1) q = L - 1;
        let qi = q | 0;
        if (q - qi > bayer(x, y) && qi < L - 1) qi++;
        const k = qi * 3;
        const vg = this.vig[i];
        const o = i * 4;
        dst[o] = lut[k] * vg;
        dst[o + 1] = lut[k + 1] * vg;
        dst[o + 2] = lut[k + 2] * vg;
        dst[o + 3] = 255;
      }
    }
    this.g.putImageData(this.out, 0, 0);
  }

  // ---------- HUD del drone ----------

  _hud() {
    const g = this.g;
    const hc = this.cfg.hud || {};
    const col = hc.color || '#e4f2e8';
    const shd = hc.shadow || 'rgba(0,0,0,0.55)';
    const { w, h, vx0, vcx, vcy } = this;
    g.globalAlpha = hc.alpha ?? 0.9;
    const R = (x, y, ww, hh) => {
      g.fillStyle = shd;
      g.fillRect(Math.round(x) + 1, Math.round(y) + 1, ww, hh);
      g.fillStyle = col;
      g.fillRect(Math.round(x), Math.round(y), ww, hh);
    };
    const T = (x, y, s, align = 'left') => {
      const tw = textWidth(s);
      const xx = align === 'right' ? x - tw : align === 'center' ? x - Math.floor(tw / 2) : x;
      drawText(g, xx + 1, y + 1, s, shd);
      drawText(g, xx, y, s, col);
      return tw;
    };
    const L = Math.round(vx0 + 6);
    const Rt = w - 6;

    // mirino centrale e angoli del campo
    R(vcx - 12, vcy, 8, 1);
    R(vcx + 5, vcy, 8, 1);
    R(vcx, vcy - 12, 1, 8);
    R(vcx, vcy + 5, 1, 8);
    const bw = Math.round(Math.min(this.vis, h) * 0.3);
    const bh = Math.round(bw * 0.7);
    for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const cx = vcx + sx * bw;
      const cy = vcy + sy * bh;
      R(sx < 0 ? cx : cx - 5, cy, 6, 1);
      R(cx, sy < 0 ? cy : cy - 5, 1, 6);
    }

    // aggancio del bersaglio
    if (this.track) {
      const m = this.track;
      let x0 = m.dx;
      let x1 = m.dx;
      let y0 = m.dy;
      let y1 = m.dy;
      if (m.kind === 'squad') {
        for (const p of this._members(m)) {
          x0 = Math.min(x0, p.x);
          x1 = Math.max(x1, p.x);
          y0 = Math.min(y0, p.y);
          y1 = Math.max(y1, p.y);
        }
      }
      const r = m.kind === 'vehicle' ? 8 : 4;
      const grow = Math.max(0, 1 - this.trackAge / 0.6) * 22;
      const ax = Math.round(x0 - this.ox - r - grow);
      const bx = Math.round(x1 - this.ox + r + grow);
      const ay = Math.round(y0 - this.oy - r - grow);
      const by = Math.round(y1 - this.oy + r + grow);
      const locking = this.trackAge < 0.9;
      if (!locking || Math.floor(this.t * 12) % 2) {
        for (const [cx, cy, sx, sy] of [[ax, ay, 1, 1], [bx, ay, -1, 1], [ax, by, 1, -1], [bx, by, -1, -1]]) {
          R(sx > 0 ? cx : cx - 3, cy, 4, 1);
          R(cx, sy > 0 ? cy : cy - 3, 1, 4);
        }
        const label = this._t('track', { n: String(this.trackNo).padStart(2, '0') }, 'TRK {n}');
        T(bx + 3, ay, label);
        if (!locking) {
          const spd = Math.round(Math.hypot(m.mvx || 0, m.mvy || 0) * 1.8);
          T(bx + 3, ay + 7, this._t('speed', { v: spd }, 'SPD {v}'));
        }
      }
    }

    // contatti: rombo lampeggiante sui punti di fuoco nemici
    for (const f of this.fights) {
      if (Math.floor(this.t * 3) % 2) continue;
      const x = Math.round(f.ex - this.ox);
      const y = Math.round(f.ey - this.oy);
      if (x < vx0 || x > w || y < 0 || y > h) continue;
      for (let i = 0; i <= 4; i++) {
        R(x - 4 + i, y - i, 1, 1);
        R(x + 4 - i, y - i, 1, 1);
        R(x - 4 + i, y + i, 1, 1);
        R(x + 4 - i, y + i, 1, 1);
      }
      T(x, y - 12, this._t('contact', null, 'CONTACT'), 'center');
    }

    // in alto: modo del sensore, zoom, registrazione, nastro della rotta
    const mode = this.modes[this.modeIdx % this.modes.length];
    T(L, 5, this._t(`mode.${mode}`, null, mode.toUpperCase()));
    T(L, 12, this._t('zoom', { v: (hc.zoom ?? 8).toFixed(1) }, 'ZOOM {v}X'));
    T(L, 19, this._t('sensor', null, 'IR NFOV'));
    const sec = this.recBase + Math.floor(this.t);
    const clock = `${String(Math.floor(sec / 3600) % 24).padStart(2, '0')}:${String(Math.floor(sec / 60) % 60).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`;
    const tw = T(Rt, 5, clock, 'right');
    const rec = this._t('rec', null, 'REC');
    const rw = T(Rt - tw - 5, 5, rec, 'right');
    if (Math.floor(this.t * 1.5) % 2 === 0) {
      g.fillStyle = shd;
      g.fillRect(Rt - tw - rw - 11, 6, 4, 4);
      g.fillStyle = hc.rec || '#ff3b30';
      g.fillRect(Rt - tw - rw - 12, 5, 4, 4);
    }
    const hdg = ((hc.heading ?? 40) + this.t * (hc.orbit ?? 1.5)) % 360;
    const half = Math.min(40, Math.floor(this.vis / 2) - 50);
    if (half > 12) {
      for (let d = Math.ceil((hdg - half) / 5) * 5; d <= hdg + half; d += 5) {
        const x = Math.round(vcx + (d - hdg));
        const big = d % 15 === 0;
        R(x, 5, 1, big ? 3 : 2);
        if (d % 30 === 0 && Math.abs(d - hdg) < half - 6) T(x, 10, String(((d % 360) + 360) % 360).padStart(3, '0'), 'center');
      }
      R(vcx, 1, 1, 3);
      R(vcx - 1, 2, 3, 1);
    }

    // scala dell'elevazione a sinistra
    const el = Math.sin(this.t * 0.07) * 8;
    for (let i = -5; i <= 5; i++) {
      const y = Math.round(vcy + i * 6 + ((el * 3) % 6));
      R(L, y, i % 2 ? 2 : 4, 1);
    }
    T(L + 6, vcy - 2, `${(-62 + el).toFixed(0)}°`);

    // in basso: coordinate, quota, distanza
    const [lat0, lon0] = hc.origin || [23.41, 12.75];
    const lat = lat0 - this.cy * 1.1e-5;
    const lon = lon0 + this.cx * 1.3e-5;
    T(L, h - 13, `${Math.abs(lat).toFixed(4)}${lat >= 0 ? 'N' : 'S'} ${Math.abs(lon).toFixed(4)}${lon >= 0 ? 'E' : 'W'}`);
    T(L, h - 6, `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}-${String(new Date().getDate()).padStart(2, '0')}`);
    const alt = Math.round((hc.altitude ?? 3800) + Math.sin(this.t * 0.05) * 25);
    T(Rt, h - 13, this._t('alt', { v: alt }, 'ALT {v} M'), 'right');
    T(Rt, h - 6, this._t('range', { v: (alt / 1000 / Math.sin(1.08)).toFixed(2) }, 'RNG {v} KM'), 'right');
    g.globalAlpha = 1;
  }
}
