# Sound credits

Real sound effects used by BAF2D. Every file in this folder must have a row in the table below (a test checks it).
Only **CC0 / public domain** sounds go here: they are committed to the repository and shipped with the game
(itch.io zip and Windows build). Sounds with other licences do not belong in this folder.

## How to add a sound

1. Prepare the file: **MP3** (or OGG), mono, 44.1 kHz, silence trimmed at the start and end, levels matched to
   the other sounds. Short effects should be a few KB; engine and rain loops must loop without a click.
2. Name it after the sound in `config/assets.json -> sounds`, with a number for variants:
   `shoot_rifle_1.mp3`, `shoot_rifle_2.mp3`, ...
3. Point the sound to it in `config/assets.json` (keep the `placeholder`: it is the fallback if the file can't
   be loaded):
   ```json
   "shoot_rifle": {
     "src": ["assets/sounds/shoot_rifle_1.mp3", "assets/sounds/shoot_rifle_2.mp3"],
     "volume": 0.25, "pitchJitter": 0.05, "maxVoices": 6,
     "placeholder": { "...": "..." }
   }
   ```
   - `src`: one file or a list of variants (one picked at random each time, never the same twice in a row).
     A variant can also be `{ "file": "assets/sounds/shoot_rifle_2.mp3", "volume": 1.8 }` to make a file
     that was recorded quieter (or louder) match the others: its volume multiplies the sound's `volume`.
   - `pitchJitter`: random pitch change (0.05 = ±5%), so the same shot repeated doesn't sound fake.
   - `maxVoices`: how many copies of the sound can play at once (default 6).
4. Add a row to the table below and run `node --test tests/static.test.mjs`.

## Files

| File | Source (URL) | Author | Licence |
|------|--------------|--------|---------|
| shoot_rifle_1.mp3 | TODO | TODO | CC0 |
| shoot_rifle_2.mp3 | TODO | TODO | CC0 |
