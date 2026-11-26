/** Shapes of the game data. Everything in data/ is plain records: a new part, order or upgrade is a new entry. */

export type GradeId = 'clean' | 'fair' | 'rough' | 'bad';

/**
 * A seam is the joint between two pieces: a polyline in part-local millimetres (y up, x right, z toward the
 * welder when the part lies as it arrives) with, at every point, the direction from which it is welded.
 * The part has to be turned until that direction faces the welder.
 */
export interface SeamDef {
  id: string;
  pts: [number, number, number][];
  nrm: [number, number, number][];
  /** A ring that closes on itself (around a pipe, a bucket bottom). */
  closed?: boolean;
  /** How hands bring it round: spin on the bench (default) or roll about the left-right axis. */
  turn?: 'spin' | 'roll';
}

export type PieceMat = 'iron' | 'dark' | 'steel' | 'rust' | 'wood' | 'copper' | 'leather';

/**
 * One piece of the job, for the view only. Kinds (all sizes in mm, centred on `pos`):
 *   box {w,h,d} · cyl {r, h, r2?, seg?} along y · tube {r, h, t, r2?, seg?, phi0?, phiLen?} along y, open ends ·
 *   lathe pts=[[r, y]...] {seg?, phi0?, phiLen?} · torus {R, r, arc?} in the xz plane ·
 *   cone {r, h, seg?} · plate pts=[[x, z]...] {t} flat outline extruded up · sphere {r}
 */
export interface PieceDef {
  kind: 'box' | 'cyl' | 'tube' | 'lathe' | 'torus' | 'cone' | 'plate' | 'sphere';
  p?: Record<string, number>;
  pts?: [number, number][];
  pos?: [number, number, number];
  /** Euler angles in degrees (three.js 'XYZ' order: the Z turn is applied first). */
  rot?: [number, number, number];
  mat?: PieceMat;
}

export interface PartDef {
  id: string;
  pieces: PieceDef[];
  seams: SeamDef[];
  /** How the part lies when it is brought to the bench (Euler degrees, as `rot`). */
  rest?: [number, number, number];
  /** Heat sink: 1 = plain sheet. Thicker parts need slower travel or more current. */
  thick: number;
  /** Heat at which the metal burns through. */
  burn: number;
  /** Simple parts can be welded by the apprentice. */
  simple: boolean;
  /** Size in mm the work camera frames. */
  frame: number;
}

export interface CustomerLook {
  cloak: string;
  hood: string;
  hat: 'hood' | 'helmet' | 'cap';
  height: number;
}

export interface CustomerDef {
  id: string;
  look: CustomerLook;
}

export interface Requirement {
  minGrade?: GradeId;
  noHoles?: boolean;
  /** Upgrade that must be owned before the order can be taken. */
  needs?: string;
}

export interface OrderTemplate {
  part: string;
  customer: string;
  reward: [number, number];
  req?: Requirement;
  weight?: number;
  /** Pays at least this whatever the quality (the first job of the shift). */
  minPay?: number;
}

/** Condition language shared by story beats and upgrade requirements. */
export interface Cond {
  ordersDone?: number;
  owns?: string[];
  flag?: string;
  time?: number;
  any?: Cond[];
  all?: Cond[];
}

export type StatId =
  | 'maskTransmission'
  | 'maskSee'
  | 'knowTempo'
  | 'knowArc'
  | 'knowFusion'
  | 'knowHand'
  | 'maskWindow'
  | 'strikeMul'
  | 'spatterMul'
  | 'poreMul'
  | 'electrodeSeconds'
  | 'powerSmooth'
  | 'dipMul'
  | 'dynamoGain'
  | 'stickL'
  | 'stableI'
  | 'wheels'
  | 'apprentice'
  /** How wildly a bare rod runs: 1 bare (spattery, uneven puddle), less with coated rods. Looks only. */
  | 'rodWild'
  /** How worn the mask's glass is: 1 the old scratched one, less on better glass. Looks only. */
  | 'maskWear';

export interface Effects {
  add?: Partial<Record<StatId, number>>;
  mul?: Partial<Record<StatId, number>>;
  set?: Partial<Record<StatId, number>>;
}

export interface UpgradeDef {
  id: string;
  /** Section of the craft book: what you know, what you work with, the workshop itself. */
  group: 'craft' | 'tools' | 'shop';
  cost: number;
  /** All must hold to buy; anything missing is shown as the reason. */
  requires?: Cond;
  effects: Effects;
  /** Shelf slot index (view places the item). */
  slot: number;
  /** View model key. */
  model: string;
}

export interface StoryBeat {
  id: string;
  when: Cond;
}

export interface GameData {
  parts: Record<string, PartDef>;
  customers: Record<string, CustomerDef>;
  intro: OrderTemplate[];
  pools: { walkin: OrderTemplate[]; board: OrderTemplate[] };
  finale: OrderTemplate;
  upgrades: UpgradeDef[];
  story: StoryBeat[];
}
