// Camera che segue un bersaglio con smoothing e "look-ahead" nella direzione di mira.

export class Camera {
  constructor(cfg = {}) {
    this.x = 0;
    this.y = 0;
    this.smoothing = cfg.smoothing ?? 10;
    this.lookAhead = cfg.lookAhead ?? 0;
  }

  _target(tx, ty, angle, viewW, viewH, map) {
    let x = tx + Math.cos(angle) * this.lookAhead - viewW / 2;
    let y = ty + Math.sin(angle) * this.lookAhead - viewH / 2;
    x = map.pixelWidth <= viewW ? (map.pixelWidth - viewW) / 2 : clamp(x, 0, map.pixelWidth - viewW);
    y = map.pixelHeight <= viewH ? (map.pixelHeight - viewH) / 2 : clamp(y, 0, map.pixelHeight - viewH);
    return { x, y };
  }

  snap(tx, ty, angle, viewW, viewH, map) {
    const t = this._target(tx, ty, angle, viewW, viewH, map);
    this.x = t.x;
    this.y = t.y;
  }

  follow(tx, ty, angle, viewW, viewH, map, dt) {
    const t = this._target(tx, ty, angle, viewW, viewH, map);
    const k = 1 - Math.exp(-this.smoothing * dt);
    this.x += (t.x - this.x) * k;
    this.y += (t.y - this.y) * k;
  }
}

function clamp(v, a, b) {
  return v < a ? a : v > b ? b : v;
}
