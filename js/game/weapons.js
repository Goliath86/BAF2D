// Catalogo delle armi definite in config/weapons.json.
// Ogni arma = "defaults" + i propri campi; l'id è la chiave nella mappa "weapons".

import { LocalizedError } from '../engine/errors.js';

export class Weapons {
  constructor(cfg = {}) {
    const defaults = cfg.defaults || {};
    this.defs = new Map();
    for (const [id, def] of Object.entries(cfg.weapons || {})) {
      this.defs.set(id, Object.freeze({ ...defaults, ...def, id }));
    }
    this._ids = Object.freeze([...this.defs.keys()]);
  }

  /** Elenco degli id, nell'ordine del file (array condiviso, sola lettura). */
  get ids() {
    return this._ids;
  }

  has(id) {
    return this.defs.has(id);
  }

  /** Definizione (immutabile) dell'arma; errore localizzato se non esiste. */
  get(id) {
    const w = this.defs.get(id);
    if (!w) throw new LocalizedError('errors.unknownWeapon', { name: id });
    return w;
  }
}
