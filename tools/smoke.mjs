import { launch, openGame, scratch } from './lib.mjs';
const { browser, page, logs } = await launch({ width: 1440, height: 810, pad: true });
await openGame(page);
const adv = (s) => page.evaluate((s) => __g.advance(s), s);
console.log('boot', JSON.stringify(await adv(1.0)));
await page.waitForTimeout(1800);
await adv(2.5);
await page.screenshot({ path: `${scratch}/s_title.png` });
console.log('play', JSON.stringify(await page.evaluate(() => __g.debugPlay(40, 640, 4, Math.PI, 10))));
console.log('adv', JSON.stringify(await adv(2.0)));
await page.screenshot({ path: `${scratch}/s_play.png` });
const seen = new Set();
for (const l of logs) { const k = l.slice(0, 300); if (seen.has(k)) continue; seen.add(k); console.log(l.slice(0, 1200)); }
await browser.close();
