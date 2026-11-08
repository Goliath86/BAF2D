// Vista dell'editor: la mappa disegnata su un canvas offscreen (1 pixel = 1 pixel di gioco, aggiornato per cella)
// e mostrata sul canvas dell'editor con zoom e spostamento; sopra: anteprima reale (TileMap con bordi e ombre),
// oggetti, griglia, simmetria, risultati del controllo e anteprima dello strumento.

import { drawSprite } from '../engine/assets.js';

export class MapView {
  /**
   * env = { assets, config (game.json), vehicleTypes (vehicles.json -> vehicles), weapons (weapons.json -> weapons) }
   */
  constructor(canvas, env) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.env = env;
    this.cfg = env.config.editor || {};
    this.colors = this.cfg.colors || {};
    this.zoom = 1;
    this.offX = 0;
    this.offY = 0;
    this.dpr = 1;
    this.map = null;
    this.tileset = null;
    this.mapCanvas = null;
    this.preview = null; // canvas pre-renderizzato del TileMap (modalità anteprima)
    this._dirty = true;
    this._raf = 0;
    this.state = {};
    new ResizeObserver(() => this.resize()).observe(canvas);
    this.resize();
  }

  get tileSize() {
    return this.tileset?.size || 16;
  }

  resize() {
    const r = this.canvas.getBoundingClientRect();
    this.dpr = window.devicePixelRatio || 1;
    this.width = r.width;
    this.height = r.height;
    this.canvas.width = Math.max(1, Math.round(r.width * this.dpr));
    this.canvas.height = Math.max(1, Math.round(r.height * this.dpr));
    this.invalidate();
  }

  /** Nuova mappa (o dimensioni / tileset cambiati): ridisegna tutto il canvas offscreen. */
  setMap(map, tileset) {
    this.map = map;
    this.tileset = tileset;
    const s = this.tileSize;
    this.mapCanvas = document.createElement('canvas');
    this.mapCanvas.width = map.cols * s;
    this.mapCanvas.height = map.rows * s;
    this.mapCtx = this.mapCanvas.getContext('2d');
    this.mapCtx.imageSmoothingEnabled = false;
    for (let y = 0; y < map.rows; y++) for (let x = 0; x < map.cols; x++) this.drawCell(x, y);
    this.invalidate();
  }

  drawCell(x, y) {
    const ts = this.tileset;
    const s = this.tileSize;
    const tile = ts.byName.get(this.map.resolvedName(x, y));
    this.mapCtx.clearRect(x * s, y * s, s, s);
    if (!tile) return;
    this.mapCtx.drawImage(ts.image, (tile.index % ts.cols) * s, Math.floor(tile.index / ts.cols) * s, s, s, x * s, y * s, s, s);
  }

  /** Ridisegna le celle con gli indici dati (una cella, una pennellata, un riempimento). */
  drawCells(indices) {
    for (const i of indices) this.drawCell(i % this.map.cols, Math.floor(i / this.map.cols));
    this.invalidate();
  }

  invalidate() {
    if (this._raf) return;
    this._raf = requestAnimationFrame(() => {
      this._raf = 0;
      this.render();
    });
  }

  // ---------- Coordinate ----------

  /** Da px CSS del canvas a pixel di gioco. */
  toWorld(cx, cy) {
    return { x: (cx - this.offX) / this.zoom, y: (cy - this.offY) / this.zoom };
  }

  cellAt(cx, cy) {
    const w = this.toWorld(cx, cy);
    return { x: Math.floor(w.x / this.tileSize), y: Math.floor(w.y / this.tileSize) };
  }

  /** Zoom a un valore della lista (game.json -> editor.zoom.levels) tenendo fermo il punto (cx, cy). */
  setZoom(z, cx = this.width / 2, cy = this.height / 2) {
    const w = this.toWorld(cx, cy);
    this.zoom = z;
    this.offX = Math.round(cx - w.x * z);
    this.offY = Math.round(cy - w.y * z);
    this.invalidate();
  }

  /** Zoom più grande che fa stare la mappa intera, centrata. */
  fit() {
    if (!this.map) return;
    const levels = this.cfg.zoom?.levels || [1];
    const pw = this.map.cols * this.tileSize;
    const ph = this.map.rows * this.tileSize;
    let z = levels[0];
    for (const l of levels) if (pw * l <= this.width - 24 && ph * l <= this.height - 24) z = l;
    this.zoom = z;
    this.offX = Math.round((this.width - pw * z) / 2);
    this.offY = Math.round((this.height - ph * z) / 2);
    this.invalidate();
  }

  /** Centra la vista sulla cella (x, y). */
  centerOn(x, y) {
    const s = this.tileSize;
    this.offX = Math.round(this.width / 2 - (x + 0.5) * s * this.zoom);
    this.offY = Math.round(this.height / 2 - (y + 0.5) * s * this.zoom);
    this.invalidate();
  }

  pan(dx, dy) {
    this.offX += dx;
    this.offY += dy;
    this.invalidate();
  }

  // ---------- Disegno ----------

  render() {
    const { ctx, map, dpr } = this;
    const st = this.state;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = this.colors.outside || '#06060c';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    if (!map || !this.mapCanvas) return;
    const s = this.tileSize;
    const z = this.zoom;
    const world = () => ctx.setTransform(dpr * z, 0, 0, dpr * z, dpr * this.offX, dpr * this.offY);
    const screen = () => ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    world();
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = map.meta.background || '#000';
    ctx.fillRect(0, 0, map.cols * s, map.rows * s);
    ctx.drawImage(st.preview && this.preview ? this.preview : this.mapCanvas, 0, 0);

    // celle irraggiungibili (controllo)
    if (st.check?.unreachableCells?.length) {
      ctx.fillStyle = this.colors.unreachable || 'rgba(255,40,40,0.35)';
      for (const i of st.check.unreachableCells) ctx.fillRect((i % map.cols) * s, Math.floor(i / map.cols) * s, s, s);
    }

    if (st.showObjects !== false) this._drawObjects(ctx);

    // griglia (in px dello schermo, linee nette)
    screen();
    if (st.showGrid && s * z >= 6) this._drawGrid(ctx);

    // vicoli ciechi
    if (st.check?.deadEnds?.length) {
      ctx.strokeStyle = this.colors.deadEnd || '#ff6a3a';
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 4]);
      for (const d of st.check.deadEnds) {
        const [x0, y0, x1, y1] = d.box;
        ctx.strokeRect(this.offX + x0 * s * z, this.offY + y0 * s * z, (x1 - x0 + 1) * s * z, (y1 - y0 + 1) * s * z);
      }
      ctx.setLineDash([]);
    }

    // asse / centro della simmetria
    if (st.symmetry && st.symmetry !== 'none') this._drawSymmetry(ctx);

    // anteprima dello strumento (rettangolo, linea) e cella sotto il cursore con l'ingombro del pennello
    const cell = (x, y, color, fill) => {
      const px = this.offX + x * s * z;
      const py = this.offY + y * s * z;
      if (fill) {
        ctx.fillStyle = fill;
        ctx.fillRect(px, py, s * z, s * z);
      }
      if (color) {
        ctx.strokeStyle = color;
        ctx.lineWidth = 1;
        ctx.strokeRect(px + 0.5, py + 0.5, s * z - 1, s * z - 1);
      }
    };
    if (st.toolCells?.length) {
      for (const c of st.toolCells) cell(c.x, c.y, null, this.colors.selection || 'rgba(255,211,107,0.25)');
    }
    if (st.hoverCells?.length) {
      for (const c of st.hoverCells) cell(c.x, c.y, this.colors.hover || '#ffd36b', null);
    }

    // bordo della mappa
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 1;
    ctx.strokeRect(this.offX - 0.5, this.offY - 0.5, map.cols * s * z + 1, map.rows * s * z + 1);
  }

  _drawGrid(ctx) {
    const { map } = this;
    const s = this.tileSize * this.zoom;
    const every = this.colors.gridMajorEvery || 8;
    const x0 = Math.max(0, Math.floor(-this.offX / s));
    const x1 = Math.min(map.cols, Math.ceil((this.width - this.offX) / s));
    const y0 = Math.max(0, Math.floor(-this.offY / s));
    const y1 = Math.min(map.rows, Math.ceil((this.height - this.offY) / s));
    for (const major of [false, true]) {
      ctx.beginPath();
      for (let x = x0; x <= x1; x++) {
        if ((x % every === 0) !== major) continue;
        const px = Math.round(this.offX + x * s) + 0.5;
        ctx.moveTo(px, this.offY + y0 * s);
        ctx.lineTo(px, this.offY + y1 * s);
      }
      for (let y = y0; y <= y1; y++) {
        if ((y % every === 0) !== major) continue;
        const py = Math.round(this.offY + y * s) + 0.5;
        ctx.moveTo(this.offX + x0 * s, py);
        ctx.lineTo(this.offX + x1 * s, py);
      }
      ctx.strokeStyle = major ? this.colors.gridMajor || 'rgba(255,255,255,0.18)' : this.colors.grid || 'rgba(255,255,255,0.08)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }

  _drawSymmetry(ctx) {
    const { map } = this;
    const s = this.tileSize * this.zoom;
    const cx = this.offX + (map.cols * s) / 2;
    const cy = this.offY + (map.rows * s) / 2;
    ctx.strokeStyle = this.colors.symmetry || 'rgba(63,169,245,0.6)';
    ctx.lineWidth = 2;
    ctx.setLineDash([8, 6]);
    ctx.beginPath();
    const mode = this.state.symmetry;
    if (mode === 'horizontal') {
      ctx.moveTo(cx, this.offY);
      ctx.lineTo(cx, this.offY + map.rows * s);
    } else if (mode === 'vertical') {
      ctx.moveTo(this.offX, cy);
      ctx.lineTo(this.offX + map.cols * s, cy);
    } else {
      ctx.arc(cx, cy, 10, 0, Math.PI * 2);
      ctx.moveTo(cx - 16, cy);
      ctx.lineTo(cx + 16, cy);
      ctx.moveTo(cx, cy - 16);
      ctx.lineTo(cx, cy + 16);
    }
    ctx.stroke();
    ctx.setLineDash([]);
  }

  /** Oggetti in coordinate di gioco (il contesto è già trasformato). */
  _drawObjects(ctx) {
    const { map } = this;
    const { assets, config } = this.env;
    const s = this.tileSize;
    const teams = config.teams || {};
    const look = config.ctf?.look || {};
    const flagCfg = config.ctf?.flag || {};
    const labels = [];
    const layers = { ground: [], overhead: [] };
    for (const [i, o] of map.objects) {
      const x = (i % map.cols + 0.5) * s;
      const y = (Math.floor(i / map.cols) + 0.5) * s;
      if (o.kind === 'prop') {
        const def = config.props?.types?.[o.type];
        (def?.layer === 'overhead' ? layers.overhead : layers.ground).push({ o, x, y, def });
        continue;
      }
      layers.ground.push({ o, x, y });
    }
    const sprite = (name, team) => {
      try {
        return name ? assets.sprite(name, team) : null;
      } catch (e) {
        return null;
      }
    };
    const marker = (x, y, color, r = 3) => {
      ctx.fillStyle = '#000';
      ctx.fillRect(x - r - 1, y - r - 1, r * 2 + 2, r * 2 + 2);
      ctx.fillStyle = color;
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
    };

    for (const { o, x, y, def } of layers.ground) {
      if (o.kind === 'prop') {
        const sp = sprite(def?.sprite || o.type);
        if (sp) drawSprite(ctx, sp, 0, x, y, 0);
        else marker(x, y, '#7ac46a');
      } else if (o.kind === 'pickup') {
        const pdef = config.pickups?.types?.[o.type];
        const wdef = pdef?.weapon ? this.env.weapons?.[pdef.weapon] : null;
        const sp = sprite(wdef?.pickupSprite || (pdef?.grenades ? config.pickups?.grenadeSprite : null));
        if (config.pickups?.pad) {
          const p = config.pickups.padSize ?? 12;
          ctx.fillStyle = config.pickups.padColor || 'rgba(255,211,107,0.35)';
          ctx.fillRect(x - p / 2, y - p / 2, p, p);
        }
        if (sp) drawSprite(ctx, sp, 0, x, y, pdef?.angle ?? 0);
        else marker(x, y, '#ffd36b');
      } else if (o.kind === 'vehicle') {
        const vdef = this.env.vehicleTypes?.[o.type];
        const a = ((o.angleDeg ?? 0) * Math.PI) / 180;
        const body = sprite(vdef?.sprite, o.team);
        if (body) {
          drawSprite(ctx, body, 0, x, y, a);
          const tur = sprite(vdef.turretSprite);
          if (tur) {
            const [px, py] = vdef.turretPivot || [0, 0];
            drawSprite(ctx, tur, 0, x + Math.cos(a) * px - Math.sin(a) * py, y + Math.sin(a) * px + Math.cos(a) * py, a);
          }
          const rot = sprite(vdef.rotorSprite);
          if (rot) {
            const [px, py] = vdef.rotorPivot || [0, 0];
            ctx.globalAlpha = 0.6;
            drawSprite(ctx, rot, 0, x + Math.cos(a) * px - Math.sin(a) * py, y + Math.sin(a) * px + Math.cos(a) * py, 0.4);
            ctx.globalAlpha = 1;
          }
        } else marker(x, y, '#8ac4e8', 6);
        marker(x, y, teams[o.team]?.color || '#c8c8d0', 2);
      } else if (o.kind === 'spawn') {
        const color = teams[o.team]?.color || '#fff';
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(x, y, 10, 0, Math.PI * 2);
        ctx.stroke();
        const sp = sprite(config.player?.sprite || 'soldier_rifle', o.team);
        if (sp) drawSprite(ctx, sp, 0, x, y, o.team === map.teams[1] ? Math.PI : 0);
        else marker(x, y, color, 4);
      } else if (o.kind === 'flag') {
        const f = map.flags[o.id] || {};
        const owner = teams[f.owner];
        const color = owner?.color || look.neutralColor || '#f0f0f0';
        // area di cattura
        const r = f.radius ?? flagCfg.radius ?? 32;
        ctx.save();
        ctx.globalAlpha = 0.12;
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 0.7;
        ctx.strokeStyle = color;
        ctx.lineWidth = 1 / this.zoom;
        ctx.setLineDash([4, 3]);
        ctx.stroke();
        ctx.restore();
        // pennone e drappo
        const h = look.poleHeight ?? 22;
        ctx.fillStyle = look.baseColor || '#4a4a56';
        ctx.fillRect(x - 3, y - 1, 6, 3);
        ctx.fillStyle = look.poleColor || '#c8c8d0';
        ctx.fillRect(x - 0.5, y - h, 1, h);
        ctx.fillStyle = look.finial || '#ffd36b';
        ctx.fillRect(x - 1, y - h - 1, 2, 2);
        ctx.fillStyle = color;
        ctx.fillRect(x + 0.5, y - h + 1, look.clothWidth ?? 9, look.clothHeight ?? 6);
        labels.push({ text: o.id, x: x - 6, y: y - h + 4 });
      }
    }
    for (const { o, x, y, def } of layers.overhead) {
      const sp = sprite(def?.sprite || o.type);
      ctx.globalAlpha = 0.85;
      if (sp) drawSprite(ctx, sp, 0, x, y, 0);
      else marker(x, y, '#3f7a2e', 5);
      ctx.globalAlpha = 1;
    }
    // lettere delle bandiere: in px dello schermo per restare leggibili a ogni zoom
    if (labels.length) {
      const { dpr } = this;
      ctx.save();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.font = 'bold 13px "Courier New", monospace';
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      for (const l of labels) {
        const px = this.offX + l.x * this.zoom;
        const py = this.offY + l.y * this.zoom;
        ctx.fillStyle = '#000';
        ctx.fillText(l.text, px + 1, py + 1);
        ctx.fillStyle = '#ffd36b';
        ctx.fillText(l.text, px, py);
      }
      ctx.restore();
    }
  }
}
