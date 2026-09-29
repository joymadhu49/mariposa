// Streams flowers and ground props in around the camera. Each 24 m cell is generated deterministically
// from the baked density maps, cached, and packed into a handful of instanced draw calls.
import * as THREE from 'three';
import { mulberry32, hash2i, hash2f, clamp, smoothstep, TAU } from '../core/util.js';
import { HALF } from '../world/worldgen.js';
import { FLOWERS, BIOME, BIOME_COUNT, BIOMES, ARCH_COUNT, VARIANTS, FLOWER_INDEX } from '../world/biomes.js';
import { buildFlowerGeometry, makeFlowerMaterial } from './flowers.js';
import { G } from './shaders.js';
import { windField } from '../core/wind.js';
import { buildFern, buildBush, buildRock, buildMushroom, buildReed, makePropMaterial } from './props.js';

export const CELL_SIZE = 24;
const STRIDE = 8;

// species weights per biome, index by biome then species
const FW = BIOMES.map((b) => FLOWERS.map((f) => b.flowers[f.key] || 0));
const SPECIES_PER_ARCH = FLOWERS.map((f) => f.arch);

const PROP_DENS = {
  fern: [0.006, 0.02, 0.0, 0.3, 0.06, 0.02, 0.1, 0.0],
  bush: [0.008, 0.016, 0.012, 0.014, 0.02, 0.006, 0.014, 0.006],
  rockS: [0.004, 0.003, 0.004, 0.006, 0.004, 0.02, 0.005, 0.012],
  rockM: [0.0012, 0.001, 0.0012, 0.002, 0.0012, 0.006, 0.0018, 0.004],
  mushroom: [0.002, 0.005, 0.0, 0.04, 0.01, 0.002, 0.02, 0.0],
};

function layerDefs(preset) {
  const fq = preset.flower || 1;
  const defs = [];
  const caps = [9000, 9000, 14000, 6000, 5000, 5000, 5000, 3000, 2600];
  for (let a = 0; a < ARCH_COUNT; a++) defs.push({ id: 'flower' + a, kind: 'flower', arch: a, cap: Math.round(caps[a] * Math.max(0.6, fq)), fade: [88 * Math.sqrt(fq), 134 * Math.sqrt(fq)] });
  defs.push({ id: 'fern', kind: 'fern', cap: 9000, fade: [55, 92] });
  defs.push({ id: 'bush', kind: 'bush', cap: 3500, fade: [75, 125] });
  defs.push({ id: 'rockS', kind: 'rockS', cap: 4500, fade: [70, 115] });
  defs.push({ id: 'rockM', kind: 'rockM', cap: 1800, fade: [120, 200] });
  defs.push({ id: 'mushroom', kind: 'mushroom', cap: 2400, fade: [45, 80] });
  defs.push({ id: 'reed', kind: 'reed', cap: 3000, fade: [70, 115] });
  return defs;
}

export class Scatter {
  constructor(world, preset = {}) {
    this.world = world;
    this.group = new THREE.Group();
    this.defs = layerDefs(preset);
    this.layers = [];
    this.cells = new Map();
    this.queue = [];
    this.radius = 150 * Math.sqrt(preset.flower || 1);
    this.bw = new Float32Array(BIOME_COUNT);
    // footprints of stone landmarks where no bush or rock may sit
    this.monuments = (world.landmarks || []).filter((l) => l.clear).map((l) => ({ x: l.x, z: l.z, r2: (l.clear * 1.1) ** 2 }));
    this.falls = world.falls || null;
    this.speciesW = new Float32Array(FLOWERS.length);
    this.dirty = true;
    this.lastCX = -9999; this.lastCZ = -9999;
    this.sipped = [];
    this.blooms = this.defs.map(() => ({ arr: new Float32Array(0), n: 0 }));
    this.bloomList = [];
    this.stats = { instances: 0, cells: 0 };
    this._buildLayers();
  }

  _buildLayers() {
    for (const def of this.defs) {
      let geo, mat;
      if (def.kind === 'flower') {
        geo = buildFlowerGeometry(def.arch);
        mat = makeFlowerMaterial(def.arch);
        mat.uniforms.uFadeStart.value = def.fade[0];
        mat.uniforms.uFadeEnd.value = def.fade[1];
      } else if (def.kind === 'fern') { geo = buildFern(); mat = makePropMaterial('fern', { height: 0.6, wind: 0.5, trans: 0.6, fadeStart: def.fade[0], fadeEnd: def.fade[1] }); }
      else if (def.kind === 'bush') { geo = buildBush(); mat = makePropMaterial('bush', { height: 1.1, wind: 0.2, trans: 0.4, fadeStart: def.fade[0], fadeEnd: def.fade[1] }); }
      else if (def.kind === 'rockS' || def.kind === 'rockM') { geo = buildRock(def.kind === 'rockS' ? 1 : 2); mat = makePropMaterial('rock', { height: 1, wind: 0, trans: 0, fadeStart: def.fade[0], fadeEnd: def.fade[1] }); }
      else if (def.kind === 'mushroom') { geo = buildMushroom(); mat = makePropMaterial('mushroom', { height: 0.5, wind: 0.02, trans: 0.2, glowMask: 8 + 16, fadeStart: def.fade[0], fadeEnd: def.fade[1] }); }
      else { geo = buildReed(); mat = makePropMaterial('reed', { height: 2, wind: 0.5, trans: 0.5, fadeStart: def.fade[0], fadeEnd: def.fade[1] }); }
      const arr = new Float32Array(def.cap * STRIDE);
      const ibuf = new THREE.InstancedInterleavedBuffer(arr, STRIDE, 1);
      ibuf.setUsage(THREE.DynamicDrawUsage);
      const g = new THREE.InstancedBufferGeometry();
      g.index = geo.index;
      for (const name of ['position', 'normal', 'color', 'aPart', 'aShade']) g.setAttribute(name, geo.getAttribute(name));
      g.setAttribute('iP', new THREE.InterleavedBufferAttribute(ibuf, 4, 0));
      g.setAttribute('iQ', new THREE.InterleavedBufferAttribute(ibuf, 4, 4));
      g.instanceCount = 0;
      const mesh = new THREE.Mesh(g, mat);
      mesh.frustumCulled = false;
      mesh.renderOrder = 2;
      this.group.add(mesh);
      this.layers.push({ def, geo: g, mat, mesh, arr, ibuf, count: 0 });
    }
  }

  setQuality(preset) {
    const q = preset.flower || 1;
    this.radius = 150 * Math.sqrt(q);
    this.dirty = true;
    for (let i = 0; i < this.layers.length; i++) {
      const L = this.layers[i];
      if (L.def.kind === 'flower') {
        L.mat.uniforms.uFadeStart.value = 88 * Math.sqrt(q);
        L.mat.uniforms.uFadeEnd.value = 134 * Math.sqrt(q);
      }
    }
  }

  // ---- generation ----------------------------------------------------------------------------
  _key(cx, cz) { return cz * 1024 + cx; }

  _onMonument(x, z) {
    for (const m of this.monuments) { const dx = x - m.x, dz = z - m.z; if (dx * dx + dz * dz < m.r2) return true; }
    return false;
  }

  // the flowing water of Skyreach Falls stays free of plants and stones
  _inFalls(x, z) {
    const f = this.falls;
    if (!f) return false;
    const rx = x - f.top.x, rz = z - f.top.z;
    const along = rx * f.dir.x + rz * f.dir.z;
    if (along < -4 || along > f.len * 0.86) return false;
    return Math.abs(rx * -f.dir.z + rz * f.dir.x) < f.width * 0.75 + 1.5;
  }

  _genCell(cx, cz) {
    const w = this.world;
    const S = CELL_SIZE;
    const x0 = -HALF + cx * S, z0 = -HALF + cz * S;
    const rnd = mulberry32(hash2i(cx * 7919 + 13, cz * 104729 + 7, 4242));
    const out = this.defs.map(() => []);
    const bw = this.bw, sw = this.speciesW;
    const archLayer = (a) => a; // flower layers occupy indices 0..ARCH_COUNT-1
    const layerIdx = {};
    this.defs.forEach((d, i) => { layerIdx[d.kind === 'flower' ? 'f' + d.arch : d.kind] = i; });
    const push = (li, x, y, z, sc, yaw, phase, spec, state = 0) => { const o = out[li]; o.push(x, y, z, sc, yaw, phase, spec, state); };

    // --- flowers
    for (let i = 0; i < 600; i++) {
      const x = x0 + rnd() * S, z = z0 + rnd() * S;
      const fd = w.sampleMap(w.flora, x, z, 2);
      if (rnd() > fd * 1.05) continue;
      const y = w.heightAt(x, z);
      if (y < 0.5) continue;
      w.biomeWeightsAt(x, z, bw);
      let tot = 0;
      for (let s = 0; s < FLOWERS.length; s++) {
        let v = 0;
        for (let b = 0; b < BIOME_COUNT; b++) v += bw[b] * FW[b][s];
        sw[s] = v; tot += v;
      }
      if (tot < 0.02) continue;
      const px = Math.floor(x / 7), pz = Math.floor(z / 7);
      const patchR = hash2f(px, pz, 31);
      let r = rnd() < 0.82 ? patchR : rnd();
      let pick = r * tot, sp = 0;
      for (let s = 0; s < FLOWERS.length; s++) { pick -= sw[s]; if (pick <= 0) { sp = s; break; } }
      const patchV = hash2f(px, pz, 32);
      const variant = Math.min(VARIANTS - 1, Math.floor((rnd() < 0.78 ? patchV : rnd()) * Math.min(VARIANTS, FLOWERS[sp].petals.length)));
      const f = FLOWERS[sp];
      push(f.arch, x, y, z, 0.82 + 0.42 * rnd(), rnd() * TAU, rnd(), sp * VARIANTS + variant);
    }

    // --- lily pads and lotus on lake water
    const lakeAt = (x, z) => { for (const lk of w.lakes) { if (lk.level <= 0.5) continue; const dx = x - lk.x, dz = z - lk.z; if (Math.abs(dx) < lk.rx * 1.4 && Math.abs(dz) < lk.rx * 1.4) return lk; } return null; };
    const cellLake = lakeAt(x0 + S / 2, z0 + S / 2) || lakeAt(x0, z0) || lakeAt(x0 + S, z0 + S) || lakeAt(x0, z0 + S) || lakeAt(x0 + S, z0);
    if (cellLake) {
      const lotusIdx = FLOWER_INDEX.lotus, padIdx = FLOWER_INDEX.lilypad;
      for (let i = 0; i < 260; i++) {
        const x = x0 + rnd() * S, z = z0 + rnd() * S;
        const lvl = w.waterLevelAt(x, z);
        if (lvl === null || lvl < 0.5) continue;
        const depth = lvl - w.heightAt(x, z);
        if (depth < 0.35 || depth > 3.4) continue;
        const patch = hash2f(Math.floor(x / 9), Math.floor(z / 9), 41);
        if (patch < 0.5 || rnd() > 0.42 * (patch - 0.35)) continue;
        const isLotus = rnd() < 0.3;
        const sp = isLotus ? lotusIdx : padIdx;
        const v = isLotus ? Math.floor(rnd() * 3) : 0;
        push(FLOWERS[sp].arch, x, lvl + 0.03, z, 0.8 + 0.45 * rnd(), rnd() * TAU, rnd(), sp * VARIANTS + v);
      }
    }

    // --- props
    const dens = (kind, b) => PROP_DENS[kind][b];
    const propCand = (kind, nCand, fn) => {
      for (let i = 0; i < nCand; i++) {
        const x = x0 + rnd() * S, z = z0 + rnd() * S;
        const y = w.heightAt(x, z);
        if (y < 0.7) continue;
        if ((this.monuments.length && this._onMonument(x, z)) || this._inFalls(x, z)) continue;
        w.biomeWeightsAt(x, z, bw);
        let d = 0;
        for (let b = 0; b < BIOME_COUNT; b++) d += bw[b] * dens(kind, b);
        const sl = Math.hypot(w.sampleMap(w.normal, x, z, 0) * 2 - 1, w.sampleMap(w.normal, x, z, 2) * 2 - 1); // horizontal part of the normal
        const canopy = w.sampleMap(w.flora, x, z, 3);
        const p = fn(d, canopy, sl, x, y, z);
        if (p <= 0 || rnd() > p) continue;
        // keep out of water
        const lvl = w.waterLevelAt(x, z);
        if (lvl !== null && lvl > -1000 && y < lvl + 0.15) continue;
        fn.place(x, y, z, rnd);
      }
    };
    const placeGeneric = (li, minS, maxS, variants = 5) => (x, y, z, r) => push(li, x, y, z, minS + (maxS - minS) * r(), r() * TAU, r(), Math.floor(r() * variants));
    const area = S * S;
    // p turns a per square metre density into a per candidate acceptance so expected count = density * area
    const acc = (d, nCand, mult = 1) => Math.min(0.95, (d * mult * area) / nCand);
    {
      const N = 260;
      const f = (d, canopy) => acc(d, N, 1 + 1.4 * canopy);
      f.place = placeGeneric(layerIdx.fern, 0.75, 1.35);
      propCand('fern', N, f);
    }
    {
      const N = 60;
      const f = (d, canopy) => acc(d, N, 1 + canopy);
      f.place = placeGeneric(layerIdx.bush, 0.7, 1.3);
      propCand('bush', N, f);
    }
    {
      const N = 140;
      const f = (d, canopy, sl) => acc(d, N, 1 + Math.max(0, sl - 0.12) * 14);
      f.place = placeGeneric(layerIdx.rockS, 0.3, 0.8);
      propCand('rockS', N, f);
    }
    {
      const N = 60;
      const f = (d, canopy, sl) => acc(d, N, 1 + Math.max(0, sl - 0.12) * 10);
      f.place = placeGeneric(layerIdx.rockM, 0.9, 1.9);
      propCand('rockM', N, f);
    }
    {
      const N = 140;
      const f = (d, canopy) => acc(d, N, 1 + 2.5 * canopy);
      f.place = (x, y, z, r) => push(layerIdx.mushroom, x, y, z, 0.8 + 0.7 * r(), r() * TAU, r(), Math.floor(r() * 5));
      propCand('mushroom', N, f);
    }
    // reeds along lake shores
    if (cellLake || w.coastAt(x0 + S / 2, z0 + S / 2) < 60) {
      for (let i = 0; i < 90; i++) {
        const x = x0 + rnd() * S, z = z0 + rnd() * S;
        const y = w.heightAt(x, z);
        if (this._inFalls(x, z)) continue;
        let near = false;
        for (const lk of w.lakes) {
          if (lk.level <= 0.5) continue;
          const dx = x - lk.x, dz = z - lk.z, c = Math.cos(lk.rot), s = Math.sin(lk.rot);
          const t = Math.hypot((dx * c + dz * s) / lk.rx, (-dx * s + dz * c) / lk.rz);
          if (t < 1.4 && y > lk.level - 0.9 && y < lk.level + 1.3) { near = true; break; }
        }
        if (!near) continue;
        if (hash2f(Math.floor(x / 6), Math.floor(z / 6), 61) < 0.35) continue;
        push(layerIdx.reed, x, y, z, 0.8 + 0.6 * rnd(), rnd() * TAU, rnd(), Math.floor(rnd() * 5));
      }
    }

    const cell = { cx, cz, x0, z0, layers: out.map((a) => ({ arr: Float32Array.from(a), n: a.length / STRIDE })) };
    return cell;
  }

  // ---- streaming -------------------------------------------------------------------------------
  update(cam, budgetMs = 2.5) {
    const R = this.radius + CELL_SIZE;
    const ccx = Math.floor((cam.x + HALF) / CELL_SIZE), ccz = Math.floor((cam.z + HALF) / CELL_SIZE);
    if (ccx !== this.lastCX || ccz !== this.lastCZ) {
      this.lastCX = ccx; this.lastCZ = ccz;
      this.queue = [];
      const n = Math.ceil(R / CELL_SIZE);
      const maxC = Math.floor(2 * HALF / CELL_SIZE) - 1;
      for (let dz = -n; dz <= n; dz++) for (let dx = -n; dx <= n; dx++) {
        const cx = ccx + dx, cz = ccz + dz;
        if (cx < 0 || cz < 0 || cx > maxC || cz > maxC) continue;
        const d = Math.hypot(dx, dz) * CELL_SIZE;
        if (d > R) continue;
        if (!this.cells.has(this._key(cx, cz))) this.queue.push({ cx, cz, d });
      }
      this.queue.sort((a, b) => b.d - a.d); // pop from the end = nearest first
      this.dirty = true;
      // evict far cells
      if (this.cells.size > 900) {
        const far = [];
        for (const [k, c] of this.cells) far.push([Math.hypot(c.cx - ccx, c.cz - ccz), k]);
        far.sort((a, b) => b[0] - a[0]);
        for (let i = 0; i < 250; i++) this.cells.delete(far[i][1]);
      }
    }
    const t0 = performance.now();
    while (this.queue.length && performance.now() - t0 < budgetMs) {
      const q = this.queue.pop();
      const k = this._key(q.cx, q.cz);
      if (!this.cells.has(k)) { this.cells.set(k, this._genCell(q.cx, q.cz)); this.dirty = true; }
    }
    if (this.dirty && (this.queue.length === 0 || performance.now() - (this._lastRebuild || 0) > 180)) {
      this._rebuild(cam);
      this._lastRebuild = performance.now();
      if (this.queue.length === 0) this.dirty = false;
    }
  }

  // synchronous prefill used at start so the first frame is already full of flowers
  prefill(cam) {
    this.lastCX = -9999;
    this.update(cam, 0);
    while (this.queue.length) {
      const q = this.queue.pop();
      const k = this._key(q.cx, q.cz);
      if (!this.cells.has(k)) this.cells.set(k, this._genCell(q.cx, q.cz));
    }
    this._rebuild(cam);
    this.dirty = false;
  }

  _rebuild(cam) {
    const R = this.radius + CELL_SIZE * 0.8;
    const ccx = Math.floor((cam.x + HALF) / CELL_SIZE), ccz = Math.floor((cam.z + HALF) / CELL_SIZE);
    const n = Math.ceil(R / CELL_SIZE);
    const list = [];
    for (let dz = -n; dz <= n; dz++) for (let dx = -n; dx <= n; dx++) {
      const c = this.cells.get(this._key(ccx + dx, ccz + dz));
      if (!c) continue;
      const cxm = c.x0 + CELL_SIZE / 2 - cam.x, czm = c.z0 + CELL_SIZE / 2 - cam.z;
      const d = Math.hypot(cxm, czm);
      if (d > R + CELL_SIZE) continue;
      list.push([d, c]);
    }
    list.sort((a, b) => a[0] - b[0]);
    let total = 0;
    for (let li = 0; li < this.layers.length; li++) {
      const L = this.layers[li];
      let off = 0;
      const cap = L.def.cap;
      for (const [, c] of list) {
        const src = c.layers[li];
        if (!src.n) continue;
        const take = Math.min(src.n, cap - off / STRIDE);
        if (take <= 0) break;
        L.arr.set(take === src.n ? src.arr : src.arr.subarray(0, take * STRIDE), off);
        off += take * STRIDE;
      }
      // blooms created by the player
      const bl = this.blooms[li];
      if (bl.n && off / STRIDE + bl.n <= cap) { L.arr.set(bl.arr.subarray(0, bl.n * STRIDE), off); off += bl.n * STRIDE; }
      L.count = off / STRIDE;
      L.geo.instanceCount = L.count;
      L.ibuf.clearUpdateRanges();
      if (off > 0) L.ibuf.addUpdateRange(0, off);
      L.ibuf.needsUpdate = true;
      total += L.count;
    }
    this.stats.instances = total;
    this.stats.cells = this.cells.size;
  }

  // ---- gameplay queries ------------------------------------------------------------------------
  cellAt(x, z) {
    const cx = Math.floor((x + HALF) / CELL_SIZE), cz = Math.floor((z + HALF) / CELL_SIZE);
    return this.cells.get(this._key(cx, cz));
  }

  // Flowers within r of (x,z). Returns refs. Includes player made blooms.
  queryFlowers(x, z, r, out = []) {
    out.length = 0;
    const c0x = Math.floor((x - r + HALF) / CELL_SIZE), c1x = Math.floor((x + r + HALF) / CELL_SIZE);
    const c0z = Math.floor((z - r + HALF) / CELL_SIZE), c1z = Math.floor((z + r + HALF) / CELL_SIZE);
    const r2 = r * r;
    const scan = (cellRef, layers) => {
      for (let li = 0; li < ARCH_COUNT; li++) {
        const src = layers[li];
        if (!src.n) continue;
        const a = src.arr;
        for (let i = 0; i < src.n; i++) {
          const o = i * STRIDE;
          const dx = a[o] - x, dz = a[o + 2] - z;
          if (dx * dx + dz * dz > r2) continue;
          const sp = Math.floor(a[o + 6] / VARIANTS);
          if (FLOWERS[sp].nectar <= 0) continue;
          out.push({ cellRef, li, i, x: a[o], y: a[o + 1], z: a[o + 2], scale: a[o + 3], species: sp, variant: a[o + 6] - sp * VARIANTS, state: a[o + 7], arr: a, o });
        }
      }
    };
    for (let cz = c0z; cz <= c1z; cz++) for (let cx = c0x; cx <= c1x; cx++) {
      const c = this.cells.get(this._key(cx, cz));
      if (c) scan(c, c.layers);
    }
    scan(null, this.blooms);
    return out;
  }

  // world position of the top of a flower head, including the same wind sway the shader applies
  headPosition(ref, out) {
    const f = FLOWERS[ref.species];
    const sc = ref.scale;
    const stemH = (f.stem[0] + f.stem[1]) * 0.5 * sc;
    const size = (f.size[0] + f.size[1]) * 0.5 * sc;
    const wnd = windField(ref.x, ref.z);
    const sway = Math.sin(G.uTime.value * 1.7 + ref.arr[ref.o + 5] * TAU) * 0.04 * stemH;
    const ox = wnd.x * stemH * 0.55 + sway, oz = wnd.z * stemH * 0.55 + sway * 0.6;
    const drop = Math.hypot(ox, oz) * 0.28;
    let top = f.arch === 4 ? size * 1.5 : f.arch === 5 ? size * 0.9 : f.arch === 8 ? 0.16 : f.arch === 7 ? size * 0.12 : size * 0.09;
    out.set(ref.x + ox, ref.y + stemH - drop + top, ref.z + oz);
    return out;
  }

  sip(ref, now) {
    ref.arr[ref.o + 7] = 1;
    ref.state = 1;
    this.sipped.push({ arr: ref.arr, o: ref.o, t: now });
    this.dirty = true;
    this._lastRebuild = 0;
  }

  regrow(now, life = 80) {
    let changed = false;
    for (let i = this.sipped.length - 1; i >= 0; i--) {
      const s = this.sipped[i];
      if (now - s.t > life) { s.arr[s.o + 7] = 0; this.sipped.splice(i, 1); changed = true; }
    }
    if (changed) this.dirty = true;
  }

  // Player made blooms: species index, count. Returns created positions.
  addBloom(cx, cy, cz, species, count, now, rnd = Math.random) {
    const f = FLOWERS[species];
    const created = [];
    const li = f.arch;
    const bl = this.blooms[li];
    for (let k = 0; k < count; k++) {
      const a = rnd() * TAU, d = 1.2 + rnd() * 4.5;
      const x = cx + Math.cos(a) * d, z = cz + Math.sin(a) * d;
      const lvl = this.world.waterLevelAt(x, z);
      if (lvl !== null && f.arch !== 8) continue;
      const y = this.world.heightAt(x, z);
      const v = Math.floor(rnd() * Math.min(VARIANTS, f.petals.length));
      this._appendBloom(li, x, y, z, 0.9 + 0.4 * rnd(), rnd() * TAU, rnd(), species * VARIANTS + v, -now);
      created.push({ x, y, z, species, variant: v });
    }
    this.bloomList.push(...created);
    this.dirty = true;
    this._lastRebuild = 0;
    return created;
  }

  _appendBloom(li, x, y, z, sc, yaw, phase, spec, state) {
    const bl = this.blooms[li];
    if (bl.arr.length < (bl.n + 1) * STRIDE) {
      const bigger = new Float32Array(Math.max(64 * STRIDE, bl.arr.length * 2));
      bigger.set(bl.arr);
      bl.arr = bigger;
    }
    const o = bl.n * STRIDE;
    bl.arr[o] = x; bl.arr[o + 1] = y; bl.arr[o + 2] = z; bl.arr[o + 3] = sc; bl.arr[o + 4] = yaw; bl.arr[o + 5] = phase; bl.arr[o + 6] = spec; bl.arr[o + 7] = state;
    bl.n++;
  }

  restoreBlooms(list) {
    for (const b of list) {
      const f = FLOWERS[b.species];
      if (!f) continue;
      this._appendBloom(f.arch, b.x, b.y, b.z, 1, (b.x * 12.9898 + b.z * 78.233) % TAU, 0.5, b.species * VARIANTS + (b.variant || 0), -0.001);
    }
    this.bloomList.push(...list);
    this.dirty = true;
  }
}
