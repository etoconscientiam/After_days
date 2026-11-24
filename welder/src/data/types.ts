/** Shapes of the game data. Everything in data/ is plain records: a new part, order or upgrade is a new entry. */

export type GradeId = 'clean' | 'fair' | 'rough' | 'bad';

/** A seam is a polyline on the part's top surface, in part-local millimetres (x right, z toward the welder). */
export interface SeamDef {
  id: string;
  pts: [number, number][];
}

export interface PartDef {
  id: string;
  /** Key of the mesh builder in view/partMesh.ts. */
  shape: string;
  /** Shape parameters in mm, read only by the view. */
  params: Record<string, number>;
  seams: SeamDef[];
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
  | 'apprentice';

export interface Effects {
  add?: Partial<Record<StatId, number>>;
  mul?: Partial<Record<StatId, number>>;
  set?: Partial<Record<StatId, number>>;
}

export interface UpgradeDef {
  id: string;
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
