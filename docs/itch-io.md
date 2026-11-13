# BAF2D — itch.io page (v1.4.0)

Copy each block into the matching field of the itch.io "Edit game" page.

---

## Title

BAF2D

## Short description or tagline

Top-down pixel-art capture the flag by day or by night: destructible maps, your own squad, vehicles and helicopters, medals, unlocks and a map editor.

## Classification / Kind of project

- Classification: **Games**
- Kind of project: **HTML** (upload `dist/BAF2D-1.4.0-html5.zip`, tick "This file will be played in the browser")
- Release status: **Released**

## Embed options (Uploads → HTML)

- Viewport dimensions: **960 × 540** (16:9; the game scales to any size with crisp integer pixel scaling)
- **Mobile friendly**: on — Orientation: **Landscape**
- **Fullscreen button**: on
- Automatically start on page load: optional (the game opens on its own menu; audio starts after the first click/tap)

## Description

In the itch.io editor, switch the description field to **HTML** (the `<>` button) and paste the whole block below.

```html
<h2>Capture the flag. Hold the line. Bring a rocket launcher.</h2>

<p><strong>BAF2D</strong> is a fast top-down shooter in crisp pixel art. Two teams, a handful of flags and a pool of
tickets: capture and hold the flags, and make every enemy death count. <strong>The team that runs out of tickets
loses.</strong></p>

<p>You fight alongside (and against) AI soldiers that take cover, peek around corners, flank in pairs, throw grenades,
pick up better weapons and jump into vehicles. Every match feeds your career: score points, earn
<strong>medals</strong>, climb <strong>18 ranks from Private to General</strong> and unlock new gear for
<strong>your own soldier</strong>.</p>

<hr>

<h3>Features</h3>
<ul>
  <li><strong>Capture the Flag with tickets.</strong> Raise your flag in contested zones: flags you hold drain the
    enemy's tickets, and every death costs your team one. Pick the ticket count before each match.</li>
  <li><strong>Four large maps.</strong> The industrial <em>Test Arena</em>, <em>Crossroads</em> with its two
    avenues crossing at the centre, <em>Desert Village</em>: a windswept map with a ruined village, an oasis with
    palms, dry-stone walls and wide dirt roads built for vehicles, and <em>Countryside</em>: green farmland between
    two zig-zag trench lines with sandbag parapets, hedgerows, orchards, shell craters and a farmhouse in the middle.
    Every map is symmetric and has no dead ends: there is always another way round.</li>
  <li><strong>Day, dusk or night.</strong> Pick the time of day for every match. At night the battlefield is lit only
    by muzzle flashes, explosions, burning wrecks, torches and lamps, and vehicles drive with their headlights on.</li>
  <li><strong>A battlefield that remembers.</strong> Explosions leave craters and fires that burn for a while, tanks
    and jeeps leave track marks, spent casings pile up where the fighting was hardest.</li>
  <li><strong>Destructible maps.</strong> Crates, fences, hay bales, hedges, sandbags and walls crack and give way
    under fire: bullets chew through light cover, rockets breach brick and stone, tanks drive straight through
    fences and sandbags. Every firefight reshapes the battlefield.</li>
  <li><strong>Your squad.</strong> Three bot teammates follow you in formation: send them to attack or defend a flag
    with one key, or call them back. When you fall, pick where to redeploy on a tactical map: your base, a safe
    flag or a squadmate.</li>
  <li><strong>Vehicles.</strong> Drive a fast <strong>jeep</strong> with a mounted machine gun or a heavy
    <strong>rocket tank</strong>, or take to the air in an <strong>attack helicopter</strong> with a chin cannon and
    rocket pods that flies over walls and trees. Armour shrugs off small arms fire: bring a rocket launcher or
    grenades. Ramming enemies works too.</li>
  <li><strong>Weapons.</strong> Assault rifle, shotgun, pistol, frag grenades, and a shoulder-fired
    <strong>rocket launcher</strong> you carry next to your main gun. Ammunition is limited: scavenge it from fallen
    soldiers, resupply at your flags or grab an ammo crate. Fallen soldiers drop their weapons and grenades; map
    pickups respawn.</li>
  <li><strong>Squad AI.</strong> Bots move in pairs and spread across the flags, use cover, suppress, flank, dodge
    grenades, go and fetch a rocket launcher when enemy armour shows up, and drive vehicles to the flags. Up to
    8 vs 8.</li>
  <li><strong>Gunfeel.</strong> Hit markers on the crosshair (with a distinct kill confirm), red arcs that show where
    incoming fire comes from, a dynamic crosshair and recoil that rewards short bursts.</li>
  <li><strong>Career and ranks.</strong> Points for kills, assists, defending, capturing and destroying vehicles. Your
    rank is saved in the browser and grows from match to match, with a promotion screen when you rank up.</li>
  <li><strong>Medals.</strong> 16 feats to earn in battle: double and triple kills, killing sprees, grenade and
    rocket kills, tank buster, roadkill, long shot, revenge, MVP, untouchable... each with its own pixel-art medal,
    bonus points and a place in your collection.</li>
  <li><strong>Your soldier.</strong> Pick your call sign and starting weapon, then dress your soldier: camo,
    tactical vest, headgear, eyewear, beard, gloves, boots, headset, shemagh, knee pads, all shown on a full-body
    pixel-art portrait. New camos and gear unlock as you rank up.</li>
  <li><strong>Map editor.</strong> Build your own maps on desktop: tiles, flags, team bases, pickups, vehicles,
    decorations and weather, with symmetry tools and a check for dead ends. Save them as JSON and test them in the
    game with one click.</li>
  <li><strong>Desktop and mobile.</strong> Keyboard and mouse, or twin virtual sticks on touch screens
    (landscape).</li>
  <li><strong>English and Italian.</strong></li>
</ul>

<hr>

<h3>Controls</h3>
<table>
  <thead>
    <tr><th>Action</th><th>Keyboard &amp; mouse</th><th>Touch (landscape)</th></tr>
  </thead>
  <tbody>
    <tr><td>Move</td><td>WASD / arrow keys</td><td>Left stick</td></tr>
    <tr><td>Sprint</td><td>Shift</td><td>Push the left stick all the way</td></tr>
    <tr><td>Aim</td><td>Mouse</td><td>Right stick</td></tr>
    <tr><td>Fire</td><td>Left click / Space</td><td>Push the right stick past the dashed ring</td></tr>
    <tr><td>Reload</td><td>R</td><td>Reload button</td></tr>
    <tr><td>Throw grenade</td><td>G</td><td>Grenade button</td></tr>
    <tr><td>Pick up weapon / get in or out of a vehicle</td><td>E (or F)</td><td>Button that appears when available</td></tr>
    <tr><td>Switch weapon (rocket launcher)</td><td>Q</td><td>Swap button (with two weapons)</td></tr>
    <tr><td>Squad order (flag under the crosshair / follow me)</td><td>T</td><td>Order button (nearest flag)</td></tr>
    <tr><td>Pause</td><td>Esc / P</td><td>Pause button</td></tr>
  </tbody>
</table>
<p><em>In a vehicle:</em> <strong>W</strong>/<strong>S</strong> accelerate and brake/reverse, <strong>A</strong>/<strong>D</strong>
steer (on touch, push the left stick where you want to go); aim to turn the turret, fire for the machine gun,
<strong>G</strong> for rockets, <strong>R</strong> to reload. <em>In the helicopter:</em> <strong>WASD</strong> flies in
any direction and the nose follows your aim; <strong>E</strong> lands and gets you out (on open ground only).
Keys can be remapped in Options, where you can also turn on <strong>auto reload</strong>.</p>

<hr>

<h3>Notes</h3>
<ul>
  <li>Progress (rank, medals, your soldier, settings) is stored in your browser's local storage.</li>
  <li>The main menu runs a live thermal-camera drone feed over a city at war.</li>
  <li>On phones, play in landscape: the game asks for fullscreen on the first tap.</li>
  <li>All graphics and sounds are generated in code: no external assets, about 0.7&nbsp;MB to download.</li>
</ul>

<h3>Credits</h3>
<p>Made with plain JavaScript and HTML5 Canvas, no engine or libraries.<br>
Source code licensed under the GNU GPL v3.</p>
```

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
  1. `night_countryside.png` — Night battle in the countryside: a tank takes a flag by the light of a burning wreck.
  2. `dusk_desert.png` — Dusk in the desert village: torches, craters and fires after the fight.
  3. `main_menu.png` — The main menu: a live thermal drone feed over a city at war.
  4. `day_countryside.png` — Trench fighting in broad daylight, a downed helicopter in the field.
  5. `night_arena.png` — Night in the Test Arena: lamps, fires and muzzle flashes are all the light you get.
  6. `soldier_customization.png` — Build your soldier: call sign, starting weapon, camo, vest, gear.
  7. `medal_ingame.png` — Medals in battle: 16 feats, each with its own pixel-art medal.
  8. `match_end.png` — Victory: leaderboard, medals of the match, promotion and new unlocks.
  9. `apache_strike.png` — Attack helicopter run: rockets and cannon fire on the enemy trench line.
  10. `vehicle_combat.png` — Rocket tank vs jeep on the desert road.
  11. `map_editor.png` — The map editor: paint tiles, place flags, bases, pickups and vehicles, then test the map.
  12. `medals.png` — Your medal collection.
  13. `soldier_unlocks.png` — New camos and gear unlock as you rank up: preview them before you earn them.
- Not in the list: `leaderboard.png` (superseded by `match_end.png`), `editor.png` (superseded by
  `map_editor.png`), and the pre-1.4 battle shots `oasis_battle.png`, `crossroads_firefight.png`, `promotion.png`,
  `apache_rocket.png` (older graphics; replace them on the page with the new ones).

## Release notes (devlog) — v1.4.0

Title: **BAF2D 1.4.0 — Night battles and a battlefield that remembers**

Type: Major update. Attach `night_countryside.png` (cover of the post), `dusk_desert.png` and `night_arena.png`.

This is the biggest graphics update BAF2D has had so far. Soldiers are easier to read, walls have depth, light is
dynamic, and every match now starts with a new choice: day, dusk or night. Everything is still drawn in code, and
the whole game is still under 1 MB.

**Day, dusk or night**
- Pick **Day**, **Dusk** or **Night** in *New game*. At night the map goes dark, and your only light comes from
  muzzle flashes, explosions, burning wrecks, torches inside the houses and lamps along the Arena walls. Vehicles
  drive with their headlights on, and you can see a short way around your own soldier.
- Explosions light up the ground, walls, soldiers and smoke around them for a moment. They also leave small
  **fires** that keep burning with smoke and sparks. A destroyed vehicle burns for a while.
- Rockets glow in flight. A light blinks on top of a flag while it's being captured, in the colour of the team
  taking it, or amber when the flag is contested.

**Soldiers you can read at a glance**
- Each soldier has a light edge on the sunny side and a cast shadow that falls the same way as the walls' shadows,
  so they stand out on sand, grass or concrete.
- Their gear is more detailed (pouches, canteen, radio), weapons are sharper and the head is bigger, so you can
  tell where a soldier is looking.
- **Each team has its own silhouette**: Blue wears helmets with netting and carries radio packs, Red wears boonie
  hats and carries packs with a bedroll. You can tell friend from foe even without looking at the colours.
- Soldiers now rotate smoothly and keep clean outlines at any angle.
- **New animations**: recoil kicks the body back, hit soldiers flash and flinch, grenade throws twist the torso,
  and sprinters carry their rifle across the chest. Soldiers fall away from the shot that killed them, in four
  different poses.

**Maps with depth and detail**
- Walls, rocks, crates, sandbags and hedges have a shaded front face, lit top edges and a darker strip of ground
  at their base. The maps finally look three-dimensional.
- Terrains now blend into each other with natural edges: sand into road, grass into mud, foam along the shore.
  The water is animated, with glints and ripples.
- There is a lot more small detail:
  - **Arena**: worn floor markings, oil stains, manholes and cables.
  - **Desert**: tyre tracks, footprints, tarps and litter.
  - **Countryside**: grass tufts, wild flowers, fallen logs, hay bales and scarecrows.
  - Trees and palms come in more sizes.
- **Battle scars** stay until the end of the match: craters where the grenades landed, tank tracks across the
  roads, and spent casings piling up wherever the fighting was hardest.

**Gameplay: counted ammunition**
- Ammo is no longer infinite. You can take rounds from dropped weapons of the same kind, resupply at your base and
  at the flags you hold, or use one of the **ammo crates** placed on every map. When you run dry, the HUD tells you
  where to resupply. Bots manage their ammo too.

Your rank, medals and soldier carry over from previous versions.

Next up are richer explosions, dust kicked up by vehicles and running soldiers, and bullet impacts that look
different for each material. Try a night match on Countryside and tell me in the comments how it looks!

## Release notes (devlog) — v1.3.5

Title: **BAF2D 1.3.5 — Hit markers and recoil**

A small update focused on how shooting feels: you now always know when you hit, and where you're being hit from.

**Hit feedback**
- **Hit markers**: a tick flashes around the crosshair with a short sound whenever you hurt an enemy, with bullets,
  grenades, rockets or by running them over. White on soldiers, orange on vehicles, longer and red on a kill. On
  mobile it appears right on the target.
- **Damage direction**: a red arc around your soldier points to where the shot came from; stronger hits are
  brighter.
- **Dynamic crosshair**: it opens up and closes with your weapon's current spread, so you can see how accurate your
  next shot will be.

**Recoil and movement**
- Sustained automatic fire now spreads your shots wider, while short bursts stay accurate.
- Standing still tightens your aim, moving loosens it. Bots play by the same rules.

Have fun, and let me know in the comments how the shooting feels now!

## Release notes (devlog) — v1.3.0

Title: **BAF2D 1.3.0 — Destructible maps and your own squad**

This is the biggest update since launch. The battlefield now breaks apart under fire, and you no longer fight
alone: you get a squad of your own, a deploy screen and a minimap.

**Destructible maps**
- Crates, fences, hay bales, hedges, sandbags and walls can now be destroyed. Damage shows as growing cracks; when a
  tile gives way it bursts into dust and debris and opens new lines of fire and new paths.
- Bullets splinter wood and slowly rip sandbags apart, grenades blow light cover away, rockets and tank shells
  breach brick, adobe and stone. Tanks drive straight through fences, hedges, crates and sandbags; jeeps through
  fences and crates.
- That sandbag wall you're hiding behind won't last for ever. Bots know it too: they look for new cover when theirs
  is blown away.
- Maps are restored to their original state for the rematch, and the outer edge of every map stays intact.

**Your squad**
- Three bot teammates follow you in formation and fight alongside you, marked in green.
- Press **T** with the crosshair on a flag to send them to attack or defend it, and press it again to have them
  follow you. On mobile, the order button sends them to the nearest flag.

**Deploy screen**
- When you die, a tactical map opens over the battle and shows who killed you and with what.
- Choose where to respawn: your base, a flag you hold that isn't under attack, or a squadmate who isn't in a
  firefight. Press *Deploy* (or 1–9 / Enter, or tap the map twice).

**Battlefield awareness**
- **Minimap** under the weapon panel: flags, teammates, your squad, enemies your team has spotted and vehicles.
- **Kill feed**: who killed whom, and with what.
- **Sprint** with Shift (or push the left stick all the way on mobile): you move faster, but you can't shoot and
  it drains your stamina. Bots sprint too.
- **Suppression**: bullets whizzing past darken the edges of the screen and throw your aim off. Suppressed bots
  dive for cover, so keeping their heads down is now a real tactic.

Sprint and squad orders can be remapped in *Options* like every other key. Have fun, and let me know in the
comments how the new squads play!

## Release notes (devlog) — v1.2.0

Title: **BAF2D 1.2.0 — Time limit and smarter squads**

**Time limit**
- New option in *New game*: a time limit from 5 to 60 minutes (or none; 20 by default). The countdown sits under
  the flags and turns red in the last minute. When time runs out, the team with more tickets wins.

**Smarter squads**
- Bots no longer sit on their own quiet flags while there are flags left to take: matches keep moving and never
  stall (Crossroads could get stuck for good before).
- Squads now really share what they spot, so they react faster to attacks and to enemy vehicles.
- On maps with vehicles every bot team always carries at least one rocket launcher.
- Bots no longer freeze next to a weapon they can't quite reach.

**Vehicles**
- Jeeps have light armour: rifles and machine guns wear them down slowly, so jeep against jeep is now a real fight.
- Two enemy vehicles no longer hold the same flag contested for ever.

**Respawn**
- You no longer respawn on a flag with enemies right next to it: you get a safer flag, or the base.

**Results**
- Across dozens of simulated bot matches: no more stalemates, more close finishes, and far fewer soldiers shot
  right after respawning.

## Release notes (devlog) — v1.1.2

Title: **BAF2D 1.1.2 — Bug fixes and performance**

**Fixes**
- Bot vehicles spread across the flags properly: an empty vehicle no longer keeps a flag "reserved".
- Goggles now show on your soldier's portrait when worn with a cap or boonie hat.
- Grenade scorch marks no longer bleed into the wrong shape.
- Main menu: burning city blocks no longer stack up duplicate fires and smoke.
- Map editor: typing a map name or description is now a single undo step.
- Debug keys are disabled in normal play.

**Performance**
- Smoother play on slower devices: faster AI pathfinding, particles, HUD and map rendering, and a lighter main menu
  scene. The map editor's check runs about twice as fast.

## Release notes (devlog) — v1.1.0

Title: **BAF2D 1.1.0 — Your soldier, medals, unlocks and a map editor**

**Your soldier**
- New *Soldier* screen: choose your call sign (shown in the leaderboard) and your starting weapon (with damage,
  rate of fire, magazine, range and reload at a glance).
- Dress your soldier on a full-body pixel-art portrait: camo (8 patterns), tactical vest (plate carrier, chest rig,
  standard, heavy), vest colour, headgear (helmet, helmet with night vision, boonie hat, cap), eyewear, beard and
  beard colour, skin tone, gloves, boots, headset, shemagh and knee pads. Feeling lucky? Hit *Random*.

**Unlocks**
- Many weapons and looks now unlock as you rank up: the shotgun after your first promotion, then new camos, vests,
  night vision, the shemagh... Locked items can be previewed with a padlock and the rank they need, and the
  end-of-match screen tells you what your promotion just unlocked.

**Medals**
- 16 medals to earn in battle: First blood, Double kill, Triple kill, Rampage, Killing spree, Unstoppable,
  Grenadier, Bazooka, Tank buster, Roadkill, Long shot, Revenge, Guardian, Flag runner, MVP and Untouchable.
- Each one pops up with its own pixel-art medal and a jingle and gives bonus points; the end-of-match screen shows
  the medals of the match and the new *Medals* screen keeps your whole collection.

**Map editor** (desktop)
- Build your own maps: size, name, description, tiles with random variants, flags, team bases, weapon and grenade
  pickups, vehicles, decorations and weather, with mirror symmetry and a check for unreachable areas and dead ends.
- Save and open maps as JSON (an automatic draft keeps your work between sessions) and press *Test map* to play it
  right away.

**New main menu**
- The menu now opens on a live thermal camera feed from a drone over a city at war: convoys, patrols, firefights,
  explosions that blind the sensor, a helicopter dropping flares and a drone HUD that locks on to targets.

**Other**
- Solid rubble is now drawn as raised piles that clearly stand out from walkable sand.
- Mobile: the *Start* / *Back* buttons in *New game* now always sit at the bottom of the screen.

## Release notes (devlog) — v1.0.2

Title: **BAF2D 1.0.2 — Attack helicopters and a new Countryside map**

**Attack helicopters**
- New vehicle: an attack helicopter with a chin cannon and two rocket pods, one per team on Desert Village and
  Countryside.
- It takes off when you get in and flies over walls, water and trees; its shots and rockets pass over walls too.
  WASD flies in any direction, the nose follows your aim. Press E to land and get out (only over open ground).
- Rockets hit it hard, rifles and machine guns only scratch it. Grenades and ground explosions can't reach it in
  the air, and a pilot in flight doesn't count towards capturing flags.
- Bots fly it too: they patrol the flags and strafe enemies from above. On foot they shoot back at it instead of
  running for cover, and jeeps engage it with their machine guns.

**New map: Countryside**
- Green farmland between two zig-zag trench lines with sandbag parapets and plenty of exits, a command post on
  each base flag, a brick farmhouse to fight over in the middle, orchards, a pond, wheat fields, hedgerows, shell
  craters and woods all around. Trees spread their canopy above the soldiers, and a light breeze carries seeds
  and pollen.
- Like the other maps it is symmetric and has no dead ends.

**Reloading**
- A flashing "RELOAD!" prompt appears when your magazine is empty.
- New option: auto reload, which starts reloading as soon as the magazine runs dry (off by default).

**Other**
- Updated Test Arena description in the menu.

## Release notes (devlog) — v1.0.1

Title: **BAF2D 1.0.1 — Bigger maps, smarter squads, car-style driving**

**Maps**
- Test Arena and Crossroads are now as big as Desert Village, and redesigned from scratch.
- All maps are symmetric, so both teams start on equal terms.
- No more dead ends: every building and alley has at least two ways out, on every map.
- Test Arena now has a jeep for each team.

**Driving**
- New keyboard controls for vehicles: W accelerates, S brakes and reverses, A/D steer, whichever way the vehicle
  is facing on screen. Jeeps steer like a car, tanks can turn on the spot. Touch controls are unchanged.

**AI**
- Bots now move in pairs and spread across the flags instead of all rushing the same one, both when attacking and
  when defending.
- When an enemy vehicle shows up, bots go and fetch a rocket launcher from anywhere on the map, then hunt the
  vehicle down. Squads without anti-tank weapons stop walking into a flag held by a vehicle.
- Vehicles driven by bots no longer get stuck pushing against each other on the same flag.

**Other**
- Fallen soldiers' bodies now fade after 3 seconds instead of 12.

## Release notes (devlog) — v1.0.0

First public release.

- Capture the Flag with tickets, 3 maps (Test Arena, Crossroads, Desert Village)
- Jeeps and rocket tanks, rocket launcher, frag grenades, weapon and grenade pickups
- Squad AI: cover, flanking, grenades, vehicles
- Scoring, 18 ranks saved between matches, end-of-match leaderboard
- Desktop (keyboard/mouse) and mobile (twin sticks, landscape), English and Italian
