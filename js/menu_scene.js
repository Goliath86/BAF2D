// Scena animata dietro al menu principale (al posto della partita dimostrativa): deserto al tramonto, soldato a
// mezzo busto in primo piano (ritratto dettagliato col fucile), bandiera rossa a brandelli, carro armato in
// fiamme col fumo, nuvole e un elicottero Apache che passa ogni tanto (direzione, quota e distanza casuali).
// Canvas a bassa risoluzione scalato di un fattore intero; disegni in js/menu_art.js, parametri in
// config/menu_scene.json.

import {
  bayer, mulberry32, rnd, clamp, hex, mixRGB, css, makeCanvas, rect, disc,
  finish, buildBust, BUST, BUST_LENSES, insidePoly, drawTank, drawApache, HELI, makeCloud,
} from './menu_art.js';

const M = 3; // margine degli sprite (contorno)
const range = (r, d = [0, 1]) => rnd(...(Array.isArray(r) ? r : d));

export class MenuScene {
  constructor(canvas, cfg) {
    this.canvas = canvas;
    this.g = canvas.getContext('2d');
    this.cfg = cfg;
    this.wind = Math.sign(cfg.wind ?? 1) || 1;
    this.viewLeft = 0;
    this.visible = false;
    this.t = 0;
    this.raf = 0;
    this.warm = false;
    this.clouds = [];
    this.helis = [];
    this.flames = [];
    this.smoke = [];
    this.embers = [];
    this.sand = [];
    this.heliTimer = range(cfg.helicopter?.firstDelay, [2, 5]);
    this.cloudTimer = range(cfg.clouds?.interval, [6, 14]);
    this.glint = { timer: range(cfg.soldier?.glint, [4, 9]), on: 0 };
    this.heliCache = new Map();
    this._buildFlag();
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
      // all'avvio fumo e fuoco sono già in corso
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

  /** Larghezza in px CSS coperta dal pannello del menu a sinistra: la scena si compone nel resto. */
  setViewLeft(px) {
    if (Math.abs(px - this.viewLeft) < 1) return;
    this.viewLeft = px;
    if (this.visible) this._layout();
  }

  resize() {
    const cw = window.innerWidth;
    const ch = window.innerHeight;
    this.scale = Math.max(1, Math.floor(ch / (this.cfg.targetHeight ?? 270)));
    this.w = Math.ceil(cw / this.scale);
    this.h = Math.ceil(ch / this.scale);
    this.canvas.width = this.w;
    this.canvas.height = this.h;
    this.canvas.style.width = `${this.w * this.scale}px`;
    this.canvas.style.height = `${this.h * this.scale}px`;
    this.g.imageSmoothingEnabled = false;
    this.groundY = this.h - (this.cfg.groundHeight ?? 46);
    this._layout();
  }

  /** Posizioni (dipendono dalla parte visibile) e livelli statici: cielo con sole, dune, terreno, sprite. */
  _layout() {
    const cfg = this.cfg;
    const s = this.scale || 1;
    let vx0 = this.viewLeft / s;
    const minVis = cfg.minVisible ?? 200;
    if (this.w - vx0 < minVis) vx0 = Math.max(0, this.w - minVis);
    this.vx0 = vx0;
    const vis = this.w - vx0;
    const at = (a, d) => vx0 + vis * (a ?? d);
    const sun = cfg.sun || {};
    const r = sun.radius ?? 17;
    this.sunX = Math.round(clamp(at(sun.at, 0.12), vx0 + r * 0.5, this.w - r - 4));
    this.sunY = this.groundY + (sun.y ?? -12);
    const sc = cfg.soldier || {};
    this.soldierX = Math.round(at(sc.at, 0.6) + (sc.x ?? 0));
    this.sunDir = this.sunX < this.soldierX ? -1 : 1;
    // busto appoggiato al bordo inferiore (se lo schermo è basso si taglia il fondo, mai l'elmetto)
    this.bustY = Math.max((sc.top ?? 2) - BUST.margin, this.h - BUST.h - BUST.margin + (sc.y ?? 0));
    this.flagX = Math.round(at(cfg.flag?.at, 0.3));
    const tc = cfg.tank || {};
    this.tankX = Math.round(at(tc.at, 0.2));
    this.tankY = this.groundY + (tc.y ?? 8);
    this._buildSky();
    this._buildDunes();
    this._buildGround();
    this._buildSprites();
  }

  // ---------- Livelli statici ----------

  _buildSky() {
    const { w, h, groundY } = this;
    const { c, g } = makeCanvas(w, h);
    const stops = (this.cfg.sky?.stops || [[0, '#41507e'], [1, '#ffd48a']]).map(([t, col]) => [t, hex(col)]);
    const atT = (t) => {
      for (let i = 1; i < stops.length; i++) {
        if (t <= stops[i][0]) {
          const [t0, c0] = stops[i - 1];
          const [t1, c1] = stops[i];
          return mixRGB(c0, c1, (t - t0) / Math.max(1e-6, t1 - t0));
        }
      }
      return stops[stops.length - 1][1];
    };
    const LEVELS = 24;
    const pal = Array.from({ length: LEVELS }, (_, i) => atT(i / (LEVELS - 1)));
    const sun = this.cfg.sun || {};
    const glow = hex(sun.glow || '#ffe2a4');
    const core = hex(sun.core || '#fff6d2');
    const edge = hex(sun.edge || '#ffd27a');
    const R = sun.radius ?? 17;
    const GR = sun.glowRadius ?? 70;
    const GS = sun.glowStrength ?? 0.5;
    const img = g.createImageData(w, h);
    const d = img.data;
    for (let y = 0; y < h; y++) {
      const t = clamp(y / Math.max(1, groundY), 0, 1) * (LEVELS - 1);
      const i0 = Math.floor(t);
      const f = t - i0;
      for (let x = 0; x < w; x++) {
        const b = bayer(x, y);
        let col = pal[Math.min(LEVELS - 1, f > b ? i0 + 1 : i0)];
        const dist = Math.hypot(x + 0.5 - this.sunX, y + 0.5 - this.sunY);
        if (dist < GR) {
          const k = (1 - dist / GR) ** 2 * GS;
          const q = Math.floor(k * 8 + b) / 8;
          if (q > 0) col = mixRGB(col, glow, Math.min(1, q));
        }
        if (dist <= R) col = dist > R - 1.6 ? edge : mixRGB(core, edge, Math.max(0, (y - (this.sunY - R)) / (2 * R)) * 0.5);
        const k = (y * w + x) * 4;
        d[k] = col[0];
        d[k + 1] = col[1];
        d[k + 2] = col[2];
        d[k + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
    this.sky = c;
  }

  _ridge(def, x, salt) {
    let y = this.groundY - (def.base ?? 0) - (def.height ?? 10) / 2;
    (def.waves || []).forEach(([f, a], i) => {
      y -= Math.sin(x * f + salt * 1.7 + i * 2.1) * a;
    });
    return y;
  }

  _buildDunes() {
    const { w, h } = this;
    const dcfg = this.cfg.dunes || {};
    const layer = (def, salt, shaded) => {
      const { c, g } = makeCanvas(w, h);
      const col = def.color || '#9c6878';
      const light = def.light || col;
      const dark = def.dark || col;
      for (let x = 0; x < w; x++) {
        const top = Math.round(this._ridge(def, x, salt));
        const slope = this._ridge(def, x + 1, salt) - this._ridge(def, x - 1, salt);
        const lit = this.sunDir < 0 ? slope < 0.05 : slope > -0.05;
        rect(g, x, top, 1, h - top, col);
        rect(g, x, top, 1, lit ? 2 : 1, light);
        if (shaded && !lit) for (let y = top + 2; y < top + 9; y++) if (bayer(x, y) < 0.5 - (y - top) * 0.05) rect(g, x, y, 1, 1, dark);
      }
      return { c, g };
    };
    this.farDunes = layer(dcfg.far || {}, 1, false).c;
    const mid = layer(dcfg.mid || {}, 2, true);
    const r = mulberry32((this.cfg.seed ?? 1) + 5);
    const vis = this.w - this.vx0;
    for (const ru of dcfg.ruins || []) {
      const x0 = Math.round(this.vx0 + vis * ru.at);
      const base = Math.round(this._ridge(dcfg.mid || {}, x0 + ru.w / 2, 2)) + 3;
      for (let i = 0; i < ru.w; i++) {
        const hh = Math.round(ru.h - (r() < 0.35 ? r() * ru.h * 0.6 : r() * 2));
        rect(mid.g, x0 + i, base - hh, 1, hh, dcfg.ruinColor || '#7e5048');
        if ((this.sunDir < 0 && i === 0) || (this.sunDir > 0 && i === ru.w - 1)) rect(mid.g, x0 + i, base - hh, 1, hh, dcfg.ruinLight || '#a46a58');
      }
      if (ru.w > 12) rect(mid.g, x0 + Math.round(ru.w / 3), base - Math.round(ru.h * 0.6), 3, 4, dcfg.far?.color || '#9c6878');
    }
    this.midDunes = mid.c;
  }

  _buildGround() {
    const { w, h, groundY } = this;
    const gc = this.cfg.ground || {};
    const { c, g } = makeCanvas(w, h);
    const r = mulberry32((this.cfg.seed ?? 1) + 9);
    const base = hex(gc.color || '#c08658');
    const dark = hex(gc.dark || '#9c6a48');
    for (let x = 0; x < w; x++) {
      const top = Math.round(groundY + Math.sin(x * 0.05) * 1.5 + Math.sin(x * 0.13 + 1) * 0.8);
      for (let y = top; y < h; y++) {
        const t = (y - top) / Math.max(1, h - top);
        rect(g, x, y, 1, 1, css(t * 0.9 > bayer(x, y) + 0.35 ? dark : base));
      }
      rect(g, x, top, 1, 1, gc.light || '#d8a068');
      if (r() < 0.3) rect(g, x, top + 1 + Math.floor(r() * (h - top)), 1, 1, r() < 0.5 ? gc.light || '#d8a068' : gc.dark || '#9c6a48');
    }
    for (let x = 0; x < w; x++) {
      if (r() < (gc.stones ?? 0.012)) {
        const y = groundY + 3 + Math.floor(r() * (h - groundY - 5));
        const sw = 2 + Math.floor(r() * 3);
        rect(g, x, y, sw, 2, gc.stone || '#7a5e4a');
        rect(g, x, y, sw - 1, 1, gc.stoneLight || '#b49a7a');
      }
      if (r() < (gc.tufts ?? 0.006)) {
        const y = groundY + 2 + Math.floor(r() * (h - groundY - 4));
        for (let k = -2; k <= 2; k++) rect(g, x + k, y - (2 - Math.abs(k)) - 1, 1, 3 - Math.abs(k) + 1, gc.grass || '#6e6234');
      }
    }
    this.ground = c;
  }

  _buildSprites() {
    const cfg = this.cfg;
    const key = `${this.sunDir}`;
    if (this._spriteKey === key) return;
    this._spriteKey = key;
    const sc = cfg.soldier || {};
    this.bust = buildBust(sc, this.sunDir, (cfg.seed ?? 1) + 21);
    const tc = cfg.tank || {};
    const tank = makeCanvas(66 + M * 2, 34 + M * 2);
    drawTank(tank.g, tc.colors || {}, (cfg.seed ?? 1) + 7, M);
    finish(tank.c, { rim: tc.rim, rimAmount: 0.45, rimDir: tc.flip ? -this.sunDir : this.sunDir, outline: sc.outline });
    this.tank = tank.c;
    this.heliCache.clear();
  }

  _buildFlag() {
    const f = this.cfg.flag || {};
    const W = f.width ?? 46;
    const H = f.height ?? 26;
    const r = mulberry32((this.cfg.seed ?? 1) + 13);
    const len = new Array(H);
    let row = 0;
    while (row < H) {
      // strisce di 1-3 righe con lunghezze diverse: bordo libero a brandelli
      const n = 1 + Math.floor(r() * 3);
      let l = W - Math.floor(r() * (f.tatter ?? 10));
      if (r() < 0.15) l = W + 2;
      for (let k = 0; k < n && row < H; k++, row++) len[row] = l - (row >= H - 3 ? Math.floor(r() * 8) + 3 : 0) - (k === n - 1 ? Math.floor(r() * 2) : 0);
    }
    const hole = new Set();
    for (let i = 0; i < (f.holes ?? 8); i++) {
      const hc = 6 + Math.floor(r() * (W - 14));
      const hr = 2 + Math.floor(r() * (H - 4));
      hole.add(`${hr},${hc}`);
      if (r() < 0.6) hole.add(`${hr},${hc + 1}`);
      if (r() < 0.4) hole.add(`${hr + 1},${hc}`);
    }
    const burnt = new Set();
    for (const k of hole) {
      const [hr, hc] = k.split(',').map(Number);
      for (const [dr, dc] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) if (!hole.has(`${hr + dr},${hc + dc}`)) burnt.add(`${hr + dr},${hc + dc}`);
    }
    for (let rr = 0; rr < H; rr++) if (r() < 0.6) burnt.add(`${rr},${len[rr] - 1}`);
    this.flag = { W, H, len, hole, burnt };
  }

  // ---------- Aggiornamento ----------

  update(dt) {
    const cfg = this.cfg;
    this.t += dt;
    if (!this.w) return;
    const wind = this.wind;

    // nuvole
    const cc = cfg.clouds || {};
    if (!this._cloudsInit) {
      this._cloudsInit = true;
      for (let i = 0; i < (cc.initial ?? 3); i++) this._spawnCloud(rnd(0, this.w));
    }
    this.cloudTimer -= dt;
    if (this.cloudTimer <= 0) {
      this.cloudTimer = range(cc.interval, [6, 14]);
      if (this.clouds.length < (cc.max ?? 6)) this._spawnCloud(wind < 0 ? this.w + 2 : null);
    }
    for (const c of this.clouds) c.x += c.v * wind * dt;
    this.clouds = this.clouds.filter((c) => c.x > -c.img.width - 4 && c.x < this.w + 4);

    // elicottero
    const hc = cfg.helicopter || {};
    this.heliTimer -= dt;
    if (this.heliTimer <= 0) {
      this.heliTimer = range(hc.interval, [8, 20]);
      this._spawnHeli();
    }
    for (const hl of this.helis) hl.x += hl.v * hl.dir * dt;
    this.helis = this.helis.filter((hl) => hl.x > -hl.sprite.width - 10 && hl.x < this.w + 10);

    // fuoco, fumo e scintille del carro armato
    const tc = cfg.tank || {};
    const fire = tc.fire || {};
    const emitters = (fire.emitters || [[27, 5]]).map(([x, y]) => this._tankPoint(x, y));
    this._fireAcc = (this._fireAcc || 0) + dt * (fire.rate ?? 26);
    while (this._fireAcc >= 1 && this.flames.length < (fire.max ?? 220)) {
      this._fireAcc -= 1;
      const e = emitters[Math.floor(Math.random() * emitters.length)];
      const big = e === emitters[0];
      this.flames.push({ x: e.x + rnd(-(fire.spread ?? 3), fire.spread ?? 3), y: e.y, vx: rnd(-4, 4), vy: -range(fire.speed, [14, 30]) * (big ? 1 : 0.6), age: 0, life: range(fire.life, [0.3, 0.7]) * (big ? 1 : 0.7) });
    }
    if (this._fireAcc > 1) this._fireAcc = 0;
    for (const p of this.flames) {
      p.age += dt;
      p.x += (p.vx + wind * 4) * dt;
      p.y += p.vy * dt;
    }
    this.flames = this.flames.filter((p) => p.age < p.life);

    const sm = tc.smoke || {};
    this._smokeAcc = (this._smokeAcc || 0) + dt * (sm.rate ?? 7);
    while (this._smokeAcc >= 1 && this.smoke.length < (sm.max ?? 160)) {
      this._smokeAcc -= 1;
      const e = emitters[Math.random() < 0.7 ? 0 : Math.floor(Math.random() * emitters.length)];
      const [s0, s1] = sm.size || [2, 9];
      this.smoke.push({ x: e.x + rnd(-2, 2), y: e.y - 5, vx: rnd(-2, 2), vy: -range(sm.speed, [8, 14]), age: 0, life: range(sm.life, [6, 10]), r0: s0 * rnd(0.8, 1.2), r1: s1 * rnd(0.7, 1.2) });
    }
    if (this._smokeAcc > 1) this._smokeAcc = 0;
    for (const p of this.smoke) {
      p.age += dt;
      const k = p.age / p.life;
      p.x += (p.vx + wind * (sm.drift ?? 9) * Math.min(1, k * 2.2)) * dt;
      p.y += p.vy * (1 - k * 0.5) * dt;
    }
    this.smoke = this.smoke.filter((p) => p.age < p.life);

    const em = tc.embers || {};
    if (Math.random() < dt * (em.rate ?? 3)) {
      const e = emitters[0];
      this.embers.push({ x: e.x, y: e.y - 2, vx: rnd(-6, 6), vy: -range(em.speed, [18, 34]), age: 0, life: range(em.life, [1, 2.2]) });
    }
    for (const p of this.embers) {
      p.age += dt;
      p.x += (p.vx + wind * 10 * (p.age / p.life)) * dt + Math.sin(this.t * 9 + p.life * 10) * 0.15;
      p.y += p.vy * dt;
      p.vy *= 1 - dt * 0.6;
    }
    this.embers = this.embers.filter((p) => p.age < p.life);

    // sabbia sollevata dal vento
    const sd = cfg.sand || {};
    if (Math.random() < dt * (sd.rate ?? 9) && this.sand.length < (sd.max ?? 60)) {
      this.sand.push({ x: wind < 0 ? this.w + 1 : -1, y: this.groundY + rnd(-4, this.h - this.groundY), v: range(sd.speed, [40, 85]), ph: Math.random() * 6 });
    }
    for (const p of this.sand) {
      p.x += p.v * wind * dt;
      p.y += Math.sin(this.t * 3 + p.ph) * 4 * dt;
    }
    this.sand = this.sand.filter((p) => p.x > -4 && p.x < this.w + 4);

    // riflesso sugli occhiali
    const gl = this.glint;
    gl.on = Math.max(0, gl.on - dt);
    gl.timer -= dt;
    if (gl.timer <= 0) {
      gl.timer = range(cfg.soldier?.glint, [4, 9]);
      gl.len = this.cfg.soldier?.glintTime ?? 0.6;
      gl.on = gl.len;
    }
  }

  _spawnCloud(x) {
    const cc = this.cfg.clouds || {};
    const w = Math.round(range(cc.width, [30, 72]));
    const h = Math.round(range(cc.height, [9, 18]));
    const img = makeCloud(cc, w, h);
    const [y0, y1] = cc.yRange || [0.05, 0.45];
    this.clouds.push({ img, x: x ?? -img.width - 2, y: Math.round(this.groundY * rnd(y0, y1)), v: range(cc.speed, [2.5, 6]) * (0.6 + (w / 72) * 0.6) });
  }

  _spawnHeli() {
    const hc = this.cfg.helicopter || {};
    const s = Math.round(range(hc.size, [0.45, 1]) * 20) / 20;
    const dir = Math.random() < 0.5 ? 1 : -1;
    const sprite = this._heliSprite(s, dir);
    const [y0, y1] = hc.yRange || [0.1, 0.48];
    this.helis.push({
      s,
      dir,
      sprite,
      x: dir > 0 ? -sprite.width - 4 : this.w + 4,
      y: Math.round(this.groundY * rnd(y0, y1)),
      v: range(hc.speed, [26, 48]) * (0.5 + s * 0.5),
      ph: Math.random() * 6,
    });
  }

  _heliSprite(s, dir) {
    const key = `${s}:${dir}`;
    if (this.heliCache.has(key)) return this.heliCache.get(key);
    const hc = this.cfg.helicopter || {};
    const { c, g } = makeCanvas((HELI.length + 2) * s + M * 2, HELI.height * s + M * 2);
    drawApache(g, s, hc, M + Math.ceil(s));
    finish(c, { rim: s > 0.7 ? hc.rim : null, rimAmount: 0.35, rimDir: this.sunDir * dir, tint: hc.haze, tintAmount: (1 - s) * 0.75 });
    let out = c;
    if (dir < 0) {
      const f = makeCanvas(c.width, c.height);
      f.g.scale(-1, 1);
      f.g.drawImage(c, -c.width, 0);
      out = f.c;
    }
    this.heliCache.set(key, out);
    return out;
  }

  /** Punto dello sprite del carro (coordinate senza margine, muso a destra) in coordinate della scena. */
  _tankPoint(x, y) {
    const flip = !!this.cfg.tank?.flip;
    const W = this.tank?.width ?? 72;
    const H = this.tank?.height ?? 40;
    const lx = flip ? W - (x + M) : x + M;
    return { x: Math.round(this.tankX - W / 2 + lx), y: Math.round(this.tankY - H + y + M) };
  }

  // ---------- Disegno ----------

  render() {
    const { g, cfg } = this;
    if (!this.sky) return;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';
    g.drawImage(this.sky, 0, 0);

    for (const c of this.clouds) g.drawImage(c.img, Math.round(c.x), c.y);
    this._drawHelis();

    g.drawImage(this.farDunes, 0, 0);
    g.drawImage(this.midDunes, 0, 0);
    g.drawImage(this.ground, 0, 0);
    this._drawTank();
    this._drawFlag();

    // soldato a mezzo busto (respira: si alza di 1 px) con la coda della kefiah al vento
    const sc = cfg.soldier || {};
    const period = sc.breath ?? 3.4;
    const oy = this.t % period > period * 0.55 ? 0 : 1;
    const bm = BUST.margin;
    const sx = Math.round(this.soldierX - BUST.w / 2 - bm);
    const sy = Math.round(this.bustY + oy);
    this._drawScarf(sx + bm, sy + bm, sc.colors || {}, sc.outline);
    g.drawImage(this.bust, sx, sy);
    if (this.glint.on > 0) {
      // riflesso che scorre sulle lenti
      const k = 1 - this.glint.on / this.glint.len;
      const pos = -20 + k * 120;
      g.fillStyle = sc.glintColor || 'rgba(255,244,220,0.75)';
      for (let y = 109; y <= 131; y++) {
        for (let d = 0; d < 4; d++) {
          const x = Math.round(79 + pos + d - (y - 109) * 0.7);
          if (BUST_LENSES.some((l) => insidePoly(l, x + 0.5, y + 0.5))) g.fillRect(sx + bm + x, sy + bm + y, 1, 1);
        }
      }
    }

    g.fillStyle = cfg.sand?.color || 'rgba(255,228,176,0.55)';
    for (const p of this.sand) g.fillRect(Math.round(p.x), Math.round(p.y), 2, 1);
  }

  _drawHelis() {
    const { g } = this;
    const hc = this.cfg.helicopter || {};
    for (const hl of this.helis) {
      const x = Math.round(hl.x);
      const y = Math.round(hl.y + Math.sin(this.t * 2 + hl.ph) * 1.2);
      g.drawImage(hl.sprite, x, y);
      const s = hl.s;
      const off = M + Math.ceil(s);
      const lx = (u) => (hl.dir > 0 ? x + off + u * s : x + hl.sprite.width - off - u * s);
      // rotore principale a 4 pale: due fotogrammi alternati
      const mx = lx(35.75);
      const my = y + off + Math.round(1.5 * s) - 1;
      const half = 31 * s;
      g.fillStyle = hc.rotor || 'rgba(26,30,36,0.5)';
      if (Math.floor(this.t * 24) % 2) g.fillRect(Math.round(mx - half), my, Math.round(half * 2), 1);
      else {
        g.fillRect(Math.round(mx - half), my, Math.round(half * 0.85), 1);
        g.fillRect(Math.round(mx + half * 0.15), my, Math.round(half * 0.85), 1);
        g.fillRect(Math.round(mx - half * 0.4), my - 1, Math.round(half * 0.8), 1);
      }
      // rotore di coda
      g.globalAlpha = Math.floor(this.t * 20) % 2 ? 0.55 : 0.3;
      disc(g, lx(2), y + off + 5 * s, Math.max(1, 4 * s), hc.body || '#363a2c');
      g.globalAlpha = 1;
    }
  }

  _drawTank() {
    const { g, cfg } = this;
    const tc = cfg.tank || {};
    const glow = tc.glow || {};
    const hatch = this._tankPoint(...((tc.fire?.emitters || [[27, 5]])[0]));
    g.globalCompositeOperation = 'lighter';
    const fl = 1 + (Math.sin(this.t * 13) * 0.5 + Math.sin(this.t * 7.3) * 0.5) * (glow.flicker ?? 0.35);
    const gr = glow.radius ?? 26;
    for (const k of [1, 0.66, 0.36]) {
      g.globalAlpha = (glow.alpha ?? 0.14) * fl;
      disc(g, hatch.x, hatch.y + 4, gr * k, glow.color || '#ff9440');
    }
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';
    const tw = this.tank.width;
    const th = this.tank.height;
    const tx = Math.round(this.tankX - tw / 2);
    const ty = Math.round(this.tankY - th);
    if (tc.flip) {
      g.save();
      g.translate(tx + tw, ty);
      g.scale(-1, 1);
      g.drawImage(this.tank, 0, 0);
      g.restore();
    } else g.drawImage(this.tank, tx, ty);

    // fumo: sbuffi pieni (prima i più vecchi), lato verso il sole più chiaro; si dissolvono alla fine
    const sm = tc.smoke || {};
    const sc0 = hex(sm.color || '#342c2a');
    const sc1 = hex(sm.light || '#8a7672');
    const shl = hex(sm.highlight || '#b48a7c');
    for (const p of this.smoke) {
      const k = p.age / p.life;
      const r = p.r0 + (p.r1 - p.r0) * Math.sqrt(k);
      const col = mixRGB(sc0, sc1, k);
      g.globalAlpha = k > 0.8 ? 1 - (k - 0.8) / 0.2 : 1;
      disc(g, p.x + this.sunDir, p.y - 1, r, css(mixRGB(col, shl, 0.55)));
      disc(g, p.x, p.y, r, css(col));
    }
    g.globalAlpha = 1;
    // fiamme: corpo pieno che tremola sopra ogni punto in fiamme + lingue che salgono
    const fire = tc.fire || {};
    const fcols = fire.colors || ['#fff6c4', '#ffd848', '#ff9a28', '#e04a14', '#7a2a14'];
    const bodies = fire.bodies || [[7, 13]];
    (fire.emitters || [[27, 4]]).forEach(([ex, ey], n) => {
      const e = this._tankPoint(ex, ey);
      const [bw, bh] = bodies[n] || bodies[bodies.length - 1];
      const fh = bh * (0.85 + 0.15 * Math.sin(this.t * 11 + n * 2));
      for (let dy = 0; dy < fh; dy++) {
        const k = dy / fh;
        const hw = (bw / 2) * (1 - k * k) * (0.8 + 0.2 * Math.sin(this.t * 17 + dy * 1.3 + n));
        const sway = Math.round(Math.sin(this.t * 6 + dy * 0.5 + n) * k * 1.5 + this.wind * k * 2);
        g.fillStyle = fcols[Math.min(fcols.length - 2, Math.floor(k * (fcols.length - 1) + 0.3))];
        g.fillRect(Math.round(e.x - hw) + sway, e.y - dy, Math.max(1, Math.round(hw * 2)), 1);
      }
    });
    for (const p of this.flames) {
      const k = p.age / p.life;
      const w = k < 0.4 ? 2 : 1;
      const h = k < 0.3 ? 4 : k < 0.65 ? 3 : 1;
      g.fillStyle = fcols[Math.min(fcols.length - 1, Math.floor(k * fcols.length))];
      g.fillRect(Math.round(p.x - w / 2), Math.round(p.y - h / 2), w, h);
    }
    g.fillStyle = tc.embers?.color || '#ffb048';
    for (const p of this.embers) if (Math.sin(this.t * 25 + p.life * 40) > -0.3) g.fillRect(Math.round(p.x), Math.round(p.y), 1, 1);
  }

  /** Bandiera a brandelli: colonna per colonna con un'onda che cresce verso il bordo libero. */
  _drawFlag() {
    const { g } = this;
    const f = this.cfg.flag || {};
    const fl = this.flag;
    const wave = f.wave || {};
    const cols = f.colors || ['#6e1610', '#9c2218', '#c8301f', '#e8523a'];
    const px = this.flagX;
    const base = this.groundY + (f.base ?? 6);
    const top = Math.max(f.minTop ?? 6, base - (f.poleHeight ?? 110));
    rect(g, px, top, 3, base - top, f.pole || '#4e4034');
    rect(g, this.sunDir < 0 ? px : px + 2, top, 1, base - top, f.poleLight || '#a69276');
    rect(g, px - 1, top - 3, 5, 3, f.finial || '#d8b060');
    const dir = this.wind;
    const W = Math.max(...fl.len) + 1;
    for (let c = 0; c < W; c++) {
      const ph = this.t * (wave.speed ?? 5.2) - c * (wave.length ?? 0.3);
      const amp = (wave.amplitude ?? 3.4) * Math.pow(c / fl.W, 0.8);
      const dy = Math.round(Math.sin(ph) * amp + (c / fl.W) * 2);
      const shade = clamp(Math.round(1.6 + Math.cos(ph) * 1.6 * Math.min(1, c / 6 + 0.2)), 0, cols.length - 1);
      const x = dir < 0 ? px - 1 - c : px + 3 + c;
      for (let r = 0; r < fl.H; r++) {
        if (c >= fl.len[r]) continue;
        const k = `${r},${c}`;
        if (fl.hole.has(k)) continue;
        g.fillStyle = fl.burnt.has(k) ? f.burnt || '#38100c' : cols[shade];
        g.fillRect(x, top + 1 + r + dy, 1, 1);
      }
    }
  }

  /** Coda della kefiah mossa dal vento (esce da dietro la spalla). */
  _drawScarf(ox, oy, c, outline) {
    const { g } = this;
    const dir = this.wind;
    const ax = ox + (dir < 0 ? 30 : 208);
    const ay = oy + 206;
    const len = 34;
    for (let i = 0; i < len; i++) {
      const x = ax + dir * i;
      const y = Math.round(ay + i * 0.35 + Math.sin(this.t * 7 - i * 0.4) * i * 0.2);
      const h = Math.max(3, Math.round(12 - i * 0.28));
      rect(g, x, y - 1, 1, h + 2, outline || '#1c120e');
      for (let k = 0; k < h; k++) {
        const p = (i + k) % 6 === 0 || (i - k + 60) % 6 === 0;
        rect(g, x, y + k, 1, 1, p ? c.scarfPattern || '#6a5440' : k === h - 1 ? c.scarfDark || '#a8987a' : c.scarf || '#d8caa8');
      }
    }
  }
}
