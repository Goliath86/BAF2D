// Funzioni iniettate nella pagina del gioco (window.T) per pilotare le partite dai test:
// - la partita avanza a passi fissi (T.step) invece che col requestAnimationFrame (game.suspended = true):
//   molto più veloce del tempo reale e, con Math.random a seme fisso, ripetibile;
// - T.sanity() elenca stati impossibili (coordinate NaN, soldati dentro i muri o fuori mappa...).

export const PAGE_HELPERS = `
window.T = (() => {
  const G = () => window.BAF2D;
  const M = () => window.BAF2D_MENU;
  const STEP = 1 / 60;
  const idle = () => ({ move: { x: 0, y: 0 }, aim: (u) => u.angle, firing: false, reload: false, grenade: false,
    switchWeapon: false, sprint: false, repeat: false, faceMove: false });
  const T = {
    /** Nuova partita dal menu (come "Inizia"): opts = { team, allies, enemies, tickets, timeLimit (minuti) }. */
    start(level, opts = {}) {
      const m = M();
      Object.assign(m.choice, { level }, opts);
      T._auto = false;
      m.startMatch();
      G().suspended = true; // si avanza solo con T.step
      return T.state();
    },
    /**
     * Pilota automatico: il giocatore umano viene guidato da un BotBrain come nella partita dimostrativa (la sua
     * squadra lo segue: fermo alla base la terrebbe ferma); alla morte rientra da solo (punto di default).
     */
    autopilot(on = true) {
      T._auto = on;
      T._attach();
      return true;
    },
    _attach() {
      const g = G();
      if (!T._auto || !g.player || g.player.dead || (g.playerBrain && g.playerBrain.unit === g.player)) return;
      const Brain = g.bots[0]?.brain?.constructor;
      if (!Brain) return;
      const squad = g.squads[g.playerTeam];
      const brain = new Brain(g.player, squad, g.aiCfg);
      brain.time = g.time;
      const i = squad.brains.indexOf(g.playerBrain);
      if (i >= 0) squad.brains[i] = brain;
      else squad.brains.push(brain);
      g.player.isBot = true;
      g.playerBrain = brain;
      squad.replan();
    },
    /** Avanza la partita di "sec" secondi di gioco (tick da 1/60 s); si ferma prima se until() diventa vera. */
    step(sec, until = null) {
      const g = G();
      const n = Math.round(sec / STEP);
      for (let i = 0; i < n; i++) {
        if (T._auto) {
          if (g.respawn && !g.respawn.confirmed && !g.ended) g.chooseDeploy(g.respawn.choice ?? g.deployOptions()[0]?.id, true);
          T._attach();
        }
        g.update(STEP);
        if (until && until(g)) break;
      }
      return g.time;
    },
    /** Disegna un fotogramma (per gli screenshot e per far girare anche il codice di rendering). */
    render() {
      G().render();
      return true;
    },
    /** Il bot "slot" sta fermo (bersaglio per i test). */
    freeze(slot) {
      slot.brain.think = idle;
      return true;
    },
    state() {
      const g = G();
      return {
        time: g.time,
        level: g.level?.name,
        tickets: { ...g.ctf.tickets },
        owners: g.ctf.flags.map((f) => f.owner),
        ended: g.ended ? g.ended.outcome : null,
        bots: g.bots.length,
        alive: g.bots.filter((b) => b.unit && !b.unit.dead).length,
        kills: g.scores ? g.scores.ranking().reduce((s, r) => s + (r.kills || 0), 0) : 0,
      };
    },
    /** Stati impossibili: [] se tutto a posto. */
    sanity() {
      const g = G();
      const bad = [];
      const W = g.map.pixelWidth;
      const H = g.map.pixelHeight;
      const num = (v) => typeof v === 'number' && Number.isFinite(v);
      g.units.forEach((u, i) => {
        if (!u) return bad.push('unit ' + i + ' missing');
        const who = (u === g.player ? 'player' : 'bot ' + i) + ' (' + u.team + ')';
        if (!num(u.x) || !num(u.y) || !num(u.angle)) return bad.push(who + ' NaN position/angle');
        if (u.dead) return;
        if (!num(u.health) || u.health > u.maxHealth) bad.push(who + ' health ' + u.health);
        if (u.vehicle) return;
        if (u.x < 0 || u.y < 0 || u.x > W || u.y > H) bad.push(who + ' outside the map at ' + u.x.toFixed(1) + ',' + u.y.toFixed(1));
        else if (g.map.isSolidAt(u.x, u.y)) bad.push(who + ' inside a solid tile at ' + u.x.toFixed(1) + ',' + u.y.toFixed(1));
        if (!num(u.ammo) || u.ammo < 0 || u.ammo > u.weapon.magazine) bad.push(who + ' ammo ' + u.ammo);
        for (const [id, n] of Object.entries(u.reserve)) {
          const w = g.weapons.get(id);
          if (!num(n) || n < 0 || (w.reserve !== undefined && n > w.reserve)) bad.push(who + ' reserve ' + id + '=' + n);
        }
        if (u.grenades < 0 || u.grenades > u.maxGrenades) bad.push(who + ' grenades ' + u.grenades);
      });
      for (const v of g.vehicles) if (!num(v.x) || !num(v.y) || !num(v.angle)) bad.push('vehicle ' + (v.def.id ?? v.def.name) + ' NaN');
      for (const b of g.bullets) if (!num(b.x) || !num(b.y)) { bad.push('bullet NaN'); break; }
      for (const [t, n] of Object.entries(g.ctf.tickets)) if (!num(n) || n < 0) bad.push('tickets ' + t + '=' + n);
      for (const f of g.ctf.flags) if (!num(f.progress) || f.progress < 0 || f.progress > 1) bad.push('flag ' + f.id + ' progress ' + f.progress);
      return bad;
    },
    /** Testi senza traduzione chiesti finora (I18n._missing). */
    missingKeys() {
      return [...G().i18n._missing];
    },
  };
  return T;
})();
true;
`;
