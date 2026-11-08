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
| R: ricarica | Pulsante tondo sopra lo stick destro: ricarica |
| G: lancia una granata (verso il mirino) | Pulsante con la granata, a sinistra dello stick destro |
| E / F: raccogli arma, sali/scendi da un mezzo | Pulsante che compare vicino a un'arma o a un mezzo (porta = scendi) |
| Alla guida: muovi = direzione, mira = torretta, fuoco = mitragliatrice, G = razzi, R = ricarica | Stesso schema; il pulsante granata diventa "razzi" |
| Esc / P: pausa | Pulsante pausa in alto a sinistra (sotto la vita) |
| F3: overlay di debug · F4: arma successiva · F5/F6: togli/ridai vita · F7: +1 granata · F8: cambia squadra · F9: +500 punti (debug) | |

I tasti si possono cambiare da **Opzioni → Comandi** (due tasti per azione; salvati nel browser).

## Menu

- **Principale** (pannello a sinistra): *Nuova partita*, *Opzioni*, *Editor di mappe*; a destra una scena animata
  a pixel (deserto al tramonto, ritratto a mezzo busto di un soldato con elmetto, cuffie, occhiali da sole, barba,
  kefiah e fucile con mirino olografico, bandiera rossa a brandelli, carro armato in fiamme, nuvole e un Apache che passa ogni tanto:
  `config/menu_scene.json`, `js/menu_scene.js`, disegni in `js/menu_art.js`).
  Con `menu.background` diverso da `"scene"` torna la partita dimostrativa tutta di bot. In basso a destra la
  versione (`version` in `game.json`).
- **Nuova partita**: mappa (anteprima, numero di bandiere, dimensioni; la mappa procedurale è annunciata come
  "prossimamente"), squadra blu/rossa, numero di compagni e di avversari (limiti in `menu.allies` / `menu.enemies`),
  ticket per squadra (`menu.tickets`: `min`, `max`, `step`, `default`; vale anche per la rivincita).
  L'ultima scelta viene ricordata.
- **Opzioni**: lingua, volume, comandi da tastiera (su touch: riepilogo dei comandi).
- **Pausa** (Esc / P / pulsante touch): riprendi, opzioni, torna al menu principale.
- **Fine partita**: rivincita o menu principale.

Le impostazioni (lingua, volume, tasti, ultima partita) stanno in `localStorage` (`menu.storageKey`).

**HUD**: in alto a sinistra la vita (cuore, barra con scia del danno, valore; lampeggia quando è bassa) e le granate rimaste,
in alto a destra l'arma in uso (nome tradotto, icona), i colpi (`12/30` e tacche), la barra di ricarica e gli avvisi
"RICARICA" / "SCARICO". In alto al centro i ticket (propria squadra a sinistra) e lo stato delle bandiere.

## Editor di mappe

`editor.html` (anche dal menu principale, voce *Editor di mappe*, solo desktop: serve il mouse).

- **Mappa**: nome, descrizione, tileset, dimensioni in tile (ridimensionamento dal centro o verso destra/basso),
  tile di riempimento, meteo, colore di sfondo.
- **Tavolozza**: tile del tileset (singoli o come *varianti casuali*: `sand`, `sand2`, `sand3`... scelti a caso ma
  sempre uguali, come nel gioco) e oggetti: basi delle squadre, bandiere, armi e granate a terra, decorazioni
  (alberi e palme dipingono anche la loro base, `editor.propTiles`), mezzi con squadra e direzione.
- **Strumenti**: matita (pennello 1×1...9×9), linea, rettangolo pieno/vuoto, riempimento, contagocce (anche tasto
  destro), cancella oggetti; **simmetria** (rotazione di 180° come le mappe del gioco, o a specchio): la cella
  speculare riceve lo stesso tile, le basi e i mezzi passano all'altra squadra, le bandiere ricevono una lettera
  gemella. Annulla/ripeti, zoom con la rotellina, spostamento col tasto centrale o Spazio + trascina, anteprima
  con i bordi e le ombre del gioco.
- **Bandiere**: lettera, proprietario iniziale, raggio e tempo di cattura (vuoto = valore di `ctf.flag`).
- **Controllo** (automatico): basi mancanti, bandiere assenti o su tile solidi, celle irraggiungibili (in rosso) e
  vicoli ciechi (riquadri tratteggiati), stesso algoritmo di `tools/check_level.mjs` (`js/engine/levelcheck.js`).
- **Salva / Apri**: il file è un livello del gioco (`config/levels/*.json`), quindi si riapre e si continua in più
  volte; con Chrome/Edge *Salva* riscrive lo stesso file, altrove lo scarica. Si possono aprire anche le mappe del
  gioco. Una bozza viene salvata da sola nel browser (`editor.storageKey`) e ripristinata alla riapertura.
- **Prova mappa** (Ctrl+Invio): apre il gioco in un'altra scheda (`index.html?test=1`, mappa passata in
  `localStorage`, `editor.testKey`) con la mappa già scelta in *Nuova partita* e anche nella partita dimostrativa.

Per aggiungere una mappa al gioco: copiarla in `config/levels/` e aggiungerla a `game.json -> levels`; nome e
descrizione vengono dal file lingua (`levels.<id>.name/description`) o, se mancano, da `name`/`description` del
livello. Parametri dell'editor in `game.json -> editor`.

## Modalità: Capture The Flag

Due squadre, **blu** e **rossa** (riconoscibili dalla striscia sull'elmetto e dalle mostrine sulle spalle).
Sulla mappa ci sono delle bandiere: un pennone con un drappo che parte da terra.

- **Cattura**: restando nell'area della bandiera (cerchio tratteggiato a terra, `radius`) il drappo — bianco se
  neutro — sale fino in cima in `captureTime` secondi; in cima la bandiera diventa del colore della squadra.
- **Riconquista**: se una squadra nemica entra nell'area di una bandiera già presa, il drappo scende
  (in `neutralizeTime`) mantenendo il colore di prima; arrivato a terra prende il colore della squadra che lo sta
  catturando e risale. Due squadre nell'area insieme = bandiera **contesa**, il drappo resta fermo.
  Con più soldati della stessa squadra la cattura accelera (`extraCapturerSpeed`).
- **Ticket**: ogni squadra parte con `tickets` (es. 400). Ogni morte costa `ticketsPerDeath`; ogni `bleed.interval`
  secondi una squadra in svantaggio di bandiere perde `perFlag` ticket per ogni bandiera di differenza
  (`bleed.mode: "enemyFlags"` = per ogni bandiera nemica, a prescindere dalle proprie).
- **Rientro**: da morto (resta il corpo con la pozza e l'arma caduta), dopo `death.respawnDelay` secondi si rientra
  alla bandiera della propria squadra (non contesa) più vicina al punto della morte, o alla base se è più vicina.
- **Fine partita**: la squadra che arriva a 0 ticket perde; schermata di vittoria/sconfitta (pareggio se finiscono
  insieme) con la **classifica** di tutti i soldati (punti, uccisioni, morti, assist, bandiere; i bot hanno nomi e
  gradi fittizi) e il grado del giocatore. Pulsanti *Rivincita* (anche Invio) e *Menu principale*.

### Mezzi e lanciarazzi

- `config/vehicles.json`: **jeep** (veloce, mitragliatrice) e **carro lanciarazzi** (lento, mitragliatrice + 4 razzi).
  Punti di comparsa nella legend del livello (`{ "tile", "vehicle": "jeep", "team": "blue", "angleDeg": 0 }`):
  Villaggio nel deserto (jeep e carro per base + 2 jeep neutrali) e Crocevia (una jeep per base).
- **Corazza**: i proiettili non fanno danni (scintille); granate ridotte (`vehicleFactor`), razzi pieni
  (`directDamage` + esplosione). Distrutto: esplode, muore chi è a bordo, carcassa fumante, ricompare dopo `respawn` s.
  Un mezzo in corsa investe i nemici (`runover`).
- **Motore**: suono continuo sintetizzato (`engineSound` del mezzo → suono con `loop` in `assets.json`: strati di
  oscillatori/rumore, `rpm` = moltiplicatore di frequenza da fermo a pieno regime, `lowpass`/`lowpassOpen`, `throb` =
  pulsazione dei cilindri, `idle` = volume al minimo). Il regime segue la velocità (e l'acceleratore, `throttleRev`);
  si sente solo vicino, tace in pausa. Con `src` (file in loop) il regime cambia la velocità di riproduzione.
- **Lanciarazzi** (`weapons.json` → `launcher`, razzi in `rockets`): arma **speciale** (`special: true`) che si porta
  *in più* di quella principale: si passa dall'una all'altra con **Q** (o il pulsante touch con le due frecce, visibile
  solo con due armi). Razzi contati (`reserve`: scorta oltre a quello caricato, "+N" nell'HUD); finiti i razzi si butta
  e si torna all'arma principale; raccoglierne un altro ricarica la scorta. Sulle mappe come oggetto raccoglibile;
  un bot su quattro nasce con "rifle+launcher" (`bots.weapons`). I bot impugnano il lanciarazzi solo contro i mezzi.
- **IA**: i bot "guidatori" (`bots.ai.vehicles`) salgono sui mezzi liberi e li portano alle bandiere (`bots.ai.vehicle`,
  `js/game/vehicle_ai.js`); chi ha il lanciarazzi attacca i mezzi, gli altri si riparano.

### Armi e granate a terra

- Chi muore lascia a terra l'arma (con i colpi rimasti nel caricatore) e le granate che aveva; restano
  `pickups.life` secondi (lampeggiano negli ultimi `blinkTime`).
- Sulle mappe ci sono punti fissi (piazzola con gli angoli gialli) con fucili a pompa e granate, che ricompaiono
  `respawn` secondi dopo la raccolta.
- **Granate**: si raccolgono passandoci sopra (anche i bot), fino a `maxGrenades`.
- **Armi**: sopra un'arma diversa dalla propria compare una freccetta e la scritta "[E] Raccogli ..."; con **E**
  (o F, o il pulsante touch che appare solo in quel momento) la si prende e quella impugnata resta a terra.

### Punteggi e gradi

- **Punti** (`scoring.points`): uccisione, assist (almeno `assistDamage` danni a un nemico ucciso da altri), difesa
  (uccisione nell'area di una bandiera della propria squadra), conquista/neutralizzazione (a chi è nell'area),
  bonus di fine partita a tutta la squadra (vittoria/pareggio/sconfitta). Le granate danno il merito a chi le lancia.
  Durante la partita i punti guadagnati compaiono sopra il soldato ("+100 UCCISIONE").
- **Carriera**: ogni punto del giocatore si somma ai punti di carriera salvati in localStorage (chiave `career`
  delle impostazioni), anche se si esce a metà partita. Superata la soglia del grado successivo compare la
  schermata di **promozione** (insegna ingrandita + nome del grado), senza fermare il gioco.
- **Gradi** (`ranks.list`): 18, da Soldato a Generale, soglie con distacchi crescenti (tarate su partite simulate:
  ~4000–6000 punti a partita → prima promozione a metà della prima partita, ufficiale dopo ~10 partite, Generale
  dopo ~80). Insegne disegnate a pixel (galloni, archi, barre, stelle). Il grado resta visibile in piccolo nell'HUD
  (sotto le granate: insegna, nome breve, barra verso il grado successivo, punti della partita) e nel menu principale.

### Squadra avversaria (IA)

Compagni e avversari sono controllati dal computer (`bots` in `game.json`; il numero per squadra si sceglie in
*Nuova partita*). Ogni bot:

- **rientra** su una bandiera posseduta dalla sua squadra (la più vicina a dove è morto), alla base solo se non ne ha;
- ha come **priorità le bandiere**: va a catturare quelle non sue (senza ammassarsi tutti sulla stessa), resta
  nell'area finché non è presa; se le ha tutte le presidia;
- **spara solo a un nemico in vista** (dopo un tempo di reazione, a raffiche, con un errore di mira che cresce se il
  bersaglio si muove); se lo perde di vista continua per un po' a sparare dove l'ha visto (fuoco di copertura);
- i suoi colpi **o vanno a segno o cadono a terra vicino al bersaglio** (gittata = distanza dal punto mirato);
- **si muove in modo tattico**: spara allo scoperto, poi si ripara dietro un muro (e lì ricarica), poi si sporge da un
  punto vicino che vede il bersaglio; a vita/munizioni basse o se colpito cerca riparo; chi sta catturando combatte
  senza uscire dall'area della bandiera;
- **in squadra**: chi avvista un nemico lo comunica ai compagni vicini non impegnati (né in cattura né con un altro
  bersaglio); se più bot ingaggiano lo stesso bersaglio, uno lo tiene impegnato e gli altri lo **aggirano** da lati
  alterni;
- munizioni infinite, ma deve **ricaricare**;
- **lancia granate** (scorta `bots.player.grenades` per vita): ogni tanto valuta un lancio sul bersaglio, più
  volentieri se è al riparo (la lancia anche dietro un angolo, su un punto visibile sia da lui sia dal bersaglio) o se
  ci sono più nemici vicini; mai se un compagno o lui stesso sarebbero nel raggio dell'esplosione;
- **scappa dalle granate** che vede (di chiunque): stima dove si fermerà e, se è troppo vicina
  (`blastRadius` × `grenadeSafeFactor` + `grenadeAvoidMargin`), corre verso il punto più vicino a distanza di
  sicurezza o al riparo dietro un muro (preferito), senza fermarsi finché non ci arriva;
- **cambia arma**: se vede a terra un'arma che valuta meglio della sua (`weaponValues` + preferenza personale
  casuale) va a prenderla e lascia la propria; in combattimento solo se è a pochi passi, mai uscendo dall'area di
  una bandiera che sta catturando. Le granate le raccoglie passandoci sopra.

I colpi feriscono solo la squadra avversaria (`combat.friendlyFire`); le granate feriscono tutti. In debug (F3) si
vedono percorsi dei bot, coperture (verde), punti da cui sporgersi (giallo), punti di aggiramento (viola) e ultima
posizione nota del bersaglio (rosso), punto di lancio della granata (arancio) e punto di fuga da una granata (azzurro) e arma a terra che stanno andando a prendere (bianco).

La modalità (desktop/touch) cambia automaticamente in base all'ultimo input usato.
Su mobile, al primo tocco il gioco prova ad andare a schermo intero e a bloccare l'orientamento in landscape;
dove non è supportato (es. iOS Safari) in portrait compare un overlay "ruota il dispositivo" e il gioco va in pausa.

## Struttura

```
index.html, css/style.css, manifest.webmanifest
editor.html, css/editor.css   editor di mappe (js/editor/)
config/
  game.json            parametri generali (display, player, input, camera, audio)
  weapons.json         armi (statistiche, sprite, suoni) e granate
  assets.json          sprite, tileset e suoni
  effects.json         impatti dei colpi (buchi, fumo, scintille, schegge), bossoli, vampate, esplosioni
  levels/              livelli (level01 = Arena di prova, level02 = Crocevia, level03 = Villaggio nel deserto),
                       elencati in game.json -> "levels"
  lang/                testi localizzati (en.json = default, it.json)
js/
  main.js              bootstrap
  menu.js              menu (DOM): principale, nuova partita, opzioni, pausa, fine partita
  settings.js          impostazioni del giocatore in localStorage
  engine/              display, input, touch (joystick), assets, placeholder, tilemap, camera, audio, loader, i18n
  game/                game (loop, proiettili, render), player, weapons (catalogo armi), grenades, hud, effects (decal e particelle),
                       ctf (bandiere, ticket, rientro), scores (punti della partita), ranks (gradi, insegne, carriera),
                       pickups (oggetti a terra), props (decorazioni), weather (vento e sabbia)
tools/serve.mjs        server statico di sviluppo (solo moduli Node built-in)
tools/gen_desert.mjs   generatore della mappa del deserto (level03.json)
tools/build-zip.mjs    zip per itch.io: node tools/build-zip.mjs -> dist/BAF2D-<versione>-html5.zip
docs/itch-io.md        testi (in inglese) e impostazioni della pagina itch.io
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

**Placeholder**: `placeholder.shape` sceglie il disegno procedurale (`soldier_body`, `soldier_legs`, `weapon`,
`bullet`, `hole`, `crosshair`, `circle`, `rect`, ...); i colori sono parametri nel JSON. `autoOutline` aggiunge un contorno
di 1px del colore indicato. Per `soldier_body` e `weapon`, `placeholder.weapon` sceglie l'arma disegnata
(`rifle`, `shotgun`, `pistol`); `soldier_body` genera anche `reloadFrames` frame di ricarica (frame 1..n,
da usare nell'animazione `reload`).

**Ereditarietà**: uno sprite con `"extends": "altro_sprite"` eredita la definizione dell'altro (dimensioni, origin,
animazioni; `placeholder` fuso campo per campo) tranne `src`. Esempio: `soldier_pistol` estende `soldier_rifle`
cambiando solo `placeholder.weapon`.

**Varianti di squadra**: uno sprite con `"teamColored": true` (ereditato da chi lo estende) genera anche
`nome@blue`, `nome@red`, ... per ogni squadra di `game.json` → `teams`: il placeholder riceve `team`, `teamDark`,
`teamLight` (= `color`, `dark`, `light` della squadra) e un `{team}` nel `src` viene sostituito con l'id
(es. `"src": "assets/licensed/soldier_{team}.png"`). Il giocatore usa la variante della sua squadra se esiste.

**Tileset**: tile quadrati di `tileSize` px; ogni tile ha `id`, `name`, `solid` e opzionalmente `index`
(posizione nello sheet, default = `id`).

**Suoni**: `src` (wav/mp3/ogg) e `volume`; il placeholder è un suono sintetizzato
(`wave`: `square`/`sine`/`triangle`/`sawtooth`/`noise`, `freqStart`, `freqEnd`, `duration`; `at` = lista di istanti
in secondi in cui ripeterlo, es. i "clack" della ricarica). `placeholder` può anche essere una **lista di strati**
suonati insieme, ognuno con il proprio `volume` relativo (es. `explosion` = rumore + boom grave).

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
  I valori numerici accettano un numero o un intervallo `[min, max]`. Opzioni extra: `round` (disco pixelato
  invece del quadrato, per il fumo grosso), `streak` (scia lunga velocità × `streak` px, per le schegge),
  `collide` (la particella sparisce entrando in un tile solido).

Decal: `alpha` (opacità massima) e `clipSolid` (la parte che cade sui tile solidi viene cancellata).

`explosions` (usate dalle granate) definisce per tipo: `decal` (bruciatura a terra, `clipSolid`),
`fireball` (`sprite` animato i cui frame scorrono in `duration` secondi), `glow` (alone additivo:
`color`, `alpha`, `radius`, `bands`, `life`), `emitters` (emessi a 360°), `debris` (lista di `{ type, count }`:
tipi di `casings` lanciati in tutte le direzioni, che volano, rimbalzano e restano a terra) e `sound`.

`maxDecals` e `maxParticles` limitano gli elementi contemporanei.

### Armi (`config/weapons.json`)

`defaults` contiene i valori comuni; ogni voce di `weapons` (la chiave è l'id dell'arma) li sovrascrive:

| Campo | Significato |
|---|---|
| `name` | chiave di traduzione del nome (es. `weapons.rifle`) |
| `bodySprite` | busto del soldato che impugna quest'arma (default: `player.sprite`) |
| `pickupSprite` | sprite dell'arma a terra (raccolta) |
| `bulletSprite`, `sound` | sprite del proiettile e suono dello sparo |
| `damage` | danno di ogni proiettile (per il fucile a pompa, di ogni pallino) |
| `magazine` | colpi nel caricatore |
| `reloadTime` | durata della ricarica in secondi (l'animazione `reload` del busto viene adattata a questa durata) |
| `reloadSound`, `emptySound` | suono della ricarica e del grilletto a vuoto |
| `reloadMoveFactor` | velocità durante la ricarica: `1` normale, `0.4` rallentato, `0` fermo |
| `autoReload` | `true` = a caricatore vuoto premere il grilletto avvia la ricarica |
| `auto` | `true` = automatica (spara finché tieni premuto), `false` = un colpo per pressione |
| `fireRate` | colpi al secondo |
| `pellets` | proiettili per colpo (> 1 per il fucile a pompa) |
| `bulletSpeed`, `spreadDeg`, `rangeJitter`, `minRange`, `maxRange`, `screenMargin` | vedi "Colpi ed effetti" |
| `muzzleOffset` | distanza in px della volata dal centro del giocatore |

La ricarica si avvia con **R** (desktop) o con il **pulsante tondo** sopra lo stick destro (touch), che mostra
i colpi rimasti, l'avanzamento della ricarica e diventa rosso a caricatore vuoto. Durante la ricarica non si spara;
cambiare arma la interrompe.

Da codice: `player.equip(id, ammo)` impugna un'arma (con `ammo` colpi, default caricatore pieno) e restituisce
`{ id, ammo }` di quella lasciata (da console: `BAF2D.player.equip('shotgun')`).

### Granate (`config/weapons.json` → `grenades`)

`grenadeDefaults` contiene i valori comuni, ogni voce di `grenades` li sovrascrive. Si lanciano con **G** o con il
pulsante touch; non durante la ricarica.

| Campo | Significato |
|---|---|
| `sprite`, `shadow`, `blinkColor` | sprite (ruota in volo), ombra a terra in volo, spia che lampeggia (più veloce a fine spoletta) |
| `fuse`, `throwCooldown` | secondi dalla partenza all'esplosione; attesa minima tra due lanci |
| `minRange`, `maxRange`, `defaultRange` | desktop con mouse: il primo contatto col suolo è sotto il mirino (limitato a min/max); touch: `defaultRange` px |
| `hand` | punto di lancio `[avanti, lato]` in px rispetto al giocatore |
| `height`, `lift`, `gravity` | quota di partenza, spinta verso l'alto, gravità (px, px/s, px/s²) |
| `inherit` | frazione della velocità del giocatore ereditata |
| `bounce`, `minBounce`, `friction` | rimbalzo sul pavimento: frazione della velocità verticale, soglia sotto cui smette, velocità orizzontale conservata |
| `groundDrag`, `wallBounce`, `radius` | attrito mentre rotola; rimbalzo sui tile solidi; raggio di collisione |
| `throwSound`, `bounceSound`, `bounceSoundMin` | suoni di lancio e rimbalzo (solo per urti oltre la soglia in px/s) |
| `explosion` | tipo in `effects.json` → `explosions` |
| `damage`, `blastRadius`, `minDamageFactor`, `hurtsPlayer` | danno al centro, raggio, frazione del danno sul bordo; i muri riparano |
| `shake` | scossa della camera `{ amount (px), time (s) }` |

In `game.json`: `player.grenade` (tipo), `player.grenades` (scorta iniziale, default 2), `player.maxGrenades`.
Da codice: `player.addGrenades(n)`.

### Livelli (`config/levels/*.json`)

La mappa è un array di stringhe; `legend` associa ogni carattere a un tile (per nome o id) e, opzionalmente, a uno
spawn (base di una squadra: lo spawn ha il nome della squadra) o a una bandiera:

```json
"legend": {
  ".": "floor",
  "#": "wall",
  "b": { "tile": "floor", "spawn": "blue" },
  "r": { "tile": "floor", "spawn": "red" },
  "A": { "tile": "floor", "flag": "A" }
},
"flags": {
  "A": { "owner": null },
  "B": { "owner": null, "radius": 40, "captureTime": 10 },
  "C": { "owner": "red" }
}
```

`flags` (opzionale) per ogni bandiera: `owner` iniziale (`null` = neutra) e override dei parametri di
`game.json` → `ctf.flag`. L'id della bandiera (la lettera) compare nell'HUD.
`fill` è il tile usato per completare righe più corte. Fuori dalla mappa tutto è considerato solido.

Altre voci della legend:

- **Varianti**: `"tile"` (o il valore diretto) può essere una lista, es. `{ "tile": ["sand", "sand2", "sand3"],
  "variantWeights": [6, 4, 2] }`: ogni cella sceglie una variante in modo casuale ma stabile, così il terreno non
  si ripete.
- **Decorazioni**: `{ "tile": "palm_base", "prop": "palm" }` (tipi in `game.json` → `props`).
- **Oggetti raccoglibili**: `{ "tile": "sand", "pickup": "shotgun" }` (vedi `pickups`).

Opzioni del livello: `weather` (tipo di meteo in `effects.json` → `weather`, es. `"desert_wind"`) e `background`
(colore fuori mappa).

**Villaggio nel deserto** (`level03.json`, 97×65): generato da `node tools/gen_desert.mjs` (simmetrico per rotazione,
controlla che tutto sia raggiungibile). Si può modificare a mano il JSON, ma rigenerandolo le modifiche si perdono.
Strade larghe 5 tile pensate per i futuri mezzi.

**Tile speciali** (tileset): `"shootThrough": true` = blocca il movimento ma non colpi e vista (acqua, tronchi
delle palme). `"edge": { group, width, colors, dither, foam, round }` = fascia di bordo verso i tile di un altro
gruppo (sabbia sparsa ai lati della strada, riva con schiuma e angoli arrotondati per l'acqua). Il tileset può avere
`"shadow": { color, alpha, dx, dy }`: i tile che fermano i colpi proiettano un'ombra sul terreno.

**Decorazioni** (`game.json` → `props.types`): `sprite` (frame 0..`variants`-1 = varianti, poi le stesse forme come
ombra), `layer` (`ground` sotto i soldati, `overhead` sopra, es. chiome delle palme), `shadow` + `shadowOffset`,
`sway`/`lean`/`swaySpeed` (oscillazione col vento, a pixel interi), `fadeUnder`/`fadeRadius` (trasparenza quando
il giocatore ci passa sotto), `rotate` (rotazione casuale a 90°), `jitter` (spostamento casuale in px).

**Meteo** (`effects.json` → `weather`): `wind` (`angleDeg`, `base`, `wobble`, `angleWobbleDeg`, raffiche
`gustEvery`/`gustTime`/`gustStrength`), `streaks` (granelli in aria), `wisps` (lingue di sabbia rasoterra), `haze`
(velature di polvere), `tint` (velo di colore, più denso nelle raffiche). Il vento muove anche palme e cespugli e
trasporta il fumo (`windDrift`).

### Localizzazione (`config/lang/*.json`)

Tutti i testi visibili stanno in un file JSON per lingua (`en.json`, `it.json`, ...), con chiavi annidate
(`"menu": { "newGame": "..." }` → chiave `menu.newGame`) e segnaposto `{nome}`. Per andare a capo usa `\n`.

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
- `player.weapon`: id dell'arma iniziale (vedi `config/weapons.json`); `player.sprite` è il busto di riserva
  per le armi senza `bodySprite`.
- `input.keyboard`: mappatura azioni → `KeyboardEvent.code` (`debugNextWeapon`, default F4: arma successiva).
- `input.touch`: `radius` (frazione del lato corto dello schermo), `deadZone`,
  `moveCurve` (risposta dello stick sinistro: la velocità è proporzionale allo spostamento; 1 = lineare,
  > 1 più precisione alle basse velocità), `fireThreshold`
  (frazione del raggio oltre la quale si spara), `holdToRepeat` (tenendo lo stick oltre la soglia anche le armi
  semiautomatiche continuano a sparare), `dynamic` (lo stick nasce dove appoggi il dito), `opacity`,
  `buttons` (pulsanti tondi; la chiave è l'azione generata, es. `reload`: `anchor` = stick di riferimento,
  `offset` = spostamento in raggi di stick dalla sua posizione di riposo, `radius` = frazione del lato corto, `icon`,
  `color`; `debugOnly: true` = visibile solo aprendo il gioco con `?debug=1`).

**Debug su mobile**: aprendo il gioco con `?debug=1` (es. `http://192.168.1.10:8080/?debug=1`) compaiono sopra
lo stick sinistro due pulsanti a forma di cuore: "−" toglie vita (come F5), "+" la ridà (come F6).
- `player.maxHealth`: punti vita (da codice `player.damage(n)` / `player.heal(n)`; F5/F6 in debug, quantità `debugDamage`).
- Morte: `player.deadSprite` (corpo a terra, testa a sinistra), `player.deadOffset` (px di cui il corpo cade
  all'indietro), `player.deathSound`.
- `player.team`: squadra del giocatore (id in `teams`).
- `teams`: squadre `{ id: { color, dark, light } }` (colori di HUD, bandiere e varianti degli sprite).
- `ctf`: `tickets` (numero, o `{ "blue": 400, "red": 300 }`), `ticketsPerDeath`, `bleed` (`interval` in secondi,
  `mode` = `advantage`|`enemyFlags`, `perFlag`), `flag` (default delle bandiere: `radius` px, `captureTime` e
  `neutralizeTime` in secondi, `extraCapturerSpeed` = velocità in più per ogni soldato oltre il primo,
  `requireSight` = i muri tra soldato e bandiera impediscono la cattura, `spawnDistance` = [min, max] px del rientro
  attorno alla bandiera), suoni `capturedSound`/`lostSound`/`neutralizedSound`, `look` (pennone: `poleHeight`,
  colori, drappo `clothWidth`/`clothHeight`, `neutralColor`/`neutralDark`, sventolio `wave`/`waveSpeed`;
  area: `showZones`, `zoneAlpha`, `zoneFillAlpha`, `zoneDash`).
- `death`: `respawnDelay`, `respawnSound`, `maxCorpses` (cadaveri lasciati sulla mappa), `corpseTime` (secondi
  prima che un cadavere sparisca, 0 = mai) e `corpseFade` (dissolvenza negli ultimi secondi), `poolSprite`/`poolTime`
  (pozza che si allarga sotto il corpo: i frame dello sprite vanno dal più piccolo al più grande),
  `dropWeapon`/`dropDistance` (l'arma cade a terra).
- `matchEnd`: `delay` (secondi tra la fine dei ticket e la schermata), `restartDelay` (attesa prima che
  clic/tocco/Invio facciano ricominciare, contro i riavvii involontari).
- `hud`: misure in pixel di gioco (`margin`, `fontSize`, `font`) e colori. `hud.health`: barra della vita
  (`width`, `height`, `showValue`, colori, `lowThreshold` = frazione sotto cui lampeggia, `trailDelay`/`trailSpeed`
  = scia chiara della vita persa). `hud.weapon`: `iconScale` (icona = `pickupSprite` dell'arma), `ammoFontSize`,
  `pipsWidth`/`pipHeight` (tacche dei colpi; caricatori più grandi diventano una barra), colori.
  `hud.grenades`: `show`, `icon` (sprite), `iconScale`, `emptyColor`. `hud.ctf`: pannello ticket/bandiere
  (`ticketFontSize`, `barWidth`, `lowTickets` = frazione sotto cui il numero lampeggia, `flagGap`, ...), barra della
  cattura (`zoneBarWidth`, `contestedColor`), messaggi (`toastTime`) e scritta di rientro (`respawnY`, `killedColor`).
  `hud.rank`: grado in alto a sinistra (`fontSize`, `barWidth`/`barHeight`, colori, `maxHeight` = spazio riservato
  all'insegna). `hud.score`: punti sopra il soldato (`life`, `rise`, `offset`, `max`). `hud.promotion`: schermata
  di promozione (`time`, `fadeIn`/`fadeOut`, `y` = frazione dell'altezza, `scale` massima dell'insegna entro
  `insigniaHeight` px, `growStep`, colori della fascia).
- `scoring`: `points` (`kill`, `assist`, `defend`, `capture`, `neutralize`, `victory`, `draw`, `defeat`, `debug` = F9),
  `assistDamage`, `botRankSpread` (gradi dei bot attorno a quello del giocatore), `killSound`, `promotionSound`,
  `popupColors` (colore del "+N" per tipo). Nomi dei bot in `scoreboard.botNames` dei file lingua.
- `ranks`: `list` (`{ id, xp, insignia: [{ shape: chevron|rocker|bar|star, count, color }] }`, strati dall'alto in
  basso; nomi in `ranks.<id>.name/short` dei file lingua), `colors` (`{ nome: [chiaro, scuro] }`), `outline`.
- `menu.scoreboardColumn`: oltre questo numero di soldati la classifica va su due colonne.
- `pickups`: `radius` (px di raccolta), `life`/`blinkTime` (oggetti lasciati), `maxDropped`, piazzole (`pad`,
  `padSize`, `padColor`), `highlightColor`, `popupColor`, suoni `weaponSound`/`grenadeSound`, `types` (tipi per la
  legend dei livelli: `{ "weapon": id, "respawn": s }` o `{ "grenades": n, "respawn": s }`). Nel livello:
  `"s": { "tile": "floor", "pickup": "shotgun" }`. `death.dropWeapon`/`dropGrenades` = cosa lasciano i caduti.
  `hud.pickup`: scritta di raccolta (`fontSize`, `offset` sotto il soldato, `color`).
- `combat`: `hitImpact` (tipo di impatto in `effects.json` quando un colpo prende un soldato), `hitPadding` (px in
  più attorno alla hitbox), `endHitReach` (a fine corsa il colpo prende anche un soldato fino a questi px oltre),
  `friendlyFire`.
- `bots`: `teams` (`{ "red": 4, "blue": 0 }`), `weapons` (armi assegnate a rotazione), `respawnDelay`,
  `baseSpread` ([min, max] px attorno alla base), `player` (sovrascrive `player` per i bot, es. `speed`).
  `bots.ai`: vista (`viewRange`, `reactionTime`, `turnSpeedDeg`, `memoryTime`), tiro (`fireConeDeg`, `burst`/`burstPause`,
  `aimErrorDeg`, `aimErrorMovingDeg`, `suppressErrorDeg`, `leadFactor`, `shotOvershoot` = [min, max] px oltre il punto
  mirato, `rangeFactor` = frazione di `maxRange` dell'arma entro cui spara), fuoco di copertura (`suppressTime`),
  ciclo tattico (`exposeTime`, `coverTime`, `hurtCoverChance`, `lowAmmo`, `coverReload`, `coverSearch`/`peekSearch`
  in tile, `minCoverDistance`, `preferredRange`, `strafe*`), squadra (`squadRadius`, `commRadius`, `alertInterval`,
  `flankAngleDeg`, `flankDistance`, `flankSearch`, `flankRetarget`), bandiere (`captureCommit`, `objectiveInterval`,
  `holdTime`, `holdSpacing` = distanza minima tra compagni nell'area, `holdInner` = frazione del raggio vicino al pennone da evitare, `flagSquad` = bot per bandiera prima della penalità `crowdPenalty`, `flagBias`), movimento
  (`separation`, `repathInterval`, `arriveDistance`, `waypointReach`, `destTolerance`), granate (`grenades` = on/off,
  `grenadeFirstDelay`/`grenadeInterval` tra due valutazioni, `grenadeChanceVisible`/`Hidden`/`Group`, `grenadeMemory`,
  `grenadeSelfSafety` = distanza minima in raggi d'esplosione, `grenadeFriendlyMargin`, `grenadeRangeFactor` = la
  granata rotola ~23% oltre il primo rimbalzo, `grenadeConeDeg`, `grenadeAimTime`; fuga: `grenadeReaction`,
  `grenadeAvoidMargin`, `grenadeSafeFactor`, `grenadeCoverBonus` = tile di percorso in più accettati per un riparo), armi a terra (`pickWeapons` = on/off, `weaponValues` per id, `weaponBias` = ± preferenza
  personale, `weaponMinGain`, `weaponSearch` px, `weaponCombatReach` px in combattimento, `weaponScanInterval`,
  `weaponGoalTime` = rinuncia dopo questi secondi).
- `audio.hearing`: `near`/`far` px dal centro della visuale (i suoni lontani si attenuano fino a sparire).
- `camera.smoothing`, `camera.lookAhead` (px di anticipo nella direzione di mira).
- `mobile.requestFullscreen`, `mobile.lockLandscape`.
