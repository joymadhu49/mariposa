import { launch, openGame, scratch } from './lib.mjs';
const w = +process.argv[2] || 1920, h = +process.argv[3] || 1080, dpr = +process.argv[4] || 1;
const { browser, page, logs } = await launch({ width: w, height: h, dpr, manual: false, pad: true });
await page.goto('file://' + process.cwd() + '/dist/mariposa.html', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__g && window.__g.ready, null, { timeout: 120000 });
await page.waitForTimeout(1800);
const views = [
  ['meadow', 40, 640, 4, Math.PI, 10],
  ['forest', 700, -450, 8, 0.6, 12],
  ['blossom', -700, 150, 6, 1.0, 12],
  ['lake', 600, 520, 10, 1.3, 12],
  ['alpine', -100, -900, 40, 0.5, 12],
  ['night', 40, 640, 4, Math.PI, 23],
];
for (const [name, x, z, alt, yaw, hour] of views) {
  await page.evaluate(([x, z, alt, yaw, hour]) => { __g.debugPlay(x, z, alt, yaw, hour); }, [x, z, alt, yaw, hour]);
  await page.waitForTimeout(1200);
  // gentle forward flight to exercise streaming
  await page.evaluate(() => { __pad.axes(0, -1, 0, 0); __pad.set('r2', 0.5); });
  const f0 = await page.evaluate(() => __g.frames);
  const t0 = Date.now();
  await page.waitForTimeout(3000);
  const f1 = await page.evaluate(() => __g.frames);
  const info = await page.evaluate(() => ({ res: __g.engine._lastRes, scale: __g.engine.scale.toFixed(2), inst: __g.scatter.stats.instances, tiles: __g.terrain.tileCount, q: __g.settings.quality }));
  console.log(name.padEnd(8), 'fps', ((f1 - f0) / ((Date.now() - t0) / 1000)).toFixed(1), JSON.stringify(info));
  await page.evaluate(() => __pad.clear());
}
const seen = new Set();
for (const l of logs) { const k = l.slice(0, 200); if (seen.has(k)) continue; seen.add(k); if (!l.includes('prefill')) console.log(l.slice(0, 400)); }
await browser.close();
