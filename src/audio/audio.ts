// Web Audio synthesis: ambient drone that changes by era, click pulse, chimes, bells, rumbles, temple choir.
export class Audio {
  ctx: AudioContext | null = null;
  master!: GainNode;
  music!: GainNode;
  sfx!: GainNode;
  private drone: { osc: OscillatorNode[]; gain: GainNode; filter: BiquadFilterNode } | null = null;
  private noiseBuf: AudioBuffer | null = null;
  private era = -1;
  private choir: { osc: OscillatorNode[]; gain: GainNode } | null = null;
  private hum: { osc: OscillatorNode[]; gain: GainNode; filter: BiquadFilterNode } | null = null;
  volumes = { music: 0.5, sfx: 0.7, muted: false };

  /** Must be called from a user gesture. */
  unlock(): void {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = (window.AudioContext || (window as any).webkitAudioContext) as typeof AudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.music = this.ctx.createGain();
    this.sfx = this.ctx.createGain();
    this.music.connect(this.master);
    this.sfx.connect(this.master);
    this.master.connect(this.ctx.destination);
    const len = this.ctx.sampleRate * 2;
    this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.applyVolumes();
    this.startDrone();
  }

  applyVolumes(): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(this.volumes.muted ? 0 : 1, t, 0.05);
    this.music.gain.setTargetAtTime(this.volumes.music * 0.5, t, 0.1);
    this.sfx.gain.setTargetAtTime(this.volumes.sfx * 0.6, t, 0.05);
  }

  private startDrone(): void {
    const c = this.ctx!;
    const gain = c.createGain();
    gain.gain.value = 0.0;
    const filter = c.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 400;
    filter.Q.value = 0.7;
    const osc: OscillatorNode[] = [];
    [55, 82.4, 110.3, 164.8].forEach((f, i) => {
      const o = c.createOscillator();
      o.type = i % 2 ? 'sine' : 'triangle';
      o.frequency.value = f;
      o.detune.value = (i - 1.5) * 6;
      const g = c.createGain();
      g.gain.value = 0.12 / (i + 1);
      o.connect(g).connect(filter);
      o.start();
      osc.push(o);
    });
    // slow wind: filtered noise
    const n = c.createBufferSource();
    n.buffer = this.noiseBuf;
    n.loop = true;
    const nf = c.createBiquadFilter();
    nf.type = 'bandpass';
    nf.frequency.value = 500;
    nf.Q.value = 0.6;
    const ng = c.createGain();
    ng.gain.value = 0.05;
    const lfo = c.createOscillator();
    lfo.frequency.value = 0.07;
    const lg = c.createGain();
    lg.gain.value = 300;
    lfo.connect(lg).connect(nf.frequency);
    lfo.start();
    n.connect(nf).connect(ng).connect(filter);
    n.start();
    filter.connect(gain).connect(this.music);
    gain.gain.setTargetAtTime(0.9, c.currentTime, 3);
    this.drone = { osc, gain, filter };
  }

  /** Change the drone's timbre by era: water and wind early, forest, then a warm fire hum. */
  setEra(era: number): void {
    if (!this.ctx || !this.drone || era === this.era) return;
    this.era = era;
    const t = this.ctx.currentTime;
    const roots = [55, 55, 49, 58.3, 61.7, 65.4, 73.4, 82.4];
    const r = roots[Math.min(era, roots.length - 1)];
    const ratios = era < 3 ? [1, 1.5, 2, 3] : era < 5 ? [1, 1.25, 1.5, 2] : [1, 1.2, 1.5, 2.4];
    this.drone.osc.forEach((o, i) => o.frequency.setTargetAtTime(r * ratios[i], t, 4));
    this.drone.filter.frequency.setTargetAtTime(300 + era * 120, t, 4);
  }

  private env(g: GainNode, t: number, a: number, peak: number, d: number): void {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
  }

  click(boost: number): void {
    if (!this.ctx) return;
    const c = this.ctx, t = c.currentTime;
    const o = c.createOscillator();
    o.type = 'sine';
    const f = 180 + boost * 40;
    o.frequency.setValueAtTime(f * 1.6, t);
    o.frequency.exponentialRampToValueAtTime(f, t + 0.12);
    const g = c.createGain();
    this.env(g, t, 0.005, 0.35, 0.25);
    o.connect(g).connect(this.sfx);
    o.start(t); o.stop(t + 0.3);
  }

  private bell(freq: number, vol: number, dur: number, cut = false): void {
    if (!this.ctx) return;
    const c = this.ctx, t = c.currentTime;
    [1, 2.76, 5.4].forEach((m, i) => {
      const o = c.createOscillator();
      o.type = 'sine';
      o.frequency.value = freq * m;
      const g = c.createGain();
      this.env(g, t, 0.004, vol / (i + 1), cut ? dur * 0.25 : dur / (i + 1));
      o.connect(g).connect(this.sfx);
      o.start(t); o.stop(t + dur + 0.1);
    });
  }

  chime(rock: string): void {
    // different notes for different rocks (pentatonic)
    const scale = [523.3, 587.3, 659.3, 784, 880, 1046.5, 1174.7];
    let h = 0;
    for (let i = 0; i < rock.length; i++) h = (h * 31 + rock.charCodeAt(i)) >>> 0;
    this.bell(scale[h % scale.length], 0.08, 0.6);
  }

  fossil(fragment: boolean): void { this.bell(1318.5, 0.18, 1.6, fragment); }

  rumble(dur = 1.5): void {
    if (!this.ctx || !this.noiseBuf) return;
    const c = this.ctx, t = c.currentTime;
    const n = c.createBufferSource();
    n.buffer = this.noiseBuf;
    const f = c.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = 90;
    const g = c.createGain();
    this.env(g, t, 0.1, 0.9, dur);
    n.connect(f).connect(g).connect(this.sfx);
    n.start(t); n.stop(t + dur + 0.2);
  }

  /** A geyser: a low thump and a hiss that rises and fades (level 0..1 by the size of the lens). */
  geyser(level: number): void {
    if (!this.ctx || !this.noiseBuf) return;
    const c = this.ctx, t = c.currentTime, dur = 1.4 + level * 1.6;
    const n = c.createBufferSource();
    n.buffer = this.noiseBuf; n.loop = true;
    const f = c.createBiquadFilter();
    f.type = 'bandpass'; f.Q.value = 0.8;
    f.frequency.setValueAtTime(900, t);
    f.frequency.exponentialRampToValueAtTime(2600, t + 0.4);
    f.frequency.exponentialRampToValueAtTime(1400, t + dur);
    const g = c.createGain();
    this.env(g, t, 0.08, 0.12 + 0.12 * level, dur);
    n.connect(f).connect(g).connect(this.sfx);
    n.start(t); n.stop(t + dur + 0.2);
    // the thump under it: quieter than a quake's rumble
    const m = c.createBufferSource();
    m.buffer = this.noiseBuf;
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 110;
    const mg = c.createGain();
    this.env(mg, t, 0.03, 0.25 + 0.25 * level, 0.5);
    m.connect(lp).connect(mg).connect(this.sfx);
    m.start(t); m.stop(t + 0.7);
  }

  whoosh(): void {
    if (!this.ctx || !this.noiseBuf) return;
    const c = this.ctx, t = c.currentTime;
    const n = c.createBufferSource();
    n.buffer = this.noiseBuf;
    const f = c.createBiquadFilter();
    f.type = 'bandpass'; f.Q.value = 2;
    f.frequency.setValueAtTime(300, t);
    f.frequency.exponentialRampToValueAtTime(1800, t + 0.6);
    const g = c.createGain();
    this.env(g, t, 0.05, 0.25, 0.6);
    n.connect(f).connect(g).connect(this.sfx);
    n.start(t); n.stop(t + 0.8);
  }

  /** A pile falls into the water, quietly: a «plop» (a sine falling in pitch, like a bubble closing), the hiss of
   *  the spray (noise through a high band) and a couple of small bubble blips after it. Every one a little
   *  different in pitch and loudness. m: how much hit the water (0..1). */
  splash(m: number): void {
    if (!this.ctx || !this.noiseBuf) return;
    const c = this.ctx, t = c.currentTime, r = () => Math.random();
    const vol = 0.05 + 0.05 * m;
    // the plop
    const o = c.createOscillator();
    o.type = 'sine';
    const f0 = 520 + r() * 260 - m * 120;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(f0 * (0.35 + r() * 0.1), t + 0.09 + r() * 0.04);
    const og = c.createGain();
    this.env(og, t, 0.004, vol * 1.4, 0.16 + r() * 0.06);
    o.connect(og).connect(this.sfx);
    o.start(t); o.stop(t + 0.3);
    // the spray
    const n = c.createBufferSource();
    n.buffer = this.noiseBuf;
    n.playbackRate.value = 0.8 + r() * 0.5;
    const f = c.createBiquadFilter();
    f.type = 'bandpass'; f.Q.value = 0.9;
    f.frequency.setValueAtTime(2400 + r() * 1200, t);
    f.frequency.exponentialRampToValueAtTime(900 + r() * 300, t + 0.3);
    const ng = c.createGain();
    this.env(ng, t + 0.01, 0.01, vol * 0.7, 0.22 + 0.12 * m);
    n.connect(f).connect(ng).connect(this.sfx);
    n.start(t, r() * 1.5); n.stop(t + 0.5);
    // bubbles: short rising blips a moment later
    const nb = 1 + Math.round(r() * (1 + 2 * m));
    for (let i = 0; i < nb; i++) {
      const tb = t + 0.08 + r() * 0.3;
      const b = c.createOscillator();
      b.type = 'sine';
      const fb = 700 + r() * 900;
      b.frequency.setValueAtTime(fb, tb);
      b.frequency.exponentialRampToValueAtTime(fb * (1.3 + r() * 0.4), tb + 0.03);
      const bg = c.createGain();
      this.env(bg, tb, 0.003, vol * (0.25 + r() * 0.3), 0.04 + r() * 0.03);
      b.connect(bg).connect(this.sfx);
      b.start(tb); b.stop(tb + 0.1);
    }
  }

  /** Choir pad for the finale; level follows the temple's growth. */
  choirLevel(level: number): void {
    if (!this.ctx) return;
    const c = this.ctx;
    if (!this.choir && level > 0) {
      const gain = c.createGain();
      gain.gain.value = 0;
      const osc: OscillatorNode[] = [];
      [220, 277.2, 329.6, 440, 554.4].forEach((fq, i) => {
        const o = c.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = fq;
        o.detune.value = (i - 2) * 7;
        const f = c.createBiquadFilter();
        f.type = 'lowpass'; f.frequency.value = 900;
        const g = c.createGain();
        g.gain.value = 0.04;
        o.connect(f).connect(g).connect(gain);
        o.start();
        osc.push(o);
      });
      gain.connect(this.music);
      this.choir = { osc, gain };
    }
    if (this.choir) this.choir.gain.gain.setTargetAtTime(level * 0.8, c.currentTime, 0.8);
  }

  /** Press: a low hum that grows while the finger holds the layers (level 0..1, rises in pitch). */
  pressHum(level: number): void {
    if (!this.ctx) return;
    const c = this.ctx;
    if (!this.hum && level > 0) {
      const gain = c.createGain();
      gain.gain.value = 0;
      const o1 = c.createOscillator(); o1.type = 'sawtooth'; o1.frequency.value = 46;
      const o2 = c.createOscillator(); o2.type = 'sine'; o2.frequency.value = 69;
      const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 160;
      o1.connect(f); o2.connect(f); f.connect(gain); gain.connect(this.sfx);
      o1.start(); o2.start();
      this.hum = { osc: [o1, o2], gain, filter: f };
    }
    if (!this.hum) return;
    const t = c.currentTime;
    this.hum.gain.gain.setTargetAtTime(level * 0.22, t, 0.15);
    this.hum.osc[0].frequency.setTargetAtTime(46 + level * 18, t, 0.4);
    this.hum.osc[1].frequency.setTargetAtTime(69 + level * 27, t, 0.4);
    this.hum.filter.frequency.setTargetAtTime(160 + level * 220, t, 0.3);
  }

  /** Grains on the move: a soft dry hiss whose level follows how many particles fall and slide (0..1). A little
   *  random flutter of the level makes it sound like grains, not like wind. Quiet: it sits under everything. */
  sand(level: number): void {
    if (!this.ctx || !this.noiseBuf) return;
    const c = this.ctx;
    if (!this.sandHiss && level > 0.01) {
      const n = c.createBufferSource();
      n.buffer = this.noiseBuf; n.loop = true;
      const hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 1400;
      const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 3200; bp.Q.value = 0.7;
      const gain = c.createGain(); gain.gain.value = 0;
      n.connect(hp).connect(bp).connect(gain).connect(this.sfx);
      n.start();
      this.sandHiss = { gain, filter: bp };
    }
    if (!this.sandHiss) return;
    const t = c.currentTime;
    const flutter = 0.7 + Math.random() * 0.6;
    this.sandHiss.gain.gain.setTargetAtTime(Math.min(1, level) * 0.05 * flutter, t, 0.06);
    this.sandHiss.filter.frequency.setTargetAtTime(2600 + Math.random() * 1400, t, 0.05);
  }
  private sandHiss: { gain: GainNode; filter: BiquadFilterNode } | null = null;

  /** The thing absorbed a line: a soft low pluck, a little brighter for a dear line (level 0..1). Very quiet and
   *  at most a few a second (the lines come one by one). */
  absorb(level: number): void {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    if (now - this.lastAbsorb < 0.18) return;
    this.lastAbsorb = now;
    this.tone(0, 110 + level * 110, 0.35, 0.025 + level * 0.03, 'triangle', 82 + level * 60);
  }
  private lastAbsorb = 0;

  /** A grain turned to rock: a tiny glassy tick, high and very quiet (the caller keeps it to a few a second). */
  tick(): void {
    if (!this.ctx) return;
    const notes = [1568, 1760, 2093, 2349.3, 2637];
    this.tone(0, notes[Math.floor(Math.random() * notes.length)], 0.18, 0.018, 'sine');
  }

  /** A reward picked up (rare event): a bright rising arpeggio. */
  reward(): void {
    if (!this.ctx) return;
    [659.3, 830.6, 987.8, 1318.5].forEach((fq, i) => this.tone(i * 0.07, fq, 0.5, 0.09, 'triangle'));
  }

  /** The burial window caught: a deep bell with a bright overtone. */
  burial(): void {
    if (!this.ctx) return;
    this.tone(0, 130.8, 2.2, 0.18, 'sine', 98);
    this.tone(0.02, 523.3, 1.2, 0.06, 'triangle');
  }

  // ---------- echo sounds: quiet, short, synthesized placeholders ----------
  private tone(at: number, freq: number, dur: number, vol: number, type: OscillatorType = 'sine', glideTo?: number): void {
    const c = this.ctx!, t = c.currentTime + at;
    const o = c.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (glideTo) o.frequency.exponentialRampToValueAtTime(glideTo, t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + Math.min(0.02, dur / 4));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.sfx);
    o.start(t); o.stop(t + dur + 0.05);
  }

  private hiss(at: number, dur: number, vol: number, type: BiquadFilterType, freq: number, q = 1, attack = 0.02, freqTo?: number): void {
    const c = this.ctx!, t = c.currentTime + at;
    const n = c.createBufferSource();
    n.buffer = this.noiseBuf;
    n.loop = true;
    const f = c.createBiquadFilter();
    f.type = type; f.frequency.setValueAtTime(freq, t); f.Q.value = q;
    if (freqTo) f.frequency.exponentialRampToValueAtTime(freqTo, t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    n.connect(f).connect(g).connect(this.sfx);
    n.start(t, Math.random()); n.stop(t + dur + 0.05);
  }

  echo(sound: string, level = 1): void {
    if (!this.ctx || !this.noiseBuf) return;
    const v = 0.12 * level;
    switch (sound) {
      case 'knock': this.tone(0, 140, 0.12, v * 1.5, 'sine', 90); this.tone(0.22, 140, 0.12, v * 1.3, 'sine', 90); break;
      case 'cityHum': this.hiss(0, 2.6, v * 0.8, 'lowpass', 220, 0.7, 0.8); this.tone(0, 60, 2.4, v * 0.3, 'sine'); break;
      case 'creak': this.tone(0, 320, 0.5, v * 0.4, 'sawtooth', 260); this.tone(0.9, 300, 0.45, v * 0.35, 'sawtooth', 340); break;
      case 'wings': for (let i = 0; i < 10; i++) this.hiss(i * 0.07, 0.06, v * 0.8, 'bandpass', 900, 1.2, 0.01); break;
      case 'spoon': this.tone(0, 2400, 0.35, v * 0.5); this.tone(0.18, 2600, 0.3, v * 0.4); this.tone(0.34, 2500, 0.4, v * 0.35); break;
      case 'tramBell': this.tone(0, 1180, 0.7, v * 0.6, 'triangle'); this.tone(0.3, 1180, 0.8, v * 0.5, 'triangle'); break;
      case 'bark': this.tone(0, 520, 0.12, v * 0.7, 'square', 280); this.tone(0.2, 540, 0.12, v * 0.6, 'square', 300); break;
      case 'drops': for (let i = 0; i < 4; i++) this.tone(i * 0.31 + Math.random() * 0.1, 1400 + Math.random() * 600, 0.12, v * 0.5, 'sine', 600); break;
      case 'radioBeep': for (let i = 0; i < 3; i++) this.tone(i * 0.45, 1760, 0.12, v * 0.35); this.hiss(0, 1.5, v * 0.15, 'bandpass', 3000, 2, 0.1); break;
      case 'inhale': this.hiss(0, 1.4, v * 0.9, 'bandpass', 600, 0.8, 0.9, 1400); break;
      case 'chalk': for (let i = 0; i < 3; i++) this.hiss(i * 0.35, 0.22, v * 0.6, 'highpass', 3500, 1, 0.03); break;
      case 'static': this.hiss(0, 1.2, v * 0.5, 'bandpass', 2500, 0.5, 0.02); break;
      case 'wind': this.hiss(0, 2.8, v * 0.9, 'bandpass', 400, 0.9, 1.0, 700); break;
      case 'farChime': this.tone(0.3, 880, 2.6, v * 0.35, 'sine'); this.tone(0.3, 2420, 1.2, v * 0.1, 'sine'); break;
      case 'curtainWind': this.hiss(0, 2.4, v * 0.7, 'lowpass', 900, 0.5, 0.9); break;
      case 'farLaugh': for (let i = 0; i < 5; i++) this.tone(0.2 + i * 0.16, 620 + (i % 2) * 90, 0.12, v * 0.15, 'triangle', 540); break;
      case 'glassClink': this.tone(0, 3100, 0.6, v * 0.45); this.tone(0.05, 3500, 0.55, v * 0.4); break;
      case 'shortInhale': this.hiss(0, 0.45, v * 0.9, 'bandpass', 800, 0.8, 0.3, 1600); break;
      case 'shutter': this.hiss(0, 0.05, v * 1.2, 'highpass', 2000, 1, 0.003); this.hiss(0.09, 0.05, v * 1.0, 'highpass', 1600, 1, 0.003); break;
      case 'drip': this.tone(0.2, 1500, 0.15, v * 0.6, 'sine', 700); this.tone(1.3, 1500, 0.15, v * 0.55, 'sine', 700); break;
      case 'intercom': this.tone(0, 880, 0.18, v * 0.4, 'square'); this.tone(0.25, 880, 0.18, v * 0.4, 'square'); break;
      case 'steps': for (let i = 0; i < 4; i++) this.tone(i * 0.42, 110, 0.1, v * 1.1, 'sine', 70); break;
      case 'childVoices': for (let i = 0; i < 6; i++) this.tone(0.1 + i * 0.22, 700 + Math.random() * 300, 0.16, v * 0.12, 'triangle', 900); break;
      case 'lockTurn': this.hiss(0, 0.04, v * 1.2, 'highpass', 1800, 1, 0.003); this.hiss(0.18, 0.06, v, 'bandpass', 1200, 2, 0.003); this.tone(0.3, 260, 0.4, v * 0.2, 'sawtooth', 200); break;
      case 'compHum': this.tone(0, 120, 2.6, v * 0.25, 'sine'); this.tone(0, 240, 2.6, v * 0.08, 'sine'); this.hiss(0, 2.6, v * 0.25, 'lowpass', 500, 0.5, 0.6); break;
      case 'streetNoise': this.hiss(0, 2.6, v * 0.7, 'lowpass', 600, 0.5, 0.8); this.tone(1.2, 440, 0.3, v * 0.12, 'square'); break;
      case 'clockTick': for (let i = 0; i < 5; i++) this.hiss(i * 0.5, 0.025, v * 1.2, 'highpass', 3000, 1, 0.002); break;
      case 'silence': default: break;
    }
  }
}

export const audio = new Audio();
