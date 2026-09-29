import { launch, openGame, scratch } from './lib.mjs';
const { browser, page, logs } = await launch({ width: 1280, height: 720, pad: true, manual: true });
const t0 = Date.now();
await openGame(page);
console.log('ready after', Date.now() - t0, 'ms (includes browser launch of page)');
await page.waitForTimeout(1200);
await page.evaluate(() => __g.debugPlay(40, 640, 4, Math.PI, 10));
for (const q of ['low', 'medium', 'high', 'ultra', 'auto']) {
  const r = await page.evaluate((q) => { __g.setQuality(q); const t = performance.now(); __g.advance(0.5, false); __g.advance(0.2); return { q, ms: +(performance.now() - t).toFixed(0), res: __g.engine._lastRes, samples: __g.engine.post.samples, bloom: __g.engine.post.bloomOn, grass: __g.grass.quality, radius: Math.round(__g.scatter.radius), range0: __g.terrain.range0 }; }, q);
  console.log(JSON.stringify(r));
  await page.screenshot({ path: `${scratch}/q_${q}.png` });
}
// resize checks
for (const [w, h] of [[800, 500], [1920, 1080], [600, 900], [1280, 720]]) {
  await page.setViewportSize({ width: w, height: h });
  await page.waitForTimeout(150);
  const r = await page.evaluate(() => { __g.advance(0.2); const c = document.getElementById('gl'); return { css: [c.clientWidth, c.clientHeight], buf: [c.width, c.height], aspect: +__g.engine.camera.aspect.toFixed(3) }; });
  console.log(w + 'x' + h, JSON.stringify(r));
}
const seen = new Set();
for (const l of logs) { const k = l.slice(0, 240); if (seen.has(k)) continue; seen.add(k); if (!l.includes('prefill')) console.log('LOG', l.slice(0, 500)); }
await browser.close();
