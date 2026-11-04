// Granate lanciate dal giocatore: volano con una quota z simulata (gravità), rimbalzano sui tile
// solidi e un po' sul pavimento, rotolano fino a fermarsi ed esplodono allo scadere della spoletta.
// I tipi sono in config/weapons.json -> "grenades" ("grenadeDefaults" + voce); l'effetto visivo
// dell'esplosione è in config/effects.json -> "explosions".

import { LocalizedError } from '../engine/errors.js';
import { drawSprite } from '../engine/assets.js';

const DEG = Math.PI / 180;

function range(v, def = 0) {
  if (v === undefined) return def;
  if (Array.isArray(v)) return v[0] + Math.random() * (v[1] - v[0]);
  return v;
}

/** Catalogo dei tipi di granata (immutabili). */
export class GrenadeTypes {
  constructor(cfg = {}) {
    const defaults = cfg.grenadeDefaults || {};
    this.defs = new Map();
    for (const [id, def] of Object.entries(cfg.grenades || {})) {
      this.defs.set(id, Object.freeze({ ...defaults, ...def, id }));
    }
  }

  get(id) {
    const g = this.defs.get(id);
    if (!g) throw new LocalizedError('errors.unknownGrenade', { name: id }, `Grenade not defined in weapons.json: "${id}"`);
    return g;
  }
}

export class Grenades {
  constructor(assets, audio) {
    this.assets = assets;
    this.audio = audio;
    this.list = [];
  }

  clear() {
    this.list.length = 0;
  }

  /** Tempo di volo fino al primo contatto col suolo partendo da quota h con velocità verticale vz. */
  static flightTime(def) {
    const g = def.gravity ?? 300;
    const vz = def.lift ?? 70;
    const h = def.height ?? 8;
    return (vz + Math.sqrt(vz * vz + 2 * g * h)) / g;
  }

  /**
   * Lancia una granata "def" da (x, y) verso "angle" in modo che tocchi terra la prima volta
   * a "dist" px; (vx, vy) = velocità del lanciatore (ereditata in parte, inherit).
   */
  spawn(def, x, y, angle, dist, vx = 0, vy = 0) {
    const sp = dist / Grenades.flightTime(def);
    const inherit = def.inherit ?? 0.4;
    const sprite = this.assets.sprite(def.sprite);
    this.list.push({
      def,
      sprite,
      x,
      y,
      z: def.height ?? 8,
      vx: Math.cos(angle) * sp + vx * inherit,
      vy: Math.sin(angle) * sp + vy * inherit,
      vz: def.lift ?? 70,
      rot: angle,
      spin: range(def.spinDeg, 720) * DEG * (Math.random() < 0.5 ? -1 : 1),
      fuse: range(def.fuse, 2),
      time: 0,
    });
    if (def.throwSound) this.audio.play(def.throwSound);
  }

  /** onExplode(granata) viene chiamato quando scade la spoletta (la granata viene rimossa). */
  update(dt, map, onExplode) {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const g = this.list[i];
      const d = g.def;
      g.time += dt;
      g.fuse -= dt;
      if (g.fuse <= 0) {
        this.list.splice(i, 1);
        onExplode(g);
        continue;
      }

      if (g.z > 0 || g.vz > 0) {
        // in aria: gravità; toccando terra rimbalza perdendo velocità (verticale e orizzontale)
        g.vz -= (d.gravity ?? 300) * dt;
        g.z += g.vz * dt;
        if (g.z <= 0) {
          g.z = 0;
          const impact = -g.vz;
          const f = d.friction ?? 0.5;
          g.vx *= f;
          g.vy *= f;
          g.spin *= f;
          const up = impact * (d.bounce ?? 0.35);
          g.vz = up > (d.minBounce ?? 20) ? up : 0;
          if (d.bounceSound && impact >= (d.bounceSoundMin ?? 25)) this.audio.play(d.bounceSound);
        }
      } else {
        // a terra: rotola e rallenta fino a fermarsi
        const k = Math.exp(-(d.groundDrag ?? 5) * dt);
        g.vx *= k;
        g.vy *= k;
        g.spin *= k;
        if (Math.hypot(g.vx, g.vy) < 1) {
          g.vx = 0;
          g.vy = 0;
          g.spin = 0;
        }
      }

      // spostamento asse per asse con rimbalzo sui tile solidi (r = raggio di collisione)
      const r = d.radius ?? 2;
      const wb = d.wallBounce ?? 0.6;
      let bounced = 0;
      const nx = g.x + g.vx * dt;
      if (g.vx !== 0 && map.isSolidAt(nx + Math.sign(g.vx) * r, g.y)) {
        bounced = Math.abs(g.vx);
        g.vx = -g.vx * wb;
        g.spin = -g.spin;
      } else g.x = nx;
      const ny = g.y + g.vy * dt;
      if (g.vy !== 0 && map.isSolidAt(g.x, ny + Math.sign(g.vy) * r)) {
        bounced = Math.max(bounced, Math.abs(g.vy));
        g.vy = -g.vy * wb;
        g.spin = -g.spin;
      } else g.y = ny;
      if (bounced && d.bounceSound && bounced >= (d.bounceSoundMin ?? 25)) this.audio.play(d.bounceSound);
      g.rot += g.spin * dt;
    }
  }

  /** airborne = false: granate a terra (sotto i personaggi); true: in volo (sopra), con ombra. */
  draw(ctx, airborne) {
    for (const g of this.list) {
      if ((g.z > 0) !== airborne) continue;
      const d = g.def;
      if (airborne && d.shadow) {
        ctx.fillStyle = d.shadow;
        ctx.fillRect(Math.round(g.x) - 1, Math.round(g.y), 3, 1);
      }
      drawSprite(ctx, g.sprite, 0, g.x, g.y - g.z, g.rot);
      // spia lampeggiante, sempre più veloce verso lo scoppio
      if (d.blinkColor) {
        const rate = g.fuse < 0.7 ? 12 : 4;
        if (Math.floor(g.time * rate) % 2 === 0) {
          ctx.fillStyle = d.blinkColor;
          ctx.fillRect(Math.round(g.x), Math.round(g.y - g.z), 1, 1);
        }
      }
    }
  }
}
