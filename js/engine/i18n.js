// Localizzazione: i testi stanno in file JSON per lingua (es. config/lang/en.json).
// Le chiavi sono percorsi puntati ("start.tapToStart"), i segnaposto sono "{nome}".
// Ordine di scelta della lingua: parametro URL ?lang=xx -> i18n.language in game.json
// (se diverso da "auto") -> lingue del browser -> lingua di default.
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

  async load(cfg = {}) {
    this.defaultLang = cfg.default || 'en';
    this.available = cfg.available || [this.defaultLang];
    this.path = cfg.path || 'config/lang/{lang}.json';
    this.lang = this.detect(cfg.language);

    this.fallback = await loadJSON(this._url(this.defaultLang));
    if (this.lang === this.defaultLang) {
      this.strings = this.fallback;
    } else {
      try {
        this.strings = await loadJSON(this._url(this.lang));
      } catch (e) {
        console.warn(`Language "${this.lang}" not loaded (${e.message}), using "${this.defaultLang}"`);
        this.lang = this.defaultLang;
        this.strings = this.fallback;
      }
    }
    document.documentElement.lang = this.lang;
  }

  detect(preferred) {
    const candidates = [
      new URLSearchParams(location.search).get('lang'),
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

  /** Traduce l'errore se ha una chiave nota, altrimenti restituisce il messaggio originale. */
  error(e) {
    return e && e.key && this.has(e.key) ? this.t(e.key, e.params) : e?.message || String(e);
  }

  /** Applica le traduzioni agli elementi con attributo data-i18n="chiave". */
  applyToDOM(root = document) {
    for (const el of root.querySelectorAll('[data-i18n]')) {
      el.textContent = this.t(el.dataset.i18n);
    }
  }
}
