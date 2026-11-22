// Turmoil: special events weather the lettering of the whole interface. Every text face switches to its worn
// level (Strata Pixel Worn 1..4 / Strata Stone Worn 1..4 — same widths and kerning, so nothing reflows), and the
// more catastrophic the event, the higher the level and the longer it holds. At the peak the letters "boil"
// (flicker between neighbouring levels) and, for the worst events, tremble by a pixel. Then the stone settles.
import { MAX_WEAR } from './wear';

/** How hard each event shakes the letters (0..4). */
export const SEVERITY = {
  element: { meteor: 4, volcano: 3, magma: 3, earthquake: 2, glacier: 2, flood: 1, drought: 1, seaAdvance: 1, seaRetreat: 1 } as Record<string, number>,
  extinction: (killed: number) => (killed >= 25 ? 4 : killed >= 10 ? 3 : killed >= 3 ? 2 : 0),
  epochShift: 3,
  finding: 2,
  era: 1,
  note: 1,
  rareFossil: 1,
};

const HOLD = (sev: number) => 1.2 + sev * 0.9;        // seconds the peak level holds
const SETTLE = 2.4;                                    // seconds per level while it settles
const BOIL = (sev: number) => 0.5 + sev * 0.35;        // seconds of flicker at the peak

export class Turmoil {
  level = 0;
  private hold = 0;
  private boil = 0;
  private t = 0;
  private shown = -1;
  private tremor = false;
  private root = document.documentElement;

  constructor() {
    // fetch the worn faces up front, so the first catastrophe does not wait for a download
    if (document.fonts) for (let i = 1; i <= MAX_WEAR; i++) {
      document.fonts.load(`16px "Strata Pixel Worn ${i}"`).catch(() => {});
      document.fonts.load(`32px "Strata Stone Worn ${i}"`).catch(() => {});
    }
  }

  /** An event of the given severity (0..4) happened. Stronger events override weaker ones; nothing lowers it. */
  hit(severity: number): void {
    const sev = Math.max(0, Math.min(MAX_WEAR, severity));
    if (sev <= 0) return;
    if (sev >= this.level) { this.level = sev; this.hold = Math.max(this.hold, HOLD(sev)); }
    this.boil = Math.max(this.boil, BOIL(sev));
  }

  update(dt: number): void {
    this.t += dt;
    if (this.hold > 0) this.hold -= dt;
    else if (this.level > 0) this.level = Math.max(0, this.level - dt / SETTLE);
    if (this.boil > 0) this.boil -= dt;
    let lv = Math.ceil(this.level - 1e-6);
    // boiling: flicker one level down and back, ~11 times a second
    if (this.boil > 0 && lv > 0 && Math.floor(this.t * 11) % 2 === 1) lv -= 1;
    if (lv !== this.shown) {
      this.shown = lv;
      if (lv > 0) this.root.dataset.wear = String(lv);
      else delete this.root.dataset.wear;
    }
    const tremor = this.boil > 0 && this.level >= 3;
    if (tremor !== this.tremor) {
      this.tremor = tremor;
      if (tremor) this.root.dataset.tremor = '1';
      else delete this.root.dataset.tremor;
    }
  }
}
