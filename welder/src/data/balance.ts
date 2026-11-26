/** Every tuning number of the slice lives here. Units: mm, seconds, coins. Current I is relative (1 = nominal). */
export const BALANCE = {
  dt: 1 / 60,

  weld: {
    cellMM: 2,
    /** Distance from the joint where scratching the electrode can light the arc. */
    strikeRadius: 14,
    /** Electrode travel needed to strike (scratch). */
    scratchMM: 6,
    /** ...or this long holding the rod on the joint (a touch start). */
    touchTime: 0.35,
    /** Pressing on a pool this hot relights without scratching. */
    hotRestart: 0.75,
    /** Lateral distance at which the arc still feeds the joint. */
    captureMM: 10,
    /** Lateral fall-off of heat into the joint. */
    lateralSigma: 4.5,
    /** Travel speed (mm/s) that is ideal for a sheet at nominal current. */
    vIdeal: 15,
    /** Filler deposited per mm at the ideal speed (1 = joint just filled). */
    deposit: 1.3,
    /** Heat brought by the arc, heat-units * mm per second. */
    heatGain: 14.5,
    heatSigma: 3,
    metalSigma: 2.2,
    /** Exponential cooling rate, 1/s. */
    cool: 0.8,
    /** Heat conduction along the seam, mm^2/s. */
    diffuse: 7,
    /** Fusion is zero below fuseLow and full above fuseHigh. */
    fuseLow: 0.85,
    fuseHigh: 1.3,
    /** A cell counts as filled at this much metal. */
    fillMin: 0.55,
    /** Time between bead ripples (the arc's pulse). */
    rippleDt: 0.085,
    speedTau: 0.16,
    rippleCap: 1400,
    spatterDotCap: 160,
    /** Direction from the bench to the welder's eye; a joint is reachable while it faces this way. */
    reachDir: [0, 0.66, 0.75] as [number, number, number],
    /** Least facing (cosine) at which the rod reaches the joint. */
    reachMin: 0.12,
    /** How fast the hands turn the part to a joint (rad/s), and by keys. */
    turnRate: 3.2,
    keyTurn: 1.7,
  },

  arc: {
    startL: 2.6,
    idealL: 2.5,
    goodLo: 1.6,
    goodHi: 3.5,
    stickL: 0.75,
    breakL: 6.5,
    /** The electrode burns off, so the arc slowly grows unless fed down (mm/s at I=1). */
    drift: 0.25,
    /** Mouse wheel: mm per notch. Keys: mm per second. */
    wheelStep: 0.45,
    keyRate: 3.5,
    /** Arc outs per second per unit of current below stableI. */
    sputterK: 7,
  },

  spatter: {
    base: 5,
    longK: 26,
    unstableK: 40,
    stickChance: 0.18,
  },

  pores: {
    base: 0.004,
    longK: 0.22,
    coldK: 0.03,
  },

  electrode: {
    /** A bare rod burns fast; coated ones last longer (upgrades.ts). */
    arcSeconds: 15,
    swapTime: 0.9,
  },

  chip: {
    radius: 12,
    cooldown: 0.09,
    chunkMin: 4,
    chunkMax: 11,
    inspectTime: 1.7,
  },

  quality: {
    grades: [
      { id: 'clean', min: 0.82 },
      { id: 'fair', min: 0.64 },
      { id: 'rough', min: 0.42 },
      { id: 'bad', min: 0 },
    ] as const,
    payMin: 0.3,
    payExp: 1.3,
    failedReqMul: 0.5,
  },

  mask: {
    animTime: 0.16,
    glareRise: 0.06,
    glareFall: 0.3,
    afterRise: 1.6,
    afterFall: 2.4,
  },

  power: {
    flowCold: 0.28,
    flowTau: 2.5,
    wheelTau: 1.3,
    dipRate: 0.05,
    dipColdRate: 0.22,
    dipDepth: [0.12, 0.38] as [number, number],
    dipLen: [0.35, 1.3] as [number, number],
    ripple: 0.025,
    loadSag: 0.05,
  },

  clock: {
    /** Seconds until full night. */
    duskEnd: 380,
    nightAt: 340,
  },

  /** Each order handed over raises what new orders pay (the workshop's name), up to a cap. */
  reputation: {
    perOrder: 0.07,
    maxOrders: 12,
  },

  board: {
    size: 4,
    arriveEvery: 17,
    startOrders: 3,
  },

  apprentice: {
    setup: 4,
    swap: 1.6,
    chip: 4,
    handOver: 1.5,
    sampleDt: 0.05,
    maxSamples: 1600,
    minLitSeconds: 2,
  },

  finale: {
    howlEvery: [4, 9] as [number, number],
    nightBlend: 12,
  },

  /** Autosave interval (seconds of sim time). */
  saveEvery: 15,
};

export type Balance = typeof BALANCE;
