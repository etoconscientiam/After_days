/**
 * The intro's sound, all synthesised (no files): what each picture would sound like — the river, the wind,
 * a fire, the wheel, the arc, a hammer — under a quiet held chord that turns from warm to cold with the acts.
 * Layers fade between pictures; the arc follows the flicker on screen.
 */

type Layer = 'water' | 'wind' | 'fire' | 'arc' | 'hum' | 'pad';
type Scene = Partial<Record<Layer, number>> & { creak?: boolean; hammer?: boolean; arcBurst?: boolean };

/** Per picture (by image name): how loud each layer is, and what else happens in it. */
const SCENES: Record<string, Scene> = {
  '00_city': { water: 0.5, fire: 0.22, wind: 0.08, pad: 0.55 },
  '01_boots': { water: 0.8, fire: 0.1, pad: 0.45 },
  '02_dynamo': { water: 0.65, hum: 0.35, pad: 0.45, creak: true },
  '03_arc': { arc: 1, hum: 0.55, water: 0.25, pad: 0.3 },
  '03b_eyes': { arc: 0.8, hum: 0.4, pad: 0.55 },
  '04_box': { arc: 0.45, fire: 0.18, hum: 0.3, pad: 0.35, hammer: true, arcBurst: true },
  '05_cough': { fire: 0.4, wind: 0.1, pad: 0.3 },
  '06_window': { wind: 0.6, pad: 0.4 },
  '07_street': { wind: 0.85, pad: 0.35 },
  '08_nails': { wind: 0.35, pad: 0.3 },
  '09_ignite': { wind: 0.2, pad: 0.25, arc: 1 },
};
/** The held chord of each act (Hz): warm, then lower, then a cold minor. */
const CHORDS = [
  [110, 164.8, 220, 277.2],
  [98, 146.8, 196, 246.9],
  [87.3, 130.8, 174.6, 207.7],
];
const PEAK: Record<Layer, number> = { water: 0.16, wind: 0.11, fire: 0.09, arc: 0.12, hum: 0.05, pad: 0.035 };

export class IntroSound {
  private out: GainNode;
  private g = {} as Record<Layer, GainNode>;
  private target = {} as Record<Layer, number>;
  private windF: BiquadFilterNode;
  private arcF: BiquadFilterNode;
  private pad: OscillatorNode[] = [];
  private scene: Scene = {};
  private creakT = 0;
  private hammerT = 1;
  private burstT = 2;
  private crackT = 0;
  private t = 0;
  private arcOn = true;
  private noise: AudioBuffer;
  private brown: AudioBuffer;

  constructor(private ac: AudioContext, volume: number) {
    this.out = ac.createGain();
    this.out.gain.value = volume;
    this.out.connect(ac.destination);
    this.noise = this.makeNoise(2, false);
    this.brown = this.makeNoise(4, true);
    const layer = (k: Layer) => {
      const g = ac.createGain();
      g.gain.value = 0;
      g.connect(this.out);
      this.g[k] = g;
      this.target[k] = 0;
      return g;
    };
    // River: brown noise, low and wide.
    const wf = ac.createBiquadFilter();
    wf.type = 'lowpass';
    wf.frequency.value = 520;
    this.loop(this.brown, 0.8).connect(wf).connect(layer('water'));
    // Wind: white noise through a band that wanders.
    this.windF = ac.createBiquadFilter();
    this.windF.type = 'bandpass';
    this.windF.frequency.value = 600;
    this.windF.Q.value = 1.4;
    this.loop(this.noise, 0.5).connect(this.windF).connect(layer('wind'));
    // Fire: a soft roar (clicks come as one-shots).
    const ff = ac.createBiquadFilter();
    ff.type = 'lowpass';
    ff.frequency.value = 900;
    this.loop(this.brown, 1.3).connect(ff).connect(layer('fire'));
    // Arc: a dense sizzle.
    this.arcF = ac.createBiquadFilter();
    this.arcF.type = 'bandpass';
    this.arcF.frequency.value = 2600;
    this.arcF.Q.value = 0.9;
    this.loop(this.noise, 1).connect(this.arcF).connect(layer('arc'));
    // Dynamo hum.
    const hum = layer('hum');
    for (const f of [50, 100.4]) {
      const o = ac.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = f;
      const lp = ac.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 260;
      o.connect(lp).connect(hum);
      o.start();
    }
    // The chord: soft triangles through a low filter, a little detuned.
    const padG = layer('pad');
    const pf = ac.createBiquadFilter();
    pf.type = 'lowpass';
    pf.frequency.value = 700;
    pf.connect(padG);
    for (let i = 0; i < 4; i++) {
      const o = ac.createOscillator();
      o.type = 'triangle';
      o.frequency.value = CHORDS[0][i];
      o.detune.value = (i - 1.5) * 4;
      o.connect(pf);
      o.start();
      this.pad.push(o);
    }
  }

  /** A new picture: its layers fade in, the chord moves to its act's. */
  setScene(image: string, act: number): void {
    this.scene = SCENES[image] ?? {};
    for (const k of Object.keys(this.target) as Layer[]) this.target[k] = (this.scene[k] ?? 0) * PEAK[k];
    const ch = CHORDS[Math.min(CHORDS.length - 1, act)];
    const now = this.ac.currentTime;
    this.pad.forEach((o, i) => o.frequency.setTargetAtTime(ch[i], now, 1.2));
  }

  /** Whether the arc on screen is burning (the last picture's arc waits for the strike). */
  setArc(on: boolean): void {
    this.arcOn = on;
  }

  /** Every frame: layers glide to their levels, the arc follows the flicker, the scene's one-shots come. */
  update(dt: number, arcLevel: number, fade: number): void {
    const now = this.ac.currentTime;
    this.t += dt;
    for (const k of Object.keys(this.target) as Layer[]) {
      let v = this.target[k] * fade;
      if (k === 'arc') v *= this.arcOn ? 0.35 + 0.65 * Math.max(0, arcLevel) : 0;
      this.g[k].gain.setTargetAtTime(v, now, k === 'arc' ? 0.02 : 0.5);
    }
    const gust = 0.5 + 0.5 * Math.sin(this.t * 0.41) * Math.sin(this.t * 0.17 + 1);
    this.windF.frequency.setTargetAtTime(380 + 520 * gust, now, 0.3);
    this.arcF.frequency.setTargetAtTime(2200 + 1400 * Math.random(), now, 0.01);
    if (fade < 0.2) return;
    const sc = this.scene;
    if ((sc.fire ?? 0) > 0) {
      this.crackT -= dt;
      if (this.crackT <= 0) {
        this.crackT = 0.05 + Math.random() * 0.35;
        this.click(1800 + Math.random() * 2500, 0.02 + Math.random() * 0.05 * (sc.fire ?? 0) * 2);
      }
    }
    if (sc.creak) {
      this.creakT -= dt;
      if (this.creakT <= 0) {
        this.creakT = 1.7 + Math.random() * 0.4;
        this.creak();
      }
    }
    if (sc.hammer) {
      this.hammerT -= dt;
      if (this.hammerT <= 0) {
        this.hammerT = Math.random() < 0.3 ? 0.32 : 1.4 + Math.random() * 1.6;
        this.ring(2100 + Math.random() * 400, 0.05);
      }
    }
    if (sc.arcBurst) {
      this.burstT -= dt;
      if (this.burstT <= 0) {
        this.burstT = 2 + Math.random() * 3;
        this.click(4200, 0.07);
      }
    }
  }

  /** The strike: a crack and a thump, the arc catching. */
  ignite(): void {
    this.click(3800, 0.3);
    this.thump(70, 0.35, 0.35);
    this.setArc(true);
  }

  /** The cough: two low, rough breaths. */
  cough(): void {
    const one = (d: number, f: number) => setTimeout(() => this.noiseHit(f, 0.12, 0.14), d);
    one(0, 420);
    one(240, 360);
  }

  /** Everything down, then off. */
  stop(sec = 0.6): void {
    const now = this.ac.currentTime;
    this.out.gain.setTargetAtTime(0, now, sec / 3);
  }

  // ------------------------------------------------------------------ voices

  private makeNoise(sec: number, brown: boolean): AudioBuffer {
    const n = Math.floor(this.ac.sampleRate * sec);
    const b = this.ac.createBuffer(1, n, this.ac.sampleRate);
    const d = b.getChannelData(0);
    let last = 0;
    for (let i = 0; i < n; i++) {
      const w = Math.random() * 2 - 1;
      if (brown) {
        last = (last + 0.02 * w) / 1.02;
        d[i] = last * 3.5;
      } else d[i] = w;
    }
    return b;
  }

  private loop(buf: AudioBuffer, rate: number): AudioBufferSourceNode {
    const s = this.ac.createBufferSource();
    s.buffer = buf;
    s.loop = true;
    s.playbackRate.value = rate;
    s.start(0, Math.random() * buf.duration);
    return s;
  }

  private noiseHit(freq: number, peak: number, dur: number, type: BiquadFilterType = 'bandpass', q = 1): void {
    const ac = this.ac, now = ac.currentTime;
    const s = ac.createBufferSource();
    s.buffer = this.noise;
    const f = ac.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ac.createGain();
    g.gain.setValueAtTime(peak, now);
    g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    s.connect(f).connect(g).connect(this.out);
    s.start(now, Math.random());
    s.stop(now + dur + 0.02);
  }

  private click(freq: number, peak: number): void {
    this.noiseHit(freq, peak, 0.015 + Math.random() * 0.02, 'highpass', 0.7);
  }

  private thump(freq: number, peak: number, dur: number): void {
    const ac = this.ac, now = ac.currentTime;
    const o = ac.createOscillator(), g = ac.createGain();
    o.frequency.setValueAtTime(freq * 1.6, now);
    o.frequency.exponentialRampToValueAtTime(freq, now + dur * 0.5);
    g.gain.setValueAtTime(peak, now);
    g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    o.connect(g).connect(this.out);
    o.start(now);
    o.stop(now + dur + 0.02);
  }

  /** Iron struck: a short bright ring with a hard edge. */
  private ring(freq: number, peak: number): void {
    const ac = this.ac, now = ac.currentTime;
    for (const [m, p] of [[1, 1], [2.76, 0.4]] as const) {
      const o = ac.createOscillator(), g = ac.createGain();
      o.type = 'sine';
      o.frequency.value = freq * m;
      g.gain.setValueAtTime(peak * p, now);
      g.gain.exponentialRampToValueAtTime(0.0001, now + 0.35);
      o.connect(g).connect(this.out);
      o.start(now);
      o.stop(now + 0.4);
    }
    this.click(5000, peak * 1.5);
  }

  /** The wheel's wooden axle: a groan that slides in pitch, then the paddles slap the water. */
  private creak(): void {
    const ac = this.ac, now = ac.currentTime;
    const o = ac.createOscillator(), f = ac.createBiquadFilter(), g = ac.createGain();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(170, now);
    o.frequency.linearRampToValueAtTime(120 + Math.random() * 30, now + 0.5);
    f.type = 'bandpass';
    f.frequency.value = 700;
    f.Q.value = 4;
    g.gain.setValueAtTime(0.0001, now);
    g.gain.linearRampToValueAtTime(0.025, now + 0.15);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.6);
    o.connect(f).connect(g).connect(this.out);
    o.start(now);
    o.stop(now + 0.65);
    setTimeout(() => this.noiseHit(380, 0.08, 0.12, 'lowpass'), 650);
  }
}
