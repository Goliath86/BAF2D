# BAF2D — itch.io page (v1.2.0)

Copy each block into the matching field of the itch.io "Edit game" page.

---

## Title

BAF2D

## Short description or tagline

Top-down pixel-art capture the flag: squad AI, vehicles and helicopters, medals, unlocks, a custom soldier and a map editor.

## Classification / Kind of project

- Classification: **Games**
- Kind of project: **HTML** (upload `dist/BAF2D-1.2.0-html5.zip`, tick "This file will be played in the browser")
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
  <li><strong>Vehicles.</strong> Drive a fast <strong>jeep</strong> with a mounted machine gun or a heavy
    <strong>rocket tank</strong>, or take to the air in an <strong>attack helicopter</strong> with a chin cannon and
    rocket pods that flies over walls and trees. Armour shrugs off small arms fire: bring a rocket launcher or
    grenades. Ramming enemies works too.</li>
  <li><strong>Weapons.</strong> Assault rifle, shotgun, pistol, frag grenades, and a shoulder-fired
    <strong>rocket launcher</strong> you carry next to your main gun. Fallen soldiers drop their weapons and grenades;
    map pickups respawn.</li>
  <li><strong>Squad AI.</strong> Bots move in pairs and spread across the flags, use cover, suppress, flank, dodge
    grenades, go and fetch a rocket launcher when enemy armour shows up, and drive vehicles to the flags. Up to
    8 vs 8.</li>
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
    <tr><td>Aim</td><td>Mouse</td><td>Right stick</td></tr>
    <tr><td>Fire</td><td>Left click / Space</td><td>Push the right stick past the dashed ring</td></tr>
    <tr><td>Reload</td><td>R</td><td>Reload button</td></tr>
    <tr><td>Throw grenade</td><td>G</td><td>Grenade button</td></tr>
    <tr><td>Pick up weapon / get in or out of a vehicle</td><td>E (or F)</td><td>Button that appears when available</td></tr>
    <tr><td>Switch weapon (rocket launcher)</td><td>Q</td><td>Swap button (with two weapons)</td></tr>
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
  <li>All graphics and sounds are generated in code: no external assets, about 0.5&nbsp;MB to download.</li>
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
  1. `main_menu.png` — The new main menu: a live thermal drone feed over a city at war.
  2. `soldier_customization.png` — Build your soldier: call sign, starting weapon, camo, vest, gear.
  3. `oasis_battle.png` — Firefight at the oasis: grenades, explosions and a flag to take back.
  4. `medal_ingame.png` — Medals in battle: 16 feats, each with its own pixel-art medal.
  5. `match_end.png` — Victory: leaderboard, medals of the match, promotion and new unlocks.
  6. `medals.png` — Your medal collection.
  7. `soldier_unlocks.png` — New camos and gear unlock as you rank up: preview them before you earn them.
  8. `apache_strike.png` — Attack helicopter run: rockets and cannon fire on the enemy trench line.
  9. `vehicle_combat.png` — Rocket tank vs jeep on the desert road.
  10. `map_editor.png` — The map editor: paint tiles, place flags, bases, pickups and vehicles, then test the map.
  11. `crossroads_firefight.png` — Holding the centre of Crossroads.
  12. `promotion.png` — Rank up mid-match: 18 ranks from Private to General.
  13. `apache_rocket.png` — Enemy gunship over the desert: a rocket launcher is your best friend.
- Not in the list: `leaderboard.png` (superseded by `match_end.png`) and `editor.png` (superseded by
  `map_editor.png`).

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
