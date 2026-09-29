// Post processing: HDR render target with MSAA, bloom, then filmic grade + sRGB encode.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

// Renders the scene with MSAA into its own target, then copies the resolved result into the composer's plain HDR
// buffers. (Blending bloom onto a multisampled target is unreliable, this keeps every later pass single sampled.)
class MsaaScenePass extends Pass {
  constructor(scene, camera, samples) {
    super();
    this.scene = scene; this.camera = camera; this.samples = samples;
    this.needsSwap = true;
    this.rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples, depthBuffer: true });
    this.quad = new FullScreenQuad(new THREE.ShaderMaterial({
      uniforms: { tSrc: { value: null } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: 'uniform sampler2D tSrc; varying vec2 vUv; void main(){ vec3 c = texture2D(tSrc, vUv).rgb; c = (c == c) ? c : vec3(0.0); gl_FragColor = vec4(clamp(c, vec3(0.0), vec3(48.0)), 1.0); }',
      depthTest: false, depthWrite: false,
    }));
  }
  setSize(w, h) { this.rt.setSize(w, h); }
  render(renderer, writeBuffer) {
    renderer.setRenderTarget(this.rt);
    renderer.clear();
    renderer.render(this.scene, this.camera);
    this.quad.material.uniforms.tSrc.value = this.rt.texture;
    renderer.setRenderTarget(writeBuffer);
    this.quad.render(renderer);
  }
  dispose() { this.rt.dispose(); this.quad.dispose(); }
}

const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    uExposure: { value: 1 },
    uSaturation: { value: 1.05 },
    uVignette: { value: 0.75 },
    uTime: { value: 0 },
    uRes: { value: new THREE.Vector2(1, 1) },
    uFade: { value: 1 },
    uTint: { value: new THREE.Color(1, 1, 1) },
    uWarmth: { value: 0 },
    uDesat: { value: 0 },
  },
  vertexShader: /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uExposure, uSaturation, uVignette, uTime, uFade, uWarmth, uDesat;
    uniform vec2 uRes;
    uniform vec3 uTint;
    varying vec2 vUv;
    vec3 aces(vec3 x){ return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0); }
    float h12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
    void main(){
      vec3 c = texture2D(tDiffuse, vUv).rgb * uExposure;
      c *= uTint;
      c = aces(c);
      float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
      c = mix(vec3(l), c, uSaturation * (1.0 - uDesat));
      c = mix(c, vec3(l), uDesat);
      c += vec3(0.02, 0.008, -0.02) * uWarmth;
      // gentle S curve
      c = mix(c, c * c * (3.0 - 2.0 * c), 0.28);
      vec2 q = vUv - 0.5;
      float v = 1.0 - dot(q, q) * uVignette;
      c *= clamp(v, 0.0, 1.0);
      c = pow(max(c, 0.0), vec3(1.0 / 2.2));
      c += (h12(vUv * uRes + fract(uTime) * 91.7) - 0.5) / 255.0 * 1.8;
      gl_FragColor = vec4(c * uFade, 1.0);
    }
  `,
};

export class Post {
  constructor(renderer, scene, camera) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    this.bloomOn = true;
    this.samples = 4;
    this._build(1, 1);
  }

  _build(w, h) {
    if (this.composer) { this.composer.dispose?.(); this.renderPass?.dispose?.(); }
    const rt = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, depthBuffer: false });
    this.composer = new EffectComposer(this.renderer, rt);
    this.renderPass = new MsaaScenePass(this.scene, this.camera, this.samples);
    this.composer.addPass(this.renderPass);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(w, h), 0.4, 0.75, 0.9);
    this.bloom.enabled = this.bloomOn;
    this.composer.addPass(this.bloom);
    this.grade = new ShaderPass(GradeShader);
    this.composer.addPass(this.grade);
    this.grade.renderToScreen = true;
  }

  configure({ samples, bloom }) {
    const changed = samples !== this.samples;
    this.samples = samples;
    this.bloomOn = bloom;
    if (changed) { const s = this.renderer.getSize(new THREE.Vector2()); this._build(s.x, s.y); this.setSize(s.x, s.y, this.renderer.getPixelRatio()); }
    this.bloom.enabled = bloom;
  }

  setSize(w, h, pr) {
    this.composer.setPixelRatio(pr);
    this.composer.setSize(w, h);
    this.grade.uniforms.uRes.value.set(w * pr, h * pr);
  }

  render(dt) {
    this.grade.uniforms.uTime.value += dt;
    this.composer.render(dt);
  }
}
