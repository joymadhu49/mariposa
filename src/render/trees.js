// Trees: procedural geometry per kind and LOD, one painted shader, and a streaming instance system.
//
// Foliage is built from leaf cluster cards (alpha cutout quads painted in treetex.js) scattered through each crown
// volume around a dark solid core, with vertex normals bent toward the crown so the light reads as one soft volume.
// Trunks and branches are smooth tubes with real UVs into painted bark tiles.
//
// Vertex data is packed into the four existing attributes so mergeGeos() and every attribute copy list keep working:
//   color.r, color.g = uv (cell local for foliage cards, bark tile for bark)
//   color.b          = snow (or moss) | mix << 8 | light << 16   (three 8 bit values in one exact float)
//   aPart            = part code (0..15) + 16 * extra (8 bit; cards: phase * 2 + atlas variant)
// part codes: 0 legacy bark (raw MeshBuilder cylinders, color = tint), 1 legacy foliage (color = light, snow, mix),
//             2 solid crown core, 3 leaf card, 4 textured bark.
import * as THREE from 'three';
import { MeshBuilder } from './meshbuilder.js';
import { G, GLSL_UNIFORMS, GLSL_FUNCS } from './shaders.js';
import { TREES } from '../world/biomes.js';
import { hexToLinear, clamp, mulberry32 } from '../core/util.js';
import { getTreeTextures, CELLS, cellRect } from './treetex.js';

const TAU = Math.PI * 2;

// ---- vertex packing -------------------------------------------------------------------------------
const P_CORE = 2, P_CARD = 3, P_BARK = 4;
const q8 = (v) => (v <= 0 ? 0 : v >= 1 ? 255 : Math.round(v * 255));
const packTone = (snow, mixv, light) => q8(snow) + 256 * q8(mixv) + 65536 * q8(light);
const partOf = (code, extra = 0) => code + 16 * extra;
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const hash1 = (n) => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };

// ---- crown: solid core plus leaf cards --------------------------------------------------------------
// vol describes the whole crown ellipsoid so every blob shares one smooth light gradient.
function makeVolume(blobs) {
  let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9, z0 = 1e9, z1 = -1e9;
  for (const [x, y, z, r, sq = 0.85] of blobs) {
    x0 = Math.min(x0, x - r); x1 = Math.max(x1, x + r);
    y0 = Math.min(y0, y - r * sq); y1 = Math.max(y1, y + r * sq);
    z0 = Math.min(z0, z - r); z1 = Math.max(z1, z + r);
  }
  return { cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, cz: (z0 + z1) / 2, rx: (x1 - x0) / 2, ry: (y1 - y0) / 2, rz: (z1 - z0) / 2 };
}

const _o = [0, 0, 0, 0];
// normal (bent toward the crown) and light (dark inside and low, bright outside and high) at a point in a blob
function shadeAt(x, y, z, blob, vol, faceN) {
  const [bx, by, bz, br, sq] = blob;
  const bry = br * sq;
  let ax = (x - bx) / (br * br), ay = (y - by) / (bry * bry), az = (z - bz) / (br * br);
  let l = Math.hypot(ax, ay, az) || 1; ax /= l; ay /= l; az /= l;
  let cxn = (x - vol.cx) / (vol.rx * vol.rx), cyn = (y - vol.cy) / (vol.ry * vol.ry), czn = (z - vol.cz) / (vol.rz * vol.rz);
  l = Math.hypot(cxn, cyn, czn) || 1; cxn /= l; cyn /= l; czn /= l;
  let nx = ax * 0.5 + cxn * 0.5, ny = ay * 0.5 + cyn * 0.5 + 0.1, nz = az * 0.5 + czn * 0.5;
  l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
  if (faceN) {
    const d = faceN[0] * nx + faceN[1] * ny + faceN[2] * nz;
    const s = d < 0 ? -0.16 : 0.16;
    nx = nx * 0.84 + faceN[0] * s; ny = ny * 0.84 + faceN[1] * s; nz = nz * 0.84 + faceN[2] * s;
    l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
  }
  const dx = (x - vol.cx) / vol.rx, dy = (y - vol.cy) / vol.ry, dz = (z - vol.cz) / vol.rz;
  const rho = Math.min(1.15, Math.hypot(dx, dy, dz));
  const up = clamp01((y - (vol.cy - vol.ry)) / (2 * vol.ry));
  _o[0] = nx; _o[1] = ny; _o[2] = nz;
  _o[3] = clamp01(0.2 + 0.56 * Math.pow(rho, 1.4) + 0.3 * up);
  return _o;
}

// one leaf card. P centre, R right axis, U up axis (unit), hw hh half sizes.
function addCard(b, P, R, U, hw, hh, blob, vol, rnd, o) {
  const flip = rnd() < 0.5;
  const ph = Math.floor(rnd() * 128) * 2 + (rnd() < 0.5 ? 1 : 0);
  const faceN = [R[1] * U[2] - R[2] * U[1], R[2] * U[0] - R[0] * U[2], R[0] * U[1] - R[1] * U[0]];
  const mixc = clamp01(o.mixv + (rnd() - 0.5) * (o.mixJitter ?? 0.3));
  const id = [];
  for (let c = 0; c < 4; c++) {
    const sx = c === 1 || c === 2 ? 1 : -1, sy = c < 2 ? 1 : -1;
    const x = P[0] + R[0] * hw * sx + U[0] * hh * sy, y = P[1] + R[1] * hw * sx + U[1] * hh * sy, z = P[2] + R[2] * hw * sx + U[2] * hh * sy;
    const s = shadeAt(x, y, z, blob, vol, faceN);
    const u = (sx > 0) !== flip ? 1 : 0, v = sy > 0 ? 0 : 1;
    id.push(b.vertex(x, y, z, s[0], s[1], s[2], [u, v, packTone(o.snow * s[1] * s[1], mixc, s[3])], partOf(P_CARD, ph), 0));
  }
  b.tri(id[0], id[1], id[2]); b.tri(id[0], id[2], id[3]);
}

// fill one ellipsoid with cards. o: lod, seed, mixv, snow, cover (layers), half (card half size)
function cardsFor(b, blob, vol, o) {
  const [cx, cy, cz, r, sq] = blob;
  const rnd = mulberry32(o.seed * 7919 + 13);
  const ry = r * sq;
  const half = o.half ?? clamp(0.29 * r + 0.16, 0.5, 1.5) * (o.sizeMul || 1);
  const n = o.count ?? Math.max(4, Math.round(o.cover * 5.2 * (r / half) * (r / half)));
  for (let k = 0; k < n; k++) {
    const gy = 1 - (2 * (k + 0.5)) / n, rr = Math.sqrt(Math.max(0, 1 - gy * gy)), th = k * 2.399963 + rnd() * 0.6;
    const dx = Math.cos(th) * rr, dy = gy, dz = Math.sin(th) * rr;
    const rho = 0.64 + 0.36 * Math.pow(rnd(), 0.7);
    const P = [cx + dx * r * rho, cy + dy * ry * rho, cz + dz * r * rho];
    // card facing: mostly along the surface normal, some tilted, some edge on for a leafy silhouette
    const m = rnd();
    let nx, ny, nz;
    if (m < 0.62) { nx = dx + (rnd() - 0.5) * 0.8; ny = dy + (rnd() - 0.5) * 0.8; nz = dz + (rnd() - 0.5) * 0.8; }
    else if (m < 0.88) { nx = dx + (rnd() - 0.5) * 2; ny = dy + (rnd() - 0.5) * 2; nz = dz + (rnd() - 0.5) * 2; }
    else { const tx = rnd() - 0.5, ty = rnd() - 0.5, tz = rnd() - 0.5; const d = tx * dx + ty * dy + tz * dz; nx = tx - dx * d; ny = ty - dy * d; nz = tz - dz * d; }
    let l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
    // up axis: world up projected on the card plane, then a random roll
    let ux = -nx * ny, uy = 1 - ny * ny, uz = -nz * ny;
    l = Math.hypot(ux, uy, uz);
    if (l < 0.2) { ux = dx; uy = 0; uz = dz; l = Math.hypot(ux, uz) || 1; }
    ux /= l; uy /= l; uz /= l;
    let rx = uy * nz - uz * ny, ry2 = uz * nx - ux * nz, rz = ux * ny - uy * nx;
    const roll = (rnd() - 0.5) * 1.2, cr = Math.cos(roll), sr = Math.sin(roll);
    const U = [ux * cr + rx * sr, uy * cr + ry2 * sr, uz * cr + rz * sr], R = [rx * cr - ux * sr, ry2 * cr - uy * sr, rz * cr - uz * sr];
    const s = half * (0.8 + 0.45 * rnd()) * (m > 0.88 ? 0.78 : 1);
    addCard(b, P, R, U, s, s, blob, vol, rnd, o);
  }
}

// solid dark core so the crown never looks hollow between cards
function coreFor(b, blob, vol, o) {
  const [cx, cy, cz, r, sq] = blob;
  b.push().translate(cx, cy, cz);
  b.sphere({
    r: r * (o.coreScale || 0.68), detail: o.coreDetail || 0, part: partOf(P_CORE), flat: false, squashY: sq, shadeBottom: 0, shadeTop: 0, color: [0, 0, 0],
    colorFn: (a, c) => [0, 0, packTone(o.snow * Math.max(0, c), o.mixv, 0.3 + 0.3 * (c * 0.5 + 0.5))],
  });
  b.pop();
}

function buildCrown(b, blobsIn, lod, o = {}) {
  const blobs = blobsIn.map((v) => [v[0], v[1], v[2], v[3], o.squash ?? 0.85]);
  const vol = o.vol || makeVolume(blobs);
  const cover = [1.1, 1.0, 1.0][lod] * (o.cover || 1);
  blobs.forEach((bl, i) => {
    const mixv = (o.mixFn ? o.mixFn(i) : (i % 4) / 4);
    const oo = { lod, seed: (o.seed || 5) + i * 31, mixv, snow: o.snow || 0, cover, sizeMul: (o.sizeMul || 1) * [1.06, 1.5, 1.7][lod], count: o.counts && o.counts[lod] ? o.counts[lod][i] : undefined, coreDetail: 0, coreScale: o.coreScale };
    coreFor(b, bl, vol, oo);
    cardsFor(b, bl, vol, oo);
  });
}

// legacy entry point (giant trees in landmarks.js): one ellipsoid of leaves around (x, y, z).
// The blobs of one builder are collected and emitted together at build() so the whole crown shares one smooth
// light gradient (the caller builds each blob separately and knows nothing about the others).
const DEFERRED = new WeakMap();
export function blob(b, x, y, z, r, { detail = 1, squash = 0.85, seed = 1, mixv = 0, snow = 0, cover = 1.2 } = {}) {
  let d = DEFERRED.get(b);
  if (!d) {
    d = { list: [], build: b.build };
    DEFERRED.set(b, d);
    b.build = function () {
      DEFERRED.delete(b);
      b.build = d.build;
      const vol = makeVolume(d.list.map((e) => e.bl));
      for (const e of d.list) {
        const [, , , rr] = e.bl;
        const o = { lod: e.detail ? 0 : 1, seed: e.seed, mixv: e.mixv, snow: e.snow, cover: e.cover * 1.0, half: clamp(0.17 * rr + 0.5, 0.9, 1.75), coreDetail: 1, coreScale: 0.6 };
        b.stack.push(e.m);
        coreFor(b, e.bl, vol, o);
        cardsFor(b, e.bl, vol, o);
        b.stack.pop();
      }
      return d.build.call(b);
    };
  }
  d.list.push({ m: b.m.clone(), bl: [x, y, z, r, squash], detail, seed, mixv, snow, cover });
}

// ---- trunks and branches --------------------------------------------------------------------------
// smooth tube along local +Y through rings [[y, radius]...] with bark uvs. o: urep, vTile, v0, moss(y), light(y), lump, seed
function tube(b, rings, seg, o) {
  const rows = [];
  for (let i = 0; i < rings.length; i++) {
    const [y, r] = rings[i];
    const nxt = rings[Math.min(i + 1, rings.length - 1)], prv = rings[Math.max(i - 1, 0)];
    const slope = (prv[1] - nxt[1]) / Math.max(nxt[0] - prv[0], 1e-4);
    const row = [];
    const pk = packTone(o.moss ? o.moss(y) : 0, 0.5, o.light ? o.light(y) : 1);
    for (let k = 0; k <= seg; k++) {
      const a = (k / seg) * TAU, ca = Math.cos(a), sa = Math.sin(a);
      const lump = 1 + (o.lump || 0) * (hash1((k % seg) * 3.1 + i * 7.7 + (o.seed || 0)) - 0.5) * 2;
      row.push(b.vertex(ca * r * lump, y, sa * r * lump, ca, slope, sa, [(k / seg) * o.urep, ((o.v0 || 0) + y) / o.vTile, pk], partOf(P_BARK), 0));
    }
    rows.push(row);
  }
  for (let i = 0; i < rows.length - 1; i++) {
    for (let k = 0; k < seg; k++) {
      const a = rows[i][k], bb = rows[i][k + 1], c = rows[i + 1][k], d = rows[i + 1][k + 1];
      b.tri(a, c, bb); b.tri(bb, c, d);
    }
  }
}

const BARK_INFO = [
  { key: 'oak', moss: 0.75 }, { key: 'cherry', moss: 0.3 }, { key: 'pine', moss: 0.5 }, { key: 'birch', moss: 0.22 },
  { key: 'maple', moss: 0.6 }, { key: 'palm', moss: 0.0 }, { key: 'pine', moss: 0.35 },
];

export function trunk(b, { r0, r1, h, seg = 6, lean = 0, y0 = 0, taperRoots = true, rings = 0, moss = 0.6, vTile = 2.8, lump = 0.05, seed = 1 }) {
  b.push();
  if (lean) b.rotZ(lean);
  const nr = rings || (seg >= 7 ? 6 : seg >= 5 ? 3 : 2);
  const ys = [];
  if (nr <= 2) ys.push(0, h);
  else if (nr === 3) ys.push(0, Math.min(0.7, h * 0.2), h);
  else if (nr === 4) ys.push(0, 0.45, h * 0.5, h);
  else ys.push(0, 0.2, 0.55, 1.1, h * 0.5, h);
  const rg = ys.map((y) => {
    const base = r0 + (r1 - r0) * (y / h);
    const flare = taperRoots ? 1 + 0.7 * Math.exp(-y / 0.34) : 1;
    return [y0 + y, base * flare];
  });
  const urep = Math.max(1, Math.round((TAU * r0) / 1.5));
  tube(b, rg, seg, { urep, vTile, v0: 0, lump: seg >= 5 ? lump : 0, seed, moss: (y) => clamp01(1 - y / 1.9) * moss, light: (y) => clamp01(0.42 + 0.58 * Math.min(1, y / 1.4)) * (1 - 0.38 * clamp01((y - h * 0.62) / (h * 0.38))) });
  b.pop();
}

export function branch(b, x, y, z, rotY, tilt, len, r, seg = 5) {
  b.push().translate(x, y, z).rotY(rotY).rotZ(-tilt);
  tube(b, [[0, r], [len * 0.5, r * 0.62], [len * 1.1, r * 0.26]], seg, { urep: Math.max(1, Math.round((TAU * r) / 1.5)), vTile: 2.8, v0: 0, lump: 0.05, seed: x + y, moss: (yy) => 0, light: (yy) => 0.62 + 0.3 * (yy / len) });
  b.pop();
}

// ---- species builders -------------------------------------------------------------------------------

// single triangle per side cone (no degenerate quads). c0 / c1 are packed colours at the base and the apex.
function spikeCone(b, { r, h, seg, c0, c1, part = partOf(P_CORE) }) {
  const slope = r / h;
  const apex = b.vertex(0, h, 0, 0, 1, 0, c1, part, 0);
  const ring = [];
  for (let k = 0; k < seg; k++) { const a = (k / seg) * TAU; ring.push(b.vertex(Math.cos(a) * r, 0, Math.sin(a) * r, Math.cos(a), slope, Math.sin(a), c0, part, 0)); }
  for (let k = 0; k < seg; k++) b.tri(ring[k], apex, ring[(k + 1) % seg]);
}

// one bough of needles. horizontal: a drooping spray seen from above; vertical: the same spray seen from the side.
function boughCard(b, dx, dz, L, Wd, yb, droop, roll, vertical, o) {
  const rings = o.rings;
  const px = -dz, pz = dx;
  const cs = Math.cos(roll), sn = Math.sin(roll);
  const ph = Math.floor(o.rnd() * 128) * 2;
  const ids = [];
  for (let s = 0; s <= rings; s++) {
    const f = s / rings;
    const rad = 0.25 + (L - 0.25) * f;
    const yc = yb - droop * f * f;
    for (let side = 0; side < 2; side++) {
      let x, y, z, nx, ny, nz, light;
      if (vertical) {
        const hh = Wd * (side ? -0.5 : 0.5);
        x = dx * rad; z = dz * rad; y = yc + hh;
        nx = dx * 0.7; ny = 0.55; nz = dz * 0.7;
        light = 0.3 + 0.5 * (1 - side * 0.55) - 0.12 * f + 0.2 * o.t;
      } else {
        const w = Wd * 0.5 * (side ? 1 : -1);
        x = dx * rad + px * w * cs; z = dz * rad + pz * w * cs; y = yc + sn * w * 0.7;
        nx = dx * 0.5; ny = 0.8; nz = dz * 0.5;
        light = 0.34 + 0.46 * (1 - f * 0.35) + 0.2 * o.t;
      }
      const nl = Math.hypot(nx, ny, nz);
      ids.push(b.vertex(x, y, z, nx / nl, ny / nl, nz / nl, [f, side, packTone(o.snow * (vertical && !side ? 1.3 : 0.8), o.mixv, clamp01(light))], partOf(P_CARD, ph), 0));
    }
  }
  for (let s = 0; s < rings; s++) {
    const a0 = ids[s * 2], a1 = ids[s * 2 + 1], b0 = ids[s * 2 + 2], b1 = ids[s * 2 + 3];
    b.tri(a0, b0, a1); b.tri(a1, b0, b1);
  }
}

function pineTier(b, i, layers, lod, snowy, rnd) {
  const t = layers > 1 ? i / (layers - 1) : 0;
  const y = 2.2 + t * 10.5;
  const r = 3.3 * (1 - t * 0.82) * (lod === 2 ? 1.12 : 1);
  const h = 4.3 * (1 - t * 0.35);
  const mixv = 0.25 + 0.5 * t;
  const snow = snowy ? 0.04 + 0.22 * t : 0;
  const seg = lod === 0 ? 7 : lod === 1 ? 6 : 5;
  // solid cone body under the boughs
  b.push().translate(0, y - 0.15, 0).rotY(i * 0.83);
  spikeCone(b, { r: r * (lod === 0 ? 0.42 : lod === 1 ? 0.7 : 0.85), h: h * 0.92, seg, c0: [0, 0, packTone(0, mixv, 0.26)], c1: [0, 0, packTone(snow, mixv, 0.72)] });
  b.pop();
  if (lod === 2) return;
  const n = lod === 0 ? Math.round(9 - 3.5 * t) : Math.max(4, Math.round(5 - 1.5 * t));
  for (let k = 0; k < n; k++) {
    const a = ((k + rnd() * 0.6) / n) * TAU + i * 1.13;
    const dx = Math.cos(a), dz = Math.sin(a);
    const L = r * (1.0 + rnd() * 0.12) * (lod === 0 ? 1 : 1.12);
    const Wd = clamp(0.62 * L + 0.7, 1.0, 2.5) * (lod === 0 ? 1 : 1.2);
    const yb = y + 0.05 + rnd() * 1.15;
    const droop = 0.35 + 0.25 * L;
    const o = { rings: lod === 0 ? 3 : 2, mixv, snow, t, rnd };
    boughCard(b, dx, dz, L, Wd, yb, droop, (rnd() - 0.5) * 1.3, false, o);
    if (lod === 0) boughCard(b, dx, dz, L * 0.96, Wd * 0.9, yb + 0.1, droop, 0, true, { ...o, rings: 2 });
  }
}

export function buildTree(kind, lod) {
  const b = new MeshBuilder();
  const seed = kind * 13 + 5;
  const tseg = lod === 0 ? 7 : lod === 1 ? 5 : 3;
  const bk = BARK_INFO[kind];
  switch (kind) {
    case 0: { // oak
      trunk(b, { r0: 0.5, r1: 0.26, h: 4.6, seg: tseg, moss: bk.moss, seed });
      if (lod === 0) { branch(b, 0, 3.4, 0, 0.6, 0.9, 2.6, 0.16); branch(b, 0, 3.9, 0, 3.5, 0.8, 2.4, 0.14); branch(b, 0, 3.0, 0, 5.4, 1.0, 2.0, 0.13); }
      const B = lod === 0 ? [[0, 7.4, 0, 3.9], [2.7, 6.5, 0.7, 3.0], [-2.5, 6.9, -0.9, 3.1], [0.6, 6.4, 2.6, 2.8], [-0.7, 8.7, -0.5, 2.6]] : lod === 1 ? [[0, 7.3, 0, 4.1], [2.4, 6.4, 0.5, 2.9], [-2.3, 6.8, -0.8, 3.0]] : [[0, 7.0, 0, 4.4]];
      buildCrown(b, B, lod, { seed, squash: 0.85, mixFn: (i) => (i % 3) / 3, counts: [null, [14, 10, 10], [6]] });
      break;
    }
    case 1: { // cherry
      trunk(b, { r0: 0.42, r1: 0.2, h: 3.4, seg: tseg, lean: 0.06, moss: bk.moss, seed });
      if (lod === 0) { branch(b, 0.1, 2.6, 0, 0.3, 0.8, 2.2, 0.13); branch(b, 0.1, 2.9, 0, 3.6, 0.9, 2.3, 0.12); branch(b, 0.1, 2.4, 0, 5.3, 1.05, 1.9, 0.11); }
      const B = lod === 0 ? [[0.2, 5.4, 0, 3.3], [2.7, 4.9, 0.6, 2.6], [-2.6, 5.0, -0.7, 2.7], [0.5, 4.7, 2.7, 2.4], [-0.4, 6.6, -0.4, 2.3], [0.2, 4.6, -2.6, 2.4]] : lod === 1 ? [[0.2, 5.3, 0, 3.5], [2.4, 4.8, 0.5, 2.6], [-2.4, 4.9, -0.7, 2.6]] : [[0.2, 5.1, 0, 3.9]];
      buildCrown(b, B, lod, { seed, squash: 0.72, mixFn: (i) => (i % 4) / 4, counts: [null, [14, 10, 10], [6]] });
      break;
    }
    case 2: case 6: { // pine and frost pine
      const snowy = kind === 6;
      // the trunk ends inside the spire so no bare stick shows above the crown
      trunk(b, { r0: 0.4, r1: 0.16, h: 14.0, seg: tseg, rings: lod === 0 ? 4 : lod === 1 ? 3 : 2, moss: bk.moss, seed, vTile: 3.2 });
      const layers = lod === 0 ? 9 : lod === 1 ? 5 : 4;
      const rnd = mulberry32(seed * 977);
      for (let i = 0; i < layers; i++) pineTier(b, i, layers, lod, snowy, rnd);
      if (lod < 2) { // spire
        b.push().translate(0, 12.9, 0);
        spikeCone(b, { r: 0.42, h: 2.4, seg: 5, c0: [0, 0, packTone(0, 0.7, 0.4)], c1: [0, 0, packTone(snowy ? 0.5 : 0, 0.7, 0.8)] });
        b.pop();
      }
      break;
    }
    case 3: { // birch
      trunk(b, { r0: 0.26, r1: 0.13, h: 6.6, seg: lod === 0 ? 6 : lod === 1 ? 4 : 3, moss: bk.moss, seed, vTile: 2.4, lump: 0.03 });
      const B = lod === 0 ? [[0, 6.6, 0, 1.9], [0.9, 7.8, 0.3, 1.6], [-0.9, 8.5, -0.4, 1.5], [0.2, 5.6, 1.1, 1.4]] : lod === 1 ? [[0, 6.8, 0, 2.2], [0.3, 8.3, 0, 1.7]] : [[0, 7.3, 0, 2.5]];
      buildCrown(b, B, lod, { seed, squash: 1.2, mixFn: (i) => (i % 3) / 3, cover: 1.05, coreScale: 0.42, counts: [null, [22, 20], [6]] });
      break;
    }
    case 4: { // maple
      trunk(b, { r0: 0.52, r1: 0.26, h: 4.2, seg: tseg, moss: bk.moss, seed });
      if (lod === 0) { branch(b, 0, 3.2, 0, 0.4, 0.85, 2.7, 0.17); branch(b, 0, 3.6, 0, 3.4, 0.8, 2.5, 0.15); branch(b, 0, 2.9, 0, 5.2, 1.0, 2.2, 0.14); }
      const B = lod === 0 ? [[0, 7.2, 0, 4.2], [3.0, 6.3, 0.8, 3.3], [-2.9, 6.7, -1.0, 3.4], [0.7, 6.2, 3.0, 3.0], [-0.9, 8.7, -0.6, 2.8], [1.4, 5.8, -2.8, 2.7]] : lod === 1 ? [[0, 7.1, 0, 4.4], [2.8, 6.2, 0.7, 3.2], [-2.7, 6.5, -0.9, 3.3]] : [[0, 6.9, 0, 4.9]];
      buildCrown(b, B, lod, { seed, squash: 0.85, mixFn: (i) => ((i * 2 + 1) % 5) / 5, counts: [null, [14, 10, 10], [6]] });
      break;
    }
    case 5: { // palm
      const rings = lod === 0 ? 9 : lod === 1 ? 5 : 2;
      const H = 7.6, seg = lod === 0 ? 7 : lod === 1 ? 5 : 3;
      const pts = [];
      for (let i = 0; i < rings; i++) { const t = i / (rings - 1); pts.push([Math.sin(t * 0.9) * 1.6, t * H, t]); }
      const rows = [];
      let arc = 0;
      for (let i = 0; i < rings; i++) {
        const p = pts[i], q = pts[Math.min(i + 1, rings - 1)], o = pts[Math.max(i - 1, 0)];
        const ang = Math.atan2(q[0] - o[0], q[1] - o[1]);
        if (i > 0) arc += Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]);
        const t = p[2], r = (0.34 - t * 0.14) * (i === 0 ? 1.5 : 1);
        b.push().translate(p[0], p[1], 0).rotZ(-ang);
        const row = [];
        const pk = packTone(0, 0.5, clamp01(0.5 + 0.5 * Math.min(1, p[1] / 1.4)));
        for (let k = 0; k <= seg; k++) {
          const a = (k / seg) * TAU, ca = Math.cos(a), sa = Math.sin(a);
          row.push(b.vertex(ca * r, 0, sa * r, ca, 0.08, sa, [(k / seg) * Math.max(1, Math.round(TAU * 0.3 / 1.5)), arc / 2.3, pk], partOf(P_BARK), 0));
        }
        b.pop();
        rows.push(row);
      }
      for (let i = 0; i < rows.length - 1; i++) for (let k = 0; k < seg; k++) { const a = rows[i][k], bb = rows[i][k + 1], c = rows[i + 1][k], d = rows[i + 1][k + 1]; b.tri(a, c, bb); b.tri(bb, c, d); }
      const top = pts[rings - 1];
      const fr = lod === 0 ? 10 : lod === 1 ? 7 : 6;
      const S = lod === 0 ? 4 : lod === 1 ? 3 : 1;
      const rnd = mulberry32(seed * 313);
      for (let i = 0; i < fr; i++) {
        const a = (i / fr) * TAU + 0.3 + (rnd() - 0.5) * 0.3;
        const dx = Math.cos(a), dz = Math.sin(a), qx = -dz, qz = dx;
        const L = 3.5 + rnd() * 0.5, Wd = lod === 2 ? 1.5 : 1.7;
        const ids = [];
        const ph = Math.floor(rnd() * 128) * 2;
        for (let s = 0; s <= S; s++) {
          const t = s / S, rr = 0.1 + t * L;
          const y = Math.sin(t * Math.PI * 0.55) * 1.35 - t * t * 1.5 + 0.15;
          const w = Wd * 0.5 * Math.sin(Math.min(t * 0.92 + 0.08, 1) * Math.PI) ** 0.7 + 0.05;
          const droop = w * 0.42;
          const cx = top[0] + dx * rr, cy = top[1] + y, cz = dx * 0 + dz * rr;
          const nl = clamp01(0.5 + 0.5 * t);
          const nn = [0, 1, 0];
          for (let side = -1; side <= 1; side++) {
            const ww = w * side;
            ids.push(b.vertex(cx + qx * ww, cy - Math.abs(side) * droop, cz + qz * ww, nn[0] + dx * 0.25, nn[1], nn[2] + dz * 0.25, [t, (side + 1) / 2, packTone(0, (i % 3) / 3, nl)], partOf(P_CARD, ph), 0));
          }
        }
        for (let s = 0; s < S; s++) {
          for (let h = 0; h < 2; h++) {
            const a0 = ids[s * 3 + h], a1 = ids[s * 3 + h + 1], b0 = ids[s * 3 + 3 + h], b1 = ids[s * 3 + 3 + h + 1];
            b.tri(a0, b0, a1); b.tri(a1, b0, b1);
          }
        }
      }
      if (lod === 0) for (let i = 0; i < 3; i++) { const a = i * 2.1; b.push().translate(top[0] + Math.cos(a) * 0.3, top[1] - 0.15, Math.sin(a) * 0.3); b.sphere({ r: 0.22, detail: 0, part: 0, flat: true, color: [0.42, 0.32, 0.22] }); b.pop(); }
      break;
    }
  }
  return b.build();
}

// ---- shader ---------------------------------------------------------------------------------------

const VERT = /* glsl */ `
${GLSL_UNIFORMS}
${GLSL_FUNCS}
attribute vec3 color;
attribute float aPart;
attribute vec4 iP;
attribute vec4 iQ;
uniform vec3 uLeaf[4];
uniform vec3 uBark;
uniform float uTreeH;
uniform float uFadeEnd;
uniform float uSway;
uniform float uBlossom;
varying vec2 vUv;
varying vec3 vMid;
varying vec3 vN;
varying vec3 vWorld;
varying vec3 vObj;
varying vec4 vInfo;
varying float vShadow;
varying float vGlow;
vec3 rotY(vec3 p, float a){ float c = cos(a), s = sin(a); return vec3(p.x * c - p.z * s, p.y, p.x * s + p.z * c); }
void main(){
  vec3 base = iP.xyz;
  float sc = iP.w;
  float yaw = iQ.x;
  float seed = iQ.y;
  int vi = int(iQ.z + 0.5);
  float dist = distance(base, cameraPosition);
  float fade = 1.0 - smoothstep(uFadeEnd * 0.9, uFadeEnd, dist);
  if (fade < 0.02) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); vUv = vec2(0.0); vMid = vec3(0.0); vN = vec3(0.0, 1.0, 0.0); vWorld = vec3(0.0); vObj = vec3(0.0); vInfo = vec4(0.0); vShadow = 1.0; vGlow = 0.0; return; }

  float code = mod(aPart, 16.0);
  float extra = floor(aPart / 16.0);
  float pk = color.b;
  float pSnow = mod(pk, 256.0) / 255.0;
  float pMix = mod(floor(pk / 256.0), 256.0) / 255.0;
  float pLight = floor(pk / 65536.0) / 255.0;
  bool legacyBark = code < 0.5;
  bool legacyLeaf = code > 0.5 && code < 1.5;
  float type = legacyBark ? 0.0 : (code < 2.5 ? 2.0 : (code < 3.5 ? 3.0 : 1.0));
  float light = (legacyBark || legacyLeaf) ? color.r : pLight;
  float snowMoss = legacyBark ? 0.0 : (legacyLeaf ? color.g : pSnow);
  float mixv = legacyLeaf ? color.b : pMix;

  vec3 lp = position * (sc * fade);
  float hf = clamp(position.y / uTreeH, 0.0, 1.0);
  vec2 w0 = windField(base.xz);
  vec2 wnd = w0 * uSway * pow(hf, 1.6) * sc;
  vec3 fl = vec3(0.0);
  if (type > 2.5) {
    float ph = floor(extra * 0.5) / 127.0 * 6.2832 + seed * 0.37;
    float amp = (0.05 + 0.11 * length(w0)) * hf * sc;
    fl = vec3(sin(uTime * 2.7 + ph), sin(uTime * 3.4 + ph * 1.7) * 0.45, cos(uTime * 2.2 + ph * 1.3)) * amp;
  }
  vec3 wp = rotY(lp, yaw);
  wp.xz += wnd;
  wp += fl;
  vec3 world = base + wp;
  vWorld = world;
  vN = normalize(rotY(normal, yaw));
  vObj = position;
  vUv = color.rg;
  vInfo = vec4(type, light, snowMoss, mod(extra, 2.0));
  vec3 mid;
  if (type < 0.5) mid = uBark * color;
  else if (type < 1.5) mid = uBark * (0.92 + 0.16 * hash11(seed * 17.0));
  else {
    vec3 c0 = uLeaf[vi];
    vec3 c1 = uLeaf[(vi + 1) % 4];
    mid = mix(c0, c1, clamp(mixv * 0.7 + (hash11(seed * 91.0) - 0.5) * 0.25, 0.0, 1.0));
    mid *= 0.9 + 0.2 * hash11(seed * 33.0);
  }
  vMid = mid;
  vShadow = cloudShadow(world);
  vGlow = uBlossom * (type > 1.5 ? 1.0 : 0.0);
  gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
}
`;

const FRAG = /* glsl */ `
${GLSL_UNIFORMS}
${GLSL_FUNCS}
uniform sampler2D uAtlas;
uniform sampler2D uBarkTex;
uniform vec4 uCell;
uniform vec4 uCellB;
uniform vec3 uToneDark;
uniform vec3 uToneLight;
uniform float uLightMix;
uniform vec3 uDarkAbs;
uniform float uDarkAbsMix;
uniform vec3 uSnow;
uniform vec3 uBarkDark;
uniform vec3 uBarkLight;
uniform vec3 uMoss;
uniform vec2 uBarkTile;
uniform float uCoreTile;
uniform float uA2C;
varying vec2 vUv;
varying vec3 vMid;
varying vec3 vN;
varying vec3 vWorld;
varying vec3 vObj;
varying vec4 vInfo;
varying float vShadow;
varying float vGlow;
vec3 toneMix(vec3 w, vec3 d, vec3 m, vec3 l){ return (w.r * d + w.g * m + w.b * l) / max(w.r + w.g + w.b, 0.02); }
void main(){
  float type = vInfo.x;
  vec3 N = normalize(vN);
  vec3 V = normalize(cameraPosition - vWorld);
  vec3 albedo;
  float ao;
  float alphaOut = 1.0;
  float thin = 0.0;
  if (type > 2.5) {
    // leaf card
    vec4 cell = mix(uCell, uCellB, vInfo.w);
    vec4 t = texture2D(uAtlas, cell.xy + vUv * cell.zw);
    // cards seen edge on shrink away instead of showing as slivers
    vec3 Ng = normalize(cross(dFdx(vWorld), dFdy(vWorld)));
    float a = t.a * smoothstep(0.03, 0.3, abs(dot(Ng, V)));
    if (uA2C > 0.5) {
      a = clamp((a - 0.5) / max(fwidth(a), 0.001) + 0.5, 0.0, 1.0);
      if (a < 0.02) discard;
      alphaOut = a;
    } else if (a < 0.5) discard;
    albedo = toneMix(t.rgb, mix(vMid * uToneDark, uDarkAbs, uDarkAbsMix), vMid, mix(vMid * uToneLight, uSnow, uLightMix));
    albedo = mix(albedo, uSnow, vInfo.z * smoothstep(0.15, 0.85, N.y) * 0.8);
    ao = mix(0.24, 1.0, vInfo.y);
    thin = 1.0;
    N = normalize(N + vec3(0.0, 0.3, 0.0)); // foliage takes soft hemisphere light, shade never turns muddy
  } else if (type > 1.5) {
    // solid crown core: a dense, darker version of the species leaf art so gaps between cards read as deeper foliage
    vec3 dark = mix(vMid * uToneDark, uDarkAbs, uDarkAbsMix);
    vec3 an = abs(N);
    vec2 pl = an.y > 0.65 ? vObj.xz : (an.x > an.z ? vObj.zy : vObj.xy);
    vec2 cuv = uCell.xy + (0.2 + 0.6 * fract(pl * uCoreTile)) * uCell.zw;
    vec4 t = textureGrad(uAtlas, cuv, dFdx(pl) * 0.6 * uCoreTile * uCell.zw, dFdy(pl) * 0.6 * uCoreTile * uCell.zw);
    vec3 w = t.a > 0.5 ? t.rgb / max(t.r + t.g + t.b, 0.02) : vec3(0.85, 0.15, 0.0);
    albedo = w.r * mix(dark, vMid, 0.4) + w.g * mix(dark, vMid, 0.75) + w.b * vMid;
    albedo = mix(albedo, uSnow, vInfo.z * smoothstep(0.1, 0.8, N.y) * 0.85);
    ao = mix(0.2, 0.95, vInfo.y);
    thin = 0.5;
    N = normalize(N + vec3(0.0, 0.3, 0.3 * 0.0));
  } else {
    // bark
    if (!gl_FrontFacing) N = -N;
    vec2 uv;
    float moss;
    if (type < 0.5) {
      vec3 an = abs(N);
      uv = (an.x > an.z ? vObj.zy : vObj.xy) * uBarkTile * 0.4;
      moss = smoothstep(0.98, 0.72, vInfo.y) * 0.85;
      ao = 0.55 + 0.45 * vInfo.y;
    } else {
      uv = vUv;
      moss = vInfo.z;
      ao = 0.42 + 0.58 * vInfo.y;
    }
    vec4 t = texture2D(uBarkTex, uv);
    albedo = toneMix(t.rgb, vMid * uBarkDark, vMid, vMid * uBarkLight);
    float mw = smoothstep(0.0, 0.16, t.a - (1.0 - moss));
    albedo = mix(albedo, uMoss * (0.7 + 0.6 * t.g), mw * 0.92);
  }
  vec3 col = shadeSurface(albedo, N, ao, vWorld, vShadow);
  float ndl = dot(N, uSunDir);
  if (thin > 0.0) {
    // painterly shade: shadowed foliage keeps (and slightly deepens) its hue instead of going grey
    vec3 satA = albedo / max(dot(albedo, vec3(0.3333)), 0.02);
    col *= mix(vec3(1.0), satA, 0.3 * (1.0 - clamp(ndl * 1.6, 0.0, 1.0)));
  }
  float back = pow(max(dot(-V, uSunDir), 0.0), 1.7);
  float trans = max(-ndl, 0.0);
  col += albedo * uSunColor * (back * 0.75 + trans * 0.26 * thin) * vShadow * vInfo.y * thin;
  col += albedo * vGlow * (uNight + uFinale * 0.3) * 0.6;
  col += vec3(0.4, 0.75, 1.0) * pulseBand(vWorld) * 0.3;
  float mx = max(col.r, max(col.g, col.b));
  col *= min(1.0, 1.4 / max(mx, 0.001));
  col = applyFog(col, vWorld);
  gl_FragColor = vec4(col, alphaOut);
}
`;

const TREE_H = [12, 9, 15.5, 10.5, 12, 9, 15.5];

// tone colours per species: shadow multiplier, light multiplier, how far the light tone leans to white
const TONES = [
  { dark: [0.42, 0.56, 0.72], light: [1.42, 1.32, 0.78], mix: 0 }, // oak
  { dark: [0.76, 0.48, 0.64], light: [1.02, 1.06, 1.04], mix: 0.3 }, // cherry
  { dark: [0.34, 0.5, 0.6], light: [1.7, 1.6, 1.3], mix: 0 }, // pine
  { dark: [0.42, 0.56, 0.7], light: [1.3, 1.25, 0.9], mix: 0 }, // birch
  { dark: [0.55, 0.32, 0.3], light: [1.2, 1.3, 1.05], mix: 0.1 }, // maple
  { dark: [0.34, 0.55, 0.62], light: [1.5, 1.4, 0.8], mix: 0 }, // palm
  { dark: [0.3, 0.5, 0.6], light: [1, 1, 1], mix: 0.86, darkAbs: '#1c4634', darkAbsMix: 0.8 }, // frost pine
];
const BARK_TONES = [
  { dark: [0.32, 0.3, 0.3], light: [1.55, 1.5, 1.4] },
  { dark: [0.36, 0.3, 0.3], light: [1.5, 1.45, 1.4] },
  { dark: [0.3, 0.26, 0.26], light: [1.6, 1.5, 1.4] },
  { dark: [0.1, 0.1, 0.11], light: [1.06, 1.06, 1.06] },
  { dark: [0.34, 0.32, 0.32], light: [1.6, 1.55, 1.5] },
  { dark: [0.35, 0.3, 0.3], light: [1.35, 1.3, 1.25] },
  { dark: [0.3, 0.26, 0.26], light: [1.6, 1.5, 1.4] },
];
const KIND_CELL = [CELLS.oak, CELLS.cherry, CELLS.pine, CELLS.birch, CELLS.maple, CELLS.palm, CELLS.frost];
const KIND_CELL_B = [CELLS.oakB, CELLS.cherry, CELLS.pine, CELLS.birch, CELLS.maple, CELLS.palm, CELLS.frost];

// how many leaf art tiles per metre the crown cores use (pine cores show needle detail, birch cores stay small)
const CORE_TILE = [0.3, 0.32, 0.9, 0.5, 0.3, 0.4, 0.9];

// shared by every tree material so a quality change flips them all at once
export const TREE_G = { uA2C: { value: 1 } };

const v3 = (a) => new THREE.Vector3(a[0], a[1], a[2]);

export function makeTreeMaterial(kind, lod) {
  const t = TREES[kind];
  const T = getTreeTextures();
  const leaf = t.leaf.map((h) => { const c = hexToLinear(h); return new THREE.Vector3(c[0], c[1], c[2]); });
  while (leaf.length < 4) leaf.push(leaf[leaf.length - 1].clone());
  const bk = hexToLinear(t.trunk).map((v) => v * 1.12);
  const tone = TONES[kind], bt = BARK_TONES[kind];
  return new THREE.ShaderMaterial({
    vertexShader: VERT, fragmentShader: FRAG, side: THREE.DoubleSide, alphaToCoverage: true,
    uniforms: {
      ...G, ...TREE_G,
      uLeaf: { value: leaf },
      uBark: { value: new THREE.Vector3(bk[0], bk[1], bk[2]) },
      uTreeH: { value: TREE_H[kind] },
      uFadeEnd: { value: 1500 },
      uSway: { value: kind === 2 || kind === 6 ? 0.35 : kind === 5 ? 0.8 : 0.5 },
      uCut: { value: 1 },
      uBlossom: { value: kind === 1 ? 0.5 : 0 },
      uSnow: { value: new THREE.Vector3(...hexToLinear('#f4f8ff')) },
      uAtlas: { value: T.atlas },
      uBarkTex: { value: T.bark[BARK_INFO[kind].key] },
      uCell: { value: new THREE.Vector4(...cellRect(KIND_CELL[kind])) },
      uCellB: { value: new THREE.Vector4(...cellRect(KIND_CELL_B[kind])) },
      uToneDark: { value: v3(tone.dark) },
      uToneLight: { value: v3(tone.light) },
      uLightMix: { value: tone.mix },
      uDarkAbs: { value: new THREE.Vector3(...hexToLinear(tone.darkAbs || '#000000')) },
      uDarkAbsMix: { value: tone.darkAbs ? tone.darkAbsMix : 0 },
      uBarkDark: { value: v3(bt.dark) },
      uBarkLight: { value: v3(bt.light) },
      uMoss: { value: new THREE.Vector3(...hexToLinear('#4a7a2e')) },
      uBarkTile: { value: new THREE.Vector2(1 / 1.5, 1 / 2.8) },
      uCoreTile: { value: CORE_TILE[kind] },
    },
  });
}

// ---- streaming system -----------------------------------------------------------------------------

const LOD_DIST = [210, 620, 1500];
const STRIDE = 8;

export class Trees {
  constructor(world, preset = {}) {
    this.world = world;
    this.group = new THREE.Group();
    this.meshes = [];
    this.lodScale = preset.detail || 1;
    TREE_G.uA2C.value = (preset.samples ?? 4) > 0 ? 1 : 0;
    const caps = [[500, 1800, 4200], [400, 1200, 2400], [900, 2600, 5000], [700, 2200, 4200], [700, 2400, 4600], [120, 240, 400], [500, 1400, 2600]];
    for (let k = 0; k < TREES.length; k++) {
      this.meshes[k] = [];
      for (let lod = 0; lod < 3; lod++) {
        const geo = buildTree(k, lod);
        const cap = caps[k][lod];
        const arr = new Float32Array(cap * STRIDE);
        const ibuf = new THREE.InstancedInterleavedBuffer(arr, STRIDE, 1);
        ibuf.setUsage(THREE.DynamicDrawUsage);
        const g = new THREE.InstancedBufferGeometry();
        g.index = geo.index;
        for (const n of ['position', 'normal', 'color', 'aPart']) g.setAttribute(n, geo.getAttribute(n));
        g.setAttribute('iP', new THREE.InterleavedBufferAttribute(ibuf, 4, 0));
        g.setAttribute('iQ', new THREE.InterleavedBufferAttribute(ibuf, 4, 4));
        g.instanceCount = 0;
        const mat = makeTreeMaterial(k, lod);
        mat.uniforms.uFadeEnd.value = LOD_DIST[lod] * (lod === 2 ? 1.0 : 1.12);
        const mesh = new THREE.Mesh(g, mat);
        mesh.frustumCulled = false;
        mesh.renderOrder = 3;
        this.group.add(mesh);
        this.meshes[k][lod] = { mesh, geo: g, arr, ibuf, cap, count: 0, mat, tris: geo.index.count / 3 };
      }
    }
    this.last = { x: 1e9, z: 1e9 };
    this.force = true;
  }

  setQuality(preset) {
    this.lodScale = preset.detail || 1;
    TREE_G.uA2C.value = (preset.samples ?? 4) > 0 ? 1 : 0;
    this.force = true;
  }

  update(cam) {
    if (!this.force && Math.hypot(cam.x - this.last.x, cam.z - this.last.z) < 14) return;
    this.force = false;
    this.last.x = cam.x; this.last.z = cam.z;
    const w = this.world;
    const d0 = LOD_DIST[0] * this.lodScale, d1 = LOD_DIST[1] * this.lodScale, d2 = LOD_DIST[2] * this.lodScale;
    for (const row of this.meshes) for (const m of row) m.count = 0;
    // gather candidates with distance, nearest first per bucket
    const buckets = [[], [], []];
    w.forTreesNear(cam.x, cam.z, d2 + 20, (idx) => {
      const o = idx * 7;
      const dx = w.trees[o] - cam.x, dz = w.trees[o + 2] - cam.z;
      const dist2 = dx * dx + dz * dz;
      if (dist2 > d2 * d2) return;
      const lod = dist2 < d0 * d0 ? 0 : dist2 < d1 * d1 ? 1 : 2;
      buckets[lod].push(idx, dist2);
    });
    for (let lod = 0; lod < 3; lod++) {
      const b = buckets[lod];
      // sort pairs by distance
      const order = [];
      for (let i = 0; i < b.length; i += 2) order.push(i);
      order.sort((p, q) => b[p + 1] - b[q + 1]);
      for (const p of order) {
        const idx = b[p], o = idx * 7;
        const kind = w.trees[o + 5];
        const m = this.meshes[kind][lod];
        if (m.count >= m.cap) continue;
        const a = m.count * STRIDE;
        m.arr[a] = w.trees[o]; m.arr[a + 1] = w.trees[o + 1] - 0.15; m.arr[a + 2] = w.trees[o + 2]; m.arr[a + 3] = w.trees[o + 3];
        m.arr[a + 4] = w.trees[o + 4]; m.arr[a + 5] = w.trees[o + 6] * 100; m.arr[a + 6] = Math.floor(w.trees[o + 6] * 3.999); m.arr[a + 7] = 0;
        m.count++;
      }
    }
    for (const row of this.meshes) for (const m of row) {
      m.geo.instanceCount = m.count;
      m.ibuf.clearUpdateRanges();
      if (m.count) m.ibuf.addUpdateRange(0, m.count * STRIDE);
      m.ibuf.needsUpdate = true;
    }
  }

  // nearest trunk colliders around a point: fn(x, z, radius, height)
  forColliders(x, z, r, fn) {
    const w = this.world;
    w.forTreesNear(x, z, r + 3, (idx) => {
      const o = idx * 7;
      const kind = w.trees[o + 5], sc = w.trees[o + 3];
      const rad = (kind === 5 ? 0.3 : kind === 2 || kind === 6 ? 0.4 : 0.5) * sc + 0.15;
      const height = TREE_H[kind] * 0.55 * sc;
      fn(w.trees[o], w.trees[o + 1], w.trees[o + 2], rad, height);
    });
  }
}
