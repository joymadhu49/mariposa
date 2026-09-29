// The loading screen fill is animated with transform, so it must read correctly at 0, 50 and 100 percent.
import { launch, openGame, scratch } from './lib.mjs';
const { browser, page, logs } = await launch({ width: 1000, height: 560 });
await openGame(page, 'dist/mariposa.html');
await page.waitForTimeout(1500);
let fails = 0;
for (const f of [0, 0.5, 1]) {
  await page.evaluate((f) => { const l = document.getElementById('loading'); l.classList.remove('done', 'hidden'); __g.ui.setLoading(f, 'Unfolding the world'); }, f);
  await page.waitForTimeout(700);
  const m = await page.evaluate(() => {
    const bar = document.querySelector('#loading .bar').getBoundingClientRect();
    const i = document.querySelector('#loading .bar i');
    const r = i.getBoundingClientRect();
    return { barW: bar.width, fillW: r.width, transform: getComputedStyle(i).transform };
  });
  const ok = Math.abs(m.fillW - m.barW * f) < 1.5;
  if (!ok) fails++;
  console.log(ok ? 'PASS' : 'FAIL', `fill ${f}`, JSON.stringify(m));
  await page.screenshot({ path: `${scratch}/loadbar_${Math.round(f * 100)}.png`, clip: { x: 300, y: 180, width: 400, height: 220 } });
}
console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
await browser.close();
process.exit(fails ? 1 : 0);
