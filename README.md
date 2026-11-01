# BAF2D

Sparatutto top-down in pixel-art per browser. JavaScript vanilla (ES modules), HTML5 Canvas e CSS,
nessuna libreria esterna. Tutto il contenuto (sprite, tile, suoni, livelli, parametri) è configurato via JSON.

## Avvio

I file JSON vengono caricati con `fetch`, quindi serve un server HTTP (aprire `index.html` direttamente non funziona):

```
node tools/serve.mjs          # porta 8080 (oppure: node tools/serve.mjs 3000)
```

oppure `python -m http.server 8080`.

Apri `http://localhost:8080/`. Per provarlo su un telefono collegato alla stessa rete Wi-Fi usa l'indirizzo **LAN** stampato dal server.

## Controlli

| Desktop | Mobile (solo landscape) |
|---|---|
| WASD / frecce: muovi (su, giù, strafe) | Stick sinistro: muovi |
| Mouse: mira | Stick destro: mira |
| Click sinistro / Spazio: spara | Stick destro spinto oltre il cerchio tratteggiato: spara |
| F3: overlay di debug | |

La modalità (desktop/touch) cambia automaticamente in base all'ultimo input usato.
Su mobile, al primo tocco il gioco prova ad andare a schermo intero e a bloccare l'orientamento in landscape;
dove non è supportato (es. iOS Safari) in portrait compare un overlay "ruota il dispositivo" e il gioco va in pausa.

## Struttura

```
index.html, css/style.css, manifest.webmanifest
config/
  game.json            parametri generali (display, player, arma, input, camera, audio)
  assets.json          sprite, tileset e suoni
  effects.json         impatti dei colpi (buchi, fumo, scintille, schegge)
  levels/level01.json  livello di test
  lang/                testi localizzati (en.json = default, it.json)
js/
  main.js              bootstrap
  engine/              display, input, touch (joystick), assets, placeholder, tilemap, camera, audio, loader, i18n
  game/                game (loop, proiettili, render), player, effects (decal e particelle)
tools/serve.mjs        server statico di sviluppo (solo moduli Node built-in)
```

## Rendering pixel-art

Il gioco viene disegnato su un canvas a bassa risoluzione (altezza ≈ `display.targetHeight`, default 216 px)
e scalato di un fattore **intero** in pixel fisici con `image-rendering: pixelated`, quindi i pixel restano nitidi
su qualsiasi schermo. La larghezza si adatta all'aspect ratio. Joystick e HUD di debug sono disegnati su un
secondo canvas a risoluzione nativa.

## Configurazione

Tutti i percorsi sono relativi a `index.html`.

### Asset (`config/assets.json`)

Ogni sprite/tileset/suono può avere `"src"` (file reale) oppure `"src": null` per usare il **placeholder**
generato proceduralmente da `placeholder`. Se il file indicato in `src` non viene trovato si usa comunque il placeholder.

**Sprite**: spritesheet a griglia, frame numerati da sinistra a destra e dall'alto in basso.
Gli sprite orientabili (player, proiettile) devono guardare verso **destra**.

```json
"player": {
  "src": "assets/sprites/player.png",
  "frameWidth": 16, "frameHeight": 16,
  "origin": [8, 8],
  "animations": {
    "idle": { "frames": [0], "fps": 1 },
    "walk": { "frames": [1, 0, 2, 0], "fps": 10 }
  }
}
```

**Giocatore su due livelli**: `player.sprite` è il busto (ruota verso la mira), `player.legsSprite` (opzionale)
sono le gambe, che ruotano verso la direzione di marcia con animazioni `idle` e `walk`. Camminando all'indietro
rispetto alla mira (oltre `backpedalAngleDeg`) le gambe restano allineate al busto e il passo va al contrario.
Senza `legsSprite` si usa un unico sprite con le proprie animazioni `idle`/`walk`.

**Placeholder**: `placeholder.shape` sceglie il disegno procedurale (`soldier_body`, `soldier_legs`, `bullet`,
`hole`, `crosshair`, `circle`, `rect`, ...); i colori sono parametri nel JSON. `autoOutline` aggiunge un contorno
di 1px del colore indicato.

**Tileset**: tile quadrati di `tileSize` px; ogni tile ha `id`, `name`, `solid` e opzionalmente `index`
(posizione nello sheet, default = `id`).

**Suoni**: `src` (wav/mp3/ogg) e `volume`; il placeholder è un suono sintetizzato
(`wave`: `square`/`sine`/`triangle`/`sawtooth`/`noise`, `freqStart`, `freqEnd`, `duration`).

Ogni tile può avere `"impact"`: il tipo di effetto (in `effects.json`) quando viene colpito da un proiettile
(default `"wall"` per i tile solidi, `"ground"` per gli altri).

### Colpi ed effetti (`config/effects.json`)

La gittata di ogni colpo è decisa al momento dello sparo:

- **desktop (mouse)**: il colpo termina dove si trova il mirino, con imprecisione data da `weapon.spreadDeg`
  (angolo) e `weapon.rangeJitter` (± frazione della distanza);
- **touch** (o tastiera senza mouse): il colpo prosegue fino al bordo dello schermo visibile al momento dello sparo
  (meno `weapon.screenMargin` px).

A fine corsa si genera l'impatto del tile sottostante (es. `ground`); se prima incontra un tile solido,
l'impatto del muro (es. `wall`, `wood`). Ogni impatto in `effects.json` definisce:

- `decal`: sprite del buco (`sprite`), durata in secondi (`life`) e durata della dissolvenza finale (`fade`);
  se lo sprite ha più frame, ne viene scelto uno a caso come variante;
- `sound`: suono da `assets.json`;
- `emitters`: lista di emettitori di particelle (fumo, scintille, schegge, polvere) con
  `count`, `colors`, `speed`, `life`, `size` ([iniziale, finale]), `drag`, `rise` (deriva verso l'alto, per il fumo),
  `spreadDeg` (cono attorno alla normale della superficie; sul terreno l'emissione è a 360°), `alpha`, `fade`.
  I valori numerici accettano un numero o un intervallo `[min, max]`.

`maxDecals` e `maxParticles` limitano gli elementi contemporanei.

### Livelli (`config/levels/*.json`)

La mappa è un array di stringhe; `legend` associa ogni carattere a un tile (per nome o id) e, opzionalmente, a uno spawn:

```json
"legend": {
  ".": "floor",
  "#": "wall",
  "P": { "tile": "floor", "spawn": "player" }
}
```

`fill` è il tile usato per completare righe più corte. Fuori dalla mappa tutto è considerato solido.

### Localizzazione (`config/lang/*.json`)

Tutti i testi visibili stanno in un file JSON per lingua (`en.json`, `it.json`, ...), con chiavi annidate
(`"start": { "tapToStart": "..." }` → chiave `start.tapToStart`) e segnaposto `{nome}`. Per andare a capo usa `\n`.

Configurazione in `game.json`:

```json
"i18n": {
  "default": "en",
  "language": "auto",
  "available": ["en", "it"],
  "path": "config/lang/{lang}.json"
}
```

Scelta della lingua, in ordine: parametro URL `?lang=it` → `language` (se diverso da `"auto"`) →
lingue del browser → `default`. Le chiavi mancanti in una lingua ricadono su quella di default.

- **Aggiungere una lingua**: copia `en.json` in `xx.json`, traducilo e aggiungi `"xx"` ad `available`.
- **HTML**: usa l'attributo `data-i18n="chiave"`, il testo viene inserito all'avvio.
- **Codice**: `i18n.t('chiave', { param: valore })` (disponibile anche come `game.i18n`).
- **Errori**: lancia `new LocalizedError('errors.chiave', { ... })` (`js/engine/errors.js`).

Unica eccezione: gli errori di caricamento hanno un testo inglese di riserva nel codice, perché possono
verificarsi prima che i file lingua siano disponibili (es. gioco aperto senza server).

### Parametri principali (`config/game.json`)

- `display.targetHeight`: altezza virtuale in pixel di gioco.
- `player.speed` (px/s), `player.hitbox`, `player.faceMoveWhenIdle` (su touch, senza mira, il personaggio guarda dove cammina),
  `player.legsSprite`, `player.legsTurnSpeed`, `player.backpedalAngleDeg`.
- `player.weapon`: `fireRate` (colpi/s), `bulletSpeed`, `spreadDeg`, `rangeJitter`, `minRange`, `maxRange`,
  `screenMargin`, `muzzleOffset`, `sound`.
- `input.keyboard`: mappatura azioni → `KeyboardEvent.code`.
- `input.touch`: `radius` (frazione del lato corto dello schermo), `deadZone`,
  `moveCurve` (risposta dello stick sinistro: la velocità è proporzionale allo spostamento; 1 = lineare,
  > 1 più precisione alle basse velocità), `fireThreshold`
  (frazione del raggio oltre la quale si spara), `dynamic` (lo stick nasce dove appoggi il dito), `opacity`.
- `camera.smoothing`, `camera.lookAhead` (px di anticipo nella direzione di mira).
- `mobile.requestFullscreen`, `mobile.lockLandscape`.
