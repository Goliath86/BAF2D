// Build Windows (x64) del gioco con Neutralinojs (finestra con WebView2, il motore di Edge già presente in
// Windows 10/11): niente npm né CLI di Neutralino, solo moduli Node built-in.
//   node tools/build-win.mjs   -> dist/BAF2D-<versione>-windows/ (BAF2D.exe, resources.neu, LICENSE)
//                                 + dist/BAF2D-<versione>-windows.zip (cartella BAF2D/ con gli stessi file)
// - L'eseguibile è quello della release ufficiale di Neutralino (versione in tools/neutralino.json), scaricata una
//   volta in dist/.cache/ (dist è fuori da git).
// - resources.neu = archivio ASAR (formato standard di Electron, quello che produce "neu build") con
//   neutralino.config.json e resources/ = gli stessi file dello zip HTML5 (tools/build-zip.mjs -> gameFiles).
// - Configurazione della finestra e del server locale in tools/neutralino.json -> config (+ version dal gioco).
// Mai assets/licensed/ (escluso da gameFiles).

import fs from 'node:fs';
import path from 'node:path';
import { gameFiles, gameInfo, root } from './build-zip.mjs';
import { asarBuffer as asar, unzipBuffer, zipBuffer } from './ziplib.mjs';

const neu = JSON.parse(fs.readFileSync(path.join(root, 'tools/neutralino.json'), 'utf8'));
const { title, version } = gameInfo();
const dist = path.join(root, 'dist');

/** Binario Windows di Neutralino dalla release ufficiale (scaricata una volta in dist/.cache). */
async function neutralinoBinary() {
  const v = neu.neutralinoVersion;
  const cacheDir = path.join(dist, '.cache');
  const zipFile = path.join(cacheDir, `neutralinojs-v${v}.zip`);
  if (!fs.existsSync(zipFile)) {
    const url = `https://github.com/neutralinojs/neutralinojs/releases/download/v${v}/neutralinojs-v${v}.zip`;
    console.log(`downloading ${url}`);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Download failed (${res.status}): ${url}`);
    fs.mkdirSync(cacheDir, { recursive: true });
    fs.writeFileSync(zipFile, Buffer.from(await res.arrayBuffer()));
  }
  const bin = unzipBuffer(fs.readFileSync(zipFile)).get(neu.binary);
  if (!bin) throw new Error(`${neu.binary} not found in ${path.relative(root, zipFile)}`);
  return bin;
}

const config = { ...neu.config, version };
const files = [
  { name: 'neutralino.config.json', data: Buffer.from(JSON.stringify(config, null, 2)) },
  ...gameFiles().map((rel) => ({ name: `resources/${rel}`, data: fs.readFileSync(path.join(root, rel)) })),
];

const exe = await neutralinoBinary();
const outDir = path.join(dist, `${title}-${version}-windows`);
fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });
const out = [
  { name: `${title}.exe`, data: exe },
  { name: 'resources.neu', data: asar(files) },
  { name: 'LICENSE', data: fs.readFileSync(path.join(root, 'LICENSE')) },
];
for (const f of out) fs.writeFileSync(path.join(outDir, f.name), f.data);
const zipFile = path.join(dist, `${title}-${version}-windows.zip`);
fs.writeFileSync(zipFile, zipBuffer(out.map((f) => ({ name: `${title}/${f.name}`, data: f.data, mtime: new Date() }))));
const kb = (n) => `${(n / 1024).toFixed(0)} KB`;
console.log(`${path.relative(root, outDir)}: ${title}.exe ${kb(exe.length)}, resources.neu ${kb(out[1].data.length)} (${files.length} files)`);
console.log(`${path.relative(root, zipFile)}: ${kb(fs.statSync(zipFile).size)}`);
