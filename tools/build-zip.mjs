// Crea lo zip per itch.io (progetto HTML, index.html alla radice dello zip):
//   node tools/build-zip.mjs            -> dist/BAF2D-<versione>-html5.zip (versione da config/game.json)
// Contiene solo ciò che serve al gioco nel browser: index.html, editor.html (editor di mappe), manifest, LICENSE, css/, js/, config/, arts/icons/.
// Mai assets/licensed/ (asset con licenza: vietata la ridistribuzione). Solo moduli Node built-in: lo zip è scritto
// a mano (deflate di zlib) con percorsi separati da "/" (richiesto dai server Linux come quello di itch.io).

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const INCLUDE = ['index.html', 'editor.html', 'manifest.webmanifest', 'LICENSE', 'css', 'js', 'config', 'arts/icons'];
const EXCLUDE = [/^assets\/licensed\//];

const game = JSON.parse(fs.readFileSync(path.join(root, 'config/game.json'), 'utf8'));
const version = game.version || '0.0.0';
const outDir = path.join(root, 'dist');
const outFile = path.join(outDir, `${game.title || 'game'}-${version}-html5.zip`);

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

const files = INCLUDE.flatMap(collect).filter((f) => !EXCLUDE.some((re) => re.test(f)));

/** Data e ora in formato DOS. */
function dosTime(d) {
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2);
  const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return { time, date };
}

const locals = [];
const centrals = [];
let offset = 0;
for (const rel of files) {
  const data = fs.readFileSync(path.join(root, rel));
  const deflated = zlib.deflateRawSync(data, { level: 9 });
  // file già compressi (png) o piccoli: "store" se il deflate non conviene
  const stored = deflated.length >= data.length;
  const body = stored ? data : deflated;
  const crc = zlib.crc32(data);
  const name = Buffer.from(rel, 'utf8');
  const { time, date } = dosTime(fs.statSync(path.join(root, rel)).mtime);

  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4); // versione necessaria
  local.writeUInt16LE(0x0800, 6); // nomi in UTF-8
  local.writeUInt16LE(stored ? 0 : 8, 8);
  local.writeUInt16LE(time, 10);
  local.writeUInt16LE(date, 12);
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(body.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(name.length, 26);
  local.writeUInt16LE(0, 28);
  locals.push(local, name, body);

  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4); // creato da
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(0x0800, 8);
  central.writeUInt16LE(stored ? 0 : 8, 10);
  central.writeUInt16LE(time, 12);
  central.writeUInt16LE(date, 14);
  central.writeUInt32LE(crc, 16);
  central.writeUInt32LE(body.length, 20);
  central.writeUInt32LE(data.length, 24);
  central.writeUInt16LE(name.length, 28);
  central.writeUInt32LE(offset, 42);
  centrals.push(central, name);

  offset += local.length + name.length + body.length;
}

const centralSize = centrals.reduce((s, b) => s + b.length, 0);
const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0);
end.writeUInt16LE(files.length, 8);
end.writeUInt16LE(files.length, 10);
end.writeUInt32LE(centralSize, 12);
end.writeUInt32LE(offset, 16);

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(outFile, Buffer.concat([...locals, ...centrals, end]));
const kb = (fs.statSync(outFile).size / 1024).toFixed(0);
console.log(`${path.relative(root, outFile)}: ${files.length} files, ${kb} KB`);
