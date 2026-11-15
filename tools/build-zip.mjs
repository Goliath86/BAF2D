// Crea lo zip per itch.io (progetto HTML, index.html alla radice dello zip):
//   node tools/build-zip.mjs            -> dist/BAF2D-<versione>-html5.zip (versione da config/game.json)
// Contiene solo ciò che serve al gioco nel browser: index.html, editor.html (editor di mappe), manifest, LICENSE, css/, js/, config/, arts/icons/,
// assets/sounds/ (suoni reali CC0 con i crediti).
// Mai assets/licensed/ (asset con licenza: vietata la ridistribuzione). Solo moduli Node built-in: lo zip è scritto
// a mano (tools/ziplib.mjs, deflate di zlib) con percorsi separati da "/" (richiesto dai server Linux come quello di itch.io).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { zipBuffer } from './ziplib.mjs';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const INCLUDE = ['index.html', 'editor.html', 'manifest.webmanifest', 'LICENSE', 'css', 'js', 'config', 'arts/icons', 'assets/sounds'];
const EXCLUDE = [/^assets\/licensed\//];

/** Elenco dei file (percorsi relativi con "/"), in ordine. */
function collect(rel) {
  const abs = path.join(root, rel);
  if (!fs.existsSync(abs)) throw new Error(`Missing: ${rel}`);
  if (fs.statSync(abs).isFile()) return [rel];
  return fs
    .readdirSync(abs)
    .sort()
    .flatMap((name) => collect(`${rel}/${name}`));
}

/** File del gioco da distribuire (percorsi relativi con "/"), anche per la build Windows. */
export function gameFiles() {
  return INCLUDE.flatMap(collect).filter((f) => !EXCLUDE.some((re) => re.test(f)));
}

export function gameInfo() {
  const game = JSON.parse(fs.readFileSync(path.join(root, 'config/game.json'), 'utf8'));
  return { title: game.title || 'game', version: game.version || '0.0.0' };
}

// lanciato direttamente (non importato da build-win.mjs)
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { title, version } = gameInfo();
  const outDir = path.join(root, 'dist');
  const outFile = path.join(outDir, `${title}-${version}-html5.zip`);
  const files = gameFiles();
  const zip = zipBuffer(files.map((rel) => ({ name: rel, data: fs.readFileSync(path.join(root, rel)), mtime: fs.statSync(path.join(root, rel)).mtime })));
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(outFile, zip);
  const kb = (fs.statSync(outFile).size / 1024).toFixed(0);
  console.log(`${path.relative(root, outFile)}: ${files.length} files, ${kb} KB`);
}
