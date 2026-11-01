import { Animator, drawSprite } from '../engine/assets.js';

const DEG = Math.PI / 180;

/** Differenza angolare normalizzata in (-PI, PI]. */
function angleDiff(a, b) {
  let d = (a - b) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d <= -Math.PI) d += Math.PI * 2;
  return d;
}

export class Player {
  constructor(cfg, x, y, assets) {
    this.cfg = cfg;
    this.x = x;
    this.y = y;
    this.angle = 0; // mira (busto)
    this.speed = cfg.speed ?? 90;
    this.hw = (cfg.hitbox?.[0] ?? 10) / 2;
    this.hh = (cfg.hitbox?.[1] ?? 10) / 2;
    this.weapon = cfg.weapon || {};
    this.cooldown = 0;
    this.moving = false;

    this.sprite = assets.sprite(cfg.sprite);
    this.anim = new Animator(this.sprite, 'idle');

    // Gambe opzionali su livello separato: ruotano verso la direzione di marcia
    this.legs = cfg.legsSprite ? assets.sprite(cfg.legsSprite) : null;
    this.legsAnim = this.legs ? new Animator(this.legs, 'idle') : null;
    this.legsAngle = 0;
    this.legsTurnSpeed = cfg.legsTurnSpeed ?? 14;
    this.backpedal = (cfg.backpedalAngleDeg ?? 100) * DEG;
  }

  update(dt, game) {
    const { input, map, camera } = game;

    // Movimento (spazio schermo: su/giù/strafe sx/dx, indipendente dalla mira).
    // Su touch la lunghezza del vettore (0..1) dipende da quanto è spinto lo stick -> velocità analogica.
    const move = input.getMove();
    const mag = Math.min(1, Math.hypot(move.x, move.y));
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

    // Animazioni
    if (this.legs) {
      this._updateLegs(dt, move, mag);
      this.anim.play('idle');
      this.anim.update(dt);
    } else if (this.moving) {
      this.anim.play('walk');
      this.anim.update(dt * Math.max(0.4, mag));
    } else {
      this.anim.play('idle');
      this.anim.update(dt);
    }
  }

  _updateLegs(dt, move, mag) {
    let target = this.angle;
    let dir = 1;
    if (this.moving) {
      target = Math.atan2(move.y, move.x);
      // Camminando all'indietro rispetto alla mira le gambe restano girate col busto
      // e il ciclo del passo viene riprodotto al contrario.
      if (Math.abs(angleDiff(target, this.angle)) > this.backpedal) {
        target += Math.PI;
        dir = -1;
      }
    }
    const k = 1 - Math.exp(-this.legsTurnSpeed * dt);
    this.legsAngle += angleDiff(target, this.legsAngle) * k;

    if (this.moving) {
      this.legsAnim.play('walk');
      this.legsAnim.update(dt * Math.max(0.35, mag) * dir);
    } else {
      this.legsAnim.play('idle');
      this.legsAnim.update(dt);
    }
  }

  get muzzle() {
    const off = this.weapon.muzzleOffset ?? 8;
    return { x: this.x + Math.cos(this.angle) * off, y: this.y + Math.sin(this.angle) * off };
  }

  draw(ctx) {
    if (this.legs) drawSprite(ctx, this.legs, this.legsAnim.frame, this.x, this.y, this.legsAngle);
    drawSprite(ctx, this.sprite, this.anim.frame, this.x, this.y, this.angle);
  }
}
