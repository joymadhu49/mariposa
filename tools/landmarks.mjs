import { launch, openGame, scratch } from './lib.mjs';
const { browser, page, logs } = await launch({ width: 960, height: 540 });
await openGame(page);
await page.waitForTimeout(1500);
const hour = +(process.argv[2] || 11);
const only = process.argv[3] ? process.argv[3].split(',') : null;
const list = await page.evaluate(() => __g.world.landmarks.map((l) => ({ id: l.id, x: l.x, y: l.y, z: l.z, kind: l.kind })));
const dist = { heartbloom: 120, windmill: 42, lantern: 40, sundial: 44, pavilion: 42, glowcap: 55, maple: 100, falls: 90, summit: 40, moonwell: 34, lighthouse: 62, seaarch: 60 };
const files = [];
for (const l of list) {
  if (only && !only.includes(l.id)) continue;
  const d = dist[l.id] || 45;
  const ang = -0.6;
  const cx = l.x + Math.sin(ang) * d, cz = l.z + Math.cos(ang) * d;
  const yaw = Math.atan2(l.x - cx, l.z - cz) ;
  const alt = l.id === 'heartbloom' ? 22 : l.id === 'maple' ? 14 : 9;
  await page.evaluate(([cx, cz, alt, yaw, hour, id]) => {
    __g.debugPlay(cx, cz, alt, yaw + 0, hour);
    // face the landmark: camera yaw equals direction of travel
    __g.camRig.yaw = yaw; __g.camRig.pitch = id === 'heartbloom' ? 0.05 : -0.1;
    __g.advance(0.5, false); __g.advance(0.3);
  }, [cx, cz, alt, yaw, hour, l.id]);
  const f = `${scratch}/lm_${l.id}.png`;
  await page.screenshot({ path: f });
  files.push(f);
}
console.log(files.length, 'shots');
const seen = new Set();
for (const l of logs) { const k = l.slice(0, 240); if (seen.has(k)) continue; seen.add(k); if (!l.includes('prefill')) console.log('LOG', l.slice(0, 500)); }
await browser.close();
