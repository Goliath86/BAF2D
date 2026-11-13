// Luce unica della mappa applicata ai soldati: ombra portata e luce sul bordo (rim light).
// La direzione viene dall'ombra dei tile del tileset (tileset.shadow = { dx, dy, color, alpha }), così soldati e
// muri proiettano l'ombra dalla stessa parte. Gli sprite ruotano liberamente: la luce non può essere "cotta"
// nello sprite, quindi si calcola a ogni disegno con le sagome dei frame ruotati (rotsprite.js, in cache).

import { drawRotated } from './rotsprite.js';

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, w);
  c.height = Math.max(1, h);
  return c;
}

/** Sagoma nera del frame ruotato, con lo stesso arrotondamento del disegno del soldato. */
function drawMask(ctx, sprite, frame, x, y, angle) {
  drawRotated(ctx, sprite, frame, x, y, angle, true);
}

/**
 * cfg = game.json -> "lighting":
 *   shadow: { length (× dx/dy del tileset), alpha (null = quella del tileset), color (null = del tileset), fallback: { dx, dy, color, alpha } }
 *   rim: { color, alpha, width } — luce sul bordo dal lato della luce (sopra al contorno scuro)
 */
export class UnitLighting {
  constructor(cfg = {}) {
    this.cfg = cfg;
    this.enabled = cfg.enabled !== false;
    this.layer = null; // ombre di tutti i soldati della visuale (le sovrapposizioni non si scuriscono il doppio)
    this.scratch = null; // composizione della luce sul bordo di un soldato
  }

  /** Direzione e colore dell'ombra per la mappa (dal tileset, altrimenti da cfg.shadow.fallback). */
  shadowOf(map) {
    const s = this.cfg.shadow || {};
    const t = map?.tileset?.shadow || s.fallback || { dx: 2, dy: 3, color: '#000', alpha: 0.3 };
    const len = s.length ?? 1;
    return {
      dx: Math.round(t.dx * len),
      dy: Math.round(t.dy * len),
      color: s.color || t.color || '#000',
      alpha: s.alpha ?? t.alpha ?? 0.3,
      // direzione della luce = opposta all'ombra (versore)
      ux: t.dx / (Math.hypot(t.dx, t.dy) || 1),
      uy: t.dy / (Math.hypot(t.dx, t.dy) || 1),
    };
  }

  /**
   * Ombre portate di tutti i soldati. parts(u) = [[sprite, frame, angle], ...] (gambe, busto).
   * Disegnate su un livello grande quanto la visuale e poi fuse con una sola trasparenza.
   */
  drawShadows(ctx, map, view, units, parts) {
    if (!this.enabled || !units.length) return;
    const sh = this.shadowOf(map);
    if (!sh.alpha || (!sh.dx && !sh.dy)) return;
    if (!this.layer || this.layer.width !== view.w || this.layer.height !== view.h) this.layer = makeCanvas(view.w, view.h);
    const L = this.layer;
    const g = L.getContext('2d');
    g.imageSmoothingEnabled = false;
    g.globalCompositeOperation = 'source-over';
    g.clearRect(0, 0, L.width, L.height);
    let any = false;
    for (const u of units) {
      const x = u.x - view.x + sh.dx;
      const y = u.y - view.y + sh.dy;
      if (x < -32 || y < -32 || x > view.w + 32 || y > view.h + 32) continue;
      // stesso arrotondamento del soldato disegnato (round(x + dx)), poi lo spostamento intero dell'ombra
      for (const [sprite, frame, angle, dx = 0, dy = 0] of parts(u)) {
        drawMask(g, sprite, frame, Math.round(u.x + dx) - view.x + sh.dx, Math.round(u.y + dy) - view.y + sh.dy, angle);
      }
      any = true;
    }
    if (!any) return;
    g.globalCompositeOperation = 'source-in';
    g.fillStyle = sh.color;
    g.fillRect(0, 0, L.width, L.height);
    ctx.save();
    ctx.globalAlpha = sh.alpha;
    ctx.drawImage(L, view.x, view.y);
    ctx.restore();
  }

  /**
   * Luce sul bordo di un soldato già disegnato: pixel della sagoma (gambe + busto) il cui vicino verso la luce
   * è vuoto. Va chiamata subito dopo aver disegnato il soldato.
   */
  drawRim(ctx, map, x, y, parts) {
    const rim = this.cfg.rim;
    if (!this.enabled || !rim || !rim.alpha) return;
    const sh = this.shadowOf(map);
    // spostamento verso l'ombra: un pixel P è illuminato se P - (dx, dy) (verso la luce) è fuori dalla sagoma
    const w = rim.width || 1;
    let ox = Math.round(sh.ux * w * 1.3);
    let oy = Math.round(sh.uy * w * 1.3);
    if (!ox && !oy) oy = 1;
    const size = 48;
    if (!this.scratch) this.scratch = makeCanvas(size, size);
    const S = this.scratch;
    const g = S.getContext('2d');
    g.imageSmoothingEnabled = false;
    g.globalCompositeOperation = 'source-over';
    g.clearRect(0, 0, size, size);
    // stesso arrotondamento di drawSprite: la sagoma coincide col soldato disegnato
    const rx = Math.round(x);
    const ry = Math.round(y);
    const c = size / 2;
    // posizione di ogni parte come nel disegno del soldato (round(x + dx)), relativa a round(x)
    const at = (dx = 0, dy = 0) => [Math.round(x + dx) - rx + c, Math.round(y + dy) - ry + c];
    for (const [sprite, frame, angle, dx, dy] of parts) {
      const [px, py] = at(dx, dy);
      drawMask(g, sprite, frame, px, py, angle);
    }
    g.globalCompositeOperation = 'destination-out';
    for (const [sprite, frame, angle, dx, dy] of parts) {
      const [px, py] = at(dx, dy);
      drawMask(g, sprite, frame, px + ox, py + oy, angle);
    }
    g.globalCompositeOperation = 'source-in';
    g.fillStyle = rim.color || '#fff';
    g.fillRect(0, 0, size, size);
    ctx.save();
    ctx.globalAlpha = rim.alpha;
    ctx.drawImage(S, rx - c, ry - c);
    ctx.restore();
  }
}
