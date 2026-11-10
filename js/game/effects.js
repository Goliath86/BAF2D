// Effetti visivi: decal (buchi su terreno/muri che svaniscono), particelle (fumo, scintille, schegge)
// bossoli espulsi dalle armi, vampate di volata (muzzle flash) con fumo ed esplosioni
// (bruciatura a terra, palla di fuoco, fumo, schegge e detriti).
// Tutto definito in config/effects.json: ogni "impact" ha un decal, emettitori di particelle e un suono;
// ogni tipo in "casings" descrive sprite, espulsione, rimbalzi e suono di un bossolo.

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
    this.wind = null; // { x, y, strength } dal meteo del livello (Game), null = niente vento
    this.windDrift = cfg.windDrift ?? 18; // px/s di trasporto del fumo a vento pieno
    this.maxDecals = cfg.maxDecals ?? 120;
    this.maxParticles = cfg.maxParticles ?? 600;
    this.casingTypes = cfg.casings || {};
    this.maxCasings = cfg.maxCasings ?? 150;
    this.muzzleTypes = cfg.muzzles || {};
    this.explosionTypes = cfg.explosions || {};
    this.decals = [];
    this.particles = [];
    this.casings = [];
    this.flashes = [];
    this.blasts = []; // palle di fuoco delle esplosioni (sprite animato + alone)
  }

  /**
   * Esplosione di tipo "type" (chiave di explosions) nel punto (x, y): bruciatura a terra
   * (ritagliata sui tile solidi della mappa), palla di fuoco animata con alone di luce,
   * emettitori di particelle (fiamme, fumo, schegge) e detriti che volano e ricadono
   * (tipi di "casings", lanciati a 360°).
   */
  explosion(type, x, y, map) {
    const d = this.explosionTypes[type];
    if (!d) {
      console.warn(`Explosion type not defined in effects.json: "${type}"`);
      return;
    }
    if (d.decal) this.addDecal(d.decal, x, y, map);
    if (d.fireball || d.glow) {
      const sprite = d.fireball?.sprite ? this.assets.sprite(d.fireball.sprite) : null;
      const duration = range(d.fireball?.duration, 0.5);
      this.blasts.push({
        sprite,
        x: Math.round(x),
        y: Math.round(y),
        angle: Math.floor(Math.random() * 4) * (Math.PI / 2),
        time: 0,
        duration: Math.max(duration, d.glow?.life ?? 0),
        fireTime: duration,
        glow: d.glow || null,
      });
    }
    for (const em of d.emitters || []) this.emit(em, x, y, 0, 0);
    for (const deb of d.debris || []) {
      const n = Math.round(range(deb.count, 6));
      for (let i = 0; i < n; i++) this.casing(deb.type, x, y, Math.random() * Math.PI * 2);
    }
    if (d.sound) this.audio.play(d.sound, { x, y });
  }

  /**
   * Tile distrutto (def = effects.json -> breaks.<materiale>): emettitori a 360° (polvere, schegge), detriti
   * (tipi di "casings" lanciati attorno) e suono, al centro del tile (x, y).
   */
  breakTile(def, x, y) {
    for (const em of def.emitters || []) this.emit(em, x, y, 0, 0);
    for (const deb of def.debris || []) {
      const n = Math.round(range(deb.count, 4));
      for (let i = 0; i < n; i++) this.casing(deb.type, x, y, Math.random() * Math.PI * 2);
    }
    if (def.sound) this.audio.play(def.sound, { x, y });
  }

  /** Toglie i decal (buchi dei proiettili) che cadono nel rettangolo (x, y, w, h): es. un muro appena crollato. */
  removeDecalsIn(x, y, w, h) {
    this.decals = this.decals.filter((d) => d.x < x || d.y < y || d.x >= x + w || d.y >= y + h);
  }

  /**
   * Effetto di volata di tipo "type" (chiave di muzzles) nel punto (x, y), sparando verso "angle":
   * vampata (sprite ruotato, dura pochi centesimi di secondo) con alone di luce ed emettitori
   * di particelle (fumo, scintille) diretti lungo la canna.
   */
  muzzle(type, x, y, angle) {
    const d = this.muzzleTypes[type];
    if (!d) {
      console.warn(`Muzzle type not defined in effects.json: "${type}"`);
      return;
    }
    if (d.sprite) {
      const sprite = this.assets.sprite(d.sprite);
      this.flashes.push({
        sprite,
        frame: Math.floor(Math.random() * sprite.frameCount),
        x,
        y,
        angle,
        life: range(d.life, 0.05),
        glow: d.glow || null,
      });
    }
    const nx = Math.cos(angle);
    const ny = Math.sin(angle);
    for (const em of d.emitters || []) this.emit(em, x, y, nx, ny);
  }

  /**
   * Espelle un bossolo di tipo "type" (chiave di casings) dal punto (x, y).
   * angle = direzione della mira; (vx, vy) = velocità del tiratore (in parte ereditata).
   * Il bossolo ha una quota z simulata: vola, rimbalza a terra e sui muri, poi resta fermo e svanisce.
   */
  casing(type, x, y, angle, vx = 0, vy = 0) {
    const d = this.casingTypes[type];
    if (!d) {
      console.warn(`Casing type not defined in effects.json: "${type}"`);
      return;
    }
    const a = angle + (range(d.ejectDeg, 100) + (Math.random() - 0.5) * (d.spreadDeg ?? 30)) * DEG;
    const sp = range(d.speed, 50);
    const inherit = d.inherit ?? 0.5;
    const sprite = this.assets.sprite(d.sprite);
    this.casings.push({
      def: d,
      sprite,
      frame: Math.floor(Math.random() * sprite.frameCount),
      x,
      y,
      z: d.height ?? 4,
      vx: Math.cos(a) * sp + vx * inherit,
      vy: Math.sin(a) * sp + vy * inherit,
      vz: range(d.lift, 40),
      rot: angle,
      spin: range(d.spinDeg, 900) * DEG * (Math.random() < 0.5 ? -1 : 1),
      landed: false,
      resting: false,
      life: range(d.life, 6),
    });
    if (this.casings.length > this.maxCasings) this.casings.shift();
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
    if (def.sound) this.audio.play(def.sound, { x, y });
  }

  /**
   * Decal (buco, bruciatura...). Con d.clipSolid e la mappa, la parte che cade sui tile solidi
   * viene cancellata (es. bruciatura di un'esplosione vicino a un muro: resta solo sul pavimento).
   */
  addDecal(d, x, y, map = null) {
    const sprite = this.assets.sprite(d.sprite);
    const decal = {
      sprite,
      frame: Math.floor(Math.random() * sprite.frameCount),
      x: Math.round(x),
      y: Math.round(y),
      // rotazioni a multipli di 90° per variare senza perdere la nitidezza dei pixel
      angle: d.rotate === false ? 0 : Math.floor(Math.random() * 4) * (Math.PI / 2),
      life: d.life ?? 3,
      fade: d.fade ?? 1,
      alpha: d.alpha ?? 1,
      canvas: null, // immagine già ruotata e ritagliata (clipSolid)
      half: 0,
    };
    if (d.clipSolid && map) this._clipDecal(decal, map);
    this.decals.push(decal);
    if (this.decals.length > this.maxDecals) this.decals.shift();
  }

  _clipDecal(decal, map) {
    const sp = decal.sprite;
    const [ox, oy] = sp.origin;
    const half = Math.ceil(Math.max(ox, sp.fw - ox, oy, sp.fh - oy));
    const size = half * 2;
    const c = document.createElement('canvas');
    c.width = size;
    c.height = size;
    const g = c.getContext('2d');
    drawSprite(g, sp, decal.frame, half, half, decal.angle);
    const s = map.size;
    const left = decal.x - half;
    const top = decal.y - half;
    for (let ty = Math.floor(top / s); ty <= Math.floor((top + size - 1) / s); ty++) {
      for (let tx = Math.floor(left / s); tx <= Math.floor((left + size - 1) / s); tx++) {
        if (map.isSolidTile(tx, ty)) g.clearRect(tx * s - left, ty * s - top, s, s);
      }
    }
    decal.canvas = c;
    decal.half = half;
  }

  emit(em, x, y, nx, ny) {
    const hasNormal = nx !== 0 || ny !== 0;
    const base = hasNormal ? Math.atan2(ny, nx) : 0;
    const spread = (hasNormal ? em.spreadDeg ?? 120 : 360) * DEG;
    const count = Math.round(range(em.count, 1));
    const size = em.size || [1, 1];
    // oltre il massimo spariscono le più vecchie (tutte insieme, non una alla volta)
    const over = this.particles.length + count - this.maxParticles;
    if (over > 0) this.particles.splice(0, Math.min(over, this.particles.length));
    for (let i = 0; i < count; i++) {
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
        round: !!em.round, // disco pixelato invece del quadrato (es. fumo grosso)
        streak: em.streak ?? 0, // scia lunga velocità × streak px (es. schegge)
        collide: !!em.collide, // sparisce entrando in un tile solido
      });
    }
  }

  /** Rimuove tutti i decal, le particelle e i bossoli (es. nuova partita). */
  clear() {
    this.decals.length = 0;
    this.particles.length = 0;
    this.casings.length = 0;
    this.flashes.length = 0;
    this.blasts.length = 0;
  }

  /** map: TileMap per far rimbalzare i bossoli sui tile solidi (opzionale). */
  update(dt, map) {
    this._updateCasings(dt, map);
    for (let i = this.flashes.length - 1; i >= 0; i--) {
      this.flashes[i].life -= dt;
      if (this.flashes[i].life <= 0) this.flashes.splice(i, 1);
    }
    for (let i = this.blasts.length - 1; i >= 0; i--) {
      const b = this.blasts[i];
      b.time += dt;
      if (b.time >= b.duration) this.blasts.splice(i, 1);
    }
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
      // il vento (Weather) trasporta il fumo (particelle che salgono, "rise")
      if (p.rise && this.wind) {
        const w = this.wind;
        const f = (this.windDrift ?? 18) * (0.3 + w.strength) * dt;
        p.x += w.x * f;
        p.y += w.y * f;
      }
      p.life -= dt;
      if (p.life <= 0 || (p.collide && map?.blocksShotAt(p.x, p.y))) this.particles.splice(i, 1);
    }
  }

  _updateCasings(dt, map) {
    for (let i = this.casings.length - 1; i >= 0; i--) {
      const c = this.casings[i];
      const d = c.def;
      c.life -= dt;
      if (c.life <= 0) {
        this.casings.splice(i, 1);
        continue;
      }
      if (c.resting) continue;

      if (c.z > 0 || c.vz > 0) {
        // in aria: gravità sulla quota; toccando terra rimbalza perdendo velocità
        c.vz -= (d.gravity ?? 400) * dt;
        c.z += c.vz * dt;
        if (c.z <= 0) {
          c.z = 0;
          if (!c.landed) {
            c.landed = true;
            if (d.sound) this.audio.play(d.sound, c);
          }
          const f = d.friction ?? 0.6;
          c.vx *= f;
          c.vy *= f;
          c.spin *= f;
          const up = -c.vz * (d.bounce ?? 0.35);
          c.vz = up > (d.minBounce ?? 15) ? up : 0;
        }
      } else {
        // a terra: scivola e rallenta fino a fermarsi
        const k = Math.exp(-(d.groundDrag ?? 8) * dt);
        c.vx *= k;
        c.vy *= k;
        c.spin *= k;
        if (Math.hypot(c.vx, c.vy) < 2 && Math.abs(c.spin) < 1) c.resting = true;
      }

      // spostamento asse per asse con rimbalzo sui tile solidi
      const wb = d.wallBounce ?? 0.4;
      const nx = c.x + c.vx * dt;
      if (map?.blocksShotAt(nx, c.y)) {
        c.vx = -c.vx * wb;
        c.spin = -c.spin;
      } else c.x = nx;
      const ny = c.y + c.vy * dt;
      if (map?.blocksShotAt(c.x, ny)) {
        c.vy = -c.vy * wb;
        c.spin = -c.spin;
      } else c.y = ny;
      c.rot += c.spin * dt;
    }
  }

  /**
   * Bossoli: airborne = false -> quelli a terra (sotto i personaggi),
   * true -> quelli in volo (sopra), con un'ombra di 1 pixel sul terreno.
   */
  drawCasings(ctx, airborne) {
    for (const c of this.casings) {
      if ((c.z > 0) !== airborne) continue;
      const d = c.def;
      ctx.globalAlpha = Math.min(1, c.life / (d.fade ?? 1.5));
      if (airborne && d.shadow) {
        ctx.fillStyle = d.shadow;
        ctx.fillRect(Math.round(c.x), Math.round(c.y), 1, 1);
      }
      drawSprite(ctx, c.sprite, c.frame, c.x, c.y - c.z, c.rot);
    }
    ctx.globalAlpha = 1;
  }

  /** Vampate di volata: prima l'alone di luce (additivo), poi lo sprite della fiamma. */
  drawFlashes(ctx) {
    for (const f of this.flashes) {
      const g = f.glow;
      if (g) {
        // alone centrato poco davanti alla volata: "bands" dischi concentrici sovrapposti,
        // più luminoso al centro e sfumato a gradini verso il bordo (stile pixel-art)
        const ahead = g.offset ?? 2;
        const gx = Math.round(f.x + Math.cos(f.angle) * ahead);
        const gy = Math.round(f.y + Math.sin(f.angle) * ahead);
        const bands = Math.max(1, g.bands ?? 3);
        const radius = g.radius ?? 8;
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = (g.alpha ?? 0.25) / bands;
        ctx.fillStyle = g.color || '#ffb627';
        for (let b = 0; b < bands; b++) {
          ctx.beginPath();
          ctx.arc(gx, gy, Math.max(1, Math.round((radius * (bands - b)) / bands)), 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
      }
      drawSprite(ctx, f.sprite, f.frame, f.x, f.y, f.angle);
    }
  }

  drawDecals(ctx) {
    for (const d of this.decals) {
      ctx.globalAlpha = d.alpha * Math.min(1, d.life / d.fade);
      if (d.canvas) ctx.drawImage(d.canvas, d.x - d.half, d.y - d.half);
      else drawSprite(ctx, d.sprite, d.frame, d.x, d.y, d.angle);
    }
    ctx.globalAlpha = 1;
  }

  /**
   * Esplosioni: alone di luce additivo (si spegne in glow.life secondi) e palla di fuoco,
   * i cui frame scorrono lungo fireball.duration.
   */
  drawBlasts(ctx) {
    for (const b of this.blasts) {
      const g = b.glow;
      if (g && b.time < (g.life ?? 0.3)) {
        const k = 1 - b.time / (g.life ?? 0.3);
        const bands = Math.max(1, g.bands ?? 3);
        const radius = (g.radius ?? 30) * (0.6 + 0.4 * k);
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = ((g.alpha ?? 0.4) * k) / bands;
        ctx.fillStyle = g.color || '#ffb627';
        for (let i = 0; i < bands; i++) {
          ctx.beginPath();
          ctx.arc(b.x, b.y, Math.max(1, Math.round((radius * (bands - i)) / bands)), 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
      }
      if (b.sprite && b.time < b.fireTime) {
        const frame = Math.min(b.sprite.frameCount - 1, Math.floor((b.time / b.fireTime) * b.sprite.frameCount));
        drawSprite(ctx, b.sprite, frame, b.x, b.y, b.angle);
      }
    }
  }

  drawParticles(ctx) {
    for (const p of this.particles) {
      const t = 1 - p.life / p.maxLife;
      const s = Math.max(1, Math.round(p.size0 + (p.size1 - p.size0) * t));
      ctx.globalAlpha = p.fade ? p.alpha * (p.life / p.maxLife) : p.alpha;
      ctx.fillStyle = p.color;
      if (p.streak > 0) {
        // scia: pixel all'indietro lungo la velocità
        const vy = p.vy - p.rise;
        const sp = Math.hypot(p.vx, vy);
        const len = Math.max(1, Math.round(sp * p.streak));
        const ux = sp > 0 ? p.vx / sp : 0;
        const uy = sp > 0 ? vy / sp : 0;
        for (let k = 0; k < len; k++) ctx.fillRect(Math.round(p.x - ux * k), Math.round(p.y - uy * k), 1, 1);
      } else if (p.round && s >= 3) {
        // disco pixelato: una riga per y
        const r = s / 2;
        const cx = Math.round(p.x);
        const cy = Math.round(p.y);
        for (let y = -Math.floor(r); y < Math.ceil(r); y++) {
          const dy = y + 0.5;
          const hw = Math.round(Math.sqrt(Math.max(0, r * r - dy * dy)));
          if (hw > 0) ctx.fillRect(cx - hw, cy + y, hw * 2, 1);
        }
      } else {
        ctx.fillRect(Math.round(p.x - s / 2), Math.round(p.y - s / 2), s, s);
      }
    }
    ctx.globalAlpha = 1;
  }
}
