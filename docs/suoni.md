# Suoni da aggiungere

Elenco dei suoni di `config/assets.json -> sounds` che oggi non hanno un file (`"src": null`) e usano solo il
suono sintetizzato di riserva. Per aggiungerne uno: file in `assets/sounds/<suono>_<n>.mp3` (MP3, 44,1 kHz,
mono consigliato, silenzio tagliato), `src` in `assets.json`, riga in `assets/sounds/CREDITS.md` (solo CC0 /
pubblico dominio). Vedi le istruzioni in testa a `CREDITS.md`.

Aggiornato al 2026-11-15.

## Già con un file

`shoot_rifle` (2 varianti), `shoot_shotgun`, `shoot_launcher`, `shoot_tank_mg`, `shoot_helicopter_mg`,
`reload_rifle`, `reload_shotgun`, `explosion_grenade` (granate e razzi). Musica: `menu` (`assets/music/menu_intro.mp3`).

## Mancanti

Priorità: **A** = si sente di continuo, **B** = frequente, **C** = raro o di contorno.

### Armi

| Suono | Cosa è | Note | Pr. |
|-------|--------|------|-----|
| `shoot_pistol` | sparo della pistola | 2-3 varianti come il fucile | A |
| `shoot_mg` | mitragliatrice della jeep | colpo singolo corto (ne spara molti al secondo) | B |
| `shoot_rocket` | razzi di carro ed elicottero (`vehicle_rockets`) | partenza del razzo, diverso dal lanciarazzi a spalla | B |
| `dry_fire` | grilletto a vuoto (caricatore vuoto) | clic secco, brevissimo | B |
| `reload_pistol` | ricarica della pistola | entro 1,0 s (`reloadTime`) | A |
| `reload_launcher` | ricarica del lanciarazzi | entro 2,4 s | C |
| `reload_mg` | ricarica della mitragliatrice dei mezzi | entro 3,2 s | C |
| `reload_pods` | ricarica dei razzi dei mezzi | entro 6 s | C |
| `casing_brass` | bossolo di fucile/pistola che tocca terra | tintinnio metallico, varianti | B |
| `casing_shell` | bossolo del fucile a pompa che tocca terra | più sordo (plastica) | C |
| `mag_drop` | caricatore che cade in ricarica | tonfo di metallo sul terreno | C |

### Granate ed esplosioni

| Suono | Cosa è | Note | Pr. |
|-------|--------|------|-----|
| `grenade_throw` | lancio della granata | fruscio/sforzo, sicura che salta | B |
| `grenade_bounce` | granata che rimbalza | tonfo metallico leggero | B |
| `vehicle_explosion` | mezzo distrutto | più grossa e lunga della granata, con lamiere | B |

### Impatti dei colpi

| Suono | Cosa è | Note | Pr. |
|-------|--------|------|-----|
| `hit_ground` | colpo a terra (sabbia, erba, fango) | sbuffo sordo, varianti | A |
| `hit_wall` | colpo su muro/pietra | schiocco con detriti | A |
| `hit_wood` | colpo sul legno | | B |
| `hit_metal` | colpo su metallo/mezzi corazzati | rimbalzo ("ping") | A |
| `hit_flesh` | colpo su un soldato | | A |

### Distruzione della mappa

| Suono | Cosa è | Note | Pr. |
|-------|--------|------|-----|
| `break_wood` | legno che si rompe (staccionate, assi) | | B |
| `break_masonry` | muro che crolla (anche pietra e macerie) | | B |
| `break_foliage` | siepe/cespuglio distrutto (anche paglia) | fruscio di rami | C |
| `break_sandbag` | sacchi di sabbia sventrati | | C |

### Mezzi (suoni continui: devono ripetersi senza clic)

| Suono | Cosa è | Note | Pr. |
|-------|--------|------|-----|
| `engine_jeep` | motore della jeep | in loop; il gioco ne cambia il tono coi giri | A |
| `engine_tank` | motore e cingoli del carro | in loop | A |
| `engine_heli` | rotore dell'elicottero | in loop | A |
| `vehicle_enter` | salita a bordo | portiera/botola | C |
| `vehicle_exit` | discesa | | C |

### Soldati

| Suono | Cosa è | Note | Pr. |
|-------|--------|------|-----|
| `player_death` | morte di un soldato | | B |
| `respawn` | rientro in campo | | C |

### Interfaccia e riscontri

| Suono | Cosa è | Note | Pr. |
|-------|--------|------|-----|
| `hit_marker` | colpo andato a segno (solo chi spara) | brevissimo, non invadente | B |
| `hit_armor` | colpo su un mezzo corazzato | | C |
| `hit_kill` | uccisione | | B |
| `score_kill` | punti per un'uccisione | | C |
| `flag_captured` | bandiera conquistata | jingle corto | B |
| `flag_lost` | bandiera persa | | B |
| `flag_neutralized` | bandiera neutralizzata | | C |
| `pickup_weapon` | arma raccolta | | C |
| `pickup_ammo` | munizioni prese (anche dalle casse) | | C |
| `pickup_grenade` | granate raccolte | | C |
| `squad_order` | ordine alla squadra | radio / fischio | C |
| `promotion` | promozione di grado | fanfara corta | C |
| `medal` | medaglia ottenuta | | C |

### Ambiente

| Suono | Cosa è | Note | Pr. |
|-------|--------|------|-----|
| `rain` | pioggia (meteo `rain`) | in loop | B |

## Musica

Oggi c'è solo il brano del menu. Brani possibili (vanno aggiunti a `game.json -> music.tracks` e collegati nel
codice): briefing, partita, vittoria, sconfitta, addestramento.

## Suoni che non esistono ancora (servono modifiche al codice)

- passi dei soldati (per terreno: sabbia, erba, pietra, legno, acqua)
- fischio dei proiettili vicini (con la soppressione)
- vento del deserto, uccelli/grilli della campagna (ambiente per mappa)
- crepitio dei fuochi rimasti dopo le esplosioni
- acqua attraversata (guado)
- clic e conferme del menu
