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
}

export const audio = new Audio();
