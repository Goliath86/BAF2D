import { Camera } from '../engine/camera.js';
import { drawSprite } from '../engine/assets.js';
import { TileMap } from '../engine/tilemap.js';
import { Player } from './player.js';
import { Effects } from './effects.js';
import { Hud } from './hud.js';
import { Grenades } from './grenades.js';

const STEP = 1 / 60; // update a timestep fisso
const BULLET_SUBSTEP = 2; // px: passo massimo del controllo collisioni dei proiettili
const WALL_DECAL_INSET = 3; // px: distanza del buco dalla faccia del muro colpita

export class Game {
  constructor({ config, assets, audio, display, input, level, effectsCfg, weapons, grenadeTypes, i18n }) {
    this.config = config;
    this.i18n = i18n; // per i testi di HUD/menu: this.i18n.t('chiave')
    this.assets = assets;
    this.audio = audio;
    this.display = display;
    this.input = input;

    this.running = false;
    this.debug = !!config.debug;
    this.background = config.display?.background || '#000';

    this.map = new TileMap(level, assets.tileset(level.tileset));
    this.spawn = this.map.spawns.player || { x: this.map.pixelWidth / 2, y: this.map.pixelHeight / 2 };
    this.weapons = weapons;
    this.grenadeTypes = grenadeTypes;

    this.bullets = [];
    this.grenades = new Grenades(assets, audio);
    this.shake = { time: 0, duration: 0, amount: 0 }; // scossa della camera (esplosioni)
    this.effects = new Effects(effectsCfg, assets, audio);
    this.crosshair = assets.sprites.get('crosshair') || null;
    this.camera = new Camera(config.camera);

    // Game over: callback impostati da main.js per mostrare/nascondere la schermata (DOM)
    this.gameOverCfg = config.gameOver || {};
    this.onGameOver = null;
    this.onRestart = null;

    this._fps = { value: 0, frames: 0, time: 0 };
    this._reset();
  }

  /** Stato di una nuova partita: giocatore allo spawn, niente proiettili/effetti. */
  _reset() {
    const { config, assets, weapons, display } = this;
    this.player = new Player(config.player, this.spawn.x, this.spawn.y, assets, weapons, this.grenadeTypes);
    this.hud = new Hud(config.hud, this.i18n, assets);
    this.bullets.length = 0;
    this.grenades.clear();
    this.shake.time = 0;
    this.effects.clear();
    this.over = null; // { time, shown, pool, drop } dopo la morte del giocatore
    this.camera.snap(this.player.x, this.player.y, 0, display.width, display.height, this.map);
  }

  /** Ricomincia la partita (dalla schermata di game over). */
  restart() {
    if (!this.canRestart) return;
    this._reset();
    this.onRestart?.();
  }

  get isGameOver() {
    return this.over !== null;
  }

  /** La schermata di game over è visibile da almeno restartDelay secondi. */
  get canRestart() {
    const o = this.over;
    const g = this.gameOverCfg;
    return !!o && o.shown && o.time >= (g.delay ?? 1.5) + (g.restartDelay ?? 0.8);
  }

  get paused() {
    // In portrait su touch il gioco è in pausa (overlay "ruota il dispositivo")
    return this.input.isTouchDevice && this.display.isPortrait;
  }

  start() {
    let last = performance.now();
    let acc = 0;
    const frame = (now) => {
      let dt = (now - last) / 1000;
      last = now;
      if (dt > 0.25) dt = 0.25;
      this._countFps(dt);

      if (this.running && !this.paused) {
        acc += dt;
        while (acc >= STEP) {
          this.update(STEP);
          acc -= STEP;
        }
      } else {
        acc = 0;
      }
      this.render();
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }

  _countFps(dt) {
    const f = this._fps;
    f.frames++;
    f.time += dt;
    if (f.time >= 0.5) {
      f.value = Math.round(f.frames / f.time);
      f.frames = 0;
      f.time = 0;
    }
  }

  // ---------- Update ----------

  update(dt) {
    const { input, display } = this;
    if (input.wasPressed('debug')) this.debug = !this.debug;
    if (input.wasPressed('debugNextWeapon')) this._cycleWeapon();
    if (input.wasPressed('debugHurt')) this.player.damage(this.config.debugDamage ?? 10);
    if (input.wasPressed('debugHeal')) this.player.heal(this.config.debugDamage ?? 10);
    if (input.wasPressed('debugGrenade')) this.player.addGrenades(1);

    this.player.update(dt, this);
    if (this.player.dead && !this.over) this._startGameOver();
    if (this.over) this._updateGameOver(dt);
    this.hud.update(dt, this.player);
    this._updateBullets(dt);
    this.grenades.update(dt, this.map, (g) => this.explode(g.def, g.x, g.y));
    this.effects.update(dt, this.map);
    this.shake.time = Math.max(0, this.shake.time - dt);

    this.camera.follow(this.player.x, this.player.y, this.player.angle, display.width, display.height, this.map, dt);
    input.endFrame();
  }

  // ---------- Granate ----------

  /**
   * Lancia una granata di "player" verso la mira. Desktop con mouse: tocca terra la prima volta
   * sotto il mirino (tra minRange e maxRange); touch o senza mouse: a defaultRange px.
   */
  throwGrenade(player) {
    const def = player.grenadeType;
    let dist = def.defaultRange ?? 90;
    if (this.input.mode === 'desktop' && this.input.mouse.seen) {
      const m = this.input.mouseGame;
      dist = Math.hypot(m.x + Math.round(this.camera.x) - player.x, m.y + Math.round(this.camera.y) - player.y);
    }
    dist = Math.min(def.maxRange ?? 150, Math.max(def.minRange ?? 20, dist));

    // punto di lancio: la mano ([avanti, lato]); se è dentro un muro, il centro del giocatore
    const [f, s] = def.hand || [6, -3];
    const c = Math.cos(player.angle);
    const sn = Math.sin(player.angle);
    let x = player.x + c * f - sn * s;
    let y = player.y + sn * f + c * s;
    if (this.map.isSolidAt(x, y)) {
      x = player.x;
      y = player.y;
    }
    this.grenades.spawn(def, x, y, player.angle, dist, player.vx, player.vy);
  }

  /** Esplosione della granata "def" in (x, y): effetti, scossa della camera, danni. */
  explode(def, x, y) {
    if (def.explosion) this.effects.explosion(def.explosion, x, y, this.map);
    if (def.shake) {
      this.shake.amount = def.shake.amount ?? 3;
      this.shake.duration = def.shake.time ?? 0.4;
      this.shake.time = this.shake.duration;
    }
    // danno al giocatore: decresce con la distanza fino a minDamageFactor sul bordo, i muri riparano
    const p = this.player;
    const radius = def.blastRadius ?? 40;
    const d = Math.hypot(p.x - x, p.y - y);
    if (def.hurtsPlayer !== false && d < radius && this._lineOfSight(x, y, p.x, p.y)) {
      const k = 1 - (d / radius) * (1 - (def.minDamageFactor ?? 0.2));
      p.damage(Math.round((def.damage ?? 80) * k));
    }
  }

  /** true se il segmento (x0,y0)-(x1,y1) non attraversa tile solidi (passi da 2 px). */
  _lineOfSight(x0, y0, x1, y1) {
    const n = Math.ceil(Math.hypot(x1 - x0, y1 - y0) / 2);
    for (let i = 1; i < n; i++) {
      const t = i / n;
      if (this.map.isSolidAt(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t)) return false;
    }
    return true;
  }

  // ---------- Morte e game over ----------

  _startGameOver() {
    const p = this.player;
    const g = this.gameOverCfg;
    const a = p.deathAngle;
    if (p.cfg.deathSound) this.audio.play(p.cfg.deathSound);

    // pozza sotto il corpo (si allarga in poolTime secondi)
    const poolSprite = g.poolSprite && this.assets.sprites.get(g.poolSprite);
    const back = p.cfg.deadOffset ?? 4;
    const pool = poolSprite
      ? { sprite: poolSprite, x: p.x - Math.cos(a) * back, y: p.y - Math.sin(a) * back, angle: Math.floor(Math.random() * 4) * (Math.PI / 2) }
      : null;

    // l'arma cade a terra davanti al corpo, un po' di lato
    let drop = null;
    const dropSprite = g.dropWeapon !== false && p.weapon.pickupSprite && this.assets.sprites.get(p.weapon.pickupSprite);
    if (dropSprite) {
      const dist = g.dropDistance ?? 9;
      const first = Math.random() < 0.5 ? -1 : 1;
      // prova un lato, poi l'altro, se l'arma finirebbe dentro un muro
      for (const side of [first, -first]) {
        const da = a + side * (0.5 + Math.random() * 0.6);
        const x = p.x + Math.cos(da) * dist;
        const y = p.y + Math.sin(da) * dist;
        if (this.map.isSolidAt(x, y)) continue;
        drop = { sprite: dropSprite, x, y, angle: a + side * (0.8 + Math.random()) };
        break;
      }
    }

    this.over = { time: 0, shown: false, pool, drop };
  }

  _updateGameOver(dt) {
    const o = this.over;
    o.time += dt;
    if (!o.shown && o.time >= (this.gameOverCfg.delay ?? 1.5)) {
      o.shown = true;
      this.onGameOver?.();
    }
    if (this.canRestart && this.input.wasPressed('confirm')) this.restart();
  }

  _drawDeathProps(ctx) {
    const o = this.over;
    if (!o) return;
    if (o.pool) {
      // frame della pozza in base al tempo: si allarga fino all'ultimo frame
      const k = Math.min(1, o.time / (this.gameOverCfg.poolTime ?? 2.5));
      const frame = Math.min(o.pool.sprite.frameCount - 1, Math.floor(k * o.pool.sprite.frameCount));
      drawSprite(ctx, o.pool.sprite, frame, o.pool.x, o.pool.y, o.pool.angle);
    }
    if (o.drop) drawSprite(ctx, o.drop.sprite, 0, o.drop.x, o.drop.y, o.drop.angle);
  }

  // ---------- Proiettili ----------
  // Ogni proiettile ha una gittata ("range") fissata al momento dello sparo:
  // - desktop con mouse: distanza dal mouse (con imprecisione) -> impatto sul terreno sotto il mirino;
  // - touch (o senza mouse): fino al bordo dello schermo visibile al momento dello sparo.
  // Se prima incontra un tile solido, impatto sul muro.

  /** Un colpo dell'arma impugnata: un suono e "pellets" proiettili (>1 = fucile a pompa). */
  fire(player) {
    const w = player.weapon;
    if (w.sound) this.audio.play(w.sound);
    // vampata e fumo alla volata (non se la canna è dentro un muro)
    const m = player.muzzle;
    if (w.muzzleFlash && !this.map.isSolidAt(m.x, m.y)) this.effects.muzzle(w.muzzleFlash, m.x, m.y, player.angle);
    const n = Math.max(1, Math.round(w.pellets || 1));
    for (let i = 0; i < n; i++) this._spawnBullet(player, w);
  }

  _spawnBullet(player, w) {
    const spread = ((w.spreadDeg || 0) * Math.PI) / 180;
    const a = player.angle + (Math.random() - 0.5) * spread;
    const dx = Math.cos(a);
    const dy = Math.sin(a);
    const m = player.muzzle;
    const minRange = w.minRange ?? 4;

    let range;
    if (this.input.mode === 'desktop' && this.input.mouse.seen) {
      const mouse = this.input.mouseGame;
      const tx = mouse.x + Math.round(this.camera.x);
      const ty = mouse.y + Math.round(this.camera.y);
      const dist = Math.hypot(tx - player.x, ty - player.y) - (w.muzzleOffset ?? 8);
      const jitter = 1 + (Math.random() * 2 - 1) * (w.rangeJitter || 0);
      range = dist * jitter;
    } else {
      range = this._rangeToScreenEdge(m.x, m.y, dx, dy, w.screenMargin ?? 3);
    }
    range = Math.min(w.maxRange ?? 600, Math.max(minRange, range, 0.5));

    // Canna dentro un muro (giocatore attaccato alla parete): impatto immediato
    if (this.map.isSolidAt(m.x, m.y)) {
      const n = Math.abs(dx) > Math.abs(dy) ? { x: -Math.sign(dx), y: 0 } : { x: 0, y: -Math.sign(dy) };
      this._wallImpact(m.x, m.y, player.x, player.y, n.x, n.y);
      return;
    }

    const sprite = this.assets.sprite(w.bulletSprite || 'bullet');
    // damage: danno del singolo proiettile/pallino (verrà applicato ai bersagli colpiti)
    this.bullets.push({ x: m.x, y: m.y, dx, dy, angle: a, speed: w.bulletSpeed || 300, range, sprite, damage: w.damage ?? 0 });
  }

  /** Debug: passa all'arma successiva del catalogo. */
  _cycleWeapon() {
    const ids = this.weapons.ids;
    const i = ids.indexOf(this.player.weapon.id);
    this.player.equip(ids[(i + 1) % ids.length]);
  }

  /** Distanza lungo (dx,dy) da (x,y) al bordo dell'area visibile (meno un margine). */
  _rangeToScreenEdge(x, y, dx, dy, margin) {
    const left = Math.round(this.camera.x) + margin;
    const top = Math.round(this.camera.y) + margin;
    const right = left + this.display.width - margin * 2;
    const bottom = top + this.display.height - margin * 2;
    let t = Infinity;
    if (dx > 0) t = Math.min(t, (right - x) / dx);
    else if (dx < 0) t = Math.min(t, (left - x) / dx);
    if (dy > 0) t = Math.min(t, (bottom - y) / dy);
    else if (dy < 0) t = Math.min(t, (top - y) / dy);
    return Math.max(0, t);
  }

  _updateBullets(dt) {
    const map = this.map;
    for (let i = this.bullets.length - 1; i >= 0; i--) {
      const b = this.bullets[i];
      let travel = b.speed * dt;
      let done = false;
      while (travel > 0 && !done) {
        const step = Math.min(travel, BULLET_SUBSTEP, b.range);
        const px = b.x;
        const py = b.y;
        b.x += b.dx * step;
        b.y += b.dy * step;
        b.range -= step;
        travel -= step;

        if (map.isSolidAt(b.x, b.y)) {
          const n = this._surfaceNormal(px, py, b.x, b.y, b.dx, b.dy);
          this._wallImpact(b.x, b.y, px, py, n.x, n.y);
          done = true;
        } else if (b.range <= 1e-6) {
          this._groundImpact(b.x, b.y);
          done = true;
        }
      }
      if (done) this.bullets.splice(i, 1);
    }
  }

  /** Normale della faccia del tile solido attraversata passando da (px,py) a (x,y). */
  _surfaceNormal(px, py, x, y, dx, dy) {
    const s = this.map.size;
    const ptx = Math.floor(px / s);
    const pty = Math.floor(py / s);
    const tx = Math.floor(x / s);
    const ty = Math.floor(y / s);
    if (tx !== ptx && this.map.isSolidTile(tx, pty)) return { x: -Math.sign(dx), y: 0 };
    if (ty !== pty) return { x: 0, y: -Math.sign(dy) };
    return { x: -Math.sign(dx), y: 0 };
  }

  /** (x,y) = punto dentro il tile solido (buco); (ex,ey) = punto fuori, da cui partono le particelle. */
  _wallImpact(x, y, ex, ey, nx, ny) {
    const s = this.map.size;
    const tx = Math.floor(x / s);
    const ty = Math.floor(y / s);
    const tile = this.map.tileAt(tx, ty);
    // Il buco va un po' dentro la faccia colpita, così non sborda sul pavimento
    const inset = WALL_DECAL_INSET;
    if (nx < 0) x = tx * s + inset;
    else if (nx > 0) x = (tx + 1) * s - inset;
    if (ny < 0) y = ty * s + inset;
    else if (ny > 0) y = (ty + 1) * s - inset;
    this.effects.impact(tile?.impact || 'wall', x, y, ex, ey, nx, ny);
  }

  _groundImpact(x, y) {
    const tile = this.map.tileAt(Math.floor(x / this.map.size), Math.floor(y / this.map.size));
    this.effects.impact(tile?.impact || 'ground', x, y);
  }

  // ---------- Render ----------

  render() {
    const { display, input } = this;
    const ctx = display.ctx;
    const W = display.width;
    const H = display.height;

    ctx.fillStyle = this.background;
    ctx.fillRect(0, 0, W, H);

    // scossa della camera: spostamento casuale di pixel interi, si attenua fino a zero
    let sx = 0;
    let sy = 0;
    const sh = this.shake;
    if (sh.time > 0 && this.running) {
      const a = sh.amount * (sh.time / sh.duration);
      sx = Math.round((Math.random() * 2 - 1) * a);
      sy = Math.round((Math.random() * 2 - 1) * a);
    }
    const cx = Math.round(this.camera.x) + sx;
    const cy = Math.round(this.camera.y) + sy;
    ctx.save();
    ctx.translate(-cx, -cy);

    this.map.draw(ctx, cx, cy, W, H);
    this.effects.drawDecals(ctx);
    this.effects.drawCasings(ctx, false); // bossoli a terra
    this.grenades.draw(ctx, false); // granate a terra
    this._drawDeathProps(ctx);
    this.player.draw(ctx);
    this.effects.drawCasings(ctx, true); // bossoli in volo
    this.grenades.draw(ctx, true); // granate in volo
    for (const b of this.bullets) drawSprite(ctx, b.sprite, 0, b.x, b.y, b.angle);
    this.effects.drawFlashes(ctx);
    this.effects.drawParticles(ctx);
    this.effects.drawBlasts(ctx); // sopra il fumo, altrimenti ne coprirebbe il nucleo

    ctx.restore();

    if (this.running && !this.over && input.mode === 'desktop' && input.mouse.seen && this.crosshair) {
      const m = input.mouseGame;
      drawSprite(ctx, this.crosshair, 0, m.x, m.y);
    }

    // UI ad alta risoluzione
    const ui = display.uiCtx;
    ui.clearRect(0, 0, display.cssWidth, display.cssHeight);
    if (this.running && !this.over && input.mode === 'touch') {
      const p = this.player;
      input.sticks.draw(ui, {
        reload: { label: String(p.ammo), progress: p.reloadProgress, alert: p.ammo === 0 && !p.reloading },
        grenade: { badge: String(p.grenades), disabled: p.grenades <= 0 },
      });
    }
    if (this.running) this.hud.draw(ui, display, this.player);
    if (this.debug) this._drawDebug(ui);
  }

  _drawDebug(ui) {
    const { display, input, player, effects } = this;
    const mv = input.getMove();
    const lines = [
      `FPS ${this._fps.value}`,
      `mode ${input.mode}${input.isTouchDevice ? ' (touch device)' : ''}`,
      `res ${display.width}x${display.height} x${display.scale} dpr ${display.dpr}`,
      `pos ${player.x.toFixed(1)}, ${player.y.toFixed(1)}`,
      `move ${mv.x.toFixed(2)}, ${mv.y.toFixed(2)}`,
      `aim ${((player.angle * 180) / Math.PI).toFixed(0)}° fire ${input.isFiring() ? 'Y' : 'N'}`,
      `weapon ${player.weapon.id} (F4: next) dmg ${player.weapon.damage}`,
      `ammo ${player.ammo}/${player.weapon.magazine}${player.reloading ? ` reloading ${Math.round(player.reloadProgress * 100)}%` : ''}`,
      `health ${player.health}/${player.maxHealth} (F5: hurt, F6: heal)`,
      `grenades ${player.grenades} (G: throw, F7: +1) live ${this.grenades.list.length} blasts ${effects.blasts.length}`,
      `bullets ${this.bullets.length} decals ${effects.decals.length} particles ${effects.particles.length} casings ${effects.casings.length} flashes ${effects.flashes.length}`,
    ];
    const top = Math.round(this.hud.topHeight(display)); // sotto l'HUD
    ui.save();
    ui.font = '12px monospace';
    ui.textBaseline = 'top';
    ui.textAlign = 'left';
    ui.fillStyle = 'rgba(0,0,0,0.5)';
    ui.fillRect(4, top, 300, lines.length * 14 + 8);
    ui.fillStyle = '#9f9';
    lines.forEach((l, i) => ui.fillText(l, 10, top + 5 + i * 14));
    ui.restore();
  }
}
