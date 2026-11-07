// Oggetti decorativi della mappa (palme, cespugli, sassi...): legend del livello { "tile", "prop": "palm" },
// tipi in game.json -> props.types. Ogni oggetto sceglie variante, rotazione (a 90°) e piccolo spostamento in
// modo stabile per cella. Due strati:
// - "ground": a terra, sotto i soldati (cespugli, sassi);
// - "overhead": sopra i soldati (chiome delle palme), semitrasparenti quando il giocatore ci passa sotto.
// Le ombre (frame "variants..2*variants-1" dello sprite) sono sempre a terra. Con il vento (Weather.wind) gli
// oggetti con "sway" oscillano di pixel interi nella direzione del vento (niente rotazioni: pixel nitidi).

import { drawSprite } from '../engine/assets.js';
import { cellRandom } from '../engine/tilemap.js';

export class Props {
  constructor(cfg = {}, assets) {
    this.cfg = cfg;
    this.types = cfg.types || {};
    this.assets = assets;
    this.list = [];
    this.time = 0;
  }

  reset(map) {
    this.list = [];
    this.time = 0;
    for (const p of map.props || []) {
      const def = this.types[p.type];
      const sprite = def && this.assets.sprites.get(def.sprite);
      if (!sprite) {
        console.warn(`Level prop: unknown type or sprite "${p.type}" (game.json -> props.types)`);
        continue;
      }
      const n = def.variants ?? 1;
      const j = def.jitter ?? 0;
      this.list.push({
        def,
        sprite,
        variant: Math.min(n - 1, Math.floor(cellRandom(p.tx, p.ty, 1) * n)),
        angle: def.rotate === false ? 0 : Math.floor(cellRandom(p.tx, p.ty, 2) * 4) * (Math.PI / 2),
        x: Math.round(p.x + (cellRandom(p.tx, p.ty, 3) * 2 - 1) * j),
        y: Math.round(p.y + (cellRandom(p.tx, p.ty, 4) * 2 - 1) * j),
        phase: cellRandom(p.tx, p.ty, 5) * Math.PI * 2,
        alpha: 1, // overhead: opacità attuale (sfuma quando il giocatore è sotto)
      });
    }
    // gli overhead più in basso sopra gli altri
    this.list.sort((a, b) => a.y - b.y);
  }

  update(dt, player) {
    this.time += dt;
    for (const it of this.list) {
      const d = it.def;
      if (d.layer !== 'overhead' || !d.fadeUnder) continue;
      const under = player && !player.dead && Math.hypot(player.x - it.x, player.y - it.y) < (d.fadeRadius ?? 18);
      const target = under ? d.fadeUnder : 1;
      const k = 1 - Math.exp(-(d.fadeSpeed ?? 8) * dt);
      it.alpha += (target - it.alpha) * k;
    }
  }

  /** Spostamento (px interi) dovuto al vento: oscillazione attorno a un'inclinazione nella sua direzione. */
  _sway(it, wind) {
    const d = it.def;
    if (!d.sway || !wind) return { x: 0, y: 0 };
    const s = wind.strength;
    const amp = d.sway * (0.3 + s);
    const o = (d.lean ?? 0) * s + Math.sin(this.time * (d.swaySpeed ?? 1.5) * (0.6 + s) + it.phase) * amp;
    return { x: Math.round(wind.x * o), y: Math.round(wind.y * o) };
  }

  _visible(it, view, m = 40) {
    return it.x > view.x - m && it.x < view.x + view.w + m && it.y > view.y - m && it.y < view.y + view.h + m;
  }

  /** Strato a terra: ombre di tutti gli oggetti, poi gli oggetti "ground". view = { x, y, w, h } in px mondo. */
  drawGround(ctx, view, wind) {
    const sh = this.cfg.shadow || {};
    ctx.save();
    ctx.globalAlpha = sh.alpha ?? 0.28;
    for (const it of this.list) {
      const d = it.def;
      if (!d.shadow || !this._visible(it, view)) continue;
      const n = d.variants ?? 1;
      const o = this._sway(it, wind);
      const [dx, dy] = d.shadowOffset || sh.offset || [3, 2];
      drawSprite(ctx, it.sprite, n + it.variant, it.x + dx + o.x, it.y + dy + o.y, it.angle);
    }
    ctx.restore();
    for (const it of this.list) {
      if (it.def.layer === 'overhead' || !this._visible(it, view)) continue;
      const o = this._sway(it, wind);
      drawSprite(ctx, it.sprite, it.variant, it.x + o.x, it.y + o.y, it.angle);
    }
  }

  /** Strato sopra i soldati (chiome). */
  drawOverhead(ctx, view, wind) {
    ctx.save();
    for (const it of this.list) {
      if (it.def.layer !== 'overhead' || !this._visible(it, view)) continue;
      const o = this._sway(it, wind);
      ctx.globalAlpha = it.alpha;
      drawSprite(ctx, it.sprite, it.variant, it.x + o.x, it.y + o.y, it.angle);
    }
    ctx.restore();
  }
}
