// Rising air columns over sun warmed ground. Deterministic per 240 m cell.
import { hash2f, smoothstep, TAU } from '../core/util.js';

const CELL = 240;
export class Thermals {
  constructor(world) {
    this.world = world;
    this.cache = new Map();
    this.active = 1;
  }
  _cell(cx, cz) {
    const k = cz * 4096 + cx;
    let c = this.cache.get(k);
    if (c) return c;
    c = null;
    if (hash2f(cx, cz, 901) < 0.55) {
      const x = (cx + 0.15 + hash2f(cx, cz, 902) * 0.7) * CELL - 2048;
      const z = (cz + 0.15 + hash2f(cx, cz, 903) * 0.7) * CELL - 2048;
      const y = this.world.heightAt(x, z);
      const water = this.world.waterLevelAt(x, z) !== null;
      // sun baked, open ground: not water and not the deep forest
      if (!water && y > 4) {
        c = { x, z, y, r: 15 + hash2f(cx, cz, 904) * 11, s: 3.2 + hash2f(cx, cz, 905) * 2.4, ph: hash2f(cx, cz, 906) * TAU, top: y + 90 + hash2f(cx, cz, 907) * 90 };
      }
    }
    this.cache.set(k, c || false);
    return c || false;
  }
  // Fills `out` (array) with thermals within radius of x,z
  near(x, z, radius, out) {
    out.length = 0;
    const c0x = Math.floor((x - radius + 2048) / CELL), c1x = Math.floor((x + radius + 2048) / CELL);
    const c0z = Math.floor((z - radius + 2048) / CELL), c1z = Math.floor((z + radius + 2048) / CELL);
    for (let cz = c0z; cz <= c1z; cz++) for (let cx = c0x; cx <= c1x; cx++) {
      if (cx < 0 || cz < 0 || cx > 16 || cz > 16) continue;
      const t = this._cell(cx, cz);
      if (t && Math.hypot(t.x - x, t.z - z) < radius) out.push(t);
    }
    return out;
  }
  // upward speed contribution at a position (m/s)
  liftAt(x, y, z, time) {
    if (this.active <= 0.01) return 0;
    let lift = 0;
    const c0x = Math.floor((x - 30 + 2048) / CELL), c1x = Math.floor((x + 30 + 2048) / CELL);
    const c0z = Math.floor((z - 30 + 2048) / CELL), c1z = Math.floor((z + 30 + 2048) / CELL);
    for (let cz = c0z; cz <= c1z; cz++) for (let cx = c0x; cx <= c1x; cx++) {
      if (cx < 0 || cz < 0 || cx > 16 || cz > 16) continue;
      const t = this._cell(cx, cz);
      if (!t) continue;
      const d = Math.hypot(x - t.x, z - t.z);
      if (d > t.r * 1.4) continue;
      const radial = 1 - smoothstep(t.r * 0.35, t.r * 1.35, d);
      const vertical = smoothstep(t.y, t.y + 4, y) * (1 - smoothstep(t.top - 25, t.top, y));
      const pulse = 0.72 + 0.28 * Math.sin(time * 0.35 + t.ph);
      lift += t.s * radial * vertical * pulse * this.active;
    }
    return lift;
  }
}
