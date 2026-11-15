// Addestramento del giocatore (config/training.json, livello config/levels/training.json): una serie di
// esercizi in ordine sul campo d'addestramento, con le istruzioni del sergente nell'HUD (testi in
// training.steps.<id> delle lingue), un segnale a terra e una freccia verso l'obiettivo, sagome da abbattere
// (procedurali: uomo e carro, colpite da proiettili, granate e razzi) e una medaglia alla fine.
//
// Tipi di esercizio (steps[].type):
//   reach   = raggiungere il punto "point" (+ "sprint": px da percorrere correndo, "vehicle": a bordo di un mezzo)
//   targets = abbattere tutte le sagome del gruppo "group" ("point" = dove mettersi, "grenades" = granate
//             garantite, "weapon" = arma restituita se persa, "time" = tempo limite: allo scadere si ricomincia)
//   reload  = ricaricare (a caricatore pieno se ne toglie metà)
//   pickup  = raccogliere l'arma "weapon" (al punto "point")
//   switch  = tornare all'arma principale
//   flag    = conquistare la bandiera "flag"
//   board / exit = salire su un mezzo / scendere
// Segni nel livello (legend): { waypoint: id } = punto, { target: gruppo } = sagoma (tipo da groups.<gruppo>.kind).

import { keyName } from '../engine/input.js';

const TAU = Math.PI * 2;

/** Sagoma su un palo, vista di lato come i pennoni delle bandiere: si abbatte e si rialza. */
class Target {
  /** cover = al riparo (groups.<g>.cover: sacchi davanti, solo le esplosioni la colpiscono). */
  constructor(group, kind, def, x, y, cover = null) {
    Object.assign(this, { group, kind, def, x, y, cover });
    this.team = null; // impostata da Training: "nemica" per il segno sul mirino
    // immune ai proiettili: la corazza del carro o i sacchi del riparo (segno arancione, impatto del materiale)
    this.bulletProof = !!def.armor || !!cover;
    this.hitKind = this.bulletProof ? 'armor' : 'hit';
    this.impact = cover ? cover.impact || 'sandbag' : def.impact || 'wood';
    this.raise(true);
  }

  /** Di nuovo in piedi con la vita piena (now = senza animazione). */
  raise(now = false) {
    this.hp = this.def.hp ?? 30;
    this.down = false;
    this.up = now ? 1 : this.up ?? 0;
    this.flash = 0;
  }

  get standing() {
    return !this.down && this.up > 0.6;
  }

  update(dt) {
    const rise = this.def.riseTime ?? 0.35;
    this.up = this.down ? Math.max(0, this.up - dt / 0.25) : Math.min(1, this.up + dt / rise);
    this.flash = Math.max(0, this.flash - dt);
  }

  /** Il punto (x, y) è sulla sagoma in piedi (rettangolo di hw, top, bottom + pad). */
  contains(x, y, pad = 1) {
    const d = this.def;
    const hw = (d.hw ?? 5) + pad;
    return x >= this.x - hw && x <= this.x + hw && y >= this.y - (d.top ?? 13) - pad && y <= this.y + (d.bottom ?? 2) + pad;
  }

  draw(ctx) {
    const c = this.def.colors || {};
    const bx = Math.round(this.x);
    const by = Math.round(this.y + (this.def.bottom ?? 2));
    // abbattuta = schiacciata verso terra (rettangoli arrotondati: pixel nitidi a ogni altezza)
    const k = Math.max(0.18, this.up);
    const white = this.flash > 0 ? c.flash || '#ffffff' : null;
    const r = (x, y, w, h, color) => {
      const y0 = Math.round(y * k);
      const y1 = Math.round((y + h) * k);
      ctx.fillStyle = white || color;
      ctx.fillRect(bx + x, by + Math.min(y0, y1), w, Math.max(1, Math.abs(y1 - y0)));
    };
    ctx.fillStyle = c.shadow || 'rgba(0,0,0,0.35)';
    ctx.fillRect(bx - (this.def.hw ?? 5), by, (this.def.hw ?? 5) * 2 + 1, 1);
    if (this.kind === 'tank') {
      // lamiera a forma di carro: cingoli, scafo, torretta e cannone verso sinistra
      r(-10, -3, 21, 3, c.dark || '#3a3e44');
      r(-9, -7, 19, 4, c.body || '#7a8088');
      r(-9, -7, 19, 1, c.light || '#a6acb4');
      r(-4, -10, 9, 3, c.body || '#7a8088');
      r(-4, -10, 9, 1, c.light || '#a6acb4');
      r(-12, -9, 8, 1, c.dark || '#3a3e44');
      r(-1, -6, 3, 2, c.mark || '#f0ead8');
      r(0, -6, 1, 2, c.red || '#c0302a');
      return;
    }
    // sagoma di compensato su un palo: testa, spalle, bersaglio sul petto
    const o = c.outline || '#3a2a18';
    r(0, -4, 1, 4, c.post || '#5a3a1e');
    r(-5, -11, 11, 8, o);
    r(-3, -14, 7, 4, o);
    r(-4, -10, 9, 6, c.board || '#c8a874');
    r(-2, -13, 5, 3, c.board || '#c8a874');
    r(-4, -5, 9, 1, c.boardDark || '#9a7a4a');
    r(-2, -9, 5, 3, c.red || '#c0302a');
    r(-1, -8, 3, 1, c.mark || '#f0ead8');
    r(0, -8, 1, 1, c.red || '#c0302a');
    if (this.cover) this._drawCover(ctx, bx, by);
  }

  /** Sacchi a terra davanti alla sagoma al riparo (non si abbattono: restano anche con la sagoma giù). */
  _drawCover(ctx, bx, by) {
    const cc = this.cover.colors || {};
    const bags = [[-8, -6], [-3, -6], [2, -6], [-6, -3], [-1, -3], [4, -3]];
    for (const [x, y] of bags) {
      ctx.fillStyle = cc.dark || '#4a3e24';
      ctx.fillRect(bx + x, by + y + 1, 6, 3);
      ctx.fillStyle = cc.bag || '#9a8a5a';
      ctx.fillRect(bx + x, by + y, 5, 3);
      ctx.fillStyle = cc.light || '#c2b07a';
      ctx.fillRect(bx + x + 1, by + y, 3, 1);
    }
  }
}

export class Training {
  /** cfg = config/training.json, level = JSON del livello, map = TileMap della partita, team = squadra del giocatore. */
  constructor(cfg, level, map, team) {
    this.cfg = cfg;
    this.team = team;
    this.steps = cfg.steps || [];
    // segni dal livello: { waypoint: id } e { target: gruppo }
    this.points = {};
    this.targets = [];
    const size = map.size;
    level.map.forEach((row, ty) => {
      [...row].forEach((ch, tx) => {
        const e = level.legend[ch];
        if (!e || typeof e !== 'object' || Array.isArray(e)) return;
        const x = (tx + 0.5) * size;
        const y = (ty + 0.5) * size;
        if (e.waypoint) this.points[e.waypoint] = { x, y };
        if (e.target) {
          const gc = cfg.groups?.[e.target] || {};
          const kind = gc.kind || 'man';
          const t = new Target(e.target, kind, cfg.targets?.[kind] || {}, x, y, gc.cover || null);
          t.team = 'training'; // qualunque squadra diversa da quella del giocatore
          this.targets.push(t);
        }
      });
    });
    for (const s of this.steps) {
      if (s.point && !this.points[s.point]) console.warn(`Training step "${s.id}": waypoint "${s.point}" not in the level`);
      if (s.group && !this.targets.some((t) => t.group === s.group)) console.warn(`Training step "${s.id}": no targets in group "${s.group}"`);
    }
    this.time = 0;
  }

  /** Dall'inizio: sagome in piedi, primo esercizio. */
  reset(game) {
    for (const t of this.targets) t.raise(true);
    this.index = 0;
    this.elapsed = 0;
    this.finished = false;
    this._enter(game);
  }

  get step() {
    return this.steps[this.index] || null;
  }

  /** Inizio dell'esercizio corrente: sagome del gruppo rialzate, tempo, granate, caricatore. */
  _enter(game) {
    const s = this.step;
    this.state = 'active'; // 'active' | 'done' (pausa con "Ben fatto!") | 'failed' (tempo scaduto)
    this.timer = 0;
    this.sprinted = 0;
    this.timeLeft = s?.time ?? null;
    this.praise = null;
    this.atPoint = false;
    if (!s) return;
    const p = game.player;
    if (s.type === 'targets') for (const t of this._group(s.group)) t.raise();
    if (s.grenades && p.grenades < s.grenades) p.addGrenades(s.grenades - p.grenades);
    // ricarica: a caricatore pieno non si può, se ne toglie metà
    if (s.type === 'reload' && !p.vehicle && p.ammo >= p.weapon.magazine) p.ammo = Math.floor(p.weapon.magazine / 2);
  }

  _group(id) {
    return this.targets.filter((t) => t.group === id);
  }

  update(dt, game) {
    this.time += dt;
    for (const t of this.targets) t.update(dt);
    if (this.finished) return;
    this.elapsed += dt;
    const s = this.step;
    if (!s) return;
    if (this.state !== 'active') {
      this.timer -= dt;
      if (this.timer > 0) return;
      if (this.state === 'done') {
        this.index++;
        if (this.index >= this.steps.length) {
          this.finished = true;
          return;
        }
      }
      this._enter(game);
      return;
    }
    const p = game.player;
    if (p.dead) return;
    if (p.sprinting) this.sprinted += Math.hypot(p.vx || 0, p.vy || 0) * dt;
    if (this._check(s, game, dt)) this._done(game);
  }

  /** L'esercizio "s" è completato? (con gli aiuti: granate, arma restituita, tempo limite). */
  _check(s, game, dt) {
    const p = game.player;
    switch (s.type) {
      case 'reach': {
        if (s.vehicle && !p.vehicle) {
          // sceso prima del tempo: si torna a "sali sul mezzo"
          const board = this.steps.findIndex((x, i) => i < this.index && x.type === 'board');
          if (board >= 0) {
            this.index = board;
            this._enter(game);
          }
          return false;
        }
        const pt = this.points[s.point];
        const at = p.vehicle || p;
        const reach = (this.cfg.marker?.reach ?? 12) * (p.vehicle ? 2 : 1);
        return !!pt && Math.hypot(at.x - pt.x, at.y - pt.y) <= reach && this.sprinted >= (s.sprint ?? 0);
      }
      case 'targets': {
        const pt = s.point ? this.points[s.point] : null;
        const at = p.vehicle || p;
        // arrivato (o quasi) al punto da cui tirare, o ha già abbattuto una sagoma: il segnale passa alle sagome
        if (!this.atPoint && (!pt || Math.hypot(at.x - pt.x, at.y - pt.y) <= (this.cfg.marker?.reach ?? 12) * 2
          || this._group(s.group).some((t) => t.down))) this.atPoint = true;
        if (s.grenades && p.grenades < 1 && !game.grenades.list.length) p.addGrenades(1);
        if (s.weapon && !p.vehicle && p.specialId !== s.weapon && p.primaryId !== s.weapon && !game.rockets.list.length) {
          p.pickUp(s.weapon); // arma persa o scarica: il sergente ne passa un'altra
          game.hud.notify(game.i18n.t('training.resupplied'), this.cfg.marker?.color);
        }
        const left = this._group(s.group).filter((t) => !t.down).length;
        if (left === 0) return true;
        if (this.timeLeft !== null) {
          this.timeLeft -= dt;
          if (this.timeLeft <= 0) this._fail(game);
        }
        return false;
      }
      case 'reload':
        return !!p.reload;
      case 'pickup':
        return p.specialId === s.weapon || p.primaryId === s.weapon;
      case 'switch':
        return !p.weapon.special;
      case 'flag': {
        const f = game.ctf.flags.find((x) => x.id === s.flag);
        return !f || f.owner === this.team;
      }
      case 'board':
        return !!p.vehicle;
      case 'exit':
        return !p.vehicle;
      default:
        console.warn(`Training step "${s.id}": unknown type "${s.type}"`);
        return true;
    }
  }

  _done(game) {
    this.state = 'done';
    this.timer = this.cfg.stepPause ?? 1.6;
    const list = game.i18n.list('training.praise');
    this.praise = list.length ? list[Math.floor(Math.random() * list.length)] : '';
    const snd = this.cfg.sounds?.step;
    if (snd) game.audio.play(snd);
  }

  _fail(game) {
    this.state = 'failed';
    this.timer = this.cfg.failPause ?? 2.2;
    const snd = this.cfg.sounds?.fail;
    if (snd) game.audio.play(snd);
  }

  // ---------- Colpi sulle sagome ----------

  /** Sagoma in piedi nel punto (x, y), o null. */
  hitTest(x, y, pad = 1) {
    for (const t of this.targets) if (t.standing && t.contains(x, y, pad)) return t;
    return null;
  }

  /**
   * Danno "n" alla sagoma t (cause = bullet | grenade | rocket): le sagome corazzate (carro) o al riparo ignorano
   * i proiettili. owner = chi ha sparato (segno sul mirino se è il giocatore). Restituisce true se l'ha abbattuta.
   */
  damage(t, n, cause, owner, game) {
    if (!t.standing) return false;
    const armored = t.bulletProof && cause === 'bullet';
    const dealt = armored ? 0 : n;
    t.hp -= dealt;
    t.flash = dealt > 0 ? 0.08 : 0;
    const killed = t.hp <= 0;
    if (killed) {
      t.down = true;
      const snd = this.cfg.sounds?.down;
      if (snd) game.audio.play(snd, t);
    }
    if (owner && owner === game.player) game._onPlayerHit(t, killed, dealt);
    return killed;
  }

  /**
   * Esplosione in (x, y): danno alle sagome in piedi entro radius che l'esplosione vede (los); su quelle
   * corazzate × vehicleFactor (come sui mezzi: granate poco, razzi molto).
   */
  blast(x, y, radius, dmg, minFactor, vehicleFactor, owner, cause, game, los) {
    for (const t of this.targets) {
      if (!t.standing) continue;
      const cy = t.y - (t.def.top ?? 13) / 2;
      const d = Math.max(0, Math.hypot(t.x - x, cy - y) - (t.def.hw ?? 5));
      if (d >= radius || !los(x, y, t.x, t.y)) continue;
      const k = t.def.armor ? vehicleFactor : 1;
      this.damage(t, dmg * (1 - (d / radius) * (1 - minFactor)) * k, cause, owner, game);
    }
  }

  // ---------- Obiettivo e disegno ----------

  /** Dove deve andare il giocatore ({ x, y, ring }) per l'esercizio corrente, o null. */
  goal(game) {
    const s = this.step;
    if (!s || this.finished || this.state !== 'active') return null;
    const p = game.player;
    const at = p.vehicle || p;
    const pt = s.point ? this.points[s.point] : null;
    if (s.type === 'reach' || s.type === 'pickup') return pt ? { ...pt, ring: true } : null;
    if (s.type === 'board') {
      let best = null;
      for (const v of game.vehicles) {
        if (v.destroyed || v.driver || (v.team && v.team !== this.team && v.occupied)) continue;
        if (!best || Math.hypot(v.x - at.x, v.y - at.y) < Math.hypot(best.x - at.x, best.y - at.y)) best = v;
      }
      return best ? { x: best.x, y: best.y, ring: false } : null;
    }
    if (s.type === 'flag') {
      const f = game.ctf.flags.find((x) => x.id === s.flag);
      return f ? { x: f.x, y: f.y, ring: false } : null;
    }
    if (s.type === 'targets') {
      // prima al punto da cui tirare (finché non ci arriva), poi verso la sagoma rimasta più vicina
      if (pt && !this.atPoint) return { ...pt, ring: true };
      let best = null;
      for (const t of this._group(s.group)) {
        if (t.down) continue;
        if (!best || Math.hypot(t.x - at.x, t.y - at.y) < Math.hypot(best.x - at.x, best.y - at.y)) best = t;
      }
      return best ? { x: best.x, y: best.y - (best.def.top ?? 13), ring: false } : null;
    }
    return null;
  }

  /** Segnale a terra sull'obiettivo (anello giallo tratteggiato che ruota) e frecce sulle sagome da abbattere. */
  drawGround(ctx, game) {
    const s = this.step;
    if (!s || this.finished || this.state !== 'active') return;
    const mc = this.cfg.marker || {};
    const color = mc.color || '#ffd36b';
    const shadow = mc.shadow || '#0b0b12';
    const g = this.goal(game);
    if (g?.ring) {
      const R = mc.radius ?? 9;
      const n = Math.round(R * 4);
      const spin = this.time * (mc.speed ?? 4) * 0.25;
      for (let i = 0; i < n; i++) {
        if (i % 4 === 3) continue; // trattini
        const a = (i / n) * TAU + spin;
        const x = Math.round(g.x + Math.cos(a) * R);
        const y = Math.round(g.y + Math.sin(a) * R * 0.75);
        ctx.fillStyle = shadow;
        ctx.fillRect(x, y + 1, 1, 1);
        ctx.fillStyle = color;
        ctx.fillRect(x, y, 1, 1);
      }
      this._chevron(ctx, g.x, g.y - (mc.radius ?? 9) - 4, color, shadow);
    }
    if (s.type === 'targets') {
      for (const t of this._group(s.group)) if (!t.down) this._chevron(ctx, t.x, t.y - (t.def.top ?? 13) - 3, color, shadow);
    } else if (g && !g.ring) {
      this._chevron(ctx, g.x, g.y - 14, color, shadow);
    }
  }

  /** Freccia verso il basso che rimbalza (x, y = punta). */
  _chevron(ctx, x, y, color, shadow) {
    const bob = Math.round(Math.sin(this.time * (this.cfg.marker?.speed ?? 4)) * 1.5);
    const px = Math.round(x);
    const py = Math.round(y) + bob;
    for (let row = 0; row < 3; row++) {
      const w = 5 - row * 2;
      ctx.fillStyle = shadow;
      ctx.fillRect(px - (w >> 1), py - 3 + row + 1, w, 1);
      ctx.fillStyle = color;
      ctx.fillRect(px - (w >> 1), py - 3 + row, w, 1);
    }
  }

  // ---------- Istruzioni (HUD) ----------

  /** Testi del riquadro dell'istruttore: { kicker, text, progress, state }. */
  hud(game) {
    const s = this.step;
    if (!s) return null;
    const { i18n, input } = game;
    const touch = input.mode === 'touch';
    const k = (action) => keyName(input.bindings[action]?.[0], i18n);
    const keys = {
      up: k('up'), down: k('down'), left: k('left'), right: k('right'), reload: k('reload'), grenade: k('grenade'),
      pickup: k('pickup'), switch: k('switchWeapon'), sprint: k('sprint'), seconds: s.time ?? 0,
    };
    const base = `training.steps.${s.id}`;
    const textKey = touch && i18n.has(`${base}.textTouch`) ? `${base}.textTouch` : `${base}.text`;
    const kicker = i18n.t('training.kicker', { n: this.index + 1, total: this.steps.length, title: i18n.t(`${base}.title`) });
    if (this.state === 'done') return { kicker, text: this.praise || i18n.t('training.good'), progress: null, state: 'done' };
    if (this.state === 'failed') return { kicker, text: i18n.t('training.failed'), progress: null, state: 'failed' };
    const parts = [];
    if (s.type === 'targets') {
      const list = this._group(s.group);
      parts.push(i18n.t('training.progress.targets', { n: list.filter((t) => t.down).length, total: list.length }));
      if (this.timeLeft !== null) {
        const sec = Math.max(0, Math.ceil(this.timeLeft));
        parts.push(i18n.t('training.progress.time', { time: `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}` }));
      }
    } else if (s.type === 'reach' && s.sprint) {
      parts.push(i18n.t('training.progress.sprint', { pct: Math.min(100, Math.round((this.sprinted / s.sprint) * 100)) }));
    } else if (s.type === 'flag') {
      const f = game.ctf.flags.find((x) => x.id === s.flag);
      const pct = f && f.claimant === this.team ? Math.round(f.progress * 100) : 0;
      parts.push(i18n.t('training.progress.flag', { pct }));
    }
    return { kicker, text: i18n.t(textKey, keys), progress: parts.join(' · ') || null, state: 'active' };
  }
}
