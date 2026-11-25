/**
 * Skin manifest: colours, materials, lights, post-processing. The view reads only this; sim never does.
 * A new skin is a new object of the same shape.
 *
 * Look: 80/20. Cold grey-blue stone, soot, dark wood and wet metal; warm only around the lamp and the stove.
 * The bright 20% is the arc (blue-white), hot metal (white → yellow → cherry) and sparks.
 */
export const SKIN = {
  res: { w: 426, h: 240 },
  ps1: {
    /** Vertex snap grid as a fraction of the render resolution (0.5 = 213x120 grid). */
    snap: 0.5,
    affine: true,
    colorBits: 5,
    dither: 1,
  },
  palette: {
    soot: '#101114',
    stone: '#5d636c',
    stoneDark: '#3a3e45',
    mortar: '#15171b',
    floor: '#3e3c3a',
    wood: '#5a4532',
    woodDark: '#2c2119',
    iron: '#3c3e42',
    steel: '#6a6d72',
    steelDark: '#2e3034',
    copper: '#b06a36',
    rust: '#7a3e1c',
    slag: '#3a3029',
    bead: '#55575d',
    leather: '#6c5844',
    cloth: '#2e2a26',
    paper: '#d6c9a6',
    glassGreen: '#1e3a24',
    acid: '#9ab08a',
    sky: ['#2c3c5c', '#121a2c', '#05070d'] as [string, string, string],
    cityWall: '#181c26',
    snow: '#c8d4e6',
    water: '#0c1422',
    hills: '#0e121a',
  },
  light: {
    ambient: { sky: '#3c4658', ground: '#121110', intensity: 1.5 },
    window: { color: '#6c90dc', intensity: 14, night: 3.5 },
    lamp: { color: '#ffb46e', intensity: 3.2 },
    stove: { color: '#ff6a2a', intensity: 2.4 },
    arc: { color: '#c8dcff', intensity: 2.6, jitterMM: 1.6 },
    appArc: { color: '#c8dcff', intensity: 1.2 },
  },
  glow: {
    /** Emissive multiplier of hot metal. */
    k: 3.4,
  },
  mask: {
    tint: [0.45, 1.0, 0.5] as [number, number, number],
    shell: [0.006, 0.005, 0.004] as [number, number, number],
  },
  post: {
    exposure: 1.05,
    vignette: 0.55,
    glare: 0.86,
    afterColor: [0.55, 0.35, 0.8] as [number, number, number],
    bloomThreshold: 1.1,
    bloom: 0.9,
  },
};

export type Skin = typeof SKIN;
