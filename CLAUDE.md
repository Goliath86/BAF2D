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
js/main.js            bootstrap: game.json -> Settings -> i18n -> assets/livelli -> Display/Assets/Audio/Input -> Game -> Menu
js/menu.js            Menu (DOM): principale/nuova partita/opzioni/pausa/fine partita, partita dimostrativa dietro
js/settings.js        Settings: impostazioni del giocatore in localStorage (lang, volume, keys, newGame)
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
  grenades.js         GrenadeTypes (catalogo da weapons.json) + Grenades: volo con quota z, rimbalzi, spoletta
  hud.js              Hud: vita + granate (alto sx) + arma/munizioni/ricarica (alto dx) sul canvas ui
  effects.js          Effects: decal con fade (buchi), particelle (fumo/scintille/schegge), impact(type, ...),
                      bossoli espulsi casing(type, ...), esplosioni explosion(type, x, y, map)
  ctf.js              Ctf: modalità Capture The Flag (bandiere, catture, ticket, punti di rientro, disegno pennoni)
  nav.js              Nav: griglia dei tile per l'IA (A* 8 direzioni + percorso 'tirato', reach() = Dijkstra limitato, los)
  ai.js               Squad (lavagna di squadra: bot, nemici avvistati) + BotBrain (IA di un bot -> comandi come l'umano)
  scores.js           Scores: record per combattente, punti (kill/assist/defend/capture/...), classifica
  vehicles.js         VehicleTypes (config/vehicles.json) + Vehicle (guida, torretta, armi, danni, carcassa)
  vehicle_ai.js       VehicleBrain: IA di guida dei bot (bandiere, mitragliatrice/razzi, sblocco)
  rockets.js          RocketTypes (weapons.json -> rockets) + Rockets (razzi con scia, esplodono -> Game.explode)
  props.js            Props: decorazioni della mappa (palme overhead, cespugli/sassi a terra, ombre, oscillazione col vento)
  weather.js          Weather: vento con raffiche, granelli, lingue di sabbia, velature, tinta (effects.json -> weather)
  pickups.js          Pickups: armi/granate a terra (lasciate dai caduti o da punti fissi della mappa con respawn)
  ranks.js            Ranks (gradi da game.json -> ranks, insegne a pixel in canvas) + Career (xp in localStorage)
config/
  game.json           parametri generali (version, levels, menu, display, i18n, player + arma iniziale, input,
                      camera, audio, mobile, teams, ctf, death, matchEnd, hud, combat, bots)
  weapons.json        armi: "defaults" + "weapons" { id: { name, bodySprite, pickupSprite, auto, pellets, ... } };
                      granate: "grenadeDefaults" + "grenades" { id: { fuse, lift, bounce, damage, explosion, ... } }
  assets.json         sprites (anche "extends") / tilesets (con "impact" per tile) / sounds
  effects.json        tipi di impatto (decal + emitters + sound), di bossolo ("casings"), di vampata ("muzzles")
                      e di esplosione ("explosions")
  levels/*.json       livelli
  lang/*.json         testi
tools/serve.mjs       server statico (solo moduli Node built-in)
tools/gen_desert.mjs  genera config/levels/level03.json (deserto 97x65, simmetrico, verifica raggiungibilità)
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
- Modalità principale = **Capture The Flag** (`js/game/ctf.js`, `game.json` -> `teams`/`ctf`). Squadre `blue`/`red`;
  `player.team`, F8 = cambia squadra (debug, `Game._cycleTeam`). Bandiera: `owner` (conta per ticket e rientro),
  `color` (null = bianca), `claimant` (chi la issa), `progress` 0..1 (altezza del drappo). Una sola squadra nell'area
  (`radius`, linea di vista se `requireSight`): se è la claimant sale (`captureTime`, in cima diventa owner), altrimenti
  scende col colore vecchio (`neutralizeTime`) e a terra passa alla nuova squadra (una bandiera colorata non torna
  bianca); più squadre = contesa, ferma. Eventi `captured`/`neutralized` -> `Game._onFlagEvent` (suono + `hud.notify`
  dal punto di vista del giocatore). Ticket: `ticketsPerDeath` (`ctf.onDeath`) + calo ogni `bleed.interval`
  (`advantage` = differenza di bandiere, `enemyFlags`). `ctf.update(dt, units)` vuole unità `{ x, y, team, dead }`:
  oggi solo `[player]`, pronto per i bot. Livello: legend `{ "tile", "flag": "A" }`, spawn = nome squadra, `flags`
  = owner iniziale + override per bandiera. Pennone disegnato a runtime (vista laterale), ordinato per y col giocatore;
  area a terra = canvas in cache per raggio/colore.
- Squadre negli sprite: `"teamColored": true` in assets.json -> `Assets.load(cfg, teams)` genera `nome@squadra`
  (placeholder con `team`/`teamDark`/`teamLight`, `{team}` nel src); `assets.sprite(nome, team)` sceglie la variante.
  Soldato procedurale: striscia sull'elmetto (`teamStripe`) + mostrine sulle spalle.
- Morte e rientro: `Player.update`/`draw` non fanno nulla da morto. `Game._onPlayerDeath` crea un cadavere in
  `this.corpses` (corpo `deadSprite` + pozza, max `death.maxCorpses`, spariscono dopo `corpseTime` s con dissolvenza
  `corpseFade`; arma e granate diventano pickup), toglie i ticket e avvia
  `this.respawn`; dopo `death.respawnDelay` un nuovo Player rientra con `ctf.spawnPoint(team, puntoMorte)` (bandiera
  posseduta non contesa più vicina o base). HUD: ticket + bandiere in alto al centro, stato cattura, messaggi, scritta
  di rientro.
- Fine partita: `ctf.result` -> `Game.ended` (`outcome` victory/defeat/draw), dopo `matchEnd.delay` chiama
  `onMatchEnd(outcome)` (Menu riempie `#overlay-matchend` e mette `body.match-over match-<outcome>` = filtro CSS).
  `restart()` (pulsante Rivincita o `confirm` = Invio) solo dopo `restartDelay`; `_reset()` azzera ctf, ricrea
  squadre, Player e Hud, svuota proiettili/effetti/cadaveri e chiama `onRestart`. Game resta senza DOM: l'HTML è in menu.js.
- Partita: `game.setup({ level, team, allies, enemies, tickets, attract })` (tickets = override di `ctf.tickets`, dal menu) (JSON del livello già caricato, bot per squadra in
  `botCounts`); il costruttore di Game non crea mappa né partita (`render` non disegna nulla finché `map` è null).
  `attract: true` = partita dimostrativa dietro al menu: anche il giocatore ha un `BotBrain` (`playerBrain`), niente
  HUD/mirino/stick, audio muto (`audio.setMuted`), a fine partita ricomincia da sola. `game.viewOffsetX` (px di gioco)
  sposta la visuale a destra del pannello (`menu.attract.panelOffset` × larghezza pannello). Pausa = `game.suspended`
  (niente update, scena disegnata), input disabilitato.
- Menu (`menu.js`, config `game.json -> menu`): schermate = `<section data-screen>` in index.html, pila `stack` con
  "Indietro"/Esc; `mode` = menu/playing/paused/ended. Livelli in `game.json -> levels` (`{ id, file }`, nomi/descrizioni
  in `levels.<id>.name/description` delle lingue), anteprime dal canvas pre-renderizzato del TileMap. Mappa procedurale:
  card disabilitata "prossimamente" (`menu.procedural`). Lingua a runtime: `i18n.setLanguage(lang)` (+ `applyToDOM`,
  supporta anche `data-i18n-title`). Tasti: `input.setBindings(custom)` sopra i default, azioni modificabili in
  `input.rebindable` (Canc = rimuovi, Esc = annulla; i tasti di azioni non modificabili non si assegnano). Input non
  fa `preventDefault` da disabilitato (i pulsanti HTML ricevono Invio/Spazio). Tasto `pause` (Esc/P) gestito dal Menu
  in capture; su touch `#pause-button` sotto l'HUD.
- Versione del gioco: `game.json -> version` (in basso a destra nel menu).
- Controllo dei soldati: `Player.update(dt, game, ctrl)` con `ctrl = { move, aim(unit), firing, reload, grenade,
  repeat, faceMove }`: dall'umano (`Game._humanControl`) o dall'IA (`BotBrain.think`). `game.units` = giocatore + bot.
- Bot (`game.json` -> `bots`, IA in `bots.ai`): `Game.bots` = slot `{ team, weapon, unit, brain, respawn }`; rientro con
  `ctf.spawnPoint(team, near, hw, hh, { preferFlags, spread })` (bandiera posseduta, base solo se nessuna). BotBrain:
  modo `objective` (bandiere da catturare, poi presidio) o `combat` con ruolo `fix`/`flank` e fasi
  `expose`/`cover`/`peek`; spara solo con bersaglio in vista (dopo `reactionTime`), poi fuoco di copertura
  su `suppressPoint` per `suppressTime`; avvisa i compagni liberi entro `commRadius` (`receive` -> aggiramento).
  Colpi dei bot: `unit.aimDistance` = distanza dal punto mirato -> gittata (+ `shotOvershoot`), quindi colpiscono
  o cadono vicino al bersaglio. Proiettili con `team`/`owner`: `_unitHit` (hitbox + `combat.hitPadding`, niente
  fuoco amico), a fine corsa `_hitJustBeyond` (`endHitReach`). Granate dei bot: `BotBrain._considerGrenade` ->
  `throwPlan` (mira al punto, poi `ctrl.grenade`), gittata in `unit.throwDistance` (letta da `Game.throwGrenade` per
  `isBot`); `_grenadeDanger` -> `evade` (fuga, ha la precedenza su combattimento/obiettivo, niente fuoco):
  punto d'arresto stimato con `_grenadeRest` (volo + rotolamento), distanza `_grenadeSafeRadius`, la fuga
  continua fino al punto scelto (ricalcolato ogni 0,25 s). `player.damage(n, { unit, x, y })` -> `hurtBy` letto
  dall'IA. Esplosioni feriscono tutte le unità. F3 disegna percorsi/coperture dei bot.
- Punteggi (`scores.js`, `game.json -> scoring`): `game.scores` ha un record per combattente (`unit.combatant`,
  persistente tra i rientri: `game.playerRecord`, `slot.record` dei bot, nomi da `i18n.list('scoreboard.botNames')`).
  `Player.damage` registra `damageLog` (assist) e `killer` (`source.by ?? source.unit`; le granate passano
  `by: owner` lasciando `unit: null` per l'IA). `scores.onDeath(unit, ctf)` va chiamato quando si rileva la morte
  (giocatore e bot), `onFlagEvent(e)` in `_onFlagEvent`, `endMatch(winner)` in `_endMatch`. Ogni assegnazione chiama
  `Game._onAward`: solo per il giocatore umano (non attract) popup HUD + `career.add(n)` (salvato subito) + promozioni.
- Gradi (`ranks.js`, `game.json -> ranks`): `Ranks.progress(xp)`, `insignia(i)` = canvas a 1 px/pixel di gioco con
  contorno (HUD lo scala di `u`, il menu lo copia in un `<canvas class="insignia">`). `Career` creata in main.js
  con Settings (chiave `career: { xp }`) e passata a Game (`game.career`, `game.ranks`). HUD: `hud.popup(text)`,
  `hud.promote({ name, insignia })`, blocco grado sotto le granate (`mode.rank`; `topHeight` ne tiene conto).
  Fine partita: `game.matchSummary` -> `Menu._renderScoreboard` / `_renderCareer` (anche nel menu principale).
  F9 = +`points.debug` punti. Soglie tarate con partite simulate (~4000-6000 punti a partita per soldato).
- Oggetti a terra (`pickups.js`, `game.json -> pickups`): `_makeCorpse` chiama `pickups.dropWeapon/dropGrenades`
  (il cadavere non ha più l'arma disegnata). Punti fissi da legend `{ "tile", "pickup": tipo }` (`TileMap.pickups`,
  tipi in `pickups.types`). `Game._updatePickups`: granate automatiche per tutte le unità, `pickupOffer` = arma
  raccoglibile dal giocatore umano -> azione `pickup` (E/F, pulsante touch con `hidden` gestito da `state.hidden`)
  -> `_swapWeapon` (equip + vecchia arma a terra). `keyName(code, i18n)` in input.js (usato da menu e HUD).
  Bot: `BotBrain._weaponTick` sceglie `weaponGoal` (valore `weaponValues` + `weaponBias` personale), ci va e
  imposta `pickupNow`; `Game._updatePickups` fa lo scambio per bot e `playerBrain` (dopo `_updateBots`).
- Mezzi (`vehicles.js`, `config/vehicles.json`, caricato da main.js -> `VehicleTypes`; `game.vehicles`,
  `game.vehicleSpawns` dalla legend `{ "tile", "vehicle", "team", "angleDeg" }` -> `TileMap.vehicles`). Un soldato a
  bordo ha `unit.vehicle` (posizione sincronizzata da `Game._syncDriver`, non disegnato, escluso da colpi/esplosioni/
  percezione IA/raccolta granate); il mezzo prende la squadra del pilota. Comandi del mezzo
  `{ move, aim(v), firing, secondary, reload }`: umano `_humanVehicleControl`, bot `unit.vehicleBrain`
  (`VehicleBrain`, cfg `bots.ai.vehicle`). Salita/discesa: azione `pickup` (precedenza sui mezzi) ->
  `_enterVehicle` / `_exitVehicle`; i bot impostano `brain.enterNow` (`BotBrain._boardTick`, cfg `bots.ai.vehicles`).
  Armi del mezzo = voci di weapons.json con `vehicleOnly` (stato in `vehicle.guns`), sparano con
  `Game.fireVehicle` -> `Game.fire(shooter)`: `shooter` = Player o oggetto `{ weapon, angle, muzzle, x, y, team,
  aimDistance, owner, fromVehicle }`. Corazza (`armor`): i proiettili fanno solo l'impatto `metal`; danni da
  `Game.explode` (× `vehicleFactor` del def: granate 0.4, razzi 1.2-1.5) e `directDamage` dei razzi; `v.lastHitBy`
  riceve il merito (`scoring.points.vehicle`). `_destroyVehicle`: esplosione `blast`, pilota ucciso, carcassa
  (`wreckTime`), rientro dopo `respawn` s; mezzo vuoto lontano dalla base per `abandonTime` s = rimosso e ricreato.
  `_vehicleContacts`: soldati spinti fuori (o investiti, `runover`), mezzi separati. Percorsi dei mezzi:
  `nav.findPath(..., minClear = nav.clearanceFor(hw))` (`Nav.clear` = distanza dai solidi).
- Razzi (`rockets.js`): arma con `projectile: "rocket"` + `rocket` (tipo in weapons.json -> `rockets`); gittata come i
  proiettili (`Game._shotRange`), scia `effects.json -> trails`; IA: armi `antiVehicle` mirano ai mezzi, mai sotto
  `minSafeRange`; senza anticarro la fanteria si ripara (`BotBrain._vehicleDanger`).
- Suoni continui: `audio.loop(nome)` -> `{ set(rpm 0..1, pos), stop() }` (def.loop sintetizzato o src in loop),
  `audio.stopLoops()` (anche con `setMuted(true)`). Motori: `Game._updateEngines` (mezzi guidati e udibili,
  `vehicle.rpm`), `_silenceEngines` in pausa (ciclo di `start()`) e in `_reset`.
- Audio posizionale: `audio.play(nome, { x, y })` attenua con la distanza da `audio.listener` (centro visuale,
  `audio.hearing.near/far`).
- Sprite con `extends`: ereditano tutto tranne `src`, `placeholder` fuso campo per campo.
- Movimento touch analogico: lunghezza vettore stick SX (dopo deadzone, elevata a `moveCurve`) × `speed`.
- `Animator.update(dt)` accetta dt negativo (animazione all'indietro).
- Spritesheet a griglia, frame numerati da sinistra a destra / dall'alto in basso; `origin` = punto di ancoraggio.
- Tile: `id`, `name`, `solid`, `index` opzionale (posizione nello sheet). Fuori mappa = solido.
  `shootThrough` = solido per il movimento ma non per colpi/vista: per proiettili, linee di vista (IA, bandiere,
  esplosioni), granate, bossoli e particelle usare `map.blocksShotAt/blocksShotTile`, per il movimento
  `isSolidAt`/`rectHitsSolid`. Prerender del TileMap: tile, poi `edge` (bordi tra gruppi, `_drawEdges`), poi
  ombre dei tile che bloccano i colpi (`tileset.shadow`, `_drawShadows`). Ogni tile placeholder è ritagliato
  nel suo riquadro. Legend: liste di varianti (`cellRandom(x, y, salt)` stabile), `prop`, `pickup`.
- Livello: `weather` (tipo in effects.json -> weather; `game.weather`, `effects.wind` per il fumo) e `background`.
  Ordine di disegno: mappa, decal, props a terra (+ ombre), lingue di sabbia, ..., soldati, ..., esplosioni,
  props overhead, granelli/velature, poi tinta a schermo.
- Livelli: `legend` mappa caratteri a nome/id del tile o a `{ "tile", "spawn" }` / `{ "tile", "flag" }`
  (`TileMap.spawns`, `TileMap.flags`); `fill` completa righe corte.
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
- Vampata di volata: arma con `muzzleFlash` (tipo in `effects.json` -> `muzzles`): `sprite` (procedurale
  `muzzle_flash`, volata = bordo sinistro a metà altezza, 3 varianti), `life` (pochi centesimi di s), `glow`
  (alone additivo a `bands` dischi concentrici: `color`, `alpha`, `radius`, `offset`) ed `emitters` (fumo/scintille,
  diretti lungo la canna con `spreadDeg`). Creata in `Game.fire()` al `player.muzzle`, non se la canna è in un muro.
  Disegnata sopra proiettili, sotto le particelle.
- Granate: azione `grenade` (G / pulsante touch con `badge` = scorta e `disabled`), `player.grenades` (iniziale
  `player.grenades` = 2, `maxGrenades`, `addGrenades(n)`, F7 = +1 debug), niente lancio in ricarica né durante
  `throwCooldown`. `Game.throwGrenade()`: su desktop con mouse la velocità è calcolata perché il primo contatto col
  suolo sia sotto il mirino (`Grenades.flightTime`), su touch a `defaultRange`. Fisica come i bossoli (quota z,
  `bounce`/`friction` a terra, `wallBounce` sui tile solidi con `radius`), spia `blinkColor`. Allo scadere di `fuse`
  `Game.explode()`: `effects.explosion()`, scossa camera (`shake`, offset intero applicato in render), danno al
  giocatore con decadimento lineare in `blastRadius` e linea di vista (`_lineOfSight`, i muri riparano).
- Esplosioni (`effects.json` -> `explosions`): `decal` con `clipSolid` (bruciatura pre-ruotata su canvas proprio e
  cancellata sui tile solidi), `fireball` (sprite procedurale `explosion`, frame lungo `duration`), `glow`,
  `emitters` a 360° (particelle con `round`, `streak`, `collide`), `debris` = tipi di `casings` lanciati a 360°
  (`ejectDeg`/`spreadDeg` 0). Disegno: palle di fuoco sopra le particelle (il fumo non copre il nucleo).
- Suoni: `placeholder` può essere una lista di strati (ognuno con `volume` relativo).
- `input.endFrame()` va chiamato a fine di ogni tick di update (azzera i `wasPressed`).
- Su touch in portrait il gioco è in pausa e compare l'overlay "ruota il dispositivo" (CSS + `Game.paused`).
- Si avvia dal pulsante "Inizia" (evento `click`, dopo il rilascio: non spara); i pulsanti sopra al gioco
  (pausa, fine partita) fermano il `pointerdown` per non sparare/aprire stick. Fullscreen + lock landscape solo su
  touch (primo tocco nel menu e "Inizia"). `window.BAF2D_MENU` = istanza del Menu.
- `window.BAF2D` espone l'istanza di `Game` per il debug da console.
- Commenti nel codice in italiano; messaggi di console per sviluppatori in inglese.

## Stato attuale

- Fatto: base rendering, movimento, collisioni, camera, controlli desktop/mobile, proiettili con gittata
  (mirino su desktop, bordo schermo su touch) e impatti (buchi con fade, fumo, scintille, schegge),
  placeholder grafici e sonori, localizzazione en/it, catalogo armi (pistola, fucile, pompa) con cambio arma,
  caricatore e ricarica (R / pulsante touch), bossoli espulsi e caricatori che cadono in ricarica, vampata di volata con fumo, danno per arma, vita del giocatore, HUD (vita, granate, arma, munizioni), granate (rimbalzi, esplosione con bruciatura, fumo, schegge, detriti, scossa, danno),
  modalità Capture The Flag (squadre blu/rossa con segni sui soldati, bandiere catturabili, ticket con calo per
  morti e bandiere, rientro alla bandiera più vicina o alla base, cadaveri che svaniscono dopo qualche secondo, vittoria/sconfitta e nuova partita),
  squadra avversaria IA (cattura bandiere, coperture, fuoco di copertura, aggiramento coordinato, ricarica, granate e fuga dalle granate),
  menu desktop/mobile (nuova partita con mappa/squadra/numero di bot, opzioni lingua/volume/tasti, pausa,
  rivincita), seconda mappa "Crocevia" (5 bandiere, simmetrica), terza mappa "Villaggio nel deserto" (97x65,
  tileset deserto procedurale, palme/cespugli, vento con sabbia che si muove, acqua, muretti, case in rovina,
  strade larghe per i futuri mezzi), punteggi con classifica di fine partita
  (nomi fittizi per i bot), 18 gradi con insegne a pixel, promozioni in partita e carriera salvata in localStorage.
- Fatto anche: raccolta di armi (scambio con E, anche i bot) e granate da terra, punti fissi con respawn sulle mappe.
- Non ancora presenti: mappa procedurale, riserva di munizioni (ora infinita),
  asset grafici reali.
- Controlli touch (stick + pulsante ricarica) verificati dall'utente su un dispositivo reale (2026-11-02).
