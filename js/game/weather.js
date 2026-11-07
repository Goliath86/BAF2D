// Meteo del livello: vento con raffiche e sabbia che si muove (effects.json -> "weather", il livello sceglie
// il tipo con "weather": "desert_wind"). Tutto in coordinate mondo attorno alla visuale:
// - wind: direzione (angleDeg) e intensità = base + raffiche (gustEvery / gustTime / gustStrength), con
//   un'oscillazione lenta; letta da Props (palme e cespugli) e Effects (fumo trasportato);
// - wisps: lingue di sabbia sinuose che scorrono rasoterra (sotto i soldati);
// - streaks: granelli veloci in aria (sopra tutto);
// - haze: velature di polvere grandi e tenui, a pixel sparsi (sopra tutto);
// - tint: velo di colore su tutto lo schermo (caldo del deserto), più denso durante le raffiche.
// I granelli usciti dalla visuale (più un margine) rientrano dal lato da cui soffia il vento.

const DEG = Math.PI / 180;

function rand(v, def = 0) {
  if (v === undefined || v === null) return def;
  if (Array.isArray(v)) return v[0] + Math.random() * (v[1] - v[0]);
  return v;
}

/** Velatura a pixel sparsi: densità che cala dal centro al bordo (aspetto pixel-art, niente sfumature). */
function hazeCanvas(size, color, seed) {
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const g = c.getContext('2d');
  g.fillStyle = color;
  let s = seed * 7919 + 1;
  const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const h = size / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x + 0.5 - h, (y + 0.5 - h) * 1.6) / h; // ellittica, allungata
      if (d < 1 && r() < (1 - d) * (1 - d) * 0.9) g.fillRect(x, y, 1, 1);
    }
  }
  return c;
}

export class Weather {
  /** cfg = un tipo di effects.json -> weather (null = niente meteo). */
  constructor(cfg) {
    this.cfg = cfg || null;
    this.time = 0;
    const w = this.cfg?.wind || {};
    const a = (w.angleDeg ?? 0) * DEG;
    // wind: direzione unitaria (x, y) e intensità attuale (0 = calma, ~1 = raffica)
    this.wind = { x: Math.cos(a), y: Math.sin(a), strength: w.base ?? 0 };
    this.gust = { timer: rand(w.gustEvery, 6), time: 0, duration: 0, peak: 0 };
    this.streaks = [];
    this.wisps = [];
    this.hazes = [];
    this._hazeImgs = [];
    this._seeded = false;
  }

  get active() {
    return !!this.cfg;
  }

  /** Intensità 0..1 della raffica in corso (inviluppo morbido). */
  _gustLevel() {
    const g = this.gust;
    if (g.duration <= 0) return 0;
    const k = g.time / g.duration;
    return k >= 1 ? 0 : Math.sin(Math.PI * k) * g.peak;
  }

  /** view = { x, y, w, h } (px mondo) della visuale attuale. */
  update(dt, view) {
    if (!this.cfg) return;
    const c = this.cfg;
    const w = c.wind || {};
    this.time += dt;

    // raffiche
    const g = this.gust;
    if (g.duration > 0) {
      g.time += dt;
      if (g.time >= g.duration) g.duration = 0;
    } else if ((g.timer -= dt) <= 0) {
      g.timer = rand(w.gustEvery, 6);
      g.time = 0;
      g.duration = rand(w.gustTime, 2);
      g.peak = rand(w.gustStrength, 0.7);
    }
    const wobble = Math.sin(this.time * 0.37) * (w.wobble ?? 0.08);
    this.wind.strength = Math.max(0, (w.base ?? 0.3) + wobble + this._gustLevel());
    // la direzione oscilla un poco
    const a = ((w.angleDeg ?? 0) + Math.sin(this.time * 0.13) * (w.angleWobbleDeg ?? 6)) * DEG;
    this.wind.x = Math.cos(a);
    this.wind.y = Math.sin(a);

    if (!this._seeded) this._seed(view);
    const mul = 0.35 + this.wind.strength;
    const margin = c.margin ?? 40;
    const out = (p) => p.x < view.x - margin || p.x > view.x + view.w + margin || p.y < view.y - margin || p.y > view.y + view.h + margin;

    for (const p of this.streaks) {
      p.x += this.wind.x * p.speed * mul * dt;
      p.y += this.wind.y * p.speed * mul * dt;
      if (out(p)) this._respawn(p, view, margin);
    }
    for (const p of this.wisps) {
      p.x += this.wind.x * p.speed * mul * dt;
      p.y += this.wind.y * p.speed * mul * dt;
      if (out(p)) this._respawn(p, view, margin + p.length);
    }
    for (const p of this.hazes) {
      p.x += this.wind.x * p.speed * mul * dt;
      p.y += this.wind.y * p.speed * mul * dt;
      if (out(p)) this._respawn(p, view, margin + p.img.width / 2);
    }
  }

  /** Prima volta: oggetti sparsi su tutta la visuale. */
  _seed(view) {
    const c = this.cfg;
    const any = (extra) => ({ x: view.x + Math.random() * view.w, y: view.y + Math.random() * view.h, ...extra });
    const s = c.streaks;
    if (s) {
      for (let i = 0; i < (s.count ?? 60); i++) {
        this.streaks.push(any({
          speed: rand(s.speed, 100),
          length: rand(s.length, 3),
          alpha: rand(s.alpha, 0.4),
          color: s.colors ? s.colors[i % s.colors.length] : s.color || '#e8d3a0',
        }));
      }
    }
    const wi = c.wisps;
    if (wi) {
      for (let i = 0; i < (wi.count ?? 8); i++) {
        this.wisps.push(any({ speed: rand(wi.speed, 35), length: Math.round(rand(wi.length, 30)), phase: Math.random() * 10, wave: rand(wi.wave, 3) }));
      }
    }
    const hz = c.haze;
    if (hz) {
      for (let k = 0; k < 3; k++) this._hazeImgs.push(hazeCanvas(Math.round(rand(hz.size, 100)), hz.color || '#d9b77a', k + 1));
      for (let i = 0; i < (hz.count ?? 3); i++) {
        this.hazes.push(any({ speed: rand(hz.speed, 12), img: this._hazeImgs[i % this._hazeImgs.length] }));
      }
    }
    this._seeded = true;
  }

  /** Rientro dal lato controvento della visuale (posizione casuale lungo quel lato). */
  _respawn(p, view, margin) {
    const wx = this.wind.x;
    const wy = this.wind.y;
    // lato da cui entra: scelto in proporzione alla componente del vento su ciascun asse
    if (Math.random() < Math.abs(wx) / (Math.abs(wx) + Math.abs(wy) || 1)) {
      p.x = wx > 0 ? view.x - margin + 1 : view.x + view.w + margin - 1;
      p.y = view.y - margin + Math.random() * (view.h + margin * 2);
    } else {
      p.y = wy > 0 ? view.y - margin + 1 : view.y + view.h + margin - 1;
      p.x = view.x - margin + Math.random() * (view.w + margin * 2);
    }
  }

  /** Lingue di sabbia rasoterra (sotto soldati e oggetti). */
  drawGround(ctx) {
    const wi = this.cfg?.wisps;
    if (!wi) return;
    const { x: wx, y: wy, strength } = this.wind;
    const px = -wy; // perpendicolare
    const py = wx;
    ctx.save();
    ctx.fillStyle = wi.color || '#e8d3a0';
    const base = (wi.alpha ?? 0.2) * Math.min(1.4, 0.4 + strength);
    for (const p of this.wisps) {
      const L = p.length;
      for (let k = 0; k < L; k++) {
        const off = Math.sin(k * 0.18 + this.time * 2.2 + p.phase) * p.wave;
        const x = Math.round(p.x - wx * k + px * off);
        const y = Math.round(p.y - wy * k + py * off);
        ctx.globalAlpha = base * Math.sin((Math.PI * k) / L);
        ctx.fillRect(x, y, 1, 1);
      }
    }
    ctx.restore();
  }

  /** Granelli in aria e velature di polvere (sopra a tutto, coordinate mondo). */
  drawAir(ctx) {
    const c = this.cfg;
    if (!c) return;
    const { x: wx, y: wy, strength } = this.wind;
    ctx.save();
    const hz = c.haze;
    if (hz) {
      ctx.globalAlpha = (hz.alpha ?? 0.08) * Math.min(1.5, 0.5 + strength);
      for (const p of this.hazes) ctx.drawImage(p.img, Math.round(p.x - p.img.width / 2), Math.round(p.y - p.img.height / 2));
    }
    const k = 0.5 + strength;
    for (const p of this.streaks) {
      ctx.globalAlpha = p.alpha * Math.min(1, 0.3 + strength);
      ctx.fillStyle = p.color;
      const n = Math.max(1, Math.round(p.length * k));
      for (let i = 0; i < n; i++) ctx.fillRect(Math.round(p.x - wx * i), Math.round(p.y - wy * i), 1, 1);
    }
    ctx.restore();
  }

  /** Velo di colore su tutta la visuale (ctx non traslato). */
  drawTint(ctx, w, h) {
    const t = this.cfg?.tint;
    if (!t) return;
    ctx.save();
    ctx.globalAlpha = (t.alpha ?? 0.05) + (t.gustAlpha ?? 0) * this._gustLevel();
    ctx.fillStyle = t.color || '#f0c070';
    ctx.fillRect(0, 0, w, h);
    ctx.restore();
  }
}
