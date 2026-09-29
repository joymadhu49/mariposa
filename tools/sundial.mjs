// The sundial shadow must track the sun through the day.
import { launch, openGame, scratch } from './lib.mjs';
const { browser, page, logs } = await launch({ width: 960, height: 540 });
await openGame(page, 'dist/mariposa.html');
await page.waitForTimeout(1200);
await page.addStyleTag({ content: '#ui, #hud, .hud, #screens, #card { display: none !important; }' });
const lm = await page.evaluate(() => { const l = __g.world.landmark('sundial'); return { x: l.x, y: l.y, z: l.z }; });
console.log(JSON.stringify(lm));
const top = process.argv[3] === 'top';
const hours = (process.argv[2] || '7.5,9,10.5,12,13.5,15,16.5').split(',').map(Number);
for (const h of hours) {
  const info = await page.evaluate(([lm, h, cam]) => {
    __g.debugPlay(lm.x, lm.z + 16, 6, Math.PI, h);
    __g.weather.locked = true; __g.weather.setMood('clear', true);
    __g.advance(0.6, false); __g.update(0.01);
    const c = __g.engine.camera;
    c.position.set(lm.x + cam[0], lm.y + cam[1], lm.z + cam[2]);
    c.up.set(cam[3] || 0, cam[3] ? 0 : 1, cam[3] ? -1 : 0);
    c.lookAt(lm.x, lm.y + 0.6, lm.z);
    c.fov = 48; c.updateProjectionMatrix(); c.updateMatrixWorld(); c.matrixWorldInverse.copy(c.matrixWorld).invert();
    __g.terrain.update(c);
    __g.render(1 / 60);
    let U = null; __g.engine.scene.traverse((o) => { if (!U && o.material && o.material.uniforms && o.material.uniforms.uSunColor) U = o.material.uniforms; });
    const s = U.uSunDirVis.value;
    return { sun: [+s.x.toFixed(2), +s.y.toFixed(2), +s.z.toFixed(2)] };
  }, [lm, h, top ? [0.001, 9, 0.001, 1] : [3, 8.5, -8]]);
  await page.screenshot({ path: `${scratch}/sundial${top ? '_top' : ''}_${String(h).replace('.', '_')}.png` });
  console.log(h, JSON.stringify(info));
}
const seen = new Set();
for (const l of logs) { const k = l.slice(0, 200); if (seen.has(k)) continue; seen.add(k); if (!l.includes('prefill')) console.log(l.slice(0, 400)); }
await browser.close();
