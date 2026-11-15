# Changelog

All notable changes to BAF2D. Versions follow [semantic versioning](https://semver.org/); the current version is
in `config/game.json` (`version`) and shown at the bottom of the main menu panel.

## [1.5.5] — 2026-11-15

### Added
- **Training** (main menu → *Training*): a drill sergeant takes you through 13 exercises on a new training ground:
  moving, sprinting, shooting at a firing range, reloading, grenades against dug-in targets, picking up the rocket
  launcher, knocking out a tank target, switching weapons, capturing a flag, getting in a jeep, driving and getting
  out, and a timed assault course at the end. A yellow marker on the ground (and an arrow at the screen edge) shows
  where to go, and the instructions match your keys or the touch controls. If you run out of time on the final
  test, it starts over.
- **Basic training medal**: complete the training to earn it and 250 career points (the points are only awarded
  the first time).
- **Difficulty** (*New game* → *Difficulty*): **Recruit**, **Soldier** (default) or **Veteran**. It changes how
  quickly the enemy bots react to you, how well they aim and lead their shots, how long they pause between bursts
  and how much damage they deal to you. Bots that spot you before you see them also wait a moment after they come
  on screen before opening fire. It only affects bots fighting *you*: bots fight each other exactly as before.
  *Veteran* plays like 1.5.0.

### Changed
- **One-on-one fights against bots are fairer.** At the default difficulty a bot takes about twice as long to bring
  you down in a duel (about 5–7 s instead of 2.5–3.5 s at medium range).
- **Briefing**: the match no longer starts on its own after a couple of seconds. It waits until you press a key or
  tap the screen.
- **Touch controls**: the reload and switch-weapon buttons moved to an arc on the left of the right stick, so they
  are no longer hidden under the minimap on phones. Sticks and buttons are always drawn on top of the HUD.
- *New game*: the "Procedural" map card ("coming soon") is gone.
- The weather selector in *New game* uses the same text size as the other options.

## [1.5.0] — 2026-11-14

### Added
- **Weather** (*New game* → *Weather*): the map's own weather, Clear, **Rain** or **Morning fog**. Rain falls slanted
  with the wind, splashes on the ground, fills puddles that reflect the sky and ripple under the drops, and darkens
  the colours. Fog drifts across the battlefield in thick banks. In the desert the dust gets denser during gusts.
- **Cloud shadows** sweep across the countryside and the desert with the wind.
- **Day to night** (*New game* → *Time of day*): the light slowly fades from day to dusk to night during the match.
- **Colour grading for each map**: the Arena is cold, the desert warm and washed out, the countryside lush.
  A light vignette frames the screen, and **film grain** can be turned on in *Options*.
- **Briefing**: when a match starts, the map you're about to fight on scrolls by behind a card with the operation
  name, your team, the number of soldiers, the time of day, the weather, the objective and a tip. Press any key or
  tap to start.
- **Loading screen** with a pixel progress bar and a tip.
- **Graphics quality** option (*Options*): *Low* drops the most expensive effects (the light on the soldiers'
  edges, one colour pass, half the rain and fog, fewer particles). It is selected automatically on touch devices.
- **Explosions**: a shaded fireball that turns into smoke, a dust shockwave in the colour of the ground, chunks of
  earth, and a scorch mark with embers that keep glowing for a while.
- **Effects**: running soldiers and vehicles kick up dust (sand, earth or mud), the helicopter rotor raises dust
  near the ground, blood drips in the direction of the shot and badly wounded soldiers leave a trail, the vehicles'
  machine guns fire tracers, the water ripples where bullets hit it, leaves and splinters fly off hedges and wood.
- **Vehicles**: jeeps and tanks with more detail (jerrycans, seats, roll bar, antennas, hatches, periscopes,
  exhausts, spare tracks) and camouflage, wheels and tracks that turn with the speed, front wheels that steer.
  Damage shows: scorched dents, panels that come off, the engine catches fire when the vehicle is badly hit, and
  wrecks are rusty and burn for a while.
- **HUD**: a tactical minimap with raised walls, water, flags and an icon for each vehicle type; arrows at the screen
  edge for flags and squadmates out of view; optional **damage numbers**; **five crosshair styles** to choose from in
  *Options*; bouncing pop-ups for points, medals and promotions.

### Changed
- **New game**: the map previews look like the real thing (blended terrain, trees and props, the map's colours).
- **Match end**: the result panel opens on a picture of the spot where the fighting was fiercest, with a marker
  where each soldier fell. Score rows slide in one by one and the rank bar fills up from where you started.
- **Menu transitions**: the panel and screens slide in, the briefing and loading screens close like a shutter.
- **Bots only shoot at you when they are on your screen.** A bot that was firing at you keeps shooting for a
  moment after it goes out of view, then stops: no more getting hit by enemies you can't see. Grenades are not
  affected, and bots fight each other as before.
- The version number is now at the bottom of the main menu panel.

### Fixed
- **No more hitches** when walls crack or collapse, when grenades leave craters or on the first explosion of a
  match (a single frame could take up to 0.75 s).
- **Faster rendering**, especially on phones: soldiers' shadows and edge light, battle scars, particles and the HUD
  are all cheaper to draw.
- On phones in landscape the first items of the main menu could be cut off at the top and impossible to reach.

## [1.4.0] — 2026-11-13

### Added
- **Time of day** (*New game* → *Time of day*): Day, Dusk or Night. At night the battlefield goes dark and is lit
  by muzzle flashes, explosions, fires, torches and lamps; vehicles turn their headlights on and you can see a
  short way around your soldier.
- **Dynamic lights**: muzzle flashes and explosions light up the ground, walls, soldiers and smoke around them;
  rockets glow in flight; a light blinks on top of a flag while it is being captured (in the capturing team's
  colour, amber when contested).
- **Lingering fires**: explosions leave small fires burning for a few seconds, with smoke, sparks and flickering
  light; a destroyed vehicle burns longer.
- **Battle scars**: craters stay where grenades and rockets went off, jeeps and tanks leave tyre and track marks,
  and spent casings, magazines and debris stay on the ground for the whole match.
- **Animations**: recoil kicks the upper body back, hit soldiers flash and flinch away from the shot, throwing a
  grenade twists the torso, sprinting soldiers carry their rifle across the chest. Soldiers fall away from the shot
  that killed them, in four different poses, and blood pools come in different shapes.
- **Map detail**: worn floor markings, oil stains, cracks, manholes, grates and cables in the Arena; tyre tracks,
  footprints, litter, tarps and old tyres in the desert; tufts of grass, wild flowers, fallen logs, hay bales and
  scarecrows in the countryside; reeds around the water. Animated water with glints and ripples. Trees and palms
  come in more sizes.
- **Counted ammunition**: every weapon has a limited reserve. Walk over a dropped weapon of the same kind to take its
  rounds, resupply at your base and at the flags you hold, or use the **ammo crates** placed on every map. The HUD
  tells you where to resupply when you run dry. Bots manage their ammo too.

### Changed
- **Soldiers are much easier to read**: a light edge on the side facing the sun, a cast shadow that falls the same
  way as the walls' shadows, more detailed gear (pouches, canteen, radio, sharper weapons), a bigger head.
- **Each team has its own silhouette**, readable even without colour: Blue wears helmets with netting and assault
  packs with a radio, Red wears wide-brimmed boonie hats and packs with a bedroll. Team colour now shows on the
  pack cover, armbands and helmet band.
- **Smoother rotation**: soldiers rotated at any angle keep clean outlines and details instead of turning grainy.
- **Walls with height**: walls, rocks, crates, sandbags and hedges show a shaded south face, lit top edges and a
  darker strip of ground at their base.
- **Terrain borders** are organic (sand into road, grass into mud, shorelines with foam) instead of square steps.

## [1.3.5] — 2026-11-10

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
