import type { Game } from '../sim/game';
import { BALANCE } from '../data/balance';
import { Rng } from '../core/rng';

/**
 * All sound is synthesised with Web Audio: no files. Continuous voices (arc, dynamo, water, wind) follow sim
 * state every frame; one-shots answer sim events.
 *
 * The arc is the main cue. A good arc is a dense, even sizzle like bacon frying; a long arc crackles and spits;
 * a short arc buzzes and sticks; a weak current sputters.
 */
export class Sound {
  ctx!: AudioContext;
  private master!: GainNode;
  private rng = new Rng(31337);
  private noise!: AudioBuffer;
  private brown!: AudioBuffer;
  private sizzleBuf!: AudioBuffer;
  private crackleBuf!: AudioBuffer;
  private arc!: { sizzle: GainNode; sizF: BiquadFilterNode; crackle: GainNode; buzz: GainNode; buzzO: OscillatorNode; rumble: GainNode; out: GainNode };
  private app!: { out: GainNode };
  private hum!: { o1: OscillatorNode; o2: OscillatorNode; g: GainNode; f: BiquadFilterNode };
  private water!: GainNode;
  private wind!: { g: GainNode; f: BiquadFilterNode };
  private paddleT = 0;
  private ok = false;
  private howlBus!: GainNode;

  /** Must be called from a user gesture. */
  init(game: Game): void {
    if (this.ok) return;
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.ctx = new AC();
    const c = this.ctx;
    const comp = c.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    this.master = c.createGain();
    this.master.gain.value = 0.8;
    this.master.connect(comp).connect(c.destination);

    this.noise = this.makeNoise(2, 'white');
    this.brown = this.makeNoise(4, 'brown');
    this.sizzleBuf = this.makeSizzle(2);
    this.crackleBuf = this.makeCrackle(2);

    // --- Arc voice.
    const out = c.createGain();
    out.gain.value = 0;
    out.connect(this.master);
    const sizzle = c.createGain();
    const sizF = c.createBiquadFilter();
    sizF.type = 'highpass';
    sizF.frequency.value = 1800;
    const sizPeak = c.createBiquadFilter();
    sizPeak.type = 'peaking';
    sizPeak.frequency.value = 5200;
    sizPeak.gain.value = 6;
    this.loop(this.sizzleBuf).connect(sizF).connect(sizPeak).connect(sizzle).connect(out);
    const crackle = c.createGain();
    const crF = c.createBiquadFilter();
    crF.type = 'bandpass';
    crF.frequency.value = 2200;
    crF.Q.value = 0.6;
    this.loop(this.crackleBuf).connect(crF).connect(crackle).connect(out);
    const buzz = c.createGain();
    const buzzO = c.createOscillator();
    buzzO.type = 'sawtooth';
    buzzO.frequency.value = 100;
    const shaper = c.createWaveShaper();
    shaper.curve = this.fuzz();
    const bF = c.createBiquadFilter();
    bF.type = 'lowpass';
    bF.frequency.value = 900;
    buzzO.connect(shaper).connect(bF).connect(buzz).connect(out);
    buzzO.start();
    const rumble = c.createGain();
    const rF = c.createBiquadFilter();
    rF.type = 'lowpass';
    rF.frequency.value = 260;
    this.loop(this.brown).connect(rF).connect(rumble).connect(out);
    sizzle.gain.value = crackle.gain.value = buzz.gain.value = rumble.gain.value = 0;
    this.arc = { sizzle, sizF, crackle, buzz, buzzO, rumble, out };

    // --- Apprentice's arc, muffled across the room.
    const aOut = c.createGain();
    aOut.gain.value = 0;
    const aF = c.createBiquadFilter();
    aF.type = 'lowpass';
    aF.frequency.value = 2600;
    const aP = c.createStereoPanner();
    aP.pan.value = -0.6;
    this.loop(this.sizzleBuf, 0.7).connect(aF).connect(aOut).connect(aP).connect(this.master);
    this.app = { out: aOut };

    // --- Dynamo hum: pitch follows the wheel.
    const hg = c.createGain();
    hg.gain.value = 0.0;
    const hf = c.createBiquadFilter();
    hf.type = 'lowpass';
    hf.frequency.value = 320;
    const o1 = c.createOscillator();
    o1.type = 'sawtooth';
    const o2 = c.createOscillator();
    o2.type = 'sine';
    o1.connect(hf);
    o2.connect(hf);
    hf.connect(hg).connect(this.master);
    o1.start();
    o2.start();
    this.hum = { o1, o2, g: hg, f: hf };

    // --- River and wind outside.
    const wg = c.createGain();
    wg.gain.value = 0.05;
    const wf = c.createBiquadFilter();
    wf.type = 'lowpass';
    wf.frequency.value = 520;
    this.loop(this.brown, 0.9).connect(wf).connect(wg).connect(this.master);
    this.water = wg;
    const ng = c.createGain();
    ng.gain.value = 0.02;
    const nf = c.createBiquadFilter();
    nf.type = 'bandpass';
    nf.frequency.value = 600;
    nf.Q.value = 0.8;
    this.loop(this.noise, 0.5).connect(nf).connect(ng).connect(this.master);
    this.wind = { g: ng, f: nf };

    // Howls go through a long echo, as if off the city wall.
    this.howlBus = c.createGain();
    const delay = c.createDelay(1);
    delay.delayTime.value = 0.38;
    const fb = c.createGain();
    fb.gain.value = 0.38;
    const dF = c.createBiquadFilter();
    dF.type = 'lowpass';
    dF.frequency.value = 1200;
    this.howlBus.connect(this.master);
    this.howlBus.connect(delay);
    delay.connect(dF).connect(fb).connect(delay);
    dF.connect(this.master);

    this.ok = true;
    this.bind(game);
  }

  resume(): void {
    if (this.ok && this.ctx.state !== 'running') void this.ctx.resume();
  }

  // ------------------------------------------------------------- buffers

  private makeNoise(sec: number, kind: 'white' | 'brown'): AudioBuffer {
    const c = this.ctx;
    const b = c.createBuffer(1, c.sampleRate * sec, c.sampleRate);
    const d = b.getChannelData(0);
    let last = 0;
    for (let i = 0; i < d.length; i++) {
      const w = this.rng.signed();
      if (kind === 'white') d[i] = w;
      else {
        last = (last + 0.02 * w) / 1.02;
        d[i] = last * 3.5;
      }
    }
    return b;
  }

  /** Bacon: a soft hiss carrying a dense rain of tiny pops. */
  private makeSizzle(sec: number): AudioBuffer {
    const c = this.ctx;
    const sr = c.sampleRate;
    const b = c.createBuffer(1, sr * sec, sr);
    const d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = this.rng.signed() * 0.18;
    const rate = 1100;
    let t = 0;
    while (t < d.length) {
      t += Math.floor((-Math.log(1 - this.rng.next()) / rate) * sr);
      const amp = 0.25 + this.rng.next() * 0.75;
      const len = Math.floor(sr * (0.0002 + this.rng.next() * 0.0006));
      const sgn = this.rng.next() < 0.5 ? -1 : 1;
      for (let k = 0; k < len && t + k < d.length; k++) d[t + k] += sgn * amp * Math.exp(-k / (len * 0.3)) * (k % 2 ? -1 : 1);
    }
    return b;
  }

  /** A long arc: sparse sharp cracks and spits with ringing tails. */
  private makeCrackle(sec: number): AudioBuffer {
    const c = this.ctx;
    const sr = c.sampleRate;
    const b = c.createBuffer(1, sr * sec, sr);
    const d = b.getChannelData(0);
    const rate = 38;
    let t = 0;
    while (t < d.length) {
      t += Math.floor((-Math.log(1 - this.rng.next()) / rate) * sr);
      const amp = 0.4 + this.rng.next() * 0.6;
      const len = Math.floor(sr * (0.002 + this.rng.next() * 0.01));
      for (let k = 0; k < len && t + k < d.length; k++) d[t + k] += this.rng.signed() * amp * Math.exp(-k / (len * 0.25));
    }
    return b;
  }

  private fuzz(): Float32Array<ArrayBuffer> {
    const n = 256;
    const f = new Float32Array(new ArrayBuffer(n * 4));
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * 2 - 1;
      f[i] = Math.tanh(x * 4);
    }
    return f;
  }

  private loop(buf: AudioBuffer, rate = 1): AudioBufferSourceNode {
    const s = this.ctx.createBufferSource();
    s.buffer = buf;
    s.loop = true;
    s.playbackRate.value = rate;
    s.loopStart = 0;
    s.start(0, this.rng.next() * buf.duration);
    return s;
  }

  // ------------------------------------------------------------- per frame

  update(g: Game): void {
    if (!this.ok) return;
    const c = this.ctx;
    const now = c.currentTime;
    const set = (p: AudioParam, v: number, tc = 0.03) => p.setTargetAtTime(v, now, tc);
    const a = g.player.arc;
    const A = BALANCE.arc;

    if (a.lit) {
      const L = a.L;
      const good = Math.exp(-Math.pow((L - A.idealL) / 1.1, 2));
      const long = Math.min(1, Math.max(0, (L - A.goodHi + 0.3) / 2));
      const short = Math.min(1, Math.max(0, (A.goodLo + 0.3 - L) / 0.9));
      const vI = g.idealSpeed(g.player);
      const vr = a.onSeam ? a.v / Math.max(1, vI) : 1;
      const slow = Math.min(1, Math.max(0, (0.6 - vr) / 0.4));
      const fast = Math.min(1, Math.max(0, (vr - 1.4) / 0.8));
      const pop = a.unstable > 0 && this.rng.chance(a.unstable * 0.4) ? 0.15 : 1;
      set(this.arc.out.gain, 0.9 * pop, 0.01);
      set(this.arc.sizzle.gain, (0.25 + 0.55 * good) * (1 - 0.5 * long) * (1 - 0.4 * fast));
      set(this.arc.sizF.frequency, 1500 + 1600 * fast - 500 * slow);
      set(this.arc.crackle.gain, long * 1.3 + a.unstable * 0.7);
      set(this.arc.buzz.gain, short * 0.08);
      set(this.arc.rumble.gain, slow * 0.5 + Math.max(0, a.pool - 2) * 0.4);
      set(this.arc.buzzO.frequency, 80 + g.power.wheel * 40);
    } else if (g.player.arc.stuck) {
      set(this.arc.out.gain, 0.6, 0.01);
      set(this.arc.sizzle.gain, 0);
      set(this.arc.crackle.gain, 0);
      set(this.arc.rumble.gain, 0);
      set(this.arc.buzz.gain, 0.14);
    } else set(this.arc.out.gain, 0, 0.02);

    set(this.app.out.gain, g.app.arc.lit ? 0.12 : 0, 0.02);

    const w = g.power.wheel;
    const I = g.power.I;
    set(this.hum.o1.frequency, 38 + 26 * w * Math.min(1.4, I), 0.1);
    set(this.hum.o2.frequency, 76 + 52 * w * Math.min(1.4, I), 0.1);
    set(this.hum.g.gain, 0.018 + (a.lit ? 0.02 : 0) + (g.owned.wheel2 ? 0.01 : 0), 0.2);
    set(this.water.gain, 0.035 + 0.02 * w, 0.5);
    const gust = 0.5 + 0.5 * Math.sin(now * 0.37) * Math.sin(now * 0.13 + 1);
    set(this.wind.g.gain, (0.006 + 0.03 * g.clock.snow) * (0.4 + 0.8 * gust), 0.4);
    set(this.wind.f.frequency, 420 + 260 * gust, 0.4);

    // Paddles slap the water at a rate that follows the wheel.
    if (g.started) {
      this.paddleT -= 1 / 60;
      if (this.paddleT <= 0) {
        this.paddleT = (Math.PI * 2) / (Math.max(0.2, w) * 0.9) / 8;
        this.thump(140, 0.012, 0.06);
      }
    }
  }

  // ------------------------------------------------------------- one-shots

  /** A footstep on stone flags. */
  step(): void {
    if (!this.ok) return;
    this.burst(220 + this.rng.next() * 80, 0.8, 0.09, 0.07, 'lowpass');
    this.tone(70 + this.rng.next() * 15, 0.05, 0.06, 'sine', 0.6);
  }

  private env(g: GainNode, peak: number, a: number, d: number): void {
    const t = this.ctx.currentTime;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
  }

  private burst(freq: number, q: number, peak: number, dur: number, type: BiquadFilterType = 'bandpass', pan = 0): void {
    const c = this.ctx;
    const s = c.createBufferSource();
    s.buffer = this.noise;
    const f = c.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = c.createGain();
    const p = c.createStereoPanner();
    p.pan.value = pan;
    s.connect(f).connect(g).connect(p).connect(this.master);
    this.env(g, peak, 0.002, dur);
    s.start(0, this.rng.next());
    s.stop(c.currentTime + dur + 0.05);
  }

  private tone(freq: number, peak: number, dur: number, type: OscillatorType = 'sine', glide = 0, delay = 0): void {
    const c = this.ctx;
    const o = c.createOscillator();
    o.type = type;
    const t = c.currentTime + delay;
    o.frequency.setValueAtTime(freq, t);
    if (glide) o.frequency.exponentialRampToValueAtTime(freq * glide, t + dur);
    const g = c.createGain();
    o.connect(g).connect(this.master);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + 0.003);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  private thump(freq: number, peak: number, dur: number): void {
    this.tone(freq, peak, dur, 'sine', 0.5);
    this.burst(300, 0.7, peak * 0.8, dur, 'lowpass');
  }

  private howl(pan: number, pitch: number): void {
    const c = this.ctx;
    const t = c.currentTime;
    const o = c.createOscillator();
    o.type = 'triangle';
    const base = 230 * pitch;
    o.frequency.setValueAtTime(base, t);
    o.frequency.linearRampToValueAtTime(base * 1.6, t + 0.9);
    o.frequency.linearRampToValueAtTime(base * 1.45, t + 2.0);
    o.frequency.linearRampToValueAtTime(base * 1.05, t + 3.0);
    const vib = c.createOscillator();
    vib.frequency.value = 5.5;
    const vg = c.createGain();
    vg.gain.value = base * 0.025;
    vib.connect(vg).connect(o.frequency);
    // A second voice slightly off, so it sounds like a throat and not a whistle.
    const o2 = c.createOscillator();
    o2.type = 'sawtooth';
    o2.frequency.setValueAtTime(base * 1.01, t);
    o2.frequency.linearRampToValueAtTime(base * 1.62, t + 0.95);
    o2.frequency.linearRampToValueAtTime(base * 1.02, t + 3.0);
    const f = c.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 700;
    f.Q.value = 1.4;
    const g = c.createGain();
    const p = c.createStereoPanner();
    p.pan.value = pan;
    o.connect(f);
    o2.connect(f);
    f.connect(g).connect(p).connect(this.howlBus);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.05, t + 0.6);
    g.gain.linearRampToValueAtTime(0.04, t + 2.2);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 3.2);
    for (const x of [o, o2, vib]) {
      x.start(t);
      x.stop(t + 3.3);
    }
  }

  private bind(g: Game): void {
    const b = g.bus;
    b.on('arcStrike', (e) => {
      if (e.bench !== 'player') return;
      this.burst(3500, 0.8, 0.35, 0.05, 'highpass');
      this.tone(1800, 0.05, 0.03, 'square');
    });
    b.on('arcOut', (e) => {
      if (e.bench !== 'player') return;
      if (e.reason === 'long') this.burst(1400, 1.2, 0.3, 0.06);
      if (e.reason === 'power') this.burst(900, 1, 0.18, 0.04);
    });
    b.on('arcStick', (e) => {
      if (e.bench === 'player') this.thump(90, 0.25, 0.12);
    });
    b.on('arcUnstick', (e) => {
      if (e.bench === 'player') this.tone(2400, 0.06, 0.08, 'triangle');
    });
    b.on('burnThrough', (e) => {
      if (e.bench !== 'player') return;
      this.burst(700, 0.6, 0.35, 0.25, 'lowpass');
      this.burst(4000, 0.5, 0.2, 0.3, 'highpass');
    });
    b.on('slagChip', (e) => {
      if (e.bench !== 'player') return;
      this.burst(2600 + this.rng.next() * 900, 1.5, 0.45, 0.04);
      this.tone(3100 + this.rng.next() * 500, 0.06, 0.12, 'triangle');
      this.burst(5200, 0.7, 0.12, 0.09 + Math.min(0.2, e.amount * 0.01), 'highpass');
    });
    b.on('hammerMiss', (e) => {
      if (e.bench !== 'player') return;
      this.tone(2200 + this.rng.next() * 300, 0.08, 0.2, 'triangle');
      this.burst(2000, 2, 0.2, 0.03);
    });
    b.on('electrodeSwap', (e) => {
      if (e.bench !== 'player') return;
      this.tone(2700, 0.05, 0.08, 'triangle');
      this.tone(3100, 0.04, 0.08, 'triangle', 0, 0.35);
    });
    b.on('electrodeEmpty', (e) => {
      if (e.bench === 'player') this.burst(1200, 1, 0.12, 0.05);
    });
    b.on('orderTaken', (e) => {
      if (e.bench === 'player') this.thump(70, 0.35, 0.18);
    });
    b.on('handedOver', (e) => {
      const pan = e.bench === 'player' ? 0.3 : -0.6;
      void pan;
      this.tone(1318, 0.08, 0.22);
      this.tone(1975, 0.07, 0.3, 'sine', 0, 0.08);
    });
    b.on('revealed', (e) => {
      if (e.bench !== 'player') return;
      const good = e.grade === 'clean' ? [880, 1318] : e.grade === 'fair' ? [784, 988] : [392, 370];
      this.tone(good[0], 0.05, 0.5, 'triangle');
      this.tone(good[1], 0.04, 0.6, 'triangle', 0, 0.1);
    });
    b.on('bought', () => {
      this.thump(110, 0.25, 0.1);
      this.tone(1046, 0.05, 0.35, 'triangle', 0, 0.05);
    });
    b.on('mask', (e) => {
      this.burst(e.down ? 380 : 520, 0.7, 0.18, 0.1, 'lowpass');
      this.tone(e.down ? 180 : 240, 0.06, 0.05, 'square');
    });
    b.on('powerDip', (e) => {
      if (g.player.arc.lit) this.burst(1600, 1, Math.min(0.2, e.depth * 0.6), 0.12);
    });
    b.on('howl', (e) => this.howl(e.pan, e.pitch));
    b.on('beat', () => this.tone(523, 0.03, 0.8, 'triangle'));
  }
}
