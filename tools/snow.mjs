import { launch, openGame, scratch } from './lib.mjs';
const { browser, page, logs } = await launch({ width: 1280, height: 720 });
await openGame(page, 'dist/mariposa.html');
await page.waitForTimeout(1200);
await page.addStyleTag({ content: '#card { display: none !important; }' });
// find alpine biome (index 5) tree-rich spots and the summit
const spots = await page.evaluate(() => {
  const w = __g.world;
  const s = w.landmark('summit');
  const out = { summit: { x: s.x, z: s.z, y: s.y } };
  // a snowy pine grove: search a ring for high alpine weight with trees
  let best = null;
  const bw = new Float32Array(8);
  for (let a = 0; a < 40; a++) for (const r of [60, 120, 200, 320]) {
    const x = s.x + Math.cos(a * 0.157) * r, z = s.z + Math.sin(a * 0.157) * r;
    w.biomeWeightsAt(x, z, bw);
    let n = 0; w.forTreesNear(x, z, 40, () => { n++; });
    const sc = bw[5] * n;
    if (!best || sc > best.sc) best = { x, z, n, sc, h: w.heightAt(x, z) };
  }
  out.grove = best;
  return out;
});
console.log(JSON.stringify(spots));
const shots = [
  ['grove_clear', spots.grove.x, spots.grove.z, 7, 0.4, 12, 'clear'],
  ['grove_cloudy', spots.grove.x, spots.grove.z, 7, 0.4, 12, 'cloudy'],
  ['grove_dusk', spots.grove.x, spots.grove.z, 7, 0.4, 17.4, 'cloudy'],
  ['grove_night', spots.grove.x, spots.grove.z, 7, 0.4, 22, 'cloudy'],
  ['summit_cloudy', spots.summit.x + 30, spots.summit.z + 30, 25, 3.9, 12, 'cloudy'],
];
for (const [name, x, z, alt, yaw, hour, mood] of shots) {
  await page.evaluate(([x, z, alt, yaw, hour, mood]) => {
    __g.debugPlay(x, z, alt, yaw, hour);
    __g.weather.locked = true; __g.weather.setMood(mood, true);
    __g.camRig.pitch = 0.02;
    __g.advance(3.0, false); __g.advance(0.3);
  }, [x, z, alt, yaw, hour, mood]);
  await page.screenshot({ path: `${scratch}/snow_${name}.png` });
}
const seen = new Set();
for (const l of logs) { const k = l.slice(0, 200); if (seen.has(k)) continue; seen.add(k); if (!l.includes('prefill')) console.log(l.slice(0, 300)); }
await browser.close();
