/**
 * Skin manifest: colours, materials, lights, post-processing. The view reads only this; sim never does.
 * A new skin is a new object of the same shape.
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
    soot: '#120f0d',
    stone: '#4a423a',
    stoneDark: '#2a2420',
    mortar: '#1a1612',
    wood: '#5a3e28',
    woodDark: '#2e2016',
    iron: '#3a3a3e',
    steel: '#62646a',
    steelDark: '#2c2d31',
    copper: '#7a5a42',
    rust: '#5c3420',
    slag: '#3a3029',
    bead: '#55575d',
    leather: '#4a3020',
    cloth: '#3c342c',
    paper: '#b8aa8c',
    glassGreen: '#1e3a24',
    acid: '#4a6a3a',
    sky: ['#3a4c6c', '#141c2e', '#06080e'] as [string, string, string],
    skyNight: ['#141c30', '#080c16', '#020306'] as [string, string, string],
    cityWall: '#1a1e28',
    snow: '#c4d0e0',
    water: '#0e1622',
    hills: '#10141c',
  },
  light: {
    ambient: { sky: '#4c4842', ground: '#16130f', intensity: 1.7 },
    window: { color: '#7a98d0', intensity: 9, night: 1.6 },
    lamp: { color: '#ffc896', intensity: 4.5 },
    stove: { color: '#ff7a3a', intensity: 2.2 },
    arc: { color: '#d4e4ff', intensity: 2.2, jitterMM: 1.6 },
    appArc: { color: '#c8dcff', intensity: 0.9 },
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
    exposure: 1.0,
    vignette: 0.35,
    glare: 0.86,
    afterColor: [0.55, 0.35, 0.8] as [number, number, number],
  },
};

export type Skin = typeof SKIN;
