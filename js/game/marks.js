// Segni di battaglia che restano per tutta la partita, su un livello grande quanto la mappa (creato al primo
// segno, svuotato a ogni partita): crateri delle esplosioni (effects.json -> explosions.<t>.crater), tracce di
// ruote e cingoli dei mezzi (vehicles.json -> <mezzo>.trail) e bossoli/caricatori/detriti fermi a terra, "cotti"
// nel livello invece di restare oggetti da disegnare (effects.json -> bakeCasings).
// Nessun costo per fotogramma oltre a un drawImage della parte visibile.

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, w);
  c.height = Math.max(1, h);
  return c;
}

export class GroundMarks {
  constructor() {
    this.map = null;
    this.canvas = null;
    this.g = null;
  }

  /** Nuova partita (o rivincita): niente segni. */
  reset(map) {
    this.map = map;
    if (this.canvas && map && this.canvas.width === map.pixelWidth && this.canvas.height === map.pixelHeight) {
      this.g.clearRect(0, 0, this.canvas.width, this.canvas.height);
    } else {
      this.canvas = null; // mappa di altre dimensioni: si ricrea al primo segno
      this.g = null;
    }
  }

  _ctx() {
    if (!this.map) return null;
    if (!this.canvas) {
      this.canvas = makeCanvas(this.map.pixelWidth, this.map.pixelHeight);
      this.g = this.canvas.getContext('2d');
      this.g.imageSmoothingEnabled = false;
    }
    return this.g;
  }

  /**
   * Cratere nel punto (x, y): fondo scuro irregolare, anello di terra smossa più chiaro, zolle sparse attorno.
   * Non sui tile che fermano i colpi (muri). def = { radius, hole, ring, rim, clods, alpha }.
   */
  crater(x, y, def) {
    const g = this._ctx();
    if (!g || !def) return;
    const R = def.radius ?? 6;
    const map = this.map;
    const seed = Math.random() * 100;
    const wob = (a) => 1 + 0.18 * Math.sin(a * 3 + seed) + 0.1 * Math.sin(a * 7 + seed * 2.3);
    const cx = Math.round(x);
    const cy = Math.round(y);
    const ext = Math.ceil(R * 1.3);
    g.save();
    g.globalAlpha = def.alpha ?? 0.85;
    for (let j = -ext; j <= ext; j++) {
      for (let i = -ext; i <= ext; i++) {
        const px = cx + i;
        const py = cy + j;
        if (map.blocksShotAt(px, py)) continue;
        const d = Math.hypot(i + 0.5, j + 0.5) / (R * wob(Math.atan2(j, i)));
        let c = null;
        if (d < 0.55) c = def.hole || '#1e1812';
        else if (d < 0.85) c = (i + j) & 1 && d > 0.7 ? def.ring || '#3a2c20' : def.hole || '#1e1812';
        else if (d < 1.05) c = def.rim || '#6a5236';
        if (!c) continue;
        g.fillStyle = c;
        g.fillRect(px, py, 1, 1);
      }
    }
    // zolle sparse
    g.fillStyle = def.rim || '#6a5236';
    const n = def.clods ?? 8;
    for (let k = 0; k < n; k++) {
      const a = Math.random() * Math.PI * 2;
      const d = R * (1.1 + Math.random() * 0.6);
      const px = Math.round(cx + Math.cos(a) * d);
      const py = Math.round(cy + Math.sin(a) * d);
      if (!map.blocksShotAt(px, py)) g.fillRect(px, py, Math.random() < 0.4 ? 2 : 1, 1);
    }
    g.restore();
  }

  /**
   * Tracce del mezzo v (vehicles.json -> trail = { offsets: [[avanti, lato]...], size, color, alpha, step }):
   * un'impronta per ruota/cingolo ogni "step" px percorsi, solo a terra e fuori dai muri.
   */
  vehicle(v) {
    const t = v.def.trail;
    if (!t || v.destroyed || v.airborne || v.def.flying) return;
    const last = v._trailAt;
    if (!last) {
      v._trailAt = { x: v.x, y: v.y };
      return;
    }
    if (Math.hypot(v.x - last.x, v.y - last.y) < (t.step ?? 2)) return;
    v._trailAt = { x: v.x, y: v.y };
    const g = this._ctx();
    if (!g) return;
    const cos = Math.cos(v.angle);
    const sin = Math.sin(v.angle);
    const s = t.size ?? 1;
    g.save();
    g.globalAlpha = t.alpha ?? 0.1;
    g.fillStyle = t.color || '#000';
    for (const [f, side] of t.offsets || []) {
      const px = Math.round(v.x + cos * f - sin * side - s / 2);
      const py = Math.round(v.y + sin * f + cos * side - s / 2);
      if (!this.map.blocksShotAt(px, py)) g.fillRect(px, py, s, s);
    }
    g.restore();
  }

  /** Sprite fermo a terra (bossolo, caricatore, detrito) cotto nel livello. */
  bake(sprite, frame, x, y, angle, alpha = 1) {
    const g = this._ctx();
    if (!g) return;
    const sx = (frame % sprite.cols) * sprite.fw;
    const sy = Math.floor(frame / sprite.cols) * sprite.fh;
    g.save();
    g.globalAlpha = alpha;
    g.translate(Math.round(x), Math.round(y));
    if (angle) g.rotate(angle);
    g.drawImage(sprite.image, sx, sy, sprite.fw, sprite.fh, -sprite.origin[0], -sprite.origin[1], sprite.fw, sprite.fh);
    g.restore();
  }

  /** Parte visibile del livello dei segni (ctx già traslato sulla camera). */
  draw(ctx, view) {
    if (!this.canvas) return;
    const x = Math.max(0, view.x);
    const y = Math.max(0, view.y);
    const w = Math.min(this.canvas.width, view.x + view.w) - x;
    const h = Math.min(this.canvas.height, view.y + view.h) - y;
    if (w > 0 && h > 0) ctx.drawImage(this.canvas, x, y, w, h, x, y, w, h);
  }
}
