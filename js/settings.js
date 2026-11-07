// Impostazioni del giocatore (lingua, volume, tasti, ultima configurazione di partita) in localStorage.
// localStorage può non essere disponibile (navigazione privata, dati bloccati): in quel caso
// le impostazioni valgono solo per la sessione corrente.

export class Settings {
  constructor(key = 'baf2d.settings') {
    this.key = key;
    this.data = {};
    try {
      const raw = localStorage.getItem(key);
      const parsed = raw ? JSON.parse(raw) : null;
      if (parsed && typeof parsed === 'object') this.data = parsed;
    } catch (e) {
      console.warn(`Settings not loaded (${e.message})`);
    }
  }

  get(name, def = undefined) {
    return this.data[name] ?? def;
  }

  set(name, value) {
    this.data[name] = value;
    this.save();
  }

  save() {
    try {
      localStorage.setItem(this.key, JSON.stringify(this.data));
    } catch (e) {
      // non persistente: pazienza
    }
  }
}
