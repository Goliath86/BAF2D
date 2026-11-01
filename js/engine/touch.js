// Doppio joystick virtuale (twin-stick) per dispositivi touch.
// - metà sinistra dello schermo: stick di movimento
// - metà destra: stick di mira; oltre "fireThreshold" (frazione del raggio) spara.
// Coordinate in pixel CSS.

const TAU = Math.PI * 2;

class Stick {
  constructor(side) {
    this.side = side;
    this.reset();
  }

  reset() {
    this.id = null;   // pointerId che controlla lo stick
    this.bx = 0;      // centro base
    this.by = 0;
    this.kx = 0;      // posizione knob
    this.ky = 0;
    this.x = 0;       // vettore output (lunghezza 0..1, deadzone applicata)
    this.y = 0;
    this.raw = 0;     // distanza dal centro / raggio (0..1, senza deadzone)
  }

  get active() {
    return this.id !== null;
  }
}

export class TouchSticks {
  constructor(cfg = {}) {
    this.cfg = {
      radius: 0.16,
      deadZone: 0.12,
      moveCurve: 1,
      fireThreshold: 0.75,
      dynamic: true,
      opacity: 0.7,
      ...cfg,
    };
    this.left = new Stick('left');
    this.right = new Stick('right');
  }

  /** Raggio in px CSS, proporzionale al lato corto dello schermo. */
  get radius() {
    return Math.min(window.innerWidth, window.innerHeight) * this.cfg.radius;
  }

  /** Posizione di riposo (e base per la modalità statica). */
  homePosition(stick) {
    const R = this.radius;
    const m = R * 1.6;
    const x = stick.side === 'left' ? m : window.innerWidth - m;
    return { x, y: window.innerHeight - m };
  }

  onDown(e) {
    const stick = e.clientX < window.innerWidth / 2 ? this.left : this.right;
    if (stick.active) return;
    stick.id = e.pointerId;
    const R = this.radius;
    if (this.cfg.dynamic) {
      stick.bx = clamp(e.clientX, R, window.innerWidth - R);
      stick.by = clamp(e.clientY, R, window.innerHeight - R);
    } else {
      const h = this.homePosition(stick);
      stick.bx = h.x;
      stick.by = h.y;
    }
    this._update(stick, e.clientX, e.clientY);
  }

  onMove(e) {
    for (const s of [this.left, this.right]) {
      if (s.id === e.pointerId) this._update(s, e.clientX, e.clientY);
    }
  }

  onUp(e) {
    for (const s of [this.left, this.right]) {
      if (s.id === e.pointerId) s.reset();
    }
  }

  releaseAll() {
    this.left.reset();
    this.right.reset();
  }

  _update(s, px, py) {
    const R = this.radius;
    let dx = px - s.bx;
    let dy = py - s.by;
    let d = Math.hypot(dx, dy);
    if (d > R) {
      dx *= R / d;
      dy *= R / d;
      d = R;
    }
    s.kx = s.bx + dx;
    s.ky = s.by + dy;
    s.raw = d / R;
    const dz = this.cfg.deadZone;
    // Intensità 0..1 proporzionale allo spostamento oltre la deadzone; moveCurve > 1 dà più
    // precisione alle basse velocità, < 1 raggiunge prima la velocità piena.
    const lin = s.raw < dz ? 0 : (s.raw - dz) / (1 - dz);
    const mag = Math.pow(lin, this.cfg.moveCurve);
    s.x = d > 0 ? (dx / d) * mag : 0;
    s.y = d > 0 ? (dy / d) * mag : 0;
  }

  get move() {
    return { x: this.left.x, y: this.left.y };
  }

  /** Angolo di mira o null se lo stick destro è inattivo / nella deadzone. */
  get aim() {
    const r = this.right;
    if (!r.active || r.raw <= this.cfg.deadZone) return null;
    return Math.atan2(r.y, r.x);
  }

  get firing() {
    return this.right.active && this.right.raw >= this.cfg.fireThreshold;
  }

  draw(ctx) {
    this._drawStick(ctx, this.left, false);
    this._drawStick(ctx, this.right, true);
  }

  _drawStick(ctx, s, isAim) {
    const R = this.radius;
    const home = this.homePosition(s);
    const bx = s.active ? s.bx : home.x;
    const by = s.active ? s.by : home.y;
    const kx = s.active ? s.kx : bx;
    const ky = s.active ? s.ky : by;
    const firing = isAim && this.firing;

    ctx.save();
    ctx.globalAlpha = this.cfg.opacity * (s.active ? 1 : 0.45);

    ctx.beginPath();
    ctx.arc(bx, by, R, 0, TAU);
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(255,255,255,0.55)';
    ctx.stroke();

    if (isAim) {
      ctx.setLineDash([5, 5]);
      ctx.beginPath();
      ctx.arc(bx, by, R * this.cfg.fireThreshold, 0, TAU);
      ctx.strokeStyle = firing ? 'rgba(255,90,70,0.9)' : 'rgba(255,255,255,0.3)';
      ctx.stroke();
      ctx.setLineDash([]);
    }

    ctx.beginPath();
    ctx.arc(kx, ky, R * 0.42, 0, TAU);
    ctx.fillStyle = firing ? 'rgba(255,90,70,0.85)' : 'rgba(255,255,255,0.55)';
    ctx.fill();

    ctx.restore();
  }
}

function clamp(v, a, b) {
  return v < a ? a : v > b ? b : v;
}
