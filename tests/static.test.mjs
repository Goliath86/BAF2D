// Test statici (solo Node, niente browser): configurazione JSON coerente, lingue complete, livelli validi,
// generatori che riproducono i livelli committati, algoritmo dei vicoli ciechi, import/export dell'editor.
// Uso: node --test tests/        (oppure: node --test tests/static.test.mjs)

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { ROOT } from './lib/browser.mjs';
import { checkGrid } from '../js/engine/levelcheck.js';
import { walkGrid } from '../tools/check_level.mjs';
import { EditorMap, objectKey } from '../js/editor/model.js';

const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const json = (p) => JSON.parse(read(p));
const lookup = (obj, key) => key.split('.').reduce((n, k) => (n && typeof n === 'object' ? n[k] : undefined), obj);

const game = json('config/game.json');
const assets = json('config/assets.json');
const weaponsCfg = json('config/weapons.json');
const effects = json('config/effects.json');
const vehiclesCfg = json('config/vehicles.json');
const langs = Object.fromEntries((game.i18n.available || ['en']).map((l) => [l, json(`config/lang/${l}.json`)]));
const en = langs[game.i18n.default || 'en'];

/** Tutti i file sotto dir (relativi a ROOT) con una delle estensioni. */
function files(dir, exts) {
  const out = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(path.join(ROOT, d), { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (exts.some((x) => e.name.endsWith(x))) out.push(p);
    }
  };
  walk(dir);
  return out;
}

/** Chiavi "a.b.c" delle foglie di un oggetto lingua, con il tipo (string/array). */
function leaves(obj, prefix = '', out = new Map()) {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (Array.isArray(v)) out.set(key, 'array');
    else if (v && typeof v === 'object') leaves(v, key, out);
    else out.set(key, typeof v);
  }
  return out;
}

const placeholders = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');

describe('configurazione', () => {
  test('tutti i JSON di config/ si leggono', () => {
    for (const f of files('config', ['.json'])) {
      assert.doesNotThrow(() => JSON.parse(read(f)), `${f} non è JSON valido`);
    }
    JSON.parse(read('manifest.webmanifest'));
  });

  test('sprite: "extends" punta a sprite esistenti', () => {
    for (const [id, s] of Object.entries(assets.sprites)) {
      if (s.extends) assert.ok(assets.sprites[s.extends], `sprite ${id}: extends "${s.extends}" non esiste`);
    }
  });

  test('armi: sprite, suoni, effetti, razzi e nomi esistono', () => {
    const d = weaponsCfg.defaults;
    for (const [id, own] of Object.entries(weaponsCfg.weapons)) {
      const w = { ...d, ...own };
      for (const k of ['bodySprite', 'pickupSprite', 'bulletSprite']) {
        if (w[k]) assert.ok(assets.sprites[w[k]], `${id}.${k} = "${w[k]}" non è in assets.json -> sprites`);
      }
      for (const k of ['sound', 'reloadSound', 'emptySound']) {
        if (w[k]) assert.ok(assets.sounds[w[k]], `${id}.${k} = "${w[k]}" non è in assets.json -> sounds`);
      }
      if (w.muzzleFlash) assert.ok(effects.muzzles[w.muzzleFlash], `${id}.muzzleFlash "${w.muzzleFlash}"`);
      if (w.casing) assert.ok(effects.casings[w.casing], `${id}.casing "${w.casing}"`);
      if (w.reloadDrop) assert.ok(effects.casings[w.reloadDrop], `${id}.reloadDrop "${w.reloadDrop}"`);
      if (w.rocket) assert.ok(weaponsCfg.rockets[w.rocket], `${id}.rocket "${w.rocket}"`);
      if (w.loadout) assert.ok(w.portrait, `${id}: arma "loadout" senza "portrait"`);
      if (w.reserve !== undefined) assert.ok(Number.isInteger(w.reserve) && w.reserve >= 0, `${id}.reserve`);
      assert.equal(typeof lookup(en, w.name), 'string', `${id}: nome "${w.name}" mancante nella lingua`);
    }
    for (const [id, own] of Object.entries(weaponsCfg.rockets)) {
      const r = { ...weaponsCfg.rocketDefaults, ...own };
      if (r.explosion) assert.ok(effects.explosions[r.explosion], `razzo ${id}: explosion "${r.explosion}"`);
      if (r.trail) assert.ok(effects.trails[r.trail], `razzo ${id}: trail "${r.trail}"`);
      if (r.sprite) assert.ok(assets.sprites[r.sprite], `razzo ${id}: sprite "${r.sprite}"`);
    }
    for (const [id, own] of Object.entries(weaponsCfg.grenades)) {
      const g = { ...weaponsCfg.grenadeDefaults, ...own };
      if (g.explosion) assert.ok(effects.explosions[g.explosion], `granata ${id}: explosion "${g.explosion}"`);
      if (g.sprite) assert.ok(assets.sprites[g.sprite], `granata ${id}: sprite "${g.sprite}"`);
    }
  });

  test('mezzi: sprite, suoni e armi esistono', () => {
    for (const [id, own] of Object.entries(vehiclesCfg.vehicles)) {
      const v = { ...vehiclesCfg.defaults, ...own };
      for (const k of ['sprite', 'turretSprite']) if (v[k]) assert.ok(assets.sprites[v[k]], `${id}.${k} "${v[k]}"`);
      if (v.engineSound) assert.ok(assets.sounds[v.engineSound], `${id}.engineSound "${v.engineSound}"`);
      for (const w of v.weapons || []) assert.ok(weaponsCfg.weapons[w]?.vehicleOnly, `${id}: arma "${w}" non è "vehicleOnly"`);
      assert.equal(typeof lookup(en, v.name), 'string', `${id}: nome "${v.name}" mancante nella lingua`);
    }
  });

  test('oggetti a terra, bot e munizioni puntano a cose esistenti', () => {
    const p = game.pickups;
    for (const [type, def] of Object.entries(p.types)) {
      if (def.weapon) assert.ok(weaponsCfg.weapons[def.weapon], `pickups.types.${type}: arma "${def.weapon}"`);
      else assert.ok(def.ammo > 0 || def.grenades > 0, `pickups.types.${type}: né arma né munizioni né granate`);
    }
    for (const k of ['grenadeSprite', 'ammoSprite']) if (p[k]) assert.ok(assets.sprites[p[k]], `pickups.${k}`);
    for (const k of ['weaponSound', 'grenadeSound']) if (p[k]) assert.ok(assets.sounds[p[k]], `pickups.${k}`);
    if (game.ammo?.sound) assert.ok(assets.sounds[game.ammo.sound], 'ammo.sound');
    for (const id of game.bots.weapons) {
      for (const w of id.split('+')) assert.ok(weaponsCfg.weapons[w], `bots.weapons: "${w}"`);
    }
    assert.ok(weaponsCfg.weapons[game.player.weapon], 'player.weapon');
  });

  test('fusione dei terreni: i terreni nominati da tile e fasce di confine esistono', () => {
    for (const [ts, def] of Object.entries(assets.tilesets)) {
      const terrains = def.terrains || {};
      for (const t of def.tiles) {
        if (t.terrain) assert.ok(terrains[t.terrain], `tileset ${ts}, tile ${t.name}: terrain "${t.terrain}" non è in "terrains"`);
        if (t.terrain) assert.ok(!t.solid || t.shootThrough, `tileset ${ts}, tile ${t.name}: un muro non deve fondersi (bordo diverso dalla collisione)`);
      }
      for (const [name, tr] of Object.entries(terrains)) {
        assert.ok(def.tiles.some((t) => t.terrain === name), `tileset ${ts}: terreno "${name}" senza tile`);
        for (const [other, rim] of Object.entries(tr.rim || {})) {
          assert.ok(other === '*' || terrains[other], `tileset ${ts}: ${name}.rim.${other} non è un terreno`);
          assert.ok(Array.isArray(rim.colors) && rim.colors.every((c) => /^#[0-9a-f]{6}$/i.test(c)), `tileset ${ts}: ${name}.rim.${other}.colors (#rrggbb)`);
        }
      }
    }
  });

  test('dettagli a terra e decorazioni automatiche: disegni, tile, terreni e tipi esistono', () => {
    const paints = ['stain', 'crack', 'manhole', 'grate', 'cable', 'marking', 'tracks', 'footprints', 'bits', 'tuft'];
    for (const [ts, def] of Object.entries(assets.tilesets)) {
      const names = new Set(def.tiles.map((t) => t.name));
      const terrains = def.terrains || {};
      const refs = (list, where) => {
        for (const s of [].concat(list || [])) {
          if (s.startsWith('terrain:')) assert.ok(terrains[s.slice(8)], `tileset ${ts}, ${where}: terreno "${s}"`);
          else assert.ok(names.has(s), `tileset ${ts}, ${where}: tile "${s}"`);
        }
      };
      (def.scatter || []).forEach((r, i) => {
        assert.ok(paints.includes(r.paint), `tileset ${ts}, scatter[${i}]: disegno "${r.paint}"`);
        for (const k of ['on', 'near', 'far']) refs(r[k], `scatter[${i}].${k}`);
      });
      (def.autoProps || []).forEach((r, i) => {
        const type = game.props.types[r.type];
        assert.ok(type, `tileset ${ts}, autoProps[${i}]: tipo "${r.type}" non è in game.json -> props.types`);
        assert.ok(assets.sprites[type.sprite], `props.types.${r.type}: sprite "${type.sprite}"`);
        for (const k of ['on', 'near', 'far']) refs(r[k], `autoProps[${i}].${k}`);
      });
    }
  });

  test('effetti: i tipi di impatto dei tile esistono', () => {
    for (const [ts, def] of Object.entries(assets.tilesets)) {
      for (const t of def.tiles) {
        if (t.impact) assert.ok(effects.impacts[t.impact], `tileset ${ts}, tile ${t.name}: impact "${t.impact}"`);
        if (t.material) assert.ok(game.destruction.materials[t.material], `tileset ${ts}, tile ${t.name}: material "${t.material}"`);
      }
    }
  });
});

describe('lingue', () => {
  test('tutti i file lingua hanno le stesse chiavi (e gli stessi segnaposto)', () => {
    const ref = leaves(en);
    for (const [lang, dict] of Object.entries(langs)) {
      const keys = leaves(dict);
      const missing = [...ref.keys()].filter((k) => !keys.has(k));
      const extra = [...keys.keys()].filter((k) => !ref.has(k));
      assert.deepEqual(missing, [], `${lang}: chiavi mancanti`);
      assert.deepEqual(extra, [], `${lang}: chiavi in più rispetto a ${game.i18n.default}`);
      const wrongType = [...ref].filter(([k, t]) => keys.get(k) !== t).map(([k]) => k);
      assert.deepEqual(wrongType, [], `${lang}: tipo diverso (testo/lista)`);
      const wrongParams = [...ref]
        .filter(([k, t]) => t === 'string' && placeholders(lookup(en, k)) !== placeholders(lookup(dict, k)))
        .map(([k]) => `${k}: {${placeholders(lookup(en, k))}} != {${placeholders(lookup(dict, k))}}`);
      assert.deepEqual(wrongParams, [], `${lang}: segnaposto diversi`);
    }
  });

  test('le chiavi usate nel codice e nell\'HTML esistono', () => {
    const used = new Map(); // chiave -> file
    for (const f of [...files('js', ['.js']), 'index.html', 'editor.html']) {
      // senza commenti (gli esempi nei commenti non sono chiavi vere)
      const src = read(f).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/<!--[\s\S]*?-->/g, '');
      for (const m of src.matchAll(/\b(?:t|list|has)\(\s*'([a-zA-Z][\w]*(?:\.[\w]+)+)'/g)) used.set(m[1], f);
      for (const m of src.matchAll(/data-i18n(?:-title)?="([\w.]+)"/g)) used.set(m[1], f);
    }
    assert.ok(used.size > 50, `troppe poche chiavi trovate (${used.size}): espressione regolare da rivedere`);
    const missing = [...used].filter(([k]) => lookup(en, k) === undefined).map(([k, f]) => `${k} (${f})`);
    assert.deepEqual(missing, [], 'chiavi senza testo');
  });

  test('livelli, squadre e medaglie hanno i loro testi', () => {
    for (const l of game.levels) assert.equal(typeof lookup(en, `levels.${l.id}.name`), 'string', `levels.${l.id}.name`);
    for (const t of Object.keys(game.teams)) assert.equal(typeof lookup(en, `teams.${t}`), 'string', `teams.${t}`);
    const medals = json('config/medals.json');
    for (const m of medals.list) assert.equal(typeof lookup(en, `medals.${m.id}.name`), 'string', `medals.${m.id}.name`);
  });
});

describe('livelli', () => {
  const props = game.props?.types || {};
  for (const entry of game.levels) {
    test(`${entry.id}: legend, oggetti, simmetria e percorribilità`, () => {
      const level = json(entry.file);
      const tileset = assets.tilesets[level.tileset];
      assert.ok(tileset, `tileset "${level.tileset}"`);
      const tileNames = new Set(tileset.tiles.flatMap((t) => [t.name, t.id]));
      const tiles = (ref) => (Array.isArray(ref) ? ref : [ref]);
      for (const t of tiles(level.fill)) assert.ok(tileNames.has(t), `fill "${t}"`);
      if (level.weather) assert.ok(effects.weather[level.weather], `weather "${level.weather}"`);
      const spawns = new Set();
      const flagIds = new Set();
      for (const [ch, e] of Object.entries(level.legend)) {
        const obj = e && typeof e === 'object' && !Array.isArray(e) ? e : { tile: e };
        for (const t of tiles(obj.tile)) assert.ok(tileNames.has(t), `legend "${ch}": tile "${t}" non è nel tileset`);
        if (obj.variantWeights) assert.equal(obj.variantWeights.length, tiles(obj.tile).length, `legend "${ch}": variantWeights`);
        if (obj.pickup) assert.ok(game.pickups.types[obj.pickup], `legend "${ch}": pickup "${obj.pickup}"`);
        if (obj.vehicle) assert.ok(vehiclesCfg.vehicles[obj.vehicle], `legend "${ch}": vehicle "${obj.vehicle}"`);
        if (obj.prop) assert.ok(props[obj.prop], `legend "${ch}": prop "${obj.prop}"`);
        if (obj.team) assert.ok(game.teams[obj.team], `legend "${ch}": team "${obj.team}"`);
        if (obj.spawn) spawns.add(obj.spawn);
        if (obj.flag) flagIds.add(obj.flag);
      }
      for (const t of Object.keys(game.teams)) assert.ok(spawns.has(t), `nessuno spawn per "${t}"`);
      assert.ok(flagIds.size > 0, 'nessuna bandiera');
      for (const id of Object.keys(level.flags || {})) assert.ok(flagIds.has(id), `flags.${id} senza cella nella mappa`);

      const W = level.map[0].length;
      const H = level.map.length;
      level.map.forEach((r, y) => assert.equal(r.length, W, `riga ${y} lunga ${r.length} invece di ${W}`));
      const unknown = new Set([...level.map.join('')].filter((c) => !(c in level.legend)));
      assert.deepEqual([...unknown], [], 'caratteri della mappa senza voce nella legend');

      const walk = walkGrid(level, assets);
      const asym = [];
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (walk[y][x] !== walk[H - 1 - y][W - 1 - x]) asym.push(`${x},${y}`);
      assert.deepEqual(asym.slice(0, 5), [], 'mappa non simmetrica (rotazione di 180°)');
      const res = checkGrid(walk);
      assert.equal(res.unreachable, 0, 'celle percorribili irraggiungibili');
      assert.deepEqual(res.deadEnds.map((d) => `${d.x},${d.y} (largo ${d.scale}, profondo ${d.depth})`), [], 'vicoli ciechi');
    });
  }

  test('i generatori riproducono esattamente i livelli committati', () => {
    // copia temporanea di tools/, config/ e levelcheck.js: i generatori scrivono lì, non nel repo
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'baf2d-gen-'));
    try {
      fs.cpSync(path.join(ROOT, 'tools'), path.join(tmp, 'tools'), { recursive: true });
      fs.cpSync(path.join(ROOT, 'config'), path.join(tmp, 'config'), { recursive: true });
      fs.mkdirSync(path.join(tmp, 'js', 'engine'), { recursive: true });
      fs.copyFileSync(path.join(ROOT, 'js/engine/levelcheck.js'), path.join(tmp, 'js/engine/levelcheck.js'));
      const gens = fs.readdirSync(path.join(ROOT, 'tools')).filter((f) => /^gen_.*\.mjs$/.test(f));
      assert.ok(gens.length >= 4, 'generatori non trovati');
      for (const g of gens) {
        const src = read(`tools/${g}`);
        const out = src.match(/config\/levels\/(level\d+\.json)/)?.[1];
        assert.ok(out, `${g}: file di uscita non trovato`);
        execFileSync(process.execPath, [path.join('tools', g)], { cwd: tmp, stdio: 'pipe' });
        const want = read(`config/levels/${out}`).replace(/\r\n/g, '\n');
        const got = fs.readFileSync(path.join(tmp, 'config/levels', out), 'utf8').replace(/\r\n/g, '\n');
        assert.ok(got === want, `${g} produce un ${out} diverso da quello nel repo: rigenerare o aggiornare il generatore`);
      }
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe('algoritmi', () => {
  const grid = (rows) => rows.map((r) => [...r].map((c) => c !== '#'));

  test('checkGrid: stanza aperta da due lati = nessun vicolo cieco', () => {
    const res = checkGrid(grid([
      '##############',
      '#............#',
      '#............#',
      '#....####....#',
      '#....#..#....#',
      '#.......#....#',
      '#....#..#....#',
      '#....##.#....#',
      '#............#',
      '##############',
    ]));
    assert.equal(res.unreachable, 0);
    assert.equal(res.deadEnds.length, 0);
  });

  test('checkGrid: corridoio chiuso profondo = vicolo cieco; zona isolata = irraggiungibile', () => {
    const res = checkGrid(grid([
      '##############',
      '#............#',
      '#............#',
      '#............#',
      '######.#######',
      '######.#######',
      '######.#######',
      '######.#######',
      '######.###..##',
      '##############',
    ]));
    assert.ok(res.deadEnds.length > 0, 'il corridoio senza uscita deve essere un vicolo cieco');
    assert.equal(res.unreachable, 2);
  });

  test('editor: importare ed esportare un livello non cambia celle, oggetti e bandiere', () => {
    for (const entry of game.levels) {
      const level = json(entry.file);
      const a = new EditorMap({ tilesetDefs: assets.tilesets, teams: Object.keys(game.teams) });
      const { warnings } = a.fromLevel(level);
      assert.deepEqual(warnings, [], `${entry.id}: avvisi dell'editor`);
      const out = a.toLevel(game.editor?.legendChars);
      const b = new EditorMap({ tilesetDefs: assets.tilesets, teams: Object.keys(game.teams) });
      b.fromLevel(out);
      assert.equal(b.cols, a.cols);
      assert.equal(b.rows, a.rows);
      let diff = 0;
      for (let i = 0; i < a.tiles.length; i++) {
        if (a.brushes[a.tiles[i]].key !== b.brushes[b.tiles[i]].key || objectKey(a.objects.get(i)) !== objectKey(b.objects.get(i))) diff++;
      }
      assert.equal(diff, 0, `${entry.id}: ${diff} celle diverse dopo import/export`);
      assert.deepEqual(Object.keys(out.flags).sort(), Object.keys(level.flags).sort(), `${entry.id}: bandiere`);
      for (const [id, f] of Object.entries(level.flags)) assert.deepEqual(out.flags[id], { owner: null, ...f }, `${entry.id}: bandiera ${id}`);
    }
  });
});
