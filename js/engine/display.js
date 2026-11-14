// Gestione canvas pixel-perfect.
// - canvas "game": risoluzione interna bassa (circa targetHeight px di altezza), scalata
//   di un fattore INTERO in pixel fisici con image-rendering: pixelated -> pixel nitidi.
// - canvas "ui": risoluzione nativa del dispositivo, per joystick e HUD di debug.

export class Display {
  constructor(gameCanvas, uiCanvas, cfg = {}) {
    this.canvas = gameCanvas;
    this.ui = uiCanvas;
    this.ctx = gameCanvas.getContext('2d', { alpha: false });
    this.uiCtx = uiCanvas.getContext('2d');

    this.targetHeight = cfg.targetHeight ?? 216;
    // densità massima del canvas "ui" (HUD, stick): sui telefoni a 3x un canvas a piena risoluzione da
    // cancellare e ridisegnare a ogni fotogramma costa molto più di quanto si veda (display.uiMaxDpr)
    this.uiMaxDpr = cfg.uiMaxDpr ?? 2;
    this.minScale = cfg.minScale ?? 1;
    this.maxScale = cfg.maxScale ?? 10;

    this.width = 0;        // risoluzione interna di gioco (pixel "art")
    this.height = 0;
    this.scale = 1;        // pixel fisici per pixel di gioco
    this.cssPerPixel = 1;  // pixel CSS per pixel di gioco
    this.cssWidth = 0;
    this.cssHeight = 0;
    this.dpr = 1;

    this.resize = this.resize.bind(this);
    window.addEventListener('resize', this.resize);
    window.addEventListener('orientationchange', () => setTimeout(this.resize, 100));
    if (window.visualViewport) window.visualViewport.addEventListener('resize', this.resize);
    this.resize();
  }

  resize() {
    const dpr = window.devicePixelRatio || 1;
    const cssW = window.innerWidth;
    const cssH = window.innerHeight;
    const physW = Math.round(cssW * dpr);
    const physH = Math.round(cssH * dpr);

    const scale = Math.min(this.maxScale, Math.max(this.minScale, Math.round(physH / this.targetHeight)));

    this.dpr = dpr;
    this.scale = scale;
    this.cssWidth = cssW;
    this.cssHeight = cssH;
    this.width = Math.ceil(physW / scale);
    this.height = Math.ceil(physH / scale);
    this.cssPerPixel = scale / dpr;

    this.canvas.width = this.width;
    this.canvas.height = this.height;
    this.canvas.style.width = `${this.width * this.cssPerPixel}px`;
    this.canvas.style.height = `${this.height * this.cssPerPixel}px`;

    // densità ridotta in modo che un pixel di gioco resti un numero intero di pixel dell'HUD (niente sfocature
    // sulle forme a pixel): uiDpr = dpr · m / scale col massimo m che non supera uiMaxDpr
    let uiDpr = dpr;
    if (dpr > this.uiMaxDpr) {
      const m = Math.max(1, Math.floor((this.uiMaxDpr * scale) / dpr));
      uiDpr = (dpr * m) / scale;
    }
    this.uiDpr = uiDpr;
    this.ui.width = Math.round(cssW * uiDpr);
    this.ui.height = Math.round(cssH * uiDpr);
    this.ui.style.width = `${cssW}px`;
    this.ui.style.height = `${cssH}px`;

    // Cambiare width/height resetta lo stato del contesto
    this.ctx.imageSmoothingEnabled = false;
    this.uiCtx.setTransform(uiDpr, 0, 0, uiDpr, 0, 0);
    this.uiCtx.imageSmoothingEnabled = false;
  }

  get isPortrait() {
    return this.cssHeight > this.cssWidth;
  }

  /** Converte coordinate CSS (clientX/Y) in coordinate pixel di gioco (schermo). */
  cssToGame(x, y) {
    return { x: x / this.cssPerPixel, y: y / this.cssPerPixel };
  }
}
