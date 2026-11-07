// Razzi (weapons.json -> "rockets"): proiettili lenti con scia di fumo che esplodono contro muri, soldati
// nemici, mezzi o a fine corsa (gittata fissata allo sparo come per i proiettili). Un colpo diretto su un
// mezzo fa "directDamage"; l'esplosione (Game.explode) ferisce soldati e mezzi nel raggio.
// Tipi: { sprite, speed, directDamage, damage, blastRadius, minDamageFactor, vehicleFactor, explosion,
//         shake, trail (effects.json -> trails), hitPadding }.

import { LocalizedError } from '../engine/errors.js';
import { drawSprite } from '../engine/assets.js';

const SUBSTEP = 2;

export class RocketTypes {
  constructor(cfg = {}) {
    const defaults = cfg.rocketDefaults || {};
    this.defs = new Map();
    for (const [id, def] of Object.entries(cfg.rockets || {})) this.defs.set(id, Object.freeze({ ...defaults, ...def, id }));
  }

  get(id) {
    const r = this.defs.get(id);
    if (!r) throw new LocalizedError('errors.unknownRocket', { name: id }, `Rocket not defined in weapons.json: "${id}"`);
    return r;
  }
}

export class Rockets {
  constructor(assets, effects, effectsCfg) {
    this.assets = assets;
    this.effects = effects;
    this.trails = effectsCfg?.trails || {};
    this.list = [];
  }

  clear() {
    this.list.length = 0;
  }

  /** owner = soldato che spara (merito), vehicle = mezzo da cui parte (non lo colpisce). */
  spawn(def, x, y, angle, range, team, owner, vehicle = null) {
    this.list.push({
      def,
      sprite: this.assets.sprite(def.sprite || 'rocket'),
      x,
      y,
      angle,
      dx: Math.cos(angle),
      dy: Math.sin(angle),
      range,
      team,
      owner,
      vehicle,
      fromAir: !!vehicle?.airborne, // sparato dall'elicottero in volo: passa sopra i muri
      time: 0,
      trailTimer: 0,
    });
  }

  /** onHit(rocket, x, y, vehicleHit) quando esplode. */
  update(dt, game, onHit) {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const r = this.list[i];
      r.time += dt;
      let travel = (r.def.speed ?? 220) * dt;
      let hit = null;
      while (travel > 0 && !hit) {
        const step = Math.min(travel, SUBSTEP, r.range);
        const px = r.x;
        const py = r.y;
        r.x += r.dx * step;
        r.y += r.dy * step;
        r.range -= step;
        travel -= step;
        if (!r.fromAir && game.map.blocksShotAt(r.x, r.y)) {
          hit = { x: px, y: py, vehicle: null }; // esplode davanti al muro
        } else {
          const v = game.vehicleAt(r.x, r.y, r.def.hitPadding ?? 1, r.vehicle);
          if (v && !(game.sameTeamNoFF(v.team, r.team) && v.occupied)) hit = { x: r.x, y: r.y, vehicle: v };
          else if (game.soldierAt(r.x, r.y, r.team, r.owner)) hit = { x: r.x, y: r.y, vehicle: null };
          else if (r.range <= 1e-6) hit = { x: r.x, y: r.y, vehicle: null };
        }
      }
      // scia di fumo
      const tr = this.trails[r.def.trail];
      if (tr && (r.trailTimer -= dt) <= 0) {
        r.trailTimer = tr.interval ?? 0.02;
        for (const em of tr.emitters || []) this.effects.emit(em, r.x - r.dx * 4, r.y - r.dy * 4, -r.dx, -r.dy);
      }
      if (hit) {
        this.list.splice(i, 1);
        onHit(r, hit.x, hit.y, hit.vehicle);
      }
    }
  }

  draw(ctx) {
    for (const r of this.list) drawSprite(ctx, r.sprite, Math.floor(r.time * 20) % 2, r.x, r.y, r.angle);
  }
}
