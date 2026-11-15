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
    assert.ok(await ev(`document.getElementById('overlay-loading').classList.contains('hidden')`), 'schermata di caricamento rimasta');
  });

  it('menu: anteprime "come in partita", briefing che copre la preparazione e poi fa partire il gioco', async () => {
    await openGame();
    const until = async (expr, ms = 20000) => {
      const t0 = Date.now();
      while (!(await ev(expr))) {
        if (Date.now() - t0 > ms) return false;
        await new Promise((r) => setTimeout(r, 100));
      }
      return true;
    };
    // le anteprime ricche arrivano una alla volta e cambiano i pixel della card
    const before = await ev(`document.querySelector('.map-card[data-level="desert"] canvas').toDataURL()`);
    assert.ok(await until(`document.querySelectorAll('.map-card.rich').length === ${game.levels.length}`), 'anteprime ricche non arrivate');
    const after = await ev(`document.querySelector('.map-card[data-level="desert"] canvas').toDataURL()`);
    assert.notEqual(before, after, "l'anteprima ricca non cambia la card");
    // "Inizia": il briefing si apre, la partita si prepara ferma, un tasto la fa partire
    await ev(`BAF2D_MENU._open('newGame'); BAF2D_MENU.choice.level = 'countryside'; BAF2D_MENU.choice.allies = 0; BAF2D_MENU.choice.enemies = 1;
      document.querySelector('[data-action="start"]').click()`);
    assert.ok(await ev(`!document.getElementById('overlay-briefing').classList.contains('hidden')`), 'briefing non visibile');
    assert.ok(await until('BAF2D_MENU.briefing?.ready === true', 10000), 'la partita non si prepara');
    assert.equal(await ev('BAF2D.suspended'), true, 'il gioco corre sotto al briefing');
    assert.ok((await ev(`document.getElementById('briefing-map').width`)) > 100, 'mappa del briefing non disegnata');
    await page.screenshot(path.join(OUT, 'briefing.png'));
    // senza tasti resta ad aspettare (non parte da sola dopo minTime)
    await new Promise((r) => setTimeout(r, ((game.menu.briefing?.minTime ?? 2.2) + 0.8) * 1000));
    assert.equal(await ev('BAF2D_MENU.briefing?.ready'), true, 'il briefing si è chiuso da solo senza un tasto');
    assert.equal(await ev('BAF2D.suspended'), true, 'la partita è partita senza un tasto');
    await page.key('Enter');
    assert.equal(await ev('BAF2D_MENU.briefing'), null, 'il briefing non si chiude con un tasto');
    assert.equal(await ev('BAF2D.suspended'), false, 'il gioco non riparte dopo il briefing');
    assert.equal(await ev('BAF2D_MENU.mode'), 'playing');
    assert.ok(await until(`document.getElementById('overlay-briefing').classList.contains('hidden')`, 3000), 'briefing rimasto a schermo');
    await ev('BAF2D.suspended = true');
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
      // bandiere: un cambio di padrone in una qualunque tappa (alla fine possono essere tornate com'erano,
      // es. la bandiera centrale presa e poi neutralizzata)
      await ev(`window._flagsChanged = false; window._owners0 = ${JSON.stringify(s0.owners)}`);
      const watch = `(g) => { if (g.ctf.flags.some((f, i) => f.owner !== window._owners0[i])) window._flagsChanged = true; }`;
      for (let t = 20; t <= 90; t += 10) {
        await T(`step(10, ${watch})`);
        await assertSane(`dopo ${t} s`);
      }
      const flagsChanged = await ev('window._flagsChanged');
      const s = await T('state()');
      await shot(`match-${lvl.id}`);
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
    // illustrazione: la zona con più caduti, grande quanto la visuale, con le croci dei caduti
    const art = await ev(`(() => { const c = document.getElementById('matchend-art'), g = BAF2D;
      return { w: c.width, h: c.height, vw: g.display.width, vh: g.display.height, deaths: g.deathSpots.length,
        place: document.getElementById('matchend-place').textContent }; })()`);
    assert.ok(art.deaths > 0, 'nessun caduto registrato');
    assert.equal(art.w, art.vw, 'illustrazione larga quanto la visuale');
    assert.equal(art.h, art.vh, 'illustrazione alta quanto la visuale');
    assert.ok(art.place.length > 0, 'didascalia dell\'illustrazione vuota');
    // rivincita
    await T('autopilot(false)');
    await ev(`document.querySelector('#overlay-matchend [data-action="rematch"]').click()`);
    await T('step(0.1)');
    const r = await T('state()');
    assert.equal(r.ended, null, 'la rivincita non è partita');
    assert.deepEqual(r.tickets, s0.tickets, 'ticket non ripristinati');
    assert.deepEqual(r.owners, s0.owners, 'bandiere non ripristinate');
  });

  it('i bot sparano al giocatore solo da dentro la sua visuale, e per un po\' dopo esserne usciti', async () => {
    await openGame();
    await T(`start('arena', { allies: 0, enemies: 1 })`);
    await T('step(0.1)');
    const sf = game.bots.ai.screenFire;
    const graceMax = Array.isArray(sf.grace) ? sf.grace[1] : sf.grace;
    // la regola da sola
    const rule = await ev(`(() => { const g = BAF2D, p = g.player, cam = g.camera, W = g.display.width, H = g.display.height;
      const inside = { x: cam.x + W / 2, y: cam.y + H / 2 }, outside = { x: cam.x - 40, y: cam.y + H / 2 };
      const s = {}, other = {};
      const t0 = g.time;
      const r = { offStart: g.screenFire(s, outside, p, p, true), entering: g.screenFire(s, inside, p, p, true) };
      // dopo la reazione all'ingresso nella visuale (bots.difficulty -> screenReaction) spara
      g.time += (s.screenIn?.delay ?? 0) + 0.01;
      r.onScreen = g.screenFire(s, inside, p, p, true);
      r.offTail = g.screenFire(s, outside, p, p, true);
      r.otherTarget = g.screenFire(other, outside, g.bots[0].unit, g.bots[0].unit, true);
      r.delay = s.screenIn === null ? 'reset' : 'kept';
      g.time += ${graceMax} + 0.1;
      r.offAfter = g.screenFire(s, outside, p, p, true);
      g.time = t0;
      return r; })()`);
    assert.equal(rule.offStart, false, 'fuori dalla visuale spara al giocatore senza aver cominciato in vista');
    assert.equal(rule.entering, false, 'spara appena entrato nella visuale, senza tempo di reazione');
    assert.equal(rule.onScreen, true, 'in vista non spara');
    assert.equal(rule.delay, 'reset', 'uscito dalla visuale la reazione d\'ingresso non riparte');
    assert.equal(rule.offTail, true, 'appena uscito dalla visuale smette subito');
    assert.equal(rule.offAfter, false, 'fuori dalla visuale continua oltre la coda');
    assert.equal(rule.otherTarget, true, 'la regola blocca anche il fuoco contro i bot');

    // un bot vero: fuori visuale (ma lo vede) non spara; in vista sì; uscito, continua per la coda e poi smette
    const spot = await ev(`(() => { const g = BAF2D, p = g.player, cam = g.camera, W = g.display.width, H = g.display.height;
      const range = g.aiCfg.viewRange ?? 220, map = g.map, nav = g.nav;
      const off = (x, y) => x < cam.x - 6 || x > cam.x + W + 6 || y < cam.y - 6 || y > cam.y + H + 6;
      const on = (x, y) => x > cam.x + 20 && x < cam.x + W - 20 && y > cam.y + 20 && y < cam.y + H - 20;
      const free = (x, y) => !map.rectHitsSolid(x - 6, y - 6, 12, 12) && nav.los(p.x, p.y, x, y);
      let o = null, i = null;
      for (let d = 60; d <= range - 10 && (!o || !i); d += 6) for (let a = 0; a < 64; a++) {
        const x = p.x + Math.cos(a / 64 * Math.PI * 2) * d, y = p.y + Math.sin(a / 64 * Math.PI * 2) * d;
        if (!free(x, y)) continue;
        if (!o && off(x, y)) o = { x, y };
        if (!i && on(x, y) && d > 70) i = { x, y };
      }
      return { o, i }; })()`);
    assert.ok(spot.o && spot.i, `nessun punto adatto per il test: ${JSON.stringify(spot)}`);
    await ev(`(() => { const g = BAF2D; g._shots = 0; const fire = g.fire.bind(g);
      g.fire = (s) => { if (s === g.bots[0].unit) g._shots++; return fire(s); };
      g.player.damage = () => {}; })()`); // il giocatore non muore durante il test
    const place = (p) => ev(`(() => { const u = BAF2D.bots[0].unit; u.x = ${p.x}; u.y = ${p.y}; })()`);
    const shots = () => ev('BAF2D._shots');
    // fermo nel punto, caricatore sempre pieno e niente ricariche (nelle pause della raffica il bot ricarica:
    // una ricarica a metà prova non deve contare come "ha smesso di sparare")
    const stay = (p, s) => T(`step(${s}, () => { const u = BAF2D.bots[0].unit; u.x = ${p.x}; u.y = ${p.y};
      u.ammo = u.weapon.magazine; u.reload = null; })`);
    await place(spot.o);
    await stay(spot.o, 4);
    assert.equal(await ev('BAF2D.bots[0].brain.target === BAF2D.player'), true, 'il bot non vede il giocatore');
    assert.equal(await shots(), 0, 'il bot spara da fuori la visuale');
    await stay(spot.i, 3);
    const onShots = await shots();
    assert.ok(onShots > 0, 'il bot in vista non spara');
    // esce dalla visuale mentre spara: continua per un po'...
    await stay(spot.o, 0.8);
    assert.ok((await shots()) > onShots, 'appena uscito dalla visuale smette subito');
    // ...poi smette
    await stay(spot.o, graceMax + 0.5);
    const late = await shots();
    await stay(spot.o, 2);
    assert.equal(await shots(), late, 'fuori dalla visuale continua a sparare oltre la coda');
  });

  it('difficoltà: in un duello col giocatore fermo il bot "recluta" fa meno danni del "veterano"', async () => {
    await openGame();
    const ids = Object.keys(game.bots.difficulty.levels);
    const duel = async (id) => {
      await T(`start('arena', { team: 'blue', allies: 0, enemies: 1, difficulty: ${ids.indexOf(id)} })`);
      return ev(`(() => { const g = BAF2D, p = g.player, u = g.bots[0].unit, map = g.map, D = 110;
        if (g.difficultyId !== ${JSON.stringify(id)}) return { error: 'difficoltà ' + g.difficultyId };
        if (g.humanFoe(u) !== null) return { error: 'humanFoe vale anche per i bot' };
        // punto aperto con vista libera sul bot a D px
        let ok = false;
        for (let ty = 5; ty < map.rows - 5 && !ok; ty++) for (let tx = 5; tx < map.cols - 5 && !ok; tx++) {
          const x = tx * map.size + 8, y = ty * map.size + 8;
          let clear = true;
          for (let k = -8; k <= D + 8 && clear; k += 4) if (map.rectHitsSolid(x + k - 6, y - 6, 12, 12)) clear = false;
          if (clear) { p.x = x; p.y = y; u.x = x + D; u.y = y; ok = true; }
        }
        if (!ok) return { error: 'nessun punto aperto' };
        g._snapCamera();
        let taken = 0;
        const hurt = p.damage.bind(p);
        p.damage = (n, s) => { taken += n; return hurt(0, s); }; // conta i danni ma resta vivo
        T.step(8);
        return { taken }; })()`);
    };
    const easy = await duel('easy');
    const hard = await duel('hard');
    assert.ok(!easy.error && !hard.error, easy.error || hard.error);
    assert.ok(hard.taken > 0, 'il veterano non colpisce il giocatore');
    assert.ok(easy.taken < hard.taken * 0.6, `recluta ${easy.taken} danni, veterano ${hard.taken}`);
  });

  it('addestramento: dal menu, tutti gli esercizi in ordine (colpi, granate, razzo veri), medaglia e schermata finale', async () => {
    await openGame('lang=it');
    // dal pulsante del menu principale, attraverso il briefing
    await ev(`document.querySelector('[data-action="training"]').click()`);
    assert.ok(await ev(`!!BAF2D_MENU.briefing`), 'il briefing non si apre');
    for (let i = 0; i < 100 && !(await ev('BAF2D_MENU.briefing?.ready === true')); i++) await new Promise((r) => setTimeout(r, 100));
    await page.key('Enter');
    assert.equal(await ev(`BAF2D_MENU.mode`), 'playing');
    assert.ok(await ev(`!!BAF2D.training && BAF2D.bots.length === 0`), 'addestramento non avviato (o con dei bot)');
    await shot('training-start');
    const total = await ev(`(() => { const g = BAF2D; g.suspended = true;
      window.CTRL = {};
      g._humanControl = () => ({ move: CTRL.move || { x: 0, y: 0 }, sprint: !!CTRL.sprint,
        aim: (u) => (CTRL.aim ? Math.atan2(CTRL.aim.y - u.y, CTRL.aim.x - u.x) : u.angle),
        firing: !!CTRL.fire, reload: !!CTRL.reload, grenade: !!CTRL.grenade, switchWeapon: !!CTRL.switch, repeat: false, faceMove: false });
      g.input.mouse.seen = false; // gittata senza mouse: bordo schermo (colpi) e defaultRange (granate)
      window.ID = () => g.training.step?.id ?? 'end';
      window.RUN = (sec, fn) => { for (let i = 0; i < sec * 60; i++) { fn?.(); g.update(1 / 60); } return ID(); };
      window.NEXT = () => { const i = g.training.index; for (let k = 0; k < 600 && g.training.index === i && !g.ended; k++) g.update(1 / 60); return ID(); };
      window.WALK = (pt, sprint) => RUN(10, () => { const p = g.player, dx = pt.x - p.x, dy = pt.y - p.y, d = Math.hypot(dx, dy) || 1;
        CTRL.sprint = sprint; CTRL.move = d > 3 ? { x: dx / d, y: dy / d } : { x: 0, y: 0 }; });
      return g.training.steps.length; })()`);
    const step = (js) => ev(`(() => { const g = BAF2D, p = g.player, T = g.training, P = T.points; ${js} })()`);
    assert.equal(await step(`return ID();`), 'move');
    assert.equal(await step(`WALK(P['1'], false); CTRL.move = null; return NEXT();`), 'sprint', 'movimento');
    // arrivare camminando non basta: bisogna correre
    assert.equal(await step(`p.x = P['2'].x - 200; p.y = P['2'].y; WALK(P['2'], false); return ID() + ' ' + (Math.hypot(p.x - P['2'].x, p.y - P['2'].y) <= 6);`),
      'sprint true', 'la corsa passa camminando (o non arriva in fondo alla pista)');
    assert.equal(await step(`p.x = P['2'].x - 200; p.y = P['2'].y; WALK(P['2'], true); CTRL.move = null; CTRL.sprint = false; return NEXT();`), 'aim', 'corsa');
    assert.equal(await step(`p.x = P['3'].x; p.y = P['3'].y;
      for (const t of T.targets.filter((t) => t.group === 'a')) { CTRL.aim = { x: t.x, y: t.y - 6 }; RUN(3, () => { CTRL.fire = !t.down && p.ammo > 0; CTRL.reload = p.ammo === 0; }); }
      CTRL.fire = CTRL.reload = false; return NEXT();`), 'reload', 'tiro');
    assert.equal(await step(`CTRL.reload = true; RUN(0.1); CTRL.reload = false; return NEXT();`), 'grenade', 'ricarica');
    // le sagome al riparo: i proiettili non le abbattono, una granata sì
    assert.equal(await step(`const list = T.targets.filter((t) => t.group === 'g');
      CTRL.aim = { x: list[0].x, y: list[0].y - 6 }; p.x = list[0].x; p.y = list[0].y - 80; RUN(1.5, () => { CTRL.fire = p.ammo > 0; }); CTRL.fire = false;
      return list.filter((t) => t.down).length;`), 0, 'i proiettili abbattono le sagome al riparo');
    assert.equal(await step(`const list = T.targets.filter((t) => t.group === 'g'), range = g.grenadeTypes.get('frag').defaultRange ?? 90;
      for (let k = 0; k < 4 && list.some((t) => !t.down); k++) {
        const up = list.filter((t) => !t.down), mx = up.reduce((s, t) => s + t.x, 0) / up.length;
        p.x = mx; p.y = up[0].y - range; CTRL.aim = { x: mx, y: up[0].y };
        RUN(0.1, () => { CTRL.grenade = true; }); CTRL.grenade = false; RUN(3.5);
      }
      return NEXT();`), 'pickup', 'granate');
    assert.equal(await step(`p.x = P['L'].x; p.y = P['L'].y + 2; RUN(0.2); const it = g.pickups.nearestWeapon(p); if (it) g._swapWeapon(p, it); return NEXT();`), 'rocket', 'raccolta');
    // il carro: i proiettili non lo scalfiscono, un razzo sì
    assert.equal(await step(`const t = T.targets.find((t) => t.group === 'r'); T.damage(t, 50, 'bullet', p, g); return t.hp;`), 100, 'i proiettili danneggiano il carro');
    assert.equal(await step(`const t = T.targets.find((t) => t.group === 'r'); CTRL.aim = { x: t.x, y: t.y - 5 };
      RUN(0.6); CTRL.fire = true; RUN(0.05); CTRL.fire = false; RUN(2); return NEXT();`), 'switch', 'razzo');
    assert.equal(await step(`CTRL.switch = true; RUN(0.05); CTRL.switch = false; return NEXT();`), 'flag', 'cambio arma');
    assert.equal(await step(`const f = g.ctf.flags[0]; p.x = f.x; p.y = f.y + 10; RUN(7); return NEXT();`), 'board', 'bandiera');
    assert.equal(await step(`const v = g.vehicles[0]; p.x = v.x + 12; p.y = v.y; RUN(0.1); g._enterVehicle(p, v); return NEXT();`), 'drive', 'salita');
    // sceso prima del punto: si torna a "sali sul mezzo"
    assert.equal(await step(`g._exitVehicle(p); RUN(0.1); return ID();`), 'board', 'scendere durante la guida non torna indietro');
    assert.equal(await step(`g._enterVehicle(p, g.vehicles[0]); NEXT(); const v = p.vehicle; v.x = P['5'].x; v.y = P['5'].y; RUN(0.2); return NEXT();`), 'exit', 'guida');
    assert.equal(await step(`g._exitVehicle(p); return NEXT();`), 'final', 'discesa');
    await shot('training-final');
    // tempo scaduto: la prova riparte con le sagome rialzate
    assert.equal(await step(`const f = T.targets.filter((t) => t.group === 'f'); T.damage(f[0], 999, 'bullet', p, g);
      T.timeLeft = 0.05; RUN(0.2); const st = T.state; RUN(3); return st + ' ' + f.filter((t) => t.down).length + ' ' + ID();`), 'failed 0 final');
    assert.equal(await step(`for (const t of T.targets.filter((t) => t.group === 'f')) T.damage(t, 999, 'bullet', p, g); RUN(4);
      return JSON.stringify({ ended: g.ended?.outcome, medals: g.matchMedals });`), JSON.stringify({ ended: 'training', medals: [game.training ? 'basicTraining' : ''] }));
    assert.equal(total, 13);
    assert.equal(await ev(`BAF2D_MENU.mode`), 'ended');
    assert.ok(await ev(`!document.getElementById('overlay-matchend').classList.contains('hidden')`), 'schermata finale non visibile');
    assert.equal(await ev(`getComputedStyle(document.getElementById('scoreboard')).display`), 'none', 'classifica visibile nell\'addestramento');
    await page.screenshot(path.join(OUT, 'training-end.png'));
    // ripeti: si ricomincia dal primo esercizio, la medaglia non dà altri punti
    const xp = await ev('BAF2D.career.xp');
    assert.equal(await ev(`(() => { BAF2D.ended.time = 99; BAF2D.restart(); return BAF2D.training.step.id + ' ' + BAF2D.training.index; })()`), 'move 0');
    assert.equal(await ev(`(() => { const g = BAF2D; g.suspended = true; g.training.index = g.training.steps.length - 1; g.training._enter(g);
      for (const t of g.training.targets.filter((t) => t.group === 'f')) g.training.damage(t, 999, 'bullet', g.player, g);
      for (let i = 0; i < 240; i++) g.update(1 / 60); return g.career.xp; })()`), xp, 'la medaglia dell\'addestramento dà punti anche la seconda volta');
    assert.deepEqual(await T('sanity()'), []);
  });

  it('touch su telefono: i pulsanti non finiscono sotto la minimappa, fuori schermo o uno sopra l\'altro', async () => {
    const sizes = [[844, 390], [740, 360], [926, 428], [667, 375]];
    try {
      for (const [w, h] of sizes) {
        await page.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 3, mobile: true });
        await openGame();
        const bad = await ev(`(() => { BAF2D_MENU.input._setMode('touch'); T.start('crossroads', { allies: 3, enemies: 3 });
          const g = BAF2D, s = g.input.sticks, u = g.display.cssPerPixel;
          const r = g.hud._miniRect(Math.floor(g.display.cssWidth / u), g.map);
          // minimappa con cornice (2 px) e la riga dell'ordine di squadra sotto (12 px di gioco)
          const mini = { x: (r.x - 2) * u, y: (r.y - 2) * u, w: (r.w + 4) * u, h: (r.h + 4 + 12) * u };
          const bad = [];
          const list = s.buttons.filter((b) => !b.debugOnly).map((b) => ({ b, c: s.buttonGeometry(b) }));
          for (const { b, c } of list) {
            const nx = Math.max(mini.x, Math.min(c.x, mini.x + mini.w)), ny = Math.max(mini.y, Math.min(c.y, mini.y + mini.h));
            if (Math.hypot(c.x - nx, c.y - ny) < c.r) bad.push(b.action + ' sotto la minimappa');
            if (c.x - c.r < 0 || c.y - c.r < 0 || c.x + c.r > innerWidth || c.y + c.r > innerHeight) bad.push(b.action + ' fuori schermo');
            if (c.y - c.r < g.hud.topHeight(g.display) && c.x > innerWidth / 3 && c.x < innerWidth * 2 / 3) bad.push(b.action + ' sotto i ticket');
          }
          for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
            const a = list[i].c, b = list[j].c;
            if (Math.hypot(a.x - b.x, a.y - b.y) < a.r + b.r) bad.push(list[i].b.action + ' sopra ' + list[j].b.action);
          }
          return bad; })()`);
        assert.deepEqual(bad, [], `schermo ${w}x${h}`);
      }
    } finally {
      await page.send('Emulation.clearDeviceMetricsOverride');
    }
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

  it('luci: notte più buia del giorno, lampi delle esplosioni, fuochi che si spengono', async () => {
    await openGame();
    const lum = `(() => { const g = BAF2D; g.render(); const d = g.display.ctx.getImageData(0, 0, g.display.width, g.display.height).data;
      let t = 0; for (let i = 0; i < d.length; i += 16) t += d[i] + d[i + 1] + d[i + 2]; return t / (d.length / 16); })()`;
    await T(`start('countryside', { allies: 0, enemies: 0, timeOfDay: 0 })`);
    await T('step(0.2)');
    const day = await ev(lum);
    await T(`start('countryside', { allies: 0, enemies: 0, timeOfDay: 2 })`);
    await T('step(0.2)');
    const night = await ev(lum);
    assert.equal(await ev('BAF2D.lights.time'), 'night');
    assert.ok(night < day * 0.6, `la notte non è abbastanza buia (giorno ${day.toFixed(0)}, notte ${night.toFixed(0)})`);
    // esplosione di un mezzo: lampo che rischiara e fuochi che restano accesi, poi si spengono
    const r = await ev(`(() => { const g = BAF2D, p = g.player;
      g.effects.explosion('vehicle', p.x + 30, p.y, g.map);
      return { flashes: g.lights.flashes.length, fires: g.effects.fires.length }; })()`);
    assert.ok(r.flashes > 0, 'nessun lampo di luce');
    assert.ok(r.fires > 0, "nessun fuoco dopo l'esplosione di un mezzo");
    await T('step(0.1)');
    const lit = await ev(lum);
    assert.ok(lit > night, `il lampo non rischiara la scena (${night.toFixed(0)} -> ${lit.toFixed(0)})`);
    await shot('lights-night');
    await T('step(15)');
    assert.equal(await ev('BAF2D.effects.fires.length'), 0, 'i fuochi non si spengono');
    assert.equal(await ev('BAF2D.lights.flashes.length'), 0, 'lampi rimasti accesi');
  });

  it('atmosfera: correzione di colore per mappa, vignettatura, grana, pioggia, nebbia, ciclo giorno -> notte', async () => {
    await openGame();
    const W = game.menu.weathers;
    const times = [...Object.keys(game.lights.times), ...Object.keys(game.lights.cycles)];
    // luminosità media di un rettangolo del canvas di gioco (frazioni della visuale)
    const lum = (x0, y0, x1, y1) => ev(`(() => { const g = BAF2D; g.render(); const c = g.display;
      const x = Math.floor(${x0} * c.width), y = Math.floor(${y0} * c.height), w = Math.max(1, Math.floor((${x1} - ${x0}) * c.width)), h = Math.max(1, Math.floor((${y1} - ${y0}) * c.height));
      const d = c.ctx.getImageData(x, y, w, h).data; let t = 0; for (let i = 0; i < d.length; i += 4) t += d[i] + d[i + 1] + d[i + 2]; return t / (d.length / 4); })()`);

    // correzione di colore: ogni mappa ha la sua; senza, la scena cambia
    await T(`start('countryside', { allies: 0, enemies: 0, weather: ${W.indexOf('clear')}, timeOfDay: 0 })`);
    await T('step(0.2)');
    assert.equal(await ev('BAF2D.weather.active'), false, 'sereno: niente meteo');
    assert.ok((await ev('BAF2D.atmosphere.grade.length')) > 0, 'campagna senza correzione di colore');
    const graded = await ev(`(() => { const g = BAF2D; g.render(); return Array.from(g.display.ctx.getImageData(40, 40, 8, 8).data).join(); })()`);
    const plain = await ev(`(() => { const g = BAF2D, a = g.atmosphere, keep = a.grade; a.grade = []; g.render();
      const d = Array.from(g.display.ctx.getImageData(40, 40, 8, 8).data).join(); a.grade = keep; return d; })()`);
    assert.notEqual(graded, plain, 'la correzione di colore non cambia la scena');

    // vignettatura: gli angoli più scuri che senza
    const corner = await lum(0, 0, 0.06, 0.08);
    const noVig = await ev(`(() => { const a = BAF2D.atmosphere, v = a.cfg.vignette; a.cfg.vignette = null; return v; })()`);
    const cornerOff = await lum(0, 0, 0.06, 0.08);
    await ev(`BAF2D.atmosphere.cfg.vignette = ${JSON.stringify(noVig)}`);
    assert.ok(corner < cornerOff * 0.95, `vignettatura assente (angolo ${corner.toFixed(0)} contro ${cornerOff.toFixed(0)})`);

    // grana (opzione): cambia i pixel
    await ev('BAF2D.setGrain(true)');
    const grained = await ev(`(() => { const g = BAF2D; g.render(); return Array.from(g.display.ctx.getImageData(100, 60, 32, 32).data).join(); })()`);
    await ev('BAF2D.setGrain(false)');
    const clean = await ev(`(() => { const g = BAF2D; g.render(); return Array.from(g.display.ctx.getImageData(100, 60, 32, 32).data).join(); })()`);
    assert.notEqual(grained, clean, 'la grana non si vede');

    // pioggia: gocce, spruzzi, pozzanghere mai sui tile solidi, scena più scura e meno satura
    await T(`start('countryside', { allies: 0, enemies: 0, weather: ${W.indexOf('rain')}, timeOfDay: 0 })`);
    await T('step(1)');
    const rain = await ev(`(() => { const g = BAF2D, w = g.weather, m = g.map; let onSolid = 0, px = 0;
      for (const p of w.puddles) for (let j = 0; j < p.h; j++) for (let i = 0; i < p.w; i++) if (p.mask[j * p.w + i]) { px++; if (m.isSolidAt(p.x + i, p.y + j)) onSolid++; }
      return { id: g.weatherId, drops: w.drops.length, splashes: w.splashes.length, puddles: w.puddles.length, px, onSolid, grade: g.atmosphere.grade.length }; })()`);
    assert.equal(rain.id, 'rain');
    assert.ok(rain.drops > 50, `poche gocce: ${JSON.stringify(rain)}`);
    assert.ok(rain.splashes > 0, `nessuno spruzzo: ${JSON.stringify(rain)}`);
    assert.ok(rain.puddles > 10 && rain.px > 0, `poche pozzanghere: ${JSON.stringify(rain)}`);
    assert.equal(rain.onSolid, 0, 'pozzanghere sopra tile solidi');
    // una goccia che cade su una pozzanghera fa un cerchio
    const ring = await ev(`(() => { const w = BAF2D.weather, p = w.puddles[0]; let k = p.mask.indexOf(1);
      const x = p.x + (k % p.w) + 0.5, y = p.y + Math.floor(k / p.w) + 0.5; w.splashes.length = 0;
      const d = w.drops[0], keep = w.cfg.rain.ring.chance; d.x = x; d.y = y; d.z = 0.001; w.cfg.rain.ring.chance = 1;
      w.update(1 / 60, BAF2D._view); w.cfg.rain.ring.chance = keep;
      return w.splashes.some((s) => s.ring); })()`);
    assert.ok(ring, 'nessun cerchio sulla pozzanghera');
    await shot('weather-rain');

    // nebbia: banchi che scorrono col vento
    await T(`start('countryside', { allies: 0, enemies: 0, weather: ${W.indexOf('fog')}, timeOfDay: 0 })`);
    const fog0 = await ev('BAF2D.weather.fog.map((l) => l.ox)');
    await T('step(1)');
    const fog1 = await ev('BAF2D.weather.fog.map((l) => l.ox)');
    assert.ok(fog0.length > 0, 'nebbia senza banchi');
    assert.notDeepEqual(fog0, fog1, 'la nebbia non si muove');
    await shot('weather-fog');

    // ciclo dal giorno alla notte: si scurisce col tempo, la rivincita lo fa ripartire
    await T(`start('countryside', { allies: 0, enemies: 0, weather: ${W.indexOf('clear')}, timeOfDay: ${times.indexOf('dayToNight')} })`);
    await T('step(0.2)');
    assert.equal(await ev('BAF2D.lights.time'), 'dayToNight');
    assert.equal(await ev('BAF2D.lights.ambient'), null, 'il ciclo non parte dal giorno');
    const dur = game.lights.cycles.dayToNight.duration;
    await ev(`BAF2D.lights.cycle.t = ${dur * 1.5}`);
    await T('step(0.1)');
    const mid = await ev('BAF2D.lights.ambient?.darkness ?? 0');
    const { dusk, night } = game.lights.times;
    assert.ok(mid > dusk.darkness && mid < night.darkness, `buio a metà tra tramonto e notte: ${mid}`);
    await ev('BAF2D._reset()');
    assert.equal(await ev('BAF2D.lights.cyclePhase'), 0, 'la rivincita non fa ripartire il ciclo');
  });

  it('segni di battaglia: il cratere resta, i bossoli fermi si cuociono a terra, la rivincita li cancella', async () => {
    await openGame();
    await T(`start('desert', { allies: 0, enemies: 0 })`);
    await T('step(0.2)');
    const alphaAt = `((x, y) => { const c = BAF2D.marks.canvas; return c ? c.getContext('2d').getImageData(Math.round(x), Math.round(y), 1, 1).data[3] : 0; })`;
    // punto libero vicino al giocatore
    const p = await ev(`(() => { const g = BAF2D, p = g.player; for (const [dx, dy] of [[40, 0], [-40, 0], [0, 40], [0, -40], [30, 30]]) if (!g.map.isSolidAt(p.x + dx, p.y + dy)) return { x: p.x + dx, y: p.y + dy }; return { x: p.x, y: p.y }; })()`);
    await ev(`BAF2D.effects.explosion('frag', ${p.x}, ${p.y}, BAF2D.map)`);
    assert.ok((await ev(`${alphaAt}(${p.x}, ${p.y})`)) > 0, 'nessun cratere nei segni a terra');
    await T('step(20)');
    assert.ok((await ev(`${alphaAt}(${p.x}, ${p.y})`)) > 0, 'il cratere è sparito');
    // bossoli: dopo qualche secondo fermi non restano tra gli oggetti da disegnare
    const before = await ev(`BAF2D.effects.casings.length`);
    assert.equal(before, 0, `bossoli/detriti ancora da disegnare dopo 20 s: ${before}`);
    // i segni sono cotti anche nel canvas della mappa (niente livello in più da disegnare a ogni fotogramma) e
    // ci restano quando la regione si ridisegna (crollo, crepa)
    const mapPx = `((x, y) => Array.from(BAF2D.map.canvas.getContext('2d').getImageData(Math.round(x), Math.round(y), 1, 1).data).join())`;
    const pristine = await ev(`(() => { const c = document.createElement('canvas'); c.width = c.height = 1; const g = c.getContext('2d');
      const src = BAF2D.map.pristine; if (!src) return null; g.drawImage(src, ${Math.round(p.x)}, ${Math.round(p.y)}, 1, 1, 0, 0, 1, 1); return Array.from(g.getImageData(0, 0, 1, 1).data).join(); })()`);
    const marked = await ev(`${mapPx}(${p.x}, ${p.y})`);
    if (pristine) assert.notEqual(marked, pristine, 'il cratere non è nel canvas della mappa');
    const t = { x: Math.floor(p.x / 16), y: Math.floor(p.y / 16) };
    await ev(`BAF2D.map._renderRegion(${t.x - 1}, ${t.y - 1}, ${t.x + 1}, ${t.y + 1})`);
    assert.equal(await ev(`${mapPx}(${p.x}, ${p.y})`), marked, 'il ridisegno della regione ha cancellato il cratere dalla mappa');
    await ev(`BAF2D._reset()`); // come la rivincita
    assert.equal(await ev(`${alphaAt}(${p.x}, ${p.y})`), 0, 'la nuova partita non ha cancellato i segni');
    if (pristine) assert.equal(await ev(`${mapPx}(${p.x}, ${p.y})`), pristine, 'la nuova partita non ha ripulito la mappa');
  });

  it('prestazioni: qualità grafica bassa, ridisegno delle regioni veloce dopo il riscaldamento', async () => {
    await openGame();
    await T(`start('countryside', { allies: 3, enemies: 3, weather: ${game.menu.weathers.indexOf('rain')} })`);
    await T('step(0.5)');
    const low = game.display.quality.low;
    const r = await ev(`(() => { const g = BAF2D; const hi = { max: g.effects.maxParticles, drops: g.weather.drops.length };
      g.setQuality('low'); T.step(0.2);
      const lo = { rimOff: g.lighting.rimOff, skipSelf: g.atmosphere.skipSelf, max: g.effects.maxParticles, drops: g.weather.drops.length };
      g.render();
      g.setQuality('high'); T.step(0.2);
      return { hi, lo, back: { rimOff: g.lighting.rimOff, skipSelf: g.atmosphere.skipSelf, max: g.effects.maxParticles } }; })()`);
    assert.equal(r.lo.rimOff, low.rim === false, 'qualità bassa: luce sul bordo');
    assert.equal(r.lo.skipSelf, low.gradeSelf === false, 'qualità bassa: passaggi "self" del colore');
    assert.ok(r.lo.max < r.hi.max, 'qualità bassa: stesse particelle');
    assert.ok(r.lo.drops < r.hi.drops, 'qualità bassa: stessa pioggia');
    assert.deepEqual(r.back, { rimOff: false, skipSelf: false, max: r.hi.max }, 'tornando ad alta qualcosa resta basso');
    // ridisegno di una regione dopo il riscaldamento della partita: niente scatti da decine di ms
    const ms = await ev(`(() => { const m = BAF2D.map, t = performance.now(); for (let i = 0; i < 5; i++) m._renderRegion(10 + i * 8, 10, 12 + i * 8, 12); return (performance.now() - t) / 5; })()`);
    assert.ok(ms < 40, `ridisegno di una regione 3x3 troppo lento: ${ms.toFixed(1)} ms`);
    // l'opzione nel menu
    await ev(`document.querySelector('#quality-choice [data-value="low"]').click()`);
    assert.equal(await ev('BAF2D.quality'), 'low');
    await ev(`document.querySelector('#quality-choice [data-value="high"]').click()`);
  });

  it("esplosioni: onda d'urto col colore del terreno, braci che si spengono, fumo con volume", async () => {
    await openGame();
    await T(`start('desert', { allies: 0, enemies: 0 })`);
    await T('step(0.2)');
    const r = await ev(`(() => { const g = BAF2D, e = g.effects, p = g.player;
      const sand = e.impacts.sand.dust;
      let pt = null;
      for (let y = 0; y < g.map.rows && !pt; y++) for (let x = 0; x < g.map.cols && !pt; x++)
        if (g.map.tileAt(x, y)?.impact === 'sand') pt = { x: (x + 0.5) * g.map.size, y: (y + 0.5) * g.map.size };
      e.explosion('frag', pt.x, pt.y, g.map);
      const ring = e.rings.at(-1);
      return { rings: e.rings.length, embers: e.embers.length, sandRing: JSON.stringify(ring.colors) === JSON.stringify(sand),
        shaded: e.particles.filter((q) => q.shade).length, blastFirst: e.blasts.at(-1).first % e.blasts.at(-1).steps };
    })()`);
    assert.equal(r.rings, 1, "nessuna onda d'urto");
    assert.ok(r.sandRing, "l'onda d'urto sulla sabbia non ha i colori della sabbia");
    assert.ok(r.embers > 0, 'nessuna brace');
    assert.ok(r.shaded > 0, 'nessuno sbuffo di fumo con volume');
    assert.equal(r.blastFirst, 0, 'la palla di fuoco non parte dal primo fotogramma della variante');
    await T('step(0.15)');
    await shot('explosion');
    await T('step(15)');
    assert.equal(await ev('BAF2D.effects.rings.length + BAF2D.effects.embers.length + BAF2D.effects.blasts.length'), 0, 'onde, braci o palle di fuoco rimaste');
  });

  it('effetti: polvere di corsa e mezzi, gocce di sangue e scia dei feriti, traccianti, cerchi nell\'acqua', async () => {
    await openGame();
    await T(`start('countryside', { allies: 0, enemies: 0 })`);
    await T('step(0.2)');
    const r = await ev(`(() => { const g = BAF2D, e = g.effects, p = g.player, out = {};
      // corsa: polvere coi colori del terreno
      e.particles.length = 0;
      for (let i = 0; i < 30; i++) { p.sprinting = true; p.vx = 120; p.vy = 0; g._kickUp(1 / 60); }
      p.sprinting = false;
      out.run = e.particles.length;
      // ferito grave che si muove: gocce a terra
      e.spots.length = 0;
      p.health = p.maxHealth * 0.2;
      for (let i = 0; i < 30; i++) { p.vx = 120; g._kickUp(1 / 60); }
      out.bleed = e.spots.length;
      p.health = p.maxHealth;
      for (let i = 0; i < 30; i++) { p.vx = 120; g._kickUp(1 / 60); }
      out.healthy = e.spots.length - out.bleed;
      p.vx = 0;
      // mezzo in movimento: polvere dalle ruote
      const v = g.vehicles.find((v) => !v.def.flying);
      e.particles.length = 0;
      for (let i = 0; i < 30; i++) { v.speed = 70; v.vx = 70; v.vy = 0; g._kickUp(1 / 60); }
      out.vehicle = e.particles.length;
      v.speed = 0; v.vx = 0;
      // colpo in un corpo: gocce davanti nella direzione del proiettile
      e.spots.length = 0;
      e.impact('flesh', p.x, p.y, p.x, p.y, 1, 0);
      out.forward = e.spots.filter((s) => s.x >= p.x - 1).length / Math.max(1, e.spots.length);
      // traccianti: uno ogni "every" colpi della mitragliatrice
      g.bullets.length = 0;
      const w = g.weapons.get('vehicle_mg'), sh = { weapon: w, angle: 0, muzzle: { x: p.x, y: p.y }, x: p.x, y: p.y, team: 'red', owner: null, fromVehicle: null, aimDistance: 100 };
      for (let i = 0; i < 6; i++) g.fire(sh);
      out.tracers = g.bullets.filter((b) => b.tracer).length;
      out.bullets = g.bullets.length;
      g.bullets.length = 0;
      // acqua: cerchio che si allarga
      e.rings.length = 0;
      e.impact('water', p.x, p.y);
      out.ring = e.rings.length;
      return out; })()`);
    assert.ok(r.run > 0, 'nessuna polvere correndo');
    assert.ok(r.bleed > 0, 'nessuna goccia dal ferito grave');
    assert.equal(r.healthy, 0, 'gocce anche da chi non è ferito');
    assert.ok(r.vehicle > 0, 'nessuna polvere dal mezzo');
    assert.ok(r.forward > 0.8, `gocce non nella direzione del colpo (${r.forward})`);
    assert.equal(r.bullets, 6);
    assert.equal(r.tracers, 2, 'un tracciante ogni 3 colpi');
    assert.equal(r.ring, 1, "nessun cerchio nell'acqua");
    await T('step(0.1)');
    await T('step(25)');
    assert.equal(await ev('BAF2D.effects.spots.length + BAF2D.effects.rings.length'), 0, 'gocce o cerchi rimasti');
  });

  it('mezzi: ruote e cingoli animati, sterzo, segni dei danni, pezzi staccati, fiamme e carcassa', async () => {
    await openGame();
    await T(`start('desert', { allies: 0, enemies: 0 })`);
    await T('step(0.2)');
    const r = await ev(`(() => { const g = BAF2D, out = {};
      const j = g.vehicles.find((v) => v.def.sprite === 'jeep'), t = g.vehicles.find((v) => v.def.sprite === 'tank');
      // passi del battistrada: cambiano col percorso, anche all'indietro
      const frames = new Set();
      for (let i = 0; i < 12; i++) { j.trackPhase = i; frames.add(j._frame()); }
      out.phases = frames.size;
      j.trackPhase = -5; out.reverse = j._frame() >= 0;
      j.trackPhase = 0;
      j.steerLook = -1; out.left = j._frame(); j.steerLook = 1; out.right = j._frame(); j.steerLook = 0; out.straight = j._frame();
      out.tankSteer = (t.steerLook = 1, t._frame()); t.steerLook = 0;
      // danni: segni sulla carrozzeria e pezzi che si staccano
      const casings = g.effects.casings.length;
      t.damage(t.maxHealth * 0.35);
      out.scars = t.scars.length;
      g.update(1 / 60);
      out.pieces = g.effects.casings.length - casings;
      out.scarSprite = !!t._scarSprite(g.assets.sprite(t.def.sprite, t.team));
      out.flamesHealthy = t.flames().length;
      t.damage(t.maxHealth * 0.5);
      out.flamesLow = t.flames().length;
      return out; })()`);
    assert.equal(r.phases, 3, 'passi del battistrada della jeep');
    assert.ok(r.reverse, 'fotogramma negativo in retromarcia');
    assert.deepEqual([r.straight, r.left, r.right], [0, 3, 6], 'gruppi di sterzo della jeep');
    assert.equal(r.tankSteer, 0, 'il carro non ha fotogrammi di sterzo');
    assert.ok(r.scars > 0, 'nessun segno dei danni');
    assert.ok(r.pieces > 0, 'nessun pezzo staccato sotto il 70%');
    assert.ok(r.scarSprite, 'segni non disegnati');
    assert.equal(r.flamesHealthy, 0, 'fiamme su un mezzo poco danneggiato');
    assert.ok(r.flamesLow > 0, 'nessuna fiamma sul mezzo quasi distrutto');
    await T('step(0.3)');
    await shot('vehicle-burning');
    // distrutto: fiamme sulla carcassa che si spengono dopo wreckFireTime
    await ev(`(() => { const g = BAF2D, t = g.vehicles.find((v) => v.def.sprite === 'tank'); t.damage(9999); })()`);
    await T('step(0.5)');
    assert.ok(await ev(`BAF2D.vehicles.find((v) => v.def.sprite === 'tank').flames().length > 0`), 'carcassa senza fiamme');
    await T('step(10)');
    assert.equal(await ev(`(BAF2D.vehicles.find((v) => v.def.sprite === 'tank' && v.destroyed)?.flames().length) ?? 0`), 0, 'fiamme della carcassa ancora accese');
  });

  it('HUD: minimappa tattica rifatta coi crolli, indicatori a bordo schermo, numeri dei danni, mirini', async () => {
    await openGame('lang=it');
    await T(`start('crossroads', { allies: 2, enemies: 2 })`);
    await T('step(0.3)');
    const r = await ev(`(() => { const g = BAF2D, h = g.hud, out = {};
      g.render();
      const mini = h._mini;
      out.mini = !!mini && mini.canvas.width === (h.cfg.minimap?.width ?? 72);
      // un muro che crolla cambia la versione della mappa: la minimappa si rifà
      let wall = null;
      for (let y = 1; y < g.map.rows - 1 && !wall; y++) for (let x = 1; x < g.map.cols - 1 && !wall; x++) if (g.map.blocksShotTile(x, y)) wall = [x, y];
      const v0 = g.map.version || 0;
      g.map.setTile(wall[0], wall[1], g.map.tileAt(wall[0], wall[1] + 1)?.id ?? 0);
      g.render();
      out.version = (g.map.version || 0) > v0 && h._mini.version === g.map.version;
      // bordo schermo: almeno una bandiera fuori vista
      const e = g._edgeHud();
      out.offscreen = e.flags.filter((f) => f.x < e.view.x || f.y < e.view.y || f.x > e.view.x + e.view.w || f.y > e.view.y + e.view.h).length;
      // numeri dei danni: spenti di default, poi accesi; i colpi sullo stesso bersaglio si sommano
      out.defaultOff = !h.showNumbers;
      g.setDamageNumbers(true);
      const t = g.units.find((u) => u.team !== g.player.team);
      h.damageNumber(t.x, t.y, 10, 'hit', t);
      h.damageNumber(t.x, t.y, 15, 'kill', t);
      out.merged = h.numbers.length === 1 && h.numbers[0].n === 25 && h.numbers[0].kind === 'kill';
      g.render();
      // mirini: ogni stile si disegna e un nome sconosciuto torna al primo
      const c = document.createElement('canvas'); c.width = c.height = 30;
      out.styles = (g.config.hud.crosshair.styles || []).map((s) => { const q = c.getContext('2d'); q.clearRect(0, 0, 30, 30);
        g._drawCrosshairShape(q, 15, 15, 3, s); return q.getImageData(0, 0, 30, 30).data.some((v, i) => i % 4 === 3 && v > 0); });
      g.setCrosshairStyle('nessuno');
      out.fallback = g.crosshairStyle === g.config.hud.crosshair.styles[0];
      g.setCrosshairStyle('circle');
      out.circle = g.crosshairStyle;
      g.setCrosshairStyle(g.config.hud.crosshair.styles[0]);
      g.setDamageNumbers(false);
      return out; })()`);
    assert.ok(r.mini, 'minimappa non disegnata');
    assert.ok(r.version, 'minimappa non rifatta dopo un crollo');
    assert.ok(r.offscreen > 0, 'nessuna bandiera fuori vista da indicare');
    assert.ok(r.defaultOff, 'numeri dei danni accesi di default');
    assert.ok(r.merged, 'numeri dei danni sullo stesso bersaglio non sommati');
    assert.ok(r.styles.length >= 2 && r.styles.every(Boolean), `mirini non disegnati: ${JSON.stringify(r.styles)}`);
    assert.ok(r.fallback, 'stile di mirino sconosciuto accettato');
    assert.equal(r.circle, 'circle');
    await shot('hud');
    // opzioni del menu: un pulsante per mirino e la scelta dei numeri dei danni
    const opts = await ev(`({ cross: document.querySelectorAll('#crosshair-choice [data-value]').length, nums: document.querySelectorAll('#damagenumbers-choice [data-value]').length })`);
    assert.equal(opts.cross, game.hud.crosshair.styles.length, 'pulsanti dei mirini');
    assert.equal(opts.nums, 2);
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
