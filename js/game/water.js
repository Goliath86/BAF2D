// Acqua animata (assets.json -> tilesets.<t>.water): sulle celle d'acqua visibili, a ogni fotogramma,
// riflessi che brillano e scorrono piano e increspature che ondeggiano. Stabile per cella (cellRandom), pochi
// pixel per cella. Vicino alla riva (celle con un vicino non d'acqua) resta lontano dai bordi: la fusione dei
// terreni ha già disegnato lì la sabbia o l'erba.
//
// cfg = { tiles: [nomi], glint, ripple, glints (per cella), ripples (per cella), speed, margin }

import { cellRandom } from '../engine/tilemap.js';

export class Water {
  constructor(map, cfg) {
    this.cfg = cfg || null;
    this.cells = [];
    if (!this.cfg || !map) return;
    const names = new Set(this.cfg.tiles || ['water']);
    const isWater = (x, y) => {
      const t = map.tileAt(x, y);
      return !!t && names.has(t.name);
    };
    const s = map.size;
    for (let y = 0; y < map.rows; y++) {
      for (let x = 0; x < map.cols; x++) {
        if (!isWater(x, y)) continue;
        let inner = true;
        for (let j = -1; j <= 1 && inner; j++) for (let i = -1; i <= 1; i++) if (!isWater(x + i, y + j)) inner = false;
        this.cells.push({ x: x * s, y: y * s, tx: x, ty: y, inner });
      }
    }
    this.size = s;
  }

  draw(ctx, view, time) {
    const c = this.cfg;
    if (!c || !this.cells.length) return;
    const s = this.size;
    const speed = c.speed ?? 1;
    const t = time * speed;
    for (const cell of this.cells) {
      if (cell.x + s < view.x || cell.y + s < view.y || cell.x > view.x + view.w || cell.y > view.y + view.h) continue;
      const m = cell.inner ? 0 : c.margin ?? 5; // vicino alla riva: solo al centro della cella
      const span = s - m * 2 - 2;
      if (span <= 0) continue;
      // increspature: trattini chiari che ondeggiano in orizzontale
      ctx.fillStyle = c.ripple || '#9fd0ea';
      for (let k = 0; k < (c.ripples ?? 2); k++) {
        const r1 = cellRandom(cell.tx, cell.ty, 31 + k);
        const r2 = cellRandom(cell.tx, cell.ty, 41 + k);
        const ph = r1 * Math.PI * 2;
        const a = Math.sin(t * 1.3 + ph);
        if (a < -0.2) continue; // compare e scompare
        const len = a > 0.6 ? 3 : 2;
        const x = cell.x + m + Math.floor(r2 * (span - len)) + Math.round(Math.sin(t * 0.7 + ph * 1.7) * 1.5);
        const y = cell.y + m + 1 + Math.floor(cellRandom(cell.tx, cell.ty, 51 + k) * span);
        ctx.globalAlpha = 0.35 + 0.35 * Math.max(0, a);
        ctx.fillRect(Math.max(cell.x + m, Math.min(cell.x + s - m - len, x)), y, len, 1);
      }
      // riflessi: punti chiari che brillano a turno e scorrono lentamente
      ctx.fillStyle = c.glint || '#e8f6ff';
      for (let k = 0; k < (c.glints ?? 1); k++) {
        const ph = cellRandom(cell.tx, cell.ty, 61 + k) * Math.PI * 2;
        const b = Math.sin(t * 2.1 + ph);
        if (b < 0.75) continue;
        const drift = ((t * 2 + cellRandom(cell.tx, cell.ty, 71 + k) * span) % span) | 0;
        const y = cell.y + m + 1 + Math.floor(cellRandom(cell.tx, cell.ty, 81 + k) * span);
        ctx.globalAlpha = (b - 0.75) * 4;
        ctx.fillRect(cell.x + m + drift, y, b > 0.92 ? 2 : 1, 1);
      }
    }
    ctx.globalAlpha = 1;
  }
}
