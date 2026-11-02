// Effetti visivi: decal (buchi su terreno/muri che svaniscono) e particelle (fumo, scintille, schegge).
// Tutto definito in config/effects.json: ogni "impact" ha un decal, emettitori di particelle e un suono.

import { drawSprite } from '../engine/assets.js';

const DEG = Math.PI / 180;

/** Valore numerico o intervallo [min, max] -> numero casuale nell'intervallo. */
function range(v, def = 0) {
  if (v === undefined) return def;
  if (Array.isArray(v)) return v[0] + Math.random() * (v[1] - v[0]);
  return v;
}

function pick(list, def) {
  return list && list.length ? list[Math.floor(Math.random() * list.length)] : def;
}

export class Effects {
  constructor(cfg = {}, assets, audio) {
    this.assets = assets;
    this.audio = audio;
    this.impacts = cfg.impacts || {};
    this.maxDecals = cfg.maxDecals ?? 120;
    this.maxParticles = cfg.maxParticles ?? 600;
    this.decals = [];
    this.particles = [];
  }

  /**
   * Effetto d'impatto di tipo "type" (chiave di impacts).
   * (x, y): punto del decal; (ex, ey): punto da cui partono le particelle;
   * (nx, ny): normale della superficie colpita (0,0 = nessuna, es. terreno -> emissione a 360°).
   */
  impact(type, x, y, ex = x, ey = y, nx = 0, ny = 0) {
    const def = this.impacts[type];
    if (!def) {
      console.warn(`Impact type not defined in effects.json: "${type}"`);
      return;
    }
    if (def.decal) this.addDecal(def.decal, x, y);
    for (const em of def.emitters || []) this.emit(em, ex, ey, nx, ny);
    if (def.sound) this.audio.play(def.sound);
  }

  addDecal(d, x, y) {
    const sprite = this.assets.sprite(d.sprite);
    this.decals.push({
      sprite,
      frame: Math.floor(Math.random() * sprite.frameCount),
      x: Math.round(x),
      y: Math.round(y),
      // rotazioni a multipli di 90° per variare senza perdere la nitidezza dei pixel
      angle: d.rotate === false ? 0 : Math.floor(Math.random() * 4) * (Math.PI / 2),
      life: d.life ?? 3,
      fade: d.fade ?? 1,
    });
    if (this.decals.length > this.maxDecals) this.decals.shift();
  }

  emit(em, x, y, nx, ny) {
    const hasNormal = nx !== 0 || ny !== 0;
    const base = hasNormal ? Math.atan2(ny, nx) : 0;
    const spread = (hasNormal ? em.spreadDeg ?? 120 : 360) * DEG;
    const count = Math.round(range(em.count, 1));
    const size = em.size || [1, 1];
    for (let i = 0; i < count; i++) {
      if (this.particles.length >= this.maxParticles) this.particles.shift();
      const a = base + (Math.random() - 0.5) * spread;
      const sp = range(em.speed, 20);
      const life = range(em.life, 0.3);
      this.particles.push({
        x,
        y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        rise: range(em.rise, 0),
        drag: em.drag ?? 0,
        life,
        maxLife: life,
        size0: size[0],
        size1: size[1] ?? size[0],
        color: pick(em.colors, '#ffffff'),
        alpha: em.alpha ?? 1,
        fade: em.fade !== false,
      });
    }
  }

  /** Rimuove tutti i decal e le particelle (es. nuova partita). */
  clear() {
    this.decals.length = 0;
    this.particles.length = 0;
  }

  update(dt) {
    for (let i = this.decals.length - 1; i >= 0; i--) {
      const d = this.decals[i];
      d.life -= dt;
      if (d.life <= 0) this.decals.splice(i, 1);
    }
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      const k = Math.exp(-p.drag * dt);
      p.vx *= k;
      p.vy *= k;
      p.x += p.vx * dt;
      p.y += (p.vy - p.rise) * dt;
      p.life -= dt;
      if (p.life <= 0) this.particles.splice(i, 1);
    }
  }

  drawDecals(ctx) {
    for (const d of this.decals) {
      ctx.globalAlpha = Math.min(1, d.life / d.fade);
      drawSprite(ctx, d.sprite, d.frame, d.x, d.y, d.angle);
    }
    ctx.globalAlpha = 1;
  }

  drawParticles(ctx) {
    for (const p of this.particles) {
      const t = 1 - p.life / p.maxLife;
      const s = Math.max(1, Math.round(p.size0 + (p.size1 - p.size0) * t));
      ctx.globalAlpha = p.fade ? p.alpha * (p.life / p.maxLife) : p.alpha;
      ctx.fillStyle = p.color;
      ctx.fillRect(Math.round(p.x - s / 2), Math.round(p.y - s / 2), s, s);
    }
    ctx.globalAlpha = 1;
  }
}
