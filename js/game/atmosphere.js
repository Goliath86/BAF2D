// Atmosfera a tutto schermo (game.json -> atmosphere), applicata sul canvas di gioco dopo la scena e prima del
// mirino e dell'HUD:
// - correzione di colore (grade): lista di passaggi presa da atmosphere.grades.<livello.grade | tileset> più quelli
//   del meteo (effects.json -> weather.<t>.grade). Passaggio = { op: "fill", color, alpha, mode } (riempimento
//   con un modo di fusione: "saturation" con il grigio toglie colore, "soft-light" scalda/raffredda, "screen"
//   schiarisce le ombre, "multiply" scurisce) oppure { op: "self", mode, alpha } (la scena fusa con se stessa:
//   "soft-light"/"overlay" = più contrasto e colore);
// - vignettatura: bordi scuri a gradini retinati (stile pixel-art, in cache per dimensioni dello schermo);
// - grana (opzione del giocatore): rumore a pixel di gioco che cambia "fps" volte al secondo.
// Costo per fotogramma: qualche riempimento e drawImage grandi quanto il canvas a bassa risoluzione.

const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, w);
  c.height = Math.max(1, h);
  return c;
}

function hexToRgb(hex) {
  const n = parseInt(String(hex || '#000').replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export class Atmosphere {
  constructor(cfg = {}) {
    this.cfg = cfg || {};
    this.grade = []; // passaggi della correzione di colore attuale
    this.grain = !!this.cfg.grain?.default; // opzione del giocatore (Game.setGrain)
    this._vignette = null; // { w, h, canvas }
    this._grainImg = null;
    this._copy = null; // copia della scena per i passaggi "self"
    this._grainAt = -1;
    this._grainOff = [0, 0];
  }

  /** Correzione di colore: ops = lista di passaggi (vedi in cima). */
  setGrade(ops) {
    this.grade = (ops || []).filter((o) => o && (o.alpha ?? 1) > 0);
  }

  /** Passaggi per un livello: atmosphere.grades.<level.grade o tileset> + quelli del meteo. */
  gradeFor(level, weatherCfg) {
    const grades = this.cfg.grades || {};
    const id = level?.grade ?? level?.tileset;
    return [...(grades[id] || []), ...(weatherCfg?.grade || [])];
  }

  /** Correzione di colore sul canvas intero (ctx non traslato). */
  drawGrade(ctx, w, h) {
    if (!this.grade.length) return;
    ctx.save();
    for (const o of this.grade) {
      ctx.globalAlpha = Math.min(1, o.alpha ?? 1);
      ctx.globalCompositeOperation = o.mode || 'source-over';
      if (o.op === 'self') {
        if (!this._copy || this._copy.width !== w || this._copy.height !== h) this._copy = makeCanvas(w, h);
        const g = this._copy.getContext('2d');
        g.globalCompositeOperation = 'copy';
        g.drawImage(ctx.canvas, 0, 0, w, h, 0, 0, w, h);
        ctx.drawImage(this._copy, 0, 0);
      } else {
        ctx.fillStyle = o.color || '#808080';
        ctx.fillRect(0, 0, w, h);
      }
    }
    ctx.restore();
  }

  /** Vignettatura: buio che cresce verso i bordi, a "bands" gradini retinati. */
  drawVignette(ctx, w, h) {
    const v = this.cfg.vignette;
    if (!v || !(v.strength > 0)) return;
    if (!this._vignette || this._vignette.w !== w || this._vignette.h !== h) {
      const c = makeCanvas(w, h);
      const g = c.getContext('2d');
      const img = g.createImageData(w, h);
      const [r, gr, b] = hexToRgb(v.color);
      const bands = Math.max(1, v.bands ?? 5);
      const inner = v.inner ?? 0.55;
      const outer = Math.max(inner + 0.01, v.outer ?? 1.25);
      // distanza in coordinate normalizzate dello schermo: ellisse con la forma dello schermo, angoli più scuri
      const ky = v.vertical ?? 1; // < 1 = sopra e sotto si scuriscono meno
      for (let y = 0; y < h; y++) {
        const ny = (((y + 0.5) / h) * 2 - 1) * ky;
        for (let x = 0; x < w; x++) {
          const nx = ((x + 0.5) / w) * 2 - 1;
          const d = Math.hypot(nx, ny);
          let t = (d - inner) / (outer - inner);
          if (t <= 0) continue;
          t = Math.min(1, t);
          t = t * t * (3 - 2 * t);
          const lv = Math.min(bands, Math.floor(t * bands + BAYER[(y & 3) * 4 + (x & 3)] / 16));
          if (lv <= 0) continue;
          const i = (y * w + x) * 4;
          img.data[i] = r;
          img.data[i + 1] = gr;
          img.data[i + 2] = b;
          img.data[i + 3] = Math.round((255 * v.strength * lv) / bands);
        }
      }
      g.putImageData(img, 0, 0);
      this._vignette = { w, h, canvas: c };
    }
    ctx.drawImage(this._vignette.canvas, 0, 0);
  }

  /** Grana: tessera di rumore chiaro/scuro ripetuta con uno spostamento nuovo "fps" volte al secondo. */
  drawGrain(ctx, w, h, time) {
    const gc = this.cfg.grain;
    if (!this.grain || !gc) return;
    const size = gc.size ?? 128;
    if (!this._grainImg) {
      const c = makeCanvas(size, size);
      const g = c.getContext('2d');
      const img = g.createImageData(size, size);
      let s = 1234567;
      const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
      const density = gc.density ?? 0.45;
      for (let i = 0; i < size * size; i++) {
        if (rnd() >= density) continue;
        const light = rnd() < 0.5;
        const v = light ? 255 : 0;
        img.data[i * 4] = v;
        img.data[i * 4 + 1] = v;
        img.data[i * 4 + 2] = v;
        img.data[i * 4 + 3] = Math.round(255 * (0.4 + rnd() * 0.6));
      }
      g.putImageData(img, 0, 0);
      this._grainImg = c;
    }
    const frame = Math.floor(time * (gc.fps ?? 24));
    if (frame !== this._grainAt) {
      this._grainAt = frame;
      this._grainOff = [Math.floor(Math.random() * size), Math.floor(Math.random() * size)];
    }
    ctx.save();
    ctx.globalAlpha = gc.alpha ?? 0.06;
    ctx.globalCompositeOperation = gc.mode || 'source-over';
    const [ox, oy] = this._grainOff;
    for (let y = -oy; y < h; y += size) {
      for (let x = -ox; x < w; x += size) ctx.drawImage(this._grainImg, x, y);
    }
    ctx.restore();
  }
}
