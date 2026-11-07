// Modalità Capture The Flag (conquista): bandiere catturabili, ticket delle squadre, punti di rientro.
//
// Ogni bandiera ha:
// - owner:    squadra che la possiede (conta per lo spawn e per il calo dei ticket), null = nessuno;
// - color:    squadra di cui ha il colore (null = bianca, neutra);
// - claimant: squadra che la sta issando (o che l'ha issata);
// - progress: altezza del drappo, 0 = a terra, 1 = in cima al pennone.
// Una sola squadra nell'area: se è la claimant il drappo sale (in cima la bandiera diventa sua),
// altrimenti scende mantenendo il colore precedente; a terra passa alla nuova squadra (che la issa col
// proprio colore). Due o più squadre nell'area = contesa, il drappo resta fermo.
// Parametri in game.json -> "ctf" (+ "teams"); posizioni e override per bandiera nel livello.

/** Cache dei canvas dell'area di cattura (anello tratteggiato + riempimento tenue) per raggio e colore. */
const zoneCache = new Map();

function zoneCanvas(radius, color, look) {
  const key = `${radius}|${color}`;
  let c = zoneCache.get(key);
  if (c) return c;
  const r = Math.round(radius);
  const size = r * 2 + 2;
  c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const g = c.getContext('2d');
  g.fillStyle = color;
  const dash = Math.max(1, look.zoneDash ?? 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x + 0.5 - size / 2;
      const dy = y + 0.5 - size / 2;
      const d = Math.hypot(dx, dy);
      if (Math.abs(d - r) < 0.5) {
        // anello tratteggiato: segmenti di "dash" px lungo la circonferenza
        const arc = (Math.atan2(dy, dx) + Math.PI) * r;
        if (Math.floor(arc / dash) % 2 !== 0) continue;
        g.globalAlpha = look.zoneAlpha ?? 0.4;
      } else if (d < r - 0.5) {
        g.globalAlpha = look.zoneFillAlpha ?? 0.06;
      } else {
        continue;
      }
      g.fillRect(x, y, 1, 1);
    }
  }
  zoneCache.set(key, c);
  return c;
}

export class Ctf {
  /**
   * cfg = game.json -> "ctf"; teams = game.json -> "teams" ({ id: { color, dark, light } });
   * map = TileMap (bandiere e spawn dal livello); level.flags = override per bandiera ({ "A": { "owner": "red" } }).
   */
  constructor(cfg = {}, teams = {}, map, level = {}) {
    this.cfg = cfg;
    this.teams = teams;
    this.teamIds = Object.keys(teams);
    this.map = map;
    this.look = cfg.look || {};
    this.time = 0;

    const overrides = level.flags || {};
    this.flags = map.flags
      .map((f) => {
        const o = { ...(cfg.flag || {}), ...(overrides[f.id] || {}) };
        let initialOwner = o.owner ?? null;
        if (initialOwner !== null && !teams[initialOwner]) {
          console.warn(`Flag "${f.id}": unknown team "${initialOwner}", starting neutral`);
          initialOwner = null;
        }
        return {
          id: f.id,
          x: f.x,
          y: f.y,
          radius: o.radius ?? 32,
          captureTime: Math.max(0.1, o.captureTime ?? 8),
          neutralizeTime: Math.max(0.1, o.neutralizeTime ?? o.captureTime ?? 8),
          extraCapturerSpeed: o.extraCapturerSpeed ?? 0,
          requireSight: o.requireSight !== false,
          spawnDistance: o.spawnDistance || [14, 24],
          initialOwner,
        };
      })
      .sort((a, b) => a.id.localeCompare(b.id));

    // basi delle squadre: spawn col nome della squadra, altrimenti "player", altrimenti il centro
    const fallback = map.spawns.player || { x: map.pixelWidth / 2, y: map.pixelHeight / 2 };
    this.bases = {};
    for (const t of this.teamIds) {
      if (!map.spawns[t]) console.warn(`Level has no spawn for team "${t}"`);
      this.bases[t] = map.spawns[t] || fallback;
    }
    this.reset();
  }

  /** Nuova partita: ticket pieni, bandiere allo stato iniziale del livello. */
  reset() {
    const t = this.cfg.tickets ?? 400;
    this.startTickets = {};
    this.tickets = {};
    for (const id of this.teamIds) {
      this.startTickets[id] = typeof t === 'object' ? t[id] ?? 400 : t;
      this.tickets[id] = this.startTickets[id];
    }
    for (const f of this.flags) {
      f.owner = f.initialOwner;
      f.color = f.initialOwner;
      f.claimant = f.initialOwner;
      f.progress = f.initialOwner ? 1 : 0;
      f.present = {};
      f.units = [];
      f.contested = false;
    }
    this.bleedTimer = 0;
    this.events = [];
    this.result = null; // { winner: id | null (pareggio), losers: [id] }
  }

  /** Avanza catture e calo dei ticket. units = unità con { x, y, team, dead }. */
  update(dt, units) {
    if (this.result) return;
    this.time += dt;

    for (const f of this.flags) {
      f.present = {};
      f.units = [];
      for (const u of units) {
        if (u.dead || !u.team || !this.inZone(f, u.x, u.y)) continue;
        f.present[u.team] = (f.present[u.team] || 0) + 1;
        f.units.push(u);
      }
      const here = Object.keys(f.present);
      f.contested = here.length > 1;
      if (here.length === 1) this._advance(f, here[0], f.present[here[0]], dt);
    }

    // calo periodico dei ticket in base alle bandiere possedute
    const b = this.cfg.bleed || {};
    const interval = b.interval ?? 3;
    if (interval > 0) {
      this.bleedTimer += dt;
      while (this.bleedTimer >= interval) {
        this.bleedTimer -= interval;
        this._bleed(b);
      }
    }
    this._checkResult();
  }

  /** (x, y) è nell'area di cattura della bandiera f (raggio e, se richiesto, linea di vista). */
  inZone(f, x, y) {
    if (Math.hypot(x - f.x, y - f.y) > f.radius) return false;
    return !f.requireSight || this._lineOfSight(f.x, f.y, x, y);
  }

  _advance(f, team, count, dt) {
    const speed = 1 + (count - 1) * f.extraCapturerSpeed;
    if (f.claimant === null) f.claimant = team; // bandiera neutra a terra: la issa chi arriva
    if (f.claimant === team) {
      if (f.progress >= 1) return;
      f.progress = Math.min(1, f.progress + (dt * speed) / f.captureTime);
      if (f.progress >= 1 && f.owner !== team) {
        f.owner = team;
        f.color = team;
        this.events.push({ type: 'captured', flag: f, team });
      }
    } else {
      // la bandiera scende col colore di prima; a terra passa alla squadra che la sta catturando
      f.progress = Math.max(0, f.progress - (dt * speed) / f.neutralizeTime);
      if (f.progress <= 0) {
        const prev = f.owner;
        f.owner = null;
        f.claimant = team;
        if (f.color !== null) f.color = team; // una bandiera già colorata non torna bianca
        if (prev) this.events.push({ type: 'neutralized', flag: f, team: prev, by: team });
      }
    }
  }

  /** Numero di bandiere possedute da ciascuna squadra. */
  flagCounts() {
    const n = {};
    for (const id of this.teamIds) n[id] = 0;
    for (const f of this.flags) if (f.owner) n[f.owner]++;
    return n;
  }

  /**
   * mode "advantage" (default): perde perFlag ticket per ogni bandiera di svantaggio rispetto alla
   * squadra avversaria che ne ha di più; mode "enemyFlags": perFlag per ogni bandiera nemica.
   */
  _bleed(b) {
    const n = this.flagCounts();
    const per = b.perFlag ?? 1;
    for (const id of this.teamIds) {
      const others = this.teamIds.filter((t) => t !== id).map((t) => n[t]);
      const enemy = b.mode === 'enemyFlags' ? others.reduce((s, v) => s + v, 0) : Math.max(0, ...others) - n[id];
      if (enemy > 0) this._take(id, enemy * per);
    }
  }

  _take(team, amount) {
    if (this.tickets[team] === undefined) return;
    this.tickets[team] = Math.max(0, this.tickets[team] - amount);
  }

  /** Un soldato della squadra "team" è morto: costa ticketsPerDeath ticket. */
  onDeath(team) {
    if (this.result) return;
    this._take(team, this.cfg.ticketsPerDeath ?? 1);
    this._checkResult();
  }

  _checkResult() {
    if (this.result) return;
    const losers = this.teamIds.filter((t) => this.tickets[t] <= 0);
    if (!losers.length) return;
    const alive = this.teamIds.filter((t) => this.tickets[t] > 0);
    this.result = { winner: alive.length === 1 ? alive[0] : null, losers };
  }

  /** Eventi (catture/neutralizzazioni) accumulati dall'ultima chiamata. */
  takeEvents() {
    const e = this.events;
    this.events = [];
    return e;
  }

  /**
   * Punto di rientro per "team": tra la base e le bandiere possedute (non contese) il più vicino a
   * "near" (es. dove è morto). Vicino alla bandiera cerca un punto libero per un AABB hw x hh.
   */
  spawnPoint(team, near, hw = 5, hh = 5, opts = {}) {
    const base = this.bases[team] || { x: this.map.pixelWidth / 2, y: this.map.pixelHeight / 2 };
    // bandiere possedute in cui non c'è nessun nemico
    const owned = this.flags.filter((f) => f.owner === team && !Object.keys(f.present).some((t) => t !== team));
    let best = base;
    if (opts.preferFlags && owned.length) {
      // (bot) sempre su una bandiera se ce n'è una: la più vicina a "near", o una a caso
      if (near) {
        let bestD = Infinity;
        for (const f of owned) {
          const d = Math.hypot(f.x - near.x, f.y - near.y);
          if (d < bestD) {
            best = f;
            bestD = d;
          }
        }
      } else best = owned[Math.floor(Math.random() * owned.length)];
    } else if (near) {
      let bestD = Math.hypot(base.x - near.x, base.y - near.y);
      for (const f of owned) {
        const d = Math.hypot(f.x - near.x, f.y - near.y);
        if (d < bestD) {
          best = f;
          bestD = d;
        }
      }
    }
    if (best === base) {
      // opts.spread = [min, max] px: punto libero attorno alla base (più soldati non si sovrappongono)
      return opts.spread ? this._freePoint(base, opts.spread, hw, hh) : { x: base.x, y: base.y };
    }
    return this._freePoint(best, best.spawnDistance, hw, hh);
  }

  /** Punto a distanza [d0, d1] da "c" libero per un AABB hw x hh e in vista di c (o c stesso). */
  _freePoint(c, [d0, d1], hw, hh) {
    for (let i = 0; i < 16; i++) {
      const a = Math.random() * Math.PI * 2;
      const d = d0 + Math.random() * (d1 - d0);
      const x = c.x + Math.cos(a) * d;
      const y = c.y + Math.sin(a) * d;
      if (!this.map.rectHitsSolid(x - hw, y - hh, hw * 2, hh * 2) && this._lineOfSight(c.x, c.y, x, y)) return { x, y };
    }
    return { x: c.x, y: c.y };
  }

  /**
   * Stato della cattura per l'unità "unit" (per l'HUD): null se non è in nessuna area,
   * altrimenti { flag, state }: "contested" | "capturing" | "securing" | "neutralizing" | "held".
   */
  zoneStatus(unit) {
    const f = this.flags.find((fl) => fl.units.includes(unit));
    if (!f) return null;
    let state = 'held';
    if (f.contested) state = 'contested';
    else if (f.claimant !== unit.team) state = 'neutralizing';
    else if (f.progress < 1) state = f.owner === unit.team ? 'securing' : 'capturing';
    return { flag: f, state };
  }

  /** Colori { color, dark } della bandiera (squadra o bianco neutro). */
  flagColors(f) {
    const t = f.color && this.teams[f.color];
    if (t) return { color: t.color, dark: t.dark || t.color };
    return { color: this.look.neutralColor || '#f0f0f0', dark: this.look.neutralDark || '#a8a8b0' };
  }

  _lineOfSight(x0, y0, x1, y1) {
    const n = Math.ceil(Math.hypot(x1 - x0, y1 - y0) / 2);
    for (let i = 1; i < n; i++) {
      const t = i / n;
      if (this.map.blocksShotAt(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t)) return false;
    }
    return true;
  }

  // ---------- Disegno (ctx già traslato in coordinate mondo) ----------

  /** Aree di cattura a terra, del colore della bandiera. */
  drawZones(ctx) {
    if (this.look.showZones === false) return;
    for (const f of this.flags) {
      const c = zoneCanvas(f.radius, this.flagColors(f).color, this.look);
      ctx.drawImage(c, Math.round(f.x - c.width / 2), Math.round(f.y - c.height / 2));
    }
  }

  /** Pennone (visto di lato) con il drappo all'altezza "progress", che sventola. */
  drawFlag(ctx, f) {
    const L = this.look;
    const x = Math.round(f.x);
    const y = Math.round(f.y);
    const H = L.poleHeight ?? 22;
    const cw = L.clothWidth ?? 9;
    const ch = L.clothHeight ?? 6;

    // ombra e basamento
    ctx.fillStyle = L.shadow || 'rgba(0,0,0,0.35)';
    ctx.fillRect(x - 3, y, 8, 2);
    ctx.fillStyle = L.baseColor || '#4a4a56';
    ctx.fillRect(x - 2, y - 1, 5, 2);
    ctx.fillStyle = L.baseLight || '#6a6a78';
    ctx.fillRect(x - 2, y - 1, 5, 1);

    // pennone e pomolo
    ctx.fillStyle = L.poleColor || '#c8c8d0';
    ctx.fillRect(x, y - H, 1, H - 1);
    ctx.fillStyle = L.finial || '#ffd36b';
    ctx.fillRect(x - 1, y - H - 2, 3, 2);

    // drappo: dal basso (progress 0) alla cima (1); colonne sfasate = onda, più ampia verso il bordo libero
    const { color, dark } = this.flagColors(f);
    const top = y - H + 1;
    const bottom = y - 3 - ch;
    const cy = Math.round(bottom + (top - bottom) * f.progress);
    const speed = L.waveSpeed ?? 6;
    const amp = L.wave ?? 1.2;
    for (let i = 0; i < cw; i++) {
      const ph = this.time * speed - i * 0.9;
      const off = Math.round(Math.sin(ph) * amp * (i / cw));
      ctx.fillStyle = Math.cos(ph) < -0.4 ? dark : color;
      ctx.fillRect(x + 1 + i, cy + off, 1, ch);
      ctx.fillStyle = dark;
      ctx.fillRect(x + 1 + i, cy + off + ch - 1, 1, 1);
    }
  }
}
