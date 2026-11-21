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
