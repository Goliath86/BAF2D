// Gestione sprite e tileset definiti in assets.json.

import { loadImage } from './loader.js';
import { LocalizedError } from './errors.js';
import { createSpritePlaceholder, createTilesetPlaceholder } from './placeholders.js';

async function tryLoadImage(src) {
  if (!src) return null;
  try {
    return await loadImage(src);
  } catch (e) {
    console.warn(`${e.message} -> uso placeholder`);
    return null;
  }
}

export class Assets {
  constructor() {
    this.sprites = new Map();
    this.tilesets = new Map();
  }

  async load(cfg) {
    const jobs = [];
    for (const [name, def] of Object.entries(cfg.sprites || {})) jobs.push(this._loadSprite(name, def));
    for (const [name, def] of Object.entries(cfg.tilesets || {})) jobs.push(this._loadTileset(name, def));
    await Promise.all(jobs);
  }

  async _loadSprite(name, def) {
    const image = (await tryLoadImage(def.src)) || createSpritePlaceholder(def);
    const fw = def.frameWidth || image.width;
    const fh = def.frameHeight || image.height;
    const cols = Math.max(1, Math.floor(image.width / fw));
    this.sprites.set(name, {
      name,
      image,
      fw,
      fh,
      cols,
      frameCount: cols * Math.max(1, Math.floor(image.height / fh)),
      origin: def.origin || [fw / 2, fh / 2],
      animations: def.animations || { default: { frames: [0], fps: 1 } },
    });
  }

  async _loadTileset(name, def) {
    const image = (await tryLoadImage(def.src)) || createTilesetPlaceholder(def);
    const size = def.tileSize || 16;
    const byId = new Map();
    const byName = new Map();
    for (const t of def.tiles || []) {
      const tile = {
        id: t.id,
        name: t.name,
        solid: !!t.solid,
        index: t.index ?? t.id,
        // tipo di impatto in effects.json (default: "wall" se solido, "ground" altrimenti)
        impact: t.impact || (t.solid ? 'wall' : 'ground'),
      };
      byId.set(t.id, tile);
      if (t.name) byName.set(t.name, tile);
    }
    this.tilesets.set(name, {
      name,
      image,
      size,
      cols: Math.max(1, Math.floor(image.width / size)),
      byId,
      byName,
    });
  }

  sprite(name) {
    const s = this.sprites.get(name);
    if (!s) throw new LocalizedError('errors.unknownSprite', { name });
    return s;
  }

  tileset(name) {
    const t = this.tilesets.get(name);
    if (!t) throw new LocalizedError('errors.unknownTileset', { name });
    return t;
  }
}

/** Disegna un frame di uno sprite centrato sulla sua origin, con rotazione opzionale. */
export function drawSprite(ctx, sprite, frame, x, y, angle = 0) {
  const sx = (frame % sprite.cols) * sprite.fw;
  const sy = Math.floor(frame / sprite.cols) * sprite.fh;
  ctx.save();
  ctx.translate(Math.round(x), Math.round(y));
  if (angle) ctx.rotate(angle);
  ctx.drawImage(sprite.image, sx, sy, sprite.fw, sprite.fh, -sprite.origin[0], -sprite.origin[1], sprite.fw, sprite.fh);
  ctx.restore();
}

/** Riproduce le animazioni definite nello sprite. */
export class Animator {
  constructor(sprite, initial) {
    this.sprite = sprite;
    this.name = null;
    this.time = 0;
    this.play(initial || Object.keys(sprite.animations)[0]);
  }

  play(name) {
    if (this.name === name || !this.sprite.animations[name]) return;
    this.name = name;
    this.time = 0;
  }

  /** dt negativo = animazione all'indietro (es. camminata in retromarcia). */
  update(dt) {
    this.time += dt;
  }

  get frame() {
    const a = this.sprite.animations[this.name];
    if (!a) return 0;
    const n = a.frames.length;
    const i = ((Math.floor(this.time * (a.fps || 1)) % n) + n) % n;
    return a.frames[i];
  }
}
