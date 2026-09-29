import { launch, openGame, scratch } from './lib.mjs';
const { browser, page, logs } = await launch({ width: 960, height: 540 });
await openGame(page);
await page.waitForTimeout(1500);
const spots = [
  ['seaA', 1185, 895, 30, 0.8, 12],
  ['seaB', 1250, 960, 40, 0.8, 12],
  ['seaC', 1100, 800, 12, 0.8, 16.5],
  ['seaD', -1500, -160, 25, -1.57, 14],
];
for (const [name, x, z, alt, yaw, hour] of spots) {
  await page.evaluate(([x, z, alt, yaw, hour]) => { __g.debugPlay(x, z, alt, yaw, hour); __g.camRig.pitch = -0.45; __g.advance(0.5, false); __g.advance(0.3); }, [x, z, alt, yaw, hour]);
  await page.screenshot({ path: `${scratch}/w_${name}.png` });
}
const seen = new Set();
for (const l of logs) { const k = l.slice(0, 200); if (seen.has(k)) continue; seen.add(k); if (!l.includes('prefill')) console.log(l.slice(0, 500)); }
await browser.close();
