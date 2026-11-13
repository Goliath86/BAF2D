// Rotazione di qualità per la pixel art (stile RotSprite): il frame viene ingrandito ×4 con Scale2x (due volte,
// gli spigoli diagonali diventano lisci), ruotato campionando al centro di ogni pixel di destinazione e quindi
// riportato alla risoluzione originale. Le diagonali restano pulite e il contorno continuo, mentre la rotazione
// del canvas a bassa risoluzione sgrana i dettagli in "rumore".
// Gli angoli sono a passi (cfg.steps, default 96 = 3,75°); i frame ruotati restano in una cache LRU.

const cfg = { steps: 96, cacheSize: 3000 };
const cache = new Map(); // chiave -> { canvas, mask, o } (ordine di inserimento = uso più recente in fondo)
let nextId = 1;

/** Impostazioni (game.json -> display.rotation): { steps, cacheSize }. Svuota la cache. */
export function configureRotation(c = {}) {
  if (c.steps) cfg.steps = Math.max(8, Math.round(c.steps));
  if (c.cacheSize) cfg.cacheSize = Math.max(64, Math.round(c.cacheSize));
  cache.clear();
}

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

/** Scale2x (EPX) su pixel a 32 bit: restituisce un'immagine larga e alta il doppio. */
function scale2x(src, w, h) {
  const out = new Uint32Array(w * h * 4);
  const W = w * 2;
  const at = (x, y) => src[Math.min(h - 1, Math.max(0, y)) * w + Math.min(w - 1, Math.max(0, x))];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const P = src[y * w + x];
      const A = at(x, y - 1);
      const B = at(x + 1, y);
      const C = at(x - 1, y);
      const D = at(x, y + 1);
      let e0 = P;
      let e1 = P;
      let e2 = P;
      let e3 = P;
      if (C === A && C !== D && A !== B) e0 = A;
      if (A === B && A !== C && B !== D) e1 = B;
      if (D === C && D !== B && C !== A) e2 = C;
      if (B === D && B !== A && D !== C) e3 = D;
      const i = y * 2 * W + x * 2;
      out[i] = e0;
      out[i + 1] = e1;
      out[i + W] = e2;
      out[i + W + 1] = e3;
    }
  }
  return out;
}

/** Pixel del frame (Uint32Array fw*fh), in cache sullo sprite. */
function framePixels(sprite, frame) {
  sprite._px ??= new Map();
  let px = sprite._px.get(frame);
  if (px) return px;
  sprite._pxCanvas ??= (() => {
    const c = makeCanvas(sprite.image.width, sprite.image.height);
    c.getContext('2d', { willReadFrequently: true }).drawImage(sprite.image, 0, 0);
    return c;
  })();
  const sx = (frame % sprite.cols) * sprite.fw;
  const sy = Math.floor(frame / sprite.cols) * sprite.fh;
  const data = sprite._pxCanvas.getContext('2d', { willReadFrequently: true }).getImageData(sx, sy, sprite.fw, sprite.fh);
  px = new Uint32Array(data.data.buffer.slice(0));
  sprite._px.set(frame, px);
  return px;
}

function build(sprite, frame, step) {
  const { fw, fh } = sprite;
  const [ox, oy] = sprite.origin;
  // ×4 con due passate di Scale2x
  const big = scale2x(scale2x(framePixels(sprite, frame), fw, fh), fw * 2, fh * 2);
  const BW = fw * 4;
  // tela di destinazione: contiene il frame ruotato attorno all'origine in qualunque direzione
  const reach = Math.ceil(Math.max(Math.hypot(ox, oy), Math.hypot(fw - ox, oy), Math.hypot(ox, fh - oy), Math.hypot(fw - ox, fh - oy))) + 1;
  const D = reach * 2;
  const canvas = makeCanvas(D, D);
  const g = canvas.getContext('2d');
  const img = g.createImageData(D, D);
  const out = new Uint32Array(img.data.buffer);
  const a = (step / cfg.steps) * Math.PI * 2;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  for (let y = 0; y < D; y++) {
    const py = y + 0.5 - reach;
    for (let x = 0; x < D; x++) {
      const px = x + 0.5 - reach;
      // rotazione inversa: dal pixel di destinazione al punto dello sprite
      const sx = px * cos + py * sin + ox;
      const sy = -px * sin + py * cos + oy;
      if (sx < 0 || sy < 0 || sx >= fw || sy >= fh) continue;
      out[y * D + x] = big[Math.floor(sy * 4) * BW + Math.floor(sx * 4)];
    }
  }
  g.putImageData(img, 0, 0);
  return { canvas, mask: null, o: reach };
}

/** Frame "frame" dello sprite ruotato di "angle": { canvas, o } (o = posizione del perno nella tela). */
export function rotated(sprite, frame, angle) {
  const n = cfg.steps;
  const step = ((Math.round((angle / (Math.PI * 2)) * n) % n) + n) % n;
  sprite._rotId ??= nextId++;
  const key = `${sprite._rotId}:${frame}:${step}`;
  let e = cache.get(key);
  if (e) {
    cache.delete(key); // in fondo = usato da poco
  } else {
    e = build(sprite, frame, step);
    if (cache.size >= cfg.cacheSize) cache.delete(cache.keys().next().value);
  }
  cache.set(key, e);
  return e;
}

/** Sagoma nera del frame ruotato (ombre e luce sul bordo), creata alla prima richiesta. */
function maskOf(e) {
  if (e.mask) return e.mask;
  const c = makeCanvas(e.canvas.width, e.canvas.height);
  const g = c.getContext('2d');
  g.drawImage(e.canvas, 0, 0);
  g.globalCompositeOperation = 'source-in';
  g.fillStyle = '#000';
  g.fillRect(0, 0, c.width, c.height);
  e.mask = c;
  return c;
}

/** Come drawSprite, con la rotazione di qualità; mask = disegna la sagoma nera. */
export function drawRotated(ctx, sprite, frame, x, y, angle = 0, mask = false) {
  const e = rotated(sprite, frame, angle);
  ctx.drawImage(mask ? maskOf(e) : e.canvas, Math.round(x) - e.o, Math.round(y) - e.o);
}

/** Numero di frame ruotati in cache (test e debug). */
export function rotationCacheSize() {
  return cache.size;
}
