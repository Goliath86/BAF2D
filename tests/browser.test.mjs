// Test nel browser (Chrome headless via CDP): il gioco vero, con le partite fatte avanzare a passi fissi
// (window.T, vedi lib/helpers.mjs) e Math.random a seme fisso. Saltati se Chrome non c'è (CHROME_PATH).
// Screenshot in tests/output/ (ignorata da git) da guardare quando un test fallisce.
// Uso: node --test tests/        (solo questi: node --test tests/browser.test.mjs)

import { describe, it, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, findChrome, launch } from './lib/browser.mjs';
import { PAGE_HELPERS } from './lib/helpers.mjs';

const game = JSON.parse(fs.readFileSync(path.join(ROOT, 'config/game.json'), 'utf8'));
const OUT = path.join(ROOT, 'tests', 'output');
const chrome = findChrome();

describe('gioco nel browser', { skip: chrome ? false : 'Chrome non trovato (impostare CHROME_PATH)', timeout: 600000 }, () => {
  let ctx;
  let page;
  const ev = (expr) => page.eval(expr);
  const T = (expr) => page.eval(`T.${expr}`);
  const shot = (name) => (async () => {
    await T('render()');
    await page.screenshot(path.join(OUT, `${name}.png`));
  })();

  /** Apre il gioco (menu principale pronto) e inietta gli helper. */
  async function openGame(query = 'lang=en') {
    await page.open(`${ctx.base}/index.html?${query}`, `window.BAF2D_MENU && window.BAF2D_MENU.mode === 'menu'`);
    await ev(PAGE_HELPERS);
  }

  /** Coordinate CSS (per il mouse) del punto del mondo (x, y), con la camera attuale. */
  const screenOf = (x, y) => ev(`(() => { const g = BAF2D, c = g.display.canvas.getBoundingClientRect(), k = g.display.cssPerPixel;
    return { x: c.left + (${x} - Math.round(g.camera.x)) * k, y: c.top + (${y} - Math.round(g.camera.y)) * k }; })()`);

  async function aimAt(x, y) {
    const s = await screenOf(x, y);
    await page.mouse('mouseMoved', s.x, s.y);
    return s;
  }

  async function assertSane(label) {
    const bad = await T('sanity()');
    assert.deepEqual(bad, [], `${label}: stati impossibili`);
  }

  before(async () => {
    fs.mkdirSync(OUT, { recursive: true });
    ctx = await launch({ seed: 20261112 });
    page = ctx.page;
  });

  after(async () => {
    await ctx?.close();
  });

  // nessun errore (eccezioni, console.error, risorse mancanti) durante ogni test
  afterEach(() => {
    if (!page) return;
    const errors = page.takeErrors();
    assert.deepEqual(errors, [], 'errori nella pagina');
  });

  it('si avvia nel menu principale con la versione giusta', async () => {
    await openGame();
    const text = await ev('document.body.innerText');
    assert.ok(text.includes(game.version), `versione ${game.version} non visibile nel menu`);
    // la scena o la partita dimostrativa dietro al menu gira per un po' senza errori
    await new Promise((r) => setTimeout(r, 1500));
    await page.screenshot(path.join(OUT, 'menu.png'));
  });

  for (const lvl of game.levels) {
    it(`${lvl.id}: 90 s di partita con 7 bot senza stati impossibili`, async () => {
      await openGame();
      const s0 = await T(`start('${lvl.id}', { allies: 3, enemies: 4 })`);
      assert.equal(s0.bots, 7);
      await T('autopilot()'); // anche il giocatore gioca (la sua squadra lo segue)
      const start = await ev('BAF2D.bots.map((b) => [b.unit.x, b.unit.y])');
      await T('step(10)');
      await assertSane('dopo 10 s');
      // i bot si muovono
      const moved = await ev(`BAF2D.bots.map((b, i) => Math.hypot(b.unit.x - ${JSON.stringify(start)}[i][0], b.unit.y - ${JSON.stringify(start)}[i][1]))`);
      const avg = moved.reduce((a, b) => a + b, 0) / moved.length;
      assert.ok(avg > 40, `i bot si sono mossi in media solo di ${avg.toFixed(1)} px in 10 s`);
      for (let t = 20; t <= 90; t += 10) {
        await T('step(10)');
        await assertSane(`dopo ${t} s`);
      }
      const s = await T('state()');
      await shot(`match-${lvl.id}`);
      const flagsChanged = s.owners.some((o, i) => o !== s0.owners[i]);
      assert.ok(flagsChanged, `nessuna bandiera ha cambiato padrone in 90 s (${JSON.stringify(s0.owners)})`);
      assert.ok(s.kills > 0, 'nessuna uccisione in 90 s');
      assert.ok(Object.entries(s.tickets).some(([t, n]) => n < s0.tickets[t]), 'i ticket non sono scesi');
    });
  }

  it('una partita arriva alla fine, mostra la classifica e la rivincita riparte', async () => {
    await openGame();
    const s0 = await T(`start('arena', { allies: 3, enemies: 4, tickets: 40 })`);
    await T('autopilot()');
    const end = await T('step(900, (g) => g.ended)');
    const s = await T('state()');
    assert.ok(s.ended, `partita non finita dopo ${end.toFixed(0)} s (ticket ${JSON.stringify(s.tickets)})`);
    assert.ok(['victory', 'defeat', 'draw'].includes(s.ended));
    await assertSane('a fine partita');
    // dopo matchEnd.delay compare la schermata di fine partita con la classifica
    await T(`step(${(game.matchEnd.delay ?? 2) + (game.matchEnd.restartDelay ?? 0.8) + 0.2})`);
    const overlay = await ev(`!document.getElementById('overlay-matchend').classList.contains('hidden')`);
    assert.ok(overlay, 'schermata di fine partita non visibile');
    assert.ok(await ev(`document.body.classList.contains('match-${s.ended}')`), 'classe di fine partita mancante');
    await page.screenshot(path.join(OUT, 'match-end.png'));
    const rows = await ev(`document.querySelectorAll('#overlay-matchend .score-row:not(.score-head)').length`);
    assert.equal(rows, 8, 'righe della classifica (giocatore + 7 bot)');
    // rivincita
    await T('autopilot(false)');
    await ev(`document.querySelector('#overlay-matchend [data-action="rematch"]').click()`);
    await T('step(0.1)');
    const r = await T('state()');
    assert.equal(r.ended, null, 'la rivincita non è partita');
    assert.deepEqual(r.tickets, s0.tickets, 'ticket non ripristinati');
    assert.deepEqual(r.owners, s0.owners, 'bandiere non ripristinate');
  });

  it('luce dei soldati: ombra dal lato delle ombre dei muri, luce sul bordo dal lato opposto', async () => {
    await openGame();
    await T(`start('arena', { allies: 0, enemies: 0 })`);
    await T('step(0.2)');
    // luminosità attorno al giocatore con e senza luce: più scuro verso l'ombra, più chiaro verso la luce
    const r = await ev(`(() => {
      const g = BAF2D, L = g.lighting, sh = L.shadowOf(g.map);
      const grab = () => {
        g.render();
        const px = Math.round(g.player.x) - Math.round(g.camera.x), py = Math.round(g.player.y) - Math.round(g.camera.y);
        return { px, py, d: g.display.ctx.getImageData(px - 16, py - 16, 32, 32).data };
      };
      L.enabled = false; const off = grab();
      L.enabled = true; const on = grab();
      let darker = 0, brighter = 0;
      for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) {
        const i = (y * 32 + x) * 4;
        const dl = (on.d[i] + on.d[i + 1] + on.d[i + 2]) - (off.d[i] + off.d[i + 1] + off.d[i + 2]);
        const side = (x - 16) * sh.ux + (y - 16) * sh.uy; // > 0 = verso l'ombra
        if (dl < -20 && side > 0) darker++;
        if (dl > 20 && side < 0) brighter++;
      }
      return { darker, brighter, sh };
    })()`);
    assert.ok(r.sh.dx > 0 || r.sh.dy > 0, `ombra senza direzione: ${JSON.stringify(r.sh)}`);
    assert.ok(r.darker >= 8, `ombra portata quasi assente (${r.darker} pixel più scuri dal lato dell'ombra)`);
    assert.ok(r.brighter >= 4, `luce sul bordo quasi assente (${r.brighter} pixel più chiari dal lato della luce)`);
    await shot('lighting-arena');
  });

  it('muri con altezza: faccia sud più scura della cima, terreno scurito alla base', async () => {
    await openGame();
    await T(`start('arena', { allies: 0, enemies: 0 })`);
    const r = await ev(`(() => {
      const m = BAF2D.map, s = m.size;
      // un muro con terreno libero sotto, lontano dal bordo
      let cell = null;
      for (let y = 2; y < m.rows - 2 && !cell; y++) for (let x = 2; x < m.cols - 2; x++) {
        if (m._heightAt(x, y) > 0 && !m.blocksShotTile(x, y + 1) && !m.blocksShotTile(x, y - 1)) { cell = { x, y }; break; }
      }
      const lum = (x, y, w, h) => {
        const d = m.canvas.getContext('2d').getImageData(x, y, w, h).data;
        let t = 0; for (let i = 0; i < d.length; i += 4) t += d[i] + d[i + 1] + d[i + 2];
        return t / (d.length / 4);
      };
      const sample = () => ({
        face: lum(cell.x * s, cell.y * s + s - 4, s, 3),
        ground: lum(cell.x * s, (cell.y + 1) * s + 1, s, 2),
      });
      const keep = m.tileset.height;
      m.tileset.height = null; m._renderRegion(cell.x - 1, cell.y - 1, cell.x + 1, cell.y + 1);
      const flat = sample();
      m.tileset.height = keep; m._renderRegion(cell.x - 1, cell.y - 1, cell.x + 1, cell.y + 1);
      const tall = sample();
      return { cell, flat, tall, h: m._heightAt(cell.x, cell.y) };
    })()`);
    assert.ok(r.cell, 'nessun muro con terreno libero sotto');
    assert.ok(r.h > 0, 'muro senza altezza');
    assert.ok(r.tall.face < r.flat.face * 0.85, `faccia non più scura: ${JSON.stringify(r)}`);
    assert.ok(r.tall.ground < r.flat.ground, `niente occlusione alla base: ${JSON.stringify(r)}`);
  });

  it('animazioni del soldato: rinculo, colpito, lancio, caduta lontano dal colpo, pose dei caduti', async () => {
    await openGame();
    await T(`start('arena', { allies: 0, enemies: 0 })`);
    await T('step(0.2)');
    const r = await ev(`(() => {
      const g = BAF2D, p = g.player, out = {};
      // rinculo: dopo lo sparo il busto disegnato arretra lungo la mira
      p.angle = 0; p.fx.kick = p.cfg.animation.kickTime;
      const body = p.drawParts().at(-1);
      out.kick = body[3];
      p.fx.kick = 0;
      // colpito da destra: lampo e sobbalzo verso sinistra
      p.damage(1, { x: p.x + 50, y: p.y });
      out.flash = p.fx.flash; out.joltX = p.fx.joltX;
      // lancio: il busto ruota e torna
      p.fx.throwT = p.cfg.animation.throwTime / 2;
      out.twist = p.drawParts().at(-1)[2] - p.angle;
      p.fx.throwT = 0;
      // morte con il colpo da sotto: la testa del caduto (sinistra dello sprite) va lontano dal colpo = in alto
      p.damage(999, { x: p.x, y: p.y + 60 });
      out.deathAngle = p.deathAngle;
      return out;
    })()`);
    assert.ok(r.kick < 0, `rinculo assente (dx del busto = ${r.kick})`);
    assert.ok(r.flash > 0 && r.joltX < 0, `lampo/sobbalzo sbagliati: ${JSON.stringify(r)}`);
    assert.ok(Math.abs(r.twist) > 0.3, `torsione del lancio assente (${r.twist})`);
    // angolo verso la sorgente (in basso, +PI/2): la testa (angolo + PI) va in alto
    assert.ok(Math.abs(r.deathAngle - Math.PI / 2) < 0.01, `caduta non lontana dal colpo (${r.deathAngle})`);
    await T('step(0.1)');
    const c = await ev(`(() => { const c = BAF2D.corpses.at(-1), s = c.body.sprite; return { pose: c.body.pose, n: s.frameCount / s.variants, variants: s.variants, pool: c.pool.first, pn: c.pool.sprite.frameCount / c.pool.sprite.variants }; })()`);
    assert.ok(c.variants > 1, 'una sola posa dei caduti');
    assert.equal(c.pose % c.n, 0, 'la posa deve partire dal primo frame della caduta');
    assert.equal(c.pool % c.pn, 0, 'la pozza deve partire dal primo frame della sua forma');
    await T('step(1)');
    await shot('corpse');
  });

  it('giocatore: sparo col mouse, ricarica con R che consuma la scorta', async () => {
    await openGame();
    await T(`start('arena', { allies: 0, enemies: 0 })`);
    await T('step(0.2)');
    const p0 = await ev('({ x: BAF2D.player.x, y: BAF2D.player.y, ammo: BAF2D.player.ammo, reserve: BAF2D.player.reserve[BAF2D.player.weapon.id], weapon: BAF2D.player.weapon.id })');
    const w = { ...(await ev(`BAF2D.weapons.get('${p0.weapon}')`)) };
    const s = await aimAt(p0.x, p0.y - 60);
    await page.mouse('mousePressed', s.x, s.y);
    await T('step(0.5)');
    await page.mouse('mouseReleased', s.x, s.y);
    await T('step(0.3)');
    const p1 = await ev('({ ammo: BAF2D.player.ammo, angle: BAF2D.player.angle })');
    const fired = p0.ammo - p1.ammo;
    assert.ok(fired >= 2, `colpi sparati: ${fired}`);
    assert.ok(Math.abs(p1.angle + Math.PI / 2) < 0.2, `il giocatore non mira verso il mouse (angolo ${p1.angle.toFixed(2)})`);
    await page.key('KeyR');
    await T(`step(${w.reloadTime + 0.2})`);
    const p2 = await ev('({ ammo: BAF2D.player.ammo, reserve: BAF2D.player.reserve[BAF2D.player.weapon.id] })');
    assert.equal(p2.ammo, w.magazine, 'caricatore non pieno dopo la ricarica');
    assert.equal(p2.reserve, p0.reserve - fired, 'la ricarica non ha preso i colpi dalla scorta');
    await assertSane('dopo sparo e ricarica');
  });

  it('giocatore: a secco avvisa, poi si rifornisce da un\'arma uguale, da una cassa e alla base', async () => {
    await openGame();
    await T(`start('arena', { allies: 0, enemies: 0 })`);
    // lontano dalla base e dalle bandiere, a secco
    const r = await ev(`(() => { const g = BAF2D, p = g.player, id = p.weapon.id;
      const crate = g.pickups.list.find((i) => i.kind === 'ammo');
      p.x = crate.x - 40; p.y = crate.y; p.ammo = 0; p.reserve[id] = 0; p.grenades = 0;
      T.step(0.1);
      return { prompt: g._reloadPrompt(), out: p.outOfAmmo, inRes: g.inResupply(p), noAmmo: g.i18n.t('hud.noAmmo') }; })()`);
    assert.equal(r.out, true);
    assert.equal(r.inRes, false, 'il punto di prova è in una zona di rifornimento');
    assert.equal(r.prompt, r.noAmmo, 'manca l\'avviso "munizioni finite"');
    // arma uguale a terra: si prendono i colpi passandoci sopra
    const sc = await ev(`(() => { const g = BAF2D, p = g.player, id = p.weapon.id;
      g.pickups.dropWeapon(id, 5, p.x + 2, p.y, 0, 10); T.step(0.2);
      return { reserve: p.reserve[id], left: g.pickups.list.filter((i) => i.kind === 'weapon' && !i.spawner && i.weapon === id).length }; })()`);
    assert.equal(sc.reserve, 15, 'colpi presi dall\'arma a terra');
    assert.equal(sc.left, 0, 'l\'arma svuotata deve sparire');
    // cassa di munizioni: un uso riempie la scorta e dà una granata
    const def = game.pickups.types.ammo;
    const cr = await ev(`(() => { const g = BAF2D, p = g.player, id = p.weapon.id;
      const crate = g.pickups.list.find((i) => i.kind === 'ammo'); p.x = crate.x; p.y = crate.y; T.step(0.5);
      return { reserve: p.reserve[id], grenades: p.grenades, uses: crate.count, max: g.weapons.get(id).reserve }; })()`);
    assert.equal(cr.reserve, cr.max, 'la cassa non ha riempito la scorta');
    assert.equal(cr.grenades, def.grenades ?? 0, 'granate dalla cassa');
    assert.equal(cr.uses, (def.uses ?? 4) - 1, 'la cassa deve perdere un solo uso');
    // base: rifornimento periodico
    const interval = game.ammo.interval ?? 2.5;
    const b = await ev(`(() => { const g = BAF2D, p = g.player, id = p.weapon.id, base = g.ctf.bases[p.team];
      p.x = base.x; p.y = base.y; p.reserve[id] = 0; T.step(${interval + 0.1});
      return { reserve: p.reserve[id], inRes: g.inResupply(p), resupply: g.weapons.get(id).resupply ?? g.weapons.get(id).magazine }; })()`);
    assert.equal(b.inRes, true);
    assert.equal(b.reserve, b.resupply, 'rifornimento alla base');
    await assertSane('dopo i rifornimenti');
  });

  it('giocatore: la granata lanciata col tasto G ferisce un nemico vicino al mirino', async () => {
    await openGame();
    await T(`start('arena', { allies: 0, enemies: 1 })`);
    const target = await ev(`(() => { const g = BAF2D, p = g.player, slot = g.bots[0], u = slot.unit; T.freeze(slot);
      for (const [dx, dy] of [[0, -56], [56, 0], [0, 56], [-56, 0]]) {
        if (!g.map.isSolidAt(p.x + dx, p.y + dy) && g._lineOfSight(p.x, p.y, p.x + dx, p.y + dy)) { u.x = p.x + dx; u.y = p.y + dy; break; }
      }
      T.step(0.1);
      return { x: u.x, y: u.y, health: u.health, grenades: p.grenades }; })()`);
    await aimAt(target.x, target.y);
    await T('step(0.1)');
    await page.key('KeyG');
    await T('step(4)');
    const after = await ev('({ health: BAF2D.bots[0].unit.health, dead: BAF2D.bots[0].unit.dead, grenades: BAF2D.player.grenades, playerHealth: BAF2D.player.health })');
    assert.equal(after.grenades, target.grenades - 1, 'granata non lanciata');
    assert.ok(after.dead || after.health < target.health, 'il nemico non è stato ferito dall\'esplosione');
    await assertSane('dopo l\'esplosione');
  });

  it('giocatore: alla morte si apre la schermata di rientro e si rientra dove si sceglie', async () => {
    await openGame();
    await T(`start('crossroads', { allies: 2, enemies: 0 })`);
    await T('step(0.5)');
    await ev('BAF2D.player.damage(10000)');
    await T('step(0.2)');
    assert.ok(await ev('!!BAF2D.respawn && BAF2D_MENU.deploy.visible'), 'schermata di rientro non aperta');
    await shot('deploy');
    const opts = await ev('BAF2D.deployOptions().map((o) => o.id)');
    assert.ok(opts.length >= 1, 'nessun punto di rientro');
    await ev(`BAF2D.chooseDeploy(${JSON.stringify(opts[0])}, true)`);
    await T(`step(${(game.death.respawnDelay ?? 3) + 0.5})`);
    const r = await ev('({ dead: BAF2D.player.dead, deploy: BAF2D_MENU.deploy.visible, respawn: !!BAF2D.respawn })');
    assert.deepEqual(r, { dead: false, deploy: false, respawn: false }, 'rientro non avvenuto');
    await assertSane('dopo il rientro');
  });

  it('mezzi: si sale con E, si guida con W, si scende con E', async () => {
    await openGame();
    await T(`start('desert', { allies: 0, enemies: 0 })`);
    const v0 = await ev(`(() => { const g = BAF2D, p = g.player;
      const v = g.vehicles.find((v) => !v.def.flying && v.team === p.team && !v.driver);
      for (const [dx, dy] of [[0, -16], [0, 16], [-16, 0], [16, 0], [0, -22], [0, 22]]) {
        if (!g.map.isSolidAt(v.x + dx, v.y + dy)) { p.x = v.x + dx; p.y = v.y + dy; break; }
      }
      T.step(0.1);
      return { i: g.vehicles.indexOf(v), x: v.x, y: v.y, offer: g.vehicleOffer === v }; })()`);
    assert.ok(v0.offer, 'il mezzo vicino non viene offerto');
    await page.key('KeyE');
    await T('step(0.2)');
    assert.ok(await ev(`BAF2D.player.vehicle === BAF2D.vehicles[${v0.i}]`), 'non si è saliti sul mezzo');
    await page.key('KeyW', 'down');
    await T('step(1.5)');
    await page.key('KeyW', 'up');
    await T('step(0.5)');
    const moved = await ev(`Math.hypot(BAF2D.vehicles[${v0.i}].x - ${v0.x}, BAF2D.vehicles[${v0.i}].y - ${v0.y})`);
    assert.ok(moved > 30, `il mezzo si è mosso di ${moved.toFixed(1)} px`);
    await page.key('KeyE');
    await T('step(0.5)');
    assert.ok(await ev('!BAF2D.player.vehicle'), 'non si è scesi dal mezzo');
    await assertSane('dopo la guida');
  });

  it('pausa con Esc e ripresa', async () => {
    await openGame();
    await T(`start('arena', { allies: 1, enemies: 1 })`);
    await T('step(1)');
    await page.key('Escape');
    assert.equal(await ev('BAF2D_MENU.mode'), 'paused');
    const t = await ev('BAF2D.time');
    await new Promise((r) => setTimeout(r, 300));
    assert.equal(await ev('BAF2D.time'), t, 'il gioco avanza in pausa');
    await ev('BAF2D_MENU.resume()');
    assert.equal(await ev('BAF2D_MENU.mode'), 'playing');
    await ev('BAF2D.suspended = true');
  });

  for (const lang of game.i18n.available || ['en']) {
    it(`lingua "${lang}": nessun testo mancante in menu, partita e fine partita`, async () => {
      page.warnings = [];
      await openGame(`lang=${lang}`);
      // tutte le schermate del menu
      const screens = await ev(`[...document.querySelectorAll('[data-screen]')].map((s) => s.dataset.screen)`);
      for (const s of screens) await ev(`(BAF2D_MENU._open('${s}'), true)`);
      await ev('BAF2D_MENU.showMain()');
      // partita breve con HUD disegnato, morte (schermata di rientro) e fine partita
      await T(`start('countryside', { allies: 3, enemies: 4, tickets: 15 })`);
      // a mano per 20 s (HUD del giocatore umano), poi morte e pilota automatico fino alla fine
      for (let i = 0; i < 4; i++) {
        await T('step(5)');
        await T('render()');
      }
      await ev('BAF2D.player.damage(10000)');
      await T('step(0.5)');
      await T('render()');
      await T('autopilot()');
      await T('step(900, (g) => g.ended)');
      assert.ok((await T('state()')).ended, 'partita non finita');
      await T('step(3.5)');
      await T('render()');
      await page.screenshot(path.join(OUT, `lang-${lang}.png`));
      const missing = await T('missingKeys()');
      assert.deepEqual(missing, [], 'chiavi di traduzione mancanti');
      const warn = page.warnings.filter((w) => /missing|unknown|not found|failed/i.test(w));
      assert.deepEqual(warn, [], 'avvisi in console');
    });
  }

  it('fusione dei terreni: a strisce come intera, cambia i bordi, il preriscaldamento riempie la cache', async () => {
    await openGame();
    for (const lvl of game.levels) {
      const r = await ev(`(async () => {
        const TM = BAF2D_MENU.game.map ? BAF2D_MENU.game.map.constructor : null;
        const level = JSON.parse(JSON.stringify(BAF2D_MENU.levels.find((l) => l.id === '${lvl.id}').data)); // copia: niente cache
        const ts = BAF2D.assets.tileset(level.tileset);
        const Map_ = TM || (await import('./js/engine/tilemap.js')).TileMap;
        const pixels = (m) => m.canvas.getContext('2d').getImageData(0, 0, m.pixelWidth, m.pixelHeight).data;
        const whole = new Map_(level, ts, { deferred: true });
        whole._renderRegion(0, 0, whole.cols - 1, whole.rows - 1);
        const strips = new Map_(level, ts, { deferred: true });
        // a blocchi come TileMap.prewarm (24x4 celle), più qualche blocco di forma diversa
        for (let y = 0; y < strips.rows; y += 4) for (let x = 0; x < strips.cols; x += 24) strips._renderRegion(x, y, Math.min(strips.cols - 1, x + 23), Math.min(strips.rows - 1, y + 3));
        for (const [x, y] of [[5, 7], [40, 20], [60, 33]]) strips._renderRegion(x, y, x + 2, y + 2);
        const plain = new Map_(level, ts, { blend: false });
        const a = pixels(whole), b = pixels(strips), c = pixels(plain);
        let seams = 0, blended = 0;
        for (let i = 0; i < a.length; i += 4) {
          if (a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2]) seams++;
          if (a[i] !== c[i] || a[i + 1] !== c[i + 1] || a[i + 2] !== c[i + 2]) blended++;
        }
        // preriscaldamento: alla fine la partita trova la mappa in cache (stesso canvas intatto)
        const fresh = JSON.parse(JSON.stringify(level));
        Map_.prewarm(fresh, ts);
        const t0 = performance.now();
        while (performance.now() - t0 < 8000) {
          await new Promise((r) => setTimeout(r, 50));
          const probe = new Map_(fresh, ts, { deferred: true });
          if (probe.pristine) return { seams, blended, terrains: !!ts.terrains, warmed: true, same: pixels(probe).every((v, i) => v === a[i]) };
        }
        return { seams, blended, terrains: !!ts.terrains, warmed: false };
      })()`);
      assert.equal(r.seams, 0, `${lvl.id}: pixel diversi disegnando a strisce (cuciture)`);
      if (r.terrains) {
        assert.ok(r.blended > 1000, `${lvl.id}: la fusione ha cambiato solo ${r.blended} pixel`);
        assert.ok(r.warmed, `${lvl.id}: il preriscaldamento non ha riempito la cache`);
        assert.ok(r.same, `${lvl.id}: la mappa preriscaldata è diversa da quella disegnata intera`);
      }
    }
  });

  it('editor: carica ogni livello del gioco senza errori né avvisi del controllo', async () => {
    await page.open(`${ctx.base}/editor.html?lang=en`, 'window.BAF2D_EDITOR');
    for (const lvl of game.levels) {
      const items = await ev(`(async () => { const e = BAF2D_EDITOR;
        const level = await (await fetch('${lvl.file}')).json();
        e._load(level); e._runCheck();
        return e.checkItems.map((i) => i.level + ': ' + i.text); })()`);
      assert.deepEqual(items, [], `${lvl.id}: problemi segnalati dal controllo dell'editor`);
    }
    await page.screenshot(path.join(OUT, 'editor.png'));
  });
});
