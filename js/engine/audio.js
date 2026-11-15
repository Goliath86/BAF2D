// Audio via Web Audio API. Suoni da file ("src") oppure sintetizzati come placeholder.
//
// Voce di assets.json -> sounds:
//   src         = file (es. "assets/sounds/shoot_rifle.mp3") o lista di varianti (una a caso a ogni riproduzione,
//                 mai la stessa due volte di fila); null = solo sintetizzato. Ogni variante è un percorso oppure
//                 { file, volume } (volume della variante, moltiplica "volume": pareggia file registrati più piano).
//                 Le varianti che non si caricano sono saltate; se non se ne carica nessuna si usa "placeholder"
//                 (avviso in console).
//   volume      = volume relativo (0..1)
//   variantMode = "random" (default: una variante a caso a ogni riproduzione) | "owner" (ogni soldato o mezzo
//                 riceve una variante, a turno tra i nuovi, e la tiene: es. gli spari di un'arma; il soldato la
//                 riperde cambiando arma, Player.equip azzera soundVariants)
//   pitchJitter = variazione casuale del tono dei file (es. 0.06 = ±6%): lo stesso sparo ripetuto non suona finto
//   maxVoices   = copie dello stesso suono da file che suonano insieme (default 6): oltre, si ferma la più vecchia
//   placeholder = suono sintetizzato (fallback), loop = motore sintetizzato (vedi loop())

import { loadArrayBuffer } from './loader.js';

export class AudioManager {
  /**
   * sounds = assets.json -> sounds, cfg = game.json -> audio, music = game.json -> music
   * ({ tracks: { id: { src, volume } }, fadeIn, fadeOut, defaultVolume }: brani in loop su un canale a parte).
   */
  constructor(sounds = {}, cfg = {}, music = {}) {
    this.defs = sounds;
    this.musicCfg = music;
    this.musicVolume = music.defaultVolume ?? 0.6; // volume della musica 0..1 (opzioni), sotto quello generale
    this.music = null; // brano in corso { id, src, gain }
    this.wantMusic = null; // brano richiesto (parte appena l'audio è sbloccato e il file è pronto)
    this.musicBuffers = new Map(); // id -> AudioBuffer | null (null = non caricabile)
    this.buffers = new Map(); // nome -> [{ buffer: AudioBuffer, volume }] (varianti caricate)
    this.lastVariant = new Map(); // nome -> indice dell'ultima variante suonata
    this.nextOwnerVariant = new Map(); // nome -> prossima variante da assegnare (variantMode "owner", a turno)
    this.voices = new Map(); // nome -> [sorgenti da file in corso] (maxVoices)
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
      // musica: volume proprio, poi quello generale (la musica non è toccata da setMuted)
      this.musicBus = this.ctx.createGain();
      this.musicBus.gain.value = this.musicVolume;
      this.musicBus.connect(this.master);
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

  /** Carica i file dei suoni (tutte le varianti in parallelo); quelli mancanti restano sintetizzati. */
  async load() {
    if (!this.ctx) return;
    const jobs = Object.entries(this.defs)
      .filter(([, d]) => d.src)
      .map(async ([name, d]) => {
        const list = Array.isArray(d.src) ? d.src : [d.src];
        const loaded = await Promise.all(list.map(async (v) => {
          const src = typeof v === 'string' ? v : v?.file;
          try {
            const buffer = await this.ctx.decodeAudioData(await loadArrayBuffer(src));
            return { buffer, volume: typeof v === 'object' ? v.volume ?? 1 : 1 };
          } catch (e) {
            console.warn(`Sound "${name}": "${src}" not loaded (${e.message})`);
            return null;
          }
        }));
        const ok = loaded.filter(Boolean);
        if (ok.length) this.buffers.set(name, ok);
        else if (d.placeholder || d.loop) console.warn(`Sound "${name}": no file loaded, using the synthesized placeholder`);
      });
    await Promise.all(jobs);
  }

  /**
   * Variante del suono "name": { buffer, volume }, o null se non ha file caricati. Con variantMode "owner" e un
   * "owner" (oggetto di chi suona) quella assegnata a lui in owner.soundVariants (la prima volta: la prossima a
   * turno, partendo da una a caso); altrimenti una a caso, mai la stessa due volte di fila.
   */
  _variant(name, owner = null) {
    const list = this.buffers.get(name);
    if (!list?.length) return null;
    if (owner && this.defs[name]?.variantMode === 'owner') {
      const mine = (owner.soundVariants ??= {});
      let k = mine[name];
      if (k === undefined || k >= list.length) {
        k = this.nextOwnerVariant.get(name) ?? Math.floor(Math.random() * list.length);
        this.nextOwnerVariant.set(name, (k + 1) % list.length);
        mine[name] = k;
      }
      return list[k];
    }
    let i = Math.floor(Math.random() * list.length);
    if (list.length > 1 && i === this.lastVariant.get(name)) i = (i + 1) % list.length;
    this.lastVariant.set(name, i);
    return list[i];
  }

  // ---------- Musica (game.json -> music) ----------

  setMusicVolume(v) {
    this.musicVolume = Math.min(1, Math.max(0, v));
    if (this.musicBus) this.musicBus.gain.value = this.musicVolume;
  }

  /**
   * Fa partire in loop il brano "id" (game.json -> music.tracks) con una dissolvenza in entrata; se è già in corso
   * non fa nulla. Senza audio sbloccato (nessun gesto dell'utente) o col file ancora da caricare parte appena
   * possibile. Un brano senza "src" o non caricabile resta in silenzio (niente fallback sintetizzato).
   */
  playMusic(id) {
    this.wantMusic = id;
    if (this.music?.id === id) return;
    this.stopMusic();
    this.wantMusic = id;
    this._startMusic();
  }

  /** Ferma la musica con una dissolvenza in uscita (music.fadeOut s). */
  stopMusic() {
    this.wantMusic = null;
    const m = this.music;
    if (!m) return;
    this.music = null;
    const t = this.ctx.currentTime;
    const fade = this.musicCfg.fadeOut ?? 0.8;
    m.gain.gain.cancelScheduledValues(t);
    m.gain.gain.setValueAtTime(m.gain.gain.value, t);
    m.gain.gain.linearRampToValueAtTime(0, t + fade);
    try {
      m.src.stop(t + fade + 0.05);
    } catch (e) {
      // già fermato
    }
  }

  /** Carica (una volta) e avvia il brano richiesto, se l'audio è attivo. */
  async _startMusic() {
    const id = this.wantMusic;
    const ctx = this.ctx;
    const def = this.musicCfg.tracks?.[id];
    if (!ctx || !id || !def?.src) return;
    if (!this.musicBuffers.has(id)) {
      this.musicBuffers.set(id, undefined); // in caricamento
      try {
        this.musicBuffers.set(id, await ctx.decodeAudioData(await loadArrayBuffer(def.src)));
      } catch (e) {
        this.musicBuffers.set(id, null);
        console.warn(`Music "${id}": "${def.src}" not loaded (${e.message})`);
      }
    }
    const buffer = this.musicBuffers.get(id);
    // ancora in caricamento (ci pensa la chiamata che lo sta caricando), cambiato brano, già in corso o audio fermo
    if (!buffer || this.wantMusic !== id || this.music || ctx.state !== 'running') return;
    const gain = ctx.createGain();
    const t = ctx.currentTime;
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(def.volume ?? 1, t + (this.musicCfg.fadeIn ?? 1.5));
    gain.connect(this.musicBus);
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    src.connect(gain);
    src.start();
    this.music = { id, src, gain };
  }

  /** I browser richiedono un gesto utente prima di riprodurre audio. */
  unlock() {
    const ctx = this.ctx;
    if (!ctx || ctx.state === 'running') return;
    // la musica richiesta prima del primo gesto parte appena il contesto si sblocca
    ctx.resume().then(() => this._startMusic()).catch(() => {});
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
   * owner (opzionale) = chi lo emette, per i suoni con variantMode "owner" (tiene sempre la stessa variante).
   */
  play(name, pos = null, owner = null) {
    const none = { stop() {} };
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running' || this.muted) return none;
    const def = this.defs[name];
    if (!def) return none;
    const gain = this.gainAt(pos);
    if (gain <= 0.01) return none;
    const vol = (def.volume ?? 1) * gain;
    const variant = this._variant(name, owner);
    let sources = [];
    if (variant) {
      const src = ctx.createBufferSource();
      src.buffer = variant.buffer;
      const j = def.pitchJitter ?? 0;
      if (j > 0) src.playbackRate.value = 1 + (Math.random() * 2 - 1) * j;
      const g = ctx.createGain();
      g.gain.value = vol * variant.volume;
      src.connect(g).connect(this.master);
      src.start();
      sources = [src];
      // copie in corso dello stesso suono: oltre maxVoices si ferma la più vecchia
      const live = this.voices.get(name) || [];
      live.push(src);
      src.onended = () => {
        const k = live.indexOf(src);
        if (k >= 0) live.splice(k, 1);
      };
      while (live.length > (def.maxVoices ?? 6)) {
        try {
          live.shift().stop();
        } catch (e) {
          // già terminata
        }
      }
      this.voices.set(name, live);
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

    const variant = this._variant(name); // suono continuo: una variante per tutta la durata
    const variantVol = variant?.volume ?? 1;
    if (variant) {
      const src = ctx.createBufferSource();
      src.buffer = variant.buffer;
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
        const vol = (def.volume ?? 1) * variantVol * self.gainAt(pos) * (idle + (1 - idle) * r);
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
