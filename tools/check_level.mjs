// Controlla un livello: celle percorribili raggiungibili e vicoli ciechi.
// Uso: node tools/check_level.mjs config/levels/level03.json [altri livelli...]
// Esce con codice 1 se trova problemi. Usato anche dai generatori (export checkGrid).
//
// Vicolo cieco = zona percorribile, profonda almeno `depth` tile, raggiungibile da un solo varco: chiuso
// quel varco non resta altra uscita. Si cerca a più "scale" (s = 1..maxScale): alla scala s una cella conta
// come percorribile solo se lo è tutto il blocco s×s, così un varco largo s diventa un punto di articolazione
// del grafo. La zona dietro un'articolazione è un vicolo cieco solo se, chiuso il varco nel grafo originale,
// non trova un'altra uscita (magari più stretta). L'algoritmo sta in js/engine/levelcheck.js.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { checkGrid } from '../js/engine/levelcheck.js';

export { checkGrid }; // algoritmo condiviso con l'editor di mappe (js/engine/levelcheck.js)

/** Griglia percorribile di un livello JSON (solidità dai tile del tileset in assets.json). */
export function walkGrid(level, assets) {
  const tiles = assets.tilesets[level.tileset].tiles;
  const solidTile = (t) => {
    const name = Array.isArray(t) ? t[0] : t;
    const def = tiles.find((d) => d.name === name || d.id === name);
    return !def || def.solid;
  };
  const solidChar = {};
  for (const [ch, v] of Object.entries(level.legend)) solidChar[ch] = solidTile(typeof v === 'object' && !Array.isArray(v) ? v.tile : v);
  const W = Math.max(...level.map.map((r) => r.length));
  return level.map.map((r) => Array.from({ length: W }, (_, x) => {
    const ch = r[x] ?? level.fill;
    return ch in solidChar ? !solidChar[ch] : !solidTile(ch);
  }));
}

/** Stampa il risultato; restituisce true se il livello è a posto. */
export function report(name, walk, result) {
  const W = walk[0].length;
  const H = walk.length;
  const bad = result.unreachable > 0 || result.deadEnds.length > 0;
  console.log(`${name}: ${W}x${H}, unreachable cells: ${result.unreachable}, dead ends: ${result.deadEnds.length}`);
  for (const d of result.deadEnds) {
    console.log(`  dead end (width ${d.scale}) at ${d.x},${d.y}: depth ${d.depth}, ${d.cells} cells, box ${d.box.join(',')}`);
  }
  return !bad;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const assets = JSON.parse(fs.readFileSync(path.resolve('config/assets.json'), 'utf8'));
  let good = true;
  for (const file of process.argv.slice(2)) {
    const level = JSON.parse(fs.readFileSync(file, 'utf8'));
    const walk = walkGrid(level, assets);
    good = report(file, walk, checkGrid(walk)) && good;
  }
  process.exit(good ? 0 : 1);
}
