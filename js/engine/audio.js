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
    if (this.ctx && this.ctx.state !== 'running') this.ctx.resume();
  }

  play(name) {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const def = this.defs[name];
    if (!def) return;
    const vol = def.volume ?? 1;
    const buffer = this.buffers.get(name);
    if (buffer) {
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      const g = ctx.createGain();
      g.gain.value = vol;
      src.connect(g).connect(this.master);
      src.start();
    } else if (def.placeholder) {
      this._synth(def.placeholder, vol);
    }
  }

  _synth(p, vol) {
    const ctx = this.ctx;
    const t = ctx.currentTime;
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
  }
}
