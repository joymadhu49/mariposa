// GPU grass: blades are laid out on a camera centred lattice inside the vertex shader.
// Density, height and colour come from baked maps. No per blade CPU work at all.
import * as THREE from 'three';
import { G, GLSL_UNIFORMS, GLSL_FUNCS, GLSL_HEIGHT } from './shaders.js';

const VERT = /* glsl */ `
${GLSL_UNIFORMS}
${GLSL_HEIGHT}
${GLSL_FUNCS}
attribute float aDummy;
uniform sampler2D uFloraTex;
uniform sampler2D uGrassTop;
uniform sampler2D uGrassBot;
uniform vec2 uCenter;
uniform float uSpacing;
uniform float uCount;
uniform float uRadius;
uniform float uInner;
uniform float uWidth;
uniform float uHeightMul;
varying vec3 vColor;
varying float vY;
varying vec3 vWorld;
varying vec3 vN;
varying float vShadeK;
varying float vSide;

void main(){
  float id = float(gl_InstanceID);
  float row = floor(id / uCount);
  float col = id - row * uCount;
  vec2 basePos = uCenter + (vec2(col, row) - uCount * 0.5) * uSpacing;
  vec2 j = hash22(basePos * 0.713 + 3.1);
  vec2 pos = basePos + (j - 0.5) * uSpacing * 1.15;
  vec2 dv = pos - cameraPosition.xz;
  float dist = length(dv);
  float rnd = hash12(pos * 1.31 + 7.7);
  vec2 uv = worldUV(pos);
  vec4 fl = texture2D(uFloraTex, uv);
  float fadeOut = 1.0 - smoothstep(uRadius * 0.52, uRadius, dist);
  float fadeIn = uInner > 0.0 ? smoothstep(uInner * 0.55, uInner, dist) : 1.0;
  float keep = fl.r * fadeOut * fadeIn;
  // cull blades that are not kept, and blades behind the camera for cheapness
  vec3 fwd = -vec3(viewMatrix[0][2], viewMatrix[1][2], viewMatrix[2][2]);
  bool behind = dot(vec3(dv.x, 0.0, dv.y), vec3(fwd.x, 0.0, fwd.z)) < -uSpacing * 4.0 - 6.0 && dist > 8.0;
  if (rnd > keep || behind) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); vColor = vec3(0.0); vY = 0.0; vWorld = vec3(0.0); vN = vec3(0,1,0); vShadeK = 1.0; vSide = 0.0; return; }

  float ground = terrainHeight(pos);
  float hM = fl.g * 1.6 * (0.62 + 0.75 * hash12(pos * 2.9 + 1.3)) * uHeightMul;
  float yy = position.y;
  float side = position.x;
  float yaw = hash12(pos * 0.37 + 11.0) * 6.2831853;
  vec2 right = vec2(cos(yaw), sin(yaw));
  float taper = 1.0 - yy * yy * 0.92;
  float widthM = uWidth * (0.8 + 0.5 * hash12(pos * 4.1));
  // lean and wind
  float leanA = hash12(pos * 0.91 + 4.0) * 6.2831853;
  vec2 lean = vec2(cos(leanA), sin(leanA)) * (0.12 + 0.28 * hash12(pos * 1.7)) * hM;
  vec2 wind = windField(pos) * hM * 0.9;
  vec2 fromP = pos - uPlayerPos.xz;
  float pd = length(fromP);
  float pushK = smoothstep(4.5, 0.4, pd) * (1.0 - smoothstep(1.5, 9.0, uPlayerPos.y - ground));
  vec2 push = normalize(fromP + 0.001) * pushK * hM * 0.75;
  float bend = yy * yy;
  vec2 off = (lean + wind + push) * bend;
  vec3 wp = vec3(pos.x, ground, pos.y);
  wp.xz += right * side * widthM * 0.5 * taper + off;
  wp.y += yy * hM * (1.0 - 0.18 * length(off) / max(hM, 0.05) * bend);
  vWorld = wp;
  vec3 topC = texture2D(uGrassTop, uv).rgb;
  vec3 botC = texture2D(uGrassBot, uv).rgb;
  float tone = 0.85 + 0.3 * hash12(pos * 5.3);
  vColor = mix(botC, topC, pow(yy, 0.85)) * tone;
  // blade normal leans away from its bend direction, with a soft round cross section
  vec2 nd = normalize(right + off * 0.5 + 0.0001);
  vN = normalize(vec3(nd.y * side * 0.35 - off.x * 0.15, 0.85, -nd.x * side * 0.35 - off.y * 0.15));
  vY = yy;
  vShadeK = fl.a;
  vSide = side;
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}
`;

const FRAG = /* glsl */ `
${GLSL_UNIFORMS}
${GLSL_FUNCS}
varying vec3 vColor;
varying float vY;
varying vec3 vWorld;
varying vec3 vN;
varying float vShadeK;
varying float vSide;
void main(){
  vec3 N = normalize(vN);
  if (!gl_FrontFacing) N.xz = -N.xz;
  float ao = mix(0.32, 1.0, smoothstep(0.0, 0.7, vY));
  float shadow = cloudShadow(vWorld) * mix(1.0, 0.6, vShadeK);
  vec3 col = shadeSurface(vColor, N, ao, vWorld, shadow);
  vec3 V = normalize(cameraPosition - vWorld);
  float back = pow(max(dot(-V, uSunDir), 0.0), 2.5) * smoothstep(0.1, 0.9, vY);
  col += vColor * uSunColor * back * 0.5 * shadow;
  float rim = pow(clamp(1.0 - abs(vSide) * 0.5, 0.0, 1.0), 2.0) * 0.06;
  col *= 0.94 + rim;
  col += vec3(0.5, 0.85, 1.0) * pulseBand(vWorld) * 0.4;
  float mx = max(col.r, max(col.g, col.b));
  col *= min(1.0, 1.25 / max(mx, 0.001));
  col = applyFog(col, vWorld);
  gl_FragColor = vec4(col, 1.0);
}
`;

function bladeGeometry(maxInstances) {
  const g = new THREE.InstancedBufferGeometry();
  // x: -1..1 across, y: 0..1 along
  const P = [[-1, 0], [1, 0], [-1, 0.36], [1, 0.36], [-1, 0.7], [1, 0.7], [0, 1]];
  const pos = new Float32Array(P.length * 3);
  P.forEach((p, i) => { pos[i * 3] = p[0]; pos[i * 3 + 1] = p[1]; pos[i * 3 + 2] = 0; });
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setIndex([0, 1, 2, 1, 3, 2, 2, 3, 4, 3, 5, 4, 4, 5, 6]);
  g.setAttribute('aDummy', new THREE.InstancedBufferAttribute(new Uint8Array(maxInstances), 1));
  return g;
}

export class Grass {
  constructor(tex, preset) {
    this.group = new THREE.Group();
    this.tex = tex;
    this.rings = [];
    this.def = [
      { spacing: 0.29, count: 340, radius: 49, inner: 0, width: 0.09, height: 1.0 },
      { spacing: 0.75, count: 290, radius: 108, inner: 44, width: 0.2, height: 1.12 },
      { spacing: 1.9, count: 240, radius: 226, inner: 96, width: 0.46, height: 1.26 },
    ];
    for (const d of this.def) this._addRing(d);
    this.setQuality(preset?.grass ?? 1);
  }

  _addRing(d) {
    const geo = bladeGeometry(d.count * d.count);
    const mat = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      side: THREE.DoubleSide,
      uniforms: {
        ...G,
        uHeightTex: { value: this.tex.height },
        uFloraTex: { value: this.tex.flora },
        uGrassTop: { value: this.tex.grassTop },
        uGrassBot: { value: this.tex.grassBottom },
        uCenter: { value: new THREE.Vector2() },
        uSpacing: { value: d.spacing },
        uCount: { value: d.count },
        uRadius: { value: d.radius },
        uInner: { value: d.inner },
        uWidth: { value: d.width },
        uHeightMul: { value: d.height },
      },
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false;
    mesh.renderOrder = 1;
    this.group.add(mesh);
    this.rings.push({ mesh, mat, geo, d, baseCount: d.count });
  }

  setQuality(q) {
    // q scales the lattice size (blade counts) and reach
    for (const r of this.rings) {
      const count = Math.max(40, Math.round(r.baseCount * Math.sqrt(q)));
      const scale = r.baseCount / count;
      r.count = count;
      r.mat.uniforms.uCount.value = count;
      r.mat.uniforms.uSpacing.value = r.d.spacing * scale;
      r.mat.uniforms.uRadius.value = r.d.radius;
      r.mat.uniforms.uWidth.value = r.d.width * Math.sqrt(scale);
      r.geo.instanceCount = count * count;
    }
    this.quality = q;
  }

  update(camera) {
    for (const r of this.rings) {
      const sp = r.mat.uniforms.uSpacing.value;
      const cx = Math.floor(camera.position.x / sp) * sp, cz = Math.floor(camera.position.z / sp) * sp;
      r.mat.uniforms.uCenter.value.set(cx, cz);
    }
  }
}
