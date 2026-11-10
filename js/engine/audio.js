// Audio via Web Audio API. Suoni da file ("src") oppure sintetizzati come placeholder.

import { loadArrayBuffer } from './loader.js';

export class AudioManager {
  constructor(sounds = {}, cfg = {}) {
    this.defs = sounds;
    this.buffers = new Map();
    this.hearing = cfg.hearing || {};
    this.listener = null; // { x, y } posizione dell'ascoltatore nel mondo (vedi gainAt)
    this.volume = cfg.masterVolume ?? 0.6; // volume generale 0..1 (opzioni)
    this.muted = false; // es. partita dimostrativa dietro al menu
    this.loops = new Set(); // suoni continui in corso (motori), vedi loop()
    const Ctx = window.AudioContext || window.webkitAudioContext;
    this.ctx = Ctx ? new Ctx() : null;
    if (this.ctx) {
      this.master = this.ctx.createGain();
      this.master.gain.value = this.volume;
      this.master.connect(this.ctx.destination);
      this._autoUnlock();
    }
  }

  setVolume(v) {
    this.volume = Math.min(1, Math.max(0, v));
    this._applyGain();
  }

  /** Muto = i nuovi suoni non partono (quelli già in corso finiscono; i suoni continui si fermano). */
  setMuted(m) {
    this.muted = !!m;
    if (this.muted) this.stopLoops();
  }

  /** Ferma tutti i suoni continui (es. pausa, nuova partita). */
  stopLoops() {
    for (const l of [...this.loops]) l.stop();
  }

  /** Suona "name" anche se muto (es. prova del volume nelle opzioni). */
  preview(name) {
    const m = this.muted;
    this.muted = false;
    this.play(name);
    this.muted = m;
  }

  _applyGain() {
    if (this.master) this.master.gain.value = this.volume;
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

  /**
   * Volume relativo (0..1) di un suono emesso in "pos" ({ x, y } in pixel di mondo) rispetto
   * all'ascoltatore (this.listener, aggiornato dal gioco): pieno entro hearing.near, nullo oltre hearing.far.
   */
  gainAt(pos) {
    const l = this.listener;
    if (!pos || !l) return 1;
    const near = this.hearing.near ?? 220;
    const far = Math.max(near + 1, this.hearing.far ?? 520);
    const d = Math.hypot(pos.x - l.x, pos.y - l.y);
    if (d <= near) return 1;
    const k = Math.max(0, 1 - (d - near) / (far - near));
    return k * k;
  }

  /**
   * Riproduce un suono; restituisce { stop() } per interromperlo (es. ricarica annullata).
   * pos (opzionale) = punto del mondo da cui proviene: il volume cala con la distanza dall'ascoltatore.
   */
  play(name, pos = null) {
    const none = { stop() {} };
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running' || this.muted) return none;
    const def = this.defs[name];
    if (!def) return none;
    const gain = this.gainAt(pos);
    if (gain <= 0.01) return none;
    const vol = (def.volume ?? 1) * gain;
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

  /**
   * Suono continuo (es. motore). Da file ("src", in loop: il regime cambia playbackRate) o sintetizzato da
   * def.loop = {
   *   layers: [{ wave: square|sawtooth|sine|triangle|noise, freq (Hz al minimo), volume }],
   *   rpm: [moltiplicatore della frequenza al minimo, a pieno regime],
   *   lowpass: Hz del filtro al minimo (si apre col regime, lowpassOpen = moltiplicatore a pieno regime),
   *   throb: { rate: [Hz al minimo, Hz a pieno regime], depth 0..1 } (pulsazione dei cilindri),
   *   idle: volume relativo al minimo (0..1)
   * }.
   * Restituisce { set(rpm 0..1, pos), stop() } oppure null se l'audio non è attivo o è muto.
   */
  loop(name) {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running' || this.muted) return null;
    const def = this.defs[name];
    if (!def) return null;
    const L = def.loop || {};
    const now = ctx.currentTime;
    const out = ctx.createGain();
    out.gain.value = 0;
    out.connect(this.master);
    const sources = [];
    const oscs = [];
    let rate = null; // sorgente da file: playbackRate segue il regime
    let filter = null;
    let lfo = null;

    const buffer = this.buffers.get(name);
    if (buffer) {
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      src.loop = true;
      src.connect(out);
      src.start();
      sources.push(src);
      rate = src.playbackRate;
    } else {
      filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = L.lowpass ?? 500;
      filter.Q.value = L.q ?? 1;
      // pulsazione: un LFO modula il guadagno attorno a (1 - depth/2)
      const throb = ctx.createGain();
      const depth = L.throb?.depth ?? 0;
      throb.gain.value = 1 - depth / 2;
      if (depth > 0) {
        lfo = ctx.createOscillator();
        lfo.type = 'sine';
        lfo.frequency.value = L.throb.rate?.[0] ?? 10;
        const lfoGain = ctx.createGain();
        lfoGain.gain.value = depth / 2;
        lfo.connect(lfoGain).connect(throb.gain);
        lfo.start();
        sources.push(lfo);
      }
      throb.connect(filter).connect(out);
      for (const layer of L.layers || []) {
        const g = ctx.createGain();
        g.gain.value = layer.volume ?? 1;
        g.connect(throb);
        let src;
        if (layer.wave === 'noise') {
          src = ctx.createBufferSource();
          src.buffer = this._noise(); // rumore condiviso, ripetuto
          src.loop = true;
        } else {
          src = ctx.createOscillator();
          src.type = layer.wave || 'sawtooth';
          src.frequency.value = layer.freq || 40;
          oscs.push({ osc: src, freq: layer.freq || 40 });
        }
        src.connect(g);
        src.start();
        sources.push(src);
      }
    }

    const self = this;
    const handle = {
      /** rpm 0..1 = regime (es. velocità / velocità massima); pos = punto del mondo (volume con la distanza). */
      set(rpm, pos = null) {
        const t = ctx.currentTime;
        const r = Math.min(1, Math.max(0, rpm));
        const [m0, m1] = L.rpm || [1, 2];
        const mul = m0 + (m1 - m0) * r;
        for (const o of oscs) o.osc.frequency.setTargetAtTime(o.freq * mul, t, 0.08);
        if (rate) rate.setTargetAtTime(mul, t, 0.08);
        if (filter) filter.frequency.setTargetAtTime((L.lowpass ?? 500) * (1 + ((L.lowpassOpen ?? 2) - 1) * r), t, 0.1);
        if (lfo) {
          const [f0, f1] = L.throb.rate || [10, 25];
          lfo.frequency.setTargetAtTime(f0 + (f1 - f0) * r, t, 0.1);
        }
        const idle = L.idle ?? 0.5;
        const vol = (def.volume ?? 1) * self.gainAt(pos) * (idle + (1 - idle) * r);
        out.gain.setTargetAtTime(vol, t, 0.1);
      },
      /** Dissolvenza breve, poi le sorgenti si fermano. */
      stop() {
        if (!self.loops.has(handle)) return;
        self.loops.delete(handle);
        const t = ctx.currentTime;
        out.gain.cancelScheduledValues(t);
        out.gain.setTargetAtTime(0, t, 0.06);
        for (const s of sources) {
          try {
            s.stop(t + 0.4);
          } catch (e) {
            // già fermata
          }
        }
        setTimeout(() => out.disconnect(), 600);
      },
    };
    this.loops.add(handle);
    out.gain.setValueAtTime(0, now); // parte da zero e sale col primo set() (niente "click")
    return handle;
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
      // rumore: un tratto a caso del buffer condiviso (in loop se il suono è più lungo)
      const buf = this._noise();
      src = ctx.createBufferSource();
      src.buffer = buf;
      src.loop = dur > buf.duration;
      src.connect(g);
      src.start(t, Math.random() * Math.max(0, buf.duration - dur));
      src.stop(t + dur + 0.02);
      return src;
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

  /** Buffer di rumore bianco (2 s) creato una volta sola e condiviso da tutti i suoni sintetizzati. */
  _noise() {
    if (!this._noiseBuf) {
      const ctx = this.ctx;
      const len = ctx.sampleRate * 2;
      this._noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
      const data = this._noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    }
    return this._noiseBuf;
  }
}
