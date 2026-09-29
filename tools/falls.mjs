// Skyreach Falls from several angles, including a spot where the sun is behind you and the spray shows a rainbow.
import { launch, openGame, scratch } from './lib.mjs';
const { browser, page, logs } = await launch({ width: 1280, height: 720 });
await openGame(page, 'dist/mariposa.html');
await page.waitForTimeout(1200);
await page.addStyleTag({ content: '#ui, #hud, .hud, #screens, #card { display: none !important; }' });
const F = await page.evaluate(() => { const f = __g.world.falls, s = __g.spray; return { top: f.top, base: f.base, dir: f.dir, len: f.len, poolLevel: f.poolLevel, impact: s.impact, center: { x: s.center.x, y: s.center.y, z: s.center.z } }; });
console.log(JSON.stringify(F.impact), JSON.stringify(F.center));
async function shoot(name, hour, mode, opts = {}) {
  const r = await page.evaluate(([F, hour, mode, opts]) => {
    const g = __g, w = g.world;
    g.debugPlay(F.impact.x + F.dir.x * 40, F.impact.z + F.dir.z * 40, 8, 0, hour);
    g.weather.locked = true; g.weather.setMood('clear', true);
    g.advance(0.8, false); g.update(0.01);
    let U = null; g.engine.scene.traverse((o) => { if (!U && o.material && o.material.uniforms && o.material.uniforms.uSunColor) U = o.material.uniforms; });
    const sun = U.uSunDirVis.value.clone();
    const M = F.center;
    let cam;
    if (mode === 'bow') {
      // find a spot on a ring around the mist where the bow (42 degrees from the antisolar point) crosses it
      let best = null;
      for (let a = 0; a < 360; a += 3) for (const R of [90, 130, 170]) {
        const x = M.x + Math.cos(a * Math.PI / 180) * R, z = M.z + Math.sin(a * Math.PI / 180) * R;
        const y = Math.max(w.heightAt(x, z), F.poolLevel) + 6;
        const dx = M.x - x, dy = M.y - y, dz = M.z - z, dl = Math.hypot(dx, dy, dz);
        const cosA = (dx * -sun.x + dy * -sun.y + dz * -sun.z) / dl;
        const ang = Math.acos(Math.max(-1, Math.min(1, cosA))) * 180 / Math.PI;
        const err = Math.abs(ang - 41);
        // line of sight must clear the terrain
        let clear = true;
        for (let s = 0.1; s < 0.95; s += 0.1) { const px = x + dx * s, pz = z + dz * s, py = y + dy * s; if (w.heightAt(px, pz) > py - 1) { clear = false; break; } }
        if (clear && (!best || err < best.err)) best = { x, y, z, err, ang };
      }
      cam = best;
    } else if (mode === 'front') cam = { x: F.impact.x + F.dir.x * 75, y: F.poolLevel + 12, z: F.impact.z + F.dir.z * 75 };
    else if (mode === 'near') cam = { x: F.impact.x + F.dir.x * 34, y: F.poolLevel + 5, z: F.impact.z + F.dir.z * 34 + 6 };
    else cam = { x: F.impact.x + F.dir.x * 60 + (-F.dir.z) * 60, y: F.poolLevel + 22, z: F.impact.z + F.dir.z * 60 + F.dir.x * 60 };
    if (!cam) return { error: 'no camera spot' };
    const c = g.engine.camera;
    c.position.set(cam.x, cam.y, cam.z); c.up.set(0, 1, 0);
    const look = opts.look || { x: (F.top.x + F.base.x) / 2 * 0.3 + F.impact.x * 0.7, y: F.poolLevel + 14, z: (F.top.z + F.base.z) / 2 * 0.3 + F.impact.z * 0.7 };
    c.lookAt(look.x, look.y, look.z);
    c.fov = opts.fov || 55; c.updateProjectionMatrix(); c.updateMatrixWorld(); c.matrixWorldInverse.copy(c.matrixWorld).invert();
    g.terrain.update(c);
    g.render(1 / 60);
    return { cam: [Math.round(cam.x), Math.round(cam.y), Math.round(cam.z)], ang: cam.ang && +cam.ang.toFixed(1), sun: [sun.x, sun.y, sun.z].map((v) => +v.toFixed(2)) };
  }, [F, hour, mode, opts]);
  await page.screenshot({ path: `${scratch}/falls_${name}.png` });
  console.log(name, JSON.stringify(r));
}
await shoot('front', 11, 'front');
await shoot('near', 11, 'near', { fov: 70 });
await shoot('side', 14, 'side');
await shoot('bow_am', 9, 'bow', { fov: 45 });
await shoot('bow_pm', 16.5, 'bow', { fov: 45 });
await shoot('dusk', 17.8, 'front');
const seen = new Set();
for (const l of logs) { const k = l.slice(0, 200); if (seen.has(k)) continue; seen.add(k); if (!l.includes('prefill')) console.log(l.slice(0, 400)); }
await browser.close();
