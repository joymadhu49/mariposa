// The butterfly: procedural body and wing meshes, painted wing atlas for nine species,
// and one instanced renderer used for the player and every ambient butterfly.
import * as THREE from 'three';
import { MeshBuilder } from './meshbuilder.js';
import { G, GLSL_UNIFORMS, GLSL_FUNCS } from './shaders.js';
import { mulberry32, TAU } from '../core/util.js';

// ---- species -------------------------------------------------------------------------------------
// playable: index < 6. irid drives view dependent colour, glow is a night emission amount.
export const SPECIES = [
  { key: 'monarch', name: 'Monarch', irid: 0, glow: 0.05, tail: 0, size: 1.0 },
  { key: 'morpho', name: 'Blue Morpho', irid: 0.85, glow: 0.12, tail: 0, size: 1.06 },
  { key: 'swallowtail', name: 'Swallowtail', irid: 0.1, glow: 0.05, tail: 1, size: 1.08, bright: 0.86 },
  { key: 'glasswing', name: 'Glasswing', irid: 0.35, glow: 0.1, tail: 0, size: 0.96 },
  { key: 'luna', name: 'Luna Moth', irid: 0.2, glow: 0.65, tail: 2, size: 1.1, bright: 0.6 },
  { key: 'aurora', name: 'Aurora Wing', irid: 1.0, glow: 0.9, tail: 1, size: 1.12, bright: 0.68 },
  { key: 'sulphur', name: 'Sulphur', irid: 0, glow: 0.04, tail: 0, size: 0.75, bright: 0.78 },
  { key: 'white', name: 'Cabbage White', irid: 0, glow: 0.04, tail: 0, size: 0.7, bright: 0.68 },
  { key: 'peacock', name: 'Peacock', irid: 0.05, glow: 0.04, tail: 0, size: 0.85 },
];
export const PLAYABLE = 6;

// ---- wing outlines (right wing, x outward, z forward, unit = wing length) --------------------------
function catmull(pts, per = 5, closed = true) {
  const out = [];
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n], p1 = pts[i], p2 = pts[(i + 1) % n], p3 = pts[(i + 2) % n];
    for (let k = 0; k < per; k++) {
      const t = k / per, t2 = t * t, t3 = t2 * t;
      out.push([
        0.5 * ((2 * p1[0]) + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3),
        0.5 * ((2 * p1[1]) + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3),
      ]);
    }
  }
  return out;
}

const OUTLINES = {
  // control points (x, z), clockwise around the wing
  fore: [[0.02, 0.1], [0.3, 0.32], [0.66, 0.44], [0.93, 0.36], [1.02, 0.16], [0.97, -0.06], [0.84, -0.26], [0.62, -0.36], [0.36, -0.28], [0.12, -0.16], [0.0, -0.04]],
  hind: [[0.0, 0.02], [0.28, 0.0], [0.56, -0.08], [0.76, -0.24], [0.8, -0.5], [0.66, -0.72], [0.42, -0.8], [0.2, -0.66], [0.06, -0.42], [0.0, -0.18]],
  hindTail: [[0.0, 0.02], [0.28, 0.0], [0.56, -0.08], [0.74, -0.26], [0.72, -0.5], [0.6, -0.64], [0.5, -0.9], [0.42, -1.16], [0.36, -0.9], [0.26, -0.66], [0.08, -0.42], [0.0, -0.18]],
  hindLuna: [[0.0, 0.02], [0.3, 0.0], [0.54, -0.1], [0.66, -0.3], [0.6, -0.55], [0.5, -0.85], [0.4, -1.28], [0.34, -0.9], [0.26, -0.68], [0.08, -0.44], [0.0, -0.2]],
};

const WING_SCALE = 0.27; // unit to metres for a base scale 1 butterfly (wingspan ~ 0.5 m at scale 1 is set by instance scale)

function outlineFor(kind, tail) {
  if (kind === 'fore') return catmull(OUTLINES.fore, 6);
  if (tail === 1) return catmull(OUTLINES.hindTail, 5);
  if (tail === 2) return catmull(OUTLINES.hindLuna, 5);
  return catmull(OUTLINES.hind, 5);
}

// ---- painting ------------------------------------------------------------------------------------
const TILE = 256;

function pathFromOutline(ctx, pts, bounds, size) {
  const [x0, z0, x1, z1] = bounds;
  ctx.beginPath();
  pts.forEach((p, i) => {
    const px = ((p[0] - x0) / (x1 - x0)) * size;
    const py = (1 - (p[1] - z0) / (z1 - z0)) * size;
    if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
  });
  ctx.closePath();
}

function boundsOf(pts) {
  let x0 = 1e9, z0 = 1e9, x1 = -1e9, z1 = -1e9;
  for (const p of pts) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); z0 = Math.min(z0, p[1]); z1 = Math.max(z1, p[1]); }
  return [x0 - 0.01, z0 - 0.01, x1 + 0.01, z1 + 0.01];
}

const hexA = (h, a = 1) => { const n = parseInt(h.slice(1), 16); return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`; };

// paint one tile. (u,v) map: tile x = span outward, tile y flipped z. hub is the wing base.
function paintTile(ctx, sp, kind, top, tail, rnd) {
  const outline = outlineFor(kind, tail);
  const bounds = boundsOf(outline);
  const S = TILE;
  const map = (x, z) => [((x - bounds[0]) / (bounds[2] - bounds[0])) * S, (1 - (z - bounds[1]) / (bounds[3] - bounds[1])) * S];
  ctx.clearRect(0, 0, S, S);
  ctx.save();
  pathFromOutline(ctx, outline, bounds, S);
  ctx.clip();
  const hub = kind === 'fore' ? map(0.04, 0.0) : map(0.05, -0.12);
  const key = sp.key;
  const fillRadial = (stops, r = S * 1.15) => {
    const g = ctx.createRadialGradient(hub[0], hub[1], 2, hub[0], hub[1], r);
    stops.forEach(([t, c]) => g.addColorStop(t, c));
    ctx.fillStyle = g; ctx.fillRect(0, 0, S, S);
  };
  const veins = (color, count, width, spread = 1) => {
    ctx.strokeStyle = color; ctx.lineCap = 'round';
    for (let i = 0; i < count; i++) {
      const t = (i + 0.5) / count;
      const ang = (kind === 'fore' ? -0.25 : 0.05) + (t - 0.5) * 2.2 * spread + (kind === 'fore' ? -0.2 : 0.35);
      const len = S * (0.85 + rnd() * 0.3);
      const ex = hub[0] + Math.cos(ang) * len, ey = hub[1] - Math.sin(ang) * len * (kind === 'fore' ? 0.8 : 1.0) * -1;
      ctx.lineWidth = width * (0.8 + rnd() * 0.5);
      ctx.beginPath();
      ctx.moveTo(hub[0], hub[1]);
      ctx.quadraticCurveTo((hub[0] + ex) / 2 + (rnd() - 0.5) * 18, (hub[1] + ey) / 2 + (rnd() - 0.5) * 18, ex, ey);
      ctx.stroke();
    }
  };
  const border = (color, wpx, dotColor, dots = 0, rows = 1) => {
    ctx.lineJoin = 'round';
    pathFromOutline(ctx, outline, bounds, S);
    ctx.strokeStyle = color; ctx.lineWidth = wpx * 2; ctx.stroke();
    if (dots) {
      // dot chain following the outline near the margin
      ctx.fillStyle = dotColor;
      for (let r = 0; r < rows; r++) {
        const pts = outline;
        for (let i = 0; i < pts.length; i += Math.max(1, Math.round(pts.length / dots))) {
          const p = pts[i], q = pts[(i + 1) % pts.length];
          const [px, py] = map(p[0], p[1]);
          const [qx, qy] = map(q[0], q[1]);
          const dx = hub[0] - px, dy = hub[1] - py; const l = Math.hypot(dx, dy) || 1;
          const inset = wpx * (0.55 + r * 0.7);
          ctx.beginPath();
          ctx.arc(px + (dx / l) * inset, py + (dy / l) * inset, wpx * (r === 0 ? 0.26 : 0.17), 0, TAU);
          ctx.fill();
        }
      }
    }
  };
  const eyespot = (x, z, r, cols) => {
    const [px, py] = map(x, z);
    cols.forEach((c, i) => { ctx.fillStyle = c; ctx.beginPath(); ctx.arc(px, py, r * (1 - i * 0.22), 0, TAU); ctx.fill(); });
  };
  const noiseDust = (alpha, color) => {
    ctx.fillStyle = color;
    for (let i = 0; i < 220; i++) { ctx.globalAlpha = alpha * rnd(); ctx.beginPath(); ctx.arc(rnd() * S, rnd() * S, 0.8 + rnd() * 1.6, 0, TAU); ctx.fill(); }
    ctx.globalAlpha = 1;
  };

  if (key === 'monarch' || key === 'aurora' && false) {
    if (top) {
      fillRadial([[0, '#ffb22e'], [0.5, '#f28a12'], [1, '#d9540a']]);
      veins('#1b1008', 8, 3.4);
      ctx.strokeStyle = '#1b1008'; ctx.lineWidth = 2.2;
      for (let i = 1; i < 4; i++) { ctx.beginPath(); ctx.arc(hub[0], hub[1], S * (0.22 + i * 0.17), -0.5, 1.4 + i * 0.1); ctx.stroke(); }
      border('#150c06', S * 0.085, '#fff4dc', 26, 2);
      if (kind === 'fore') { ctx.fillStyle = '#150c06'; ctx.beginPath(); ctx.arc(map(0.96, 0.24)[0], map(0.96, 0.24)[1], S * 0.2, 0, TAU); ctx.fill(); ctx.fillStyle = '#fff4dc'; [[0.86, 0.3], [0.93, 0.2], [0.9, 0.04], [0.78, 0.36]].forEach(([x, z]) => { const [a, b] = map(x, z); ctx.beginPath(); ctx.arc(a, b, S * 0.024, 0, TAU); ctx.fill(); }); }
    } else {
      fillRadial([[0, '#ffd77a'], [0.55, '#f0b04a'], [1, '#d38a30']]);
      veins('#3a2410', 8, 2.6);
      border('#3a2410', S * 0.05, '#fff8ea', 22, 2);
    }
  } else if (key === 'morpho') {
    if (top) {
      fillRadial([[0, '#7fe0ff'], [0.32, '#2f8dff'], [0.7, '#1140d8'], [1, '#0a1f88']]);
      ctx.globalCompositeOperation = 'lighter'; noiseDust(0.35, '#7ff0ff'); ctx.globalCompositeOperation = 'source-over';
      veins('rgba(6,16,60,0.85)', 7, 2.4);
      border('#0a0f24', S * 0.11, '#dff6ff', 24, 2);
    } else {
      fillRadial([[0, '#9c6a3c'], [0.6, '#7a4c28'], [1, '#5a3418']]);
      ctx.strokeStyle = 'rgba(40,22,10,0.7)'; ctx.lineWidth = 2;
      for (let i = 0; i < 9; i++) { ctx.beginPath(); const y = S * (0.12 + i * 0.1); ctx.moveTo(0, y); ctx.bezierCurveTo(S * 0.3, y - 14, S * 0.6, y + 16, S, y - 8); ctx.stroke(); }
      if (kind === 'hind') { eyespot(0.5, -0.35, S * 0.09, ['#150c06', '#f1dca8', '#161010', '#7fb8ff']); eyespot(0.62, -0.58, S * 0.07, ['#150c06', '#f1dca8', '#161010', '#7fb8ff']); }
      else eyespot(0.7, 0.05, S * 0.07, ['#150c06', '#f1dca8', '#161010', '#7fb8ff']);
      border('#2a1608', S * 0.05, '#e8d2a6', 20, 1);
    }
  } else if (key === 'swallowtail') {
    if (top) {
      fillRadial([[0, '#fff0a0'], [0.5, '#ffd23a'], [1, '#f3b510']]);
      ctx.strokeStyle = '#120c06'; ctx.lineWidth = 9; ctx.lineCap = 'round';
      for (let i = 0; i < 5; i++) { const t = i / 5; ctx.beginPath(); ctx.moveTo(hub[0] + 6 + t * 20, hub[1] - 6); ctx.quadraticCurveTo(S * (0.4 + t * 0.35), S * (0.25 + t * 0.4), S * (0.72 + t * 0.2), S * (0.15 + t * 0.7)); ctx.stroke(); }
      veins('rgba(18,12,6,0.9)', 6, 2.4);
      border('#120c06', S * 0.1, '#ffd23a', 22, 1);
      if (kind === 'hind') { ctx.fillStyle = 'rgba(70,140,255,0.9)'; for (let i = 0; i < 6; i++) { const [a, b] = map(0.2 + i * 0.09, -0.55 - (i % 2) * 0.08); ctx.beginPath(); ctx.ellipse(a, b, S * 0.04, S * 0.03, 0.6, 0, TAU); ctx.fill(); } eyespot(0.62, -0.68, S * 0.05, ['#ff7a1a', '#120c06']); }
    } else {
      fillRadial([[0, '#f7e6a0'], [1, '#e6c14a']]);
      veins('#3a2a12', 7, 2.2);
      border('#3a2a12', S * 0.06, '#fff4c0', 18, 1);
    }
  } else if (key === 'glasswing') {
    // mostly clear membrane with brown veins and border
    ctx.clearRect(0, 0, S, S);
    const g = ctx.createRadialGradient(hub[0], hub[1], 2, hub[0], hub[1], S);
    g.addColorStop(0, 'rgba(255,225,200,0.6)'); g.addColorStop(0.5, 'rgba(232,242,255,0.4)'); g.addColorStop(1, 'rgba(232,242,255,0.34)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, S, S);
    veins('rgba(150,70,30,0.95)', 9, 2.8, 1.05);
    ctx.strokeStyle = 'rgba(150,70,30,0.6)'; ctx.lineWidth = 1.4;
    for (let i = 1; i < 6; i++) { ctx.beginPath(); ctx.arc(hub[0], hub[1], S * (0.15 + i * 0.13), -0.9, 1.6); ctx.stroke(); }
    border('rgba(165,72,26,1)', S * 0.085, '#fff2e6', 24, 2);
  } else if (key === 'luna') {
    if (top) {
      fillRadial([[0, '#e8ffe6'], [0.5, '#a5eab5'], [1, '#6fcf9a']]);
      // purple leading edge
      const [ax, ay] = map(0.5, kind === 'fore' ? 0.44 : 0.0);
      const lg = ctx.createLinearGradient(0, 0, 0, S * 0.35); lg.addColorStop(0, 'rgba(120,60,140,0.85)'); lg.addColorStop(1, 'rgba(120,60,140,0)');
      if (kind === 'fore') { ctx.fillStyle = lg; ctx.fillRect(0, 0, S, S * 0.35); }
      veins('rgba(70,120,90,0.55)', 7, 2);
      const spots = kind === 'fore' ? [[0.6, 0.02]] : [[0.4, -0.44]];
      spots.forEach(([x, z]) => eyespot(x, z, S * 0.09, ['#3a2a55', '#ffd86a', '#2a1f3a', '#b7e7ff']));
      border('rgba(110,80,140,0.9)', S * 0.05, 'rgba(255,255,255,0)', 0, 1);
    } else {
      fillRadial([[0, '#f4fff0'], [1, '#b8ecc0']]);
      veins('rgba(90,140,110,0.5)', 7, 2);
    }
  } else if (key === 'aurora') {
    // iridescent pastel bands, hue rotated in the shader
    const g = ctx.createLinearGradient(0, 0, S, S);
    g.addColorStop(0, top ? '#ff7ad8' : '#ffb1e8'); g.addColorStop(0.35, '#ffd070'); g.addColorStop(0.65, '#6ff0e6'); g.addColorStop(1, '#8a7bff');
    ctx.fillStyle = g; ctx.fillRect(0, 0, S, S);
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 26; i++) { ctx.fillStyle = `hsla(${Math.floor(rnd() * 360)},90%,65%,${0.08 + rnd() * 0.12})`; ctx.beginPath(); ctx.arc(rnd() * S, rnd() * S, 10 + rnd() * 34, 0, TAU); ctx.fill(); }
    noiseDust(0.7, '#ffffff');
    ctx.globalCompositeOperation = 'source-over';
    veins('rgba(90,40,120,0.5)', 8, 2);
    border('rgba(255,255,255,0.85)', S * 0.04, '#ffffff', 26, 1);
  } else if (key === 'sulphur') {
    fillRadial([[0, top ? '#fff6a8' : '#f2ee8a'], [1, top ? '#f0e050' : '#d2c85a']]);
    veins('rgba(120,100,20,0.55)', 6, 2);
    if (kind === 'hind') eyespot(0.35, -0.42, S * 0.04, ['#c25a1a', '#f2d060']);
    border('rgba(180,150,30,0.8)', S * 0.03, 'rgba(0,0,0,0)', 0, 1);
  } else if (key === 'white') {
    fillRadial([[0, '#ffffff'], [0.7, '#f2f4f2'], [1, '#e6e8e4']]);
    veins('rgba(90,90,90,0.35)', 6, 2);
    if (kind === 'fore') { ctx.fillStyle = 'rgba(40,40,40,0.85)'; const [a, b] = map(0.95, 0.3); ctx.beginPath(); ctx.arc(a, b, S * 0.15, 0, TAU); ctx.fill(); const [c, d] = map(0.65, 0.05); ctx.beginPath(); ctx.arc(c, d, S * 0.04, 0, TAU); ctx.fill(); }
  } else { // peacock
    if (top) {
      fillRadial([[0, '#c8481e'], [0.6, '#a2301a'], [1, '#5a1a10']]);
      veins('rgba(30,10,6,0.8)', 7, 2.4);
      const [x, z] = kind === 'fore' ? [0.78, 0.22] : [0.5, -0.5];
      eyespot(x, z, S * 0.14, ['#f0d060', '#141010', '#2f5fd0', '#f0d0a0', '#141010']);
      border('#241008', S * 0.06, '#8a6a4a', 12, 1);
    } else {
      fillRadial([[0, '#3a2a22'], [1, '#161010']]);
      noiseDust(0.5, '#6a5a4a');
      border('#0d0808', S * 0.04, '#5a4a3a', 12, 1);
    }
  }
  ctx.restore();
}

export function makeWingAtlas() {
  const cols = SPECIES.length;
  const canvas = document.createElement('canvas');
  canvas.width = TILE * cols; canvas.height = TILE * 4;
  const ctx = canvas.getContext('2d');
  SPECIES.forEach((sp, ci) => {
    const rnd = mulberry32(1000 + ci * 17);
    const tile = document.createElement('canvas');
    tile.width = tile.height = TILE;
    const tctx = tile.getContext('2d');
    const kinds = [['fore', true], ['fore', false], ['hind', true], ['hind', false]];
    kinds.forEach(([kind, top], ri) => {
      paintTile(tctx, sp, kind, top, sp.tail, rnd);
      ctx.drawImage(tile, ci * TILE, ri * TILE);
    });
  });
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  tex.userData.canvas = canvas;
  return tex;
}

// ---- geometry ------------------------------------------------------------------------------------

// Builds body + wings for the requested tail style. Wings carry: aSide, aKind (0 fore, 1 hind, -1 body), uv, aRad.
function buildWing(kind, tail, side, positions, uvs, sides, kinds, rads, norms, indices, parts, shades, cols) {
  const outline = outlineFor(kind, tail);
  const bounds = boundsOf(outline);
  const hub = kind === 'fore' ? [0.04, 0.0] : [0.05, -0.12];
  const rings = [0, 0.16, 0.34, 0.54, 0.76, 1.0];
  const K = outline.length;
  const base = positions.length / 3;
  for (let r = 0; r < rings.length; r++) {
    for (let k = 0; k < K; k++) {
      const p = outline[k];
      const x = hub[0] + (p[0] - hub[0]) * rings[r], z = hub[1] + (p[1] - hub[1]) * rings[r];
      positions.push(side * x * WING_SCALE, 0, z * WING_SCALE);
      uvs.push((x - bounds[0]) / (bounds[2] - bounds[0]), (z - bounds[1]) / (bounds[3] - bounds[1]));
      sides.push(side); kinds.push(kind === 'fore' ? 0 : 1); rads.push(rings[r]);
      norms.push(0, 1, 0); parts.push(5); shades.push(rings[r]); cols.push(1, 1, 1);
    }
  }
  for (let r = 0; r < rings.length - 1; r++) for (let k = 0; k < K; k++) {
    const a = base + r * K + k, b = base + r * K + ((k + 1) % K), c = base + (r + 1) * K + k, d = base + (r + 1) * K + ((k + 1) % K);
    // outline runs clockwise seen from above (z forward, x right); keep the top face front facing
    if (side > 0) indices.push(a, c, b, b, c, d); else indices.push(a, b, c, b, d, c);
  }
  // fill the hub (ring 0 collapses to a point) is already degenerate triangles; fine
}

export function buildButterflyGeometry(tail) {
  const positions = [], uvs = [], sides = [], kinds = [], rads = [], norms = [], indices = [], parts = [], shades = [], cols = [];
  for (const side of [1, -1]) {
    buildWing('fore', tail, side, positions, uvs, sides, kinds, rads, norms, indices, parts, shades, cols);
    buildWing('hind', tail, side, positions, uvs, sides, kinds, rads, norms, indices, parts, shades, cols);
  }
  // body via MeshBuilder
  const dark = [0.035, 0.028, 0.024], fur = [0.1, 0.07, 0.055], head = [0.05, 0.035, 0.03];
  const segs = 6;
  const b2 = new MeshBuilder();
  b2.push().translate(0, 0, -0.012).rotX(Math.PI / 2 + Math.PI);
  const AL = 0.19;
  for (let i = 0; i < segs; i++) {
    const t = i / segs;
    const r0 = 0.027 * Math.pow(1 - t, 0.7) + 0.0065, r1 = 0.027 * Math.pow(1 - (t + 1 / segs), 0.7) + 0.0065;
    b2.cylinder({ r0, r1, h: AL / segs, y0: (AL / segs) * i, seg: 6, c0: i % 2 ? dark : [0.06, 0.045, 0.035], c1: i % 2 ? [0.06, 0.045, 0.035] : dark, part: 0, smooth: true, shade0: 0.3, shade1: 0.8 });
  }
  b2.pop();
  // thorax and head
  b2.push().translate(0, 0.002, 0.052).scale(0.047, 0.044, 0.075);
  b2.sphere({ r: 1, detail: 1, part: 0, flat: false, color: fur, shadeBottom: 0.2, shadeTop: 1 });
  b2.pop();
  b2.push().translate(0, 0.008, 0.128);
  b2.sphere({ r: 0.033, detail: 1, part: 0, flat: false, color: head, shadeBottom: 0.3, shadeTop: 1 });
  b2.pop();
  for (const s of [1, -1]) {
    b2.push().translate(s * 0.023, 0.017, 0.149);
    b2.sphere({ r: 0.0175, detail: 1, part: 1, flat: false, color: [0.02, 0.02, 0.03], shadeBottom: 0.5, shadeTop: 1 });
    b2.pop();
  }
  // antennae: curved strips with a club
  for (const s of [1, -1]) {
    const pts = [[s * 0.013, 0.028, 0.158], [s * 0.05, 0.09, 0.235], [s * 0.092, 0.145, 0.29], [s * 0.12, 0.158, 0.325]];
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], c = pts[i + 1];
      b2.flatQuad([a[0] - 0.0028, a[1], a[2]], [a[0] + 0.0028, a[1], a[2]], [c[0] + 0.0022, c[1], c[2]], [c[0] - 0.0022, c[1], c[2]], [0, 0, 1, 1], [dark, dark, dark, dark], 2);
      b2.flatQuad([a[0], a[1] - 0.0028, a[2]], [a[0], a[1] + 0.0028, a[2]], [c[0], c[1] + 0.0022, c[2]], [c[0], c[1] - 0.0022, c[2]], [0, 0, 1, 1], [dark, dark, dark, dark], 2);
    }
    const e = pts[pts.length - 1];
    b2.push().translate(e[0], e[1], e[2]);
    b2.sphere({ r: 0.0105, detail: 0, part: 2, flat: true, color: [0.03, 0.022, 0.018] });
    b2.pop();
  }
  // legs (tucked)
  for (const s of [1, -1]) for (let i = 0; i < 3; i++) {
    const z = 0.02 + i * 0.045;
    b2.flatTri([s * 0.02, -0.02, z], [s * 0.05, -0.07, z + 0.03], [s * 0.026, -0.024, z + 0.008], [0, 1, 0], [dark, dark, dark], 3);
  }
  const bd = b2.build();
  // merge body into the wing arrays
  const baseIdx = positions.length / 3;
  const bp = bd.getAttribute('position'), bn = bd.getAttribute('normal'), bc = bd.getAttribute('color'), bpart = bd.getAttribute('aPart'), bs = bd.getAttribute('aShade'), bi = bd.index;
  for (let i = 0; i < bp.count; i++) {
    positions.push(bp.getX(i), bp.getY(i), bp.getZ(i)); norms.push(bn.getX(i), bn.getY(i), bn.getZ(i));
    cols.push(bc.getX(i), bc.getY(i), bc.getZ(i)); parts.push(bpart.getX(i)); shades.push(bs.getX(i));
    uvs.push(0, 0); sides.push(0); kinds.push(-1); rads.push(0);
  }
  for (let i = 0; i < bi.count; i++) indices.push(baseIdx + bi.getX(i));
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(norms, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
  g.setAttribute('aPart', new THREE.Float32BufferAttribute(parts, 1));
  g.setAttribute('aShade', new THREE.Float32BufferAttribute(shades, 1));
  g.setAttribute('aUV', new THREE.Float32BufferAttribute(uvs, 2));
  g.setAttribute('aSide', new THREE.Float32BufferAttribute(sides, 1));
  g.setAttribute('aKind', new THREE.Float32BufferAttribute(kinds, 1));
  g.setAttribute('aRad', new THREE.Float32BufferAttribute(rads, 1));
  g.setIndex(indices);
  g.computeBoundingSphere();
  return g;
}

// ---- shader --------------------------------------------------------------------------------------

const VERT = /* glsl */ `
${GLSL_UNIFORMS}
${GLSL_FUNCS}
attribute vec3 color;
attribute float aPart;
attribute float aShade;
attribute vec2 aUV;
attribute float aSide;
attribute float aKind;
attribute float aRad;
attribute vec4 iPos;   // x y z scale
attribute vec4 iRot;   // yaw pitch roll flap
attribute vec4 iAux;   // species seed flapVel glow
uniform float uAtlasCols;
varying vec3 vN;
varying vec3 vWorld;
varying vec2 vUV;
varying float vPart;
varying float vRad;
varying float vSpecies;
varying float vGlow;
varying vec3 vBody;
varying float vSide;
varying float vKind;
varying float vSeed;

mat3 rotYMat(float a){ float c = cos(a), s = sin(a); return mat3(c, 0.0, -s, 0.0, 1.0, 0.0, s, 0.0, c); }
mat3 rotXMat(float a){ float c = cos(a), s = sin(a); return mat3(1.0, 0.0, 0.0, 0.0, c, s, 0.0, -s, c); }
mat3 rotZMat(float a){ float c = cos(a), s = sin(a); return mat3(c, s, 0.0, -s, c, 0.0, 0.0, 0.0, 1.0); }

void main(){
  float scale = iPos.w;
  if (scale < 0.001) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); vN = vec3(0.0,1.0,0.0); vWorld = vec3(0.0); vUV = vec2(0.0); vPart = 0.0; vRad = 0.0; vSpecies = 0.0; vGlow = 0.0; vBody = vec3(0.0); vSide = 0.0; vKind = 0.0; vSeed = 0.0; return; }
  vec3 p = position;
  vec3 n = normal;
  float flap = iRot.w;
  float flapV = iAux.z;
  if (aKind > -0.5) {
    // wing flap about the body axis (z). hind wings lag slightly. tips flex opposite to motion.
    float lag = aKind > 0.5 ? -0.16 : 0.0;
    float a = flap * (aKind > 0.5 ? 0.9 : 1.0) + lag * sign(flapV) * min(abs(flapV) * 0.05, 1.0);
    float span = abs(p.x);
    float flex = -flapV * 0.018 * aRad * aRad * (aKind > 0.5 ? 1.2 : 1.0);
    a += flex;
    float x = span;
    float c = cos(a), s = sin(a);
    // twist: the trailing side of the wing lags in angle
    float twist = p.z * 0.9 * sin(a) * aRad;
    vec3 q = vec3(x * c, x * s + twist * 0.5, p.z);
    q.z += -sin(a) * 0.05 * aRad * (aKind < 0.5 ? -1.0 : 1.0) * 0.6;
    p = vec3(q.x * aSide, q.y, q.z);
    // wing normal follows the flap rotation
    vec3 nn = vec3(-s * aSide, c, 0.0);
    n = nn;
  }
  float seed = iAux.y;
  mat3 R = rotYMat(iRot.x) * rotXMat(iRot.y) * rotZMat(iRot.z);
  vec3 wp = R * (p * (scale * 2.0)) + iPos.xyz;
  vN = normalize(R * n);
  vWorld = wp;
  vUV = aUV;
  vPart = aPart;
  vRad = aRad;
  vSpecies = iAux.x;
  vGlow = iAux.w;
  vBody = color;
  vSide = aSide;
  vKind = aKind;
  vSeed = seed;
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}
`;

const FRAG = /* glsl */ `
${GLSL_UNIFORMS}
${GLSL_FUNCS}
uniform sampler2D uAtlas;
uniform float uAtlasCols;
uniform vec4 uSpec[12]; // irid glow unused unused
varying vec3 vN;
varying vec3 vWorld;
varying vec2 vUV;
varying float vPart;
varying float vRad;
varying float vSpecies;
varying float vGlow;
varying vec3 vBody;
varying float vSide;
varying float vKind;
varying float vSeed;

vec3 hueShift(vec3 c, float h){
  const vec3 k = vec3(0.57735);
  float ca = cos(h), sa = sin(h);
  return c * ca + cross(k, c) * sa + k * dot(k, c) * (1.0 - ca);
}

void main(){
  vec3 N = normalize(vN);
  vec3 V = normalize(cameraPosition - vWorld);
  bool front = gl_FrontFacing;
  if (vKind > -0.5) {
    // wing: choose top or underside by facing
    float sp = floor(vSpecies + 0.5);
    float row = (vKind > 0.5 ? 2.0 : 0.0) + (front ? 0.0 : 1.0);
    // canvas texture rows: row 0 is the top of the image, tile v grows toward the wing front
    vec2 uv = vec2((sp + vUV.x) / uAtlasCols, (3.0 - row + vUV.y) / 4.0);
    vec4 t = texture2D(uAtlas, uv);
    float ign = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
    if (t.a < ign * 0.98 + 0.01) discard;
    if (!front) N = -N;
    vec3 alb = t.rgb;
    vec4 sd = uSpec[int(sp)];
    float irid = sd.x;
    alb *= sd.z;
    float ndv = abs(dot(N, V));
    // iridescence: hue drifts with viewing angle. Morpho leans toward cyan, the aurora wing cycles through the rainbow.
    if (irid > 0.01) {
      float g = 1.0 - ndv;
      float shift = sp > 4.5 ? g * 2.4 + uTime * 0.35 + vRad * 0.8 : -g * 0.85;
      vec3 shifted = hueShift(alb, shift);
      alb = mix(alb, shifted, clamp(irid, 0.0, 1.0) * (sp > 4.5 ? 1.0 : 0.85));
      alb += vec3(0.02, 0.09, 0.18) * pow(g, 3.0) * irid;
    }
    vec3 lit = shadeSurface(alb, N, 0.95, vWorld, 1.0);
    // translucent wings glow when backlit
    float back = pow(max(dot(-V, uSunDir), 0.0), 2.0);
    lit += alb * uSunColor * back * 0.55;
    // self glow so the hero never goes dark, stronger for moths at night
    lit += alb * (0.13 + vGlow * (0.12 + uNight * 1.3));
    float veinShade = mix(0.8, 1.0, smoothstep(0.0, 0.2, vRad));
    lit *= veinShade;
    vec3 col = lit / (1.0 + 0.2 * max(lit.r, max(lit.g, lit.b)));
    col = mix(applyFog(col, vWorld), col, 0.9);
    gl_FragColor = vec4(col, 1.0);
    return;
  }
  // body
  vec3 base = vBody;
  if (vPart > 0.5 && vPart < 1.5) {
    // eyes: glossy black with a highlight
    float spec = pow(max(dot(reflect(-uSunDir, N), V), 0.0), 40.0);
    vec3 col = base + vec3(1.0) * spec * 0.8 + vec3(0.02, 0.05, 0.1);
    gl_FragColor = vec4(applyFog(col, vWorld), 1.0);
    return;
  }
  if (!front) N = -N;
  float ndv = max(dot(N, V), 0.0);
  vec3 lit = shadeSurface(base, N, 0.9, vWorld, 1.0);
  float fuzz = pow(1.0 - ndv, 2.0);
  lit += vec3(0.6, 0.55, 0.5) * fuzz * 0.06 * (uSunColor + uAmbUp * 0.8);
  lit += base * (0.04 + vGlow * 0.3 * uNight);
  gl_FragColor = vec4(applyFog(min(lit, vec3(3.0)), vWorld), 1.0);
}
`;

// ---- renderer -------------------------------------------------------------------------------------

export class Butterflies {
  constructor(capacity = 160) {
    this.capacity = capacity;
    this.atlas = makeWingAtlas();
    const specU = [];
    for (let i = 0; i < 12; i++) { const s = SPECIES[i] || SPECIES[0]; specU.push(new THREE.Vector4(s.irid, s.glow, s.bright ?? 1, 0)); }
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG, side: THREE.DoubleSide,
      uniforms: { ...G, uAtlas: { value: this.atlas }, uAtlasCols: { value: SPECIES.length }, uSpec: { value: specU } },
    });
    // one geometry per tail style so tails show for the species that have them
    this.geos = [buildButterflyGeometry(0), buildButterflyGeometry(1), buildButterflyGeometry(2)];
    this.group = new THREE.Group();
    this.buckets = [];
    for (let t = 0; t < 3; t++) {
      const ip = new Float32Array(capacity * 4), ir = new Float32Array(capacity * 4), ia = new Float32Array(capacity * 4);
      const g = new THREE.InstancedBufferGeometry();
      g.index = this.geos[t].index;
      for (const n of ['position', 'normal', 'color', 'aPart', 'aShade', 'aUV', 'aSide', 'aKind', 'aRad']) g.setAttribute(n, this.geos[t].getAttribute(n));
      const aPos = new THREE.InstancedBufferAttribute(ip, 4), aRot = new THREE.InstancedBufferAttribute(ir, 4), aAux = new THREE.InstancedBufferAttribute(ia, 4);
      aPos.setUsage(THREE.DynamicDrawUsage); aRot.setUsage(THREE.DynamicDrawUsage); aAux.setUsage(THREE.DynamicDrawUsage);
      g.setAttribute('iPos', aPos); g.setAttribute('iRot', aRot); g.setAttribute('iAux', aAux);
      g.instanceCount = 0;
      const mesh = new THREE.Mesh(g, this.material);
      mesh.frustumCulled = false;
      mesh.renderOrder = 5;
      this.group.add(mesh);
      this.buckets.push({ g, ip, ir, ia, aPos, aRot, aAux, n: 0, mesh });
    }
    this.cap = capacity;
  }

  begin() { for (const b of this.buckets) b.n = 0; }

  // species tail style decides the geometry bucket
  add(species, x, y, z, scale, yaw, pitch, roll, flap, flapV, seed, glow) {
    const sp = SPECIES[species] || SPECIES[0];
    const b = this.buckets[sp.tail];
    if (b.n >= this.cap) return;
    const i = b.n++ * 4;
    b.ip[i] = x; b.ip[i + 1] = y; b.ip[i + 2] = z; b.ip[i + 3] = scale * sp.size * WING_SCALE_FIX;
    b.ir[i] = yaw; b.ir[i + 1] = pitch; b.ir[i + 2] = roll; b.ir[i + 3] = flap;
    b.ia[i] = species; b.ia[i + 1] = seed; b.ia[i + 2] = flapV; b.ia[i + 3] = glow ?? sp.glow;
  }

  end() {
    for (const b of this.buckets) {
      b.g.instanceCount = b.n;
      b.aPos.clearUpdateRanges(); b.aRot.clearUpdateRanges(); b.aAux.clearUpdateRanges();
      b.aPos.addUpdateRange(0, b.n * 4); b.aRot.addUpdateRange(0, b.n * 4); b.aAux.addUpdateRange(0, b.n * 4);
      b.aPos.needsUpdate = b.aRot.needsUpdate = b.aAux.needsUpdate = true;
    }
  }
}
const WING_SCALE_FIX = 1.0;
