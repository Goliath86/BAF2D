import { Camera } from '../engine/camera.js';
import { drawSprite } from '../engine/assets.js';
import { TileMap } from '../engine/tilemap.js';
import { Player } from './player.js';
import { Effects } from './effects.js';
import { Hud } from './hud.js';

const STEP = 1 / 60; // update a timestep fisso
const BULLET_SUBSTEP = 2; // px: passo massimo del controllo collisioni dei proiettili
const WALL_DECAL_INSET = 3; // px: distanza del buco dalla faccia del muro colpita

export class Game {
  constructor({ config, assets, audio, display, input, level, effectsCfg, weapons, i18n }) {
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
    const spawn = this.map.spawns.player || { x: this.map.pixelWidth / 2, y: this.map.pixelHeight / 2 };
    this.weapons = weapons;
    this.player = new Player(config.player, spawn.x, spawn.y, assets, weapons);

    this.bullets = [];
    this.effects = new Effects(effectsCfg, assets, audio);
    this.crosshair = assets.sprites.get('crosshair') || null;
    this.hud = new Hud(config.hud, i18n, assets);

    this.camera = new Camera(config.camera);
    this.camera.snap(this.player.x, this.player.y, 0, display.width, display.height, this.map);

    this._fps = { value: 0, frames: 0, time: 0 };
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

    this.player.update(dt, this);
    this.hud.update(dt, this.player);
    this._updateBullets(dt);
    this.effects.update(dt);

    this.camera.follow(this.player.x, this.player.y, this.player.angle, display.width, display.height, this.map, dt);
    input.endFrame();
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

    const cx = Math.round(this.camera.x);
    const cy = Math.round(this.camera.y);
    ctx.save();
    ctx.translate(-cx, -cy);

    this.map.draw(ctx, cx, cy, W, H);
    this.effects.drawDecals(ctx);
    this.player.draw(ctx);
    for (const b of this.bullets) drawSprite(ctx, b.sprite, 0, b.x, b.y, b.angle);
    this.effects.drawParticles(ctx);

    ctx.restore();

    if (this.running && input.mode === 'desktop' && input.mouse.seen && this.crosshair) {
      const m = input.mouseGame;
      drawSprite(ctx, this.crosshair, 0, m.x, m.y);
    }

    // UI ad alta risoluzione
    const ui = display.uiCtx;
    ui.clearRect(0, 0, display.cssWidth, display.cssHeight);
    if (this.running && input.mode === 'touch') {
      const p = this.player;
      input.sticks.draw(ui, {
        reload: { label: String(p.ammo), progress: p.reloadProgress, alert: p.ammo === 0 && !p.reloading },
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
      `bullets ${this.bullets.length} decals ${effects.decals.length} particles ${effects.particles.length}`,
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
