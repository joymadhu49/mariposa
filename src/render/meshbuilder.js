// Tiny procedural mesh builder: flat or smooth shaded primitives with vertex colour, part id and shade.
import * as THREE from 'three';

const _v = new THREE.Vector3(), _n = new THREE.Vector3(), _m3 = new THREE.Matrix3();
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _ab = new THREE.Vector3(), _ac = new THREE.Vector3();

export class MeshBuilder {
  constructor() {
    this.pos = []; this.nor = []; this.col = []; this.part = []; this.shade = []; this.idx = [];
    this.stack = [new THREE.Matrix4()];
    this.color = [1, 1, 1];
    this.partId = 0;
  }
  get m() { return this.stack[this.stack.length - 1]; }
  push() { this.stack.push(this.m.clone()); return this; }
  pop() { this.stack.pop(); return this; }
  translate(x, y, z) { this.m.multiply(new THREE.Matrix4().makeTranslation(x, y, z)); return this; }
  scale(x, y = x, z = x) { this.m.multiply(new THREE.Matrix4().makeScale(x, y, z)); return this; }
  rotX(a) { this.m.multiply(new THREE.Matrix4().makeRotationX(a)); return this; }
  rotY(a) { this.m.multiply(new THREE.Matrix4().makeRotationY(a)); return this; }
  rotZ(a) { this.m.multiply(new THREE.Matrix4().makeRotationZ(a)); return this; }
  setColor(c) { this.color = c; return this; }
  setPart(p) { this.partId = p; return this; }

  // add a vertex in local space; transformed by the current matrix
  vertex(x, y, z, nx, ny, nz, color = this.color, part = this.partId, shade = 0) {
    _v.set(x, y, z).applyMatrix4(this.m);
    _m3.getNormalMatrix(this.m);
    _n.set(nx, ny, nz).applyMatrix3(_m3).normalize();
    this.pos.push(_v.x, _v.y, _v.z);
    this.nor.push(_n.x, _n.y, _n.z);
    this.col.push(color[0], color[1], color[2]);
    this.part.push(part);
    this.shade.push(shade);
    return this.pos.length / 3 - 1;
  }
  tri(a, b, c) { this.idx.push(a, b, c); return this; }

  // flat shaded triangle from three local points; optional per vertex shade and colour
  flatTri(p0, p1, p2, shades = [0, 0, 0], colors = null, part = this.partId) {
    _ab.set(p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]);
    _ac.set(p2[0] - p0[0], p2[1] - p0[1], p2[2] - p0[2]);
    _n.crossVectors(_ab, _ac).normalize();
    const nx = _n.x, ny = _n.y, nz = _n.z;
    const c0 = colors ? colors[0] : this.color, c1 = colors ? colors[1] : this.color, c2 = colors ? colors[2] : this.color;
    const a = this.vertex(p0[0], p0[1], p0[2], nx, ny, nz, c0, part, shades[0]);
    const b = this.vertex(p1[0], p1[1], p1[2], nx, ny, nz, c1, part, shades[1]);
    const c = this.vertex(p2[0], p2[1], p2[2], nx, ny, nz, c2, part, shades[2]);
    this.idx.push(a, b, c);
    return this;
  }
  flatQuad(p0, p1, p2, p3, shades = [0, 0, 0, 0], colors = null, part = this.partId) {
    this.flatTri(p0, p1, p2, [shades[0], shades[1], shades[2]], colors && [colors[0], colors[1], colors[2]], part);
    this.flatTri(p0, p2, p3, [shades[0], shades[2], shades[3]], colors && [colors[0], colors[2], colors[3]], part);
    return this;
  }

  // tapered cylinder along +Y from y0 to y0+h. colours blend from c0 (bottom) to c1 (top).
  cylinder({ r0 = 0.5, r1 = 0.5, h = 1, seg = 8, y0 = 0, c0 = this.color, c1 = this.color, capTop = false, capBottom = false, smooth = true, part = this.partId, shade0 = 0, shade1 = 1 }) {
    const rings = [];
    for (let i = 0; i < seg; i++) {
      const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2;
      const x0 = Math.cos(a0), z0 = Math.sin(a0), x1 = Math.cos(a1), z1 = Math.sin(a1);
      const slope = (r0 - r1) / h;
      if (smooth) {
        const ia = this.vertex(x0 * r0, y0, z0 * r0, x0, slope, z0, c0, part, shade0);
        const ib = this.vertex(x1 * r0, y0, z1 * r0, x1, slope, z1, c0, part, shade0);
        const ic = this.vertex(x0 * r1, y0 + h, z0 * r1, x0, slope, z0, c1, part, shade1);
        const id = this.vertex(x1 * r1, y0 + h, z1 * r1, x1, slope, z1, c1, part, shade1);
        this.idx.push(ia, ic, ib, ib, ic, id);
      } else {
        this.flatQuad([x0 * r0, y0, z0 * r0], [x0 * r1, y0 + h, z0 * r1], [x1 * r1, y0 + h, z1 * r1], [x1 * r0, y0, z1 * r0], [shade0, shade1, shade1, shade0], [c0, c1, c1, c0], part);
      }
    }
    if (capTop && r1 > 0) this.disc(r1, y0 + h, seg, c1, true, part, shade1);
    if (capBottom && r0 > 0) this.disc(r0, y0, seg, c0, false, part, shade0);
    return this;
  }
  disc(r, y, seg = 8, color = this.color, up = true, part = this.partId, shade = 0) {
    const c = this.vertex(0, y, 0, 0, up ? 1 : -1, 0, color, part, shade);
    const ring = [];
    for (let i = 0; i < seg; i++) {
      const a = (i / seg) * Math.PI * 2;
      ring.push(this.vertex(Math.cos(a) * r, y, Math.sin(a) * r, 0, up ? 1 : -1, 0, color, part, shade));
    }
    for (let i = 0; i < seg; i++) { const a = ring[i], b = ring[(i + 1) % seg]; if (up) this.idx.push(c, b, a); else this.idx.push(c, a, b); }
    return this;
  }
  cone({ r = 0.5, h = 1, seg = 8, y0 = 0, c0 = this.color, c1 = this.color, part = this.partId, smooth = true, shade0 = 0, shade1 = 1, capBottom = false }) {
    return this.cylinder({ r0: r, r1: 0.0001, h, seg, y0, c0, c1, part, smooth, shade0, shade1, capBottom });
  }

  // icosphere with optional radial noise displacement, flat or smooth shaded.
  sphere({ r = 1, detail = 1, color = this.color, part = this.partId, flat = true, displace = null, squashY = 1, shadeBottom = 0, shadeTop = 1, colorFn = null }) {
    const t = (1 + Math.sqrt(5)) / 2;
    let verts = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]].map((v) => { const l = Math.hypot(...v); return [v[0] / l, v[1] / l, v[2] / l]; });
    let faces = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8], [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]];
    for (let d = 0; d < detail; d++) {
      const cache = new Map();
      const mid = (a, b) => {
        const key = a < b ? a + '_' + b : b + '_' + a;
        if (cache.has(key)) return cache.get(key);
        const va = verts[a], vb = verts[b];
        const m = [(va[0] + vb[0]) / 2, (va[1] + vb[1]) / 2, (va[2] + vb[2]) / 2];
        const l = Math.hypot(...m); m[0] /= l; m[1] /= l; m[2] /= l;
        verts.push(m); cache.set(key, verts.length - 1); return verts.length - 1;
      };
      const nf = [];
      for (const [a, b, c] of faces) { const ab = mid(a, b), bc = mid(b, c), ca = mid(c, a); nf.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]); }
      faces = nf;
    }
    const P = verts.map((v) => {
      let s = r;
      if (displace) s *= displace(v[0], v[1], v[2]);
      return [v[0] * s, v[1] * s * squashY, v[2] * s];
    });
    const shadeOf = (y) => shadeBottom + (shadeTop - shadeBottom) * (y * 0.5 + 0.5);
    const colOf = (i) => (colorFn ? colorFn(verts[i][0], verts[i][1], verts[i][2]) : color);
    if (flat) {
      for (const [a, b, c] of faces) {
        this.flatTri(P[a], P[b], P[c], [shadeOf(verts[a][1]), shadeOf(verts[b][1]), shadeOf(verts[c][1])], [colOf(a), colOf(b), colOf(c)], part);
      }
    } else {
      const map = new Map();
      const get = (i) => {
        if (map.has(i)) return map.get(i);
        const v = verts[i];
        const id = this.vertex(P[i][0], P[i][1], P[i][2], v[0], v[1] / Math.max(squashY, 0.01), v[2], colOf(i), part, shadeOf(v[1]));
        map.set(i, id); return id;
      };
      for (const [a, b, c] of faces) this.idx.push(get(a), get(b), get(c));
    }
    return this;
  }

  box({ w = 1, h = 1, d = 1, y0 = 0, c0 = this.color, c1 = this.color, part = this.partId, shade0 = 0, shade1 = 1 }) {
    const x = w / 2, z = d / 2, y1 = y0 + h;
    const S = [shade0, shade0, shade1, shade1];
    const q = (a, b, c, e, cols) => this.flatQuad(a, b, c, e, S, cols, part);
    q([-x, y0, z], [x, y0, z], [x, y1, z], [-x, y1, z], [c0, c0, c1, c1]);
    q([x, y0, -z], [-x, y0, -z], [-x, y1, -z], [x, y1, -z], [c0, c0, c1, c1]);
    q([x, y0, z], [x, y0, -z], [x, y1, -z], [x, y1, z], [c0, c0, c1, c1]);
    q([-x, y0, -z], [-x, y0, z], [-x, y1, z], [-x, y1, -z], [c0, c0, c1, c1]);
    this.flatQuad([-x, y1, z], [x, y1, z], [x, y1, -z], [-x, y1, -z], [shade1, shade1, shade1, shade1], [c1, c1, c1, c1], part);
    this.flatQuad([-x, y0, -z], [x, y0, -z], [x, y0, z], [-x, y0, z], [shade0, shade0, shade0, shade0], [c0, c0, c0, c0], part);
    return this;
  }

  torus({ R = 1, r = 0.2, seg = 16, tube = 6, arc = Math.PI * 2, color = this.color, part = this.partId, shade0 = 0, shade1 = 1 }) {
    const rows = [];
    for (let i = 0; i <= seg; i++) {
      const a = (i / seg) * arc;
      const row = [];
      for (let j = 0; j < tube; j++) {
        const b = (j / tube) * Math.PI * 2;
        const nx = Math.cos(a) * Math.cos(b), ny = Math.sin(b), nz = Math.sin(a) * Math.cos(b);
        row.push(this.vertex((R + r * Math.cos(b)) * Math.cos(a), r * Math.sin(b), (R + r * Math.cos(b)) * Math.sin(a), nx, ny, nz, color, part, shade0 + (shade1 - shade0) * (ny * 0.5 + 0.5)));
      }
      rows.push(row);
    }
    for (let i = 0; i < seg; i++) for (let j = 0; j < tube; j++) {
      const a = rows[i][j], b = rows[i][(j + 1) % tube], c = rows[i + 1][j], d = rows[i + 1][(j + 1) % tube];
      this.idx.push(a, c, b, b, c, d);
    }
    return this;
  }

  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('aPart', new THREE.Float32BufferAttribute(this.part, 1));
    g.setAttribute('aShade', new THREE.Float32BufferAttribute(this.shade, 1));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    return g;
  }
}

// Deterministic mini noise for shape displacement (value noise on the unit sphere).
export function shapeNoise(seed) {
  const h = (x, y, z) => {
    let n = Math.sin(x * 127.1 + y * 311.7 + z * 74.7 + seed * 19.19) * 43758.5453;
    return n - Math.floor(n);
  };
  return (x, y, z) => {
    const f = 2.3;
    const px = x * f, py = y * f, pz = z * f;
    const ix = Math.floor(px), iy = Math.floor(py), iz = Math.floor(pz);
    const fx = px - ix, fy = py - iy, fz = pz - iz;
    const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy), sz = fz * fz * (3 - 2 * fz);
    const l = (a, b, t) => a + (b - a) * t;
    const c000 = h(ix, iy, iz), c100 = h(ix + 1, iy, iz), c010 = h(ix, iy + 1, iz), c110 = h(ix + 1, iy + 1, iz);
    const c001 = h(ix, iy, iz + 1), c101 = h(ix + 1, iy, iz + 1), c011 = h(ix, iy + 1, iz + 1), c111 = h(ix + 1, iy + 1, iz + 1);
    return l(l(l(c000, c100, sx), l(c010, c110, sx), sy), l(l(c001, c101, sx), l(c011, c111, sx), sy), sz);
  };
}
