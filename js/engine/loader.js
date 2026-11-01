// Caricamento risorse (JSON, immagini, audio). Tutti i percorsi sono relativi a index.html.

export async function loadJSON(url) {
  let res;
  try {
    res = await fetch(url, { cache: 'no-cache' });
  } catch (e) {
    throw new Error(
      `Impossibile caricare "${url}". Il gioco va avviato tramite un server HTTP locale ` +
      `(es. "node tools/serve.mjs"), non aprendo index.html direttamente.`
    );
  }
  if (!res.ok) throw new Error(`Errore ${res.status} caricando "${url}"`);
  try {
    return await res.json();
  } catch (e) {
    throw new Error(`JSON non valido in "${url}": ${e.message}`);
  }
}

export function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Immagine non trovata: ${url}`));
    img.src = url;
  });
}

export async function loadArrayBuffer(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Errore ${res.status} caricando "${url}"`);
  return res.arrayBuffer();
}
