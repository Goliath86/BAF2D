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

/**
 * Sprite con "extends": "<altro sprite>" ereditano la definizione del genitore
 * (frame, origin, animazioni, placeholder fuso campo per campo), tranne "src":
 * ogni sprite ha il proprio file immagine.
 */
function resolveExtends(defs, name, seen = new Set()) {
  const def = defs[name];
  if (!def) throw new LocalizedError('errors.unknownSprite', { name });
  if (!def.extends) return def;
  if (seen.has(name)) {
    throw new LocalizedError('errors.spriteExtendsLoop', { name }, `Circular "extends" in sprite "${name}"`);
  }
  seen.add(name);
  const { src: _src, ...parent } = resolveExtends(defs, def.extends, seen);
  const { extends: _ext, ...own } = def;
  return {
    ...parent,
    ...own,
    src: own.src ?? null,
    placeholder: { ...parent.placeholder, ...own.placeholder },
  };
}

export class Assets {
  constructor() {
    this.sprites = new Map();
    this.tilesets = new Map();
  }

  /**
   * teams (opzionale, da game.json -> "teams"): { id: { color, dark, light } }. Ogni sprite con
   * "teamColored": true genera anche una variante "nome@id" per squadra: il placeholder riceve
   * team/teamDark/teamLight e un "{team}" nel src viene sostituito con l'id della squadra.
   */
  async load(cfg, teams = {}) {
    const jobs = [];
    const sprites = cfg.sprites || {};
    for (const name of Object.keys(sprites)) {
      const def = resolveExtends(sprites, name);
      jobs.push(this._loadSprite(name, def));
      if (!def.teamColored) continue;
      for (const [team, t] of Object.entries(teams)) {
        jobs.push(
          this._loadSprite(`${name}@${team}`, {
            ...def,
            src: def.src ? def.src.replaceAll('{team}', team) : null,
            placeholder: {
              ...def.placeholder,
              team: t.color,
              teamDark: t.dark || t.color,
              teamLight: t.light || t.color,
              // equipaggiamento della squadra (sagoma del soldato procedurale), se lo sprite non lo fissa
              kit: def.placeholder?.kit ?? t.kit,
            },
          })
        );
      }
    }
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
      // varianti di forma in fila nel foglio (frame = variante * frameCount / variants + passo)
      variants: Math.max(1, def.variants ?? def.placeholder?.sheetVariants ?? 1),
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
        shootThrough: !!t.shootThrough, // solido per il movimento ma non per colpi e vista (es. acqua)
        edge: t.edge || null, // bordo verso i tile di un altro gruppo (TileMap._drawEdges)
        terrain: t.terrain || null, // terreno per la fusione dei bordi (tileset.terrains, TileMap._drawBlend)
        height: t.height ?? null, // px della faccia sud (TileMap._drawHeight); null = tileset.height.face
        index: t.index ?? t.id,
        // tipo di impatto in effects.json (default: "wall" se solido, "ground" altrimenti)
        impact: t.impact || (t.solid ? 'wall' : 'ground'),
        // distruzione (game.json -> destruction.materials): materiale e tile che resta al suo posto
        material: t.material || null,
        destroysTo: t.destroysTo || null,
        // colori di crepe e macerie (se il materiale non li fissa): dal tile o dal suo placeholder
        crackColor: t.crack || t.placeholder?.crack || t.placeholder?.dark || t.placeholder?.gap || t.placeholder?.outline || null,
        debrisColors: t.debris || t.placeholder?.colors || [t.placeholder?.color, t.placeholder?.light, t.placeholder?.dark].filter(Boolean),
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
      shadow: def.shadow || null, // ombra proiettata dai tile che bloccano i colpi (TileMap._drawShadows)
      height: def.height || null, // altezza finta dei tile che bloccano i colpi (TileMap._drawHeight)
      scatter: def.scatter || null, // dettagli a terra (js/engine/scatter.js)
      autoProps: def.autoProps || null, // decorazioni sparse in automatico (TileMap: aggiunte a map.props)
      terrains: def.terrains || null, // fusione dei bordi tra terreni (TileMap._drawBlend)
      blend: def.blend || null,
    });
  }

  /** Sprite "name"; con "team" la sua variante di squadra ("name@team") se esiste. */
  sprite(name, team) {
    if (team) {
      const v = this.sprites.get(`${name}@${team}`);
      if (v) return v;
    }
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

  /** Posiziona l'animazione corrente a una frazione 0..1 della sua durata (es. ricarica). */
  setProgress(p) {
    const a = this.sprite.animations[this.name];
    if (!a) return;
    const n = a.frames.length;
    this.time = (Math.min(Math.max(p, 0), 0.9999) * n) / (a.fps || 1);
  }

  get frame() {
    const a = this.sprite.animations[this.name];
    if (!a) return 0;
    const n = a.frames.length;
    const i = ((Math.floor(this.time * (a.fps || 1)) % n) + n) % n;
    return a.frames[i];
  }
}
