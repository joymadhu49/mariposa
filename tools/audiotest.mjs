import { launch, openGame } from './lib.mjs';
const { browser, page, logs } = await launch({ width: 800, height: 450 });
await openGame(page);
await page.waitForTimeout(800);
const res = await page.evaluate(async () => {
  // audit every AudioParam value set above 15 kHz (oscillators must stay well below Nyquist)
  window.__hi = [];
  const desc = Object.getOwnPropertyDescriptor(AudioParam.prototype, 'value');
  Object.defineProperty(AudioParam.prototype, 'value', { configurable: true, get() { return desc.get.call(this); }, set(v) { if (v > 15000) window.__hi.push(v); desc.set.call(this, v); } });
  const AE = __g.audio.constructor;
  const sr = 32000, secs = 60;
  const ctx = new OfflineAudioContext(2, sr * secs, sr);
  let vt = 0;
  Object.defineProperty(ctx, 'currentTime', { get: () => vt });
  Object.defineProperty(ctx, 'state', { get: () => 'running' });
  const a = new AE();
  a.init(ctx);
  a.vol.master = 0.8; a.vol.music = 0.7; a.vol.sfx = 0.8;
  a.applyVolumes();
  const base = { night: 0, biome: 0, rain: 0, wind: 1, speed: 6, alt: 20, boost: 0, perched: false, grass: 0.6, lake: 0, sea: 0, falls: 0, bees: 0.4, birdDensity: 0.7, hour: 10, flap: true, flapAmp: 0.8, flapRate: 1, paused: false, moodMelody: 1, moodOct: 0 };
  const events = { 8: 'sipDone', 12: 'pollinate', 16: 'discover', 21: 'star', 24: 'pulse', 27: 'boost', 31: 'unlock', 36: 'shutter', 40: 'finale' };
  const dt = 1 / 30;
  for (let t = 0; t < secs; t += dt) {
    vt = t;
    const s = { ...base };
    if (t > 20 && t < 30) { s.boost = 1; s.speed = 20; s.alt = 120; }
    if (t > 30 && t < 45) { s.night = 1; s.hour = 23; }
    if (t > 45) { s.rain = 0.9; s.lake = 0.8; s.sea = 0.5; s.falls = 0.4; s.night = 0; }
    if (t > 50) { s.perched = true; }
    a.t = t;
    a.update(dt, s);
    for (const k of Object.keys(events)) { if (Math.abs(t - +k) < dt / 2) a.sfx(events[k]); }
  }
  const buf = await ctx.startRendering();
  const L = buf.getChannelData(0), R = buf.getChannelData(1);
  let nan = 0, peak = 0;
  const perSec = [];
  for (let s = 0; s < secs; s++) {
    let sum = 0, pk = 0;
    for (let i = s * sr; i < (s + 1) * sr; i++) {
      const v = L[i], w = R[i];
      if (!isFinite(v) || !isFinite(w)) nan++;
      const m = Math.max(Math.abs(v), Math.abs(w));
      if (m > pk) pk = m; sum += v * v;
    }
    peak = Math.max(peak, pk);
    perSec.push([+Math.sqrt(sum / sr).toFixed(4), +pk.toFixed(3)]);
  }
  // band energy fractions per segment using a radix 2 FFT
  const N = 4096;
  const fft = (re, im) => { const n = re.length; for (let i = 1, j = 0; i < n; i++) { let bit = n >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit; if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; } } for (let len = 2; len <= n; len <<= 1) { const ang = -2 * Math.PI / len, wr = Math.cos(ang), wi = Math.sin(ang); for (let i = 0; i < n; i += len) { let cr = 1, ci = 0; for (let k = 0; k < len / 2; k++) { const ur = re[i + k], ui = im[i + k]; const vr = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci, vi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr; re[i + k] = ur + vr; im[i + k] = ui + vi; re[i + k + len / 2] = ur - vr; im[i + k + len / 2] = ui - vi; const nr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = nr; } } } };
  const bands = [[0, 120], [120, 500], [500, 2000], [2000, 5000], [5000, 16000]];
  const seg = (a, b) => { const acc = bands.map(() => 0); let cen = 0, tot = 0, wn = 0; for (let t0 = a; t0 + 0.2 < b; t0 += 0.5) { const re = new Float64Array(N), im = new Float64Array(N); const off = Math.floor(t0 * sr); for (let i = 0; i < N; i++) re[i] = L[off + i] * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N)); fft(re, im); for (let k = 1; k < N / 2; k++) { const f = (k * sr) / N; const pw = re[k] * re[k] + im[k] * im[k]; for (let bi = 0; bi < bands.length; bi++) if (f >= bands[bi][0] && f < bands[bi][1]) acc[bi] += pw; cen += f * pw; tot += pw; } wn++; } return { bands: acc.map((v) => +(v / tot).toFixed(3)), centroid: Math.round(cen / tot) }; };
  const spectra = { day: seg(2, 19), boost: seg(21, 29), night: seg(32, 44), rain: seg(46, 58) };
  return { nan, peak: +peak.toFixed(3), perSec, spectra, hi: window.__hi.length, hiMax: Math.max(0, ...window.__hi) };
});
console.log('NaN samples:', res.nan, ' overall peak:', res.peak, ' params set above 15 kHz:', res.hi, res.hiMax);
console.log('band fractions [<120, 120-500, 500-2k, 2k-5k, 5k-16k] and centroid Hz:'); for (const [k, v] of Object.entries(res.spectra)) console.log(' ', k.padEnd(6), JSON.stringify(v));
console.log('sec: rms/peak');
console.log(res.perSec.map((r, i) => `${i}:${r[0]}/${r[1]}`).join('  '));
const seen = new Set();
for (const l of logs) { const k = l.slice(0, 240); if (seen.has(k)) continue; seen.add(k); if (!l.includes('prefill')) console.log('LOG', l.slice(0, 500)); }
await browser.close();
