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

## Asset con licenza (CraftPix)

- Gli asset acquistati (CraftPix) vanno in `assets/licensed/`, cartella esclusa da git: **mai committarli**
  né spostarli altrove nel repo (la licenza vieta la distribuzione dei file sorgente PNG ecc.).
- Il repo deve funzionare anche senza: se un `src` non esiste il motore usa il placeholder.
- La licenza CraftPix vieta l'uso degli asset per sviluppare/testare/migliorare sistemi AI: **non aprire/visualizzare
  le immagini** in `assets/licensed/`. Per dimensioni e numero di frame chiedere all'utente o leggere solo i metadati
  (larghezza/altezza) del file senza guardarne il contenuto.

## Avvio e verifica

- Server: `node tools/serve.mjs [porta]` (default 8080, ascolta anche in LAN per test da telefono).
  Aprire `index.html` da `file://` non funziona (fetch dei JSON).
- Test lingua: `?lang=it` nell'URL.
- Verifica rapida senza browser interattivo: Chrome headless con `--screenshot` e `--enable-logging=stderr`
  (gli errori di console compaiono nel log). Chrome: `C:\Program Files (x86)\Google\Chrome\Application\chrome.exe`.
- Test di input/gameplay: Chrome headless con `--remote-debugging-port=9222` + script Node (WebSocket globale) che usa
  CDP (`Input.dispatchMouseEvent`, `Runtime.evaluate` su `window.BAF2D`, `Page.captureScreenshot`). Nel rilascio del
  mouse passare `button: 'left'`, altrimenti il tasto resta premuto. Script di test nello scratchpad, non nel repo.
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
  touch.js            TouchSticks: stick dinamici + pulsanti tondi (azioni), px CSS, disegnati sul canvas ui
  assets.js           Assets (sprite/tileset), drawSprite(), Animator
  placeholders.js     grafica procedurale quando "src" è null o il file manca
  tilemap.js          TileMap da livello (righe di caratteri + legend), collisioni AABB asse per asse
  camera.js           follow con smoothing esponenziale + lookAhead verso la mira, clamp ai bordi
  audio.js            Web Audio; suoni da file o sintetizzati (square/sine/.../noise); unlock al primo gesto
js/game/
  game.js             loop a timestep fisso 60 Hz, proiettili (gittata + impatti), render, HUD debug
  player.js           movimento, mira, fuoco (auto/semiauto), animazione, equip(id) dell'arma
  weapons.js          Weapons: catalogo da weapons.json (defaults + voce), get(id)/ids
  hud.js              Hud: vita (alto sx) + arma/munizioni/ricarica (alto dx) sul canvas ui
  effects.js          Effects: decal con fade (buchi), particelle (fumo/scintille/schegge), impact(type, ...),
                      bossoli espulsi casing(type, ...)
config/
  game.json           parametri generali (display, i18n, player + id arma iniziale, input, camera, audio, mobile)
  weapons.json        armi: "defaults" + "weapons" { id: { name, bodySprite, pickupSprite, auto, pellets, ... } }
  assets.json         sprites (anche "extends") / tilesets (con "impact" per tile) / sounds
  effects.json        tipi di impatto (decal + emitters + sound) e tipi di bossolo ("casings")
  levels/*.json       livelli
  lang/*.json         testi
tools/serve.mjs       server statico (solo moduli Node built-in)
```

## Convenzioni e dettagli importanti

- Coordinate: mondo in pixel di gioco; `Display.cssToGame()` converte da `clientX/Y`. I joystick lavorano in px CSS.
- Render: la camera viene arrotondata (`Math.round`) prima di traslare; `drawSprite` arrotonda le posizioni.
- Sprite orientabili guardano a **destra** (angolo 0) e vengono ruotati liberamente (non a 8 direzioni).
- Giocatore su due livelli: gambe (`legsSprite`, ruotano verso il movimento, passo al contrario in retromarcia)
  sotto il busto (`sprite`, ruota verso la mira). La grafica attuale è procedurale (`soldier_body`/`soldier_legs`
  in `placeholders.js`, colori in `assets.json`): l'utente preferisce grafica creata via canvas.
- Armi: il busto dipende dall'arma (`bodySprite`, es. `soldier_rifle/pistol/shotgun`, che estendono lo stesso sprite
  cambiando `placeholder.weapon`; disegni in `GUNS`/`GRIPS` di `placeholders.js`). `player.equip(id)` cambia arma e
  restituisce `{ id, ammo }` della precedente (pensato per la raccolta da terra; `pickupSprite` già definito);
  `equip(id, ammo)` accetta i colpi nel caricatore. F4 = arma successiva (debug). Semiautomatiche: la pressione
  durante il cooldown resta in coda; su touch `holdToRepeat`.
- Munizioni/ricarica: `magazine`, `reloadTime`, `reloadSound`, `emptySound`, `reloadMoveFactor` (0 = fermo),
  `autoReload`, `damage` (salvato su ogni proiettile, `bullet.damage`, per i futuri bersagli). Azione `reload`:
  tasto R o pulsante touch. Animazione `reload` del busto riprodotta con `Animator.setProgress()` (dura sempre
  `reloadTime`); frame procedurali via `reloadPose()` in `placeholders.js`. Il cambio arma annulla la ricarica
  e ferma il suo suono (`audio.play()` restituisce `{ stop() }`).
- Pulsanti touch (`input.touch.buttons`): la chiave è l'azione, `input.wasPressed(azione)` li legge insieme
  alla tastiera; posizione relativa alla posizione di riposo di uno stick; il gioco passa lo stato da disegnare
  (`label`, `progress`, `alert`) a `sticks.draw(ui, state)`. Tocco sul pulsante = niente stick.
  Pulsanti con `debugOnly: true` solo con `?debug=1` nell'URL (main.js -> `new Input(..., { debug })`):
  `debugHurt`/`debugHeal` sopra lo stick sinistro, per testare vita e game over su telefono.
- HUD: disegnato sul canvas `ui` ma in unità di pixel di gioco (`u = display.cssPerPixel`, rettangoli a multipli
  di u) per restare in stile pixel-art; testi con font reale (nomi armi tradotti) e ombra di 1 pixel di gioco.
  In alto per non coprire gli stick su mobile; l'overlay F3 va sotto (`hud.topHeight()`). Vita: `player.health`,
  `maxHealth`, `damage(n)`, `heal(n)` (non resuscita), `dead`. F5/F6 = danno/cura (debug).
- Morte: `Player.update` non fa nulla da morto, `draw` usa `deadSprite` ruotato di `deathAngle`. `Game` crea
  `this.over` (pozza `blood_pool` + arma caduta), dopo `gameOver.delay` chiama `onGameOver` (main.js mostra
  `#overlay-gameover` e mette `body.game-over` = filtro CSS sul canvas di gioco). `restart()` (clic/tocco
  sull'overlay o azione `confirm` = Invio) funziona solo dopo `restartDelay`; `_reset()` ricrea Player e Hud,
  svuota proiettili/effetti e chiama `onRestart`. Game resta senza DOM: l'interfaccia HTML è in main.js.
- Sprite con `extends`: ereditano tutto tranne `src`, `placeholder` fuso campo per campo.
- Movimento touch analogico: lunghezza vettore stick SX (dopo deadzone, elevata a `moveCurve`) × `speed`.
- `Animator.update(dt)` accetta dt negativo (animazione all'indietro).
- Spritesheet a griglia, frame numerati da sinistra a destra / dall'alto in basso; `origin` = punto di ancoraggio.
- Tile: `id`, `name`, `solid`, `index` opzionale (posizione nello sheet). Fuori mappa = solido.
- Livelli: `legend` mappa caratteri a nome/id del tile o a `{ "tile", "spawn" }`; `fill` completa righe corte.
- Collisioni: `moveAndCollide` presuppone spostamenti per tick < dimensione tile.
- Colpi: la gittata si fissa allo sparo. Desktop con mouse = distanza dal mirino (± `rangeJitter`, angolo ± `spreadDeg`);
  touch o senza mouse = fino al bordo schermo di quel momento (`screenMargin`). Fine corsa = impatto del tile a terra;
  tile solido prima = impatto muro (buco spostato di `WALL_DECAL_INSET` px dentro la faccia colpita, particelle lungo la normale).
  I proiettili avanzano a sotto-passi da 2px per non attraversare i muri.
- Bossoli: arma con `casing` (tipo in `effects.json` -> `casings`), `casingPort` = [avanti, lato] in px dello sprite
  (lato + = destra del soldato), `casingDelay` (pompa: espulsione dopo lo sparo, annullata da `equip`).
  Quota `z` simulata (gravità, rimbalzi, attrito, rimbalzo sui tile solidi), eredita parte della velocità del giocatore
  (`inherit`), suono al primo contatto col suolo, poi fermo e svanisce (`life`/`fade`). Disegno in due passate:
  a terra sotto il giocatore, in volo sopra (con ombra di 1 px). Sprite procedurali `casing` in `placeholders.js`.
  Stesso sistema per il caricatore che cade in ricarica: `reloadDrop` (tipo in `casings`, es. `mag_rifle`),
  `reloadDropAt` (frazione della ricarica; fucile 0.3 = quando sparisce dallo sprite), `reloadDropPort`.
  `Player._eject(game, type, port)` è il punto unico di uscita degli oggetti dall'arma.
- `input.endFrame()` va chiamato a fine di ogni tick di update (azzera i `wasPressed`).
- Su touch in portrait il gioco è in pausa e compare l'overlay "ruota il dispositivo" (CSS + `Game.paused`).
- Il click/tocco di avvio fa `stopPropagation` per non sparare subito; fullscreen + lock landscape solo su touch.
- `window.BAF2D` espone l'istanza di `Game` per il debug da console.
- Commenti nel codice in italiano; messaggi di console per sviluppatori in inglese.

## Stato attuale

- Fatto: base rendering, movimento, collisioni, camera, controlli desktop/mobile, proiettili con gittata
  (mirino su desktop, bordo schermo su touch) e impatti (buchi con fade, fumo, scintille, schegge),
  placeholder grafici e sonori, localizzazione en/it, catalogo armi (pistola, fucile, pompa) con cambio arma,
  caricatore e ricarica (R / pulsante touch), bossoli espulsi e caricatori che cadono in ricarica, danno per arma, vita del giocatore, HUD (vita, arma, munizioni), morte con schermata di game over e riavvio.
- Non ancora presenti: raccolta armi da terra, riserva di munizioni (ora infinita), nemici, menu, selettore lingua in-game, asset grafici reali.
- Controlli touch (stick + pulsante ricarica) verificati dall'utente su un dispositivo reale (2026-11-02).
