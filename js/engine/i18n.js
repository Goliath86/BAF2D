// Localizzazione: i testi stanno in file JSON per lingua (es. config/lang/en.json).
// Le chiavi sono percorsi puntati ("menu.newGame"), i segnaposto sono "{nome}".
// Ordine di scelta della lingua: parametro URL ?lang=xx -> lingua salvata nelle opzioni
// -> i18n.language in game.json (se diverso da "auto") -> lingue del browser -> lingua di default.
// Le chiavi mancanti nella lingua scelta ricadono sulla lingua di default.

import { loadJSON } from './loader.js';

function lookup(dict, key) {
  return key.split('.').reduce((node, part) => (node && typeof node === 'object' ? node[part] : undefined), dict);
}

function format(str, params) {
  return str.replace(/\{(\w+)\}/g, (m, k) => (params && k in params ? String(params[k]) : m));
}

export class I18n {
  constructor() {
    this.lang = 'en';
    this.defaultLang = 'en';
    this.available = ['en'];
    this.strings = {};
    this.fallback = {};
    this._missing = new Set();
  }

  /** saved = lingua scelta dal giocatore nelle opzioni (ha la precedenza su game.json e browser). */
  async load(cfg = {}, saved = null) {
    this.defaultLang = cfg.default || 'en';
    this.available = cfg.available || [this.defaultLang];
    this.path = cfg.path || 'config/lang/{lang}.json';
    this._cache = new Map();

    this.fallback = await this._file(this.defaultLang);
    await this.setLanguage(this.detect(cfg.language, saved));
  }

  /** Cambia lingua a runtime (menu opzioni): carica il file e aggiorna gli elementi [data-i18n]. */
  async setLanguage(lang) {
    if (!this.available.includes(lang)) lang = this.defaultLang;
    try {
      this.strings = await this._file(lang);
      this.lang = lang;
    } catch (e) {
      console.warn(`Language "${lang}" not loaded (${e.message}), using "${this.defaultLang}"`);
      this.lang = this.defaultLang;
      this.strings = this.fallback;
    }
    document.documentElement.lang = this.lang;
    this.applyToDOM();
  }

  /** Nome di ogni lingua disponibile nella lingua stessa (meta.name del suo file). */
  async languageNames() {
    const names = {};
    for (const l of this.available) {
      try {
        names[l] = (await this._file(l)).meta?.name || l;
      } catch (e) {
        names[l] = l;
      }
    }
    return names;
  }

  async _file(lang) {
    if (!this._cache.has(lang)) this._cache.set(lang, await loadJSON(this._url(lang)));
    return this._cache.get(lang);
  }

  detect(preferred, saved = null) {
    const candidates = [
      new URLSearchParams(location.search).get('lang'),
      saved,
      preferred && preferred !== 'auto' ? preferred : null,
      ...(navigator.languages || [navigator.language]),
    ];
    for (const c of candidates) {
      if (!c) continue;
      const code = c.toLowerCase();
      if (this.available.includes(code)) return code;
      const primary = code.split('-')[0];
      if (this.available.includes(primary)) return primary;
    }
    return this.defaultLang;
  }

  _url(lang) {
    return this.path.replace('{lang}', lang);
  }

  has(key) {
    return typeof lookup(this.strings, key) === 'string' || typeof lookup(this.fallback, key) === 'string';
  }

  t(key, params) {
    let s = lookup(this.strings, key);
    if (typeof s !== 'string') s = lookup(this.fallback, key);
    if (typeof s !== 'string') {
      if (!this._missing.has(key)) {
        this._missing.add(key);
        console.warn(`Missing translation key: "${key}"`);
      }
      return key;
    }
    return format(s, params);
  }

  /** Lista di stringhe (array nel file lingua, es. nomi dei bot); [] se la chiave manca. */
  list(key) {
    let a = lookup(this.strings, key);
    if (!Array.isArray(a)) a = lookup(this.fallback, key);
    if (!Array.isArray(a)) {
      console.warn(`Missing translation list: "${key}"`);
      return [];
    }
    return a.filter((s) => typeof s === 'string');
  }

  /** Traduce l'errore se ha una chiave nota, altrimenti restituisce il messaggio originale. */
  error(e) {
    return e && e.key && this.has(e.key) ? this.t(e.key, e.params) : e?.message || String(e);
  }

  /** Applica le traduzioni agli elementi con data-i18n="chiave" (testo) e data-i18n-title (title + aria-label). */
  applyToDOM(root = document) {
    for (const el of root.querySelectorAll('[data-i18n]')) {
      el.textContent = this.t(el.dataset.i18n);
    }
    for (const el of root.querySelectorAll('[data-i18n-title]')) {
      const s = this.t(el.dataset.i18nTitle);
      el.title = s;
      el.setAttribute('aria-label', s);
    }
  }
}
