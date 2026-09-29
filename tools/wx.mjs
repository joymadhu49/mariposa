import { launch, openGame, scratch } from './lib.mjs';
const { browser, page, logs } = await launch({ width: 960, height: 540 });
await openGame(page, 'dist/mariposa.html');
await page.waitForTimeout(1200);
await page.addStyleTag({ content: '#card { display: none !important; }' });
const spots = {
  meadow: [40, 640, 5, Math.PI, 12],
  forest: [700, -440, 8, 0.7, 12],
  alpine: [-100, -880, 30, 0.5, 12],
  lake: [520, 430, 6, 1.9, 12],
};
const files = [];
for (const [wname, hour] of [['shower', 13], ['mist', 7.5], ['drizzle', 17.5]]) {
  for (const [sname, [x, z, alt, yaw]] of Object.entries(spots)) {
    await page.evaluate(([w, x, z, alt, yaw, hour]) => {
      __g.debugPlay(x, z, alt, yaw, hour);
      __g.weather.locked = true;
      __g.weather.setMood(w, true);
      __g.camRig.pitch = 0.0;
      __g.advance(2.0, false); __g.advance(0.3);
    }, [wname, x, z, alt, yaw, hour]);
    const f = `${scratch}/wx_${wname}_${sname}.png`;
    await page.screenshot({ path: f });
    files.push(f);
  }
}
console.log(files.join(' '));
const seen = new Set();
for (const l of logs) { const k = l.slice(0, 200); if (seen.has(k)) continue; seen.add(k); if (!l.includes('prefill')) console.log(l.slice(0, 500)); }
await browser.close();
