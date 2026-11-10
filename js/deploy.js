// Schermata di rientro: dopo la morte del giocatore, mappa tattica con i punti di rientro (base, bandiere
// possedute, compagni di squadra) e conferma. La partita continua sotto (i bot combattono).
// Dati da Game (deployOptions, chooseDeploy, deployWait); aperta/chiusa da Menu tramite game.onDeployOpen/Close.
// Tasti: 1..9 = scegli, frecce su/giù = scorri, Invio/Spazio = rientra. Tocco/clic sulla mappa = scegli il punto più vicino.

const $ = (id) => document.getElementById(id);

export class DeployScreen {
  constructor({ game, i18n }) {
    this.game = game;
    this.i18n = i18n;
    this.root = $('overlay-deploy');
    this.canvas = $('deploy-map');
    this.list = $('deploy-list');
    this.timer = $('deploy-timer');
    this.killed = $('deploy-killed');
    this.go = $('deploy-go');
    this.visible = false;
    this.options = [];
    this.buttons = new Map(); // id -> bottone della lista
    this.listKey = '';
    this.raf = 0;

    // niente stick né spari sotto la schermata
    this.root.addEventListener('pointerdown', (e) => e.stopPropagation());
    this.go.addEventListener('click', () => this.confirm());
    this.canvas.addEventListener('click', (e) => this._onMapClick(e));
    this._onKey = this._onKey.bind(this);
  }

  open() {
    if (this.visible) return;
    this.visible = true;
    this.listKey = '';
    this.root.classList.remove('hidden');
    window.addEventListener('keydown', this._onKey);
    const loop = () => {
      if (!this.visible) return;
      this._frame();
      this.raf = requestAnimationFrame(loop);
    };
    loop();
  }

  close() {
    if (!this.visible) return;
    this.visible = false;
    cancelAnimationFrame(this.raf);
    this.root.classList.add('hidden');
    window.removeEventListener('keydown', this._onKey);
    document.activeElement?.blur?.();
  }

  /** Rientra (appena il conto alla rovescia finisce) nel punto scelto. */
  confirm() {
    const r = this.game.respawn;
    if (!r) return;
    const o = this.options.find((x) => x.id === r.choice);
    if (!o?.ok) return;
    this.game.chooseDeploy(r.choice, true);
  }

  select(id) {
    const o = this.options.find((x) => x.id === id);
    if (!o?.ok) return;
    this.game.chooseDeploy(id, !!this.game.respawn?.confirmed);
  }

  _onKey(e) {
    if (!this.visible || e.repeat) return;
    const enabled = this.options.filter((o) => o.ok);
    const r = this.game.respawn;
    if (/^Digit[1-9]$/.test(e.code) || /^Numpad[1-9]$/.test(e.code)) {
      const o = this.options[Number(e.code.slice(-1)) - 1];
      if (o) this.select(o.id);
      e.preventDefault();
    } else if ((e.code === 'ArrowDown' || e.code === 'ArrowUp') && enabled.length) {
      const i = enabled.findIndex((o) => o.id === r?.choice);
      const next = enabled[(i + (e.code === 'ArrowDown' ? 1 : -1) + enabled.length) % enabled.length];
      this.select(next.id);
      e.preventDefault();
    } else if (e.code === 'Enter' || e.code === 'NumpadEnter' || e.code === 'Space') {
      this.confirm();
      e.preventDefault();
    }
  }

  _onMapClick(e) {
    const rect = this.canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    let best = null;
    let bestD = 26; // px CSS
    for (const o of this.options) {
      if (!o.ok) continue;
      const [ox, oy] = this._toCss(o.x, o.y);
      const d = Math.hypot(ox - x, oy - y);
      if (d < bestD) {
        bestD = d;
        best = o;
      }
    }
    if (!best) return;
    // secondo tocco sullo stesso punto = rientra
    if (this.game.respawn?.choice === best.id) this.confirm();
    else this.select(best.id);
  }

  _frame() {
    const g = this.game;
    const r = g.respawn;
    if (!r) return;
    const t = (k, p) => this.i18n.t(k, p);
    // scelta non più disponibile (bandiera persa, compagno morto): torna al punto predefinito
    this.options = g.deployOptions();
    if (!this.options.some((o) => o.id === r.choice && o.ok)) g.chooseDeploy(g._defaultDeploy(), r.confirmed);
    this._renderList(r);
    const wait = g.deployWait;
    this.killed.textContent = r.killer ? t('deploy.killedBy', { name: r.killer, how: r.how ? ` [${r.how}]` : '' }) : t('hud.killed');
    if (wait > 0) {
      this.timer.textContent = t('deploy.wait', { seconds: Math.ceil(wait) });
      this.go.textContent = r.confirmed ? t('deploy.waiting', { seconds: Math.ceil(wait) }) : t('deploy.go');
    } else {
      this.timer.textContent = t('deploy.ready');
      this.go.textContent = t('deploy.go');
    }
    this._drawMap(r);
  }

  /** Lista dei punti: ricostruita solo quando cambiano i punti o la loro disponibilità. */
  _renderList(r) {
    const key = this.options.map((o) => `${o.id}:${o.ok ? 1 : 0}:${o.reason || ''}`).join('|');
    if (key !== this.listKey) {
      this.listKey = key;
      this.list.textContent = '';
      this.buttons.clear();
      this.options.forEach((o, i) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'deploy-option';
        b.disabled = !o.ok;
        const k = document.createElement('span');
        k.className = 'deploy-key';
        k.textContent = i < 9 ? String(i + 1) : '';
        const mark = document.createElement('span');
        mark.className = 'deploy-mark';
        mark.style.background = this._color(o);
        const name = document.createElement('span');
        name.textContent = o.label;
        b.append(k, mark, name);
        if (o.reason) {
          const why = document.createElement('span');
          why.className = 'deploy-reason';
          why.textContent = this.i18n.t(o.reason);
          b.append(why);
        }
        b.addEventListener('click', () => {
          if (this.game.respawn?.choice === o.id) this.confirm();
          else this.select(o.id);
        });
        this.list.append(b);
        this.buttons.set(o.id, b);
      });
    }
    for (const [id, b] of this.buttons) b.setAttribute('aria-pressed', String(id === r.choice));
  }

  /** Colore del segno di un punto: base e bandiere col colore della squadra, compagni col colore della squadra del giocatore. */
  _color(o) {
    const g = this.game;
    if (o.kind === 'mate') return g.squadCfg.color || '#7cf07c';
    return g.teams[g.playerTeam]?.color || '#4af';
  }

  /** Coordinate del mondo -> px CSS sul canvas della mappa. */
  _toCss(x, y) {
    const v = this.view;
    if (!v) return [0, 0];
    return [x * v.k, y * v.k];
  }

  _drawMap(r) {
    const g = this.game;
    const map = g.map;
    if (!map) return;
    const box = this.canvas.parentElement.getBoundingClientRect();
    // canvas grande quanto lo spazio disponibile mantenendo le proporzioni della mappa
    const k = Math.max(0.1, Math.min(box.width / map.pixelWidth, box.height / map.pixelHeight));
    const cw = Math.floor(map.pixelWidth * k);
    const ch = Math.floor(map.pixelHeight * k);
    const dpr = window.devicePixelRatio || 1;
    if (this.canvas.width !== Math.round(cw * dpr) || this.canvas.height !== Math.round(ch * dpr)) {
      this.canvas.width = Math.round(cw * dpr);
      this.canvas.height = Math.round(ch * dpr);
      this.canvas.style.width = `${cw}px`;
      this.canvas.style.height = `${ch}px`;
    }
    this.view = { k };
    const c = this.canvas.getContext('2d');
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.imageSmoothingEnabled = true;
    c.drawImage(map.canvas, 0, 0, cw, ch);
    c.fillStyle = 'rgba(5,5,12,0.25)';
    c.fillRect(0, 0, cw, ch);
    const P = (x, y) => [x * k, y * k];
    const teams = g.teams;
    const font = `bold ${Math.max(10, Math.round(12 * Math.min(1.4, k * 2)))}px "Courier New", monospace`;
    c.font = font;
    c.textAlign = 'center';
    c.textBaseline = 'middle';

    // nemici avvistati dalla squadra (ultimi secondi)
    const mm = g.hud?.cfg?.minimap || {};
    for (const [e, kk] of g.squads[g.playerTeam]?.contacts || []) {
      if (e.dead || e.destroyed || g.time - kk.time > (mm.enemyMemory ?? 3)) continue;
      const [x, y] = P(kk.x, kk.y);
      c.fillStyle = mm.enemy || '#ff4a3a';
      c.fillRect(x - 2.5, y - 2.5, 5, 5);
    }
    // compagni (non di squadra)
    for (const b of g.bots) {
      const u = b.unit;
      if (!u || u.dead || u.team !== g.playerTeam || b.playerSquad) continue;
      const [x, y] = P(u.x, u.y);
      c.fillStyle = teams[g.playerTeam]?.color || '#4af';
      c.fillRect(x - 2, y - 2, 4, 4);
    }
    // bandiere: quadrato col colore del proprietario e lettera
    for (const f of g.ctf.flags) {
      const [x, y] = P(f.x, f.y);
      const s = 9;
      c.fillStyle = '#000';
      c.fillRect(x - s + 1, y - s + 1, s * 2, s * 2);
      c.fillStyle = f.owner ? teams[f.owner].color : '#e8e8e8';
      c.fillRect(x - s, y - s, s * 2, s * 2);
      c.fillStyle = f.owner ? '#fff' : '#222';
      c.fillText(f.id, x, y + 1);
      if (f.contested) {
        c.strokeStyle = '#ffd36b';
        c.lineWidth = 2;
        c.strokeRect(x - s - 3, y - s - 3, s * 2 + 6, s * 2 + 6);
      }
    }
    // punti di rientro: base e compagni (le bandiere sono già disegnate), scelto evidenziato
    for (const o of this.options) {
      const [x, y] = P(o.x, o.y);
      if (o.kind === 'base') {
        c.fillStyle = '#000';
        c.fillRect(x - 7, y - 5, 16, 12);
        c.fillStyle = this._color(o);
        c.fillRect(x - 8, y - 6, 16, 12);
        c.fillStyle = '#fff';
        c.fillText(this.i18n.t('deploy.baseShort'), x, y + 1);
      } else if (o.kind === 'mate' && o.unit && !o.unit.dead) {
        c.beginPath();
        c.arc(x, y, 5, 0, Math.PI * 2);
        c.fillStyle = o.ok ? this._color(o) : 'rgba(124,240,124,0.35)';
        c.fill();
        c.lineWidth = 1.5;
        c.strokeStyle = '#000';
        c.stroke();
      }
      if (o.id === r.choice) {
        const pulse = 14 + Math.sin(performance.now() / 160) * 2;
        c.beginPath();
        c.arc(x, y, pulse, 0, Math.PI * 2);
        c.lineWidth = 2.5;
        c.strokeStyle = '#ffd36b';
        c.stroke();
      }
    }
    // dove è morto
    const [dx, dy] = P(r.x, r.y);
    c.strokeStyle = '#e8463a';
    c.lineWidth = 2.5;
    c.beginPath();
    c.moveTo(dx - 5, dy - 5);
    c.lineTo(dx + 5, dy + 5);
    c.moveTo(dx + 5, dy - 5);
    c.lineTo(dx - 5, dy + 5);
    c.stroke();
  }
}
