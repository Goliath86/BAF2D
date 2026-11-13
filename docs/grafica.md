# BAF2D - Migliorie grafiche da fare

Ordine = impatto stimato sul colpo d'occhio. Tutto procedurale (canvas), configurabile da JSON.

## Da dove ripartire (aggiornato al 2026-11-13)
- Fatto: bordi tra i terreni (fusione dei terreni, commit 30fa221): confini organici, fasce di riva/schiuma/orlo,
  varianti mescolate a chiazze, cache + preriscaldamento delle mappe (dettagli in CLAUDE.md, voce "Tile").
- Fatto (2026-11-13): punto 1, primi tre sottopunti: luce sul bordo dei soldati dal lato della luce, ombra portata
  dei soldati nella direzione delle ombre dei muri (`js/engine/lighting.js`, `game.json -> lighting`), colore di
  squadra su zaino (telo), fasce alle braccia ed elmetto (fascia larga 2 px; tolte le mostrine sulle spalle).
- Fatto (2026-11-13): resto del punto 1: busto più dettagliato, testa più grande con anello scuro, armi più
  definite, sagoma per squadra (`teams.<id>.kit`), rotazione di qualità (`rotsprite.js`), animazioni disegnate
  (rinculo, lampo e sobbalzo, lancio granata, corsa col fucile di traverso), caduta lontano dal colpo con 4 pose
  e fotogrammi di caduta, pozze di sangue a 4 forme irregolari.
- Rimasto del punto 1: accovacciato/riparato (serve prima la meccanica di gioco).
- Prossimo passo proposto: punto 2 (muri con altezza e luce coerente con quella dei soldati).
- Da misurare sul telefono anche il costo per frame della luce dei soldati (qualche drawImage su canvas piccoli
  per soldato + un livello delle ombre grande quanto la visuale).
- Punto aperto: l'anteprima reale dell'editor si ricostruisce a ogni modifica e con la fusione costa ~0,4 s.
- Da misurare: tempo di disegno delle mappe con la fusione su un telefono vero.
- Per vedere il risultato: `node --test` salva gli screenshot delle partite in `tests/output/`.

## 1. Soldati più leggibili (priorità alta)
- ~~Contorno scuro di 1 px + luce sul bordo (rim light) dal lato della luce: si staccano da erba e sabbia.~~ fatto
- ~~Ombra portata più marcata e coerente con la direzione della luce dei muri.~~ fatto
- ~~Colore di squadra più evidente: zaino, fascia al braccio, elmetto con telo colorato, non solo una striscia.~~ fatto
- ~~Più dettaglio sul busto: giberne, radio, borraccia, cinghie, tasche; arma più definita (canna, caricatore, ottica).~~ fatto
- ~~Proporzioni: testa/elmetto un filo più grandi per leggere la direzione a colpo d'occhio.~~ fatto
- ~~Animazioni: morte (caduta, non solo cambio sprite), colpito (sobbalzo + lampo), lancio granata, corsa con
  braccia che oscillano, rinculo visibile sul busto~~ fatto; accovacciato/riparato: manca la meccanica di gioco.
- ~~Bot della propria squadra distinguibili dai nemici anche senza colore (sagoma/elmetto diverso).~~ fatto
- ~~Cadaveri: posizioni varie, arma sparsa, sangue che si allarga in modo irregolare (non sempre la stessa pozza).~~ fatto

## 2. Muri e oggetti con altezza (pseudo-3D)
- Faccia frontale visibile sul lato sud di muri, case, rocce, sacchi di sabbia (vista leggermente dall'alto).
- Cima dei muri più chiara, faccia più scura, bordo superiore illuminato.
- Ombra alla base dei muri (occlusione ambientale) oltre all'ombra portata.
- Direzione della luce unica per tutta la mappa (ombre, riflessi e rim light coerenti).
- Case del deserto con tetti piani, parapetti, scale esterne, tende sui tetti.
- Casse con coperchio e fianco visibili, pile di casse di altezze diverse.

## 3. Luci dinamiche
- Livello di luce sopra la scena: aloni additivi per vampate, esplosioni, incendi, razzi in volo, fari dei mezzi.
- Le esplosioni illuminano muri e soldati vicini per qualche fotogramma.
- Fuochi persistenti dopo le esplosioni (bruciano qualche secondo, fumo).
- Possibilità di mappe al tramonto / notte (scurimento globale + luci), torce, lampioni.
- Lampeggio delle luci sulle bandiere in cattura.

## 4. Dettaglio e varietà delle mappe
- Arena: pavimento meno uniforme: macchie d'olio, crepe, segnaletica a terra, tombini, griglie, scritte, cavi.
- Campagna: alberi di dimensioni, rotazioni e specie diverse; tronchi caduti, rami spezzati, staccionate rotte,
  balle di fieno sparse, carri, pozzo, spaventapasseri.
- Deserto: tracce di pneumatici, impronte, rifiuti, teli, tende, carcasse di auto, pozzi, palme di forme diverse.
- Decorazioni di confine: ciuffi d'erba sopra la terra, sassi lungo le strade, canne attorno all'acqua.
- Acqua animata (riflessi che si muovono, increspature), riva con canne e sassi.
- Decal persistenti di battaglia: bossoli che restano a lungo, segni di pneumatici dei mezzi, crateri che restano
  dopo le esplosioni (deformano visivamente il terreno).
- Varianti di tile più numerose per spezzare la ripetizione residua dei motivi interni.

## 5. Effetti
- Bruciatura delle esplosioni: sfumatura retinata dal nero al marrone, braci che restano accese, terra smossa.
- Esplosioni: palla di fuoco con più fotogrammi, onda d'urto (anello), detriti più vari, fumo che sale e si allarga.
- Rotore dell'elicottero: disco sfumato in movimento invece dei cerchi di linee.
- Polvere sollevata dai mezzi e dalla corsa (diversa per terreno: sabbia, terra, fango).
- Impatti dei colpi per materiale: schizzi d'acqua, foglie dalle siepi, schegge di legno, scintille sul metallo.
- Sangue: spruzzi direzionali, gocce a terra, scie quando un ferito si muove.
- Traccianti visibili per alcune armi (mitragliatrice dei mezzi).
- Fumo delle granate fumogene (se si aggiungono) e del fuoco.

## 6. Mezzi
- Più dettaglio: portelli, ruote/cingoli animati, antenne, taniche, mimetica.
- Danni visibili: fumo e fiamme sotto una certa vita, ammaccature, pezzi che si staccano.
- Carcassa annerita più ricca (fumo persistente).
- Tracce di cingoli/pneumatici sul terreno.

## 7. HUD e interfaccia
- Icone a pixel per armi, granate e munizioni più dettagliate (coerenti con lo stile).
- Minimappa con bordo e rilievi più leggibili, icone diverse per mezzi e bandiere.
- Indicatori a bordo schermo per bandiere fuori vista e compagni.
- Animazioni dei popup (punti, medaglie) con leggero rimbalzo; numeri dei danni opzionali.
- Mirino con varianti scelte dal giocatore.

## 8. Atmosfera e colore
- Correzione di colore per mappa (deserto caldo e slavato, campagna satura, Arena fredda).
- Vignettatura leggera, grana opzionale.
- Meteo: pioggia (campagna) con pozzanghere che riflettono, nebbia mattutina, polvere più densa nel deserto.
- Nuvole che passano con la loro ombra sul terreno.
- Ciclo giorno/sera lento (opzionale per mappa).

## 9. Menu e schermate
- Anteprime delle mappe più belle (con la fusione dei terreni e i prop, non solo i tile).
- Transizioni tra le schermate, schermata di caricamento stilizzata.
- Schermata di fine partita con illustrazione/sfondo della mappa.

## Note tecniche
- Ogni miglioria procedurale va misurata sul telefono (prerender delle mappe, disegno dei soldati per frame).
- Per ciò che costa al caricamento: cache come per la fusione dei terreni (TileMap.prewarm / renderCache).
- Per ciò che costa a ogni frame: sprite pre-renderizzati in canvas (non disegnare a pixel ogni frame).
- Aggiungere un test (tests/) per ogni nuova funzione: cuciture tra regioni, riferimenti nei JSON, nessun errore.
