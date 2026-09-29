import { launch, openGame, scratch } from './lib.mjs';
const { browser, page, logs } = await launch({ width: 960, height: 540 });
await openGame(page);
await page.waitForTimeout(1500);
const hours = (process.argv[2] || '6,7.5,12,16.5,17.6,18.6,19.6,21,23.5').split(',').map(Number);
const x = +(process.argv[3] || 40), z = +(process.argv[4] || 640), alt = +(process.argv[5] || 6), yaw = +(process.argv[6] ?? Math.PI);
const files = [];
for (const h of hours) {
  await page.evaluate(([h, x, z, alt, yaw]) => { __g.debugPlay(x, z, alt, yaw, h); __g.camRig.pitch = -0.05; __g.advance(0.4, false); __g.advance(0.3); }, [h, x, z, alt, yaw]);
  const f = `${scratch}/tod_${String(h).replace('.', '_')}.png`;
  await page.screenshot({ path: f });
  files.push(f);
}
console.log(files.join(' '));
const seen = new Set();
for (const l of logs) { const k = l.slice(0, 200); if (seen.has(k)) continue; seen.add(k); if (!l.includes('prefill')) console.log(l.slice(0, 500)); }
await browser.close();
