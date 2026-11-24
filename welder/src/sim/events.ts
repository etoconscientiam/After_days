import type { GradeId } from '../data/types';

export type BenchId = 'player' | 'apprentice';
export type ArcOutReason = 'release' | 'long' | 'power' | 'electrode' | 'off';

/** Every event the sim emits. View, audio and UI subscribe; the sim never looks back at them. */
export interface SimEvents {
  started: { resumed: boolean };
  money: { money: number; delta: number };
  orderTaken: { bench: BenchId; uid: number; part: string };
  pileChanged: { has: boolean };
  boardChanged: { count: number };
  arcStrike: { bench: BenchId; x: number; z: number };
  arcOut: { bench: BenchId; reason: ArcOutReason };
  arcStick: { bench: BenchId };
  arcUnstick: { bench: BenchId };
  burnThrough: { bench: BenchId; seam: number; s: number; x: number; z: number };
  seamFilled: { bench: BenchId; seam: number };
  weldDone: { bench: BenchId };
  slagChip: { bench: BenchId; seam: number; s0: number; s1: number; x: number; z: number; amount: number };
  hammerMiss: { bench: BenchId; x: number; z: number; onMetal: boolean };
  revealed: { bench: BenchId; quality: number; grade: GradeId; holes: number; pores: number };
  handedOver: { bench: BenchId; uid: number; pay: number; grade: GradeId; reqMet: boolean; part: string };
  electrodeEmpty: { bench: BenchId };
  electrodeSwap: { bench: BenchId };
  electrodeNew: { bench: BenchId };
  mask: { down: boolean };
  bought: { id: string };
  shopChanged: Record<string, never>;
  beat: { id: string };
  focus: { target: string; hint: string };
  habitRecorded: { seconds: number };
  apprentice: { state: string };
  powerDip: { depth: number };
  howl: { pan: number; pitch: number };
  finaleStart: Record<string, never>;
  finaleEnd: { quality: number; grade: GradeId };
  milestone: { id: string; t: number };
  save: Record<string, never>;
}
