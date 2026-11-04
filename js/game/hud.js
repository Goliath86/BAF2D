// HUD di gioco: vita e granate (in alto a sinistra), arma e munizioni (in alto a destra).
// Disegnato sul canvas "ui" ma allineato alla griglia dei pixel di gioco (unità u = px CSS
// per pixel di gioco), così resta nitido e coerente con la pixel-art. Parametri in game.json -> "hud".

// Cuore 7x6 (X = pieno)
const HEART = ['.XX.XX.', 'XXXXXXX', 'XXXXXXX', '.XXXXX.', '..XXX..', '...X...'];

export class Hud {
  constructor(cfg = {}, i18n, assets) {
    this.cfg = cfg;
    this.hc = cfg.health || {};
    this.wc = cfg.weapon || {};
    this.i18n = i18n;
    this.assets = assets;
    this.time = 0;
    // Barra "scia": mostra per un attimo la vita persa, poi scende fino al valore reale
    this.trail = null;
    this.trailWait = 0;
    this.lastHealth = null;
    this.flash = 0; // lampeggio dopo un danno
  }

  update(dt, player) {
    this.time += dt;
    const ratio = player.health / player.maxHealth;
    if (this.trail === null) this.trail = ratio;
    if (this.lastHealth !== null && player.health < this.lastHealth) {
      this.trailWait = this.hc.trailDelay ?? 0.35;
      this.flash = 0.25;
    }
    this.lastHealth = player.health;
    this.flash = Math.max(0, this.flash - dt);
    if (ratio >= this.trail) {
      this.trail = ratio; // cura: la scia segue subito
    } else if (this.trailWait > 0) {
      this.trailWait -= dt;
    } else {
      this.trail = Math.max(ratio, this.trail - (this.hc.trailSpeed ?? 0.8) * dt);
    }
  }

  /** Altezza occupata in alto (px CSS), utile per non sovrapporre altri overlay. */
  topHeight(display) {
    const u = display.cssPerPixel;
    const m = this.cfg.margin ?? 5;
    return (m * 2 + (this.cfg.fontSize ?? 7) + (this.wc.ammoFontSize ?? 10) + 16) * u;
  }

  draw(ui, display, player) {
    const u = display.cssPerPixel;
    ui.save();
    ui.imageSmoothingEnabled = false;
    this._drawHealth(ui, u, player);
    this._drawGrenades(ui, u, player);
    this._drawWeapon(ui, u, display.cssWidth, player);
    ui.restore();
  }

  /** Granate rimaste: icona + "x2" sotto la barra della vita (grigio a scorta finita). */
  _drawGrenades(ui, u, player) {
    const gc = this.cfg.grenades || {};
    if (gc.show === false) return;
    const m = this.cfg.margin ?? 5;
    const size = this.cfg.fontSize ?? 7;
    const y = m + (this.hc.height ?? 5) + 4;
    const empty = player.grenades <= 0;
    let x = m;
    const icon = gc.icon && this.assets.sprites.get(gc.icon);
    if (icon) {
      const s = gc.iconScale ?? 1;
      const iy = y + (size - icon.fh * s) / 2;
      ui.save();
      if (empty) ui.globalAlpha = 0.4;
      ui.drawImage(icon.image, 0, 0, icon.fw, icon.fh, x * u, Math.round(iy) * u, icon.fw * s * u, icon.fh * s * u);
      ui.restore();
      x += icon.fw * s + 1;
    }
    this._text(ui, u, this.i18n.t('hud.grenades', { count: player.grenades }), x, y, size, empty ? gc.emptyColor || '#777' : this.cfg.text || '#fff');
  }

  // ---------- Disegno a "pixel di gioco" ----------

  /** Rettangolo in pixel di gioco (x, y, w, h interi) -> px CSS. */
  _px(ui, u, x, y, w, h, color) {
    ui.fillStyle = color;
    ui.fillRect(x * u, y * u, w * u, h * u);
  }

  /** Testo con ombra di 1 pixel di gioco. x,y in pixel di gioco; align 'left'|'right'. */
  _text(ui, u, str, x, y, size, color, align = 'left') {
    ui.font = `bold ${Math.round(size * u)}px ${this.cfg.font || 'monospace'}`;
    ui.textAlign = align;
    ui.textBaseline = 'top';
    ui.fillStyle = this.cfg.shadow || '#000';
    ui.fillText(str, Math.round((x + 1) * u), Math.round((y + 1) * u));
    ui.fillStyle = color;
    ui.fillText(str, Math.round(x * u), Math.round(y * u));
    return ui.measureText(str).width / u; // larghezza in pixel di gioco
  }

  _drawHealth(ui, u, player) {
    const hc = this.hc;
    const m = this.cfg.margin ?? 5;
    const ratio = Math.max(0, player.health / player.maxHealth);
    const low = ratio <= (hc.lowThreshold ?? 0.3);
    const blink = low && Math.floor(this.time * 4) % 2 === 0;

    // cuore (con ombra); lampeggia a vita bassa
    const heartColor = blink ? hc.lowColor || '#f22' : hc.icon || '#d23c3c';
    HEART.forEach((row, y) => {
      for (let x = 0; x < row.length; x++) {
        if (row[x] !== 'X') continue;
        this._px(ui, u, m + x + 1, m + y + 1, 1, 1, this.cfg.shadow || '#000');
      }
    });
    HEART.forEach((row, y) => {
      for (let x = 0; x < row.length; x++) {
        if (row[x] === 'X') this._px(ui, u, m + x, m + y, 1, 1, heartColor);
      }
    });
    this._px(ui, u, m + 1, m + 1, 1, 1, '#ffffff80'); // riflesso

    // barra
    const bw = hc.width ?? 60;
    const bh = hc.height ?? 5;
    const bx = m + 9;
    const by = m;
    this._px(ui, u, bx - 1, by - 1, bw + 2, bh + 2, hc.border || '#000');
    this._px(ui, u, bx, by, bw, bh, hc.back || '#2a1414');
    const fill = Math.round(bw * ratio);
    const trail = Math.round(bw * Math.max(ratio, this.trail ?? ratio));
    if (trail > fill) this._px(ui, u, bx + fill, by, trail - fill, bh, hc.trailColor || '#fff');
    if (fill > 0) {
      const c = this.flash > 0 ? '#ffffff' : low ? hc.lowColor || '#f22' : hc.color || '#d23c3c';
      this._px(ui, u, bx, by, fill, bh, c);
      if (this.flash <= 0) this._px(ui, u, bx, by, fill, 1, low ? c : hc.colorLight || c); // luce in alto
    }

    if (hc.showValue !== false) {
      const size = this.cfg.fontSize ?? 7;
      this._text(ui, u, String(Math.ceil(player.health)), bx + bw + 4, by + (bh - size) / 2, size,
        low ? hc.lowColor || '#f22' : this.cfg.text || '#fff');
    }
  }

  _drawWeapon(ui, u, cssWidth, player) {
    const wc = this.wc;
    const w = player.weapon;
    const m = this.cfg.margin ?? 5;
    const size = this.cfg.fontSize ?? 7;
    const right = Math.floor(cssWidth / u) - m; // bordo destro in pixel di gioco
    let y = m;

    // nome dell'arma (tradotto)
    const name = w.name ? this.i18n.t(w.name) : w.id;
    this._text(ui, u, name, right, y, size, this.cfg.text || '#fff', 'right');
    y += size + 3;

    // colpi: "12/30" con icona dell'arma a sinistra
    const empty = player.ammo === 0 && !player.reloading;
    const ammoSize = wc.ammoFontSize ?? 10;
    const ammoColor = empty ? wc.emptyColor || '#f43' : wc.ammoColor || '#ffd36b';
    const magText = `/${w.magazine}`;
    const magW = this._text(ui, u, magText, right, y + ammoSize - size, size, this.cfg.text || '#fff', 'right');
    const ammoW = this._text(ui, u, String(player.ammo), right - magW - 1, y, ammoSize, ammoColor, 'right');
    const icon = w.pickupSprite && this.assets.sprites.get(w.pickupSprite);
    if (icon) {
      const s = wc.iconScale ?? 2;
      const ix = right - magW - ammoW - 4 - icon.fw * s;
      const iy = y + (ammoSize - icon.fh * s) / 2;
      ui.drawImage(icon.image, 0, 0, icon.fw, icon.fh, Math.round(ix) * u, Math.round(iy) * u, icon.fw * s * u, icon.fh * s * u);
    }
    y += ammoSize + 3;

    // proiettili nel caricatore come tacche, oppure barra di avanzamento durante la ricarica
    const pw = wc.pipsWidth ?? 60;
    const ph = wc.pipHeight ?? 3;
    const x0 = right - pw;
    if (player.reloading) {
      this._px(ui, u, x0 - 1, y - 1, pw + 2, ph + 2, this.cfg.shadow || '#000');
      this._px(ui, u, x0, y, pw, ph, wc.reloadBack || '#222');
      this._px(ui, u, x0, y, Math.round(pw * player.reloadProgress), ph, wc.reloadColor || '#ffd36b');
    } else if (w.magazine > pw / 2) {
      // caricatori troppo grandi per le tacche: barra continua
      const fill = Math.round((pw * player.ammo) / w.magazine);
      this._px(ui, u, x0, y, pw, ph, wc.spentColor || '#444');
      this._px(ui, u, right - fill, y, fill, ph, wc.ammoColor || '#ffd36b');
    } else {
      // tacche larghe 1..3 px con 1 px di spazio, allineate a destra entro pipsWidth
      const n = w.magazine;
      const pipW = Math.max(1, Math.min(3, Math.floor(pw / n) - 1));
      const step = Math.min(pw / n, pipW + 2);
      const start = right - n * step;
      for (let i = 0; i < n; i++) {
        // le tacche si consumano da sinistra (l'ultimo colpo è quello più a destra)
        const full = i >= n - player.ammo;
        const px = Math.round(start + i * step + (step - pipW));
        this._px(ui, u, px, y, pipW, ph, full ? wc.ammoColor || '#ffd36b' : wc.spentColor || '#444');
      }
    }
    y += ph + 3;

    // stato: ricarica in corso / caricatore vuoto (lampeggiante)
    let status = null;
    let color = this.cfg.text || '#fff';
    if (player.reloading) {
      status = this.i18n.t('hud.reloading');
      color = wc.reloadColor || '#ffd36b';
    } else if (empty && Math.floor(this.time * 3) % 2 === 0) {
      status = this.i18n.t('hud.empty');
      color = wc.emptyColor || '#f43';
    }
    if (status) this._text(ui, u, status, right, y, size, color, 'right');
  }
}
