# Changelog

All notable changes to BAF2D. Versions follow [semantic versioning](https://semver.org/); the current version is
in `config/game.json` (`version`) and shown in the bottom-right corner of the menu.

## [1.1.0] — 2026-11-08

### Added
- **Soldier customization** (main menu → *Soldier*): a full-body front portrait of your soldier in hand-made-looking
  pixel art, drawn in code, with a subtle breathing animation.
  - **Call sign**: shown in the end-of-match leaderboard instead of "You".
  - **Starting weapon**: assault rifle, shotgun or pistol, with damage, rate of fire, magazine, range and reload bars.
    Any weapon marked `"loadout": true` in `config/weapons.json` appears in the list.
  - **Looks**: camo (desert, arid, woodland, digital, urban, tiger stripe, olive drab, black), tactical vest (plate
    carrier, chest rig, standard, heavy with many pouches) and its colour, headgear (helmet, helmet with NVG, boonie
    hat, cap), eyewear (sunglasses, ballistic glasses, goggles), beard and beard colour, skin tone, gloves, boots,
    headset, shemagh, knee pads. A *Random* button rolls a new look.
  - Everything is saved in the browser.
- **Unlocks tied to your rank**: many weapons and looks unlock as you rank up (shotgun at Private First Class, tiger
  stripe at Lieutenant, black camo at Colonel...). Locked items can still be previewed on the portrait, with a
  padlock and the rank they need; the end-of-match screen lists what your promotion just unlocked.
- **Medals**: 16 feats earned in battle, each with its own pixel-art medal, a banner and a jingle when you earn it,
  and bonus points for the leaderboard and your career: First blood, Double kill, Triple kill, Rampage, Killing
  spree, Unstoppable, Grenadier, Bazooka, Tank buster, Roadkill, Long shot, Revenge, Guardian, Flag runner, MVP and
  Untouchable. The end-of-match screen shows the medals of the match; the new *Medals* screen in the main menu
  keeps your whole collection and how many times you earned each one.
- **Map editor** (`editor.html`, main menu → *Map editor*, desktop only): set the map size, name and description;
  paint tiles (or random mixes of tile variants) with pencil, line, rectangle, fill and eraser tools, optionally
  with mirror symmetry; place team bases, flags (owner, radius, capture time), weapon and grenade pickups,
  decorations and vehicles; pick the weather and background. A built-in check flags unreachable areas and dead
  ends. Maps are saved and opened as JSON files (with an automatic draft in the browser, so you can finish a map
  over several sessions), and *Test map* plays it right away in the game.
- **New animated main menu**: the menu now opens on a night-time thermal camera feed from a drone over a city at
  war: vehicles and patrols moving through the streets, firefights with tracers, explosions that blind the sensor,
  fires and smoke, a helicopter dropping flares, white-hot / black-hot switching and a full drone HUD that locks on
  to targets.

### Changed
- Rubble that blocks movement is now drawn as raised piles of grey stone and brick chunks with broken beams, on a
  darker base with an outline and a shadow, so it clearly stands out from walkable sand and scattered debris.
- Main menu entries: *New game*, *Soldier*, *Medals*, *Options*, *Map editor*.

### Fixed
- Mobile: in *New game* the *Start* / *Back* buttons could sit on top of the map list instead of at the bottom of the
  screen.

## [1.0.2] — 2026-11-07

### Added
- **Attack helicopters**: a helicopter with a chin cannon and two rocket pods, one per team on Desert Village and
  Countryside. It takes off when you get in and flies over walls, water and trees; WASD flies in any direction and
  the nose follows your aim; press E to land and get out (only over open ground). Rockets hit it hard, small arms
  only scratch it, ground explosions can't reach it. Bots fly it too and shoot back at it.
- **New map: Countryside**: farmland between two zig-zag trench lines with sandbag parapets, a farmhouse in the
  middle, orchards, a pond, wheat fields, hedgerows, shell craters and woods; trees spread their canopy above the
  soldiers and a light breeze carries seeds and pollen.
- A flashing "RELOAD!" prompt when the magazine is empty, and an **auto reload** option (off by default).

### Changed
- Updated Test Arena description in the menu.

## [1.0.1] — 2026-11-07

### Changed
- Test Arena and Crossroads are as big as Desert Village and redesigned from scratch; all maps are symmetric and
  have no dead ends. Test Arena now has a jeep for each team.
- New keyboard driving: W accelerates, S brakes and reverses, A/D steer. Jeeps steer like a car, tanks turn on the
  spot.
- Bots move in pairs and spread across the flags; when an enemy vehicle shows up they fetch a rocket launcher and
  hunt it down; squads without anti-tank weapons avoid flags held by a vehicle; bot vehicles no longer get stuck
  against each other.
- Fallen soldiers' bodies fade after 3 seconds instead of 12.

## [1.0.0] — 2026-11-07

First public release.

- Capture the Flag with tickets, 3 maps (Test Arena, Crossroads, Desert Village).
- Jeeps and rocket tanks, rocket launcher, frag grenades, weapon and grenade pickups.
- Squad AI: cover, flanking, grenades, vehicles.
- Scoring, 18 ranks saved between matches, end-of-match leaderboard.
- Desktop (keyboard and mouse) and mobile (twin sticks, landscape), English and Italian.
