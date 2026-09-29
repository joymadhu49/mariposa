// Procedural island generation. Pure JS (no DOM, no WebGL) so it can also run under Node for debugging.
import { Noise } from '../core/noise.js';
import { clamp, clamp01, lerp, smoothstep, hash2f, hexToLinear, linearToSrgb, TAU, mulberry32 } from '../core/util.js';
import {
  BIOME, BIOME_COUNT, BIOMES, REGIONS, ISLAND, HEART_HILL, PEAK, LAKES, LANDMARKS, TREES, TREE_INDEX,
} from './biomes.js';

export const WORLD_SIZE = 4096;
export const GRID = 1024;
export const CELL = WORLD_SIZE / GRID; // 4 m
export const HALF = WORLD_SIZE / 2;
export const SEA_LEVEL = 0;
export const TREE_CELL = 48; // spatial grid cell for tree queries

const sq = (v) => v * v;
const yieldFrame = () => new Promise((r) => setTimeout(r, 0));

export class World {
  constructor() {
    this.size = WORLD_SIZE;
    this.N = GRID;
    this.cell = CELL;
    this.half = HALF;
    this.height = new Float32Array(GRID * GRID);
    this.coast = new Float32Array(GRID * GRID); // metres inland (negative at sea)
    this.normal = new Uint8Array(GRID * GRID * 4); // rgb = normal, a = cavity ao
    this.albedo = new Uint8Array(GRID * GRID * 4); // srgb rgb, a = wetness
    this.flora = new Uint8Array(GRID * GRID * 4); // r grass density, g grass height, b flower density, a canopy
    this.grassTop = new Uint8Array(GRID * GRID * 4); // srgb blade tip colour
    this.grassBottom = new Uint8Array(GRID * GRID * 4); // srgb blade base colour
    this.biome = new Uint8Array(GRID * GRID * BIOME_COUNT);
    this.lakes = [];
    this.landmarks = [];
    this.falls = null;
    this.trees = new Float32Array(0); // x y z scale yaw kind seed
    this.treeCount = 0;
    this.treeGridStart = null;
    this.treeGridIdx = null;
    this.treeGridN = Math.ceil(WORLD_SIZE / TREE_CELL);
    this.spawn = { x: 0, z: 0, yaw: 0 };
    this.stats = {};
  }

  // Bilinear terrain height in metres. Mirrors the GPU lookup so physics matches what you see.
  heightAt(x, z) {
    const N = GRID;
    const u = (x + HALF) / CELL, v = (z + HALF) / CELL;
    let i0 = Math.floor(u), j0 = Math.floor(v);
    const fx = u - i0, fz = v - j0;
    let i1 = i0 + 1, j1 = j0 + 1;
    i0 = i0 < 0 ? 0 : i0 > N - 1 ? N - 1 : i0;
    j0 = j0 < 0 ? 0 : j0 > N - 1 ? N - 1 : j0;
    i1 = i1 < 0 ? 0 : i1 > N - 1 ? N - 1 : i1;
    j1 = j1 < 0 ? 0 : j1 > N - 1 ? N - 1 : j1;
    const h = this.height;
    const a = h[j0 * N + i0], b = h[j0 * N + i1], c = h[j1 * N + i0], d = h[j1 * N + i1];
    return (a + (b - a) * fx) * (1 - fz) + (c + (d - c) * fx) * fz;
  }

  // Terrain normal via central differences on the bilinear surface.
  normalAt(x, z, out) {
    const e = 2.0;
    const hx = this.heightAt(x + e, z) - this.heightAt(x - e, z);
    const hz = this.heightAt(x, z + e) - this.heightAt(x, z - e);
    let nx = -hx / (2 * e), nz = -hz / (2 * e), ny = 1;
    const l = Math.hypot(nx, ny, nz);
    out.x = nx / l; out.y = ny / l; out.z = nz / l;
    return out;
  }

  // Biome weights at a point (bilinear over the baked 8 channel weights).
  biomeWeightsAt(x, z, out) {
    const N = GRID;
    const u = (x + HALF) / CELL, v = (z + HALF) / CELL;
    let i0 = Math.floor(u), j0 = Math.floor(v);
    const fx = u - i0, fz = v - j0;
    const i1 = clamp(i0 + 1, 0, N - 1), j1 = clamp(j0 + 1, 0, N - 1);
    i0 = clamp(i0, 0, N - 1); j0 = clamp(j0, 0, N - 1);
    const B = this.biome;
    const w00 = (1 - fx) * (1 - fz), w10 = fx * (1 - fz), w01 = (1 - fx) * fz, w11 = fx * fz;
    const o00 = (j0 * N + i0) * BIOME_COUNT, o10 = (j0 * N + i1) * BIOME_COUNT;
    const o01 = (j1 * N + i0) * BIOME_COUNT, o11 = (j1 * N + i1) * BIOME_COUNT;
    for (let k = 0; k < BIOME_COUNT; k++) {
      out[k] = (B[o00 + k] * w00 + B[o10 + k] * w10 + B[o01 + k] * w01 + B[o11 + k] * w11) / 255;
    }
    return out;
  }

  dominantBiomeAt(x, z) {
    const N = GRID;
    const i = clamp(Math.round((x + HALF) / CELL), 0, N - 1);
    const j = clamp(Math.round((z + HALF) / CELL), 0, N - 1);
    const o = (j * N + i) * BIOME_COUNT;
    let best = 0, bv = -1;
    for (let k = 0; k < BIOME_COUNT; k++) {
      const v = this.biome[o + k];
      if (v > bv) { bv = v; best = k; }
    }
    return best;
  }

  // Sample a packed RGBA8 map (flora / albedo / normal) bilinearly, channel 0..3, result 0..1.
  sampleMap(map, x, z, ch) {
    const N = GRID;
    const u = (x + HALF) / CELL, v = (z + HALF) / CELL;
    let i0 = Math.floor(u), j0 = Math.floor(v);
    const fx = u - i0, fz = v - j0;
    const i1 = clamp(i0 + 1, 0, N - 1), j1 = clamp(j0 + 1, 0, N - 1);
    i0 = clamp(i0, 0, N - 1); j0 = clamp(j0, 0, N - 1);
    const a = map[(j0 * N + i0) * 4 + ch], b = map[(j0 * N + i1) * 4 + ch];
    const c = map[(j1 * N + i0) * 4 + ch], d = map[(j1 * N + i1) * 4 + ch];
    return ((a + (b - a) * fx) * (1 - fz) + (c + (d - c) * fx) * fz) / 255;
  }

  // Returns the water surface height at x,z if that point is under water, otherwise null.
  waterLevelAt(x, z) {
    const e = this.heightAt(x, z);
    if (e < SEA_LEVEL) return SEA_LEVEL;
    for (const lk of this.lakes) {
      const dx = x - lk.x, dz = z - lk.z;
      const c = Math.cos(lk.rot), s = Math.sin(lk.rot);
      const a = (dx * c + dz * s) / lk.rx, b = (-dx * s + dz * c) / lk.rz;
      if (a * a + b * b < (lk.maskT || 1.28) ** 2 && e < lk.level) return lk.level;
    }
    return null;
  }

  // Coast distance at a point in metres inland (negative offshore).
  coastAt(x, z) {
    const N = GRID;
    const i = clamp(Math.round((x + HALF) / CELL), 0, N - 1);
    const j = clamp(Math.round((z + HALF) / CELL), 0, N - 1);
    return this.coast[j * N + i];
  }

  // Trees whose cell is within a square radius. Calls fn(index) for each.
  forTreesNear(x, z, r, fn) {
    const G = this.treeGridN;
    const c0 = clamp(Math.floor((x - r + HALF) / TREE_CELL), 0, G - 1);
    const c1 = clamp(Math.floor((x + r + HALF) / TREE_CELL), 0, G - 1);
    const r0 = clamp(Math.floor((z - r + HALF) / TREE_CELL), 0, G - 1);
    const r1 = clamp(Math.floor((z + r + HALF) / TREE_CELL), 0, G - 1);
    for (let cj = r0; cj <= r1; cj++) {
      for (let ci = c0; ci <= c1; ci++) {
        const cell = cj * G + ci;
        for (let k = this.treeGridStart[cell]; k < this.treeGridStart[cell + 1]; k++) fn(this.treeGridIdx[k]);
      }
    }
  }

  landmark(id) {
    return this.landmarks.find((l) => l.id === id);
  }
}

// Precomputed palettes in linear space.
function buildPalettes() {
  return BIOMES.map((b) => ({
    ground: b.ground.map(hexToLinear),
    fog: hexToLinear(b.fog),
    gTop: hexToLinear(b.grass.top), gBot: hexToLinear(b.grass.bottom), gDry: hexToLinear(b.grass.dry),
  }));
}

export async function generateWorld(onProgress = () => {}) {
  const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const W = new World();
  const N = GRID;
  const nA = new Noise(9271), nB = new Noise(5511), nC = new Noise(31337), nD = new Noise(777);
  const H = W.height;
  const S = W.coast;
  const rep = (frac, label) => onProgress(frac, label);

  // 1. Coast radius table (organic outline).
  const CS = 720;
  const coastTable = new Float32Array(CS + 1);
  for (let k = 0; k <= CS; k++) {
    const th = (k / CS) * TAU, cx = Math.cos(th), sz = Math.sin(th);
    coastTable[k] = ISLAND.radius + 200 * nA.n2(cx * 1.15 + 5, sz * 1.15 + 3) + 105 * nA.n2(cx * 2.9 + 9, sz * 2.9 - 4) + 55 * nA.n2(cx * 6.5, sz * 6.5 + 2);
  }
  const coastRadius = (theta) => {
    let t = theta / TAU; t -= Math.floor(t);
    const f = t * CS; const i = Math.floor(f); const fr = f - i;
    return coastTable[i] * (1 - fr) + coastTable[Math.min(CS, i + 1)] * fr;
  };
  W.coastRadius = coastRadius;

  const reg = {};
  for (const r of REGIONS) reg[r.biome] = r;
  // perturbation noise keeps region borders organic; stored so the biome pass reuses it
  const WN1 = new Float32Array(N * N), WN2 = new Float32Array(N * N);
  const regionWeight = (r, qx, qz, wn) => Math.exp(-sq((Math.hypot(qx - r.x, qz - r.z) / r.r) * (1 + 0.32 * wn)) * r.k);

  // 2. Base elevation.
  const WARP = 190;
  for (let j = 0; j < N; j++) {
    const z = -HALF + j * CELL;
    for (let i = 0; i < N; i++) {
      const x = -HALF + i * CELL;
      const k0 = j * N + i;
      const qx = x + WARP * nA.n2(x * 0.00105 + 3.1, z * 0.00105 + 9.7);
      const qz = z + WARP * nA.n2(x * 0.00105 + 17.3, z * 0.00105 + 5.5);
      const wn1 = nD.fbm(x * 0.0031 + 5, z * 0.0031 + 2, 3), wn2 = nD.fbm(x * 0.0029 + 91, z * 0.0029 - 40, 3);
      WN1[k0] = wn1; WN2[k0] = wn2;
      const dx = x - ISLAND.cx, dz = z - ISLAND.cz;
      const d = Math.hypot(dx, dz);
      const s = coastRadius(Math.atan2(dz, dx)) - d + 24 * nB.fbm(x * 0.0045, z * 0.0045, 3);
      S[k0] = s;

      const h1 = nA.fbm(qx * 0.0014, qz * 0.0014, 5) * 0.5 + 0.5;
      let e = 6 + 40 * (h1 * h1 * (3 - 2 * h1)) + 5 * nA.fbm(qx * 0.0069 + 40, qz * 0.0069, 3) + 1.6 * nA.fbm(qx * 0.021, qz * 0.021, 2);
      e += 38 * Math.exp(-sq(Math.hypot(x - HEART_HILL.x, z - HEART_HILL.z) / 250));
      const wF = regionWeight(reg[BIOME.FOREST], qx, qz, wn1);
      const wAu = regionWeight(reg[BIOME.AUTUMN], qx, qz, wn2);
      const wA = regionWeight(reg[BIOME.ALPINE], qx, qz, wn1);
      const wB = regionWeight(reg[BIOME.BLOSSOM], qx, qz, wn2);
      const wLv = regionWeight(reg[BIOME.LAVENDER], qx, qz, wn1);
      if (wF > 0.02) e += wF * 34 * (nB.fbm(qx * 0.0041, qz * 0.0041, 4) * 0.5 + 0.5);
      if (wAu > 0.02) e += wAu * 22 * (nB.fbm(qx * 0.0047 + 9, qz * 0.0047, 3) * 0.5 + 0.5);
      if (wLv > 0.02) e += wLv * 9 * nB.fbm(qx * 0.0032 + 21, qz * 0.0032, 2);
      // escarpments: contour steps lift long ledges and mesas in rugged regions
      const rugged = clamp01(wF * 1.1 + wAu * 0.9 + wA * 0.6 + wB * 0.2);
      if (rugged > 0.05 && s > 220) {
        const en = nC.n2(qx * 0.0042 + 5, qz * 0.0042 - 7);
        const hgt = 8 + 10 * (nC.fbm(qx * 0.011, qz * 0.011, 2) * 0.5 + 0.5);
        e += smoothstep(-0.02, 0.02, en) * hgt * rugged;
      }
      if (wA > 0.01) {
        const ridge = nC.ridged(qx * 0.0021, qz * 0.0021, 5);
        e += Math.pow(wA, 1.1) * (115 + 140 * ridge);
        e += 55 * Math.exp(-sq(Math.hypot(x - PEAK.x, z - PEAK.z) / 150));
      }
      if (wB > 0.05 && s > 160 && e > 6) {
        const t = e / 3.4;
        const terr = (Math.floor(t) + smoothstep(0.32, 0.68, t - Math.floor(t))) * 3.4;
        e = lerp(e, terr, 0.6 * Math.pow(wB, 0.7));
      }
      // shoreline profile blended with the interior
      let eShore = s * 0.034 + 0.05 * Math.min(s, 0);
      if (s < 0) {
        eShore += 2.5 * nB.fbm(x * 0.006 + 3, z * 0.006, 3) * smoothstep(0, -160, s);
        e = Math.max(eShore, -58);
      } else {
        eShore += 1.2 * nB.fbm(x * 0.02 + 8, z * 0.02, 2) * smoothstep(-20, 60, s) * (1 - smoothstep(60, 160, s));
        e = lerp(eShore, e, smoothstep(30, 250, s));
      }
      H[k0] = e;
    }
    if ((j & 31) === 31) { rep(0.02 + 0.28 * (j / N), 'Shaping the land'); await yieldFrame(); }
  }

  // helpers over the height grid
  const hBil = (x, z) => W.heightAt(x, z);
  const ellipseT = (lk, x, z) => {
    const dx = x - lk.x, dz = z - lk.z, c = Math.cos(lk.rot), s = Math.sin(lk.rot);
    return Math.hypot((dx * c + dz * s) / lk.rx, (-dx * s + dz * c) / lk.rz);
  };
  const plateau = (cx, cz, r0, r1, height, only) => {
    // blend terrain toward `height` inside r0, fading to natural at r1
    const i0 = clamp(Math.floor((cx - r1 + HALF) / CELL), 0, N - 1), i1 = clamp(Math.ceil((cx + r1 + HALF) / CELL), 0, N - 1);
    const j0 = clamp(Math.floor((cz - r1 + HALF) / CELL), 0, N - 1), j1 = clamp(Math.ceil((cz + r1 + HALF) / CELL), 0, N - 1);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const x = -HALF + i * CELL, z = -HALF + j * CELL;
      const d = Math.hypot(x - cx, z - cz);
      if (d >= r1) continue;
      const w = 1 - smoothstep(r0, r1, d);
      const idx = j * N + i;
      if (only === 'raise' && H[idx] >= height) continue;
      if (only === 'lower' && H[idx] <= height) continue;
      H[idx] = lerp(H[idx], height, w);
    }
  };

  // 3. Resolve automatic landmark positions.
  const lm = LANDMARKS.map((l) => ({ ...l }));
  const byId = Object.fromEntries(lm.map((l) => [l.id, l]));
  const coastPoint = (deg, inland) => {
    const th = (deg * Math.PI) / 180;
    const R = coastRadius(th);
    return { x: ISLAND.cx + Math.cos(th) * (R - inland), z: ISLAND.cz + Math.sin(th) * (R - inland) };
  };
  {
    const p = coastPoint(38, 85); byId.lighthouse.x = p.x; byId.lighthouse.z = p.z; byId.lighthouse.flat = 22; byId.lighthouse.capeH = 10;
    const q = coastPoint(186, -26); byId.seaarch.x = q.x; byId.seaarch.z = q.z;
  }

  // 4. Lakes: carve basins. The level comes from a low percentile of the natural rim so lakes sit in real hollows.
  const carveLake = (lk, pct) => {
    if (lk.forceLevel !== undefined) lk.level = lk.forceLevel;
    else {
      const ring = [];
      for (let k = 0; k < 48; k++) {
        const a = (k / 48) * TAU;
        const ex = Math.cos(a) * lk.rx * 1.25, ez = Math.sin(a) * lk.rz * 1.25;
        const c = Math.cos(lk.rot), s = Math.sin(lk.rot);
        ring.push(hBil(lk.x + ex * c - ez * s, lk.z + ex * s + ez * c));
      }
      ring.sort((a, b) => a - b);
      lk.level = ring[Math.floor(ring.length * pct)] + 0.4;
    }
    const reach = Math.max(lk.rx, lk.rz) * 2.4;
    const i0 = clamp(Math.floor((lk.x - reach + HALF) / CELL), 0, N - 1), i1 = clamp(Math.ceil((lk.x + reach + HALF) / CELL), 0, N - 1);
    const j0 = clamp(Math.floor((lk.z - reach + HALF) / CELL), 0, N - 1), j1 = clamp(Math.ceil((lk.z + reach + HALF) / CELL), 0, N - 1);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const x = -HALF + i * CELL, z = -HALF + j * CELL;
      let t = ellipseT(lk, x, z);
      t *= 1 + 0.14 * nD.fbm(x * 0.013 + lk.x, z * 0.013, 2);
      if (t > 2.2) continue;
      const idx = j * N + i;
      const natural = H[idx];
      if (t < 1) { H[idx] = lk.level - lk.depth * (1 - t * t); continue; }
      const bank = lk.level + 1.8 * smoothstep(1.0, 1.6, t);
      if (natural > bank) H[idx] = lerp(natural, bank, (1 - smoothstep(1.0, 2.0, t)) * 0.9);
      else H[idx] = lerp(natural, bank, 1 - smoothstep(1.2, 1.7, t));
    }
    lk.maskT = 1.28;
    return lk;
  };
  for (const def of LAKES) W.lakes.push(carveLake({ ...def }, def.pct ?? 0.25));
  rep(0.34, 'Filling the lakes');

  // 5. Skyreach Falls: the tarn spills over its lowest rim into a plunge pool below.
  {
    const tarn = W.lakes.find((l) => l.key === 'tarn');
    const ct = Math.cos(tarn.rot), st = Math.sin(tarn.rot);
    const rimAt = (a, m) => {
      const ex = Math.cos(a) * tarn.rx * m, ez = Math.sin(a) * tarn.rz * m;
      return { x: tarn.x + ex * ct - ez * st, z: tarn.z + ex * st + ez * ct };
    };
    // choose the outward direction with the biggest drop within 130 m, biased toward the island interior
    let best = null;
    for (let k = 0; k < 72; k++) {
      const a = (k / 72) * TAU;
      const p0 = rimAt(a, 1.22);
      const dx = p0.x - tarn.x, dz = p0.z - tarn.z, dl = Math.hypot(dx, dz);
      const ux = dx / dl, uz = dz / dl;
      const far = { x: p0.x + ux * 120, z: p0.z + uz * 120 };
      const drop = tarn.level - hBil(far.x, far.z);
      const facing = 0.55 + 0.45 * (ux * 0.85 + uz * 0.5); // prefers east and south
      const score = drop * facing;
      if (!best || score > best.score) best = { a, score, p0, ux, uz, drop };
    }
    const rim = best.p0, ux = best.ux, uz = best.uz;
    // find where the terrain has fallen at least 36 m below the lake
    let len = 60;
    for (let d = 16; d <= 150; d += 4) {
      if (tarn.level - hBil(rim.x + ux * d, rim.z + uz * d) >= 36) { len = d + 6; break; }
      len = d;
    }
    const base = { x: rim.x + ux * len, z: rim.z + uz * len };
    const poolLevel = Math.max(Math.min(hBil(base.x + ux * 24, base.z + uz * 24), tarn.level - 20) - 0.6, 6);
    const pool = { key: 'fallspool', name: 'Falls Pool', x: base.x + ux * 22, z: base.z + uz * 22, rx: 40, rz: 32, rot: Math.atan2(uz, ux), depth: 6, color: '#3aa0b0', forceLevel: poolLevel };
    // cut the cliff profile along the corridor (never raising terrain)
    const hTop = tarn.level - 0.3, hBottom = poolLevel;
    const corridorW = 9;
    const bx0 = Math.min(rim.x, base.x) - 60, bx1 = Math.max(rim.x, base.x) + 60;
    const bz0 = Math.min(rim.z, base.z) - 60, bz1 = Math.max(rim.z, base.z) + 60;
    const i0 = clamp(Math.floor((bx0 + HALF) / CELL), 0, N - 1), i1 = clamp(Math.ceil((bx1 + HALF) / CELL), 0, N - 1);
    const j0 = clamp(Math.floor((bz0 + HALF) / CELL), 0, N - 1), j1 = clamp(Math.ceil((bz1 + HALF) / CELL), 0, N - 1);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const x = -HALF + i * CELL, z = -HALF + j * CELL;
      const rx = x - rim.x, rz = z - rim.z;
      const along = rx * ux + rz * uz;
      const across = Math.abs(rx * -uz + rz * ux);
      if (along < -10 || along > len + 26) continue;
      const wAcross = 1 - smoothstep(corridorW * 0.7, corridorW * 2.6, across);
      if (wAcross <= 0) continue;
      const t = clamp01(along / len);
      const prof = lerp(hTop, hBottom + 1.0, smoothstep(0.06, 0.8, t));
      const idx = j * N + i;
      const channel = prof - (1 - smoothstep(0, corridorW * 0.8, across)) * 1.2;
      H[idx] = lerp(H[idx], Math.min(H[idx], channel + 5 * (1 - wAcross)), wAcross);
    }
    W.lakes.push(carveLake(pool, 0));
    W.falls = { top: { x: rim.x, z: rim.z, y: tarn.level }, dir: { x: ux, z: uz }, len, base, poolLevel, width: 14 };
    byId.falls.x = (rim.x + base.x) / 2; byId.falls.z = (rim.z + base.z) / 2;
  }
  rep(0.4, 'Carving the falls');

  // 6. Reed Pavilion on the Mirrormere shore.
  {
    const mm = W.lakes.find((l) => l.key === 'mirrormere');
    // pick the shore point (t about 1.12) on the south west side
    const a = 2.6;
    const ex = Math.cos(a) * mm.rx * 1.06, ez = Math.sin(a) * mm.rz * 1.06;
    const c = Math.cos(mm.rot), s = Math.sin(mm.rot);
    const px = mm.x + ex * c - ez * s, pz = mm.z + ex * s + ez * c;
    byId.pavilion.x = px; byId.pavilion.z = pz; byId.pavilion.flat = 14; byId.pavilion.baseH = mm.level + 1.1;
    byId.pavilion.lakeCenter = { x: mm.x, z: mm.z };
  }

  // 7. Landmark plateaus.
  for (const l of lm) {
    if (l.id === 'seaarch') continue;
    if (l.id === 'falls') continue;
    if (l.id === 'lighthouse') {
      plateau(l.x, l.z, 42, 110, l.capeH, 'raise');
      plateau(l.x, l.z, l.flat, l.flat + 20, l.capeH);
      continue;
    }
    if (l.id === 'pavilion') {
      plateau(l.x, l.z, l.flat, l.flat + 20, l.baseH);
      continue;
    }
    if (l.flat > 0) {
      const h0 = hBil(l.x, l.z);
      const target = l.id === 'summit' ? h0 : h0;
      plateau(l.x, l.z, l.flat, l.flat * 2.1 + 12, target);
    }
  }

  // ground heights for landmarks
  W.landmarks = lm.map((l) => ({ ...l, y: hBil(l.x, l.z) }));
  rep(0.45, 'Levelling landmarks');

  // 8. Smooth a little to remove sampling jaggies (one light box blur pass on the interior).
  {
    const tmp = new Float32Array(H.length);
    for (let j = 1; j < N - 1; j++) for (let i = 1; i < N - 1; i++) {
      const k = j * N + i;
      const c = H[k];
      const avg = (H[k - 1] + H[k + 1] + H[k - N] + H[k + N]) * 0.25;
      // keep steep cliffs crisp, soften everything else
      const grad = Math.abs(H[k - 1] - H[k + 1]) + Math.abs(H[k - N] - H[k + N]);
      const w = grad > 24 ? 0.08 : 0.4;
      tmp[k] = lerp(c, avg, w);
    }
    for (let j = 1; j < N - 1; j++) for (let i = 1; i < N - 1; i++) H[j * N + i] = tmp[j * N + i];
  }
  rep(0.5, 'Smoothing');
  await yieldFrame();

  // 9. Normals and cavity AO.
  const NM = W.normal;
  const slopeArr = new Float32Array(N * N);
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const k = j * N + i;
      const iL = i > 0 ? k - 1 : k, iR = i < N - 1 ? k + 1 : k, iU = j > 0 ? k - N : k, iD = j < N - 1 ? k + N : k;
      const nx = (H[iL] - H[iR]) / (2 * CELL), nz = (H[iU] - H[iD]) / (2 * CELL);
      const l = Math.hypot(nx, 1, nz);
      const ny = 1 / l;
      slopeArr[k] = 1 - ny;
      NM[k * 4] = Math.round((nx / l * 0.5 + 0.5) * 255);
      NM[k * 4 + 1] = Math.round((ny * 0.5 + 0.5) * 255);
      NM[k * 4 + 2] = Math.round((nz / l * 0.5 + 0.5) * 255);
      // cavity ao from neighbours at 3 cells
      const k2 = 3;
      const iL2 = i >= k2 ? k - k2 : k, iR2 = i < N - k2 ? k + k2 : k, iU2 = j >= k2 ? k - k2 * N : k, iD2 = j < N - k2 ? k + k2 * N : k;
      const avg = (H[iL2] + H[iR2] + H[iU2] + H[iD2]) * 0.25;
      const cav = clamp((avg - H[k]) * 0.05, -0.4, 0.4);
      NM[k * 4 + 3] = Math.round(clamp01(0.9 - cav * 0.9) * 255);
    }
    if ((j & 63) === 63) await yieldFrame();
  }
  rep(0.56, 'Reading the slopes');

  // 10. Biome weights.
  const bw = new Float32Array(BIOME_COUNT);
  const tarn = W.lakes.find((l) => l.key === 'tarn');
  const mirror = W.lakes.find((l) => l.key === 'mirrormere');
  const pools = W.lakes.filter((l) => l.key !== 'tarn' && l.key !== 'mirrormere');
  for (let j = 0; j < N; j++) {
    const z = -HALF + j * CELL;
    for (let i = 0; i < N; i++) {
      const x = -HALF + i * CELL;
      const k = j * N + i;
      const e = H[k], sl = slopeArr[k], s = S[k];
      const qx = x + WARP * nA.n2(x * 0.00105 + 3.1, z * 0.00105 + 9.7);
      const qz = z + WARP * nA.n2(x * 0.00105 + 17.3, z * 0.00105 + 5.5);
      for (let b = 0; b < BIOME_COUNT; b++) bw[b] = 0;
      bw[BIOME.MEADOW] = 0.2;
      for (const r of REGIONS) bw[r.biome] += regionWeight(r, qx, qz, (r.biome & 1) ? WN2[k] : WN1[k]);
      // lake shores
      const tm = ellipseT(mirror, x, z) * (1 + 0.35 * WN1[k]);
      bw[BIOME.LAKE] += 1.6 * (1 - smoothstep(1.0, 1.9, tm));
      // high ground and steep ground turn alpine
      bw[BIOME.ALPINE] += smoothstep(90, 150, e) * 1.6;
      if (e > 40) bw[BIOME.ALPINE] += smoothstep(0.5, 0.85, sl) * 0.7;
      // shore sand near the sea and around the alpine tarn is left alone
      if (s < 500) bw[BIOME.SHORE] += (1 - smoothstep(1.2, 6.5, e)) * 3 * (1 - smoothstep(280, 500, s));
      let sum = 0;
      for (let b = 0; b < BIOME_COUNT; b++) { bw[b] = Math.pow(bw[b], 1.5); sum += bw[b]; }
      const o = k * BIOME_COUNT;
      let acc = 0, bi = 0, bv = -1;
      for (let b = 0; b < BIOME_COUNT; b++) {
        const q = Math.round((bw[b] / sum) * 255);
        W.biome[o + b] = q; acc += q;
        if (q > bv) { bv = q; bi = b; }
      }
      W.biome[o + bi] += 255 - acc; // make the weights sum to exactly 255
    }
    if ((j & 31) === 31) { rep(0.56 + 0.1 * (j / N), 'Sowing the biomes'); await yieldFrame(); }
  }

  // 11. Trees (global list) and canopy density.
  await generateTrees(W, nD, slopeArr, rep);

  // 12. Albedo and flora maps.
  const pal = buildPalettes();
  const rockCol = hexToLinear('#7d7f80'), rockCol2 = hexToLinear('#5f6162'), snowCol = hexToLinear('#dbe4f2');
  const sandWet = hexToLinear('#b5a37c'), seabed = hexToLinear('#c9b98a'), deepbed = hexToLinear('#6d7f86'), mud = hexToLinear('#5d5138');
  const soil = hexToLinear('#7a6244');
  const grassCfg = BIOMES.map((b) => b.grass);
  const A = W.albedo, F = W.flora;
  const fl = W.falls;
  for (let j = 0; j < N; j++) {
    const z = -HALF + j * CELL;
    for (let i = 0; i < N; i++) {
      const x = -HALF + i * CELL;
      const k = j * N + i;
      const e = H[k], sl = slopeArr[k];
      const o = k * BIOME_COUNT;
      const patch = nA.fbm(x * 0.012 + 50, z * 0.012, 3) * 0.5 + 0.5;
      const patch2 = nB.fbm(x * 0.045, z * 0.045 + 20, 2) * 0.5 + 0.5;
      let r = 0, g = 0, b = 0, gd = 0, gh = 0, fd = 0;
      let tR = 0, tG = 0, tB = 0, bR = 0, bG = 0, bB = 0, dR = 0, dG = 0, dB = 0;
      for (let bi = 0; bi < BIOME_COUNT; bi++) {
        const w = W.biome[o + bi] / 255;
        if (w <= 0) continue;
        const pb = pal[bi];
        tR += pb.gTop[0] * w; tG += pb.gTop[1] * w; tB += pb.gTop[2] * w;
        bR += pb.gBot[0] * w; bG += pb.gBot[1] * w; bB += pb.gBot[2] * w;
        dR += pb.gDry[0] * w; dG += pb.gDry[1] * w; dB += pb.gDry[2] * w;
        const p = pal[bi].ground;
        const t1 = smoothstep(0.35, 0.65, patch);
        const t2 = smoothstep(0.55, 0.82, patch2);
        const c0 = p[0], c1 = p[1], c2 = p[2];
        const cr = lerp(lerp(c0[0], c1[0], t1), c2[0], t2 * 0.6);
        const cg = lerp(lerp(c0[1], c1[1], t1), c2[1], t2 * 0.6);
        const cb = lerp(lerp(c0[2], c1[2], t1), c2[2], t2 * 0.6);
        r += cr * w; g += cg * w; b += cb * w;
        gd += grassCfg[bi].density * w;
        gh += grassCfg[bi].height * w;
        fd += BIOMES[bi].flowerDensity * w;
      }
      // the falls run down a bare rock chute
      let fw = 0;
      if (fl) {
        const rx = x - fl.top.x, rz = z - fl.top.z;
        const along = rx * fl.dir.x + rz * fl.dir.z, across = Math.abs(rx * -fl.dir.z + rz * fl.dir.x);
        fw = (1 - smoothstep(fl.width * 0.5, fl.width * 1.5, across)) * smoothstep(-6, 4, along) * (1 - smoothstep(fl.len * 0.68, fl.len * 0.8, along));
      }
      // rock on steep slopes
      const rk = Math.max(smoothstep(0.34, 0.62, sl + 0.06 * (patch2 - 0.5)), fw * 0.92);
      const rc = nD.n2(x * 0.09, z * 0.09) * 0.5 + 0.5;
      const rr = lerp(rockCol[0], rockCol2[0], rc), rg = lerp(rockCol[1], rockCol2[1], rc), rb = lerp(rockCol[2], rockCol2[2], rc);
      r = lerp(r, rr, rk); g = lerp(g, rg, rk); b = lerp(b, rb, rk);
      // snow on high, gentler ground
      const sn = smoothstep(176, 208, e + 14 * (patch - 0.5)) * (1 - smoothstep(0.55, 0.85, sl));
      r = lerp(r, snowCol[0], sn); g = lerp(g, snowCol[1], sn); b = lerp(b, snowCol[2], sn);
      // wet, dark rock beside the falling water
      if (fw > 0) { r *= 1 - 0.32 * fw; g *= 1 - 0.3 * fw; b *= 1 - 0.24 * fw; }
      // underwater and wet shore tints
      let wet = 0;
      if (e < 0) {
        const dpt = smoothstep(0, -18, e);
        r = lerp(seabed[0], deepbed[0], dpt); g = lerp(seabed[1], deepbed[1], dpt); b = lerp(seabed[2], deepbed[2], dpt);
        wet = 1;
      } else if (e < 0.9) {
        const wv = 1 - smoothstep(0, 0.9, e);
        r = lerp(r, sandWet[0], wv); g = lerp(g, sandWet[1], wv); b = lerp(b, sandWet[2], wv);
        wet = wv;
      }
      // grass fades on rock, snow, sand fringe, under water and beneath thick canopy
      const canopy = F[k * 4 + 3] / 255;
      const nearWater = e < 1.2 ? smoothstep(0.2, 1.2, e) : 1;
      let grassD = gd * (1 - rk) * (1 - sn) * nearWater * (1 - 0.7 * canopy) * (1 - fw);
      grassD = clamp01(grassD * (0.75 + 0.5 * patch));
      let flowerD = fd * (1 - rk) * (1 - sn) * nearWater * (1 - 0.8 * canopy) * (1 - fw);
      // flower clumps
      const clump = smoothstep(0.42, 0.72, nC.fbm(x * 0.03 + 77, z * 0.03 - 31, 3) * 0.5 + 0.5);
      flowerD *= clump;
      // bare soil where grass is thin (paths of nature)
      const bare = 1 - smoothstep(0.1, 0.5, grassD);
      r = lerp(r, soil[0], bare * 0.35 * (1 - sn) * (e > 1 ? 1 : 0));
      g = lerp(g, soil[1], bare * 0.35 * (1 - sn) * (e > 1 ? 1 : 0));
      b = lerp(b, soil[2], bare * 0.35 * (1 - sn) * (e > 1 ? 1 : 0));
      // blade colours: dry patches, snow dusting, darker under canopy
      const dryAmt = smoothstep(0.58, 0.86, patch2) * 0.7 + smoothstep(0.72, 0.95, patch) * 0.25;
      tR = lerp(tR, dR, dryAmt); tG = lerp(tG, dG, dryAmt); tB = lerp(tB, dB, dryAmt);
      const shadeC = 1 - 0.3 * canopy;
      const gk = k * 4;
      W.grassTop[gk] = Math.round(linearToSrgb(clamp01(tR * shadeC)) * 255);
      W.grassTop[gk + 1] = Math.round(linearToSrgb(clamp01(tG * shadeC)) * 255);
      W.grassTop[gk + 2] = Math.round(linearToSrgb(clamp01(tB * shadeC)) * 255);
      W.grassTop[gk + 3] = 255;
      W.grassBottom[gk] = Math.round(linearToSrgb(clamp01(bR * shadeC)) * 255);
      W.grassBottom[gk + 1] = Math.round(linearToSrgb(clamp01(bG * shadeC)) * 255);
      W.grassBottom[gk + 2] = Math.round(linearToSrgb(clamp01(bB * shadeC)) * 255);
      W.grassBottom[gk + 3] = 255;
      // mud just above lake level
      A[k * 4] = Math.round(linearToSrgb(clamp01(r)) * 255);
      A[k * 4 + 1] = Math.round(linearToSrgb(clamp01(g)) * 255);
      A[k * 4 + 2] = Math.round(linearToSrgb(clamp01(b)) * 255);
      A[k * 4 + 3] = Math.round(clamp01(wet) * 255);
      F[k * 4] = Math.round(grassD * 255);
      F[k * 4 + 1] = Math.round(clamp01(gh / 1.6) * 255);
      F[k * 4 + 2] = Math.round(clamp01(flowerD) * 255);
      // alpha channel keeps canopy density (written in generateTrees)
    }
    if ((j & 63) === 63) { rep(0.8 + 0.15 * (j / N), 'Painting the ground'); await yieldFrame(); }
  }
  // lake beds tinted by depth (uses mud tone near shore to make shorelines read)
  for (const lk of W.lakes) {
    const reach = Math.max(lk.rx, lk.rz) * 1.6;
    const i0 = clamp(Math.floor((lk.x - reach + HALF) / CELL), 0, N - 1), i1 = clamp(Math.ceil((lk.x + reach + HALF) / CELL), 0, N - 1);
    const j0 = clamp(Math.floor((lk.z - reach + HALF) / CELL), 0, N - 1), j1 = clamp(Math.ceil((lk.z + reach + HALF) / CELL), 0, N - 1);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const k = j * N + i;
      const x = -HALF + i * CELL, z = -HALF + j * CELL;
      const dpt = lk.level - H[k];
      if (dpt > -2.0 && ellipseT(lk, x, z) < 1.2) {
        const w = smoothstep(-0.6, 0.6, dpt) * (1 - smoothstep(0.6, 6, dpt) * 0.35);
        const tone = lerp(0.36, 0.2, smoothstep(0, 9, dpt));
        const bc = [mud[0] * (1 + tone), mud[1] * (1 + tone), mud[2] * (1 + tone)];
        for (let c = 0; c < 3; c++) {
          const cur = A[k * 4 + c] / 255;
          const lin = cur <= 0.04045 ? cur / 12.92 : Math.pow((cur + 0.055) / 1.055, 2.4);
          A[k * 4 + c] = Math.round(linearToSrgb(clamp01(lerp(lin, bc[c], w * 0.85))) * 255);
        }
        const wg = 1 - smoothstep(-1.8, 0.3, dpt);
        F[k * 4] = Math.round(F[k * 4] * wg);
        F[k * 4 + 2] = Math.round(F[k * 4 + 2] * wg);
        A[k * 4 + 3] = Math.max(A[k * 4 + 3], Math.round(w * 255));
      }
    }
  }

  // nothing grows through the stonework of the smaller landmarks
  for (const l of W.landmarks) {
    if (!l.clear) continue;
    const reach = l.clear * 1.4;
    const i0 = clamp(Math.floor((l.x - reach + HALF) / CELL), 0, N - 1), i1 = clamp(Math.ceil((l.x + reach + HALF) / CELL), 0, N - 1);
    const j0 = clamp(Math.floor((l.z - reach + HALF) / CELL), 0, N - 1), j1 = clamp(Math.ceil((l.z + reach + HALF) / CELL), 0, N - 1);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const k = j * N + i;
      const d = Math.hypot(-HALF + i * CELL - l.x, -HALF + j * CELL - l.z);
      const keep = smoothstep(l.clear * 0.7, l.clear * 1.3, d);
      F[k * 4] = Math.round(F[k * 4] * keep);
      F[k * 4 + 2] = Math.round(F[k * 4 + 2] * keep);
    }
  }

  // spawn
  const sp = { x: 40, z: 640 };
  W.spawn = { x: sp.x, z: sp.z, y: hBil(sp.x, sp.z), yaw: 0 };
  W.stats.genMs = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0;
  rep(1, 'Ready');
  return W;
}

// Places every tree in the world on a jittered grid, and bakes a coarse canopy density map.
async function generateTrees(W, noise, slopeArr, rep) {
  const N = GRID;
  const TC = 8;
  const cells = Math.floor(WORLD_SIZE / TC);
  const list = [];
  const bwv = new Float32Array(BIOME_COUNT);
  const keepOut = W.landmarks.map((l) => ({ x: l.x, z: l.z, r: Math.max(l.flat * 1.5, 12) + (l.id === 'heartbloom' ? 30 : 0) }));
  const spawnKeep = { x: 40, z: 640, r: 34 };
  const fl = W.falls;
  const treeDens = BIOMES.map((b) => b.treeDensity);
  const treeKinds = BIOMES.map((b) => b.trees.map((t) => [TREE_INDEX[t[0]], t[1]]));
  for (let cj = 0; cj < cells; cj++) {
    for (let ci = 0; ci < cells; ci++) {
      const r1 = hash2f(ci, cj, 11), r2 = hash2f(ci, cj, 12), r3 = hash2f(ci, cj, 13), r4 = hash2f(ci, cj, 14), r5 = hash2f(ci, cj, 15);
      const x = -HALF + (ci + r1) * TC, z = -HALF + (cj + r2) * TC;
      const gi = clamp(Math.round((x + HALF) / CELL), 0, N - 1), gj = clamp(Math.round((z + HALF) / CELL), 0, N - 1);
      const k = gj * N + gi;
      const e = W.height[k];
      if (e < 1.5) continue;
      const sl = slopeArr[k];
      if (sl > 0.3) continue;
      let dens = 0;
      const o = k * BIOME_COUNT;
      for (let b = 0; b < BIOME_COUNT; b++) { bwv[b] = W.biome[o + b] / 255; dens += bwv[b] * treeDens[b]; }
      const clumpN = noise.fbm(x * 0.018 + 12, z * 0.018, 3) * 0.5 + 0.5;
      const clumps = 0.35 + 1.3 * smoothstep(0.3, 0.7, clumpN);
      const p = (dens * 0.064) * clumps;
      if (r3 > p) continue;
      let skip = false;
      for (const ko of keepOut) if (Math.hypot(x - ko.x, z - ko.z) < ko.r) { skip = true; break; }
      if (skip || Math.hypot(x - spawnKeep.x, z - spawnKeep.z) < spawnKeep.r) continue;
      if (fl) { // nothing grows in the flowing water of the falls
        const rx = x - fl.top.x, rz = z - fl.top.z;
        const al = rx * fl.dir.x + rz * fl.dir.z, ac = Math.abs(rx * -fl.dir.z + rz * fl.dir.x);
        if (al > -8 && al < fl.len + 10 && ac < 12) continue;
      }
      let nearLake = false;
      for (const lk of W.lakes) {
        const dx = x - lk.x, dz = z - lk.z, c = Math.cos(lk.rot), s = Math.sin(lk.rot);
        const t = Math.hypot((dx * c + dz * s) / lk.rx, (-dx * s + dz * c) / lk.rz);
        if (t < 1.08 || (lk.forceLevel !== undefined && e < lk.level + 1.5 && t < 1.6)) { nearLake = true; break; }
      }
      if (nearLake) continue;
      // choose biome by weighted density, then a tree kind within it
      let tot = 0;
      for (let b = 0; b < BIOME_COUNT; b++) tot += bwv[b] * treeDens[b];
      let pick = r4 * tot, bi = 0;
      for (let b = 0; b < BIOME_COUNT; b++) { pick -= bwv[b] * treeDens[b]; if (pick <= 0) { bi = b; break; } }
      const kinds = treeKinds[bi];
      let ksum = 0; for (const kk of kinds) ksum += kk[1];
      let kp = r5 * ksum, kind = kinds[0][0];
      for (const kk of kinds) { kp -= kk[1]; if (kp <= 0) { kind = kk[0]; break; } }
      // alpine only grows trees below the tree line, and shore only has palms near beaches
      if (bi === BIOME.ALPINE && e > 118) continue;
      const scale = 0.8 + 0.45 * hash2f(ci, cj, 16);
      const yaw = hash2f(ci, cj, 17) * TAU;
      list.push(x, e, z, scale, yaw, kind, hash2f(ci, cj, 18));
    }
  }
  const count = list.length / 7;
  W.trees = new Float32Array(list);
  W.treeCount = count;
  // spatial grid
  const G = W.treeGridN;
  const counts = new Uint32Array(G * G + 1);
  const cellOf = new Uint32Array(count);
  for (let t = 0; t < count; t++) {
    const ci = clamp(Math.floor((W.trees[t * 7] + HALF) / TREE_CELL), 0, G - 1);
    const cj = clamp(Math.floor((W.trees[t * 7 + 2] + HALF) / TREE_CELL), 0, G - 1);
    cellOf[t] = cj * G + ci;
    counts[cellOf[t] + 1]++;
  }
  for (let c = 0; c < G * G; c++) counts[c + 1] += counts[c];
  W.treeGridStart = counts;
  W.treeGridIdx = new Uint32Array(count);
  const fill = counts.slice(0, G * G);
  for (let t = 0; t < count; t++) W.treeGridIdx[fill[cellOf[t]]++] = t;
  // canopy density map (0..255 in flora alpha)
  const canopy = new Float32Array(N * N);
  for (let t = 0; t < count; t++) {
    const x = W.trees[t * 7], z = W.trees[t * 7 + 2], sc = W.trees[t * 7 + 3], kind = W.trees[t * 7 + 5];
    const tk = TREES[kind];
    const rad = (tk.crown[0] + tk.crown[1]) * 0.5 * sc * 1.15;
    const i0 = clamp(Math.floor((x - rad + HALF) / CELL), 0, N - 1), i1 = clamp(Math.ceil((x + rad + HALF) / CELL), 0, N - 1);
    const j0 = clamp(Math.floor((z - rad + HALF) / CELL), 0, N - 1), j1 = clamp(Math.ceil((z + rad + HALF) / CELL), 0, N - 1);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const d = Math.hypot(-HALF + i * CELL - x, -HALF + j * CELL - z);
      const w = 1 - smoothstep(rad * 0.4, rad, d);
      const idx = j * N + i;
      canopy[idx] = 1 - (1 - canopy[idx]) * (1 - w * 0.75);
    }
  }
  for (let k = 0; k < N * N; k++) W.flora[k * 4 + 3] = Math.round(clamp01(canopy[k]) * 255);
  rep(0.78, 'Planting trees');
  await yieldFrame();
}

// Renders a stylised map (hillshaded, biome coloured) to RGBA pixels. size x size.
export function renderMapPixels(W, size = 512) {
  const out = new Uint8ClampedArray(size * size * 4);
  const N = GRID;
  const L = [-0.55, 0.75, -0.35];
  const ll = Math.hypot(L[0], L[1], L[2]);
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const gi = clamp(Math.floor((px / size) * N), 0, N - 1);
      const gj = clamp(Math.floor((py / size) * N), 0, N - 1);
      const k = gj * N + gi;
      const e = W.height[k];
      const nx = (W.normal[k * 4] / 255) * 2 - 1, ny = (W.normal[k * 4 + 1] / 255) * 2 - 1, nz = (W.normal[k * 4 + 2] / 255) * 2 - 1;
      const ex = 3.2; const nl = Math.hypot(nx * ex, ny, nz * ex); const shade = clamp01(((nx * ex) * L[0] + ny * L[1] + (nz * ex) * L[2]) / (ll * nl) * 0.6 + 0.62);
      let r = W.albedo[k * 4], g = W.albedo[k * 4 + 1], b = W.albedo[k * 4 + 2];
      let wl = e < 0 ? 0 : null;
      if (wl === null) for (const lk of W.lakes) { if (e < lk.level - 0.05) { const t = Math.hypot(((-HALF + gi * CELL) - lk.x) / (lk.rx * 1.5), ((-HALF + gj * CELL) - lk.z) / (lk.rz * 1.5)); if (t < 1.4) { wl = lk.level; break; } } }
      if (wl !== null) {
        const d = clamp01((wl - e) / 24);
        r = lerp(120, 30, d); g = lerp(200, 100, d); b = lerp(215, 150, d);
        out[(py * size + px) * 4] = r; out[(py * size + px) * 4 + 1] = g; out[(py * size + px) * 4 + 2] = b; out[(py * size + px) * 4 + 3] = 255;
        continue;
      }
      const s = 0.55 + shade * 0.75;
      out[(py * size + px) * 4] = clamp(r * s, 0, 255);
      out[(py * size + px) * 4 + 1] = clamp(g * s, 0, 255);
      out[(py * size + px) * 4 + 2] = clamp(b * s, 0, 255);
      out[(py * size + px) * 4 + 3] = 255;
    }
  }
  return out;
}
