// Scena animata dietro al menu principale: notte di battaglia su una città in rovina nel deserto, in controluce.
// La camera scorre lentamente verso destra e gli strati si muovono a velocità diverse (parallasse): cielo con
// stelle, luna e nuvole accese dal basso, montagne, due file di città con incendi e colonne di fumo, terreno con
// reticolati e carcasse, nebbia bassa e in primo piano una squadra di soldati che marcia sul crinale con la
// bandiera rossa a brandelli. Nel cielo: traccianti contraerei, razzi illuminanti, esplosioni che illuminano
// tutto, un elicottero col faro e ogni tanto un caccia. Tutto procedurale (js/menu_art.js), parametri in
// config/menu_scene.json.

import {
  bayer, mulberry32, rnd, range, clamp, hex, mixRGB, css, makeCanvas, rect, disc, line,
  rimLight, makeMoon, makeCloudStreak, paintCity, paintNear, paintFront, paintFore, makeWalker, makeHeli, makeJet,
} from './menu_art.js';

const CHUNK = 128;

/** Strato a pezzi larghi CHUNK, disegnati su richiesta e scartati quando escono dallo schermo. */
class Strip {
  constructor(factor, paint) {
    this.factor = factor;
    this.paint = paint; // (g, x0, x1) -> dati del pezzo (es. fuochi)
    this.chunks = new Map();
  }

  reset() {
    this.chunks.clear();
  }

  off(cam) {
    return Math.round(cam * this.factor);
  }

  /** Pezzi visibili: [{ i, canvas, data }]. */
  visible(cam, w, h) {
    const off = this.off(cam);
    const i0 = Math.floor(off / CHUNK);
    const i1 = Math.floor((off + w) / CHUNK);
    const out = [];
    for (let i = i0; i <= i1; i++) {
      let ch = this.chunks.get(i);
      if (!ch) {
        const { c, g } = makeCanvas(CHUNK, h);
        const data = this.paint(g, i * CHUNK, (i + 1) * CHUNK, c) || {};
        ch = { i, canvas: c, data };
        this.chunks.set(i, ch);
      }
      out.push(ch);
    }
    for (const k of this.chunks.keys()) if (k < i0 - 1 || k > i1 + 1) this.chunks.delete(k);
    return out;
  }

  draw(g, cam, w, h) {
    const off = this.off(cam);
    for (const ch of this.visible(cam, w, h)) g.drawImage(ch.canvas, ch.i * CHUNK - off, 0);
  }

  /** Da coordinate dello strato a coordinate dello schermo. */
  sx(x, cam) {
    return x - this.off(cam);
  }
}

export class MenuScene {
  constructor(canvas, cfg) {
    this.canvas = canvas;
    this.g = canvas.getContext('2d');
    this.cfg = cfg;
    this.viewLeft = 0;
    this.visible = false;
    this.raf = 0;
    this.t = 0;
    this.cam = 0;
    this.flash = 0;
    this.smoke = [];
    this.bullets = [];
    this.bursts = [];
    this.flares = [];
    this.booms = [];
    this.sparks = [];
    this.helis = [];
    this.jets = [];
    this.trails = [];
    this.embers = [];
    this.ash = [];
    this.timers = {
      tracer: range(cfg.tracers?.interval, [0.6, 2]),
      flare: range(cfg.flares?.firstDelay, [1, 3]),
      boom: range(cfg.explosions?.firstDelay, [1, 3]),
      heli: range(cfg.helicopter?.firstDelay, [3, 6]),
      jet: range(cfg.jet?.firstDelay, [8, 14]),
    };
    this.walkers = new Map();
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
      // all'avvio fumo, nuvole e razzi sono già in scena
      this.warm = true;
      for (let i = 0; i < 200; i++) this.update(1 / 20);
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

  /** Larghezza in px CSS coperta dal pannello del menu: la squadra e la luna stanno nella parte scoperta. */
  setViewLeft(px) {
    if (Math.abs(px - this.viewLeft) < 1) return;
    this.viewLeft = px;
    if (this.visible) this._layout();
  }

  resize() {
    const cw = window.innerWidth;
    const ch = window.innerHeight;
    this.scale = Math.max(1, Math.round(ch / (this.cfg.targetHeight ?? 200)));
    this.w = Math.ceil(cw / this.scale);
    this.h = Math.ceil(ch / this.scale);
    this.canvas.width = this.w;
    this.canvas.height = this.h;
    this.canvas.style.width = `${this.w * this.scale}px`;
    this.canvas.style.height = `${this.h * this.scale}px`;
    this.g.imageSmoothingEnabled = false;
    this.horizon = Math.round(this.h * (this.cfg.horizon ?? 0.6));
    this._buildStatic();
    this._layout();
  }

  _layout() {
    const s = this.scale || 1;
    this.vx0 = Math.min(this.viewLeft / s, this.w * 0.6);
    this.vis = this.w - this.vx0;
  }

  /** Profilo di un terreno: somma di onde (stabile per x). */
  _wave(def, x, salt) {
    let y = 0;
    (def.waves || []).forEach(([f, a], i) => {
      y += Math.sin(x * f + salt * 1.3 + i * 2.7) * a;
    });
    return y;
  }

  // ---------- Parti statiche (ricostruite a ogni ridimensionamento) ----------

  _buildStatic() {
    const cfg = this.cfg;
    const { w, h, horizon } = this;
    // cielo: sfumatura a fasce con retino fino all'orizzonte infuocato
    const sky = makeCanvas(w, h);
    const stops = (cfg.sky?.stops || [[0, '#0b0a1e'], [1, '#ffb05a']]).map(([t, c]) => [t, hex(c)]);
    const at = (t) => {
      for (let i = 1; i < stops.length; i++) {
        if (t <= stops[i][0]) return mixRGB(stops[i - 1][1], stops[i][1], (t - stops[i - 1][0]) / Math.max(1e-6, stops[i][0] - stops[i - 1][0]));
      }
      return stops[stops.length - 1][1];
    };
    const LEV = 28;
    const pal = Array.from({ length: LEV }, (_, i) => at(i / (LEV - 1)));
    const img = sky.g.createImageData(w, h);
    for (let y = 0; y < h; y++) {
      const t = clamp(y / Math.max(1, horizon + 8), 0, 1) * (LEV - 1);
      const i0 = Math.floor(t);
      for (let x = 0; x < w; x++) {
        const col = pal[Math.min(LEV - 1, t - i0 > bayer(x, y) ? i0 + 1 : i0)];
        const k = (y * w + x) * 4;
        img.data[k] = col[0];
        img.data[k + 1] = col[1];
        img.data[k + 2] = col[2];
        img.data[k + 3] = 255;
      }
    }
    sky.g.putImageData(img, 0, 0);
    this.sky = sky.c;

    // stelle
    const r = mulberry32((cfg.seed ?? 7) + 1);
    const sc = cfg.stars || {};
    this.stars = Array.from({ length: Math.round((sc.count ?? 140) * (w / 400)) }, () => {
      const y = Math.floor(Math.pow(r(), 1.6) * horizon * (sc.until ?? 0.6));
      return { x: Math.floor(r() * w), y, b: 0.35 + r() * 0.65, ph: r() * 6, sp: 0.8 + r() * 2.5, big: r() < 0.06 };
    });
    this.moon = makeMoon(cfg.moon || {});

    // nuvole iniziali
    const cc = cfg.clouds || {};
    this.clouds = [];
    for (let i = 0; i < (cc.count ?? 5); i++) this._spawnCloud(rnd(-60, w));

    // strati
    const mt = cfg.mountains || {};
    const far = cfg.farCity || {};
    const mid = cfg.midCity || {};
    const near = cfg.near || {};
    const front = cfg.front || {};
    const fore = cfg.fore || {};
    this.foreY = (x) => h + (fore.y ?? -5) - this._wave(fore, x, 7);
    this.mountainY = (x) => horizon + (mt.y ?? -8) - this._wave(mt, x, 1);
    this.nearY = (x) => horizon + (near.y ?? 8) - this._wave(near, x, 3);
    this.frontY = (x) => horizon + (front.y ?? 16) - this._wave(front, x, 5);
    const seed = cfg.seed ?? 7;
    this.strips = {
      mountains: new Strip(mt.parallax ?? 0.05, (g, x0, x1, c) => {
        for (let x = x0; x < x1; x++) rect(g, x - x0, Math.round(this.mountainY(x)), 1, h, mt.color || '#2e1a3a');
        rimLight(c, mt.rim || '#6a2e4a', { amount: 0.7, depth: 2 });
      }),
      far: new Strip(far.parallax ?? 0.15, (g, x0, x1, c) => {
        const d = paintCity(g, x0, x1, horizon + (far.y ?? 2), far, seed + 10);
        rimLight(c, far.rim || '#8a3446', { amount: 0.75, depth: 2 });
        return d;
      }),
      mid: new Strip(mid.parallax ?? 0.38, (g, x0, x1, c) => {
        const d = paintCity(g, x0, x1, horizon + (mid.y ?? 12), mid, seed + 20);
        rimLight(c, mid.rim || '#c04a3c', { amount: 0.8, depth: 2 });
        return d;
      }),
      near: new Strip(near.parallax ?? 0.7, (g, x0, x1, c) => {
        paintNear(g, x0, x1, this.nearY, near, seed + 30);
        rimLight(c, near.rim || '#d0603a', { amount: 0.75, depth: 1 });
      }),
      front: new Strip(front.parallax ?? 1, (g, x0, x1, c) => {
        paintFront(g, x0, x1, this.frontY, front, seed + 40);
        rimLight(c, front.rim || '#ff8a4a', { amount: 0.6, depth: 1 });
      }),
      fore: new Strip(fore.parallax ?? 1.4, (g, x0, x1, c) => {
        paintFore(g, x0, x1, this.foreY, fore, seed + 60);
        rimLight(c, fore.rim || '#a04a34', { amount: 0.5, depth: 1 });
      }),
    };

    // nebbia bassa: fasce a retino che scorrono
    const fc = cfg.fog || {};
    const fh = fc.height ?? 16;
    const fog = makeCanvas(w * 2, fh);
    const fcol = hex(fc.color || '#6a3048');
    const fr = mulberry32(seed + 50);
    const phase = Array.from({ length: 4 }, () => fr() * 6);
    for (let y = 0; y < fh; y++) {
      for (let x = 0; x < w * 2; x++) {
        const v = (Math.sin((x / (w * 2)) * Math.PI * 2 * 3 + phase[0]) + Math.sin((x / (w * 2)) * Math.PI * 2 * 7 + phase[1]) * 0.5 + 1.5) / 3;
        const vy = 1 - Math.abs(y / fh - 0.5) * 2;
        if (bayer(x, y) < v * vy * 0.9) {
          fog.g.fillStyle = `rgba(${fcol[0]},${fcol[1]},${fcol[2]},${fc.alpha ?? 0.35})`;
          fog.g.fillRect(x, y, 1, 1);
        }
      }
    }
    this.fog = fog.c;

    // vignettatura
    const vg = makeCanvas(w, h);
    const vs = cfg.vignette?.strength ?? 0.55;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const dx = (x / w - 0.5) * 2;
        const dy = (y / h - 0.45) * 2;
        const k = clamp((Math.hypot(dx * 0.9, dy) - 0.7) / 0.7, 0, 1) * vs;
        if (k > 0 && bayer(x, y) < k) {
          vg.g.fillStyle = 'rgba(0,0,0,0.5)';
          vg.g.fillRect(x, y, 1, 1);
        }
      }
    }
    this.vignette = vg.c;
  }

  _spawnCloud(x) {
    const cc = this.cfg.clouds || {};
    const w = Math.round(range(cc.width, [60, 150]));
    const h = Math.round(range(cc.height, [5, 11]));
    const [y0, y1] = cc.yRange || [0.08, 0.42];
    this.clouds.push({
      img: makeCloudStreak(cc, w, h, Math.floor(Math.random() * 1e6)),
      x,
      y: Math.round(this.horizon * rnd(y0, y1)),
      v: range(cc.speed, [1.5, 4]),
    });
  }

  // ---------- Aggiornamento ----------

  update(dt) {
    const cfg = this.cfg;
    this.t += dt;
    if (!this.w) return;
    this.cam += (cfg.camera?.speed ?? 9) * dt;
    this.flash = Math.max(0, this.flash - dt * (cfg.explosions?.flashDecay ?? 2.5));
    const { w, h } = this;
    const S = this.strips;

    // nuvole
    for (const c of this.clouds) c.x -= c.v * dt + (cfg.camera?.speed ?? 9) * 0.04 * dt;
    this.clouds = this.clouds.filter((c) => c.x > -c.img.width - 4);
    while (this.clouds.length < (cfg.clouds?.count ?? 5)) this._spawnCloud(w + rnd(0, 40));

    // fumo dai punti in fiamme degli strati di città
    const fc = cfg.fires || {};
    const sm = fc.smoke || {};
    for (const [name, strip] of [['far', S.far], ['mid', S.mid]]) {
      for (const ch of strip.visible(this.cam, w, h)) {
        for (const f of ch.data.fires || []) {
          if (Math.random() < dt * (fc.smokeRate ?? 1.6) * f.s && this.smoke.length < (sm.max ?? 400)) {
            const k = name === 'far' ? 0.7 : 1;
            this.smoke.push({ strip: name, x: f.x + rnd(-1, 1), y: f.y - 2, vx: rnd(-1, 1), vy: -range(sm.speed, [4, 8]) * k, age: 0, life: range(sm.life, [7, 12]), r0: (sm.size?.[0] ?? 1.5) * k * f.s, r1: (sm.size?.[1] ?? 7) * k * (0.6 + f.s * 0.5) });
          }
        }
      }
    }
    for (const p of this.smoke) {
      p.age += dt;
      p.x += (p.vx + (sm.drift ?? -3) * Math.min(1, p.age / 3)) * dt;
      p.y += p.vy * dt * (1 - (p.age / p.life) * 0.6);
    }
    this.smoke = this.smoke.filter((p) => p.age < p.life);

    // traccianti contraerei: raffiche dalla città di mezzo
    const tc = cfg.tracers || {};
    this.timers.tracer -= dt;
    if (this.timers.tracer <= 0) {
      this.timers.tracer = range(tc.interval, [0.6, 2.2]);
      const sx = rnd(this.vx0 * 0.5, w);
      const base = (rnd(-90, 90) * Math.PI) / 180;
      this.bursts.push({
        x: sx + S.mid.off(this.cam),
        y: this.horizon + (cfg.midCity?.y ?? 12) - rnd(0, 18),
        a: -Math.PI / 2 + base * ((tc.spreadDeg ?? 35) / 90),
        sweep: rnd(-0.4, 0.4),
        left: Math.round(range(tc.shots, [6, 16])),
        cd: 0,
        color: (tc.colors || ['#a0ff80'])[Math.floor(Math.random() * (tc.colors?.length ?? 1))],
        speed: range(tc.speed, [90, 130]),
      });
    }
    for (const b of this.bursts) {
      b.cd -= dt;
      b.a += b.sweep * dt;
      while (b.cd <= 0 && b.left > 0) {
        b.cd += tc.rate ?? 0.07;
        b.left--;
        if (this.bullets.length < (tc.max ?? 220)) {
          const a = b.a + rnd(-0.03, 0.03);
          this.bullets.push({ x: b.x, y: b.y, vx: Math.cos(a) * b.speed, vy: Math.sin(a) * b.speed, age: 0, life: tc.life ?? 1.8, color: b.color });
        }
      }
    }
    this.bursts = this.bursts.filter((b) => b.left > 0);
    for (const p of this.bullets) {
      p.age += dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += 14 * dt;
    }
    this.bullets = this.bullets.filter((p) => p.age < p.life && p.y > -10);

    // razzi illuminanti che scendono dondolando
    const fl = cfg.flares || {};
    this.timers.flare -= dt;
    if (this.timers.flare <= 0) {
      this.timers.flare = range(fl.interval, [5, 11]);
      if (this.flares.length < (fl.max ?? 3)) {
        this.flares.push({ x: rnd(this.vx0, w) + S.far.off(this.cam), y: this.horizon * rnd(0.12, 0.4), age: 0, life: range(fl.life, [12, 18]), ph: Math.random() * 6, trail: [] });
      }
    }
    for (const f of this.flares) {
      f.age += dt;
      f.y += (fl.fall ?? 4) * dt;
      f.x += Math.sin(f.age * 1.2 + f.ph) * 3 * dt;
      f.tt = (f.tt || 0) + dt;
      if (f.tt > 0.12) {
        f.tt = 0;
        f.trail.push({ x: f.x, y: f.y - 2, age: 0 });
      }
      for (const p of f.trail) {
        p.age += dt;
        p.y -= 1.5 * dt;
        p.x -= 2 * dt;
      }
      f.trail = f.trail.filter((p) => p.age < 4);
    }
    this.flares = this.flares.filter((f) => f.age < f.life);

    // esplosioni tra gli edifici (lontane o più vicine): lampo, palla di fuoco, scintille, fumo
    const ex = cfg.explosions || {};
    this.timers.boom -= dt;
    if (this.timers.boom <= 0) {
      this.timers.boom = range(ex.interval, [3, 8]);
      const strip = Math.random() < 0.55 ? 'far' : 'mid';
      const big = strip === 'mid' && Math.random() < 0.5;
      const sx = rnd(this.vx0 * 0.6, w);
      const by = this.horizon + (strip === 'far' ? cfg.farCity?.y ?? 2 : cfg.midCity?.y ?? 12) - rnd(4, 16);
      this.booms.push({ strip, x: sx + S[strip].off(this.cam), y: by, age: 0, size: (strip === 'far' ? 0.6 : 1) * (big ? 1.5 : 1) });
      this.flash = Math.min(1, this.flash + (ex.flash ?? 0.35) * (strip === 'far' ? 0.6 : 1) * (big ? 1.4 : 1));
      for (let i = 0; i < (big ? 26 : 14); i++) {
        const a = rnd(-Math.PI, 0);
        const v = rnd(20, 55);
        this.sparks.push({ strip, x: sx + S[strip].off(this.cam), y: by, vx: Math.cos(a) * v, vy: Math.sin(a) * v, age: 0, life: rnd(0.6, 1.4) });
      }
    }
    for (const b of this.booms) {
      b.age += dt;
      if (b.age > 0.35 && !b.smoked) {
        b.smoked = true;
        for (let i = 0; i < 8; i++) {
          this.smoke.push({ strip: b.strip, x: b.x + rnd(-4, 4) * b.size, y: b.y - rnd(0, 6) * b.size, vx: rnd(-2, 2), vy: -rnd(4, 9), age: 0, life: rnd(5, 9), r0: 3 * b.size, r1: 9 * b.size });
        }
      }
    }
    this.booms = this.booms.filter((b) => b.age < 1.2);
    for (const p of this.sparks) {
      p.age += dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += 40 * dt;
    }
    this.sparks = this.sparks.filter((p) => p.age < p.life);

    // elicottero col faro
    const hc = cfg.helicopter || {};
    this.timers.heli -= dt;
    if (this.timers.heli <= 0) {
      this.timers.heli = range(hc.interval, [10, 22]);
      const dir = Math.random() < 0.5 ? 1 : -1;
      const f = hc.parallax ?? 0.45;
      this.helis.push({ dir, f, x: (dir > 0 ? -60 : w + 10) + this.cam * f, y: this.horizon * range(hc.yRange, [0.3, 0.6]), v: range(hc.speed, [18, 28]), ph: Math.random() * 6 });
    }
    for (const hl of this.helis) hl.x += hl.v * hl.dir * dt;
    this.helis = this.helis.filter((hl) => {
      const sx = hl.x - this.cam * hl.f;
      return sx > -80 && sx < w + 80;
    });

    // caccia con la scia
    const jc = cfg.jet || {};
    this.timers.jet -= dt;
    if (this.timers.jet <= 0) {
      this.timers.jet = range(jc.interval, [16, 32]);
      const dir = Math.random() < 0.5 ? 1 : -1;
      this.jets.push({ dir, x: dir > 0 ? -30 : w + 30, y: this.horizon * range(jc.yRange, [0.08, 0.3]), v: range(jc.speed, [150, 190]) });
    }
    for (const j of this.jets) {
      j.x += j.v * j.dir * dt;
      this.trails.push({ x: j.x - j.dir * 2, y: j.y + 1, age: 0 });
    }
    this.jets = this.jets.filter((j) => j.x > -60 && j.x < w + 60);
    for (const p of this.trails) p.age += dt;
    this.trails = this.trails.filter((p) => p.age < 3);

    // braci che salgono e cenere che scende
    const em = cfg.embers || {};
    if (Math.random() < dt * (em.rate ?? 6) * (w / 400) && this.embers.length < (em.max ?? 90)) {
      this.embers.push({ x: rnd(0, w), y: h + 2, vx: rnd(-3, 3), vy: -range(em.speed, [8, 20]), age: 0, life: range(em.life, [3, 7]), ph: Math.random() * 6, c: Math.floor(Math.random() * (em.colors?.length ?? 1)) });
    }
    for (const p of this.embers) {
      p.age += dt;
      p.x += (p.vx + Math.sin(this.t * 2 + p.ph) * 4 - 3) * dt;
      p.y += p.vy * dt;
    }
    this.embers = this.embers.filter((p) => p.age < p.life);
    const ac = cfg.ash || {};
    if (Math.random() < dt * (ac.rate ?? 4) * (w / 400) && this.ash.length < (ac.max ?? 60)) {
      this.ash.push({ x: rnd(0, w + 40), y: -2, v: range(ac.speed, [3, 7]), ph: Math.random() * 6 });
    }
    for (const p of this.ash) {
      p.y += p.v * dt;
      p.x += (Math.sin(this.t + p.ph) * 3 - 5) * dt;
    }
    this.ash = this.ash.filter((p) => p.y < h + 2 && p.x > -4);
  }

  // ---------- Disegno ----------

  _glow(x, y, r, color, alpha) {
    const { g } = this;
    g.globalCompositeOperation = 'lighter';
    for (const k of [1, 0.66, 0.38]) {
      g.globalAlpha = alpha;
      disc(g, x, y, r * k, color);
    }
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';
  }

  render() {
    const { g, cfg, w, h } = this;
    if (!this.sky) return;
    const S = this.strips;
    const cam = this.cam;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';
    g.drawImage(this.sky, 0, 0);

    // stelle (scintillano; spariscono nel riverbero vicino all'orizzonte)
    const st = cfg.stars || {};
    g.fillStyle = st.color || '#fff2e0';
    for (const s of this.stars) {
      const a = s.b * (0.55 + 0.45 * Math.sin(this.t * s.sp + s.ph));
      g.globalAlpha = a;
      g.fillRect(s.x, s.y, 1, 1);
      if (s.big && a > 0.7) {
        g.globalAlpha = a * 0.4;
        g.fillRect(s.x - 1, s.y, 3, 1);
        g.fillRect(s.x, s.y - 1, 1, 3);
      }
    }
    g.globalAlpha = 1;
    const mc = cfg.moon || {};
    const mx = Math.round(this.vx0 + this.vis * (mc.at ?? 0.8) - this.moon.width / 2);
    g.drawImage(this.moon, mx, Math.round(this.horizon * (mc.y ?? 0.25) - this.moon.height / 2));

    for (const c of this.clouds) g.drawImage(c.img, Math.round(c.x), c.y);

    // caccia e scie (molto in alto)
    const jc = cfg.jet || {};
    g.fillStyle = jc.trail || 'rgba(220,200,210,0.4)';
    for (const p of this.trails) {
      g.globalAlpha = 1 - p.age / 3;
      g.fillRect(Math.round(p.x), Math.round(p.y + p.age * 1.5), 1, 1);
    }
    g.globalAlpha = 1;
    if (!this.jetSprite) this.jetSprite = makeJet(jc);
    for (const j of this.jets) {
      const x = Math.round(j.x - 11);
      const y = Math.round(j.y - 4);
      if (j.dir > 0) g.drawImage(this.jetSprite, x, y);
      else {
        g.save();
        g.translate(x + 22, y);
        g.scale(-1, 1);
        g.drawImage(this.jetSprite, 0, 0);
        g.restore();
      }
      this._glow(j.x - j.dir * 11, j.y + 0.5, 3, jc.burner || '#ffb060', 0.35);
    }

    S.mountains.draw(g, cam, w, h);

    // città lontana: esplosioni dietro, poi edifici, fuochi e fumo
    this._drawBooms('far');
    S.far.draw(g, cam, w, h);
    this._drawFires('far');
    this._drawSmoke('far');
    this._drawFlares();

    // traccianti, esplosioni dietro la città di mezzo, città di mezzo
    for (const p of this.bullets) {
      const k = p.age / p.life;
      const x = p.x - S.mid.off(cam);
      g.globalAlpha = k > 0.7 ? 1 - (k - 0.7) / 0.3 : 1;
      line(g, x, p.y, x - p.vx * 0.025, p.y - p.vy * 0.025, 1, p.color);
    }
    g.globalAlpha = 1;
    this._drawBooms('mid');
    S.mid.draw(g, cam, w, h);
    this._drawFires('mid');
    this._drawSmoke('mid');
    this._drawSparks();
    this._drawHelis();

    // nebbia, terreno vicino, primo piano con la squadra
    const fc = cfg.fog || {};
    const fy = this.horizon + (fc.y ?? 14);
    const fo = Math.round((cam * 0.55 + this.t * (fc.drift ?? 4)) % this.fog.width);
    g.drawImage(this.fog, -fo, fy);
    g.drawImage(this.fog, this.fog.width - fo, fy);
    S.near.draw(g, cam, w, h);
    S.front.draw(g, cam, w, h);
    this._drawSquad();
    S.fore.draw(g, cam, w, h);

    // braci e cenere
    const em = cfg.embers || {};
    const ecols = em.colors || ['#ffd070', '#ff8a30', '#c04020'];
    for (const p of this.embers) {
      if (Math.sin(this.t * 14 + p.ph * 10) < -0.5) continue;
      g.globalAlpha = 1 - p.age / p.life;
      g.fillStyle = ecols[Math.min(ecols.length - 1, p.c + Math.floor((p.age / p.life) * 2))];
      g.fillRect(Math.round(p.x), Math.round(p.y), 1, 1);
    }
    g.globalAlpha = 1;
    g.fillStyle = cfg.ash?.color || 'rgba(200,180,190,0.5)';
    for (const p of this.ash) g.fillRect(Math.round(p.x), Math.round(p.y), 1, 1);

    // lampo delle esplosioni su tutta la scena, poi vignettatura
    if (this.flash > 0.01) {
      g.globalCompositeOperation = 'lighter';
      g.globalAlpha = this.flash * 0.3;
      g.fillStyle = cfg.explosions?.flashColor || '#ff8a4a';
      g.fillRect(0, 0, w, h);
      g.globalAlpha = 1;
      g.globalCompositeOperation = 'source-over';
    }
    g.drawImage(this.vignette, 0, 0);
  }

  _drawFires(name) {
    const { g, cfg } = this;
    const strip = this.strips[name];
    const fc = cfg.fires || {};
    const flame = fc.flame || ['#fff0b0', '#ffc040', '#ff7020', '#c03010'];
    const k = name === 'far' ? 0.7 : 1;
    for (const ch of strip.visible(this.cam, this.w, this.h)) {
      for (const f of ch.data.fires || []) {
        const x = strip.sx(f.x, this.cam);
        if (x < -20 || x > this.w + 20) continue;
        const fl = 0.75 + 0.25 * Math.sin(this.t * 9 + f.ph) * Math.sin(this.t * 5.3 + f.ph * 2);
        this._glow(x, f.y, (fc.glow?.radius ?? 7) * f.s * k * (0.9 + fl * 0.2), fc.glow?.color || '#ff7a30', (fc.glow?.alpha ?? 0.18) * fl);
        const hgt = Math.round((2 + 4 * f.s * k) * fl);
        for (let dy = 0; dy < hgt; dy++) {
          const t = dy / hgt;
          const hw = Math.max(0, Math.round((1 - t) * 1.6 * f.s * k + Math.sin(this.t * 13 + dy + f.ph) * 0.6));
          g.fillStyle = flame[Math.min(flame.length - 1, Math.floor(t * flame.length))];
          g.fillRect(Math.round(x - hw), Math.round(f.y - dy), hw * 2 + 1, 1);
        }
      }
      for (const b of ch.data.beacons || []) {
        const per = cfg.beacons?.period ?? 1.6;
        if ((this.t + b.ph) % per < per * 0.3) {
          const x = strip.sx(b.x, this.cam);
          g.fillStyle = cfg.beacons?.color || '#ff3a2a';
          g.fillRect(Math.round(x), b.y, 1, 1);
          this._glow(x, b.y, 3, cfg.beacons?.color || '#ff3a2a', 0.15);
        }
      }
    }
  }

  _drawSmoke(name) {
    const { g, cfg } = this;
    const strip = this.strips[name];
    const sm = cfg.fires?.smoke || {};
    const c0 = hex(sm.color || '#140c16');
    const c1 = hex(sm.light || '#3a2230');
    const alpha = sm.alpha ?? 0.75;
    for (const p of this.smoke) {
      if (p.strip !== name) continue;
      const k = p.age / p.life;
      const x = strip.sx(p.x, this.cam);
      const r = p.r0 + (p.r1 - p.r0) * Math.sqrt(k);
      if (x < -r - 2 || x > this.w + r + 2) continue;
      g.globalAlpha = alpha * (k < 0.1 ? k / 0.1 : 1 - Math.max(0, k - 0.6) / 0.4);
      disc(g, x, p.y, r, css(mixRGB(c0, c1, k)));
    }
    g.globalAlpha = 1;
  }

  _drawFlares() {
    const { g, cfg } = this;
    const fl = cfg.flares || {};
    const strip = this.strips.far;
    for (const f of this.flares) {
      g.fillStyle = fl.trail || 'rgba(200,180,190,0.35)';
      for (const p of f.trail) {
        g.globalAlpha = 1 - p.age / 4;
        g.fillRect(Math.round(strip.sx(p.x, this.cam)), Math.round(p.y), 1, 1);
      }
      g.globalAlpha = 1;
      const x = strip.sx(f.x, this.cam);
      const fade = Math.min(1, f.age / 0.5, (f.life - f.age) / 2);
      const fli = 0.85 + Math.sin(this.t * 23 + f.ph) * 0.15;
      this._glow(x, f.y, (fl.glowRadius ?? 20) * fli, fl.glow || '#ffe0b0', (fl.glowAlpha ?? 0.07) * fade);
      g.globalAlpha = fade;
      g.fillStyle = fl.color || '#ffffff';
      g.fillRect(Math.round(x), Math.round(f.y), 2, 2);
      g.globalAlpha = 1;
    }
  }

  _drawBooms(name) {
    const { g, cfg } = this;
    const strip = this.strips[name];
    const cols = cfg.explosions?.colors || ['#ffffff', '#fff0a0', '#ffb040', '#ff6020', '#a02010'];
    for (const b of this.booms) {
      if (b.strip !== name) continue;
      const x = strip.sx(b.x, this.cam);
      const k = b.age / 1.2;
      const r = (4 + 14 * Math.sqrt(k)) * b.size;
      this._glow(x, b.y, r * 2.2, cols[2], 0.12 * (1 - k));
      // palla di fuoco: anelli dal bianco al rosso, si spegne dall'esterno
      const n = cols.length;
      for (let i = n - 1; i >= 0; i--) {
        const rr = r * (1 - i / n) * (1 - k * 0.5);
        if (rr < 0.5 || k > 0.85) continue;
        disc(g, x, b.y - k * 6 * b.size, rr, cols[Math.min(n - 1, i + Math.floor(k * 3))]);
      }
    }
  }

  _drawSparks() {
    const { g, cfg } = this;
    g.fillStyle = cfg.explosions?.sparks || '#ffc060';
    for (const p of this.sparks) {
      const x = this.strips[p.strip].sx(p.x, this.cam);
      g.globalAlpha = 1 - p.age / p.life;
      g.fillRect(Math.round(x), Math.round(p.y), 1, 1);
    }
    g.globalAlpha = 1;
  }

  _drawHelis() {
    const { g, cfg } = this;
    const hc = cfg.helicopter || {};
    if (!this.heliSprite) this.heliSprite = makeHeli(hc);
    const spr = this.heliSprite;
    for (const hl of this.helis) {
      const sx = Math.round(hl.x - this.cam * hl.f);
      const sy = Math.round(hl.y + Math.sin(this.t * 1.7 + hl.ph) * 1.5);
      // faro: cono di luce che spazza il terreno
      const nose = hl.dir > 0 ? sx + 40 : sx + 10;
      const by = sy + 14;
      const ang = Math.PI / 2 - hl.dir * (0.45 + Math.sin(this.t * 0.9 + hl.ph) * 0.35);
      const len = this.horizon + 30 - by;
      const spread = 0.12;
      const p1 = [nose + Math.cos(ang - spread) * len * 1.4, by + Math.sin(ang - spread) * len * 1.4];
      const p2 = [nose + Math.cos(ang + spread) * len * 1.4, by + Math.sin(ang + spread) * len * 1.4];
      g.globalCompositeOperation = 'lighter';
      g.fillStyle = hc.beam || 'rgba(255,236,200,0.07)';
      g.beginPath();
      g.moveTo(nose, by);
      g.lineTo(p1[0], p1[1]);
      g.lineTo(p2[0], p2[1]);
      g.closePath();
      g.fill();
      const q1 = [nose + Math.cos(ang - spread * 0.4) * len * 1.4, by + Math.sin(ang - spread * 0.4) * len * 1.4];
      const q2 = [nose + Math.cos(ang + spread * 0.4) * len * 1.4, by + Math.sin(ang + spread * 0.4) * len * 1.4];
      g.fillStyle = hc.beamCore || 'rgba(255,240,210,0.1)';
      g.beginPath();
      g.moveTo(nose, by);
      g.lineTo(q1[0], q1[1]);
      g.lineTo(q2[0], q2[1]);
      g.closePath();
      g.fill();
      g.globalCompositeOperation = 'source-over';
      if (hl.dir > 0) g.drawImage(spr, sx, sy);
      else {
        g.save();
        g.translate(sx + spr.width, sy);
        g.scale(-1, 1);
        g.drawImage(spr, 0, 0);
        g.restore();
      }
      // rotore e luci di posizione lampeggianti
      g.fillStyle = hc.rotor || 'rgba(10,8,16,0.6)';
      const half = 24;
      const cx = sx + 26 + (hl.dir > 0 ? 0 : -2);
      if (Math.floor(this.t * 24) % 2) g.fillRect(cx - half, sy + 1, half * 2, 1);
      else {
        g.fillRect(cx - half, sy + 1, half - 4, 1);
        g.fillRect(cx + 4, sy + 1, half - 4, 1);
      }
      const nav = hc.nav || ['#ff3030', '#30ff60'];
      if (Math.floor(this.t * 1.5 + hl.ph) % 2 === 0) {
        const tx = hl.dir > 0 ? sx + 1 : sx + spr.width - 2;
        g.fillStyle = nav[0];
        g.fillRect(tx, sy + 3, 1, 1);
        this._glow(tx, sy + 3, 2.5, nav[0], 0.2);
      }
      g.fillStyle = nav[1];
      g.fillRect(hl.dir > 0 ? sx + 30 : sx + spr.width - 31, sy + 13, 1, 1);
    }
  }

  /** Squadra in marcia sul crinale: cammina alla velocità della camera, quindi resta al suo posto sullo schermo. */
  _drawSquad() {
    const { g, cfg } = this;
    const sq = cfg.squad || {};
    const n = sq.frames ?? 8;
    const stride = sq.stride ?? 15;
    const types = sq.types || ['rifle', 'rifle', 'flag'];
    const ats = sq.at || [0.55, 0.65, 0.75];
    types.forEach((type, i) => {
      const sx = Math.round(this.vx0 + this.vis * (ats[i] ?? 0.6));
      const wx = this.cam + sx;
      const frame = (Math.floor(((wx + i * 5.3) / stride) * n) % n + n) % n;
      const key = `${type}:${frame}`;
      let wk = this.walkers.get(key);
      if (!wk) {
        wk = makeWalker(type, frame, n, sq);
        this.walkers.set(key, wk);
      }
      const fy = Math.round(this.frontY(wx));
      const x = sx - wk.fx;
      const y = fy - wk.fy;
      if (type === 'flag' && wk.pole) this._drawFlag(x + wk.pole[0], y + wk.pole[1]);
      g.drawImage(wk.canvas, x, y);
    });
  }

  /** Bandiera a brandelli che sventola all'indietro (verso sinistra) dalla cima dell'asta. */
  _drawFlag(px, py) {
    const { g, cfg } = this;
    const f = cfg.flag || {};
    if (!this.flagShape) {
      const W = f.width ?? 16;
      const H = f.height ?? 10;
      const r = mulberry32((cfg.seed ?? 7) + 77);
      const len = Array.from({ length: H }, (_, k) => W - Math.floor(r() * 5) - (k >= H - 2 ? 3 : 0));
      const holes = new Set(Array.from({ length: 4 }, () => `${1 + Math.floor(r() * (H - 2))},${3 + Math.floor(r() * (W - 6))}`));
      this.flagShape = { W, H, len, holes };
    }
    const fs = this.flagShape;
    const wave = f.wave || {};
    const cols = f.colors || ['#6e1610', '#9c2218', '#c8301f', '#e8523a'];
    for (let c = 0; c < fs.W; c++) {
      const ph = this.t * (wave.speed ?? 7) - c * (wave.length ?? 0.5);
      const dy = Math.round(Math.sin(ph) * (wave.amplitude ?? 1.6) * (c / fs.W) + (c / fs.W) * 1.5);
      const shade = clamp(Math.round(1.5 + Math.cos(ph) * 1.5), 0, cols.length - 1);
      for (let r = 0; r < fs.H; r++) {
        if (c >= fs.len[r] || fs.holes.has(`${r},${c}`)) continue;
        g.fillStyle = c === fs.len[r] - 1 ? f.burnt || '#2a0c08' : cols[shade];
        g.fillRect(px - 1 - c, py + 1 + r + dy, 1, 1);
      }
    }
  }
}
