// Instanced CDLOD terrain: one draw call, seamless geomorphing, all shading from baked textures.
import * as THREE from 'three';
import { G, GLSL_UNIFORMS, GLSL_FUNCS, GLSL_HEIGHT } from './shaders.js';
import { GRID, HALF, CELL } from '../world/worldgen.js';

const TILE_QUADS = 32;
const LEAF_SIZE = 32;
const LEVELS = 8; // level 0 leaf (32 m) .. level 7 root (4096 m)
const MAX_TILES = 1200;

export function makeWorldTextures(world) {
  const N = GRID;
  const mk = (data, colorSpace, mip) => {
    const t = new THREE.DataTexture(data, N, N, THREE.RGBAFormat, THREE.UnsignedByteType);
    t.colorSpace = colorSpace;
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    t.magFilter = THREE.LinearFilter;
    t.minFilter = mip ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter;
    t.generateMipmaps = !!mip;
    t.anisotropy = 4;
    t.needsUpdate = true;
    return t;
  };
  const height = new THREE.DataTexture(world.height, N, N, THREE.RedFormat, THREE.FloatType);
  height.magFilter = height.minFilter = THREE.NearestFilter;
  height.generateMipmaps = false;
  height.wrapS = height.wrapT = THREE.ClampToEdgeWrapping;
  height.needsUpdate = true;
  return {
    height,
    normal: mk(world.normal, THREE.NoColorSpace, true),
    albedo: mk(world.albedo, THREE.SRGBColorSpace, true),
    flora: mk(world.flora, THREE.NoColorSpace, false),
    grassTop: mk(world.grassTop, THREE.SRGBColorSpace, false),
    grassBottom: mk(world.grassBottom, THREE.SRGBColorSpace, false),
  };
}

const VERT = /* glsl */ `
${GLSL_UNIFORMS}
${GLSL_HEIGHT}
attribute vec4 aTile;
uniform float uRange0;
varying vec3 vWorld;
void main(){
  vec2 g = position.xz;
  float spacing = aTile.z / ${TILE_QUADS}.0;
  vec2 pos = aTile.xy + g * spacing;
  float h0 = terrainHeight(pos);
  float dist = distance(vec3(pos.x, h0, pos.y), cameraPosition);
  float endD = uRange0 * exp2(aTile.w);
  float startD = endD * 0.7;
  float morph = clamp((dist - startD) / (endD - startD), 0.0, 1.0);
  vec2 fr = fract(g * 0.5) * 2.0;
  pos -= fr * morph * spacing;
  float h = terrainHeight(pos);
  vWorld = vec3(pos.x, h, pos.y);
  gl_Position = projectionMatrix * viewMatrix * vec4(vWorld, 1.0);
}
`;

const FRAG = /* glsl */ `
${GLSL_UNIFORMS}
${GLSL_HEIGHT}
${GLSL_FUNCS}
uniform sampler2D uNormalTex;
uniform sampler2D uAlbedoTex;
uniform sampler2D uFloraTex;
varying vec3 vWorld;
void main(){
  vec2 uv = worldUV(vWorld.xz);
  vec4 nt = texture2D(uNormalTex, uv);
  vec3 N = normalize(nt.xyz * 2.0 - 1.0);
  vec4 al = texture2D(uAlbedoTex, uv);
  vec3 albedo = al.rgb;
  vec4 fl = texture2D(uFloraTex, uv);
  float dist = distance(vWorld, cameraPosition);
  float near = 1.0 - smoothstep(60.0, 260.0, dist);
  // multi scale detail
  float d1 = nz(vWorld.xz * 0.004).g;
  float d2 = nz(vWorld.xz * 0.025).b;
  float d3 = nz(vWorld.xz * 0.06).a;
  float detail = (d1 - 0.5) * 0.5 + (d2 - 0.5) * 0.45 * near + (d3 - 0.5) * 0.3 * near;
  albedo *= 1.0 + detail;
  // grass shades the soil beneath it
  albedo = mix(albedo, albedo * vec3(0.62, 0.78, 0.5), fl.r * 0.75);
  // micro normal
  vec2 mn = vec2(nz(vWorld.xz * 0.05).b, nz(vWorld.xz * 0.07 + 0.37).a) - 0.5;
  N = normalize(N + vec3(mn.x, 0.0, mn.y) * 0.9 * near);
  float rock = smoothstep(0.55, 0.82, 1.0 - N.y);
  float strata = sin(vWorld.y * 1.4 + d1 * 5.0) * 0.5 + 0.5;
  albedo *= mix(1.0, 0.7 + 0.5 * strata, rock);
  float wet = al.a;
  albedo *= 1.0 - 0.28 * wet - 0.18 * uWet;
  float canopy = fl.a;
  float ao = nt.a * (1.0 - 0.45 * canopy);
  float dapple = mix(1.0, 0.5 + 0.7 * nz(vWorld.xz * 0.012 + vec2(uTime * 0.004, 0.0)).g, canopy);
  float shadow = cloudShadow(vWorld) * dapple;
  vec3 col = shadeSurface(albedo, N, ao, vWorld, shadow);
  col += vec3(0.5, 0.85, 1.0) * pulseBand(vWorld) * 0.5;
  col = applyFog(col, vWorld);
  gl_FragColor = vec4(col, 1.0);
}
`;

export class Terrain {
  constructor(world, tex, quality = {}) {
    this.world = world;
    this.tex = tex;
    this.range0 = quality.range0 ?? 130;
    this.tileCount = 0;
    this._buildMinMax();

    // shared grid geometry (33 x 33 vertices)
    const V = TILE_QUADS + 1;
    const pos = new Float32Array(V * V * 3);
    for (let j = 0; j < V; j++) for (let i = 0; i < V; i++) {
      const k = (j * V + i) * 3;
      pos[k] = i; pos[k + 1] = 0; pos[k + 2] = j;
    }
    const idx = [];
    for (let j = 0; j < TILE_QUADS; j++) for (let i = 0; i < TILE_QUADS; i++) {
      const a = j * V + i, b = a + 1, c = a + V, d = c + 1;
      if (((i + j) & 1) === 0) idx.push(a, c, b, b, c, d); else idx.push(a, c, d, a, d, b);
    }
    const geo = new THREE.InstancedBufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setIndex(idx);
    this.tileData = new Float32Array(MAX_TILES * 4);
    this.tileAttr = new THREE.InstancedBufferAttribute(this.tileData, 4);
    this.tileAttr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aTile', this.tileAttr);
    geo.instanceCount = 0;
    this.geometry = geo;

    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: {
        ...G,
        uHeightTex: { value: tex.height },
        uNormalTex: { value: tex.normal },
        uAlbedoTex: { value: tex.albedo },
        uFloraTex: { value: tex.flora },
        uRange0: { value: this.range0 },
      },
    });
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.matrixAutoUpdate = false;
    this._frustum = new THREE.Frustum();
    this._pv = new THREE.Matrix4();
    this._planes = this._frustum.planes;
    this.ranges = [];
    this.setRange0(this.range0);
  }

  setRange0(r) {
    this.range0 = r;
    this.material.uniforms.uRange0.value = r;
    this.ranges = [];
    for (let l = 0; l < LEVELS; l++) this.ranges.push(r * Math.pow(2, l));
  }

  _buildMinMax() {
    const N = GRID, H = this.world.height;
    this.minH = []; this.maxH = [];
    const n0 = N / (LEAF_SIZE / CELL); // 128
    const mn = new Float32Array(n0 * n0), mx = new Float32Array(n0 * n0);
    const tex = LEAF_SIZE / CELL; // 8 texels per leaf
    for (let nj = 0; nj < n0; nj++) for (let ni = 0; ni < n0; ni++) {
      let lo = 1e9, hi = -1e9;
      const i0 = ni * tex, j0 = nj * tex;
      for (let j = j0; j <= Math.min(N - 1, j0 + tex); j++) for (let i = i0; i <= Math.min(N - 1, i0 + tex); i++) {
        const v = H[j * N + i];
        if (v < lo) lo = v; if (v > hi) hi = v;
      }
      mn[nj * n0 + ni] = lo; mx[nj * n0 + ni] = hi;
    }
    this.minH.push(mn); this.maxH.push(mx);
    let n = n0;
    for (let l = 1; l < LEVELS; l++) {
      const nn = n >> 1;
      const a = new Float32Array(nn * nn), b = new Float32Array(nn * nn);
      const pm = this.minH[l - 1], px = this.maxH[l - 1];
      for (let j = 0; j < nn; j++) for (let i = 0; i < nn; i++) {
        let lo = 1e9, hi = -1e9;
        for (let dj = 0; dj < 2; dj++) for (let di = 0; di < 2; di++) {
          const k = (j * 2 + dj) * n + (i * 2 + di);
          if (pm[k] < lo) lo = pm[k]; if (px[k] > hi) hi = px[k];
        }
        a[j * nn + i] = lo; b[j * nn + i] = hi;
      }
      this.minH.push(a); this.maxH.push(b);
      n = nn;
    }
  }

  update(camera) {
    this._pv.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this._frustum.setFromProjectionMatrix(this._pv);
    this._cam = camera.position;
    this.tileCount = 0;
    this._visit(LEVELS - 1, 0, 0);
    this.geometry.instanceCount = this.tileCount;
    this.tileAttr.clearUpdateRanges();
    this.tileAttr.addUpdateRange(0, this.tileCount * 4);
    this.tileAttr.needsUpdate = true;
  }

  _visit(l, ix, iz) {
    const n = 128 >> l;
    const size = LEAF_SIZE << l;
    const x0 = -HALF + ix * size, z0 = -HALF + iz * size;
    const k = iz * n + ix;
    const y0 = this.minH[l][k] - 2, y1 = this.maxH[l][k] + 2;
    const x1 = x0 + size, z1 = z0 + size;
    const pl = this._planes;
    for (let p = 0; p < 6; p++) {
      const nx = pl[p].normal.x, ny = pl[p].normal.y, nz = pl[p].normal.z;
      const px = nx > 0 ? x1 : x0, py = ny > 0 ? y1 : y0, pz = nz > 0 ? z1 : z0;
      if (nx * px + ny * py + nz * pz + pl[p].constant < 0) return;
    }
    if (l > 0) {
      const c = this._cam;
      const dx = Math.max(x0 - c.x, 0, c.x - x1), dz = Math.max(z0 - c.z, 0, c.z - z1), dy = Math.max(y0 - c.y, 0, c.y - y1);
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (dist < this.ranges[l - 1]) {
        this._visit(l - 1, ix * 2, iz * 2);
        this._visit(l - 1, ix * 2 + 1, iz * 2);
        this._visit(l - 1, ix * 2, iz * 2 + 1);
        this._visit(l - 1, ix * 2 + 1, iz * 2 + 1);
        return;
      }
    }
    if (this.tileCount >= MAX_TILES) return;
    const o = this.tileCount * 4;
    this.tileData[o] = x0; this.tileData[o + 1] = z0; this.tileData[o + 2] = size; this.tileData[o + 3] = l;
    this.tileCount++;
  }
}
