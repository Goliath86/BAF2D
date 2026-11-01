# CLAUDE.md — BAF2D

Sparatutto top-down in pixel-art per browser. Lingua di lavoro con l'utente: **italiano**.

## Vincoli di progetto (non negoziabili)

- **Solo JS vanilla + HTML5 Canvas + CSS.** Nessuna libreria esterna, nessun bundler, nessun `package.json`
  (è anche in `.gitignore`). ES modules nativi caricati da `index.html`.
- **Tutto configurabile via JSON**: parametri, sprite, tile, suoni, livelli, testi. Niente valori di gameplay
  "magici" nel codice se possono stare in `config/`.
- **Localizzazione obbligatoria**: ogni testo visibile al giocatore va in `config/lang/*.json` (default `en`, poi `it`).
  Aggiungere ogni nuova chiave a **tutti** i file lingua. Mai stringhe hardcoded in HTML/JS.
  Eccezioni ammesse: console, HUD di debug (F3), testo inglese di riserva degli errori di caricamento in `loader.js`.
- **Desktop**: tastiera + mouse. **Mobile**: solo landscape, due joystick virtuali
  (SX = movimento in spazio schermo su/giù/strafe; DX = mira, spinto oltre `fireThreshold` = fuoco).
- **Pixel-art nitida**: canvas di gioco a bassa risoluzione, scalato di un fattore intero.

## Avvio e verifica

- Server: `node tools/serve.mjs [porta]` (default 8080, ascolta anche in LAN per test da telefono).
  Aprire `index.html` da `file://` non funziona (fetch dei JSON).
- Test lingua: `?lang=it` nell'URL.
- Verifica rapida senza browser interattivo: Chrome headless con `--screenshot` e `--enable-logging=stderr`
  (gli errori di console compaiono nel log). Chrome: `C:\Program Files (x86)\Google\Chrome\Application\chrome.exe`.
- Controllo sintassi: `node --check <file.js>`. Chiudere il server di sviluppo a fine verifica.

## Git

- Claude fa **solo commit** (messaggi in italiano), **mai push**: lo fa l'utente con GitHub Desktop.
- `git` non è nel PATH: usare il git di GitHub Desktop
  (`%LOCALAPPDATA%\GitHubDesktop\app-<versione>\resources\app\git\cmd\git.exe`).
- Messaggi multiriga: scriverli su file e usare `git commit -F <file>`.

## Architettura

```
js/main.js            bootstrap: game.json -> i18n -> assets/livello -> Display/Assets/Audio/Input -> Game
js/engine/
  loader.js           loadJSON / loadImage / loadArrayBuffer (errori = LocalizedError)
  errors.js           LocalizedError(key, params, fallbackMessage)
  i18n.js             I18n: load(cfg), t(key, params), applyToDOM() per [data-i18n], error(e)
  display.js          canvas "game" low-res (scala intera, image-rendering: pixelated) + canvas "ui" nativo
  input.js            input unificato; mode 'desktop'|'touch' cambia con l'ultimo dispositivo usato
  touch.js            TouchSticks: stick dinamici, coordinate in px CSS, disegnati sul canvas ui
  assets.js           Assets (sprite/tileset), drawSprite(), Animator
  placeholders.js     grafica procedurale quando "src" è null o il file manca
  tilemap.js          TileMap da livello (righe di caratteri + legend), collisioni AABB asse per asse
  camera.js           follow con smoothing esponenziale + lookAhead verso la mira, clamp ai bordi
  audio.js            Web Audio; suoni da file o sintetizzati (square/sine/.../noise); unlock al primo gesto
js/game/
  game.js             loop a timestep fisso 60 Hz, proiettili, particelle, render, HUD debug
  player.js           movimento, mira, fuoco, animazione
config/
  game.json           parametri generali (display, i18n, player/weapon, input, camera, audio, mobile)
  assets.json         sprites / tilesets / sounds
  levels/*.json       livelli
  lang/*.json         testi
tools/serve.mjs       server statico (solo moduli Node built-in)
```

## Convenzioni e dettagli importanti

- Coordinate: mondo in pixel di gioco; `Display.cssToGame()` converte da `clientX/Y`. I joystick lavorano in px CSS.
- Render: la camera viene arrotondata (`Math.round`) prima di traslare; `drawSprite` arrotonda le posizioni.
- Sprite orientabili guardano a **destra** (angolo 0) e vengono ruotati liberamente (non a 8 direzioni).
- Spritesheet a griglia, frame numerati da sinistra a destra / dall'alto in basso; `origin` = punto di ancoraggio.
- Tile: `id`, `name`, `solid`, `index` opzionale (posizione nello sheet). Fuori mappa = solido.
- Livelli: `legend` mappa caratteri a nome/id del tile o a `{ "tile", "spawn" }`; `fill` completa righe corte.
- Collisioni: `moveAndCollide` presuppone spostamenti per tick < dimensione tile.
- `input.endFrame()` va chiamato a fine di ogni tick di update (azzera i `wasPressed`).
- Su touch in portrait il gioco è in pausa e compare l'overlay "ruota il dispositivo" (CSS + `Game.paused`).
- Il click/tocco di avvio fa `stopPropagation` per non sparare subito; fullscreen + lock landscape solo su touch.
- `window.BAF2D` espone l'istanza di `Game` per il debug da console.
- Commenti nel codice in italiano; messaggi di console per sviluppatori in inglese.

## Stato attuale

- Fatto: base rendering, movimento, collisioni, camera, controlli desktop/mobile, proiettili base,
  placeholder grafici e sonori, localizzazione en/it.
- Non ancora presenti: nemici, danni/vita, HUD di gioco, menu, selettore lingua in-game, asset grafici reali.
- I controlli touch non sono ancora stati verificati su un dispositivo reale.
