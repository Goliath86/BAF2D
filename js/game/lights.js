// Luci dinamiche (game.json -> lights): aloni additivi in stile pixel-art (gradini retinati, in cache per raggio e
// colore) per vampate, esplosioni, fuochi, razzi, bandiere in cattura e fari; buio ambientale (tramonto, notte)
// bucato dalle luci.
//
// Due tipi di luce:
// - lampi (flash): durano "life" secondi, si spengono (e restringono con "shrink"); creati dagli effetti;
// - luci del fotogramma (add): ridichiarate a ogni disegno da Game (razzi, fuochi, bandiere, fari...).
// Ogni luce = { x, y, radius, color, alpha (alone additivo), cut (quanto buio toglie, 0..1), bands }.

const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, w);
  c.height = Math.max(1, h);
  return c;
}

function hexToRgb(hex) {
  const n = parseInt(String(hex).replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export class Lights {
  constructor(cfg = {}) {
    this.cfg = cfg;
    this.flashes = [];
    this.frame = []; // luci del fotogramma corrente
    this.ambient = null; // { color, darkness, tint } (null = giorno)
    this.cache = new Map(); // "raggio|colore|bande" -> canvas dell'alone
    this.layer = null; // buio della visuale
    this.clock = 0; // tempo per il tremolio delle luci fisse
  }

  /** Ora del giorno: chiave di cfg.times (null/assente = giorno pieno). */
  setTime(id) {
    const t = id ? this.cfg.times?.[id] : null;
    this.time = t ? id : null;
    this.ambient = t && t.darkness > 0 ? t : null;
    this.tint = t?.tint || null;
  }

  /** È buio abbastanza da accendere fari e luce attorno al giocatore. */
  get dark() {
    return !!this.ambient && this.ambient.darkness >= (this.cfg.darkThreshold ?? 0.3);
  }

  clear() {
    this.flashes.length = 0;
    this.frame.length = 0;
  }

  /** Lampo di luce: def = { color, alpha, radius, bands, life, shrink, cut } (es. glow di effects.json). */
  flash(x, y, def) {
    if (!def) return;
    this.flashes.push({ x, y, def, time: 0, life: def.life ?? 0.06 });
    const max = this.cfg.maxFlashes ?? 64;
    if (this.flashes.length > max) this.flashes.shift();
  }

  /**
   * Luce del fotogramma (da ridichiarare a ogni disegno); k = intensità 0..1 (moltiplica alpha e cut),
   * radiusK = fattore sul raggio (es. tremolio dei fuochi).
   */
  add(x, y, def, k = 1, radiusK = 1) {
    if (!def || !(k > 0) || !Number.isFinite(radiusK) || !Number.isFinite(x) || !Number.isFinite(y)) return;
    this.frame.push({ x, y, def, k, radiusK });
  }

  update(dt) {
    this.clock += dt;
    for (let i = this.flashes.length - 1; i >= 0; i--) {
      const f = this.flashes[i];
      f.time += dt;
      if (f.time >= f.life) this.flashes.splice(i, 1);
    }
  }

  /**
   * Alone a gradini: intensità (1 - d)^falloff quantizzata in "bands" livelli, con retinatura Bayer 4x4 tra
   * un livello e l'altro (niente sfumature lisce: stile pixel-art). Bianco del colore dato, alpha = livello.
   */
  _glow(radius, color, bands) {
    const R = Math.max(1, Math.round(radius));
    const key = `${R}|${color}|${bands}`;
    let c = this.cache.get(key);
    if (c) return c;
    if (this.cache.size > 400) this.cache.clear();
    const size = R * 2 + 1;
    c = makeCanvas(size, size);
    const g = c.getContext('2d');
    const img = g.createImageData(size, size);
    const [r, gr, b] = hexToRgb(color);
    const fall = this.cfg.falloff ?? 1.3;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const d = Math.hypot(x - R, y - R) / R;
        if (d >= 1) continue;
        const v = Math.pow(1 - d, fall) * bands;
        const lv = Math.min(bands, Math.floor(v + BAYER[(y & 3) * 4 + (x & 3)] / 16));
        if (lv <= 0) continue;
        const i = (y * size + x) * 4;
        img.data[i] = r;
        img.data[i + 1] = gr;
        img.data[i + 2] = b;
        img.data[i + 3] = Math.round((255 * lv) / bands);
      }
    }
    g.putImageData(img, 0, 0);
    this.cache.set(key, c);
    return c;
  }

  /** Luci attive in questo fotogramma: { x, y, radius, color, bands, alpha, cut }. */
  _active() {
    const out = [];
    for (const f of this.flashes) {
      const d = f.def;
      const k = 1 - f.time / f.life;
      const radius = (d.radius ?? 10) * (d.shrink ? 1 - d.shrink * (1 - k) : 1);
      out.push({ x: f.x, y: f.y, radius, color: d.color, bands: d.bands ?? 4, alpha: (d.alpha ?? 0.3) * k, cut: (d.cut ?? 0.8) * k });
    }
    for (const l of this.frame) {
      const d = l.def;
      out.push({ x: l.x, y: l.y, radius: (d.radius ?? 10) * (l.radiusK ?? 1), color: d.color, bands: d.bands ?? 4, alpha: (d.alpha ?? 0.3) * l.k, cut: (d.cut ?? 0.8) * l.k });
    }
    return out;
  }

  /**
   * Disegna buio e luci sopra la scena (ctx già traslato sulla camera, view = { x, y, w, h } in px del mondo).
   * Poi svuota le luci del fotogramma.
   */
  draw(ctx, view) {
    const list = this._active();
    this.frame.length = 0;
    const amb = this.ambient;
    if (amb) {
      // buio: livello grande quanto la visuale, le luci lo bucano (destination-out), poi sopra la scena
      if (!this.layer || this.layer.width !== view.w || this.layer.height !== view.h) this.layer = makeCanvas(view.w, view.h);
      const g = this.layer.getContext('2d');
      g.globalCompositeOperation = 'source-over';
      g.globalAlpha = 1;
      g.clearRect(0, 0, view.w, view.h);
      g.fillStyle = amb.color || '#000';
      g.fillRect(0, 0, view.w, view.h);
      g.globalCompositeOperation = 'destination-out';
      for (const l of list) {
        if (l.cut <= 0) continue;
        const img = this._glow(l.radius * (amb.cutScale ?? 1.25), '#ffffff', l.bands);
        const h = (img.width - 1) / 2;
        g.globalAlpha = Math.min(1, l.cut);
        g.drawImage(img, Math.round(l.x - view.x) - h, Math.round(l.y - view.y) - h);
      }
      ctx.save();
      ctx.globalAlpha = amb.darkness;
      ctx.drawImage(this.layer, view.x, view.y);
      ctx.restore();
    }
    // aloni additivi
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const boost = amb ? 1 + (amb.glowBoost ?? 0.6) * amb.darkness : 1;
    for (const l of list) {
      if (l.alpha <= 0) continue;
      if (l.x + l.radius < view.x || l.y + l.radius < view.y || l.x - l.radius > view.x + view.w || l.y - l.radius > view.y + view.h) continue;
      const img = this._glow(l.radius, l.color || '#ffb627', l.bands);
      const h = (img.width - 1) / 2;
      ctx.globalAlpha = Math.min(1, l.alpha * boost);
      ctx.drawImage(img, Math.round(l.x) - h, Math.round(l.y) - h);
    }
    ctx.restore();
  }

  /** Tinta a tutto schermo dell'ora del giorno (es. arancio al tramonto), dopo il meteo. */
  drawTint(ctx, w, h) {
    const t = this.tint;
    if (!t || !t.alpha) return;
    ctx.save();
    ctx.globalAlpha = t.alpha;
    ctx.globalCompositeOperation = t.mode || 'source-over';
    ctx.fillStyle = t.color;
    ctx.fillRect(0, 0, w, h);
    ctx.restore();
  }
}
