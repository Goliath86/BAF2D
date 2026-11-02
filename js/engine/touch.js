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
  /** options.debug: mostra anche i pulsanti con "debugOnly": true (URL ?debug=1). */
  constructor(cfg = {}, options = {}) {
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

    // Pulsanti tondi: il nome è l'azione che generano (input.wasPressed(nome))
    this.buttons = Object.entries(this.cfg.buttons || {})
      .filter(([, b]) => !b.debugOnly || options.debug)
      .map(([action, b]) => ({
        action,
        radius: b.radius ?? 0.07,
        anchor: b.anchor || 'right',
        offset: b.offset || [0, -2],
        icon: b.icon || null,
        color: b.color || null, // colore del bordo/icona (default bianco)
        id: null, // pointerId che lo tiene premuto
      }));
    this.pressed = new Set();
  }

  /**
   * Centro e raggio (px CSS) di un pulsante: "offset" è in raggi di stick rispetto
   * alla posizione di riposo dello stick "anchor" (es. [0, -2] = sopra lo stick destro).
   */
  buttonGeometry(b) {
    const R = this.radius;
    const home = this.homePosition(b.anchor === 'left' ? this.left : this.right);
    return {
      x: home.x + b.offset[0] * R,
      y: home.y + b.offset[1] * R,
      r: Math.min(window.innerWidth, window.innerHeight) * b.radius,
    };
  }

  /** Azione di un pulsante premuta in questo tick. */
  wasPressed(action) {
    return this.pressed.has(action);
  }

  endFrame() {
    this.pressed.clear();
  }

  _buttonAt(x, y) {
    for (const b of this.buttons) {
      const g = this.buttonGeometry(b);
      // area di tocco un po' più larga del disegno
      if (Math.hypot(x - g.x, y - g.y) <= g.r * 1.25) return b;
    }
    return null;
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
    const button = this._buttonAt(e.clientX, e.clientY);
    if (button) {
      if (button.id === null) {
        button.id = e.pointerId;
        this.pressed.add(button.action);
      }
      return;
    }
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
    for (const b of this.buttons) {
      if (b.id === e.pointerId) b.id = null;
    }
  }

  releaseAll() {
    this.left.reset();
    this.right.reset();
    for (const b of this.buttons) b.id = null;
    this.pressed.clear();
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

  /**
   * state: stato dei pulsanti fornito dal gioco, per azione:
   * { label (testo breve, es. colpi), progress (0..1, anello di avanzamento), alert (evidenziato) }
   */
  draw(ctx, state = {}) {
    this._drawStick(ctx, this.left, false);
    this._drawStick(ctx, this.right, true);
    for (const b of this.buttons) this._drawButton(ctx, b, state[b.action] || {});
  }

  _drawButton(ctx, b, st) {
    const { x, y, r } = this.buttonGeometry(b);
    const down = b.id !== null;
    const accent = st.alert ? 'rgba(255,90,70,0.95)' : b.color || 'rgba(255,255,255,0.7)';

    ctx.save();
    ctx.globalAlpha = this.cfg.opacity * (down ? 1 : 0.8);

    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
    ctx.fillStyle = down ? 'rgba(255,255,255,0.3)' : 'rgba(255,255,255,0.1)';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = accent;
    ctx.stroke();

    if (b.icon === 'reload') {
      // freccia circolare
      const ir = r * 0.62;
      const a0 = -Math.PI * 0.35;
      const a1 = a0 + TAU * 0.8;
      ctx.beginPath();
      ctx.arc(x, y, ir, a0, a1);
      ctx.lineWidth = Math.max(2, r * 0.1);
      ctx.strokeStyle = accent;
      ctx.stroke();
      const hx = x + Math.cos(a1) * ir;
      const hy = y + Math.sin(a1) * ir;
      const t = a1 + Math.PI / 2; // tangente nel verso della freccia
      const s = r * 0.22;
      ctx.beginPath();
      ctx.moveTo(hx + Math.cos(t) * s, hy + Math.sin(t) * s);
      ctx.lineTo(hx + Math.cos(t + 2.4) * s, hy + Math.sin(t + 2.4) * s);
      ctx.lineTo(hx + Math.cos(t - 2.4) * s, hy + Math.sin(t - 2.4) * s);
      ctx.closePath();
      ctx.fillStyle = accent;
      ctx.fill();
    }

    if (b.icon === 'hurt' || b.icon === 'heal') {
      // cuore con "-" (togli vita) o "+" (ridai vita)
      const s = r * 0.5;
      ctx.beginPath();
      ctx.moveTo(x, y + s * 0.9);
      ctx.bezierCurveTo(x - s * 1.4, y - s * 0.1, x - s * 0.7, y - s * 1.1, x, y - s * 0.45);
      ctx.bezierCurveTo(x + s * 0.7, y - s * 1.1, x + s * 1.4, y - s * 0.1, x, y + s * 0.9);
      ctx.fillStyle = accent;
      ctx.fill();
      ctx.fillStyle = 'rgba(0,0,0,0.85)';
      const t = Math.max(2, r * 0.1);
      ctx.fillRect(x - s * 0.45, y - s * 0.1 - t / 2, s * 0.9, t);
      if (b.icon === 'heal') ctx.fillRect(x - t / 2, y - s * 0.55, t, s * 0.9);
    }

    if (st.label) {
      ctx.font = `bold ${Math.round(r * 0.6)}px monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = accent;
      ctx.fillText(st.label, x, y + 1);
    }

    if (st.progress > 0) {
      ctx.beginPath();
      ctx.arc(x, y, r + 3, -Math.PI / 2, -Math.PI / 2 + TAU * st.progress);
      ctx.lineWidth = 4;
      ctx.strokeStyle = 'rgba(255,200,80,0.95)';
      ctx.stroke();
    }

    ctx.restore();
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
