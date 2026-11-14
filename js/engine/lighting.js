// Luce unica della mappa applicata ai soldati: ombra portata e luce sul bordo (rim light).
// La direzione viene dall'ombra dei tile del tileset (tileset.shadow = { dx, dy, color, alpha }), così soldati e
// muri proiettano l'ombra dalla stessa parte. Gli sprite ruotano liberamente: la luce non può essere "cotta"
// nello sprite, quindi si calcola a ogni disegno con le sagome dei frame ruotati (rotsprite.js, in cache).

import { drawRotated, rotated } from './rotsprite.js';

let rimIds = 0; // numero dei frame ruotati (rotsprite) per le chiavi della cache della luce sul bordo

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
    this.poseCache = new Map(); // chiave della posa -> ombra o luce sul bordo già composta (LRU, cfg.cache)
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
   * Immagine già composta per la posa di un soldato (frame ruotati di gambe e busto + loro posizioni relative),
   * in cache LRU (cfg.cache): i soldati cambiano posa di rado rispetto ai fotogrammi, quindi di solito costa un
   * solo drawImage. kind = tipo di composizione (entra nella chiave), build(g, at) la disegna sulla tela 48x48
   * col soldato al centro (at(dx, dy) = posizione di una parte). Restituisce { canvas, x, y } (angolo in alto a
   * sinistra in coordinate del mondo, stesso arrotondamento del soldato disegnato).
   */
  _composite(kind, x, y, parts, build) {
    const size = 48;
    const rx = Math.round(x);
    const ry = Math.round(y);
    const c = size / 2;
    // posizione di ogni parte come nel disegno del soldato (round(x + dx)), relativa a round(x)
    const at = (dx = 0, dy = 0) => [Math.round(x + dx) - rx + c, Math.round(y + dy) - ry + c];
    let key = kind;
    for (const [sprite, frame, angle, dx, dy] of parts) {
      const e = rotated(sprite, frame, angle);
      e.id ??= ++rimIds;
      const [px, py] = at(dx, dy);
      key += `|${e.id},${px},${py}`;
    }
    const cache = this.poseCache;
    let S = cache.get(key);
    if (S) {
      cache.delete(key); // in fondo = usato da poco
    } else {
      // tela riusata da quella usata meno di recente quando la cache è piena
      if (cache.size >= (this.cfg.cache ?? 800)) {
        const oldest = cache.keys().next().value;
        S = cache.get(oldest);
        cache.delete(oldest);
      } else S = makeCanvas(size, size);
      const g = S.getContext('2d');
      g.imageSmoothingEnabled = false;
      g.globalCompositeOperation = 'source-over';
      g.clearRect(0, 0, size, size);
      build(g, at);
    }
    cache.set(key, S);
    return { canvas: S, x: rx - c, y: ry - c };
  }

  /**
   * Ombre portate dei soldati, sotto a tutti. parts(u) = [[sprite, frame, angle, dx, dy], ...] (gambe, busto):
   * la sagoma intera di ogni soldato (gambe e busto non si scuriscono il doppio) tinta e spostata verso l'ombra.
   */
  drawShadows(ctx, map, view, units, parts) {
    if (!this.enabled || !units.length) return;
    const sh = this.shadowOf(map);
    if (!sh.alpha || (!sh.dx && !sh.dy)) return;
    const a = ctx.globalAlpha;
    ctx.globalAlpha = a * sh.alpha;
    for (const u of units) {
      const x = u.x + sh.dx;
      const y = u.y + sh.dy;
      if (x < view.x - 32 || y < view.y - 32 || x > view.x + view.w + 32 || y > view.y + view.h + 32) continue;
      const list = parts(u);
      const p = this._composite(`s${sh.color}`, u.x, u.y, list, (g, at) => {
        for (const [sprite, frame, angle, dx, dy] of list) {
          const [px, py] = at(dx, dy);
          drawMask(g, sprite, frame, px, py, angle);
        }
        g.globalCompositeOperation = 'source-in';
        g.fillStyle = sh.color;
        g.fillRect(0, 0, g.canvas.width, g.canvas.height);
      });
      ctx.drawImage(p.canvas, p.x + sh.dx, p.y + sh.dy);
    }
    ctx.globalAlpha = a;
  }

  /**
   * Luce sul bordo di un soldato già disegnato: pixel della sagoma (gambe + busto) il cui vicino verso la luce
   * è vuoto. Va chiamata subito dopo aver disegnato il soldato.
   */
  drawRim(ctx, map, x, y, parts) {
    const rim = this.cfg.rim;
    if (!this.enabled || this.rimOff || !rim || !rim.alpha) return; // rimOff = qualità grafica bassa
    const sh = this.shadowOf(map);
    // spostamento verso l'ombra: un pixel P è illuminato se P - (dx, dy) (verso la luce) è fuori dalla sagoma
    const w = rim.width || 1;
    let ox = Math.round(sh.ux * w * 1.3);
    let oy = Math.round(sh.uy * w * 1.3);
    if (!ox && !oy) oy = 1;
    // luce già composta per la stessa posa e direzione della luce (in cache)
    const p = this._composite(`r${ox},${oy},${rim.color}`, x, y, parts, (g, at) => {
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
      g.fillRect(0, 0, g.canvas.width, g.canvas.height);
    });
    const a = ctx.globalAlpha;
    ctx.globalAlpha = a * rim.alpha;
    ctx.drawImage(p.canvas, p.x, p.y);
    ctx.globalAlpha = a;
  }
}
