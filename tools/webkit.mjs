// Cross engine check: runs the game in WebKit (the Safari engine) and looks for shader or runtime errors.
// Uses Playwright's WebKit build. Set WEBKIT_EXE to a pw_run.sh if the default build is not installed.
import { webkit } from 'playwright';
import path from 'node:path';
import fs from 'node:fs';
import { root, scratch } from './lib.mjs';
const cache = path.join(process.env.HOME, 'Library/Caches/ms-playwright');
let exe = process.env.WEBKIT_EXE;
if (!exe) {
  const dirs = fs.existsSync(cache) ? fs.readdirSync(cache).filter((d) => d.startsWith('webkit-')).sort().reverse() : [];
  exe = dirs.length ? path.join(cache, dirs[0], 'pw_run.sh') : undefined;
}
const browser = await webkit.launch({ headless: true, ...(exe ? { executablePath: exe } : {}) });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
// real time loop (not manual mode) so WebKit paints and runs CSS transitions like a normal tab
await page.goto('file://' + path.join(root, 'dist/mariposa.html'), { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__g && window.__g.ready, null, { timeout: 90000 });
const gl = await page.evaluate(() => { const c = document.createElement('canvas'); const g = c.getContext('webgl2'); const d = g.getExtension('WEBGL_debug_renderer_info'); return { renderer: d ? g.getParameter(d.UNMASKED_RENDERER_WEBGL) : 'n/a', maxSamples: g.getParameter(g.MAX_SAMPLES), floatRT: !!g.getExtension('EXT_color_buffer_float'), halfRT: !!g.getExtension('EXT_color_buffer_half_float'), floatLin: !!g.getExtension('OES_texture_float_linear') }; });
console.log('webgl', JSON.stringify(gl));
const views = [
  ['meadow', 40, 640, 5, Math.PI, 10],
  ['forest', 700, -440, 8, 0.7, 12],
  ['lake', 520, 430, 6, 1.9, 12],
  ['alpine', -100, -880, 30, 0.5, 12],
  ['night', 40, 640, 6, Math.PI, 22],
  ['sunset', -700, 170, 8, 1.0, 17.6],
  ['sundial', -400, 944, 6, Math.PI, 9.5],
  ['falls', 318, -845, 12, -2.04, 10.5],
];
for (const [name, x, z, alt, yaw, hour] of views) {
  await page.evaluate(([x, z, alt, yaw, hour]) => { __g.debugPlay(x, z, alt, yaw, hour); document.querySelectorAll('#card').forEach((e) => { e.style.display = 'none'; }); }, [x, z, alt, yaw, hour]);
  await page.waitForTimeout(1800);
  const f0 = await page.evaluate(() => __g.frames);
  const t0 = Date.now();
  await page.waitForTimeout(2000);
  const info = await page.evaluate(() => ({ state: __g.state, res: __g.engine._lastRes, samples: __g.engine.post.samples, frames: __g.frames }));
  info.fps = +((info.frames - f0) / ((Date.now() - t0) / 1000)).toFixed(1);
  await page.screenshot({ path: path.join(scratch, `wk_${name}.png`) });
  console.log(name, JSON.stringify(info));
}
await page.evaluate(() => { __g.weather.locked = true; __g.weather.setMood('shower', true); });
await page.waitForTimeout(2500);
await page.screenshot({ path: path.join(scratch, 'wk_rain.png') });
const seen = new Set();
const bad = [];
for (const l of logs) { const k = l.slice(0, 300); if (seen.has(k)) continue; seen.add(k); if (!l.includes('prefill')) bad.push(l.slice(0, 600)); }
console.log(bad.length ? 'LOGS:\n' + bad.join('\n') : 'no console output');
await browser.close();
