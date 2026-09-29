// Static design data: biomes, flower species, tree kinds, regions, lakes and landmarks.
// Visible strings here never use hyphens, dashes or emoji (house style for UI copy).

export const BIOME = { MEADOW: 0, BLOSSOM: 1, LAVENDER: 2, FOREST: 3, LAKE: 4, ALPINE: 5, AUTUMN: 6, SHORE: 7 };
export const BIOME_COUNT = 8;

// Flower head archetypes (each is one instanced geometry).
export const ARCH = { RADIAL5: 0, RADIAL8: 1, RADIAL12: 2, CUP: 3, SPIKE: 4, BELL: 5, STAR: 6, SUN: 7, LOTUS: 8 };
export const ARCH_COUNT = 9;

// sizes are head diameter in metres, stem is height in metres.
export const FLOWERS = [
  { key: 'daisy', name: 'Daisy', arch: ARCH.RADIAL12, petals: ['#ffffff', '#fff4dd', '#ffe6f0'], center: '#ffc928', size: [0.5, 0.74], stem: [0.5, 0.95], nectar: 0.22 },
  { key: 'buttercup', name: 'Buttercup', arch: ARCH.RADIAL5, petals: ['#ffd21f', '#ffe14d', '#ffc400'], center: '#e8a200', size: [0.4, 0.58], stem: [0.45, 0.85], nectar: 0.2 },
  { key: 'poppy', name: 'Poppy', arch: ARCH.RADIAL5, petals: ['#f0392f', '#f5552f', '#dd2d44'], center: '#20141a', size: [0.62, 0.86], stem: [0.65, 1.1], nectar: 0.24 },
  { key: 'cosmos', name: 'Cosmos', arch: ARCH.RADIAL8, petals: ['#ff6fa8', '#ff9cc6', '#f24d95', '#ffffff'], center: '#ffc928', size: [0.62, 0.84], stem: [0.8, 1.35], nectar: 0.26 },
  { key: 'cornflower', name: 'Cornflower', arch: ARCH.RADIAL12, petals: ['#4f7cff', '#6a8dff', '#3f63e6'], center: '#2a2d6a', size: [0.42, 0.6], stem: [0.55, 1.0], nectar: 0.22 },
  { key: 'aster', name: 'Aster', arch: ARCH.RADIAL12, petals: ['#b18cff', '#c9a7ff', '#9a73f0', '#f0b4ff'], center: '#ffcf2e', size: [0.46, 0.66], stem: [0.45, 0.9], nectar: 0.24 },
  { key: 'tulip', name: 'Tulip', arch: ARCH.CUP, petals: ['#ff4d5e', '#ffb11f', '#ff8fbd', '#a566f5', '#fff0c4'], center: '#3a2d1a', size: [0.4, 0.56], stem: [0.55, 1.0], nectar: 0.28 },
  { key: 'lavender', name: 'Lavender', arch: ARCH.SPIKE, petals: ['#8f6bd6', '#a583e6', '#7857c4'], center: '#5f3fa0', size: [0.2, 0.3], stem: [0.75, 1.2], nectar: 0.3 },
  { key: 'foxglove', name: 'Foxglove', arch: ARCH.BELL, petals: ['#e567b4', '#f28ac8', '#ffffff', '#c94fa0'], center: '#7a2a5a', size: [0.34, 0.46], stem: [1.1, 1.7], nectar: 0.3 },
  { key: 'bluebell', name: 'Bluebell', arch: ARCH.BELL, petals: ['#5f7bff', '#7d95ff', '#4e63e8'], center: '#2a3a9a', size: [0.26, 0.36], stem: [0.55, 0.95], nectar: 0.26 },
  { key: 'sunflower', name: 'Sunflower', arch: ARCH.SUN, petals: ['#ffc21a', '#ffb000', '#ffd43a'], center: '#5a3a1a', size: [0.8, 1.15], stem: [1.6, 2.5], nectar: 0.4 },
  { key: 'lily', name: 'Lily', arch: ARCH.STAR, petals: ['#fff5f0', '#ffb86b', '#ff8fa8'], center: '#f2a020', size: [0.7, 0.95], stem: [0.8, 1.3], nectar: 0.34 },
  { key: 'lotus', name: 'Lotus', arch: ARCH.LOTUS, petals: ['#ffc4dc', '#ffffff', '#f7a1c8'], center: '#ffd84a', size: [0.8, 1.1], stem: [0, 0], nectar: 0.4 },
  { key: 'marigold', name: 'Marigold', arch: ARCH.RADIAL12, petals: ['#ff9a1f', '#ffb43a', '#ff7a1a'], center: '#c95a0a', size: [0.46, 0.66], stem: [0.45, 0.85], nectar: 0.24 },
  { key: 'edelweiss', name: 'Edelweiss', arch: ARCH.RADIAL8, petals: ['#f4f1e6', '#ffffff'], center: '#e8e08a', size: [0.32, 0.44], stem: [0.28, 0.5], nectar: 0.3 },
  { key: 'gentian', name: 'Gentian', arch: ARCH.CUP, petals: ['#2f5fff', '#3f74ff', '#2249d6'], center: '#e8f0ff', size: [0.3, 0.42], stem: [0.3, 0.55], nectar: 0.3 },
  { key: 'moonflower', name: 'Moonflower', arch: ARCH.STAR, petals: ['#e8f1ff', '#dff0ff', '#f4eaff'], center: '#fff3a0', size: [0.8, 1.1], stem: [0.9, 1.5], nectar: 0.5, nocturnal: true, glow: true },
  { key: 'lilypad', name: 'Lily Pad', arch: ARCH.LOTUS, petals: ['#ffffff'], center: '#ffffff', size: [0.7, 0.9], stem: [0, 0], nectar: 0, padOnly: true },
  { key: 'thrift', name: 'Sea Thrift', arch: ARCH.RADIAL5, petals: ['#ff9ec4', '#ffc0d8', '#ff7fb1'], center: '#ffe08a', size: [0.28, 0.4], stem: [0.28, 0.55], nectar: 0.18 },
];
export const FLOWER_INDEX = Object.fromEntries(FLOWERS.map((f, i) => [f.key, i]));
export const VARIANTS = 5; // colour variants per species (padded)

// Tree kinds. h is height (m), crown is crown radius (m).
export const TREES = [
  { key: 'oak', name: 'Oak', trunk: '#6d4b31', leaf: ['#5c9c3e', '#76b648', '#4d8a37', '#88c150'], h: [7.5, 12.5], crown: [3.6, 5.2] },
  { key: 'cherry', name: 'Cherry', trunk: '#5e4038', leaf: ['#ffb3cc', '#ffc7da', '#f78db2', '#ffd6e4'], h: [5.5, 8.5], crown: [3.4, 4.8] },
  { key: 'pine', name: 'Pine', trunk: '#5a4330', leaf: ['#2f6a45', '#265a3b', '#357550', '#3d7f56'], h: [10, 18], crown: [2.3, 3.4] },
  { key: 'birch', name: 'Birch', trunk: '#ece7da', leaf: ['#a8c95a', '#8fbb4d', '#c4d666', '#9fca58'], h: [7.5, 11.5], crown: [2.5, 3.5] },
  { key: 'maple', name: 'Maple', trunk: '#5b3a2a', leaf: ['#e8572a', '#f09a2a', '#d63a2a', '#f2c14a'], h: [7.5, 12.5], crown: [3.8, 5.4] },
  { key: 'palm', name: 'Palm', trunk: '#b08f5e', leaf: ['#5aa050', '#6fb85a', '#4d9448'], h: [6, 10], crown: [2.8, 3.6] },
  { key: 'snowpine', name: 'Frost Pine', trunk: '#5d4a3a', leaf: ['#2d5f47', '#3a6e55', '#f2f6fb'], h: [9, 15], crown: [2.2, 3.0] },
];
export const TREE_INDEX = Object.fromEntries(TREES.map((t, i) => [t.key, i]));

// Per biome design. ground: three palette colours. grass: blade colours, height in m and density 0..1.
// flowers: species weights. flowerDensity: flowers per square metre near the peak of a clump.
// trees: [treeKey, weight]; treeDensity: trees per 1000 m2.
export const BIOMES = [
  {
    key: 'meadow', name: 'Sunmeadow',
    ground: ['#79a94a', '#8fbf55', '#a6b95b'],
    grass: { bottom: '#3d7a2e', top: '#a4d65c', dry: '#dccf6e', height: 0.75, density: 1.0 },
    flowers: { daisy: 1, buttercup: 0.8, poppy: 0.7, cosmos: 0.55, cornflower: 0.5, sunflower: 0.14, marigold: 0.14, tulip: 0.14 },
    flowerDensity: 0.55,
    trees: [['oak', 1]], treeDensity: 0.7,
    fog: '#bcd9e8', mood: 'bright',
  },
  {
    key: 'blossom', name: 'Blossom Vale',
    ground: ['#86b46a', '#cfa9b8', '#9ac07a'],
    grass: { bottom: '#4a8a3c', top: '#b6de7c', dry: '#e6d29a', height: 0.6, density: 0.95 },
    flowers: { cosmos: 1, tulip: 0.85, daisy: 0.4, lily: 0.15, bluebell: 0.2 },
    flowerDensity: 0.6,
    trees: [['cherry', 1], ['oak', 0.1]], treeDensity: 5.5,
    fog: '#e8d2e0', mood: 'soft',
  },
  {
    key: 'lavender', name: 'Lavender Reach',
    ground: ['#a3a35a', '#b8a56a', '#8a9a55'],
    grass: { bottom: '#66803a', top: '#c9c56c', dry: '#dccb84', height: 0.55, density: 0.75 },
    flowers: { lavender: 1, poppy: 0.4, cornflower: 0.3, sunflower: 0.22, cosmos: 0.12 },
    flowerDensity: 0.9,
    trees: [['oak', 1]], treeDensity: 0.35,
    fog: '#e6d8c8', mood: 'warm',
  },
  {
    key: 'forest', name: 'Mossglen',
    ground: ['#3e6b3a', '#2f5a35', '#5a4a34'],
    grass: { bottom: '#1f4a2a', top: '#5fa04a', dry: '#8a9a4a', height: 0.42, density: 0.7 },
    flowers: { bluebell: 0.9, foxglove: 0.8, moonflower: 0.16, aster: 0.14 },
    flowerDensity: 0.32,
    trees: [['pine', 1], ['birch', 0.55], ['oak', 0.4]], treeDensity: 12,
    fog: '#a8c4b0', mood: 'deep',
  },
  {
    key: 'lake', name: 'Mirrormere',
    ground: ['#6d8a4c', '#5f7a45', '#7a6a48'],
    grass: { bottom: '#3a6e34', top: '#8fc25a', dry: '#c4c070', height: 0.85, density: 0.9 },
    flowers: { lily: 0.7, buttercup: 0.5, moonflower: 0.2, cosmos: 0.2, bluebell: 0.2 },
    flowerDensity: 0.4,
    trees: [['oak', 0.7], ['birch', 0.6]], treeDensity: 2.4,
    fog: '#b6d8e0', mood: 'calm',
  },
  {
    key: 'alpine', name: 'Skyreach Heights',
    ground: ['#7f9a68', '#8d9078', '#9a9c98'],
    grass: { bottom: '#597748', top: '#a9c47a', dry: '#c9c088', height: 0.34, density: 0.65 },
    flowers: { edelweiss: 0.9, gentian: 0.9, aster: 0.2 },
    flowerDensity: 0.4,
    trees: [['snowpine', 1]], treeDensity: 3.2,
    fog: '#c6d6e8', mood: 'crisp',
  },
  {
    key: 'autumn', name: 'Maple Hollow',
    ground: ['#b58a3a', '#a5652c', '#c19a44'],
    grass: { bottom: '#8a6a2a', top: '#e2b34c', dry: '#c98a3a', height: 0.6, density: 0.85 },
    flowers: { aster: 0.9, marigold: 1, sunflower: 0.3 },
    flowerDensity: 0.5,
    trees: [['maple', 1], ['birch', 0.35]], treeDensity: 9,
    fog: '#e6c9a0', mood: 'golden',
  },
  {
    key: 'shore', name: 'Sundown Shore',
    ground: ['#e5d5a4', '#dccb98', '#c9b98a'],
    grass: { bottom: '#7a8a4a', top: '#d6d08a', dry: '#e8dc9a', height: 0.6, density: 0.28 },
    flowers: { thrift: 1, daisy: 0.2 },
    flowerDensity: 0.22,
    trees: [['palm', 1]], treeDensity: 0.55,
    fog: '#cfe4ea', mood: 'breezy',
  },
];

// Region anchors used to shape both terrain and biome weights. x east, z south (north is minus z).
export const REGIONS = [
  { biome: BIOME.ALPINE, x: -140, z: -1010, r: 560, k: 1.6 },
  { biome: BIOME.FOREST, x: 700, z: -520, r: 520, k: 1.6 },
  { biome: BIOME.AUTUMN, x: -800, z: -520, r: 430, k: 1.6 },
  { biome: BIOME.BLOSSOM, x: -720, z: 200, r: 400, k: 1.7 },
  { biome: BIOME.LAVENDER, x: -300, z: 940, r: 430, k: 1.7 },
  { biome: BIOME.LAKE, x: 790, z: 430, r: 430, k: 1.7 },
  { biome: BIOME.MEADOW, x: 60, z: 380, r: 560, k: 1.3 },
];

export const ISLAND = { cx: 0, cz: -30, radius: 1560 };
export const HEART_HILL = { x: 0, z: -120 };
export const PEAK = { x: -150, z: -1130 };
export const SPAWN = { x: 40, z: 640, yaw: 0 };

export const LAKES = [
  { key: 'mirrormere', name: 'Mirrormere', x: 790, z: 430, rx: 250, rz: 195, rot: 0.45, depth: 9, color: '#2f8fa0', pct: 0.04 },
  { key: 'tarn', name: 'Skyreach Tarn', x: 90, z: -960, rx: 88, rz: 66, rot: 0.2, depth: 10, color: '#3aa0b0', pct: 0.08 },
  { key: 'dewpond', name: 'Dewpond', x: -70, z: 500, rx: 46, rz: 33, rot: 0.6, depth: 3.2, color: '#3d9aa8', pct: 0.06, pond: true },
  { key: 'petalpond', name: 'Petal Pond', x: -560, z: 330, rx: 40, rz: 30, rot: -0.4, depth: 3, color: '#4aa0b8', pct: 0.06, pond: true },
  { key: 'mosspool', name: 'Moss Pool', x: 560, z: -330, rx: 52, rz: 38, rot: 1.0, depth: 3.4, color: '#2f8a86', pct: 0.06, pond: true },
  { key: 'maplepond', name: 'Maple Pond', x: -640, z: -300, rx: 44, rz: 32, rot: 0.1, depth: 3, color: '#3d8f9a', pct: 0.06, pond: true },
  { key: 'lavenderpond', name: 'Lavender Pond', x: -180, z: 1030, rx: 42, rz: 30, rot: 0.9, depth: 3, color: '#4aa0b0', pct: 0.06, pond: true },
];

// Landmarks: discoverable places. kind selects the procedural model. flat is the levelled radius,
// clear (optional) is the radius around a stone structure where no grass, flowers or props grow.
export const LANDMARKS = [
  { id: 'heartbloom', name: 'The Heartbloom', kind: 'giantTree', x: 0, z: -120, flat: 48, radius: 90, biome: 'meadow',
    blurb: 'An ancient tree whose blossoms remember every spring.' },
  { id: 'windmill', name: 'Windmill Hill', kind: 'windmill', x: -230, z: 420, flat: 26, radius: 60, clear: 5.2, biome: 'meadow',
    blurb: 'Slow sails turning over a sea of wildflowers.' },
  { id: 'lantern', name: 'Lantern Arch', kind: 'arch', x: -720, z: 120, flat: 26, radius: 55, clear: 7.2, biome: 'blossom',
    blurb: 'Paper lanterns sway beneath a stone arch of falling petals.' },
  { id: 'sundial', name: 'Sundial Stones', kind: 'sundial', x: -400, z: 930, flat: 30, radius: 55, clear: 4.4, biome: 'lavender',
    blurb: 'Shadows here still keep time for the bees.' },
  { id: 'pavilion', name: 'Reed Pavilion', kind: 'pavilion', x: 0, z: 0, flat: 0, radius: 60, biome: 'lake', auto: 'lakeshore',
    blurb: 'A little pavilion where the lake holds its breath.' },
  { id: 'glowcap', name: 'Glowcap Hollow', kind: 'mushrooms', x: 720, z: -600, flat: 34, radius: 70, biome: 'forest',
    blurb: 'Giant mushrooms glow softly beneath the old pines.' },
  { id: 'maple', name: 'Maple Throne', kind: 'giantMaple', x: -830, z: -540, flat: 34, radius: 70, biome: 'autumn',
    blurb: 'A crimson giant sheds gold on the hollow below.' },
  { id: 'falls', name: 'Skyreach Falls', kind: 'falls', x: 0, z: 0, flat: 0, radius: 90, biome: 'alpine', auto: 'falls',
    blurb: 'Water leaps from the clouds and never looks back.' },
  { id: 'summit', name: 'Summit Shrine', kind: 'shrine', x: -150, z: -1130, flat: 14, radius: 40, clear: 5.2, biome: 'alpine',
    blurb: 'The highest lantern on the island keeps the stars company.' },
  { id: 'moonwell', name: 'The Moonwell', kind: 'well', x: 330, z: -280, flat: 26, radius: 50, clear: 4.6, biome: 'meadow',
    blurb: 'A still well that holds the moon even by day.' },
  { id: 'lighthouse', name: 'Lighthouse Point', kind: 'lighthouse', x: 0, z: 0, flat: 0, radius: 70, clear: 5.4, biome: 'shore', auto: 'cape',
    blurb: 'A red and white tower guides sleepy travellers home.' },
  { id: 'seaarch', name: 'Tidepool Arch', kind: 'seaarch', x: 0, z: 0, flat: 0, radius: 70, biome: 'shore', auto: 'westcoast',
    blurb: 'The sea carved a doorway and left the light on.' },
];
