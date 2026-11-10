# Changelog

All notable changes to BAF2D. Versions follow [semantic versioning](https://semver.org/); the current version is
in `config/game.json` (`version`) and shown in the bottom-right corner of the menu.

## [Unreleased]

### Added
- **Hit markers**: a tick around the crosshair (white on soldiers, orange on vehicles, longer and red on a kill) with
  a short sound whenever you hurt an enemy, with bullets, grenades, rockets or by running them over. On mobile it
  appears on the target.
- **Damage direction**: a red arc around your soldier points to where the shot came from; stronger hits are
  brighter.
- **Dynamic crosshair**: it opens up with your weapon's current spread.

### Changed
- **Recoil and movement**: sustained automatic fire spreads your shots wider (short bursts stay accurate),
  standing still tightens your aim, moving loosens it. Applies to bots as well.

## [1.3.0] — 2026-11-10

### Added
- **Deploy screen**: when you die a tactical map opens over the battle: pick where to respawn (your base, a flag you
  hold that isn't under attack, or a squadmate who isn't in a firefight) and press *Deploy* (or 1–9 / Enter, or tap
  twice on the map). It also tells you who killed you and with what.
- **Your squad**: three bot teammates follow you in formation and fight alongside you, marked in green. Press **T**
  (or the flag button on mobile) with the crosshair on a flag to send them to attack or defend it; press again to
  have them follow you. You can respawn on them.
- **Minimap** under the weapon panel (flags, teammates, your squad, enemies your team has spotted, vehicles) and a
  **kill feed** (who killed whom, and with what).
- **Sprint** (Shift, or push the left stick all the way on mobile): faster, but you can't shoot and it drains your
  stamina. Bots sprint too.
- **Suppression**: bullets whizzing past you darken the edges of the screen and throw your aim off; suppressed bots
  dive for cover.
- **Destructible maps**: crates, fences, hay bales, hedges, sandbags and walls can be destroyed. Damage shows as
  growing cracks; when a tile gives way it breaks apart in a burst of dust and debris and leaves the floor (or a
  pile of rubble) behind, opening new lines of fire and new paths.
  - Bullets splinter wood, shred hay and hedges and slowly rip sandbags apart.
  - Grenades blow apart light cover; rockets and tank shells breach brick, adobe and stone walls.
  - Tanks drive straight through fences, hedges, crates and sandbags; jeeps through fences and crates.
  - Bots look for new cover when theirs is blown away.
  - Maps are restored to their original state for the rematch; the outer edge of every map can't be destroyed.

## [1.2.0] — 2026-11-10

### Added
- **Time limit** (*New game* → *Time limit*, 5–60 minutes or none, 20 by default): a countdown under the flags turns
  red in the last minute; when time runs out the team with more tickets wins (then more flags, otherwise a draw).

### Changed
- Jeeps have light armour: rifles and machine guns now wear them down slowly (jeep against jeep is a real fight).
- Soldiers no longer respawn on a flag with enemies close by: they pick a safer flag, or the base.
- On maps with vehicles each bot team always has at least one rocket launcher.

### Fixed
- Bots no longer all sit on their own quiet flags: they attack while there are flags left to take, so matches
  (especially on Crossroads) no longer stall for ever.
- Two enemy vehicles no longer hold the same flag contested for ever: the one that can't hurt the other moves on.
- Squad AI shared enemy sightings correctly (they were forgotten almost immediately), so squads react better to
  threats and to enemy vehicles.
- Bots no longer stand still next to a weapon they can't quite reach.

## [1.1.2] — 2026-11-10

### Fixed
- A bot loadout naming a weapon that doesn't exist no longer crashes the match (a warning is logged instead).
- An empty vehicle no longer "reserves" the flag its AI had picked, so bot vehicles spread across the flags properly;
  defending bot vehicles no longer recompute their objective every frame.
- Debug keys F4–F9 only work with `?debug=1` in the URL (or `"debug": true` in `config/game.json`).
- Soldier portrait: goggles were missing when worn with a cap or boonie hat; they are now worn over the eyes (with
  the helmet they stay pushed up as before).
- Grenade scorch marks no longer bleed into the neighbouring sprite variant.
- Main menu scene: fires on city blocks spanning several chunks were drawn 2–4 times (extra light and smoke); explosion
  smoke and flare trails now respect the smoke limit.
- Map editor: typing a name or description is a single undo step instead of one per letter; weapons and vehicles
  placed in the editor use the same defaults as in the game, and pickups show the same weapon name as the HUD.

### Changed
- Performance: shared audio noise buffer, faster pathfinding and reachability for the AI, cached weapon and medal
  lists, faster particle cleanup, fewer text measurements in the HUD, faster map rendering and menu scene drawing.
- The map check (editor and level tools) is about twice as fast, with identical results.
- The map editor palette updates the highlighted entry instead of rebuilding itself on every pick.

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
