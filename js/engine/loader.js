// Caricamento risorse (JSON, immagini, audio). Tutti i percorsi sono relativi a index.html.
// Gli errori hanno un testo inglese di riserva perché possono avvenire prima che
// i file lingua siano caricati (es. gioco aperto senza server HTTP).

import { LocalizedError } from './errors.js';

export async function loadJSON(url) {
  let res;
  try {
    res = await fetch(url, { cache: 'no-cache' });
  } catch (e) {
    throw new LocalizedError(
      'errors.fetch',
      { url },
      `Unable to load "${url}". The game must be run through a local HTTP server ` +
        `(e.g. "node tools/serve.mjs"), not by opening index.html directly.`
    );
  }
  if (!res.ok) {
    throw new LocalizedError('errors.http', { url, status: res.status }, `Error ${res.status} while loading "${url}"`);
  }
  try {
    return await res.json();
  } catch (e) {
    throw new LocalizedError('errors.json', { url, details: e.message }, `Invalid JSON in "${url}": ${e.message}`);
  }
}

export function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Image not found: ${url}`));
    img.src = url;
  });
}

export async function loadArrayBuffer(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Error ${res.status} while loading "${url}"`);
  return res.arrayBuffer();
}
