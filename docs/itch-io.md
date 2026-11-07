# BAF2D — itch.io page (v1.0.0)

Copy each block into the matching field of the itch.io "Edit game" page.

---

## Title

BAF2D

## Short description or tagline

Top-down pixel-art capture the flag: squad AI, jeeps, rocket tanks and a career that ranks you up.

## Classification / Kind of project

- Classification: **Games**
- Kind of project: **HTML** (upload `dist/BAF2D-1.0.0-html5.zip`, tick "This file will be played in the browser")
- Release status: **Released**

## Embed options (Uploads → HTML)

- Viewport dimensions: **960 × 540** (16:9; the game scales to any size with crisp integer pixel scaling)
- **Mobile friendly**: on — Orientation: **Landscape**
- **Fullscreen button**: on
- Automatically start on page load: optional (the game opens on its own menu; audio starts after the first click/tap)

## Description

BAF2D is a fast top-down shooter in crisp pixel art. Two teams, a handful of flags and a pool of tickets: capture and
hold the flags, and make every enemy death count. The team that runs out of tickets loses.

You fight alongside (and against) AI soldiers that take cover, peek around corners, flank in pairs, throw grenades,
pick up better weapons and jump into vehicles. Every match feeds your career: score points, climb 18 ranks from
Private to General, and see where you ended up on the end-of-match leaderboard.

### Features

- **Capture the Flag with tickets.** Raise your flag in contested zones; flags you hold drain the enemy's tickets,
  and every death costs your team one. Pick the ticket count before each match.
- **Three maps.** A compact test arena, the symmetric *Crossroads*, and the large *Desert Village*: a windswept map
  with a ruined village, an oasis with palms, dry-stone walls and wide dirt roads built for vehicles. Sand blows
  across the ground, palms sway in the gusts.
- **Vehicles.** Drive a fast **jeep** with a mounted machine gun or a heavy **rocket tank**. Armour shrugs off small
  arms fire: bring a rocket launcher or grenades. Ramming enemies works too.
- **Weapons.** Assault rifle, shotgun, pistol, frag grenades, and a shoulder-fired **rocket launcher** you carry next to
  your main gun. Fallen soldiers drop their weapons and grenades; map pickups respawn.
- **Squad AI.** Bots capture objectives, use cover, suppress, flank, dodge grenades, switch to rockets against armour
  and drive vehicles to the flags. Up to 8 vs 8.
- **Career and ranks.** Points for kills, assists, defending, capturing and destroying vehicles. Your rank is saved in
  the browser and grows from match to match, with a promotion screen when you rank up.
- **Desktop and mobile.** Keyboard and mouse, or twin virtual sticks on touch screens (landscape).
- **English and Italian.**

### Controls

| Action | Keyboard & mouse | Touch (landscape) |
|---|---|---|
| Move | WASD / arrow keys | Left stick |
| Aim | Mouse | Right stick |
| Fire | Left click / Space | Push the right stick past the dashed ring |
| Reload | R | Reload button |
| Throw grenade | G | Grenade button |
| Pick up weapon / get in or out of a vehicle | E (or F) | Button that appears when available |
| Switch weapon (rocket launcher) | Q | Swap button (with two weapons) |
| Pause | Esc / P | Pause button |

In a vehicle: move to drive, aim to turn the turret, fire for the machine gun, **G** for rockets, **R** to reload.
Keys can be remapped in Options.

### Notes

- Progress (rank, settings) is stored in your browser's local storage.
- On phones, play in landscape; the game asks for fullscreen on the first tap.
- All graphics and sounds are generated in code: no external assets, about 0.5 MB to download.

### Credits

Made with plain JavaScript and HTML5 Canvas, no engine or libraries.
Source code licensed under the GNU GPL v3.

## Details (Metadata)

- Genre: **Shooter**
- Tags (up to 10): `top-down-shooter`, `pixel-art`, `capture-the-flag`, `2d`, `singleplayer`, `tactical`, `vehicles`,
  `bots`, `retro`, `mobile`
- Made with: **HTML5**
- Inputs: **Keyboard**, **Mouse**, **Touchscreen**
- Languages: **English**, **Italian**
- Average session: **A few minutes** (a match lasts about 5–12 minutes)
- Accessibility: Configurable controls (key remapping)

## Cover image and screenshots

- Cover image: `arts/cover.png` (630 × 500, the size itch.io asks for).
- Screenshots (1920 × 1080, in `arts/screenshots/`), suggested order and captions:
  1. `oasis_battle.png` — Firefight at the oasis: grenades, explosions and a flag to take back.
  2. `vehicle_combat.png` — Rocket tank vs jeep on the desert road.
  3. `crossroads_firefight.png` — Holding the centre of Crossroads.
  4. `promotion.png` — Rank up mid-match: 18 ranks from Private to General.
  5. `leaderboard.png` — End-of-match leaderboard and career progress.
  6. `main_menu.png` — Main menu, with a live AI battle running behind it.

## Release notes (devlog) — v1.0.0

First public release.

- Capture the Flag with tickets, 3 maps (Test Arena, Crossroads, Desert Village)
- Jeeps and rocket tanks, rocket launcher, frag grenades, weapon and grenade pickups
- Squad AI: cover, flanking, grenades, vehicles
- Scoring, 18 ranks saved between matches, end-of-match leaderboard
- Desktop (keyboard/mouse) and mobile (twin sticks, landscape), English and Italian
