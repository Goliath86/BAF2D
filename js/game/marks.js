// Segni di battaglia che restano per tutta la partita, su un livello grande quanto la mappa (creato al primo
// segno, svuotato a ogni partita): crateri delle esplosioni (effects.json -> explosions.<t>.crater), tracce di
// ruote e cingoli dei mezzi (vehicles.json -> <mezzo>.trail) e bossoli/caricatori/detriti fermi a terra, "cotti"
// nel livello invece di restare oggetti da disegnare (effects.json -> bakeCasings).
// Ogni segno si disegna due volte, con le stesse operazioni: nel livello dei segni e direttamente nel canvas della
// mappa, che si disegna comunque a ogni fotogramma (nessun costo per fotogramma). Quando la mappa ridisegna una
// regione (tile distrutti, crepe: TileMap.onRegion) i segni di quella regione si ricopiano dal livello.

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, w);
  c.height = Math.max(1, h);
  return c;
}

/** Contesto che ripete ogni operazione su due contesti (livello dei segni + mappa): solo quelle usate qui. */
class DualContext {
  constructor(a, b) {
    this.a = a;
    this.b = b;
  }

  set globalAlpha(v) {
    this.a.globalAlpha = v;
    this.b.globalAlpha = v;
  }

  set fillStyle(v) {
    this.a.fillStyle = v;
    this.b.fillStyle = v;
  }

  save() {
    this.a.save();
    this.b.save();
  }

  restore() {
    this.a.restore();
    this.b.restore();
  }

  translate(x, y) {
    this.a.translate(x, y);
    this.b.translate(x, y);
  }

  rotate(r) {
    this.a.rotate(r);
    this.b.rotate(r);
  }

  fillRect(...p) {
    this.a.fillRect(...p);
    this.b.fillRect(...p);
  }

  drawImage(...p) {
    this.a.drawImage(...p);
    this.b.drawImage(...p);
  }
}

export class GroundMarks {
  constructor() {
    this.map = null;
    this.canvas = null;
    this.g = null;
    this.pending = []; // tracce in coda: px, py, size, alpha, colore (flush)
    this.pendingBake = []; // sprite fermi a terra in coda: [sprite, frame, x, y, angle, alpha]
  }

  /** Nuova partita (o rivincita, dopo map.reset()): niente segni. */
  reset(map) {
    this.map = map;
    this.dual = null;
    this.pending.length = 0;
    this.pendingBake.length = 0;
    if (this.canvas && map && this.canvas.width === map.pixelWidth && this.canvas.height === map.pixelHeight) {
      this.g.clearRect(0, 0, this.canvas.width, this.canvas.height);
    } else {
      this.canvas = null; // mappa di altre dimensioni: si ricrea al primo segno
      this.g = null;
    }
    // regione della mappa ridisegnata (tile distrutti): i segni di quella regione tornano sopra
    if (map) {
      map.onRegion = (x, y, w, h, mg) => {
        if (this.canvas) mg.drawImage(this.canvas, x, y, w, h, x, y, w, h);
      };
    }
  }

  _ctx() {
    if (!this.map?.canvas) return null;
    if (!this.canvas) {
      this.canvas = makeCanvas(this.map.pixelWidth, this.map.pixelHeight);
      this.g = this.canvas.getContext('2d');
      this.g.imageSmoothingEnabled = false;
    }
    this.map.marked = true; // alla rivincita la mappa va ripulita (TileMap.reset)
    if (!this.dual) {
      const mg = this.map.canvas.getContext('2d');
      mg.imageSmoothingEnabled = false;
      this.dual = new DualContext(this.g, mg);
    }
    return this.dual;
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
    if (!this.map) return;
    const cos = Math.cos(v.angle);
    const sin = Math.sin(v.angle);
    const s = t.size ?? 1;
    // in coda: si scrivono a blocchi (flush). Modificare il canvas della mappa a ogni tick costringe il browser
    // a ricopiarlo intero (milioni di pixel) al disegno successivo
    for (const [f, side] of t.offsets || []) {
      const px = Math.round(v.x + cos * f - sin * side - s / 2);
      const py = Math.round(v.y + sin * f + cos * side - s / 2);
      if (!this.map.blocksShotAt(px, py)) this.pending.push(px, py, s, t.alpha ?? 0.1, t.color || '#000');
    }
  }

  /** Scrive i segni in coda (tracce): chiamata da Game.update ogni marks.flushInterval s. */
  flush() {
    if (!this.pending.length && !this.pendingBake.length) return;
    const g = this._ctx();
    if (g) {
      for (const b of this.pendingBake) this._bake(g, ...b);
      g.save();
      const P = this.pending;
      for (let i = 0; i < P.length; i += 5) {
        g.globalAlpha = P[i + 3];
        g.fillStyle = P[i + 4];
        g.fillRect(P[i], P[i + 1], P[i + 2], P[i + 2]);
      }
      g.restore();
    }
    this.pending.length = 0;
    this.pendingBake.length = 0;
  }

  /** Segni ancora in coda (ctx traslato sulla camera): si vedono subito, prima di essere scritti nella mappa. */
  drawPending(ctx) {
    if (!this.pending.length && !this.pendingBake.length) return;
    ctx.save();
    for (const b of this.pendingBake) this._bake(ctx, ...b);
    const P = this.pending;
    for (let i = 0; i < P.length; i += 5) {
      ctx.globalAlpha = P[i + 3];
      ctx.fillStyle = P[i + 4];
      ctx.fillRect(P[i], P[i + 1], P[i + 2], P[i + 2]);
    }
    ctx.restore();
  }

  /** Avanza il tempo: scrive la coda ogni "interval" s. */
  update(dt, interval = 0.4) {
    this.flushTimer = (this.flushTimer ?? 0) + dt;
    if (this.flushTimer >= interval) {
      this.flushTimer = 0;
      this.flush();
    }
  }

  /** Sprite fermo a terra (bossolo, caricatore, detrito) cotto nel livello. */
  bake(sprite, frame, x, y, angle, alpha = 1) {
    if (this.map) this.pendingBake.push([sprite, frame, x, y, angle, alpha]); // in coda come le tracce (flush)
  }

  _bake(g, sprite, frame, x, y, angle, alpha) {
    const sx = (frame % sprite.cols) * sprite.fw;
    const sy = Math.floor(frame / sprite.cols) * sprite.fh;
    g.save();
    g.globalAlpha = alpha;
    g.translate(Math.round(x), Math.round(y));
    if (angle) g.rotate(angle);
    g.drawImage(sprite.image, sx, sy, sprite.fw, sprite.fh, -sprite.origin[0], -sprite.origin[1], sprite.fw, sprite.fh);
    g.restore();
  }

}
