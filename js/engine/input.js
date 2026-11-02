// Input unificato: tastiera + mouse (desktop) e twin-stick virtuali (touch).
// La modalità attiva cambia automaticamente in base all'ultimo dispositivo usato.

import { TouchSticks } from './touch.js';

export class Input {
  /** options.debug: abilita i pulsanti touch di debug (vedi TouchSticks). */
  constructor(display, cfg = {}, options = {}) {
    this.display = display;
    this.cfg = cfg;
    this.enabled = false;

    const coarse = matchMedia('(pointer: coarse)').matches;
    const fine = matchMedia('(pointer: fine)').matches;
    this.isTouchDevice = coarse || (navigator.maxTouchPoints > 0 && !fine);
    this.mode = this.isTouchDevice ? 'touch' : 'desktop';

    this.bindings = cfg.keyboard || {};
    this.boundCodes = new Set(Object.values(this.bindings).flat());
    this.fireButton = cfg.mouse?.fireButton ?? 0;

    this.keys = new Set();
    this.pressed = new Set();
    this.mouse = { x: 0, y: 0, buttons: 0, seen: false };
    this.sticks = new TouchSticks(cfg.touch, { debug: !!options.debug });

    document.body.classList.toggle('is-touch', this.isTouchDevice);
    this._applyModeClass();
    this._attach();
  }

  // ---------- API per il gioco ----------

  isDown(action) {
    const codes = this.bindings[action];
    return !!codes && codes.some((c) => this.keys.has(c));
  }

  /** Azione premuta in questo tick: da tastiera o da un pulsante touch con lo stesso nome. */
  wasPressed(action) {
    if (this.sticks.wasPressed(action)) return true;
    const codes = this.bindings[action];
    return !!codes && codes.some((c) => this.pressed.has(c));
  }

  /** Vettore di movimento in spazio schermo, lunghezza 0..1. */
  getMove() {
    if (this.mode === 'touch') return this.sticks.move;
    let x = 0;
    let y = 0;
    if (this.isDown('left')) x -= 1;
    if (this.isDown('right')) x += 1;
    if (this.isDown('up')) y -= 1;
    if (this.isDown('down')) y += 1;
    const len = Math.hypot(x, y);
    return len > 1 ? { x: x / len, y: y / len } : { x, y };
  }

  /**
   * Angolo di mira (radianti) o null se non c'è input di mira.
   * sx, sy: posizione del giocatore in pixel di gioco sullo schermo.
   */
  getAim(sx, sy) {
    if (this.mode === 'touch') return this.sticks.aim;
    if (!this.mouse.seen) return null;
    const m = this.mouseGame;
    return Math.atan2(m.y - sy, m.x - sx);
  }

  isFiring() {
    if (this.mode === 'touch') return this.sticks.firing;
    return (this.mouse.buttons & (1 << this.fireButton)) !== 0 || this.isDown('fire');
  }

  /** Su touch, tenere lo stick oltre la soglia ripete il fuoco anche con armi semiautomatiche. */
  get touchHoldToRepeat() {
    return this.cfg.touch?.holdToRepeat ?? true;
  }

  /** Posizione del mouse in pixel di gioco (schermo). */
  get mouseGame() {
    return this.display.cssToGame(this.mouse.x, this.mouse.y);
  }

  /** Da chiamare a fine tick di update: azzera i "pressed" del tick. */
  endFrame() {
    this.pressed.clear();
    this.sticks.endFrame();
  }

  // ---------- Interno ----------

  _setMode(mode) {
    if (this.mode === mode) return;
    this.mode = mode;
    this.sticks.releaseAll();
    this.mouse.buttons = 0;
    this._applyModeClass();
  }

  _applyModeClass() {
    document.body.classList.toggle('mode-touch', this.mode === 'touch');
    document.body.classList.toggle('mode-desktop', this.mode === 'desktop');
  }

  _releaseAll() {
    this.keys.clear();
    this.pressed.clear();
    this.mouse.buttons = 0;
    this.sticks.releaseAll();
  }

  _attach() {
    window.addEventListener('keydown', (e) => {
      if (!this.boundCodes.has(e.code)) return;
      e.preventDefault();
      if (!this.enabled) return;
      this._setMode('desktop');
      if (!e.repeat) this.pressed.add(e.code);
      this.keys.add(e.code);
    });

    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
    });

    window.addEventListener('pointerdown', (e) => {
      if (!this.enabled) return;
      if (e.pointerType === 'touch') {
        this._setMode('touch');
        this.sticks.onDown(e);
      } else {
        this._setMode('desktop');
        this._updateMouse(e);
      }
    });

    window.addEventListener('pointermove', (e) => {
      if (e.pointerType === 'touch') {
        this.sticks.onMove(e);
      } else {
        if (this.enabled) this._setMode('desktop');
        this._updateMouse(e);
      }
    });

    const up = (e) => {
      if (e.pointerType === 'touch') this.sticks.onUp(e);
      else this._updateMouse(e);
    };
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);

    window.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('blur', () => this._releaseAll());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this._releaseAll();
    });
  }

  _updateMouse(e) {
    this.mouse.x = e.clientX;
    this.mouse.y = e.clientY;
    this.mouse.buttons = this.enabled ? e.buttons : 0;
    this.mouse.seen = true;
  }
}
