# Music credits

Music tracks used by BAF2D. Every file in this folder must have a row in the table below (a test checks it).
Only **CC0 / public domain** music goes here: it is committed to the repository and shipped with the game
(itch.io zip and Windows build).

## How to add a track

1. Prepare the file: **MP3** (stereo is fine), 44.1 kHz, about 128–160 kbps. The track loops, so the end must
   join the start without a gap or a click (trim the silence at both ends). A 1–3 minute loop is usually enough.
2. Put it in this folder (e.g. `menu.mp3`) and point the track to it in `config/game.json -> music.tracks`:
   ```json
   "music": {
     "defaultVolume": 0.6, "fadeIn": 1.5, "fadeOut": 0.8,
     "tracks": { "menu": { "src": "assets/music/menu.mp3", "volume": 0.8 } }
   }
   ```
   - `volume`: volume of the track; the player's *Music volume* option and the general volume apply on top.
   - `fadeIn` / `fadeOut`: seconds of fade when the track starts and when a match starts.
3. Add a row to the table below and run `node --test tests/static.test.mjs`.

The `menu` track plays in the main menu and its screens; it fades out at the briefing and comes back when you
return to the menu. Browsers only start audio after the first click or key press: the music starts then.

## Files

| File | Source (URL) | Author | Licence |
|------|--------------|--------|---------|
| menu_intro.mp3 | TODO | TODO | CC0 |
