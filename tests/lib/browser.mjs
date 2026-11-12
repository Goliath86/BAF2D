// Infrastruttura dei test nel browser, senza dipendenze: server statico (tools/serve.mjs) su una porta libera,
// Chrome headless con profilo temporaneo (localStorage pulito) e un client CDP minimo (WebSocket globale di Node).
//
// Chrome: variabile d'ambiente CHROME_PATH, altrimenti i percorsi standard di Windows/macOS/Linux. Senza Chrome
// findChrome() restituisce null e i test nel browser vengono saltati.

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Google\\Chrome\\Application\\chrome.exe'),
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ];
  return candidates.find((p) => p && fs.existsSync(p)) || null;
}

function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.unref();
    s.on('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
}

async function waitFor(fn, timeout, what) {
  const end = Date.now() + timeout;
  let last;
  while (Date.now() < end) {
    try {
      const v = await fn();
      if (v) return v;
    } catch (e) {
      last = e;
    }
    await sleep(100);
  }
  throw new Error(`timeout waiting for ${what}${last ? `: ${last.message}` : ''}`);
}

/** Client CDP su una pagina: send(metodo, parametri), eventi raccolti in errors/warnings. */
class Page {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.errors = []; // eccezioni non gestite e console.error
    this.warnings = []; // console.warn
    ws.onmessage = (m) => {
      const d = JSON.parse(m.data);
      if (d.id && this.pending.has(d.id)) {
        const { resolve, reject } = this.pending.get(d.id);
        this.pending.delete(d.id);
        if (d.error) reject(new Error(`${d.error.message} ${d.error.data || ''}`));
        else resolve(d.result);
        return;
      }
      if (d.method === 'Runtime.exceptionThrown') {
        const ex = d.params.exceptionDetails;
        this.errors.push(ex.exception?.description || ex.text);
      } else if (d.method === 'Runtime.consoleAPICalled') {
        const text = d.params.args.map((a) => a.value ?? a.description ?? '').join(' ');
        if (d.params.type === 'error') this.errors.push(text);
        else if (d.params.type === 'warning') this.warnings.push(text);
      } else if (d.method === 'Log.entryAdded' && d.params.entry.level === 'error') {
        // risorse non caricate (404) ecc.; le immagini con src mancante sono ammesse (placeholder)
        const e = d.params.entry;
        if (!/\.(png|gif|jpg|wav|mp3|ogg)\b/i.test(e.url || '') && !/favicon/.test(e.url || '')) this.errors.push(`${e.text} ${e.url || ''}`);
      }
    };
  }

  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++this.id;
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  /** Valuta un'espressione nella pagina e restituisce il valore (le eccezioni diventano errori del test). */
  async eval(expression) {
    const r = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(`page error: ${r.exceptionDetails.exception?.description || r.exceptionDetails.text}`);
    return r.result.value;
  }

  /** Carica un URL del server di prova e aspetta che "ready" (espressione) sia vera. */
  async open(url, ready, timeout = 20000) {
    await this.send('Page.navigate', { url });
    await waitFor(() => this.eval(`!!(${ready})`).catch(() => false), timeout, ready);
  }

  async screenshot(file) {
    const r = await this.send('Page.captureScreenshot', { format: 'png' });
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, Buffer.from(r.data, 'base64'));
  }

  async key(code, type = 'press') {
    const key = code.startsWith('Key') ? code.slice(3).toLowerCase() : code;
    const ev = (t) => this.send('Input.dispatchKeyEvent', { type: t, code, key, windowsVirtualKeyCode: key.length === 1 ? key.toUpperCase().charCodeAt(0) : 0 });
    if (type === 'press' || type === 'down') await ev('keyDown');
    if (type === 'press' || type === 'up') await ev('keyUp');
  }

  async mouse(type, x, y, button = 'left') {
    await this.send('Input.dispatchMouseEvent', { type, x, y, button, buttons: type === 'mousePressed' ? 1 : 0, clickCount: 1 });
  }

  /** Errori raccolti dall'ultimo reset (e li azzera). */
  takeErrors() {
    const e = this.errors;
    this.errors = [];
    return e;
  }
}

/**
 * Avvia server + Chrome. opts.seed = seme di Math.random (iniettato prima di ogni script della pagina:
 * partite ripetibili). Restituisce { page, base, close() }.
 */
export async function launch({ seed = 12345, width = 1280, height = 720 } = {}) {
  const chrome = findChrome();
  if (!chrome) throw new Error('Chrome not found (set CHROME_PATH)');
  const httpPort = await freePort();
  const server = spawn(process.execPath, [path.join(ROOT, 'tools', 'serve.mjs'), String(httpPort)], { stdio: 'ignore' });
  const base = `http://127.0.0.1:${httpPort}`;
  await waitFor(async () => (await fetch(`${base}/index.html`)).ok, 10000, 'dev server');

  const debugPort = await freePort();
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'baf2d-test-'));
  const browser = spawn(chrome, [
    '--headless=new',
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${profile}`,
    `--window-size=${width},${height}`,
    '--autoplay-policy=no-user-gesture-required',
    '--mute-audio',
    '--no-first-run',
    '--no-default-browser-check',
    'about:blank',
  ], { stdio: 'ignore' });

  const close = async () => {
    try {
      page?.ws.close();
    } catch {}
    browser.kill();
    server.kill();
    await sleep(300);
    try {
      fs.rmSync(profile, { recursive: true, force: true });
    } catch {}
  };

  let page;
  try {
    const target = await waitFor(async () => {
      const list = await (await fetch(`http://127.0.0.1:${debugPort}/json`)).json();
      return list.find((t) => t.type === 'page');
    }, 15000, 'Chrome DevTools');
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      ws.onopen = resolve;
      ws.onerror = reject;
    });
    page = new Page(ws);
    await page.send('Runtime.enable');
    await page.send('Page.enable');
    await page.send('Log.enable');
    // Math.random con seme fisso (mulberry32): stessa sequenza a ogni caricamento della pagina
    await page.send('Page.addScriptToEvaluateOnNewDocument', {
      source: `(() => { let a = ${seed >>> 0}; Math.random = () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; })();`,
    });
  } catch (e) {
    await close();
    throw e;
  }
  return { page, base, close };
}
