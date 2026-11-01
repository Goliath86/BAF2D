import { Animator, drawSprite } from '../engine/assets.js';

export class Player {
  constructor(cfg, x, y, assets) {
    this.cfg = cfg;
    this.x = x;
    this.y = y;
    this.angle = 0;
    this.speed = cfg.speed ?? 90;
    this.hw = (cfg.hitbox?.[0] ?? 10) / 2;
    this.hh = (cfg.hitbox?.[1] ?? 10) / 2;
    this.weapon = cfg.weapon || {};
    this.cooldown = 0;
    this.sprite = assets.sprite(cfg.sprite);
    this.anim = new Animator(this.sprite, 'idle');
    this.moving = false;
  }

  update(dt, game) {
    const { input, map, camera } = game;

    // Movimento (spazio schermo: su/giù/strafe sx/dx, indipendente dalla mira)
    const move = input.getMove();
    const mag = Math.hypot(move.x, move.y);
    const p = map.moveAndCollide(this.x, this.y, this.hw, this.hh, move.x * this.speed * dt, move.y * this.speed * dt);
    this.x = p.x;
    this.y = p.y;
    this.moving = mag > 0.05;

    // Mira
    const sx = this.x - Math.round(camera.x);
    const sy = this.y - Math.round(camera.y);
    const aim = input.getAim(sx, sy);
    if (aim !== null) {
      this.angle = aim;
    } else if (this.cfg.faceMoveWhenIdle && input.mode === 'touch' && this.moving) {
      this.angle = Math.atan2(move.y, move.x);
    }

    // Fuoco
    this.cooldown = Math.max(0, this.cooldown - dt);
    if (input.isFiring() && this.cooldown <= 0) {
      this.cooldown = 1 / (this.weapon.fireRate || 8);
      game.spawnBullet(this);
    }

    // Animazione
    if (this.moving) {
      this.anim.play('walk');
      this.anim.update(dt * Math.max(0.4, mag));
    } else {
      this.anim.play('idle');
      this.anim.update(dt);
    }
  }

  get muzzle() {
    const off = this.weapon.muzzleOffset ?? 8;
    return { x: this.x + Math.cos(this.angle) * off, y: this.y + Math.sin(this.angle) * off };
  }

  draw(ctx) {
    drawSprite(ctx, this.sprite, this.anim.frame, this.x, this.y, this.angle);
  }
}
