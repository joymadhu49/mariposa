// Sky dome: gradient, sun, moon with phase, stars, layered clouds. Drawn at the far plane.
import * as THREE from 'three';
import { G, GLSL_UNIFORMS, GLSL_FUNCS } from './shaders.js';

const VERT = /* glsl */ `
varying vec3 vDir;
void main(){
  vDir = position;
  vec4 p = projectionMatrix * vec4(mat3(viewMatrix) * position, 1.0);
  gl_Position = p.xyww;
}
`;

const FRAG = /* glsl */ `
${GLSL_UNIFORMS}
${GLSL_FUNCS}
uniform float uRainbow;
varying vec3 vDir;

float star(vec3 d, float scale, float thresh){
  vec3 p = d * scale;
  vec3 ip = floor(p);
  vec3 fp = fract(p) - 0.5;
  float h = hash12(ip.xy + ip.z * 17.31);
  vec3 off = (hash32(ip.xz + ip.y * 5.7) - 0.5) * 0.6;
  float s = smoothstep(0.075, 0.0, length(fp - off)) * step(thresh, h);
  return s * (0.5 + h);
}

void main(){
  vec3 d = normalize(vDir);
  vec3 col = skyColor(d);
  float horizonFade = smoothstep(0.0, 0.14, d.y);
  float sunUp = smoothstep(-0.06, 0.06, uSunDirVis.y);

  // stars and faint galaxy band
  if (uNight > 0.03 && d.y > -0.1) {
    float tw = 0.75 + 0.25 * sin(uTime * 2.3 + hash12(floor(d.xz * 200.0)) * 40.0);
    float st = star(d, 46.0, 0.93) + star(d, 90.0, 0.955) * 0.7 + star(d, 150.0, 0.975) * 0.5;
    col += vec3(0.85, 0.92, 1.0) * st * tw * 2.2 * uNight * horizonFade;
    vec3 gal = normalize(vec3(0.3, 0.55, 0.75));
    float gd = dot(d, gal) * 3.6;
    float band = exp(-gd * gd);
    vec2 uv = vec2(atan(d.z, d.x), d.y) * 1.3;
    float gn = nz(uv * 1.5).g * 0.6 + nz(uv * 4.0).b * 0.4;
    col += vec3(0.22, 0.26, 0.42) * band * gn * 0.55 * uNight * horizonFade;
  }

  // sun disc
  float sdp = dot(d, uSunDirVis);
  float disc = smoothstep(0.99938, 0.99968, sdp);
  vec3 sunCol = mix(vec3(1.0, 0.72, 0.42), vec3(1.0, 0.96, 0.88), smoothstep(0.02, 0.45, uSunDirVis.y));
  vec3 sunLayer = sunCol * disc * 16.0 * sunUp;

  // moon disc with phase
  float md = dot(d, uMoonDir);
  vec3 moonLayer = vec3(0.0);
  float moonUp = smoothstep(-0.05, 0.1, uMoonDir.y);
  moonLayer += vec3(0.42, 0.52, 0.85) * pow(max(md, 0.0), 300.0) * 0.55 * moonUp;
  if (md > 0.9993) {
    vec3 up = abs(uMoonDir.y) < 0.99 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
    vec3 right = normalize(cross(up, uMoonDir));
    vec3 u2 = cross(uMoonDir, right);
    vec2 q = vec2(dot(d, right), dot(d, u2)) / 0.0365;
    float r2 = dot(q, q);
    if (r2 < 1.0) {
      vec3 nrm = vec3(q, sqrt(1.0 - r2));
      float ang = uMoonPhase * 6.2831853;
      vec3 L = normalize(vec3(sin(ang), 0.15, -cos(ang)));
      float lit = smoothstep(-0.03, 0.14, dot(nrm, L));
      float maria = nz(q * 0.35 + 0.5).g * 0.6 + nz(q * 0.9 + 0.2).b * 0.4;
      vec3 mc = vec3(0.92, 0.94, 1.0) * (0.78 + 0.32 * maria) * (0.06 + 0.94 * lit) * 2.4;
      float edge = smoothstep(1.0, 0.94, r2);
      moonLayer = mix(moonLayer, mc, edge * moonUp);
    }
  }

  // clouds
  float cloudA = 0.0;
  vec3 cloudC = vec3(0.0);
  if (d.y > 0.0) {
    float hgt = 1400.0 - cameraPosition.y;
    vec2 cxz = cameraPosition.xz + d.xz / max(d.y, 0.02) * hgt;
    float dens = cloudDensity(cxz);
    float far = smoothstep(0.02, 0.34, d.y);
    vec2 toSun = uSunDirVis.xz / max(uSunDirVis.y, 0.3) * 110.0;
    float dens2 = cloudDensity(cxz + toSun);
    float light = clamp(1.0 - (dens2 - dens * 0.25) * 1.25, 0.0, 1.0);
    vec3 base = uAmbUp * 1.05 + vec3(0.03, 0.035, 0.05);
    vec3 lit = uSunColor * (0.42 + 0.5 * light) * (0.45 + 0.55 * max(uSunDirVis.y, 0.0) + 0.35);
    float lining = pow(clamp(1.0 - dens, 0.0, 1.0), 2.5) * light;
    cloudC = base * (0.62 + 0.38 * light) + lit * light * 0.55 + uSunColor * lining * 0.55;
    // slightly warm shadow underside near the horizon
    cloudC = mix(cloudC, uSkyHorizon * 0.9, (1.0 - far) * 0.55);
    cloudA = dens * far * 0.93;
    // high thin streaks
    vec2 cp = cameraPosition.xz + d.xz / max(d.y, 0.05) * (4200.0 - cameraPosition.y);
    float cir = nz(vec2(cp.x * 0.00006, cp.y * 0.00042) + uCloudOffset * 0.3).g;
    cir = smoothstep(0.58, 0.9, cir * 0.7 + nz(cp * 0.00021).b * 0.4) * 0.14 * smoothstep(0.05, 0.4, d.y);
    vec3 cirC = uAmbUp * 0.9 + uSunColor * 0.32;
    cloudC = mix(cirC, cloudC, clamp(cloudA / max(cloudA + cir, 0.001), 0.0, 1.0));
    cloudA = clamp(cloudA + cir * (1.0 - cloudA), 0.0, 1.0);
  }
  sunLayer *= 1.0 - cloudA * 0.95;
  moonLayer *= 1.0 - cloudA * 0.8;
  col = col + sunLayer + moonLayer;
  col = mix(col, cloudC, cloudA);
  // rainbow arc opposite the sun after rain
  if (uRainbow > 0.001 && uSunDirVis.y > 0.02) {
    vec3 anti = normalize(vec3(-uSunDirVis.x, -uSunDirVis.y, -uSunDirVis.z));
    float ang = acos(clamp(dot(d, anti), -1.0, 1.0));
    float r = (ang - 0.73) / 0.05; // primary bow near 42 degrees
    float band = smoothstep(0.0, 0.08, r) * (1.0 - smoothstep(0.92, 1.0, r));
    vec3 rb = 0.5 + 0.5 * cos(6.28318 * (vec3(0.0, 0.33, 0.67) + (1.0 - clamp(r, 0.0, 1.0)) * 0.72 + 0.02));
    col += rb * band * uRainbow * 0.5 * smoothstep(-0.02, 0.15, d.y) * (1.0 - cloudA * 0.6);
  }
  gl_FragColor = vec4(col, 1.0);
}
`;

export class Sky {
  constructor() {
    this.uRainbow = { value: 0 };
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: { ...G, uRainbow: this.uRainbow },
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: true,
    });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 32), this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -100;
  }
}
