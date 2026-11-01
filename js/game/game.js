import { Camera } from '../engine/camera.js';
import { drawSprite } from '../engine/assets.js';
import { TileMap } from '../engine/tilemap.js';
import { Player } from './player.js';

const STEP = 1 / 60; // update a timestep fisso

export class Game {
  constructor({ config, assets, audio, display, input, level }) {
    this.config = config;
    this.assets = assets;
    this.audio = audio;
    this.display = display;
    this.input = input;

    this.running = false;
    this.debug = !!config.debug;
    this.background = config.display?.background || '#000';

    this.map = new TileMap(level, assets.tileset(level.tileset));
    const spawn = this.map.spawns.player || { x: this.map.pixelWidth / 2, y: this.map.pixelHeight / 2 };
    this.player = new Player(config.player, spawn.x, spawn.y, assets);

    this.bullets = [];
    this.particles = [];
    this.bulletSprite = assets.sprite(config.player.weapon?.bulletSprite || 'bullet');
    this.crosshair = assets.sprites.get('crosshair') || null;

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

    this.player.update(dt, this);
    this._updateBullets(dt);
    this._updateParticles(dt);

    this.camera.follow(this.player.x, this.player.y, this.player.angle, display.width, display.height, this.map, dt);
    input.endFrame();
  }

  spawnBullet(player) {
    const w = player.weapon;
    const spread = ((w.spreadDeg || 0) * Math.PI) / 180;
    const a = player.angle + (Math.random() - 0.5) * spread;
    const speed = w.bulletSpeed || 260;
    const m = player.muzzle;
    this.bullets.push({
      x: m.x,
      y: m.y,
      vx: Math.cos(a) * speed,
      vy: Math.sin(a) * speed,
      angle: a,
      life: w.bulletLife || 1,
    });
    if (w.sound) this.audio.play(w.sound);
  }

  _updateBullets(dt) {
    const map = this.map;
    const hitSound = this.player.weapon.hitSound;
    for (let i = this.bullets.length - 1; i >= 0; i--) {
      const b = this.bullets[i];
      const px = b.x;
      const py = b.y;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.life -= dt;
      if (map.isSolidAt(b.x, b.y)) {
        this._spawnImpact(px, py);
        if (hitSound) this.audio.play(hitSound);
        this.bullets.splice(i, 1);
      } else if (b.life <= 0) {
        this.bullets.splice(i, 1);
      }
    }
  }

  _spawnImpact(x, y) {
    for (let i = 0; i < 5; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = 20 + Math.random() * 50;
      this.particles.push({
        x,
        y,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s,
        life: 0.15 + Math.random() * 0.15,
        color: i % 2 ? '#ffd36b' : '#ffffff',
      });
    }
  }

  _updateParticles(dt) {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.life -= dt;
      if (p.life <= 0) this.particles.splice(i, 1);
    }
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
    this.player.draw(ctx);
    for (const b of this.bullets) drawSprite(ctx, this.bulletSprite, 0, b.x, b.y, b.angle);
    for (const p of this.particles) {
      ctx.fillStyle = p.color;
      ctx.fillRect(Math.round(p.x), Math.round(p.y), 1, 1);
    }

    ctx.restore();

    if (this.running && input.mode === 'desktop' && input.mouse.seen && this.crosshair) {
      const m = input.mouseGame;
      drawSprite(ctx, this.crosshair, 0, m.x, m.y);
    }

    // UI ad alta risoluzione
    const ui = display.uiCtx;
    ui.clearRect(0, 0, display.cssWidth, display.cssHeight);
    if (this.running && input.mode === 'touch') input.sticks.draw(ui);
    if (this.debug) this._drawDebug(ui);
  }

  _drawDebug(ui) {
    const { display, input, player } = this;
    const mv = input.getMove();
    const lines = [
      `FPS ${this._fps.value}`,
      `mode ${input.mode}${input.isTouchDevice ? ' (touch device)' : ''}`,
      `res ${display.width}x${display.height} x${display.scale} dpr ${display.dpr}`,
      `pos ${player.x.toFixed(1)}, ${player.y.toFixed(1)}`,
      `move ${mv.x.toFixed(2)}, ${mv.y.toFixed(2)}`,
      `aim ${((player.angle * 180) / Math.PI).toFixed(0)}° fire ${input.isFiring() ? 'Y' : 'N'}`,
      `bullets ${this.bullets.length}`,
    ];
    ui.save();
    ui.font = '12px monospace';
    ui.textBaseline = 'top';
    ui.fillStyle = 'rgba(0,0,0,0.5)';
    ui.fillRect(4, 4, 250, lines.length * 14 + 8);
    ui.fillStyle = '#9f9';
    lines.forEach((l, i) => ui.fillText(l, 10, 9 + i * 14));
    ui.restore();
  }
}
