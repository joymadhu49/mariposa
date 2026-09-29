// Long session soak test: fly around the island for many simulated minutes and watch for leaks or slowdowns.
import { launch, openGame, scratch } from './lib.mjs';
const minutes = +(process.argv[2] || 12);
const { browser, page, logs } = await launch({ width: 1280, height: 720, pad: true });
await openGame(page, 'dist/mariposa.html');
await page.waitForTimeout(1200);
await page.evaluate(() => { __g.debugPlay(40, 640, 8, Math.PI, 9); __g.settings.timeScale = 3; });
const sample = () => page.evaluate(() => {
  const r = __g.engine.renderer;
  const t0 = performance.now();
  __g.advance(1, true);
  const ms = performance.now() - t0;
  const p = __g.player.pos;
  return {
    heapMB: performance.memory ? +(performance.memory.usedJSHeapSize / 1048576).toFixed(1) : -1,
    geos: r.info.memory.geometries, texs: r.info.memory.textures, progs: r.info.programs ? r.info.programs.length : -1,
    dom: document.getElementsByTagName('*').length,
    sec1ms: +ms.toFixed(0),
    x: Math.round(p.x), y: Math.round(p.y), z: Math.round(p.z), hour: +__g.hour.toFixed(1), state: __g.state, biome: __g.currentBiome,
  };
});
const rows = [];
let steer = 0;
for (let s = 0; s < minutes * 60; s += 15) {
  // wander: gentle sinusoidal steering, boost bursts, occasional climb, sips near flowers
  await page.evaluate(([s]) => {
    const st = Math.sin(s * 0.13) * 0.8;
    __pad.axes(st, -1, Math.sin(s * 0.05) * 0.2, 0);
    if (Math.floor(s / 45) % 3 === 0) __pad.set('r2', 1); else __pad.release('r2');
    if (Math.floor(s / 30) % 4 === 1) __pad.set('cross', 1); else __pad.release('cross');
    if (Math.floor(s / 30) % 4 === 3) __pad.set('l2', 1); else __pad.release('l2');
    if (s % 60 === 0) __pad.set('square', 1); else __pad.release('square');
  }, [s]);
  await page.evaluate(() => __g.advance(14, false));
  const row = await sample();
  rows.push({ t: s + 15, ...row });
  if ((s / 15) % 4 === 0) console.log(JSON.stringify({ t: s + 15, ...row }));
}
await page.screenshot({ path: `${scratch}/soak_end.png` });
const first = rows[1], last = rows[rows.length - 1];
console.log('heap', first.heapMB, '->', last.heapMB, 'MB; geos', first.geos, '->', last.geos, '; texs', first.texs, '->', last.texs, '; dom', first.dom, '->', last.dom, '; frame(1s render) ms', first.sec1ms, '->', last.sec1ms);
const bad = logs.filter((l) => /error|warn|nan|invalid/i.test(l) && !l.includes('prefill'));
console.log('console problems:', bad.length ? bad.slice(0, 8) : 'none');
await browser.close();
