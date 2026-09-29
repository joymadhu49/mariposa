import { launch, openGame, scratch } from './lib.mjs';
const { browser, page, logs } = await launch({ width: 1440, height: 810, pad: true });
await openGame(page);
await page.waitForTimeout(2200);
const files = [];
for (const t of [0, 5, 6, 7]) {
  await page.evaluate((t) => { if (t) __g.advance(t, false); __g.advance(0.1, true); }, t);
  const f = `${scratch}/title_${files.length}.png`;
  await page.screenshot({ path: f }); files.push(f);
}
console.log(files.length);
await browser.close();
