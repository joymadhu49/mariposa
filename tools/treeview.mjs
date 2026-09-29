import { launch, openGame, scratch } from './lib.mjs';
const { browser, page, logs } = await launch({ width: 960, height: 540 });
await openGame(page);
await page.waitForTimeout(1500);
const spots = [
  ['meadow', 40, 600, 3, Math.PI, 10.5],
  ['forest', 700, -440, 6, 0.7, 11],
  ['blossom', -700, 170, 5, 1.0, 11.5],
  ['autumn', -780, -470, 6, 2.4, 16.5],
  ['alpine', -100, -880, 30, 0.5, 12],
  ['shore', 1180, 880, 8, 2.6, 14],
];
const files = [];
for (const [name, x, z, alt, yaw, hour] of spots) {
  await page.evaluate(([x, z, alt, yaw, hour]) => { __g.debugPlay(x, z, alt, yaw, hour); __g.camRig.pitch = -0.02; __g.advance(0.5, false); __g.advance(0.3); }, [x, z, alt, yaw, hour]);
  const f = `${scratch}/tv_${name}.png`;
  await page.screenshot({ path: f }); files.push(f);
}
const seen = new Set();
for (const l of logs) { const k = l.slice(0, 240); if (seen.has(k)) continue; seen.add(k); if (!l.includes('prefill')) console.log('LOG', l.slice(0, 600)); }
await browser.close();
