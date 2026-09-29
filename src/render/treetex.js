// Procedural painted textures for the trees. Everything is drawn with Canvas2D at startup (no files).
//
// Both textures store TONE WEIGHTS instead of colours: r = shadow tone, g = body tone, b = light tone.
// The tree shader turns them into colour with per species tone colours (see trees.js), so the same
// painting follows the biome palette, the instance variant and the time of day.
//   foliage atlas: a = leaf coverage (alpha cutout). rgb = tone weights (normalised in the shader).
//   bark tiles:    a = moss mask (compared against a per vertex moss level). rgb = tone weights.
import * as THREE from 'three';
import { mulberry32 } from '../core/util.js';

const TAU = Math.PI * 2;
const PI = Math.PI;

// ---- atlas layout ---------------------------------------------------------------------------------
export const ATLAS_W = 1024, ATLAS_H = 512, CELL = 256;
export const CELLS = { oak: 0, cherry: 1, maple: 2, birch: 3, pine: 4, frost: 5, palm: 6, oakB: 7 };
// uv rectangle [u0, v0, du, dv] of a cell (v grows downward, same as the canvas). Slightly inset.
export function cellRect(i) {
  const cx = (i % 4) * CELL, cy = Math.floor(i / 4) * CELL, e = 1.5;
  return [(cx + e) / ATLAS_W, (cy + e) / ATLAS_H, (CELL - 2 * e) / ATLAS_W, (CELL - 2 * e) / ATLAS_H];
}
export const BARK_W = 128, BARK_H = 256;
export const BARK_KEYS = ['oak', 'cherry', 'pine', 'birch', 'maple', 'palm'];

// ---- tone weight colours --------------------------------------------------------------------------
// d = shadow, m = body, l = light. Weights are normalised to sum 1 so soft blends stay colourful.
function W(d, m, l, a = 1) {
  const s = d + m + l || 1;
  return `rgba(${Math.round(255 * d / s)},${Math.round(255 * m / s)},${Math.round(255 * l / s)},${a})`;
}
const cD = W(1, 0, 0), cM = W(0, 1, 0), cL = W(0, 0, 1);

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  return { c, ctx };
}

// ---- shape helpers --------------------------------------------------------------------------------
function profile(fn, n = 12) {
  const a = new Float32Array(n + 1);
  for (let i = 0; i <= n; i++) a[i] = fn(i / n);
  return a;
}
const ovate = (t) => Math.pow(Math.sin(PI * Math.pow(t, 0.72)), 0.8);
const PR_OVATE = profile(ovate);
const PR_LANCE = profile((t) => Math.pow(Math.sin(PI * Math.pow(t, 0.85)), 1.05));
const PR_OAK = profile((t) => ovate(t) * (0.66 + 0.34 * Math.abs(Math.cos(t * PI * 3.5 + 0.35))), 20);
const PR_SAW = profile((t) => ovate(t) * (0.88 + 0.12 * ((t * 8.5) % 1)), 24);
const PR_HEART = profile((t) => Math.pow(Math.sin(PI * Math.pow(t, 0.55)), 0.7) * (1 - 0.25 * t), 12);
const PR_NEEDLE = profile((t) => Math.pow(Math.sin(PI * (0.06 + 0.94 * t) ** 0.8), 0.6) * (1 - 0.65 * t), 6);

// leaf outline from base (x, y) pointing along ang. prof gives half width per t, bend curls the blade.
function leaf(ctx, x, y, ang, len, wid, prof, bend = 0) {
  const n = prof.length - 1, ca = Math.cos(ang), sa = Math.sin(ang);
  ctx.beginPath();
  for (let i = 0; i <= n; i++) {
    const t = i / n, px = t * len, py = prof[i] * wid * 0.5 + bend * len * t * t;
    const X = x + px * ca - py * sa, Y = y + px * sa + py * ca;
    if (i === 0) ctx.moveTo(X, Y); else ctx.lineTo(X, Y);
  }
  for (let i = n; i >= 0; i--) {
    const t = i / n, px = t * len, py = -prof[i] * wid * 0.5 + bend * len * t * t;
    ctx.lineTo(x + px * ca - py * sa, y + px * sa + py * ca);
  }
  ctx.closePath();
}
function rib(ctx, x, y, ang, len, bend = 0) {
  const ca = Math.cos(ang), sa = Math.sin(ang), py = bend * len;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.quadraticCurveTo(x + ca * len * 0.5 - sa * py * 0.25, y + sa * len * 0.5 + ca * py * 0.25, x + ca * len * 0.92 - sa * py, y + sa * len * 0.92 + ca * py);
  ctx.stroke();
}

// five lobed palmate maple leaf centred on (x, y). size = tip distance.
const MAPLE_LOBES = [[0, 0.52, 1.0], [0.92, 0.47, 0.88], [-0.92, 0.47, 0.88], [1.86, 0.42, 0.56], [-1.86, 0.42, 0.56]];
const MAPLE_PTS = (() => {
  const pts = [];
  const N = 52;
  for (let k = 0; k < N; k++) {
    const th = -PI * 0.86 + (k / (N - 1)) * PI * 1.72;
    let r = 0.36;
    for (const [c, w, h] of MAPLE_LOBES) {
      const d = Math.abs(th - c) / w;
      if (d < 1) r = Math.max(r, 0.36 + (h - 0.36) * Math.pow(1 - d, 0.95));
    }
    r *= 1 + 0.05 * Math.sin(th * 15);
    pts.push([th, r]);
  }
  return pts;
})();
function mapleLeaf(ctx, x, y, ang, size, squish = 1) {
  ctx.beginPath();
  const ca = Math.cos(ang), sa = Math.sin(ang);
  ctx.moveTo(x - ca * size * 0.14, y - sa * size * 0.14);
  for (let i = 0; i < MAPLE_PTS.length; i++) {
    const th = MAPLE_PTS[i][0], r = MAPLE_PTS[i][1] * size;
    const px = Math.cos(th) * r, py = Math.sin(th) * r * squish;
    ctx.lineTo(x + px * ca - py * sa, y + px * sa + py * ca);
  }
  ctx.closePath();
}

// five petal blossom
function blossom(ctx, x, y, r, rot) {
  ctx.beginPath();
  for (let i = 0; i < 5; i++) {
    const a = rot + (i / 5) * TAU;
    const px = x + Math.cos(a) * r * 0.5, py = y + Math.sin(a) * r * 0.5;
    ctx.moveTo(px + r * 0.5, py);
    ctx.ellipse(px, py, r * 0.52, r * 0.42, a, 0, TAU);
  }
}

// ---- foliage cell painters ------------------------------------------------------------------------
// Each painter draws inside a CELL x CELL square at origin (ox, oy). Clumps are painted back to front:
// dark rim leaves (silhouette), body leaves, light leaves on the upper half, small highlights.

// a leaf with a dark rim underlay, its body tone and a soft inner highlight towards the tip
function paintLeaf(ctx, shape, x, y, ang, len, wid, fill, rim, vein, shine) {
  if (rim) {
    shape(ctx, x, y, ang, len * 1.09, wid * 1.16);
    ctx.fillStyle = W(1, 0, 0, rim); ctx.fill();
  }
  shape(ctx, x, y, ang, len, wid);
  ctx.fillStyle = fill; ctx.fill();
  if (shine) {
    const ca = Math.cos(ang), sa = Math.sin(ang);
    shape(ctx, x + ca * len * 0.22, y + sa * len * 0.22, ang, len * 0.7, wid * 0.55);
    ctx.fillStyle = W(0, 0.3, 0.7, shine); ctx.fill();
  }
  if (vein) { ctx.strokeStyle = W(1, 0, 0, vein); ctx.lineWidth = 1.1; rib(ctx, x, y, ang, len, 0.05); }
}

function clumpBroadleaf(ctx, ox, oy, rnd, s) {
  const cx = ox + CELL / 2, cy = oy + CELL / 2 + 4, R = 112;
  ctx.fillStyle = W(0.8, 0.2, 0); // solid dark heart, no holes near the centre
  ctx.beginPath(); ctx.ellipse(cx, cy, R * 0.5, R * 0.46, 0, 0, TAU); ctx.fill();
  const shape = (c, x, y, a, l, w) => s.shape(c, x, y, a, l, w);
  for (let i = 0; i < s.nA; i++) { // rim leaves: their tips make the silhouette
    const th = (i / s.nA) * TAU + (rnd() - 0.5) * 0.3, rb = R * (0.36 + rnd() * 0.1);
    const len = R - rb + (rnd() - 0.5) * 10, wid = len * s.aspect * (0.85 + rnd() * 0.3);
    paintLeaf(ctx, shape, cx + Math.cos(th) * rb, cy + Math.sin(th) * rb, th + (rnd() - 0.5) * 0.35, len, wid, W(0.82, 0.18, 0), 0, 0, 0);
  }
  for (let i = 0; i < s.nB; i++) { // body leaves
    const th = ((i + 0.5) / s.nB) * TAU + (rnd() - 0.5) * 0.35, rb = R * (0.2 + rnd() * 0.14);
    const len = R * (0.5 + rnd() * 0.14), wid = len * s.aspect * (0.85 + rnd() * 0.3);
    const t = 0.5 + 0.5 * Math.sin(th - PI / 2 + PI);
    paintLeaf(ctx, shape, cx + Math.cos(th) * rb, cy - R * 0.04 + Math.sin(th) * rb, th + (rnd() - 0.5) * 0.4, len, wid, W(0.14 + 0.2 * (1 - t), 0.72, 0.1 + 0.3 * t), 0.5, 0.35, 0.16 * t);
  }
  for (let i = 0; i < s.nC; i++) { // light leaves on the upper half
    const th = -PI * (0.08 + rnd() * 0.84) + (rnd() - 0.5) * 0.3, rb = R * (0.05 + rnd() * 0.28);
    const len = R * (0.4 + rnd() * 0.12), wid = len * s.aspect * (0.85 + rnd() * 0.3);
    paintLeaf(ctx, shape, cx + Math.cos(th) * rb, cy - R * 0.12 + Math.sin(th) * rb, th + (rnd() - 0.5) * 0.5, len, wid, W(0.03, 0.42, 0.55), 0.4, 0.4, 0.3);
  }
  for (let i = 0; i < 9; i++) { // cover the heart
    const th = rnd() * TAU, rb = R * rnd() * 0.16;
    const len = R * (0.36 + rnd() * 0.1), wid = len * s.aspect * (0.85 + rnd() * 0.3);
    paintLeaf(ctx, shape, cx + Math.cos(th) * rb, cy - R * 0.02 + Math.sin(th) * rb, th + (rnd() - 0.5) * 0.5, len, wid, W(0.1, 0.62, 0.28), 0.4, 0.35, 0.16);
  }
  for (let i = 0; i < s.nD; i++) { // bright sparkles on the top left
    const th = -PI * (0.2 + rnd() * 0.6), rb = R * (0.28 + rnd() * 0.32);
    const len = R * (0.26 + rnd() * 0.1), wid = len * s.aspect * (0.85 + rnd() * 0.3);
    paintLeaf(ctx, shape, cx + Math.cos(th) * rb, cy - R * 0.1 + Math.sin(th) * rb, th + (rnd() - 0.5) * 0.7, len, wid, W(0, 0.12, 0.88), 0.3, 0.3, 0);
  }
}

const OAK_SHAPE = { nA: 24, nB: 30, nC: 22, nD: 14, aspect: 0.62, shape: (ctx, x, y, a, l, w) => leaf(ctx, x, y, a, l, w, PR_OAK, 0.06) };
function paintOak(ctx, ox, oy, rnd) { clumpBroadleaf(ctx, ox, oy, rnd, OAK_SHAPE); }

// oak variant B: a leafy plume, open and upward pointing, for variety
function paintOakB(ctx, ox, oy, rnd) {
  const bx = ox + CELL / 2, by = oy + CELL - 20;
  const shape = (c, x, y, a, l, w) => leaf(c, x, y, a, l, w, PR_OAK, 0.06);
  const twigs = [];
  for (let i = 0; i < 6; i++) {
    const sp = i / 5 - 0.5;
    twigs.push({ a: sp * 1.9 + (rnd() - 0.5) * 0.2, len: 118 + rnd() * 40 - Math.abs(sp) * 26 });
  }
  ctx.lineCap = 'round';
  // dark undercoat hull along the twigs
  const pts = twigs.map((t) => { const a = -PI / 2 + t.a; return [bx + Math.cos(a) * t.len * 0.62, by + Math.sin(a) * t.len * 0.62]; });
  ctx.strokeStyle = W(0.85, 0.15, 0); ctx.lineWidth = 58;
  for (const p of pts) { ctx.beginPath(); ctx.moveTo(bx, by - 8); ctx.lineTo(p[0], p[1]); ctx.stroke(); }
  for (let pass = 0; pass < 2; pass++) {
    for (const t of twigs) {
      const a = -PI / 2 + t.a;
      const ex = bx + Math.cos(a) * t.len, ey = by + Math.sin(a) * t.len;
      const mx = bx + Math.cos(a - t.a * 0.25) * t.len * 0.5, my = by + Math.sin(a - t.a * 0.25) * t.len * 0.5;
      if (pass === 0) { ctx.strokeStyle = W(1, 0, 0); ctx.lineWidth = 3.4; ctx.beginPath(); ctx.moveTo(bx, by); ctx.quadraticCurveTo(mx, my, ex, ey); ctx.stroke(); }
      const nl = 7;
      for (let k = 1; k <= nl; k++) {
        const f = k / (nl + 0.3), u = 1 - f;
        const px = u * u * bx + 2 * u * f * mx + f * f * ex, py = u * u * by + 2 * u * f * my + f * f * ey;
        const tx = 2 * u * (mx - bx) + 2 * f * (ex - mx), ty = 2 * u * (my - by) + 2 * f * (ey - my);
        const ta = Math.atan2(ty, tx);
        const len = (54 - 20 * f) * (0.85 + rnd() * 0.3), up = 1 - py / (oy + CELL);
        for (const side of [-1, 1]) {
          const la = ta + side * (0.8 + rnd() * 0.45);
          if (pass === 0) paintLeaf(ctx, shape, px, py, la, len, len * 0.55, W(0.7, 0.3, 0), 0, 0, 0);
          else paintLeaf(ctx, shape, px, py, la, len * 0.86, len * 0.5, W(0.08 + 0.2 * (1 - up), 0.7, 0.05 + 0.4 * up), 0.5, 0.35, 0.2 * up);
        }
      }
      if (pass === 1) paintLeaf(ctx, shape, ex, ey, ta0(ex - mx, ey - my), 50, 28, W(0.05, 0.4, 0.55), 0.5, 0.35, 0.3);
    }
  }
}
const ta0 = (dx, dy) => Math.atan2(dy, dx);

function paintMaple(ctx, ox, oy, rnd) {
  const cx = ox + CELL / 2, cy = oy + CELL / 2 + 2, R = 112;
  ctx.fillStyle = W(0.8, 0.2, 0);
  ctx.beginPath(); ctx.ellipse(cx, cy, R * 0.55, R * 0.5, 0, 0, TAU); ctx.fill();
  const leafAt = (x, y, ang, size, fill, rim, vein, shine) => {
    if (rim) { mapleLeaf(ctx, x, y, ang, size * 1.07); ctx.fillStyle = W(1, 0, 0, rim); ctx.fill(); }
    mapleLeaf(ctx, x, y, ang, size);
    ctx.fillStyle = fill; ctx.fill();
    if (shine) { mapleLeaf(ctx, x + Math.cos(ang) * size * 0.06, y + Math.sin(ang) * size * 0.06, ang, size * 0.66); ctx.fillStyle = W(0, 0.35, 0.65, shine); ctx.fill(); }
    if (vein) {
      ctx.strokeStyle = W(1, 0, 0, vein); ctx.lineWidth = 1.1;
      for (const [c] of MAPLE_LOBES) { const a = ang + c; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(a) * size * 0.7, y + Math.sin(a) * size * 0.7); ctx.stroke(); }
    }
  };
  for (let i = 0; i < 13; i++) { // rim
    const th = (i / 13) * TAU + (rnd() - 0.5) * 0.3, rb = R * (0.42 + rnd() * 0.1);
    leafAt(cx + Math.cos(th) * rb, cy + Math.sin(th) * rb, th + (rnd() - 0.5) * 0.7, R * (0.52 + rnd() * 0.1), W(0.8, 0.2, 0), 0, 0, 0);
  }
  for (let i = 0; i < 17; i++) { // body
    const th = ((i + 0.5) / 17) * TAU + (rnd() - 0.5) * 0.4, rb = R * (0.16 + rnd() * 0.3);
    const t = 0.5 + 0.5 * Math.sin(th - PI / 2 + PI);
    leafAt(cx + Math.cos(th) * rb, cy - R * 0.03 + Math.sin(th) * rb, th + (rnd() - 0.5) * 0.9, R * (0.44 + rnd() * 0.1), W(0.16 + 0.2 * (1 - t), 0.7, 0.1 + 0.3 * t), 0.55, 0.3, 0.18 * t);
  }
  for (let i = 0; i < 5; i++) { // cover the heart
    const th = rnd() * TAU, rb = R * rnd() * 0.14;
    leafAt(cx + Math.cos(th) * rb, cy + Math.sin(th) * rb, th + (rnd() - 0.5) * 1.5, R * (0.4 + rnd() * 0.06), W(0.1, 0.65, 0.25), 0.5, 0.3, 0.1);
  }
  for (let i = 0; i < 13; i++) { // light on the upper half
    const th = -PI * (0.06 + rnd() * 0.88), rb = R * (0.04 + rnd() * 0.36);
    leafAt(cx + Math.cos(th) * rb, cy - R * 0.1 + Math.sin(th) * rb, th + (rnd() - 0.5) * 0.9, R * (0.36 + rnd() * 0.08), W(0.04, 0.44, 0.52), 0.45, 0.35, 0.3);
  }
  for (let i = 0; i < 6; i++) { // sparkles
    const th = -PI * (0.2 + rnd() * 0.6), rb = R * (0.3 + rnd() * 0.3);
    leafAt(cx + Math.cos(th) * rb, cy - R * 0.08 + Math.sin(th) * rb, th + (rnd() - 0.5) * 1.0, R * (0.24 + rnd() * 0.06), W(0, 0.12, 0.88), 0.35, 0.3, 0);
  }
}

function paintCherry(ctx, ox, oy, rnd) {
  const cx = ox + CELL / 2, cy = oy + CELL / 2 + 2, R = 112;
  ctx.fillStyle = W(0.6, 0.4, 0);
  ctx.beginPath(); ctx.ellipse(cx, cy, R * 0.6, R * 0.55, 0, 0, TAU); ctx.fill();
  ctx.strokeStyle = W(1, 0, 0, 0.9); ctx.lineCap = 'round';
  for (let i = 0; i < 8; i++) { // a few twigs peeking between blossoms
    const a = (i / 8) * TAU + rnd() * 0.5;
    ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(cx, cy);
    ctx.quadraticCurveTo(cx + Math.cos(a) * R * 0.5, cy + Math.sin(a) * R * 0.5 - 6, cx + Math.cos(a + 0.3) * R * 0.86, cy + Math.sin(a + 0.3) * R * 0.86);
    ctx.stroke();
  }
  const flower = (x, y, r, rot, fill, rimA) => {
    if (rimA) { blossom(ctx, x, y, r * 1.14, rot); ctx.fillStyle = W(1, 0, 0, rimA); ctx.fill(); }
    blossom(ctx, x, y, r, rot);
    ctx.fillStyle = fill; ctx.fill();
  };
  for (let i = 0; i < 34; i++) { // rim ring of slightly deeper blossoms
    const th = (i / 34) * TAU + (rnd() - 0.5) * 0.25, rb = R * (0.74 + rnd() * 0.16);
    flower(cx + Math.cos(th) * rb, cy + Math.sin(th) * rb, 13 + rnd() * 4, rnd() * TAU, W(0.4, 0.6, 0), 0);
  }
  for (let i = 0; i < 72; i++) { // body
    const th = ((i + 0.5) / 72) * TAU * 2.3 + (rnd() - 0.5) * 0.4, rb = R * (0.08 + 0.7 * Math.sqrt(rnd()));
    const t = 0.5 + 0.5 * Math.sin(th - PI / 2 + PI);
    flower(cx + Math.cos(th) * rb, cy + Math.sin(th) * rb, 12 + rnd() * 5, rnd() * TAU, W(0.1 * (1 - t), 0.8, 0.12 + 0.3 * t), 0.32);
  }
  for (let i = 0; i < 26; i++) { // fill the centre
    const th = rnd() * TAU, rb = R * Math.sqrt(rnd()) * 0.36;
    const t = 0.5 + 0.5 * Math.sin(th - PI / 2 + PI);
    flower(cx + Math.cos(th) * rb, cy + Math.sin(th) * rb, 12 + rnd() * 4, rnd() * TAU, W(0.05, 0.75, 0.2 + 0.2 * t), 0.3);
  }
  for (let i = 0; i < 54; i++) { // light blossoms, more on top
    const th = -PI * (0.04 + rnd() * 0.92) + (rnd() - 0.5) * 0.3, rb = R * (0.04 + rnd() * 0.66);
    flower(cx + Math.cos(th) * rb, cy - R * 0.08 + Math.sin(th) * rb, 11 + rnd() * 5, rnd() * TAU, W(0, 0.3, 0.7), 0.3);
  }
  for (let i = 0; i < 24; i++) { // white sparkles
    const th = -PI * (0.12 + rnd() * 0.76), rb = R * (0.15 + rnd() * 0.6);
    flower(cx + Math.cos(th) * rb, cy - R * 0.06 + Math.sin(th) * rb, 9 + rnd() * 4, rnd() * TAU, cL, 0.28);
  }
  ctx.fillStyle = W(0.9, 0.1, 0, 0.7); // flower hearts
  for (let i = 0; i < 110; i++) {
    const th = rnd() * TAU, rb = R * Math.sqrt(rnd()) * 0.9;
    ctx.beginPath(); ctx.arc(cx + Math.cos(th) * rb, cy + Math.sin(th) * rb, 1.1 + rnd() * 0.9, 0, TAU); ctx.fill();
  }
}

// birch: drooping twigs with small serrated leaves, airy
function paintBirch(ctx, ox, oy, rnd) {
  const cx = ox + CELL / 2, top = oy + 26;
  ctx.lineCap = 'round';
  const heart = (c, x, y, a, l, w) => leaf(c, x, y, a, l, w, PR_HEART, 0.04);
  const leafOn = (x, y, ang, len, fill, rimA, shine) => paintLeaf(ctx, heart, x, y, ang, len, len * 0.74, fill, rimA, 0, shine);
  // dense little leaves near the top so the spray keeps a body
  for (let i = 0; i < 46; i++) {
    const a = rnd() * TAU, r = Math.sqrt(rnd()) * 66;
    const py = oy + 96 + Math.sin(a) * r * 0.72;
    const hi = 1 - (py - oy) / CELL;
    leafOn(cx + Math.cos(a) * r, py, a + (rnd() - 0.5), 22 + rnd() * 8, W(0.3 * (1 - hi), 0.6, 0.1 + 0.4 * hi), 0.5, 0);
  }
  const twigs = 9;
  for (let i = 0; i < twigs; i++) {
    const sp = (i / (twigs - 1) - 0.5) * 2;
    const x0 = cx + sp * 34, y0 = top + Math.abs(sp) * 18;
    const x2 = cx + sp * 104 + (rnd() - 0.5) * 16, y2 = oy + 178 + rnd() * 54 - Math.abs(sp) * 24;
    const x1 = x0 + sp * 46, y1 = y0 + 22;
    ctx.strokeStyle = W(1, 0, 0, 0.9); ctx.lineWidth = 2.2;
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.quadraticCurveTo(x1, y1, x2, y2); ctx.stroke();
    const nl = 8;
    for (let k = 1; k <= nl; k++) {
      const t = k / (nl + 0.4), u = 1 - t;
      const px = u * u * x0 + 2 * u * t * x1 + t * t * x2, py = u * u * y0 + 2 * u * t * y1 + t * t * y2;
      const tx = 2 * u * (x1 - x0) + 2 * t * (x2 - x1), ty = 2 * u * (y1 - y0) + 2 * t * (y2 - y1);
      const ta = Math.atan2(ty, tx), len = 26 + rnd() * 10 - t * 6;
      const side = k % 2 ? 1 : -1;
      const hi = 0.5 + 0.5 * (1 - py / (oy + CELL));
      leafOn(px, py, ta + side * (0.95 + rnd() * 0.5), len, W(0.1, 0.55 - 0.2 * hi, 0.1 + 0.35 * hi), 0.55, 0.25 * hi);
      if (k % 3 === 0) leafOn(px, py, ta + side * 0.3, len * 0.8, W(0.05, 0.4, 0.55), 0.4, 0.2);
    }
    leafOn(x2, y2, Math.atan2(y2 - y1, x2 - x1), 24, W(0.05, 0.45, 0.5), 0.5, 0.2);
  }
  for (let i = 0; i < 14; i++) { // highlights up top
    const a = rnd() * TAU, r = rnd() * 60;
    leafOn(cx + Math.cos(a) * r, oy + 92 + Math.sin(a) * r * 0.6, a, 19 + rnd() * 6, W(0, 0.15, 0.85), 0.35, 0);
  }
}

// pine spray: a feathery bough along +x (base at the left, tip at the right). needles curve a little.
function needleSpray(ctx, x0, y0, x1, y1, len0, rnd, o) {
  const ang = Math.atan2(y1 - y0, x1 - x0), L = Math.hypot(x1 - x0, y1 - y0);
  const ca = Math.cos(ang), sa = Math.sin(ang);
  const n = o.n;
  ctx.lineCap = 'round';
  for (let pass = 0; pass < 4; pass++) {
    for (let i = 0; i < n; i++) {
      if (pass > 1 && rnd() < 0.12) continue;
      const t = 0.04 + 0.94 * (i / (n - 1));
      const bx = x0 + ca * L * t, by = y0 + sa * L * t;
      const ln = len0 * (1 - 0.72 * Math.pow(t, 1.25)) * (0.82 + rnd() * 0.32);
      for (const side of [-1, 1]) {
        const upper = side < 0;
        const sw = (0.95 - 0.55 * t) + (rnd() - 0.5) * 0.24;
        const a = ang + side * sw;
        let k = 1;
        if (pass === 0) { ctx.strokeStyle = W(1, 0.1, 0, 0.98); ctx.lineWidth = o.w0; }
        else if (pass === 1) { ctx.strokeStyle = upper ? W(0.05, 0.95, 0) : W(0.3, 0.7, 0); ctx.lineWidth = o.w1; k = 0.93; }
        else if (pass === 2) { ctx.strokeStyle = upper ? W(0, o.hiMid, 1) : W(0.15, 0.7, 0.15); ctx.lineWidth = o.w2; k = upper ? 0.84 : 0.68; }
        else { if (!upper) continue; ctx.strokeStyle = W(0, 0.1, 1, 0.9); ctx.lineWidth = o.w2 * 0.8; k = 0.5; }
        const ex = bx + Math.cos(a) * ln * k, ey = by + Math.sin(a) * ln * k;
        // curve: control point pushed toward the tip direction
        const cxp = bx + Math.cos(a) * ln * k * 0.5 + ca * ln * 0.14 * k, cyp = by + Math.sin(a) * ln * k * 0.5 + sa * ln * 0.14 * k;
        ctx.beginPath(); ctx.moveTo(bx, by); ctx.quadraticCurveTo(cxp, cyp, ex, ey); ctx.stroke();
      }
    }
  }
  ctx.strokeStyle = W(1, 0, 0, 0.95); ctx.lineWidth = 3.4; // stem
  ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
}
function paintPine(ctx, ox, oy, rnd, snow) {
  const o = { n: 26, w0: 8.5, w1: 6, w2: 3.6, hiMid: 0.4 };
  const my = oy + CELL / 2;
  ctx.fillStyle = W(0.85, 0.15, 0); // dark feathery body keeps a solid silhouette at range
  ctx.beginPath(); ctx.moveTo(ox + 8, my); ctx.quadraticCurveTo(ox + 90, my - 66, ox + 246, my - 2); ctx.quadraticCurveTo(ox + 90, my + 70, ox + 8, my); ctx.fill();
  needleSpray(ctx, ox + 8, my + 4, ox + 244, my - 3, 70, rnd, o);
  needleSpray(ctx, ox + 84, my + 1, ox + 176, my - 50, 42, rnd, { ...o, n: 12, w0: 7, w1: 5, w2: 3 });
  needleSpray(ctx, ox + 84, my + 1, ox + 176, my + 50, 42, rnd, { ...o, n: 12, w0: 7, w1: 5, w2: 3 });
  if (snow) {
    // snow blanket clumps riding on the upper needles, needles stay green below
    ctx.fillStyle = cL;
    for (let i = 0; i < 36; i++) {
      const t = 0.06 + 0.9 * rnd();
      const x = ox + 8 + 236 * t + (rnd() - 0.5) * 8;
      const spread = 58 * (1 - 0.72 * t);
      const y = my - 4 - Math.pow(rnd(), 0.9) * spread * 0.8;
      const r = 5 + rnd() * 6 * (1 - 0.5 * t);
      ctx.beginPath(); ctx.ellipse(x, y, r * 1.4, r, (rnd() - 0.5) * 0.7, 0, TAU); ctx.fill();
    }
    ctx.fillStyle = W(0, 0.3, 0.7);
    for (let i = 0; i < 16; i++) {
      const t = 0.1 + 0.8 * rnd();
      ctx.beginPath(); ctx.ellipse(ox + 8 + 236 * t, my - 5 - rnd() * 40 * (1 - 0.6 * t), 3.5 + rnd() * 3, 2.5 + rnd() * 3, rnd(), 0, TAU); ctx.fill();
    }
  }
}

// palm frond: a rachis along +x with slim drooping leaflets on both halves. Upper half of the cell = one side.
function paintPalm(ctx, ox, oy, rnd) {
  const my = oy + CELL / 2, x0 = ox + 6, x1 = ox + 250;
  const nL = 27;
  const blade = (bx, by, side, t, k, w) => {
    const ln = (112 * Math.sin(PI * Math.pow(0.08 + 0.92 * t, 0.85)) + 14) * (0.9 + rnd() * 0.18);
    const dir = side * (PI / 2 - (0.4 + 0.5 * t));
    leaf(ctx, bx, by, dir + (rnd() - 0.5) * 0.1, ln * k, w, PR_LANCE, -side * 0.14);
  };
  const stations = [];
  for (let i = 0; i < nL; i++) stations.push(0.03 + 0.95 * (i / (nL - 1)));
  // dark undercoat, slightly fat
  ctx.fillStyle = W(0.85, 0.15, 0);
  for (const t of stations) for (const side of [-1, 1]) { blade(x0 + (x1 - x0) * t, my, side, t, 1.0, 13); ctx.fill(); }
  for (const t of stations) for (const side of [-1, 1]) {
    blade(x0 + (x1 - x0) * t, my, side, t, 0.95, 9.5);
    ctx.fillStyle = side < 0 ? W(0.05, 0.6, 0.35) : W(0.2, 0.7, 0.1);
    ctx.fill();
  }
  for (const t of stations) { // light streak on the upper leaflets
    blade(x0 + (x1 - x0) * t, my, -1, t, 0.8, 4.4);
    ctx.fillStyle = W(0, 0.2, 0.8, 0.85); ctx.fill();
  }
  ctx.lineCap = 'round';
  ctx.strokeStyle = W(0.7, 0.3, 0, 1); ctx.lineWidth = 7; // rachis
  ctx.beginPath(); ctx.moveTo(x0, my); ctx.lineTo(x1, my); ctx.stroke();
  ctx.strokeStyle = W(0, 0.3, 0.7, 1); ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(x0, my - 1); ctx.lineTo(x1 - 4, my - 1); ctx.stroke();
}

// ---- bark painters ---------------------------------------------------------------------------------
// Tiles wrap in both directions: every stroke is repeated at the neighbouring tile offsets it touches.
function wrapDraw(ctx, x, y, w, h, fn) {
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const X = x + dx * BARK_W, Y = y + dy * BARK_H;
      if (X > BARK_W || Y > BARK_H || X + w < 0 || Y + h < 0) continue;
      ctx.save(); ctx.translate(dx * BARK_W, dy * BARK_H); fn(); ctx.restore();
    }
  }
}
// vertical wobbly fissure from (x, y) of length len; tapered
function fissure(ctx, x, y, len, w, rnd, wob = 5) {
  const pts = [];
  let px = x;
  const n = 9;
  for (let i = 0; i <= n; i++) { px += (rnd() - 0.5) * wob; pts.push([px, y + (len * i) / n]); }
  wrapDraw(ctx, x - 20, y, 40, len, () => {
    ctx.beginPath();
    for (let i = 0; i <= n; i++) { const t = i / n, ww = w * 0.5 * Math.pow(Math.sin(PI * (0.05 + 0.9 * t)), 0.7); if (i === 0) ctx.moveTo(pts[i][0] - ww, pts[i][1]); else ctx.lineTo(pts[i][0] - ww, pts[i][1]); }
    for (let i = n; i >= 0; i--) { const t = i / n, ww = w * 0.5 * Math.pow(Math.sin(PI * (0.05 + 0.9 * t)), 0.7); ctx.lineTo(pts[i][0] + ww, pts[i][1]); }
    ctx.closePath(); ctx.fill();
  });
  return pts;
}
function dash(ctx, x, y, w, h, rot = 0) {
  wrapDraw(ctx, x - w, y - w, w * 2, w * 2, () => { ctx.beginPath(); ctx.ellipse(x, y, w * 0.5, h * 0.5, rot, 0, TAU); ctx.fill(); });
}

function barkBase(ctx, weights) {
  ctx.fillStyle = weights; ctx.fillRect(0, 0, BARK_W, BARK_H);
}

function paintBarkOak(ctx, rnd) {
  barkBase(ctx, W(0.1, 0.8, 0.1));
  // pale ridge plates
  for (let i = 0; i < 46; i++) {
    const x = rnd() * BARK_W, y = rnd() * BARK_H, w = 8 + rnd() * 12, h = 26 + rnd() * 50;
    ctx.fillStyle = W(0, 0.55, 0.45, 0.6);
    wrapDraw(ctx, x - w, y, w * 2, h, () => { ctx.beginPath(); ctx.ellipse(x, y + h / 2, w * 0.5, h * 0.5, 0, 0, TAU); ctx.fill(); });
  }
  // deep fissures with light lips on the sun side
  for (let i = 0; i < 26; i++) {
    const x = (i / 26) * BARK_W + (rnd() - 0.5) * 3, y = rnd() * BARK_H, len = 70 + rnd() * 110;
    ctx.fillStyle = W(0.2, 0.4, 0.4, 0.55);
    fissure(ctx, x + 3, y, len, 2.6, rnd, 3);
    ctx.fillStyle = W(1, 0, 0, 0.92);
    fissure(ctx, x, y + 2, len - 4, 5.2, rnd, 3.5);
  }
  // knots
  for (let i = 0; i < 4; i++) {
    const x = rnd() * BARK_W, y = rnd() * BARK_H;
    ctx.fillStyle = W(0.1, 0.4, 0.5, 0.9); dash(ctx, x, y, 22, 20);
    ctx.fillStyle = W(1, 0, 0, 0.95); dash(ctx, x, y + 1, 14, 12);
    ctx.fillStyle = W(0.3, 0.7, 0, 0.9); dash(ctx, x, y + 2, 6, 5);
  }
  // short cross cracks
  ctx.fillStyle = W(1, 0, 0, 0.7);
  for (let i = 0; i < 30; i++) dash(ctx, rnd() * BARK_W, rnd() * BARK_H, 8 + rnd() * 8, 1.8);
}

function paintBarkCherry(ctx, rnd) {
  barkBase(ctx, W(0.2, 0.8, 0));
  // glossy vertical sheen bands
  for (let i = 0; i < 9; i++) {
    const x = rnd() * BARK_W, w = 5 + rnd() * 10;
    ctx.fillStyle = W(0, 0.6, 0.4, 0.4);
    wrapDraw(ctx, x - w, 0, w * 2, BARK_H, () => { ctx.fillRect(x - w / 2, 0, w, BARK_H); });
  }
  // dark under bands
  for (let i = 0; i < 12; i++) {
    const x = rnd() * BARK_W, w = 3 + rnd() * 6;
    ctx.fillStyle = W(0.8, 0.2, 0, 0.5);
    wrapDraw(ctx, x - w, 0, w * 2, BARK_H, () => { ctx.fillRect(x - w / 2, 0, w, BARK_H); });
  }
  // horizontal lenticels: pale dashes in rows
  for (let row = 0; row < 26; row++) {
    const y = (row / 26) * BARK_H + (rnd() - 0.5) * 4;
    const n = 3 + Math.floor(rnd() * 3);
    for (let k = 0; k < n; k++) {
      const x = rnd() * BARK_W, w = 12 + rnd() * 20;
      ctx.fillStyle = W(0.25, 0.1, 0.65, 0.95);
      dash(ctx, x, y, w, 3.2 + rnd() * 1.6);
      ctx.fillStyle = W(1, 0, 0, 0.55);
      dash(ctx, x, y + 2.6, w * 0.92, 1.6);
    }
  }
  // a few dark curls
  ctx.fillStyle = W(1, 0, 0, 0.7);
  for (let i = 0; i < 8; i++) dash(ctx, rnd() * BARK_W, rnd() * BARK_H, 14 + rnd() * 12, 2.4, (rnd() - 0.5) * 0.3);
}

function paintBarkPine(ctx, rnd) {
  barkBase(ctx, W(1, 0, 0));
  // staggered plates in columns
  const cols = 5, colW = BARK_W / cols;
  for (let c = 0; c < cols; c++) {
    let y = -rnd() * 40;
    while (y < BARK_H + 20) {
      const h = 34 + rnd() * 34, x = c * colW + colW / 2 + (rnd() - 0.5) * 4, w = colW * (0.72 + rnd() * 0.16);
      const tone = rnd();
      // plate body (mid) with a lighter top face and a darker foot
      ctx.fillStyle = tone < 0.35 ? W(0.15, 0.75, 0.1) : tone < 0.8 ? W(0, 0.85, 0.15) : W(0, 0.6, 0.4);
      wrapDraw(ctx, x - w, y, w * 2, h, () => { ctx.beginPath(); ctx.roundRect(x - w / 2, y, w, h - 2.5, 5); ctx.fill(); });
      ctx.fillStyle = W(0, 0.3, 0.7, 0.85);
      wrapDraw(ctx, x - w, y, w * 2, h, () => { ctx.beginPath(); ctx.roundRect(x - w * 0.42, y + 1.5, w * 0.84, h * 0.24, 4); ctx.fill(); });
      ctx.fillStyle = W(0.7, 0.3, 0, 0.7);
      wrapDraw(ctx, x - w, y, w * 2, h, () => { ctx.beginPath(); ctx.roundRect(x - w * 0.46, y + h * 0.76, w * 0.92, h * 0.18, 4); ctx.fill(); });
      y += h;
    }
  }
}

function paintBarkBirch(ctx, rnd) {
  barkBase(ctx, W(0, 0.25, 0.75));
  // soft grey wash patches
  for (let i = 0; i < 12; i++) {
    const x = rnd() * BARK_W, y = rnd() * BARK_H, w = 20 + rnd() * 26, h = 30 + rnd() * 50;
    ctx.fillStyle = W(0.1, 0.8, 0.1, 0.32);
    wrapDraw(ctx, x - w, y - h, w * 2, h * 2, () => { ctx.beginPath(); ctx.ellipse(x, y, w * 0.5, h * 0.5, 0, 0, TAU); ctx.fill(); });
  }
  // lenticel marks: dark horizontal dashes, some with a grey halo
  for (let i = 0; i < 46; i++) {
    const x = rnd() * BARK_W, y = rnd() * BARK_H, w = 12 + rnd() * 36, h = 3 + rnd() * 4;
    ctx.fillStyle = W(0.3, 0.7, 0, 0.55); dash(ctx, x, y, w * 1.2, h * 2.4);
    ctx.fillStyle = W(1, 0, 0, 0.95); dash(ctx, x, y, w, h);
  }
  // knot scars: a couple of low, wide dark smudges instead of eyes
  for (let i = 0; i < 2; i++) {
    const x = rnd() * BARK_W, y = rnd() * BARK_H;
    ctx.fillStyle = W(0.3, 0.7, 0, 0.55); dash(ctx, x, y, 34, 16);
    ctx.fillStyle = W(1, 0, 0, 0.9); dash(ctx, x, y + 1, 22, 7);
  }
  // fine vertical grain
  ctx.fillStyle = W(0.5, 0.5, 0, 0.35);
  for (let i = 0; i < 28; i++) { const x = rnd() * BARK_W, y = rnd() * BARK_H; fissure(ctx, x, y, 18 + rnd() * 30, 1.2, rnd, 1.5); }
}

function paintBarkMaple(ctx, rnd) {
  barkBase(ctx, W(0.2, 0.7, 0.1));
  // long shallow ridges
  for (let i = 0; i < 24; i++) {
    const x = (i / 24) * BARK_W + (rnd() - 0.5) * 3, y = rnd() * BARK_H, len = 60 + rnd() * 120;
    ctx.fillStyle = W(0, 0.4, 0.6, 0.6);
    fissure(ctx, x - 1.5, y, len, 4.6, rnd, 2.5);
    ctx.fillStyle = W(1, 0, 0, 0.85);
    fissure(ctx, x + 2.5, y + 3, len - 8, 3.2, rnd, 2.5);
  }
  // scaly flakes
  for (let i = 0; i < 30; i++) {
    const x = rnd() * BARK_W, y = rnd() * BARK_H, w = 8 + rnd() * 10;
    ctx.fillStyle = W(0, 0.5, 0.5, 0.55); dash(ctx, x, y, w, w * 0.4, (rnd() - 0.5) * 0.4);
    ctx.fillStyle = W(0.9, 0.1, 0, 0.6); dash(ctx, x, y + w * 0.28, w * 0.9, w * 0.14);
  }
}

function paintBarkPalm(ctx, rnd) {
  barkBase(ctx, W(0.1, 0.8, 0.1));
  // vertical fibres
  for (let i = 0; i < 60; i++) {
    const x = rnd() * BARK_W, y = rnd() * BARK_H;
    ctx.fillStyle = rnd() < 0.5 ? W(1, 0, 0, 0.5) : W(0, 0.3, 0.7, 0.5);
    fissure(ctx, x, y, 16 + rnd() * 38, 1.4 + rnd() * 1.4, rnd, 2);
  }
  // scar rings: a pale lip above a dark groove
  const rings = 6;
  for (let i = 0; i < rings; i++) {
    const y = (i / rings) * BARK_H + 8;
    for (let k = 0; k < 4; k++) {
      const x0 = k * (BARK_W / 4);
      ctx.fillStyle = W(0, 0.25, 0.75, 0.9);
      wrapDraw(ctx, x0, y - 12, BARK_W / 4 + 6, 30, () => { ctx.beginPath(); ctx.ellipse(x0 + BARK_W / 8, y - 5, BARK_W / 7.4, 5, 0, 0, TAU); ctx.fill(); });
      ctx.fillStyle = W(1, 0, 0, 0.95);
      wrapDraw(ctx, x0, y - 4, BARK_W / 4 + 6, 30, () => { ctx.beginPath(); ctx.ellipse(x0 + BARK_W / 8, y + 3, BARK_W / 7.6, 4.2, 0, 0, TAU); ctx.fill(); });
    }
  }
}

// moss mask: lumpy noise, values near 1 = moss first
function paintMoss(ctx, rnd) {
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, BARK_W, BARK_H);
  for (let i = 0; i < 90; i++) {
    const x = rnd() * BARK_W, y = rnd() * BARK_H, r = 4 + rnd() * 14;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    const v = 110 + Math.floor(rnd() * 145);
    g.addColorStop(0, `rgba(${v},${v},${v},1)`); g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    wrapDraw(ctx, x - r, y - r, r * 2, r * 2, () => { ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill(); });
  }
}

const BARK_PAINT = { oak: paintBarkOak, cherry: paintBarkCherry, pine: paintBarkPine, birch: paintBarkBirch, maple: paintBarkMaple, palm: paintBarkPalm };

// ---- raw pixel producers (no three.js, also used by the dump tool) ----------------------------------

export function paintAtlasRaw() {
  const { c, ctx } = makeCanvas(ATLAS_W, ATLAS_H);
  const P = [paintOak, paintCherry, paintMaple, paintBirch, (a, b, c2, d) => paintPine(a, b, c2, d, false), (a, b, c2, d) => paintPine(a, b, c2, d, true), paintPalm, paintOakB];
  for (let i = 0; i < 8; i++) {
    const ox = (i % 4) * CELL, oy = Math.floor(i / 4) * CELL;
    ctx.save();
    ctx.beginPath(); ctx.rect(ox, oy, CELL, CELL); ctx.clip();
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    P[i](ctx, ox, oy, mulberry32(9100 + i * 37));
    ctx.restore();
  }
  const img = ctx.getImageData(0, 0, ATLAS_W, ATLAS_H);
  return { data: new Uint8Array(img.data.buffer.slice(0)), width: ATLAS_W, height: ATLAS_H };
}

export function paintBarkRaw(key) {
  const a = makeCanvas(BARK_W, BARK_H), m = makeCanvas(BARK_W, BARK_H);
  a.ctx.lineJoin = 'round'; a.ctx.lineCap = 'round';
  const seed = 5300 + BARK_KEYS.indexOf(key) * 101;
  BARK_PAINT[key](a.ctx, mulberry32(seed));
  paintMoss(m.ctx, mulberry32(seed + 7));
  const A = a.ctx.getImageData(0, 0, BARK_W, BARK_H).data, B = m.ctx.getImageData(0, 0, BARK_W, BARK_H).data;
  const out = new Uint8Array(BARK_W * BARK_H * 4);
  for (let i = 0; i < BARK_W * BARK_H; i++) {
    out[i * 4] = A[i * 4]; out[i * 4 + 1] = A[i * 4 + 1]; out[i * 4 + 2] = A[i * 4 + 2]; out[i * 4 + 3] = B[i * 4];
  }
  return { data: out, width: BARK_W, height: BARK_H };
}

// ---- three.js textures (built once) ------------------------------------------------------------------

let CACHE = null;

function dataTex(raw, wrap) {
  const t = new THREE.DataTexture(raw.data, raw.width, raw.height, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.wrapS = t.wrapT = wrap ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = wrap ? 8 : 4;
  t.needsUpdate = true;
  return t;
}

export function getTreeTextures() {
  if (CACHE) return CACHE;
  const t0 = typeof performance !== 'undefined' ? performance.now() : 0;
  const atlas = dataTex(paintAtlasRaw(), false);
  const bark = {};
  for (const k of BARK_KEYS) bark[k] = dataTex(paintBarkRaw(k), true);
  CACHE = { atlas, bark, ms: typeof performance !== 'undefined' ? performance.now() - t0 : 0 };
  if (typeof window !== 'undefined') window.__treeTexMs = CACHE.ms;
  return CACHE;
}
