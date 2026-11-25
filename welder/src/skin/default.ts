/**
 * Skin manifest: colours, materials, lights, post-processing. The view reads only this; sim never does.
 * A new skin is a new object of the same shape.
 *
 * Look: a worn, lived-in workshop under warm soft light. Muted warm greys and browns, faded sage paint,
 * rust; shadows lifted, corners darkened by ambient occlusion. The arc, hot metal and sparks are the brights.
 */
export const SKIN = {
  res: { w: 426, h: 240 },
  /**
   * Retro tricks, all off for the pixel-3D look of the references (low resolution, hard pixels, pixel-art
   * textures, stable geometry). Turn them on for a PlayStation-style wobble.
   */
  ps1: {
    /** Vertex snap grid as a fraction of the render resolution (0 = off, 0.5 = 213x120 grid). */
    snap: 0,
    /** Affine (not perspective-correct) texture mapping. */
    affine: false,
    /** Colour depth per channel after tone mapping. */
    colorBits: 8,
    /** Ordered dithering strength, 0..1. */
    dither: 0,
  },
  palette: {
    soot: '#1a1714',
    stone: '#86817a',
    stoneDark: '#6a6258',
    mortar: '#3a342c',
    floor: '#67635d',
    wood: '#706452',
    woodDark: '#4e463c',
    iron: '#4a4a48',
    steel: '#7a7a76',
    steelDark: '#4a4844',
    copper: '#c07838',
    rust: '#8a4a22',
    slag: '#3a3029',
    bead: '#55575d',
    leather: '#7a6248',
    cloth: '#5a5044',
    paper: '#dccfae',
    paint: '#6e7a5e',
    glassGreen: '#1e3a24',
    acid: '#9ab08a',
    sky: ['#4a5a70', '#22303f', '#0c1018'] as [string, string, string],
    cityWall: '#232832',
    snow: '#c8d4e6',
    water: '#18222e',
    hills: '#1a1f28',
  },
  /** Warm, soft and fairly bright: a lived-in workshop, not a cave. */
  light: {
    // Low fill: corners go properly dark; light comes from the sources and pools around them.
    ambient: { sky: '#7a8296', ground: '#2a2018', intensity: 0.38 },
    window: { color: '#9cb8e8', intensity: 14, night: 5 },
    lamp: { color: '#ffd29a', intensity: 2.2 },
    stove: { color: '#ff7a30', intensity: 7 },
    /** The arc is the brightest thing in the game: it floods the part and the hands with flickering blue-white. */
    arc: { color: '#d6e6ff', intensity: 26, jitterMM: 1.6 },
    appArc: { color: '#c8dcff', intensity: 1.2 },
  },
  glow: {
    /** Emissive multiplier of hot metal. */
    k: 4.6,
  },
  mask: {
    tint: [0.45, 1.0, 0.5] as [number, number, number],
    shell: [0.006, 0.005, 0.004] as [number, number, number],
  },
  /** Falling snow outside the window. */
  snow: false,
  post: {
    exposure: 1.45,
    vignette: 0.55,
    /** Ambient occlusion strength 0..1 and its reach in metres. */
    ao: 0.75,
    aoRadius: 0.12,
    saturation: 0.9,
    lift: [0.02, 0.018, 0.022] as [number, number, number],
    gain: [1.03, 1.0, 0.95] as [number, number, number],
    glare: 0.3,
    afterColor: [0.55, 0.35, 0.8] as [number, number, number],
    bloomThreshold: 0.95,
    bloom: 1.1,
  },
};

export type Skin = typeof SKIN;
