// Generazione procedurale di grafica placeholder in stile pixel-art.
// Usata quando un asset in assets.json ha "src": null o l'immagine non viene trovata.

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function rect(g, x, y, w, h, color) {
  g.fillStyle = color;
  g.fillRect(x, y, w, h);
}

/** Disco "pixelato": riempie i pixel il cui centro cade nel cerchio. */
function disc(g, cx, cy, r, color) {
  g.fillStyle = color;
  const r2 = r * r;
  for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) {
    for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      if (dx * dx + dy * dy <= r2) g.fillRect(x, y, 1, 1);
    }
  }
}

/** Ellisse "pixelata" (assi allineati). */
function ellipse(g, cx, cy, rx, ry, color) {
  g.fillStyle = color;
  for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
    for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
      const dx = (x + 0.5 - cx) / rx;
      const dy = (y + 0.5 - cy) / ry;
      if (dx * dx + dy * dy <= 1) g.fillRect(x, y, 1, 1);
    }
  }
}

/** Linea di Bresenham con pennello quadrato di lato "size". */
function line(g, x0, y0, x1, y1, color, size = 1) {
  g.fillStyle = color;
  // Bresenham vuole interi: con coordinate frazionarie "x0 === x1" non diventerebbe mai vero (ciclo infinito)
  x0 = Math.round(x0);
  y0 = Math.round(y0);
  x1 = Math.round(x1);
  y1 = Math.round(y1);
  const dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    g.fillRect(x0, y0, size, size);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x0 += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y0 += sy;
    }
  }
}

function hexToRgb(hex) {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Contorno di 1px attorno ai pixel opachi della regione (stile pixel-art). */
function addOutline(g, x0, w, h, color) {
  const img = g.getImageData(x0, 0, w, h);
  const d = img.data;
  const src = new Uint8ClampedArray(d);
  const [r, gr, b] = hexToRgb(color);
  const opaque = (x, y) => x >= 0 && y >= 0 && x < w && y < h && src[(y * w + x) * 4 + 3] > 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      if (src[i + 3] > 0) continue;
      if (opaque(x - 1, y) || opaque(x + 1, y) || opaque(x, y - 1) || opaque(x, y + 1)) {
        d[i] = r;
        d[i + 1] = gr;
        d[i + 2] = b;
        d[i + 3] = 255;
      }
    }
  }
  g.putImageData(img, x0, 0);
}

/** PRNG deterministico, per dettagli "casuali" ma stabili. */
function rng(seed) {
  let s = (seed * 9301 + 49297) % 233280 || 1;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

// ---------- Armi ----------
// Ogni arma è vista dall'alto, canna verso destra, asse sulle righe cy-1..cy
// (caricatore ecc. possono sporgere sotto fino a cy+2). x = pixel più a sinistra.

const GUNS = {
  rifle: {
    length: 14,
    draw(g, x, cy, p, noMag = false) {
      rect(g, x, cy - 1, 14, 2, p.gun);
      rect(g, x + 3, cy - 1, 8, 1, p.gunLight);
      if (!noMag) rect(g, x + 6, cy + 1, 2, 2, p.gunDark); // caricatore
      rect(g, x + 13, cy - 1, 1, 2, p.gunDark); // volata
    },
  },
  shotgun: {
    length: 14,
    draw(g, x, cy, p) {
      rect(g, x, cy - 1, 3, 2, p.wood); // calcio
      rect(g, x, cy, 3, 1, p.woodDark);
      rect(g, x + 3, cy - 1, 4, 2, p.gun); // castello
      rect(g, x + 3, cy - 1, 4, 1, p.gunLight);
      rect(g, x + 7, cy - 1, 7, 1, p.gun); // canna
      rect(g, x + 7, cy, 7, 1, p.gunDark); // serbatoio tubolare
      rect(g, x + 9, cy - 1, 3, 2, p.wood); // pompa
      rect(g, x + 9, cy, 3, 1, p.woodDark);
      rect(g, x + 13, cy - 1, 1, 1, p.gunDark); // volata
    },
  },
  pistol: {
    length: 5,
    draw(g, x, cy, p) {
      rect(g, x, cy - 1, 5, 2, p.gun);
      rect(g, x + 1, cy - 1, 3, 1, p.gunLight);
      rect(g, x + 4, cy - 1, 1, 2, p.gunDark); // volata
    },
  },
  // lanciarazzi a spalla: tubo verde oliva, svaso posteriore, mirino; il razzo (testata) sporge davanti
  launcher: {
    length: 20,
    draw(g, x, cy, p, noRocket = false) {
      const tube = p.tube || '#4f5e33';
      const light = p.tubeLight || '#7a8a52';
      const dark = p.tubeDark || '#3a4626';
      rect(g, x, cy - 2, 2, 4, dark); // svaso posteriore
      rect(g, x + 2, cy - 1, 14, 2, tube);
      rect(g, x + 2, cy - 1, 14, 1, light);
      rect(g, x + 7, cy - 2, 3, 1, p.gunDark); // mirino
      rect(g, x + 8, cy + 1, 2, 1, p.gunDark); // impugnatura
      if (!noRocket) {
        rect(g, x + 16, cy - 2, 3, 4, p.warhead || '#5a6448'); // testata
        rect(g, x + 19, cy - 1, 1, 2, p.warheadTip || '#2e3424');
      }
    },
  },
};

/**
 * Come il soldato impugna ciascuna arma (coordinate relative al pivot cx,cy e al centro busto bx).
 * gunX = x dell'arma; right/left: spalla, fine del braccio (spessore 2) e guanto (2x2).
 * Ricarica: reloadCycles = quante volte la mano sinistra va alla tasca del giubbotto
 * (1 = caricatore, >1 = cartucce una alla volta); hidesMag = il caricatore sparisce a metà.
 */
const GRIPS = {
  rifle: (cx, cy, bx) => ({
    gunX: cx - 2,
    right: { shoulder: [bx, cy + 4], hand: [cx + 2, cy + 1], glove: [cx + 2, cy] },
    left: { shoulder: [bx, cy - 6], hand: [cx + 5, cy - 2], glove: [cx + 6, cy - 2] },
    reloadCycles: 1,
    hidesMag: true,
    carry: 'mag',
  }),
  shotgun: (cx, cy, bx) => ({
    gunX: cx - 2,
    right: { shoulder: [bx, cy + 4], hand: [cx + 2, cy + 1], glove: [cx + 2, cy] },
    left: { shoulder: [bx, cy - 6], hand: [cx + 7, cy - 2], glove: [cx + 8, cy - 2] },
    reloadCycles: 3,
    hidesMag: false,
    carry: 'shell',
  }),
  // lanciarazzi in spalla: il tubo sporge dietro la spalla, mano destra sull'impugnatura, sinistra avanti
  launcher: (cx, cy, bx) => ({
    gunX: cx - 8,
    right: { shoulder: [bx, cy + 4], hand: [cx, cy + 1], glove: [cx, cy + 1] },
    left: { shoulder: [bx, cy - 6], hand: [cx + 4, cy - 2], glove: [cx + 5, cy - 2] },
    reloadCycles: 1,
    hidesMag: true,
    carry: 'rocket',
  }),
  // pistola a due mani, braccia tese in avanti
  pistol: (cx, cy, bx) => ({
    gunX: cx + 6,
    right: { shoulder: [bx, cy + 4], hand: [cx + 4, cy], glove: [cx + 5, cy - 1] },
    left: { shoulder: [bx, cy - 5], hand: [cx + 4, cy - 2], glove: [cx + 5, cy - 1] },
    reloadCycles: 1,
    hidesMag: false,
    carry: 'mag',
  }),
};

/**
 * Posa di ricarica per il frame "frame" (0 = nessuna ricarica, 1..n = fasi).
 * reach 0..1 = quanto la mano sinistra è vicina alla tasca; returning = sta tornando con il colpo/caricatore.
 */
function reloadPose(frame, n, cycles) {
  if (frame <= 0 || n <= 0) return { t: 0, pull: 0, reach: 0, returning: false };
  const t = (frame - 0.5) / n; // 0..1 lungo tutta la ricarica
  const pull = Math.sin(Math.PI * t); // arma tirata verso il busto
  const c = (t * cycles) % 1; // fase del singolo andirivieni della mano
  return { t, pull, reach: Math.sin(Math.PI * c), returning: c >= 0.5 };
}

/** Striscia di squadra sull'elmetto (centro hx,hy), da spalla a spalla. */
function teamStripe(g, hx, hy, p) {
  rect(g, hx, hy - 3, 1, 7, p.team);
  rect(g, hx, hy - 3, 1, 1, p.teamDark);
  rect(g, hx, hy + 3, 1, 1, p.teamDark);
  rect(g, hx, hy - 1, 1, 1, p.teamLight);
}

// ---------- Sprite ----------
// Convenzione: gli sprite orientabili guardano verso DESTRA (angolo 0).

const SPRITE_SHAPES = {
  /**
   * Soldato moderno, parte superiore (ruota verso la mira): zaino, spalle in mimetica,
   * giubbotto tattico, arma impugnata (placeholder.weapon: rifle|shotgun|pistol), guanti, elmetto.
   * Frame 0 = fermo; frame 1..reloadFrames = ricarica (la mano sinistra va alla tasca del giubbotto
   * e torna con caricatore/cartuccia, l'arma si avvicina al busto).
   */
  soldier_body(g, w, h, p, frame) {
    const cx = Math.floor(w / 2);
    const cy = Math.floor(h / 2);
    const r = rng(11);
    const kind = GUNS[p.weapon] ? p.weapon : 'rifle';

    const bx = cx - 1; // centro del busto (leggermente arretrato rispetto al pivot)

    // zaino (dietro, verso sinistra)
    rect(g, bx - 6, cy - 3, 3, 6, p.pack);
    rect(g, bx - 6, cy - 3, 1, 6, p.packDark);
    rect(g, bx - 5, cy - 1, 2, 1, p.packDark);

    // spalle in mimetica
    ellipse(g, bx, cy, 3, 6, p.uniform);
    for (let k = 0; k < 14; k++) {
      const x = bx - 3 + Math.floor(r() * 6);
      const y = cy - 6 + Math.floor(r() * 12);
      const dx = (x + 0.5 - bx) / 3;
      const dy = (y + 0.5 - cy) / 6;
      if (dx * dx + dy * dy <= 0.8) rect(g, x, y, 1, 1, k % 2 ? p.camo : p.camo2);
    }

    // giubbotto tattico con tasche
    rect(g, bx - 2, cy - 4, 3, 8, p.vest);
    rect(g, bx, cy - 4, 1, 2, p.vestDark);
    rect(g, bx, cy + 2, 1, 2, p.vestDark);

    const grip = GRIPS[kind](cx, cy, bx);
    const pose = reloadPose(frame, p.reloadFrames || 0, grip.reloadCycles);

    // arma e mano destra arretrano verso il busto durante la ricarica
    const pull = Math.round(pose.pull * 2);
    const R = grip.right;
    const rHand = [R.hand[0] - pull, R.hand[1]];
    const rGlove = [R.glove[0] - pull, R.glove[1]];

    // mano sinistra: dall'astina alla tasca del giubbotto e ritorno
    const L = grip.left;
    const pocket = [bx - 1, cy - 4];
    const ox = Math.round((pocket[0] - L.glove[0]) * pose.reach);
    const oy = Math.round((pocket[1] - L.glove[1]) * pose.reach);
    const lHand = [L.hand[0] + ox, L.hand[1] + oy];
    const lGlove = [L.glove[0] + ox, L.glove[1] + oy];

    // braccia: destra (in basso) verso l'impugnatura, sinistra (in alto) verso l'astina
    line(g, R.shoulder[0], R.shoulder[1], rHand[0], rHand[1], p.uniform, 2);
    line(g, L.shoulder[0], L.shoulder[1], lHand[0], lHand[1], p.uniform, 2);

    // mostrine di squadra sulle spalle (solo nelle varianti "@squadra", vedi teamColored)
    if (p.team) {
      rect(g, bx - 1, cy - 6, 2, 2, p.team);
      rect(g, bx - 1, cy + 4, 2, 2, p.team);
      rect(g, bx - 1, cy - 5, 2, 1, p.teamDark);
      rect(g, bx - 1, cy + 5, 2, 1, p.teamDark);
    }

    // arma (canna centrata sull'asse dello sprite); il caricatore manca a metà ricarica
    const noMag = grip.hidesMag && pose.t > 0.3 && pose.t < 0.75;
    GUNS[kind].draw(g, grip.gunX - pull, cy, p, noMag);

    // guanti sopra l'arma; tornando dalla tasca la mano sinistra porta caricatore o cartuccia
    rect(g, rGlove[0], rGlove[1], 2, 2, p.glove);
    if (pose.returning && pose.reach > 0.2) {
      if (grip.carry === 'shell') rect(g, lGlove[0] + 2, lGlove[1], 1, 2, p.shell || '#a8322a');
      else if (grip.carry === 'rocket') rect(g, lGlove[0] + 1, lGlove[1], 4, 2, p.warhead || '#5a6448');
      else rect(g, lGlove[0] + 1, lGlove[1] + 1, 2, 2, p.gunDark);
    }
    rect(g, lGlove[0], lGlove[1], 2, 2, p.glove);

    // elmetto
    disc(g, bx, cy, 3.5, p.helmetDark);
    disc(g, bx, cy, 2.7, p.helmet);
    rect(g, bx - 2, cy - 2, 2, 1, p.helmetLight);
    rect(g, bx - 2, cy - 1, 1, 1, p.helmetLight);
    rect(g, bx + 2, cy - 1, 1, 2, p.helmetDark); // bordo frontale
    if (p.team) teamStripe(g, bx, cy, p);
  },

  /**
   * Soldato moderno, gambe (ruotano verso la direzione di marcia).
   * Frame 0 = fermo; frame 1..walkFrames = ciclo del passo.
   * Il piede che avanza (sollevato) è più chiaro di quello in appoggio.
   */
  soldier_legs(g, w, h, p, frame) {
    const cx = Math.floor(w / 2);
    const cy = Math.floor(h / 2);
    const n = p.walkFrames || 8;
    const stride = p.stride ?? 5;

    let offL = 2;
    let offR = 1;
    let liftL = false;
    let liftR = false;
    if (frame > 0) {
      const ph = ((frame - 1) / n) * Math.PI * 2;
      offL = Math.round(Math.sin(ph) * stride);
      offR = -offL;
      liftL = Math.cos(ph) > 0;
      liftR = !liftL;
    }

    const leg = (y0, off, lifted) => {
      const foot = cx + off;
      const x0 = Math.min(cx - 2, foot);
      const x1 = Math.max(cx + 1, foot);
      rect(g, x0, y0, x1 - x0 + 1, 3, p.trousers);
      rect(g, x0, y0 + 2, x1 - x0 + 1, 1, p.trousersDark);
      // anfibio
      const bx = off >= 0 ? foot - 1 : foot - 2;
      rect(g, bx, y0, 4, 3, lifted ? p.bootLight : p.boot);
      rect(g, off >= 0 ? bx + 3 : bx, y0, 1, 3, p.bootDark); // punta / tacco
    };
    leg(cy - 4, offL, liftL); // gamba sinistra (in alto, guardando a destra)
    leg(cy + 1, offR, liftR); // gamba destra
  },

  /**
   * Soldato a terra, supino, visto dall'alto: testa (elmetto) a SINISTRA, piedi a destra,
   * braccia aperte. Ruotato come la mira, risulta caduto all'indietro.
   */
  soldier_dead(g, w, h, p) {
    const cx = Math.floor(w / 2);
    const cy = Math.floor(h / 2);
    const r = rng(23);
    const tx = cx - 2; // centro del torso

    // gambe leggermente divaricate, con anfibi
    line(g, tx + 3, cy - 2, cx + 8, cy - 4, p.trousers, 2);
    line(g, tx + 3, cy + 1, cx + 8, cy + 3, p.trousers, 2);
    rect(g, cx + 8, cy - 5, 2, 3, p.boot);
    rect(g, cx + 8, cy + 3, 2, 3, p.boot);
    rect(g, cx + 9, cy - 5, 1, 3, p.bootDark);
    rect(g, cx + 9, cy + 3, 1, 3, p.bootDark);

    // braccia aperte, guanti
    line(g, tx - 2, cy - 4, tx + 1, cy - 9, p.uniform, 2);
    line(g, tx - 2, cy + 3, tx - 4, cy + 8, p.uniform, 2);
    rect(g, tx + 1, cy - 10, 2, 2, p.glove);
    rect(g, tx - 5, cy + 8, 2, 2, p.glove);

    // torso in mimetica con giubbotto
    ellipse(g, tx, cy, 4, 5, p.uniform);
    for (let k = 0; k < 10; k++) {
      const x = tx - 3 + Math.floor(r() * 7);
      const y = cy - 4 + Math.floor(r() * 9);
      const dx = (x + 0.5 - tx) / 4;
      const dy = (y + 0.5 - cy) / 5;
      if (dx * dx + dy * dy <= 0.7) rect(g, x, y, 1, 1, k % 2 ? p.camo : p.camo2);
    }
    rect(g, tx - 2, cy - 3, 5, 6, p.vest);
    rect(g, tx - 1, cy - 3, 1, 2, p.vestDark);
    rect(g, tx + 1, cy + 1, 1, 2, p.vestDark);

    // mostrine di squadra sulle spalle
    if (p.team) {
      rect(g, tx - 3, cy - 5, 2, 2, p.team);
      rect(g, tx - 3, cy + 3, 2, 2, p.team);
    }

    // elmetto
    disc(g, tx - 6, cy, 3.5, p.helmetDark);
    disc(g, tx - 6, cy, 2.7, p.helmet);
    rect(g, tx - 7, cy - 2, 2, 1, p.helmetLight);
    if (p.team) teamStripe(g, tx - 6, cy, p);
  },

  /**
   * Pozza che si allarga: frame 0..frames-1 dal più piccolo al più grande.
   * Macchia irregolare = unione di dischi con offset fissi.
   */
  pool(g, w, h, p, frame) {
    const n = p.frames || 6;
    const k = n > 1 ? frame / (n - 1) : 1;
    const cx = w / 2;
    const cy = h / 2;
    const maxR = Math.min(w, h) / 2 - 2;
    const rad = (2 + (maxR - 2) * k) / 1.3; // le macchie sporgono fino a 1.3 * rad: restano nel frame
    const r = rng(5); // stesse macchie in ogni frame, solo più grandi
    const blobs = [[0, 0, 1]];
    for (let i = 0; i < 5; i++) {
      const a = r() * Math.PI * 2;
      blobs.push([Math.cos(a) * 0.55, Math.sin(a) * 0.55, 0.45 + r() * 0.3]);
    }
    for (const [ox, oy, s] of blobs) disc(g, cx + ox * rad, cy + oy * rad, rad * s, p.dark || p.color);
    for (const [ox, oy, s] of blobs) disc(g, cx + ox * rad, cy + oy * rad, Math.max(1, rad * s - 1), p.color);
    if (rad > 4) rect(g, Math.round(cx - rad * 0.3), Math.round(cy - rad * 0.4), 2, 1, p.light || p.color); // riflesso
  },

  /** Arma da sola (es. oggetto a terra da raccogliere), centrata nel frame. */
  weapon(g, w, h, p) {
    const gun = GUNS[p.weapon] || GUNS.rifle;
    gun.draw(g, Math.floor((w - gun.length) / 2), Math.floor(h / 2) - 1, p);
  },

  /** Razzo orientato a destra: fiamma (frame alterni) a sinistra, alette, corpo, testata a destra. */
  rocket(g, w, h, p, frame) {
    const cy = Math.floor(h / 2);
    rect(g, 0, cy - 1, 2, 2, frame % 2 ? p.flame : p.flameLight);
    if (frame % 2) rect(g, 0, cy, 1, 1, p.flameLight);
    rect(g, 2, cy - 2, 1, 4, p.fin);
    rect(g, 3, cy - 1, w - 6, 2, p.body);
    rect(g, 3, cy - 1, w - 6, 1, p.light);
    rect(g, w - 3, cy - 1, 2, 2, p.warhead);
    rect(g, w - 1, cy - 1, 1, 2, p.tip || p.warhead);
  },

  /**
   * Jeep vista dall'alto, muso a destra. Frame 0 = normale, frame 1 = carcassa bruciata.
   * Ruote sporgenti, cofano, parabrezza, sedili, cassone, ruota di scorta; quadrato di squadra sul cofano.
   */
  jeep(g, w, h, p, frame) {
    const burnt = frame === 1;
    const C = burnt
      ? { body: p.burnt, light: p.burntLight, dark: p.burntDark, glass: p.burntDark, interior: p.burntDark, tire: '#0e0e0e', tireLight: '#1e1e1e' }
      : { body: p.body, light: p.bodyLight, dark: p.bodyDark, glass: p.glass, interior: p.interior, tire: p.tire, tireLight: p.tireLight };
    const top = 3;
    const bottom = h - 4;
    // ruote
    for (const x of [5, w - 10]) {
      rect(g, x, top - 2, 6, 3, C.tire);
      rect(g, x, bottom, 6, 3, C.tire);
      rect(g, x + 1, top - 2, 4, 1, C.tireLight);
      rect(g, x + 1, bottom + 2, 4, 1, C.tireLight);
    }
    // scocca
    rect(g, 2, top, w - 4, bottom - top + 1, C.dark);
    rect(g, 3, top + 1, w - 6, bottom - top - 1, C.body);
    // cofano (davanti) con luce
    rect(g, w - 11, top + 1, 8, bottom - top - 1, C.light);
    rect(g, w - 11, top + 1, 8, 1, C.body);
    rect(g, w - 3, top + 2, 1, 2, burnt ? C.dark : '#f4e8b0'); // fari
    rect(g, w - 3, bottom - 3, 1, 2, burnt ? C.dark : '#f4e8b0');
    // parabrezza
    rect(g, w - 13, top + 1, 2, bottom - top - 1, C.glass);
    // abitacolo e sedili
    rect(g, 9, top + 2, w - 23, bottom - top - 3, C.interior);
    rect(g, 12, top + 2, 3, 3, C.dark);
    rect(g, 12, bottom - 4, 3, 3, C.dark);
    // cassone e ruota di scorta
    rect(g, 3, top + 2, 5, bottom - top - 3, C.dark);
    rect(g, 0, Math.floor(h / 2) - 2, 2, 4, C.tire);
    if (p.team && !burnt) {
      rect(g, w - 8, Math.floor(h / 2) - 2, 4, 4, p.teamDark);
      rect(g, w - 8, Math.floor(h / 2) - 2, 3, 3, p.team);
    }
    if (burnt) for (let i = 0; i < 6; i++) rect(g, 4 + i * 4, top + 2 + (i % 3) * 3, 2, 1, p.burntLight);
  },

  /** Mitragliatrice su perno della jeep (ruota attorno all'origine): scudo, castello, canna, cassetta. */
  jeep_turret(g, w, h, p) {
    const cy = Math.floor(h / 2);
    disc(g, 4, cy, 2.5, p.dark);
    rect(g, 5, cy - 3, 2, 6, p.dark); // scudo
    rect(g, 5, cy - 3, 1, 6, p.light);
    rect(g, 7, cy - 1, 4, 2, p.gun); // castello
    rect(g, 7, cy - 1, 4, 1, p.gunLight);
    rect(g, 11, cy - 1, w - 12, 1, p.gun); // canna
    rect(g, w - 1, cy - 1, 1, 1, p.dark);
    rect(g, 8, cy + 1, 2, 2, p.ammo); // cassetta delle munizioni
  },

  /**
   * Carro lanciarazzi visto dall'alto, muso a destra. Frame 0/1 = cingoli (animazione), frame 2 = carcassa.
   */
  tank(g, w, h, p, frame) {
    const burnt = frame === 2;
    const C = burnt
      ? { body: p.burnt, light: p.burntLight, dark: p.burntDark, track: '#121110', trackLight: '#1e1c1a' }
      : { body: p.body, light: p.bodyLight, dark: p.bodyDark, track: p.track, trackLight: p.trackLight };
    const th = 6; // spessore cingoli
    for (const y of [0, h - th]) {
      rect(g, 1, y, w - 2, th, C.track);
      // maglie: segmenti che scorrono (frame 0/1)
      for (let x = 2 + (frame % 2) * 2; x < w - 2; x += 4) rect(g, x, y + 1, 1, th - 2, C.trackLight);
      rect(g, 1, y, w - 2, 1, C.trackLight);
    }
    // scafo
    rect(g, 3, th - 1, w - 6, h - th * 2 + 2, C.dark);
    rect(g, 4, th, w - 8, h - th * 2, C.body);
    // spiovente anteriore (più chiaro) e griglia del motore dietro
    rect(g, w - 9, th, 5, h - th * 2, C.light);
    for (let y = th + 2; y < h - th - 1; y += 2) rect(g, 5, y, 5, 1, C.dark);
    if (p.team && !burnt) {
      rect(g, 12, th + 1, 4, 3, p.teamDark);
      rect(g, 12, th + 1, 3, 2, p.team);
      rect(g, 12, h - th - 4, 4, 3, p.teamDark);
      rect(g, 12, h - th - 4, 3, 2, p.team);
    }
    if (burnt) for (let i = 0; i < 8; i++) rect(g, 5 + i * 3, th + 1 + (i % 4) * 3, 2, 1, p.burntLight);
  },

  /**
   * Elicottero d'attacco in stile Apache visto dall'alto, muso a destra. Frame 0 = normale, frame 1 = carcassa.
   * Fusoliera lunga e stretta, cabina in tandem a vetri piatti (pilota dietro e più in alto, cannoniere davanti),
   * sensore tondo sul muso, cannoncino sotto la cabina, motori in gondole ai lati con scarichi verso il basso,
   * alette con due lanciarazzi (interni) e rotaie di missili (esterne), carrello a ruote, trave di coda lunga
   * con stabilizzatore orizzontale in fondo e rotore di coda di lato; segni di squadra su coda e stabilizzatore.
   */
  helicopter(g, w, h, p, frame) {
    const burnt = frame === 1;
    const C = burnt
      ? { body: p.burnt, light: p.burntLight, dark: p.burntDark, glass: p.burntDark, glassLight: p.burntLight, frame: '#0e0e0e', pod: p.burntDark, podLight: p.burnt, missile: p.burntDark, wheel: '#0e0e0e' }
      : { body: p.body, light: p.bodyLight, dark: p.bodyDark, glass: p.glass, glassLight: p.glassLight, frame: p.canopyFrame || p.bodyDark, pod: p.pod, podLight: p.podLight, missile: p.missile, wheel: p.wheel };
    const cy = Math.floor(h / 2);
    // stabilizzatore orizzontale in fondo alla coda e deriva (vista dall'alto: una riga scura)
    rect(g, 3, cy - 6, 4, 13, C.dark);
    rect(g, 3, cy - 6, 4, 1, C.light);
    rect(g, 4, cy - 5, 2, 11, C.body);
    rect(g, 9, cy + 2, 2, 1, C.wheel); // ruotino di coda
    // trave di coda: sottile verso il fondo, più larga verso la fusoliera
    rect(g, 2, cy - 1, 18, 3, C.dark);
    rect(g, 3, cy - 1, 17, 1, C.body);
    rect(g, 16, cy - 2, 7, 5, C.dark);
    rect(g, 16, cy - 2, 7, 2, C.body);
    // rotore di coda (di lato, visto di taglio: pale chiare a "X" accanto alla deriva)
    if (!burnt) {
      rect(g, 8, cy + 2, 5, 1, p.tailRotorLight || p.tailRotor);
      rect(g, 10, cy + 2, 1, 2, p.tailRotor);
    }
    // alette: lanciarazzi interni (±7) e rotaie con 2+2 missili esterne
    rect(g, 25, cy - 11, 4, 23, C.dark);
    rect(g, 25, cy - 11, 4, 1, C.light);
    for (const y of [cy - 8, cy + 6]) {
      rect(g, 22, y, 10, 3, C.pod);
      rect(g, 22, y, 10, 1, C.podLight);
      rect(g, 31, y + 1, 1, 1, '#0e0e0e');
    }
    for (const y of [cy - 12, cy - 10, cy + 9, cy + 11]) {
      rect(g, 23, y, 8, 1, C.missile);
      if (!burnt) rect(g, 31, y, 1, 1, p.missileTip);
    }
    // gondole dei motori ai lati, con scarichi scuri verso la coda
    for (const y of [cy - 5, cy + 3]) {
      rect(g, 20, y, 11, 3, C.dark);
      rect(g, 21, y, 9, 2, C.body);
      rect(g, 21, y, 9, 1, C.light);
      rect(g, 19, y, 2, 3, '#121210');
      rect(g, 30, y + 1, 1, 1, C.dark); // presa d'aria
    }
    // ruote del carrello principale (sporgono sotto le gondole)
    rect(g, 35, cy - 6, 3, 2, C.wheel);
    rect(g, 35, cy + 5, 3, 2, C.wheel);
    // fusoliera lunga e stretta
    rect(g, 22, cy - 3, 24, 7, C.dark);
    rect(g, 23, cy - 2, 22, 5, C.body);
    rect(g, 23, cy - 2, 22, 1, C.light);
    // cabina in tandem: pilota dietro (più ampia) e cannoniere davanti, vetri a pannelli con montanti
    rect(g, 33, cy - 3, 6, 7, C.frame);
    rect(g, 34, cy - 2, 4, 5, C.glass);
    rect(g, 39, cy - 2, 5, 5, C.frame);
    rect(g, 40, cy - 1, 3, 3, C.glass);
    rect(g, 34, cy - 2, 2, 1, C.glassLight);
    rect(g, 40, cy - 1, 1, 1, C.glassLight);
    rect(g, 36, cy - 2, 1, 5, C.frame); // montante centrale
    // muso con il sensore tondo e cannoncino sotto la cabina del cannoniere
    rect(g, 44, cy - 2, 3, 5, C.dark);
    disc(g, 47.5, cy + 0.5, 2.2, C.dark);
    if (!burnt) rect(g, 47, cy, 2, 1, p.sensor);
    rect(g, 40, cy + 3, w - 41, 1, p.gun);
    rect(g, 40, cy + 3, 3, 2, p.gun);
    if (p.team && !burnt) {
      rect(g, 13, cy - 1, 4, 2, p.teamDark);
      rect(g, 13, cy - 1, 3, 1, p.team);
      rect(g, 4, cy - 6, 2, 1, p.team);
      rect(g, 4, cy + 6, 2, 1, p.team);
    }
    if (burnt) for (let i = 0; i < 8; i++) rect(g, 18 + i * 3, cy - 3 + (i % 3) * 3, 2, 1, p.burntLight);
  },

  /**
   * Rotore principale (origine = mozzo): frame 0 = pale ("blades", 2 o 4) con punte gialle, frame 1 = disco
   * sfocato.
   */
  heli_rotor(g, w, h, p, frame) {
    const cx = w / 2;
    const cy = h / 2;
    const R = Math.floor(Math.min(w, h) / 2) - 1;
    if (frame === 1) {
      const r = rng(97);
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
          if (d > R) continue;
          // più denso verso il bordo (le punte "disegnano" il cerchio)
          if (d > R - 1.2 || r() < 0.06 + (d / R) * 0.12) rect(g, x, y, 1, 1, d > R - 1.2 ? p.bladeLight : p.blur);
        }
      }
      disc(g, cx, cy, 2.5, p.hub);
      return;
    }
    rect(g, cx - R, cy - 1, R * 2, 2, p.blade);
    rect(g, cx - R, cy - 1, R * 2, 1, p.bladeLight);
    rect(g, cx - R, cy - 1, 3, 2, p.tip);
    rect(g, cx + R - 3, cy - 1, 3, 2, p.tip);
    if ((p.blades ?? 2) >= 4) {
      rect(g, cx - 1, cy - R, 2, R * 2, p.blade);
      rect(g, cx - 1, cy - R, 1, R * 2, p.bladeLight);
      rect(g, cx - 1, cy - R, 2, 3, p.tip);
      rect(g, cx - 1, cy + R - 3, 2, 3, p.tip);
    }
    disc(g, cx, cy, 2.5, p.hub);
    rect(g, cx - 1, cy - 1, 1, 1, p.bladeLight);
  },

  /** Torretta del carro (origine = perno): cupola, due lanciarazzi ai lati, mitragliatrice al centro. */
  tank_turret(g, w, h, p, frame) {
    const burnt = frame === 1;
    const body = burnt ? p.burnt : p.body;
    const light = burnt ? p.burntLight : p.bodyLight;
    const dark = burnt ? p.burntDark : p.bodyDark;
    const ox = p.pivot?.[0] ?? 10;
    const cy = Math.floor(h / 2);
    // lanciarazzi (contenitori con 2 tubi ciascuno)
    for (const y of [1, h - 6]) {
      rect(g, ox - 4, y, 13, 5, dark);
      rect(g, ox - 3, y + 1, 11, 3, body);
      rect(g, ox - 3, y + 1, 11, 1, light);
      rect(g, ox + 8, y + 1, 1, 1, '#0e0e0e');
      rect(g, ox + 8, y + 3, 1, 1, '#0e0e0e');
    }
    // mitragliatrice coassiale
    rect(g, ox + 5, cy - 1, w - ox - 6, 2, p.gun);
    rect(g, w - 1, cy - 1, 1, 2, dark);
    // cupola
    disc(g, ox, cy, 6.5, dark);
    disc(g, ox, cy, 5.5, body);
    disc(g, ox - 1.5, cy - 1.5, 2.5, light);
    disc(g, ox - 2, cy + 1, 1.6, dark); // portello
  },

  bullet(g, w, h, p) {
    rect(g, 0, 1, w, h - 2, p.color);
    rect(g, 1, 0, w - 2, h, p.color);
    rect(g, 2, 1, w - 3, h - 2, p.core);
  },

  /**
   * Bossolo visto dall'alto, orientato a destra: fondello ("base" px, baseColor) a sinistra,
   * corpo (color) e riga di luce in alto (light, solo se alto almeno 2 px).
   */
  casing(g, w, h, p) {
    const base = Math.min(w, p.base ?? 1);
    rect(g, 0, 0, w, h, p.color || '#d9b04a');
    if (p.light && h > 1) rect(g, base, 0, w - base, 1, p.light);
    rect(g, 0, 0, base, h, p.baseColor || p.color || '#9c7424');
  },

  /**
   * Vampata di volata, orientata a destra: la volata è il bordo sinistro, a metà altezza.
   * Getto principale lungo l'asse, due punte a 45° e nucleo chiaro vicino alla canna.
   * Ogni frame è una variante (lunghezza del getto e delle punte casuali ma stabili).
   */
  muzzle_flash(g, w, h, p, frame) {
    const r = rng(frame * 13 + 7);
    const cy = Math.floor(h / 2);
    const len = w - Math.floor(r() * 3);
    rect(g, 0, cy - 1, len, 2, p.outer); // getto principale
    rect(g, 0, cy - 2, 2, 4, p.outer); // allargamento alla volata
    for (const side of [-1, 1]) {
      const s = 1 + Math.floor(r() * Math.max(1, cy - 1));
      const x0 = 1 + Math.floor(r() * 2);
      for (let k = 1; k <= s; k++) rect(g, x0 + k, side < 0 ? cy - 1 - k : cy + k, 1, 1, p.outer);
    }
    rect(g, 0, cy - 1, Math.ceil(len * 0.6), 2, p.mid);
    rect(g, 0, cy - 1, Math.max(2, Math.floor(len * 0.3)), 2, p.core);
  },

  /**
   * Granata a frammentazione vista dall'alto, orientata a destra: corpo tondo (body/dark/light),
   * spoletta a destra e leva lungo il lato (metal, metalLight). Lasciare 1 px di bordo per autoOutline.
   */
  grenade(g, w, h, p) {
    const cy = Math.floor(h / 2);
    disc(g, 3.5, cy + 0.5, 2.5, p.body);
    rect(g, 3, cy + 2, 2, 1, p.dark); // ombra in basso
    rect(g, 4, cy + 1, 1, 1, p.dark);
    rect(g, 2, cy - 1, 1, 1, p.light); // riflesso
    rect(g, 6, cy - 1, 1, 3, p.metal); // spoletta
    rect(g, 2, cy - 2, 4, 1, p.metal); // leva
    rect(g, 6, cy - 1, 1, 1, p.metalLight);
  },

  /**
   * Cassa di munizioni vista dall'alto con un po' di fronte: coperchio (body/light/dark) con bordo rialzato,
   * maniglia (metal), scritta a stampino (stencil), fronte più scuro con chiusure (metal/metalLight) e qualche
   * cartuccia (brass/brassDark) appoggiata sul coperchio aperto a metà. Lasciare 1 px di bordo per autoOutline.
   */
  ammoBox(g, w, h, p) {
    const x0 = 1;
    const y0 = 1;
    const bw = w - 2;
    const lid = Math.max(4, h - 5); // altezza del coperchio
    const front = h - 2 - lid; // altezza del fronte
    // coperchio: fondo, bordo chiaro in alto/sinistra, scuro in basso/destra
    rect(g, x0, y0, bw, lid, p.body);
    rect(g, x0, y0, bw, 1, p.light);
    rect(g, x0, y0, 1, lid, p.light);
    rect(g, x0 + bw - 1, y0 + 1, 1, lid - 1, p.dark);
    rect(g, x0 + 1, y0 + lid - 1, bw - 1, 1, p.dark);
    // battuta del coperchio (due righe incise ai lati)
    rect(g, x0 + 2, y0 + 1, 1, lid - 2, p.dark);
    rect(g, x0 + bw - 3, y0 + 1, 1, lid - 2, p.dark);
    // scritta a stampino a sinistra della maniglia
    const sy = y0 + Math.floor(lid / 2) - 1;
    rect(g, x0 + 4, sy, 1, 2, p.stencil);
    rect(g, x0 + 5, sy, 1, 1, p.stencil);
    rect(g, x0 + 6, sy, 1, 2, p.stencil);
    // maniglia centrale (ombra sotto, riflesso sopra)
    const hx = x0 + Math.floor(bw / 2) - 1;
    rect(g, hx, sy, 4, 1, p.metal);
    rect(g, hx, sy + 1, 1, 1, p.metal);
    rect(g, hx + 3, sy + 1, 1, 1, p.metal);
    rect(g, hx + 1, sy + 1, 2, 1, p.dark);
    rect(g, hx + 1, sy, 2, 1, p.metalLight);
    // cartucce sul coperchio, a destra
    for (let k = 0; k < 2; k++) {
      const cx = x0 + bw - 6 + k * 2;
      rect(g, cx, y0 + 1, 1, 3, p.brass);
      rect(g, cx, y0 + 3, 1, 1, p.brassDark);
      rect(g, cx, y0 + 1, 1, 1, p.tip);
    }
    // fronte: più scuro, con le due chiusure
    rect(g, x0, y0 + lid, bw, front, p.dark);
    rect(g, x0, y0 + lid + front - 1, bw, 1, p.shadow);
    for (const cx of [x0 + 2, x0 + bw - 4]) {
      rect(g, cx, y0 + lid, 2, Math.max(1, front - 1), p.metal);
      rect(g, cx, y0 + lid, 1, 1, p.metalLight);
    }
  },

  /**
   * Bruciatura di un'esplosione (decal): macchia irregolare scura con centro più nero, raggi
   * di fuliggine e bordo "sgranato". Ogni frame è una variante.
   */
  scorch(g, w, h, p, frame) {
    const r = rng(frame * 31 + 9);
    const cx = w / 2;
    const cy = h / 2;
    const R = Math.min(w, h) / 2 - 3;
    // raggi di fuliggine che escono dalla macchia
    const rays = 7 + Math.floor(r() * 4);
    for (let i = 0; i < rays; i++) {
      const a = (i / rays) * Math.PI * 2 + r() * 0.5;
      const len = R * (0.9 + r() * 0.5);
      line(g, Math.round(cx), Math.round(cy), Math.round(cx + Math.cos(a) * len), Math.round(cy + Math.sin(a) * len), p.edge);
    }
    // bordo sgranato: pixel sparsi poco oltre la macchia
    for (let i = 0; i < R * 10; i++) {
      const a = r() * Math.PI * 2;
      const d = R * (0.7 + r() * 0.55);
      rect(g, Math.floor(cx + Math.cos(a) * d), Math.floor(cy + Math.sin(a) * d), 1, 1, r() < 0.5 ? p.edge : p.mid);
    }
    // macchia = unione di dischi, poi centro più scuro
    const blobs = [[0, 0, 0.75]];
    for (let i = 0; i < 5; i++) {
      const a = r() * Math.PI * 2;
      blobs.push([Math.cos(a) * 0.35, Math.sin(a) * 0.35, 0.35 + r() * 0.25]);
    }
    for (const [ox, oy, s] of blobs) disc(g, cx + ox * R, cy + oy * R, R * s, p.mid);
    disc(g, cx + (r() - 0.5) * 2, cy + (r() - 0.5) * 2, R * 0.45, p.dark);
    for (let i = 0; i < 6; i++) rect(g, Math.floor(cx + (r() - 0.5) * R), Math.floor(cy + (r() - 0.5) * R), 1, 1, p.ash || p.edge);
  },

  /**
   * Palla di fuoco: frame 0..frames-1 = dall'esplosione (nucleo bianco, fiamme) al fumo che si dissolve.
   * Unione di dischi con offset fissi che si allargano, cambiano colore e si assottigliano.
   */
  explosion(g, w, h, p, frame) {
    const n = p.frames || 8;
    const t = n > 1 ? frame / (n - 1) : 1;
    const cx = w / 2;
    const cy = h / 2;
    const maxR = Math.min(w, h) / 2 - 1;
    const r = rng(17);
    const blobs = [[0, 0, 0.7]];
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2 + r() * 0.6;
      blobs.push([Math.cos(a) * (0.3 + r() * 0.25), Math.sin(a) * (0.3 + r() * 0.25), 0.35 + r() * 0.2]);
    }
    const R = maxR * (0.45 + 0.55 * Math.sqrt(t)); // si allarga in fretta, poi rallenta
    const shrink = t > 0.5 ? 1 - ((t - 0.5) / 0.5) * 0.65 : 1; // nel finale le nuvole si assottigliano
    const spread = 1 + t * 0.6; // e si allontanano dal centro
    const layer = (scale, color) => {
      for (const [ox, oy, s] of blobs) {
        const rad = R * s * scale * shrink;
        if (rad >= 0.6) disc(g, cx + ox * R * spread, cy + oy * R * spread, rad, color);
      }
    };
    if (t < 0.4) {
      layer(1, p.outer);
      layer(0.72, p.mid);
      layer(0.45, p.core);
    } else if (t < 0.65) {
      layer(1, p.smoke);
      layer(0.75, p.outer);
      layer(0.45, p.mid);
    } else {
      layer(1, p.smokeDark || p.smoke);
      layer(0.6, p.smoke);
      if (t < 0.8) layer(0.3, p.outer);
    }
  },

  /** Detrito (scheggia/sasso) di 1..4 pixel; ogni frame è una forma diversa. */
  debris(g, w, h, p, frame) {
    const r = rng(frame * 5 + 2);
    const colors = p.colors || ['#555'];
    const cx = Math.floor(w / 2);
    const cy = Math.floor(h / 2);
    rect(g, cx, cy, 1, 1, colors[0]);
    const n = 1 + Math.floor(r() * 3);
    for (let i = 0; i < n; i++) {
      rect(g, cx + Math.floor(r() * 3) - 1, cy + Math.floor(r() * 3) - 1, 1, 1, colors[Math.floor(r() * colors.length)]);
    }
  },

  /** Foro di proiettile (decal). Ogni frame è una variante diversa. */
  hole(g, w, h, p, frame) {
    const r = rng(frame * 7 + 3);
    const cx = w / 2;
    const cy = h / 2;
    disc(g, cx, cy, 2.6, p.rim);
    disc(g, cx + (r() - 0.5), cy + (r() - 0.5), 1.6, p.center);
    const dirs = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
    const extra = p.cracks || p.chips;
    if (!extra) return;
    for (let k = 0; k < 3; k++) {
      const [dx, dy] = dirs[Math.floor(r() * dirs.length)];
      const x = Math.floor(cx) + dx * 2;
      const y = Math.floor(cy) + dy * 2;
      if (p.cracks) {
        // crepa: linea che parte dal bordo del foro
        rect(g, x, y, 1, 1, p.cracks);
        rect(g, x + dx, y + dy, 1, 1, p.cracks);
      } else {
        // schegge di terreno sparse attorno
        rect(g, x + dx, y + dy, 1, 1, p.chips);
      }
    }
  },

  crosshair(g, w, h, p) {
    const c = Math.floor(w / 2);
    // contorno
    rect(g, c - 1, 0, 3, 4, p.outline);
    rect(g, c - 1, h - 4, 3, 4, p.outline);
    rect(g, 0, c - 1, 4, 3, p.outline);
    rect(g, w - 4, c - 1, 4, 3, p.outline);
    // linee
    rect(g, c, 1, 1, 2, p.color);
    rect(g, c, h - 3, 1, 2, p.color);
    rect(g, 1, c, 2, 1, p.color);
    rect(g, w - 3, c, 2, 1, p.color);
    rect(g, c, c, 1, 1, p.color);
  },

  // ---------- Decorazioni (props) ----------
  // Frame 0..variants-1 = varianti; frame variants..2*variants-1 = la stessa forma tutta in "shadowColor"
  // (ombra proiettata, disegnata a terra con trasparenza e spostata dal gioco).

  /** Chioma di palma vista dall'alto: foglie a raggiera con foglioline, corona al centro. */
  palm(g, w, h, p, i) {
    const n = p.variants ?? 3;
    const shadow = i >= n;
    const r = rng((i % n) * 41 + 3);
    const S = p.shadowColor || '#000';
    const cx = w / 2;
    const cy = h / 2;
    const fronds = 7 + Math.floor(r() * 3);
    const a0 = r() * Math.PI * 2;
    const px = (x, y, c) => rect(g, Math.round(x), Math.round(y), 1, 1, shadow ? S : c);
    for (let f = 0; f < fronds; f++) {
      const a = a0 + (f / fronds) * Math.PI * 2 + (r() - 0.5) * 0.5;
      const len = w * 0.32 + r() * w * 0.14;
      const bend = (r() - 0.5) * 0.5; // curvatura della foglia
      for (let t = 2; t < len; t += 0.7) {
        const k = t / len;
        const aa = a + bend * k * k;
        const x = cx + Math.cos(aa) * t;
        const y = cy + Math.sin(aa) * t;
        px(x, y, p.dark);
        // foglioline ai due lati, più corte verso la punta e piegate all'indietro
        if (Math.round(t * 10) % 14 < 7) continue;
        const L = (1 - k) * 4.5 + 1;
        for (const side of [-1, 1]) {
          const la = aa + side * 1.15;
          for (let q = 1; q <= L; q++) {
            px(x + Math.cos(la) * q, y + Math.sin(la) * q, side < 0 ? p.light : p.color);
          }
        }
      }
    }
    disc(g, cx, cy, 3.2, shadow ? S : p.trunk);
    if (!shadow) {
      disc(g, cx - 0.8, cy - 0.8, 1.6, p.trunkLight);
      rect(g, Math.round(cx), Math.round(cy) + 1, 1, 1, p.dates || p.trunk);
      rect(g, Math.round(cx) - 2, Math.round(cy), 1, 1, p.dates || p.trunk);
    }
  },

  /** Cespuglio: grappolo di ciuffi tondi (verde) o di rametti (secco: dry = true). */
  bush(g, w, h, p, i) {
    const n = p.variants ?? 3;
    const shadow = i >= n;
    const r = rng((i % n) * 53 + (p.dry ? 9 : 1));
    const S = p.shadowColor || '#000';
    const cx = w / 2;
    const cy = h / 2;
    if (p.dry) {
      const twigs = 9 + Math.floor(r() * 5);
      for (let k = 0; k < twigs; k++) {
        const a = r() * Math.PI * 2;
        const len = w * 0.25 + r() * w * 0.22;
        const x1 = Math.round(cx + Math.cos(a) * len);
        const y1 = Math.round(cy + Math.sin(a) * len);
        line(g, Math.round(cx), Math.round(cy), x1, y1, shadow ? S : r() < 0.5 ? p.color : p.dark);
        if (!shadow) rect(g, x1, y1, 1, 1, p.light);
      }
      return;
    }
    const blobs = 5 + Math.floor(r() * 4);
    const pts = [];
    for (let k = 0; k < blobs; k++) {
      const a = r() * Math.PI * 2;
      const d = r() * w * 0.22;
      pts.push({ x: cx + Math.cos(a) * d, y: cy + Math.sin(a) * d, rr: 2.2 + r() * 2 });
    }
    for (const b of pts) disc(g, b.x + 0.6, b.y + 0.8, b.rr, shadow ? S : p.dark);
    if (shadow) return;
    for (const b of pts) disc(g, b.x, b.y, b.rr - 0.4, p.color);
    for (const b of pts) disc(g, b.x - 0.8, b.y - 0.8, Math.max(0.8, b.rr * 0.45), p.light);
    if (p.flowers) for (let k = 0; k < 3; k++) rect(g, Math.round(cx + (r() - 0.5) * w * 0.5), Math.round(cy + (r() - 0.5) * h * 0.5), 1, 1, p.flowers);
  },

  /** Chioma d'albero vista dall'alto: grappoli di fogliame tondi, scuri sotto e chiari in alto a sinistra. */
  tree(g, w, h, p, i) {
    const n = p.variants ?? 3;
    const shadow = i >= n;
    const r = rng((i % n) * 89 + 13);
    const S = p.shadowColor || '#000';
    const cx = w / 2;
    const cy = h / 2;
    const R = Math.min(w, h) * 0.4;
    const clumps = [];
    const k = 6 + Math.floor(r() * 4);
    for (let j = 0; j < k; j++) {
      const a = (j / k) * Math.PI * 2 + r() * 0.6;
      const d = R * (0.35 + r() * 0.3);
      clumps.push({ x: cx + Math.cos(a) * d, y: cy + Math.sin(a) * d, rr: R * (0.38 + r() * 0.18) });
    }
    clumps.push({ x: cx, y: cy, rr: R * 0.55 });
    if (shadow) {
      for (const c of clumps) disc(g, c.x, c.y, c.rr, S);
      return;
    }
    for (const c of clumps) disc(g, c.x + 1, c.y + 1.5, c.rr, p.dark);
    for (const c of clumps) disc(g, c.x, c.y, c.rr - 1, p.color);
    for (const c of clumps) disc(g, c.x - c.rr * 0.25, c.y - c.rr * 0.3, c.rr * 0.5, p.light);
    // foglie sparse e qualche riflesso
    for (let j = 0; j < w * 1.5; j++) {
      const a = r() * Math.PI * 2;
      const d = r() * R;
      const x = Math.round(cx + Math.cos(a) * d);
      const y = Math.round(cy + Math.sin(a) * d);
      rect(g, x, y, 1, 1, r() < 0.5 ? p.dark : p.highlight || p.light);
    }
    if (p.fruit) for (let j = 0; j < 5; j++) rect(g, Math.round(cx + (r() - 0.5) * R * 1.4), Math.round(cy + (r() - 0.5) * R * 1.4), 1, 1, p.fruit);
  },

  /** Sasso con ombra inclusa (non ondeggia). */
  pebble(g, w, h, p, i) {
    const r = rng(i * 61 + 5);
    const cx = w / 2;
    const cy = h / 2;
    const rx = w * 0.28 + r() * w * 0.12;
    const ry = h * 0.22 + r() * h * 0.1;
    ellipse(g, cx + 1, cy + 1, rx, ry, p.shadowColor || 'rgba(0,0,0,0.35)');
    ellipse(g, cx, cy, rx, ry, p.dark);
    ellipse(g, cx - 0.5, cy - 0.5, rx - 0.8, ry - 0.8, p.color);
    ellipse(g, cx - rx * 0.3, cy - ry * 0.35, rx * 0.4, ry * 0.3, p.light);
  },

  circle(g, w, h, p) {
    disc(g, w / 2, h / 2, Math.min(w, h) / 2, p.outline || '#000');
    disc(g, w / 2, h / 2, Math.min(w, h) / 2 - 1, p.color || '#f0f');
  },

  rect(g, w, h, p) {
    rect(g, 0, 0, w, h, p.outline || '#000');
    rect(g, 1, 1, w - 2, h - 2, p.color || '#f0f');
  },
};

function countFrames(animations) {
  let max = 0;
  for (const a of Object.values(animations || {})) {
    for (const f of a.frames || []) max = Math.max(max, f);
  }
  return max + 1;
}

export function createSpritePlaceholder(def) {
  const fw = def.frameWidth || 16;
  const fh = def.frameHeight || 16;
  const p = def.placeholder || {};
  const frames = p.frames || countFrames(def.animations);
  const painter = SPRITE_SHAPES[p.shape] || SPRITE_SHAPES.rect;
  const c = makeCanvas(fw * frames, fh);
  const g = c.getContext('2d', { willReadFrequently: !!p.autoOutline });
  for (let i = 0; i < frames; i++) {
    g.save();
    g.translate(i * fw, 0);
    // ritaglio al riquadro del frame (come per i tile): un disegno che sborda non sporca il frame accanto
    g.beginPath();
    g.rect(0, 0, fw, fh);
    g.clip();
    painter(g, fw, fh, p, i);
    g.restore();
    if (p.autoOutline) addOutline(g, i * fw, fw, fh, p.autoOutline);
  }
  return c;
}

// ---------- Tile ----------

const TILE_STYLES = {
  floor(g, s, p, seed) {
    rect(g, 0, 0, s, s, p.color);
    const r = rng(seed + 1);
    for (let i = 0; i < s / 2; i++) {
      rect(g, Math.floor(r() * s), Math.floor(r() * s), 1, 1, p.detail);
    }
    rect(g, 0, s - 1, s, 1, p.edge);
    rect(g, s - 1, 0, 1, s, p.edge);
  },

  wall(g, s, p) {
    rect(g, 0, 0, s, s, p.color);
    // mattoni
    const bh = s / 4;
    for (let row = 0; row < 4; row++) {
      const y = row * bh;
      rect(g, 0, y + bh - 1, s, 1, p.dark);
      const off = row % 2 === 0 ? 0 : s / 4;
      for (let x = off; x < s; x += s / 2) rect(g, x, y, 1, bh - 1, p.dark);
    }
    rect(g, 0, 0, s, 1, p.light);
    rect(g, 0, 0, 1, s, p.light);
  },

  crate(g, s, p) {
    rect(g, 0, 0, s, s, p.dark);
    rect(g, 1, 1, s - 2, s - 2, p.color);
    rect(g, 1, 1, s - 2, 2, p.light);
    rect(g, 1, s - 3, s - 2, 2, p.light);
    for (let i = 3; i < s - 3; i++) {
      rect(g, i, i, 1, 1, p.dark);
      rect(g, s - 1 - i, i, 1, 1, p.dark);
    }
    rect(g, 0, 0, s, 1, p.dark);
    rect(g, 0, s - 1, s, 1, p.dark);
  },

  flat(g, s, p) {
    rect(g, 0, 0, s, s, p.color || '#f0f');
  },

  // ---------- Deserto ----------

  /** Sabbia: granelli e brevi increspature ondulate (segni del vento), diverse per ogni variante. */
  sand(g, s, p, seed) {
    rect(g, 0, 0, s, s, p.color);
    const r = rng(seed * 31 + 5);
    for (let i = 0; i < s * 1.5; i++) {
      rect(g, Math.floor(r() * s), Math.floor(r() * s), 1, 1, r() < 0.5 ? p.detail : p.light);
    }
    const ripples = p.ripples ?? 3;
    for (let k = 0; k < ripples; k++) {
      const y0 = Math.floor(r() * s);
      const x0 = Math.floor(r() * s);
      const len = 4 + Math.floor(r() * 7);
      for (let i = 0; i < len; i++) {
        const x = (x0 + i) % s;
        const y = (y0 + Math.round(Math.sin(i * 0.9 + k) * 0.8) + s) % s;
        rect(g, x, y, 1, 1, p.ripple);
        rect(g, x, (y + 1) % s, 1, 1, p.light);
      }
    }
    if (p.stones) {
      for (let i = 0; i < p.stones; i++) {
        const x = 1 + Math.floor(r() * (s - 3));
        const y = 1 + Math.floor(r() * (s - 3));
        rect(g, x, y, 2, 1, p.stone);
        rect(g, x, y + 1, 2, 1, p.ripple);
      }
    }
  },

  /** Strada sterrata: terra battuta con sassolini e solchi delle ruote (verticali o orizzontali). */
  road(g, s, p, seed) {
    rect(g, 0, 0, s, s, p.color);
    const r = rng(seed * 17 + 3);
    for (let i = 0; i < s * 0.75; i++) rect(g, Math.floor(r() * s), Math.floor(r() * s), 1, 1, r() < 0.6 ? p.detail : p.light);
    for (let i = 0; i < (p.stones ?? 2); i++) rect(g, Math.floor(r() * (s - 1)), Math.floor(r() * (s - 1)), 2, 1, p.stone);
    if (p.ruts) {
      const v = p.ruts === 'v';
      for (const c of [4, 11]) {
        for (let i = 0; i < s; i++) {
          if (r() < 0.25) continue;
          if (v) rect(g, c, i, 1, 1, p.rut);
          else rect(g, i, c, 1, 1, p.rut);
        }
      }
    }
  },

  /** Muro di mattoni di fango visto dall'alto: blocchi irregolari, crepe, bordo chiaro. */
  adobe(g, s, p, seed) {
    rect(g, 0, 0, s, s, p.color);
    const r = rng(seed * 13 + 1);
    const bh = s / 4;
    for (let row = 0; row < 4; row++) {
      const y = row * bh;
      rect(g, 0, y + bh - 1, s, 1, p.dark);
      let x = row % 2 === 0 ? 0 : Math.floor(s / 3);
      while (x < s) {
        rect(g, x, y, 1, bh - 1, p.dark);
        x += 5 + Math.floor(r() * 4);
      }
    }
    for (let i = 0; i < s / 2; i++) rect(g, Math.floor(r() * s), Math.floor(r() * s), 1, 1, r() < 0.5 ? p.light : p.dark);
    // crepa
    let cx = Math.floor(r() * s);
    let cy = 0;
    if (r() < 0.6) {
      while (cy < s) {
        rect(g, cx, cy, 1, 1, p.crack);
        cy++;
        cx = Math.max(0, Math.min(s - 1, cx + Math.floor(r() * 3) - 1));
        if (r() < 0.15) break;
      }
    }
    rect(g, 0, 0, s, 1, p.light);
    rect(g, 0, 0, 1, s, p.light);
  },

  /** Muretto a secco: pietre tondeggianti con fughe scure. */
  stones(g, s, p, seed) {
    rect(g, 0, 0, s, s, p.gap);
    const r = rng(seed * 7 + 11);
    const cols = p.colors || [p.color];
    for (let y = 0; y < s; y += 5) {
      let x = -Math.floor(r() * 4);
      while (x < s) {
        const w = 4 + Math.floor(r() * 4);
        const c = cols[Math.floor(r() * cols.length)];
        ellipse(g, x + w / 2, y + 2.5, w / 2, 2.4, c);
        rect(g, x + 1, y + 1, Math.max(1, w - 3), 1, p.light);
        x += w + 1;
      }
    }
    rect(g, 0, 0, s, 1, p.light);
  },

  /**
   * Macerie: pezzi di mattone e pietra sparsi (density 0..1) su un fondo di sabbia o pavimento.
   * pile: true = cumulo non calpestabile: fondo scuro coperto di blocchi grossi con contorno ("outline"),
   * spigoli in ombra e "beams" travi spezzate (colore "beam"), così si stacca dal terreno.
   */
  rubble(g, s, p, seed) {
    rect(g, 0, 0, s, s, p.base);
    const r = rng(seed * 19 + 7);
    if (p.pile) {
      for (let i = 0; i < s; i++) rect(g, Math.floor(r() * s), Math.floor(r() * s), 1, 1, p.baseDetail);
      const cols = p.colors || ['#8a8478'];
      const n = p.chunks ?? 16;
      for (let i = 0; i < n; i++) {
        const w = 3 + Math.floor(r() * 5);
        const h = 2 + Math.floor(r() * 4);
        const x = Math.floor(r() * (s - w + 2)) - 1;
        const y = Math.floor(r() * (s - h + 2)) - 1;
        rect(g, x - 1, y - 1, w + 2, h + 2, p.outline || p.shadow);
        rect(g, x, y, w, h, cols[Math.floor(r() * cols.length)]);
        rect(g, x, y + h - 1, w, 1, p.shadow); // lato in ombra in basso
        rect(g, x + w - 1, y, 1, h, p.shadow); // e a destra
        rect(g, x, y, w - 1, 1, p.light); // luce in alto
        if (w > 4 && r() < 0.5) rect(g, x + 1 + Math.floor(r() * (w - 3)), y + 1, 1, Math.max(1, h - 2), p.shadow); // crepa
      }
      for (let k = 0; k < (p.beams ?? 1); k++) {
        // trave spezzata in diagonale (a gradini di 1 px)
        const len = 7 + Math.floor(r() * 6);
        const x0 = Math.floor(r() * (s - 4));
        const y0 = 2 + Math.floor(r() * (s - 6));
        const dir = r() < 0.5 ? 1 : -1;
        for (let i = 0; i < len; i++) {
          const bx = x0 + i * dir;
          const by = y0 + Math.floor(i / 3);
          rect(g, bx, by + 1, 1, 2, p.outline || p.shadow);
          rect(g, bx, by, 1, 2, p.beam || '#4a3626');
        }
      }
      return;
    }
    for (let i = 0; i < s; i++) rect(g, Math.floor(r() * s), Math.floor(r() * s), 1, 1, p.baseDetail);
    const n = Math.round((p.density ?? 0.5) * 14);
    const cols = p.colors || ['#a07850'];
    for (let i = 0; i < n; i++) {
      const w = 2 + Math.floor(r() * (p.density > 0.6 ? 5 : 3));
      const h = 1 + Math.floor(r() * 3);
      const x = Math.floor(r() * (s - w));
      const y = Math.floor(r() * (s - h));
      rect(g, x + 1, y + 1, w, h, p.shadow);
      rect(g, x, y, w, h, cols[Math.floor(r() * cols.length)]);
      rect(g, x, y, w, 1, p.light);
    }
  },

  /** Pavimento di piastrelle (case), sbiadito, con crepe e sabbia entrata dalle porte. */
  tiles(g, s, p, seed) {
    const r = rng(seed * 23 + 2);
    const t = s / 2;
    for (let y = 0; y < 2; y++) {
      for (let x = 0; x < 2; x++) {
        rect(g, x * t, y * t, t, t, r() < 0.3 ? p.alt : p.color);
        rect(g, x * t, y * t, t, 1, p.light);
        rect(g, x * t + t - 1, y * t, 1, t, p.dark);
        rect(g, x * t, y * t + t - 1, t, 1, p.dark);
      }
    }
    for (let i = 0; i < 5; i++) rect(g, Math.floor(r() * s), Math.floor(r() * s), 1, 1, p.dark);
    if (p.sand) for (let i = 0; i < s; i++) rect(g, Math.floor(r() * s), Math.floor(r() * s), 1, 1, p.sand);
  },

  /** Roccia (bordo della mappa): massi irregolari con luce in alto a sinistra. */
  rock(g, s, p, seed) {
    rect(g, 0, 0, s, s, p.dark);
    const r = rng(seed * 29 + 13);
    for (let i = 0; i < 5; i++) {
      const cx = r() * s;
      const cy = r() * s;
      const rx = 3 + r() * 4;
      const ry = 3 + r() * 3;
      ellipse(g, cx, cy, rx, ry, p.color);
      ellipse(g, cx - 1, cy - 1, rx * 0.6, ry * 0.5, p.light);
    }
    for (let i = 0; i < 6; i++) rect(g, Math.floor(r() * s), Math.floor(r() * s), 1, 1, p.dark);
  },

  /** Acqua: blu con riflessi chiari sparsi. */
  water(g, s, p, seed) {
    rect(g, 0, 0, s, s, p.color);
    const r = rng(seed * 37 + 17);
    for (let i = 0; i < 4; i++) {
      const x = Math.floor(r() * (s - 4));
      const y = Math.floor(r() * s);
      rect(g, x, y, 2 + Math.floor(r() * 3), 1, p.light);
    }
    for (let i = 0; i < 6; i++) rect(g, Math.floor(r() * s), Math.floor(r() * s), 1, 1, p.dark);
  },

  // ---------- Campagna ----------

  /** Erba: fondo verde, ciuffi di fili (due pixel in verticale) chiari e scuri, fiorellini opzionali. */
  grass(g, s, p, seed) {
    rect(g, 0, 0, s, s, p.color);
    const r = rng(seed * 43 + 7);
    for (let i = 0; i < s * 1.2; i++) rect(g, Math.floor(r() * s), Math.floor(r() * s), 1, 1, p.detail);
    for (let i = 0; i < (p.tufts ?? 6); i++) {
      const x = Math.floor(r() * s);
      const y = Math.floor(r() * (s - 1));
      rect(g, x, y, 1, 2, p.blade);
      rect(g, (x + 1) % s, y + 1, 1, 1, p.blade);
      rect(g, x, y, 1, 1, p.light);
    }
    for (let i = 0; i < (p.flowerCount ?? 0); i++) {
      const cols = p.flowers || ['#f0e8a0'];
      rect(g, Math.floor(r() * s), Math.floor(r() * s), 1, 1, cols[Math.floor(r() * cols.length)]);
    }
  },

  /** Fango (fondo della trincea, crateri): terra scura, zolle, pozzanghere; planks = camminamento di assi. */
  mud(g, s, p, seed) {
    rect(g, 0, 0, s, s, p.color);
    const r = rng(seed * 47 + 3);
    for (let i = 0; i < s * 1.2; i++) rect(g, Math.floor(r() * s), Math.floor(r() * s), 1, 1, r() < 0.5 ? p.detail : p.light);
    for (let i = 0; i < (p.puddles ?? 1); i++) {
      const x = 2 + r() * (s - 4);
      const y = 2 + r() * (s - 4);
      ellipse(g, x, y, 1.5 + r() * 2, 1 + r(), p.puddle || p.detail);
      rect(g, Math.round(x) - 1, Math.round(y) - 1, 1, 1, p.shine || p.light);
    }
    if (p.planks) {
      // assi trasversali (camminamento) con chiodi
      for (let y = 1; y < s; y += 4) {
        rect(g, 3, y, s - 6, 3, p.plank);
        rect(g, 3, y, s - 6, 1, p.plankLight);
        rect(g, 3, y + 2, s - 6, 1, p.plankDark);
        rect(g, 4, y + 1, 1, 1, p.plankDark);
        rect(g, s - 5, y + 1, 1, 1, p.plankDark);
      }
    }
  },

  /** Sacchi di sabbia visti dall'alto: file sfalsate di sacchi arrotondati con cuciture e ombra tra le file. */
  sandbags(g, s, p, seed) {
    rect(g, 0, 0, s, s, p.gap);
    const r = rng(seed * 59 + 1);
    const cols = p.colors || [p.color];
    const bh = s / 3;
    for (let row = 0; row < 3; row++) {
      const y = row * bh;
      let x = row % 2 === 0 ? -3 : -7;
      while (x < s) {
        const w = 7 + Math.floor(r() * 2);
        const c = cols[Math.floor(r() * cols.length)];
        rect(g, x + 1, y + 1, w - 1, bh - 1, p.dark);
        rect(g, x + 1, y, w - 2, bh - 1, c);
        rect(g, x, y + 1, w, bh - 3, c);
        rect(g, x + 2, y + 1, w - 4, 1, p.light);
        rect(g, x + Math.floor(w / 2), y + 1, 1, bh - 3, p.seam || p.dark);
        x += w;
      }
    }
  },

  /** Siepe / bosco: fogliame fitto a ciuffi tondi che sborda sui lati (il ritaglio lo tiene nel tile). */
  hedge(g, s, p, seed) {
    rect(g, 0, 0, s, s, p.dark);
    const r = rng(seed * 67 + 5);
    const n = p.blobs ?? 9;
    const pts = [];
    for (let i = 0; i < n; i++) pts.push({ x: r() * s, y: r() * s, rr: 2.5 + r() * (p.blobSize ?? 2.5) });
    for (const b of pts) disc(g, b.x + 0.7, b.y + 0.9, b.rr, p.shade || p.dark);
    for (const b of pts) disc(g, b.x, b.y, b.rr - 0.5, p.color);
    for (const b of pts) disc(g, b.x - 0.8, b.y - 0.8, Math.max(0.8, b.rr * 0.4), p.light);
    for (let i = 0; i < (p.berries ?? 0); i++) rect(g, Math.floor(r() * s), Math.floor(r() * s), 1, 1, p.berry || '#c03030');
  },

  /** Assi di legno (pavimento del casale): tavole orizzontali con venature e fughe. */
  planks(g, s, p, seed) {
    const r = rng(seed * 71 + 9);
    const h = 4;
    for (let y = 0; y < s; y += h) {
      rect(g, 0, y, s, h, r() < 0.3 ? p.alt || p.color : p.color);
      rect(g, 0, y + h - 1, s, 1, p.dark);
      rect(g, 0, y, s, 1, p.light);
      const j = Math.floor(r() * s);
      rect(g, j, y, 1, h - 1, p.dark);
      for (let i = 0; i < 3; i++) rect(g, Math.floor(r() * s), y + 1 + Math.floor(r() * 2), 2, 1, p.grain || p.dark);
    }
  },

  /** Campo coltivato: solchi orizzontali di terra con file di piante (grano o verde). */
  field(g, s, p, seed) {
    rect(g, 0, 0, s, s, p.soil);
    const r = rng(seed * 73 + 2);
    for (let y = 0; y < s; y += 4) {
      rect(g, 0, y + 3, s, 1, p.furrow || p.soil);
      for (let x = 0; x < s; x++) {
        if (r() < 0.15) continue;
        rect(g, x, y + 1, 1, 2, r() < 0.5 ? p.color : p.dark);
        if (r() < 0.35) rect(g, x, y, 1, 1, p.light);
      }
    }
  },

  /** Staccionata su erba: pali e due traverse; dir = "h" (orizzontale) o "v" (verticale). */
  fence(g, s, p, seed) {
    TILE_STYLES.grass(g, s, p, seed);
    const v = p.dir === 'v';
    const m = Math.floor(s / 2);
    for (const off of [-2, 2]) {
      if (v) {
        rect(g, m + off, 0, 1, s, p.rail);
        rect(g, m + off + 1, 0, 1, s, p.railDark);
      } else {
        rect(g, 0, m + off, s, 1, p.rail);
        rect(g, 0, m + off + 1, s, 1, p.railDark);
      }
    }
    for (const q of [3, s - 4]) {
      const x = v ? m - 2 : q - 1;
      const y = v ? q - 1 : m - 2;
      rect(g, x + 1, y + 1, 4, 4, p.postDark);
      rect(g, x, y, 4, 4, p.post);
      rect(g, x, y, 4, 1, p.postLight);
    }
  },
};

/** Genera un tileset in una riga: il tile con indice i sta alla colonna i. */
export function createTilesetPlaceholder(def) {
  const s = def.tileSize || 16;
  const tiles = def.tiles || [];
  const maxIndex = tiles.reduce((m, t) => Math.max(m, t.index ?? t.id), 0);
  const c = makeCanvas((maxIndex + 1) * s, s);
  const g = c.getContext('2d');
  for (const t of tiles) {
    const p = t.placeholder || {};
    const painter = TILE_STYLES[p.style] || TILE_STYLES.flat;
    g.save();
    g.translate((t.index ?? t.id) * s, 0);
    // ritaglio: un disegno che sborda (es. massi della roccia) non deve sporcare il tile accanto
    g.beginPath();
    g.rect(0, 0, s, s);
    g.clip();
    painter(g, s, p, t.id);
    g.restore();
  }
  return c;
}
