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
    this.cc = cfg.ctf || {};
    this.toast = null; // { text, color, time } messaggio temporaneo (es. bandiera conquistata)
    this.rc = cfg.rank || {};
    this.sc = cfg.score || {};
    this.pc = cfg.promotion || {};
    this.popups = []; // "+100 UCCISIONE" sopra il giocatore: { text, color, age }
    this.promotions = []; // coda delle promozioni da mostrare: { name, insignia, age }
    this.hurts = []; // colpi subiti: { angle (verso chi ha sparato), strength 0..1, age } (hud.hurtIndicator)
  }

  /**
   * Colpo subito da direzione angle (radianti, dal giocatore verso la fonte), strength = frazione della vita persa:
   * arco rosso attorno al giocatore. Colpi dalla stessa direzione (entro mergeDeg) rinnovano lo stesso arco.
   */
  hurtFrom(angle, strength) {
    const hc = this.cfg.hurtIndicator || {};
    if (hc.show === false) return;
    const merge = ((hc.mergeDeg ?? 25) * Math.PI) / 180;
    for (const h of this.hurts) {
      const d = Math.abs(Math.atan2(Math.sin(angle - h.angle), Math.cos(angle - h.angle)));
      if (d < merge) {
        h.angle = angle;
        h.age = 0;
        h.strength = Math.min(1, Math.max(h.strength, strength) + strength * 0.5);
        return;
      }
    }
    this.hurts.push({ angle, strength: Math.min(1, strength), age: 0 });
    const max = hc.max ?? 6;
    while (this.hurts.length > max) this.hurts.shift();
  }

  /** Mostra un messaggio temporaneo sotto il pannello dei ticket. */
  notify(text, color) {
    this.toast = { text, color: color || this.cfg.text || '#fff', time: this.cc.toastTime ?? 2.5 };
  }

  /** Punti guadagnati: testo che sale sopra il giocatore e svanisce. */
  popup(text, color) {
    this.popups.push({ text, color: color || this.sc.color || '#ffd36b', age: 0 });
    const max = this.sc.max ?? 4;
    while (this.popups.length > max) this.popups.shift();
  }

  /**
   * Nuovo grado: { name, insignia (canvas) }, mostrato al centro per promotion.time secondi (in coda).
   * Anche le medaglie: { title, name, insignia, sub (es. "+300"), time }.
   */
  promote(p) {
    this.promotions.push({ ...p, age: 0 });
  }

  update(dt, player) {
    this.time += dt;
    if (this.toast && (this.toast.time -= dt) <= 0) this.toast = null;
    const life = this.sc.life ?? 1.4;
    for (const p of this.popups) p.age += dt;
    this.popups = this.popups.filter((p) => p.age < life);
    if (this.hurts.length) {
      const hurtLife = this.cfg.hurtIndicator?.life ?? 1.2;
      for (const h of this.hurts) h.age += dt;
      this.hurts = this.hurts.filter((h) => h.age < hurtLife);
    }
    const pr = this.promotions[0];
    if (pr && (pr.age += dt) >= (pr.time ?? this.pc.time ?? 4)) this.promotions.shift();
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
    const weapon = m * 2 + (this.cfg.fontSize ?? 7) + (this.wc.ammoFontSize ?? 10) + 16;
    // sotto vita e granate c'è il grado (insegna alta fino a rank.maxHeight)
    const rank = this.rc.show === false ? 0 : this._rankTop() + (this.rc.maxHeight ?? 20) + m;
    return Math.max(weapon, rank) * u;
  }

  /**
   * mode (opzionale) = { ctf, team, zone, respawnIn } per la modalità Capture The Flag,
   * + rank = { insignia, name, ratio, score } (grado del giocatore) e screen = { x, y } (giocatore sullo schermo).
   */
  draw(ui, display, player, mode) {
    const u = display.cssPerPixel;
    ui.save();
    ui.imageSmoothingEnabled = false;
    if (mode?.suppression > 0.01) this._drawSuppression(ui, display, mode.suppression);
    if (this.hurts.length && mode?.screen && !player.dead) this._drawHurts(ui, u, mode.screen);
    this._drawHealth(ui, u, player);
    if (mode?.stamina !== null && mode?.stamina !== undefined) this._drawStamina(ui, u, mode.stamina);
    if (mode?.minimap) {
      const W = Math.floor(display.cssWidth / u);
      let y = this._drawMinimap(ui, u, W, mode.minimap);
      if (mode.squad) y = this._drawSquadLine(ui, u, W, y, mode.squad);
      if (mode.killFeed?.length) this._drawKillFeed(ui, u, W, y + 2, mode.killFeed, mode.minimap.ctf.teams, mode.compactFeed);
    }
    this._drawGrenades(ui, u, player);
    if (mode?.rank && this.rc.show !== false) this._drawRank(ui, u, mode.rank);
    if (mode?.screen) this._drawPopups(ui, u, mode.screen);
    if (mode?.pickup && mode.screen) {
      // invito a raccogliere l'arma, sotto il soldato
      const pc = this.cfg.pickup || {};
      this._text(ui, u, mode.pickup, Math.round(mode.screen.x), Math.round(mode.screen.y + (pc.offset ?? 10)),
        pc.fontSize ?? 6, pc.color || '#ffd36b', 'center');
    }
    if (mode?.vehicle) this._drawVehicle(ui, u, display.cssWidth, mode.vehicle);
    else this._drawWeapon(ui, u, display.cssWidth, player, mode?.holster);
    if (mode?.reloadPrompt) this._drawReloadPrompt(ui, u, display, mode.reloadPrompt);
    if (mode?.ctf) {
      const W = Math.floor(display.cssWidth / u);
      let y = this._drawTickets(ui, u, W, mode.ctf, mode.team, mode.zone);
      y = this._drawZone(ui, u, W, mode.ctf, mode.zone, y);
      if (this.toast) this._text(ui, u, this.toast.text, Math.floor(W / 2), y + 2, this.cfg.fontSize ?? 7, this.toast.color, 'center');
      if (mode.respawnIn !== null && mode.respawnIn !== undefined) this._drawRespawn(ui, u, W, Math.floor(display.cssHeight / u), mode.respawnIn);
    }
    if (this.promotions.length) this._drawPromotion(ui, u, Math.floor(display.cssWidth / u), Math.floor(display.cssHeight / u));
    ui.restore();
  }

  // ---------- Fronte: minimappa, squadra, elenco delle uccisioni, fiato, soppressione ----------

  /**
   * Minimappa in alto a destra sotto l'arma (hud.minimap: top, width, alpha...): la mappa (con i crolli),
   * bandiere col colore del proprietario, compagni, squadra, nemici avvistati dalla squadra, mezzi, giocatore.
   * Restituisce la y (pixel di gioco) sotto la minimappa.
   */
  _drawMinimap(ui, u, W, d) {
    const mc = this.cfg.minimap || {};
    const m = this.cfg.margin ?? 5;
    const map = d.map;
    const w = mc.width ?? 72;
    const h = Math.round((w * map.pixelHeight) / map.pixelWidth);
    const x0 = W - m - w;
    const y0 = mc.top ?? 52;
    const k = w / map.pixelWidth; // pixel di gioco della minimappa per pixel del mondo
    const shadow = this.cfg.shadow || '#000';
    this._px(ui, u, x0 - 1, y0 - 1, w + 2, h + 2, mc.border || '#000');
    ui.save();
    ui.globalAlpha = mc.alpha ?? 0.85;
    ui.imageSmoothingEnabled = true; // rimpicciolita: meglio sfumata che a scatti
    ui.drawImage(map.canvas, 0, 0, map.pixelWidth, map.pixelHeight, x0 * u, y0 * u, w * u, h * u);
    ui.restore();
    ui.imageSmoothingEnabled = false;
    const P = (wx, wy) => [Math.round(x0 + wx * k), Math.round(y0 + wy * k)];
    const dot = (wx, wy, color, s = 2) => {
      const [x, y] = P(wx, wy);
      this._px(ui, u, x - (s >> 1), y - (s >> 1), s, s, color);
    };
    const teams = d.ctf.teams;
    // bandiere: quadratino del colore del proprietario (bianco = neutrale), lampeggia se contesa; ordine = cornice
    for (const f of d.ctf.flags) {
      const [x, y] = P(f.x, f.y);
      const blink = f.contested && Math.floor(this.time * 4) % 2 === 0;
      const c = blink ? '#ffffff' : f.owner ? teams[f.owner].color : mc.neutral || '#e8e8e8';
      if (d.order === f) this._px(ui, u, x - 3, y - 3, 7, 7, this.cfg.squadColor || mc.squad || '#7cf07c');
      this._px(ui, u, x - 2, y - 2, 5, 5, shadow);
      this._px(ui, u, x - 2, y - 2, 4, 4, c);
    }
    for (const v of d.vehicles) dot(v.x, v.y, v.team ? teams[v.team]?.dark || '#888' : mc.emptyVehicle || '#9a9a9a', 3);
    for (const a of d.allies) dot(a.x, a.y, teams[d.team]?.color || '#4af');
    for (const e of d.enemies) dot(e.x, e.y, mc.enemy || '#ff4a3a', e.vehicle ? 3 : 2);
    for (const s of d.squad) dot(s.x, s.y, mc.squad || '#7cf07c');
    if (d.player) {
      // giocatore: punto bianco con un pixel nella direzione della mira
      const [x, y] = P(d.player.x, d.player.y);
      this._px(ui, u, x - 1, y - 1, 3, 3, shadow);
      this._px(ui, u, x - 1, y - 1, 2, 2, mc.player || '#ffffff');
      this._px(ui, u, Math.round(x + Math.cos(d.player.angle) * 2), Math.round(y + Math.sin(d.player.angle) * 2), 1, 1, mc.player || '#ffffff');
    }
    return y0 + h + 3;
  }

  /** Sotto la minimappa: ordine attuale alla squadra ("SQUADRA: SEGUITEMI [T]"). */
  _drawSquadLine(ui, u, W, y, s) {
    const m = this.cfg.margin ?? 5;
    const size = this.cfg.squadFontSize ?? 6;
    const text = s.key ? `${s.text} [${s.key}]` : s.text;
    this._text(ui, u, text, W - m, y, size, this.cfg.minimap?.squad || '#7cf07c', 'right');
    return y + size + 2;
  }

  /**
   * Elenco delle uccisioni (hud.killFeed: fontSize, life, fade, max): "Uccisore [arma] Vittima" allineato a destra,
   * nomi nel colore della squadra, le righe che riguardano il giocatore evidenziate; le vecchie svaniscono.
   */
  _drawKillFeed(ui, u, W, y, list, teams = {}, compact = false) {
    const fc = this.cfg.killFeed || {};
    const m = this.cfg.margin ?? 5;
    const size = fc.fontSize ?? 6;
    const life = fc.life ?? 6;
    const fade = fc.fade ?? 1;
    for (let i = list.length - 1; i >= 0; i--) {
      const k = list[i];
      const a = Math.max(0, Math.min(1, (life - k.age) / fade));
      if (a <= 0) continue;
      ui.globalAlpha = a;
      if (k.mine) {
        ui.font = `bold ${Math.round(size * u)}px ${this.cfg.font || 'monospace'}`;
        const kw = this._killWidth(ui, u, k, compact);
        this._px(ui, u, W - m - 2 - kw, y - 1, kw + 4, size + 2, fc.mineBack || 'rgba(255,211,107,0.22)');
      }
      let x = W - m;
      x -= this._textW(ui, u, k.victim, x, y, size, teams[k.vTeam]?.light || '#fff', 'right') + 3;
      const how = compact ? (k.killer ? '›' : '') : k.how ? `[${k.how}]` : '';
      if (how) x -= this._textW(ui, u, how, x, y, size, fc.weaponColor || '#c8c8d0', 'right') + 3;
      if (k.killer) this._text(ui, u, k.killer, x, y, size, teams[k.kTeam]?.light || '#fff', 'right');
      y += size + 2;
    }
    ui.globalAlpha = 1;
  }

  /** Larghezza (pixel di gioco) di una riga dell'elenco delle uccisioni (font già impostato). */
  _killWidth(ui, u, k, compact = false) {
    const how = compact ? (k.killer ? '›' : null) : k.how ? `[${k.how}]` : null;
    const parts = [k.victim, how, k.killer].filter(Boolean);
    return parts.reduce((s, p) => s + ui.measureText(p).width / u, 0) + (parts.length - 1) * 3;
  }

  /** Fiato della corsa: barra sottile sotto quella della vita (solo quando non è pieno). */
  _drawStamina(ui, u, stamina) {
    const sc = this.cfg.stamina || {};
    const m = this.cfg.margin ?? 5;
    const bw = this.hc.width ?? 60;
    const bx = m + 9;
    const by = m + (this.hc.height ?? 5) + 1;
    const low = stamina < (sc.low ?? 0.25);
    this._px(ui, u, bx, by, bw, 1, sc.back || 'rgba(0,0,0,0.6)');
    this._px(ui, u, bx, by, Math.round(bw * stamina), 1, low ? sc.lowColor || '#ff9a3a' : sc.color || '#8ad4ff');
  }

  /** Soppressione: bordi dello schermo che si scuriscono sotto il fuoco (hud.suppression: color, maxAlpha, inner). */
  _drawSuppression(ui, display, s) {
    const sc = this.cfg.suppression || {};
    const w = display.cssWidth;
    const h = display.cssHeight;
    const r = Math.hypot(w, h) / 2;
    const g = ui.createRadialGradient(w / 2, h / 2, r * (sc.inner ?? 0.45), w / 2, h / 2, r);
    const a = Math.min(1, s) * (sc.maxAlpha ?? 0.5);
    const c = sc.color || '0,0,0';
    g.addColorStop(0, `rgba(${c},0)`);
    g.addColorStop(1, `rgba(${c},${a.toFixed(3)})`);
    ui.fillStyle = g;
    ui.fillRect(0, 0, w, h);
  }

  /**
   * Indicatori dei colpi subiti: archi a pixel attorno al giocatore (screen = posizione in px di gioco), a
   * hurtIndicator.radius px, larghi widthDeg, spessi thickness al centro e 1 px alle punte; opacità da minAlpha a
   * maxAlpha secondo la forza (piena da fullAt della vita persa), svaniscono nell'ultimo "fade" della durata.
   */
  _drawHurts(ui, u, screen) {
    const hc = this.cfg.hurtIndicator || {};
    const life = hc.life ?? 1.2;
    const fade = hc.fade ?? 0.6;
    const R = hc.radius ?? 20;
    const half = (((hc.widthDeg ?? 50) / 2) * Math.PI) / 180;
    const thick = hc.thickness ?? 3;
    const minA = hc.minAlpha ?? 0.45;
    const maxA = hc.maxAlpha ?? 0.9;
    const full = hc.fullAt ?? 0.3;
    const sx = Math.round(screen.x);
    const sy = Math.round(screen.y);
    ui.fillStyle = hc.color || '#ff2a1a';
    for (const h of this.hurts) {
      const left = (life - h.age) / life;
      const k = Math.min(1, h.strength / full);
      ui.globalAlpha = (minA + (maxA - minA) * k) * Math.min(1, left / fade);
      const seen = new Set(); // ogni pixel una volta sola (niente sovrapposizioni più scure)
      const steps = Math.ceil(R * half * 2) * 2;
      for (let i = 0; i <= steps; i++) {
        const t = i / steps; // 0..1 lungo l'arco
        const a = h.angle - half + t * half * 2;
        const tk = Math.max(1, Math.round(thick * Math.sin(t * Math.PI))); // affusolato alle punte
        for (let r = 0; r < tk; r++) {
          const px = sx + Math.round(Math.cos(a) * (R + r));
          const py = sy + Math.round(Math.sin(a) * (R + r));
          const key = px * 4096 + py;
          if (seen.has(key)) continue;
          seen.add(key);
          ui.fillRect(px * u, py * u, u, u);
        }
      }
    }
    ui.globalAlpha = 1;
  }

  /** "RICARICA!" lampeggiante al centro, sotto il giocatore (game.json -> hud.reloadPrompt). */
  _drawReloadPrompt(ui, u, display, text) {
    const rp = this.cfg.reloadPrompt || {};
    const period = rp.blink ?? 0.5;
    if (this.time % period >= period * (rp.duty ?? 0.6)) return;
    const W = Math.floor(display.cssWidth / u);
    const H = Math.floor(display.cssHeight / u);
    this._text(ui, u, text, Math.floor(W / 2), Math.floor(H * (rp.y ?? 0.62)), rp.fontSize ?? 10, rp.color || '#ffd36b', 'center');
  }

  // ---------- Punteggio e grado ----------

  /** y (pixel di gioco) del blocco del grado: sotto la riga delle granate. */
  _rankTop() {
    const m = this.cfg.margin ?? 5;
    return m + (this.hc.height ?? 5) + 4 + (this.cfg.fontSize ?? 7) + 4;
  }

  /** In alto a sinistra sotto le granate: insegna, nome breve del grado, barra verso il prossimo grado e punti. */
  _drawRank(ui, u, r) {
    const rc = this.rc;
    const m = this.cfg.margin ?? 5;
    const size = rc.fontSize ?? 6;
    const y = this._rankTop();
    const ins = r.insignia;
    // insegna con un po' di margine (il canvas ha già il contorno di 1 px)
    ui.drawImage(ins, m * u - u, y * u - u, ins.width * u, ins.height * u);
    const x = m + ins.width - 2 + (rc.gap ?? 3);
    this._text(ui, u, r.name, x, y, size, rc.nameColor || '#ffd36b');
    const by = y + size + 3;
    const bw = rc.barWidth ?? 36;
    const bh = rc.barHeight ?? 2;
    this._px(ui, u, x - 1, by - 1, bw + 2, bh + 2, this.cfg.shadow || '#000');
    this._px(ui, u, x, by, bw, bh, rc.barBack || '#1a1a22');
    const fill = Math.round(bw * r.ratio);
    if (fill > 0) this._px(ui, u, x, by, fill, bh, rc.barColor || '#ffd36b');
    this._text(ui, u, this.i18n.t('hud.score', { score: r.score }), x + bw + 4, by + bh / 2 - size / 2, size, this.cfg.text || '#fff');
  }

  /** "+N EVENTO" sopra il giocatore: il più recente in basso, salgono e svaniscono. */
  _drawPopups(ui, u, screen) {
    const sc = this.sc;
    const life = sc.life ?? 1.4;
    const size = sc.fontSize ?? 6;
    const line = size + 2;
    const n = this.popups.length;
    this.popups.forEach((p, i) => {
      const k = p.age / life;
      const y = Math.round(screen.y - (sc.offset ?? 16) - p.age * (sc.rise ?? 10) - (n - 1 - i) * line);
      ui.globalAlpha = k < 0.7 ? 1 : Math.max(0, 1 - (k - 0.7) / 0.3);
      this._text(ui, u, p.text, Math.round(screen.x), y, size, p.color, 'center');
    });
    ui.globalAlpha = 1;
  }

  /** Promozione: fascia al centro con titolo, insegna ingrandita (a scatti di pixel interi) e nome del grado. */
  _drawPromotion(ui, u, W, H) {
    const pc = this.pc;
    const p = this.promotions[0];
    const T = p.time ?? pc.time ?? 4;
    const fadeIn = pc.fadeIn ?? 0.25;
    const fadeOut = pc.fadeOut ?? 0.6;
    const alpha = Math.min(1, p.age / fadeIn, (T - p.age) / fadeOut);
    if (alpha <= 0) return;
    const titleSize = pc.titleSize ?? 8;
    const nameSize = pc.nameSize ?? 10;
    const ins = p.insignia;
    // scala intera più grande possibile entro insigniaHeight (insegne alte = scala minore)
    const maxScale = Math.max(1, Math.min(pc.scale ?? 3, Math.floor((p.medal ? pc.medalHeight ?? 46 : pc.insigniaHeight ?? 44) / ins.height)));
    // l'insegna "cresce" di un pixel di scala alla volta, poi resta ferma
    const scale = Math.min(maxScale, 1 + Math.floor(p.age / (pc.growStep ?? 0.06)));
    const insH = ins.height * maxScale;
    const pad = 5;
    const subSize = pc.subSize ?? 7;
    const bandH = pad + titleSize + 4 + insH + 4 + nameSize + (p.sub ? 3 + subSize : 0) + pad;
    const top = Math.round(H * (pc.y ?? 0.22));
    const cx = Math.floor(W / 2);

    ui.globalAlpha = alpha * (pc.bandAlpha ?? 0.65);
    this._px(ui, u, 0, top, W, bandH, pc.band || '#05050a');
    ui.globalAlpha = alpha;
    const line = pc.color || '#ffd36b';
    this._px(ui, u, 0, top, W, 1, line);
    this._px(ui, u, 0, top + bandH - 1, W, 1, line);
    // lampo iniziale della fascia
    if (p.age < 0.15) {
      ui.globalAlpha = alpha * (1 - p.age / 0.15) * 0.5;
      this._px(ui, u, 0, top, W, bandH, '#ffffff');
      ui.globalAlpha = alpha;
    }
    let y = top + pad;
    this._text(ui, u, p.title ?? this.i18n.t('hud.promoted'), cx, y, titleSize, line, 'center');
    y += titleSize + 4;
    const iw = ins.width * scale;
    const ih = ins.height * scale;
    ui.drawImage(ins, (cx - Math.floor(iw / 2)) * u, (y + Math.floor((insH - ih) / 2)) * u, iw * u, ih * u);
    y += insH + 4;
    this._text(ui, u, p.name, cx, y, nameSize, this.cfg.text || '#fff', 'center');
    if (p.sub) this._text(ui, u, p.sub, cx, y + nameSize + 3, subSize, line, 'center');
    ui.globalAlpha = 1;
  }

  // ---------- Capture The Flag ----------

  /**
   * In alto al centro: ticket della propria squadra (sinistra) e delle altre (destra) con barre,
   * sotto le bandiere (pennone + drappo all'altezza e del colore attuali, lettera).
   * Restituisce la y (pixel di gioco) sotto il pannello.
   */
  _drawTickets(ui, u, W, ctf, team, zone) {
    const cc = this.cc;
    const m = this.cfg.margin ?? 5;
    const size = cc.ticketFontSize ?? 8;
    const gap = cc.gap ?? 4;
    const barW = cc.barWidth ?? 36;
    const barH = cc.barHeight ?? 2;
    const cx = Math.floor(W / 2);
    const shadow = this.cfg.shadow || '#000';
    const order = [team, ...ctf.teamIds.filter((t) => t !== team)].filter((t) => ctf.teams[t]);
    const low = cc.lowTickets ?? 0.1;

    let y = m;
    order.slice(0, 2).forEach((t, i) => {
      const left = i === 0;
      const tc = ctf.teams[t];
      const ratio = Math.max(0, ctf.tickets[t] / (ctf.startTickets[t] || 1));
      // ticket quasi finiti: il numero lampeggia
      const blink = ratio <= low && Math.floor(this.time * 3) % 2 === 0;
      const color = blink ? this.cfg.text || '#fff' : tc.color;
      this._text(ui, u, String(ctf.tickets[t]), left ? cx - gap : cx + gap, y, size, color, left ? 'right' : 'left');
      const by = y + size + 2;
      const bx = left ? cx - gap - barW : cx + gap;
      const fill = Math.round(barW * ratio);
      this._px(ui, u, bx - 1, by - 1, barW + 2, barH + 2, shadow);
      this._px(ui, u, bx, by, barW, barH, cc.barBack || '#1a1a22');
      if (fill > 0) this._px(ui, u, left ? bx + barW - fill : bx, by, fill, barH, tc.color);
    });
    y += size + 2 + barH + 4;

    // bandiere
    const flags = ctf.flags;
    if (!flags.length) return this._drawTimer(ui, u, cx, y, ctf);
    const iw = 7; // pennone + drappo di 5 px + spazio
    const ih = 8;
    const fgap = cc.flagGap ?? 4;
    const total = flags.length * iw + (flags.length - 1) * fgap;
    let x = cx - Math.floor(total / 2);
    const letter = cc.flagFontSize ?? 6;
    for (const f of flags) {
      const { color, dark } = ctf.flagColors(f);
      const blink = f.contested && Math.floor(this.time * 4) % 2 === 0;
      this._px(ui, u, x + 1, y + 1, 1, ih, shadow);
      this._px(ui, u, x, y, 1, ih, ctf.look.poleColor || '#c8c8d0');
      const fy = y + Math.round((1 - f.progress) * (ih - 4));
      this._px(ui, u, x + 2, fy + 1, 5, 3, shadow);
      this._px(ui, u, x + 1, fy, 5, 3, blink ? '#ffffff' : color);
      this._px(ui, u, x + 1, fy + 2, 5, 1, blink ? '#ffffff' : dark);
      // lettera; sottolineata se il giocatore è nella sua area
      const lc = f.owner ? ctf.teams[f.owner].color : this.cfg.text || '#fff';
      this._text(ui, u, f.id, x + 3, y + ih + 1, letter, lc, 'center');
      if (zone?.flag === f) this._px(ui, u, x, y + ih + letter + 2, iw - 1, 1, lc);
      x += iw + fgap;
    }
    return this._drawTimer(ui, u, cx, y + ih + letter + 4, ctf);
  }

  /**
   * Tempo rimasto (ctf.timeLeft, se la partita ha un tempo limite) sotto le bandiere, mm:ss; negli ultimi
   * hud.ctf.timerWarn secondi diventa del colore timerWarnColor e lampeggia. Restituisce la y sotto il testo.
   */
  _drawTimer(ui, u, cx, y, ctf) {
    if (ctf.timeLeft === null || ctf.timeLeft === undefined) return y;
    const cc = this.cc;
    const size = cc.timerFontSize ?? 7;
    const s = Math.ceil(ctf.timeLeft);
    const text = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    const warn = s <= (cc.timerWarn ?? 60);
    const blink = warn && s <= (cc.timerBlink ?? 10) && Math.floor(this.time * 3) % 2 === 0;
    const color = blink ? this.cfg.text || '#fff' : warn ? cc.timerWarnColor || '#ff6a4a' : cc.timerColor || this.cfg.text || '#fff';
    this._text(ui, u, text, cx, y - 1, size, color, 'center');
    return y + size + 2;
  }

  /** Stato della cattura se il giocatore è nell'area di una bandiera: testo + barra dell'altezza del drappo. */
  _drawZone(ui, u, W, ctf, zone, y) {
    if (!zone || zone.state === 'held') return y;
    const cc = this.cc;
    const size = this.cfg.fontSize ?? 7;
    const cx = Math.floor(W / 2);
    const f = zone.flag;
    const { color } = ctf.flagColors(f);
    const contested = zone.state === 'contested';
    this._text(ui, u, this.i18n.t(`hud.flag.${zone.state}`, { flag: f.id }), cx, y, size, contested ? cc.contestedColor || '#ffd36b' : this.cfg.text || '#fff', 'center');
    y += size + 2;
    const bw = cc.zoneBarWidth ?? 50;
    const bh = cc.zoneBarHeight ?? 3;
    const bx = cx - Math.floor(bw / 2);
    this._px(ui, u, bx - 1, y - 1, bw + 2, bh + 2, this.cfg.shadow || '#000');
    this._px(ui, u, bx, y, bw, bh, cc.barBack || '#1a1a22');
    this._px(ui, u, bx, y, Math.round(bw * f.progress), bh, color);
    return y + bh + 3;
  }

  /** Da morto: scritta al centro e conto alla rovescia del rientro. */
  _drawRespawn(ui, u, W, H, seconds) {
    const cc = this.cc;
    const cx = Math.floor(W / 2);
    const y = Math.floor(H * (cc.respawnY ?? 0.7));
    const big = cc.respawnFontSize ?? 10;
    this._text(ui, u, this.i18n.t('hud.killed'), cx, y, big, cc.killedColor || '#e8463a', 'center');
    this._text(ui, u, this.i18n.t('hud.respawnIn', { seconds: Math.ceil(seconds) }), cx, y + big + 3, this.cfg.fontSize ?? 7, this.cfg.text || '#fff', 'center');
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
  }

  /** Come _text, ma restituisce la larghezza del testo in pixel di gioco (per affiancare altro). */
  _textW(ui, u, str, x, y, size, color, align = 'left') {
    this._text(ui, u, str, x, y, size, color, align);
    return ui.measureText(str).width / u;
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

  /** Alla guida: nome del mezzo, barra della corazza, armi (colpi / ricarica). In alto a destra. */
  _drawVehicle(ui, u, cssWidth, v) {
    const vc = this.cfg.vehicle || {};
    const wc = this.wc;
    const m = this.cfg.margin ?? 5;
    const size = this.cfg.fontSize ?? 7;
    const right = Math.floor(cssWidth / u) - m;
    const shadow = this.cfg.shadow || '#000';
    let y = m;
    this._text(ui, u, v.name, right, y, size, this.cfg.text || '#fff', 'right');
    y += size + 3;
    // corazza
    const bw = vc.barWidth ?? 60;
    const bh = vc.barHeight ?? 4;
    const ratio = Math.max(0, v.health / v.maxHealth);
    const low = ratio <= (vc.lowThreshold ?? 0.3);
    const blink = low && Math.floor(this.time * 4) % 2 === 0;
    this._px(ui, u, right - bw - 1, y - 1, bw + 2, bh + 2, shadow);
    this._px(ui, u, right - bw, y, bw, bh, vc.back || '#14202a');
    const fill = Math.round(bw * ratio);
    if (fill > 0) {
      this._px(ui, u, right - bw, y, fill, bh, blink ? '#ffffff' : low ? vc.lowColor || '#ff6a3a' : vc.color || '#8ac4e8');
      this._px(ui, u, right - bw, y, fill, 1, vc.light || '#c8e6ff');
    }
    y += bh + 4;
    // armi
    for (const g of v.guns) {
      const empty = g.ammo === 0 && !g.reloading;
      const ammoColor = g.reloading ? wc.reloadColor || '#ffd36b' : empty ? wc.emptyColor || '#f43' : wc.ammoColor || '#ffd36b';
      const txt = g.reloading ? this.i18n.t('hud.reloading') : `${g.ammo}/${g.magazine}`;
      const w = this._textW(ui, u, txt, right, y, size, ammoColor, 'right');
      this._text(ui, u, g.name, right - w - 4, y, size, this.cfg.text || '#fff', 'right');
      y += size + 1;
      if (g.reloading) {
        const pw = vc.reloadWidth ?? 40;
        this._px(ui, u, right - pw - 1, y - 1, pw + 2, 4, shadow);
        this._px(ui, u, right - pw, y, pw, 2, wc.reloadBack || '#222');
        this._px(ui, u, right - pw, y, Math.round(pw * g.progress), 2, wc.reloadColor || '#ffd36b');
        y += 4;
      }
      y += 2;
    }
  }

  _drawWeapon(ui, u, cssWidth, player, holster = null) {
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
    // munizioni contate: "+N" di scorta invece della capienza del caricatore (verde subito dopo un rifornimento,
    // rossa a scorta finita)
    const counted = w.reserve !== undefined;
    const left = player.reserve[w.id] ?? 0;
    const magText = counted ? ` +${left}` : `/${w.magazine}`;
    let magColor = this.cfg.text || '#fff';
    if (counted && player.resupplyFlash > 0) magColor = wc.resupplyColor || '#a4e88c';
    else if (counted && left <= 0) magColor = wc.emptyColor || '#f43';
    const magW = this._textW(ui, u, magText, right, y + ammoSize - size, size, magColor, 'right');
    const ammoW = this._textW(ui, u, String(player.ammo), right - magW - 1, y, ammoSize, ammoColor, 'right');
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
    // seconda arma nella fondina
    if (holster) this._text(ui, u, holster, right, y + size + 2, this.cfg.weapon?.holsterFontSize ?? 6, this.cfg.weapon?.holsterColor || '#c8c8d0', 'right');
  }
}
