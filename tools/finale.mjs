import { launch, openGame, scratch } from './lib.mjs';
const { browser, page, logs } = await launch({ width: 1280, height: 720, pad: true });
await openGame(page);
await page.waitForTimeout(1500);
await page.evaluate(() => { __g.debugPlay(40, 640, 4, Math.PI, 17.8); const pr = __g.progress; pr.stats.pollinations = 40; for (const l of __g.world.landmarks) pr.discover(l.id); pr.stats.stars = 96; const h = __g.world.landmark('heartbloom'); __g.player.teleport(h.x + 60, h.y + 28, h.z + 60, 0); __g.advance(0.4, false); });
const files = [];
for (const t of [1.5, 3.5, 4, 4]) {
  await page.evaluate((t) => { __g.advance(t, false); __g.advance(0.05, true); }, t);
  const f = `${scratch}/fin_${files.length}.png`;
  await page.screenshot({ path: f }); files.push(f);
}
console.log(await page.evaluate(() => __g.state));
await browser.close();
