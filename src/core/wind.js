// CPU twin of the GLSL windField so gameplay (perching on swaying flowers, drift) matches what you see.
import { G, NOISE } from '../render/shaders.js';

function nz(u, v, ch) {
  const S = NOISE.size, d = NOISE.data;
  const x = u * S - 0.5, y = v * S - 0.5;
  let x0 = Math.floor(x), y0 = Math.floor(y);
  const fx = x - x0, fy = y - y0;
  x0 = ((x0 % S) + S) % S; y0 = ((y0 % S) + S) % S;
  const x1 = (x0 + 1) % S, y1 = (y0 + 1) % S;
  const a = d[(y0 * S + x0) * 4 + ch], b = d[(y0 * S + x1) * 4 + ch], c = d[(y1 * S + x0) * 4 + ch], e = d[(y1 * S + x1) * 4 + ch];
  return ((a + (b - a) * fx) * (1 - fy) + (c + (e - c) * fx) * fy) / 255;
}
const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

const out = { x: 0, z: 0 };
export function windField(x, z) {
  const w = G.uWind.value;
  const t = G.uTime.value * w.z;
  const px = x * 0.011 - w.x * t * 0.09, pz = z * 0.011 - w.y * t * 0.09;
  const g = nz(px, pz, 0) * 0.65 + nz(px * 3.1, pz * 3.1, 1) * 0.35;
  const gust = sstep(0.32, 0.8, g);
  const sway = Math.sin((x * w.x + z * w.y) * 0.6 - t * 2.3 + g * 6.0) * 0.5 + 0.5;
  const k = w.w * (0.25 + 0.75 * gust) * (0.55 + 0.45 * sway);
  out.x = w.x * k; out.z = w.y * k;
  return out;
}
