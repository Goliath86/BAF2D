// Audio via Web Audio API. Suoni da file ("src") oppure sintetizzati come placeholder.

import { loadArrayBuffer } from './loader.js';

export class AudioManager {
  constructor(sounds = {}, cfg = {}) {
    this.defs = sounds;
    this.buffers = new Map();
    const Ctx = window.AudioContext || window.webkitAudioContext;
    this.ctx = Ctx ? new Ctx() : null;
    if (this.ctx) {
      this.master = this.ctx.createGain();
      this.master.gain.value = cfg.masterVolume ?? 0.6;
      this.master.connect(this.ctx.destination);
      this._autoUnlock();
    }
  }

  /**
   * I browser attivano l'audio solo dentro un gesto "valido": click, pointerup, touchend, keydown.
   * Un pointerdown da touch NON lo è (per questo su mobile il tocco di avvio non bastava).
   * Si riprova a ogni gesto: copre anche iOS, che sospende il contesto ("interrupted")
   * dopo una chiamata o tornando dal background.
   */
  _autoUnlock() {
    const handler = () => this.unlock();
    for (const ev of ['pointerup', 'touchend', 'click', 'keydown']) {
      window.addEventListener(ev, handler, { capture: true, passive: true });
    }
  }

  async load() {
    if (!this.ctx) return;
    const jobs = Object.entries(this.defs)
      .filter(([, d]) => d.src)
      .map(async ([name, d]) => {
        try {
          const data = await loadArrayBuffer(d.src);
          this.buffers.set(name, await this.ctx.decodeAudioData(data));
        } catch (e) {
          console.warn(`Suono "${name}" non caricato (${e.message}) -> uso placeholder`);
        }
      });
    await Promise.all(jobs);
  }

  /** I browser richiedono un gesto utente prima di riprodurre audio. */
  unlock() {
    const ctx = this.ctx;
    if (!ctx || ctx.state === 'running') return;
    ctx.resume().catch(() => {});
    // buffer muto di 1 campione: su iOS "sblocca" davvero l'uscita audio dentro il gesto
    const src = ctx.createBufferSource();
    src.buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
    src.connect(ctx.destination);
    src.start(0);
  }

  /** Riproduce un suono; restituisce { stop() } per interromperlo (es. ricarica annullata). */
  play(name) {
    const none = { stop() {} };
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return none;
    const def = this.defs[name];
    if (!def) return none;
    const vol = def.volume ?? 1;
    const buffer = this.buffers.get(name);
    let sources = [];
    if (buffer) {
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      const g = ctx.createGain();
      g.gain.value = vol;
      src.connect(g).connect(this.master);
      src.start();
      sources = [src];
    } else if (def.placeholder) {
      // "placeholder" può essere una lista di strati suonati insieme (es. esplosione = rumore + boom grave);
      // "at": istanti (s) di partenza delle ripetizioni del suono sintetizzato (default [0])
      const layers = Array.isArray(def.placeholder) ? def.placeholder : [def.placeholder];
      for (const p of layers) {
        for (const delay of p.at || [0]) sources.push(this._synth(p, vol * (p.volume ?? 1), delay));
      }
    }
    return {
      stop() {
        for (const s of sources) {
          try {
            s.stop();
          } catch (e) {
            // già terminato
          }
        }
      },
    };
  }

  _synth(p, vol, delay = 0) {
    const ctx = this.ctx;
    const t = ctx.currentTime + delay;
    const dur = p.duration || 0.1;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    g.connect(this.master);

    let src;
    if (p.wave === 'noise') {
      const len = Math.ceil(ctx.sampleRate * dur);
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
      src = ctx.createBufferSource();
      src.buffer = buf;
    } else {
      src = ctx.createOscillator();
      src.type = p.wave || 'square';
      src.frequency.setValueAtTime(p.freqStart || 440, t);
      if (p.freqEnd) src.frequency.exponentialRampToValueAtTime(Math.max(1, p.freqEnd), t + dur);
    }
    src.connect(g);
    src.start(t);
    src.stop(t + dur + 0.02);
    return src;
  }
}
