// Punteggi della partita: un record per combattente (giocatore o bot), persistente tra un rientro e l'altro
// (il soldato morto viene ricreato, il record resta: unit.combatant). Punti in game.json -> scoring.points:
// kill (uccisione), assist (danni a un nemico ucciso da altri, almeno assistDamage), defend (uccisione
// nell'area di una bandiera della propria squadra), capture / neutralize (chi è nell'area quando la bandiera
// cambia stato), victory / draw / defeat (a fine partita, a tutta la squadra).
// onAward(record, tipo, punti) viene chiamato a ogni assegnazione (HUD, carriera del giocatore).

export class Scores {
  constructor(cfg = {}) {
    this.cfg = cfg;
    this.points = cfg.points || {};
    this.list = [];
    this.onAward = null;
  }

  reset() {
    this.list = [];
  }

  /** Nuovo combattente: { name, team, human, rank } -> record con i contatori a zero. */
  add({ name, team, human = false, rank = 0 }) {
    const rec = { id: this.list.length, name, team, human, rank, score: 0, kills: 0, deaths: 0, assists: 0, captures: 0 };
    this.list.push(rec);
    return rec;
  }

  /** Assegna i punti del tipo "type" (scoring.points) al record; restituisce i punti dati. */
  award(rec, type) {
    const n = this.points[type] ?? 0;
    if (!rec || !n) return 0;
    rec.score += n;
    this.onAward?.(rec, type, n);
    return n;
  }

  /** Il soldato "victim" è appena morto: morte, uccisione (+ difesa) e assist. ctf per le aree delle bandiere. */
  onDeath(victim, ctf) {
    const rec = victim.combatant;
    if (rec) rec.deaths++;
    const k = victim.killer;
    // niente punti per suicidi (granata propria) o compagni di squadra
    const kr = k && k !== victim && k.team !== victim.team ? k.combatant : null;
    if (kr) {
      kr.kills++;
      this.award(kr, 'kill');
      const defended = ctf?.flags.some((f) => f.owner === k.team && (ctf.inZone(f, victim.x, victim.y) || ctf.inZone(f, k.x, k.y)));
      if (defended) this.award(kr, 'defend');
    }
    const min = this.cfg.assistDamage ?? 30;
    for (const [u, dmg] of victim.damageLog || []) {
      if (u === k || u === victim || u.team === victim.team || dmg < min || !u.combatant) continue;
      u.combatant.assists++;
      this.award(u.combatant, 'assist');
    }
  }

  /** Evento delle bandiere (Ctf): punti a chi della squadra è nell'area. */
  onFlagEvent(e) {
    const team = e.type === 'captured' ? e.team : e.by;
    const type = e.type === 'captured' ? 'capture' : 'neutralize';
    for (const u of e.flag.units || []) {
      if (u.dead || u.team !== team || !u.combatant) continue;
      if (type === 'capture') u.combatant.captures++;
      this.award(u.combatant, type);
    }
  }

  /** Fine partita: bonus a tutti (winner = squadra vincitrice, null = pareggio). */
  endMatch(winner) {
    for (const rec of this.list) {
      this.award(rec, winner === null ? 'draw' : rec.team === winner ? 'victory' : 'defeat');
    }
  }

  /** Classifica: punti, poi uccisioni, poi meno morti. */
  ranking() {
    return [...this.list].sort((a, b) => b.score - a.score || b.kills - a.kills || a.deaths - b.deaths || a.id - b.id);
  }
}
