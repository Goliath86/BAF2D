// Illustrazioni delle mappe per il menu: anteprima "come in partita" (fusione dei terreni, decorazioni, correzione
// di colore della mappa) e sua versione rimpicciolita con basi e bandiere per le card di "Nuova partita".
// La fusione dei terreni costa: le anteprime ricche si fanno dopo TileMap.prewarm (mappa in cache), una alla volta.

import { TileMap } from './engine/tilemap.js';
import { Props } from './game/props.js';
import { Atmosphere } from './game/atmosphere.js';

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, w);
  c.height = Math.max(1, h);
  return c;
}

/**
 * Mappa intera a grandezza naturale (px di gioco) con decorazioni e correzione di colore.
 * Da una partita (map, props, atmosphere già pronti) oppure da un livello (opts = { assets, config }).
 */
export function mapPicture({ level, map, props, grade, assets, config }) {
  if (!map) map = new TileMap(level, assets.tileset(level.tileset));
  const c = makeCanvas(map.pixelWidth, map.pixelHeight);
  const g = c.getContext('2d');
  g.imageSmoothingEnabled = false;
  g.drawImage(map.canvas, 0, 0);
  if (!props && assets) {
    props = new Props(config?.props, assets);
    props.reset(map);
  }
  const view = { x: 0, y: 0, w: c.width, h: c.height };
  props?.drawGround(g, view, null);
  props?.drawOverhead(g, view, null);
  const atm = new Atmosphere(config?.atmosphere || {});
  atm.setGrade(grade ?? atm.gradeFor(level, null));
  atm.drawGrade(g, c.width, c.height);
  return { canvas: c, map };
}

/**
 * Anteprima per la card: "k" px per tile, rimpicciolita con lo smussamento (i dettagli diventano tinte), poi
 * basi e bandiere a pixel netti. Disegnata su "target" se dato (stesso canvas della card: si aggiorna sul posto).
 */
export function mapThumb({ level, map, picture, k, teams = {}, neutral = '#f0f0f0', target = null }) {
  const c = target || makeCanvas(map.cols * k, map.rows * k);
  c.width = map.cols * k;
  c.height = map.rows * k;
  const g = c.getContext('2d');
  g.imageSmoothingEnabled = true;
  g.imageSmoothingQuality = 'high';
  g.drawImage(picture || map.canvas, 0, 0, c.width, c.height);
  g.imageSmoothingEnabled = false;
  const dot = (x, y, size, color) => {
    const px = Math.round((x / map.size) * k - size / 2);
    const py = Math.round((y / map.size) * k - size / 2);
    g.fillStyle = '#0b0b12';
    g.fillRect(px - 1, py - 1, size + 2, size + 2);
    g.fillStyle = color;
    g.fillRect(px, py, size, size);
  };
  for (const [team, p] of Object.entries(map.spawns)) dot(p.x, p.y, k + 2, teams[team]?.color || '#fff');
  const owners = level.flags || {};
  for (const f of map.flags) dot(f.x, f.y, k, teams[owners[f.id]?.owner]?.light || neutral);
  c.dataset.cols = map.cols;
  c.dataset.rows = map.rows;
  c.dataset.flags = map.flags.length;
  return c;
}
