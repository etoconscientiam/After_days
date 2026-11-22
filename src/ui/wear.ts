/**
 * Strata Stone weathering in the UI.
 *
 * The font ships as five faces: level 0 is clean, levels 1..4 are progressively weathered (chips, bumps,
 * a 1 px fault shift; tools/font/wear.json). Damage only accumulates, so raising the level never moves a
 * pixel back: text "erodes" in place. Every level has the same advances and kerning, so changing it never
 * reflows a line.
 *
 * Usage: give an element the class `stone`, then set its level from whatever condition drives it:
 *   setWear(noteEl, wearFrom(note.age / note.maxAge))
 *   setWear(eraTitle, wearFrom(eraIndex / (ERA_COUNT - 1)))
 */
export const MAX_WEAR = 4;

/** Clamp any number to a wear level 0..MAX_WEAR. */
export function clampWear(level: number): number {
  return Math.max(0, Math.min(MAX_WEAR, Math.round(level)));
}

/** Map a 0..1 amount (age, damage, depth, pressure...) to a wear level. `curve` > 1 keeps text clean longer. */
export function wearFrom(amount: number, curve = 1): number {
  const t = Math.max(0, Math.min(1, amount));
  return clampWear(Math.pow(t, curve) * MAX_WEAR);
}

/** Apply a wear level to an element with class `stone` (see src/ui/fonts.css). */
export function setWear(el: HTMLElement, level: number): void {
  const w = clampWear(level);
  if (w === 0) delete el.dataset.wear;
  else el.dataset.wear = String(w);
}

/** CSS font-family for a level, for canvas text: ctx.font = `32px ${wearFamily(2)}`. */
export function wearFamily(level: number): string {
  const w = clampWear(level);
  return w === 0 ? '"Strata Stone"' : `"Strata Stone Worn ${w}", "Strata Stone"`;
}
