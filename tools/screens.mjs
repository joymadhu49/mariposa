import { launch, openGame, scratch } from './lib.mjs';
const { browser, page, logs } = await launch({ width: 1440, height: 810, pad: true });
await openGame(page);
await page.waitForTimeout(1800);
await page.evaluate(() => __g.debugPlay(40, 640, 4, Math.PI, 10));
await page.evaluate(() => __g.advance(1.0));
const shot = async (name, fn) => {
  await page.evaluate(fn);
  await page.evaluate(() => __g.advance(0.7));
  await page.waitForTimeout(350);
  await page.screenshot({ path: `${scratch}/ui_${name}.png` });
};
await shot('pause', () => __g.pause());
await shot('settings', () => __g.ui.open('settings', { from: 'pause' }));
await shot('controls', () => __g.ui.open('controls', { from: 'pause' }));
await shot('journal', () => { __g.progress.discover('windmill'); __g.progress.discover('heartbloom'); __g.progress.data.tasted.daisy = 3; __g.progress.data.tasted.poppy = 1; __g.progress.stats.pollinations = 5; __g.ui.open('journal'); });
await shot('journal2', () => { __g.ui.journalTab = 2; __g.ui.closeAll(); __g.ui.open('journal'); });
await shot('map', () => { __g.progress.explore(40, 640, 400); __g.progress.explore(-230, 420, 300); __g.progress.explore(0, -120, 200); __g.ui.closeAll(); __g.ui.open('map'); });
await page.evaluate(() => { __g.ui.closeAll(); __g.state = 'play'; __g.ui.hudVisible(true); });
const seen = new Set();
for (const l of logs) { const k = l.slice(0, 300); if (seen.has(k)) continue; seen.add(k); console.log(l.slice(0, 900)); }
await browser.close();
