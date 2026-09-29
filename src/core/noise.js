// Seeded 2D gradient noise, fBm and ridged noise. Returns roughly -1..1.
import { mulberry32 } from './util.js';

const GX = new Float32Array([1, -1, 1, -1, 1, -1, 0, 0, 0.7071, -0.7071, 0.7071, -0.7071]);
const GY = new Float32Array([1, 1, -1, -1, 0, 0, 1, -1, 0.7071, 0.7071, -0.7071, -0.7071]);

export class Noise {
  constructor(seed = 1) {
    const rnd = mulberry32(seed);
    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) p[i] = i;
    for (let i = 255; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      const t = p[i]; p[i] = p[j]; p[j] = t;
    }
    this.perm = new Uint8Array(512);
    this.gi = new Uint8Array(512);
    for (let i = 0; i < 512; i++) {
      this.perm[i] = p[i & 255];
      this.gi[i] = this.perm[i] % 12;
    }
  }

  n2(x, y) {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = x - xi, yf = y - yi;
    const X = xi & 255, Y = yi & 255;
    const perm = this.perm, gi = this.gi;
    const u = xf * xf * xf * (xf * (xf * 6 - 15) + 10);
    const v = yf * yf * yf * (yf * (yf * 6 - 15) + 10);
    const a = perm[X] + Y, b = perm[X + 1] + Y;
    const g00 = gi[perm[a]], g10 = gi[perm[b]], g01 = gi[perm[a + 1]], g11 = gi[perm[b + 1]];
    const n00 = GX[g00] * xf + GY[g00] * yf;
    const n10 = GX[g10] * (xf - 1) + GY[g10] * yf;
    const n01 = GX[g01] * xf + GY[g01] * (yf - 1);
    const n11 = GX[g11] * (xf - 1) + GY[g11] * (yf - 1);
    const nx0 = n00 + (n10 - n00) * u;
    const nx1 = n01 + (n11 - n01) * u;
    return (nx0 + (nx1 - nx0) * v) * 1.4142;
  }

  fbm(x, y, oct = 5, lac = 2.02, gain = 0.5) {
    let f = 1, a = 1, s = 0, n = 0;
    for (let i = 0; i < oct; i++) {
      s += this.n2(x * f + i * 17.3, y * f - i * 9.1) * a;
      n += a;
      f *= lac;
      a *= gain;
    }
    return s / n;
  }

  // 0..1 ridges
  ridged(x, y, oct = 5, lac = 2.05, gain = 0.5) {
    let f = 1, a = 1, s = 0, n = 0, w = 1;
    for (let i = 0; i < oct; i++) {
      let r = 1 - Math.abs(this.n2(x * f + i * 31.7, y * f + i * 7.9));
      r *= r;
      r *= w;
      w = Math.min(1, Math.max(0, r * 2));
      s += r * a;
      n += a;
      f *= lac;
      a *= gain;
    }
    return s / n;
  }
}
