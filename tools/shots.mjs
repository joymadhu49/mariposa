// Renders the README screenshots into assets/screenshots (1600 x 900 JPEG). Run from the repo root after a build.
import { launch, openGame, root } from './lib.mjs';
import path from 'node:path';
import fs from 'node:fs';
const out = path.join(root, 'assets/screenshots');
fs.mkdirSync(out, { recursive: true });
const { browser, page, logs } = await launch({ width: 1600, height: 900, pad: true });
await openGame(page, 'dist/mariposa.html');
await page.waitForTimeout(1500);
const snap = (name) => page.screenshot({ path: path.join(out, name + '.jpg'), type: 'jpeg', quality: 86 });
const adv = (s, r = false) => page.evaluate(([s, r]) => __g.advance(s, r), [s, r]);

// title screen, with the interface
await adv(4.5);
// a tap on L3 (no menu action) switches the prompts to controller glyphs
await page.evaluate(() => __pad.set('l3', 1));
await adv(0.2);
await page.evaluate(() => __pad.release('l3'));
await adv(0.6);
await page.evaluate(() => __g.advance(0.1, true));
await snap('title');
await page.addStyleTag({ content: '#ui { display: none !important; }' });

// scenic views without the interface
const scene = async (name, x, z, alt, yaw, hour, pitch = 0.0, mood = 'clear') => {
  await page.evaluate(([x, z, alt, yaw, hour, pitch, mood]) => {
    __g.debugPlay(x, z, alt, yaw, hour);
    __g.weather.locked = true; __g.weather.setMood(mood, true);
    __g.camRig.pitch = pitch;
    __g.advance(1.2, false); __g.advance(0.3);
  }, [x, z, alt, yaw, hour, pitch, mood]);
  await snap(name);
};
await scene('meadow', 40, 640, 5, Math.PI, 10.2, -0.02);
await scene('night', 40, 640, 6, Math.PI, 22, 0.02);
await scene('blossom', -700, 170, 8, 1.0, 17.6, -0.03);

// the falls with a rainbow in the spray: find a spot with the sun low behind the camera
const F = await page.evaluate(() => { const f = __g.world.falls, s = __g.spray; return { poolLevel: f.poolLevel, center: { x: s.center.x, y: s.center.y, z: s.center.z }, impact: s.impact }; });
await page.evaluate((F) => {
  const g = __g, w = g.world;
  g.debugPlay(F.impact.x + 60, F.impact.z + 30, 10, 0, 9);
  g.weather.locked = true; g.weather.setMood('clear', true);
  g.advance(0.8, false); g.update(0.01);
  let U = null; g.engine.scene.traverse((o) => { if (!U && o.material && o.material.uniforms && o.material.uniforms.uSunColor) U = o.material.uniforms; });
  const sun = U.uSunDirVis.value, M = F.center;
  let best = null;
  for (let a = 0; a < 360; a += 3) for (const R of [90, 130, 170]) {
    const x = M.x + Math.cos(a * Math.PI / 180) * R, z = M.z + Math.sin(a * Math.PI / 180) * R;
    const y = Math.max(w.heightAt(x, z), F.poolLevel) + 6;
    const dx = M.x - x, dy = M.y - y, dz = M.z - z, dl = Math.hypot(dx, dy, dz);
    const ang = Math.acos(Math.max(-1, Math.min(1, (dx * -sun.x + dy * -sun.y + dz * -sun.z) / dl))) * 180 / Math.PI;
    let clear = true;
    for (let s = 0.1; s < 0.95; s += 0.1) if (w.heightAt(x + dx * s, z + dz * s) > y + dy * s - 1) { clear = false; break; }
    if (clear && (!best || Math.abs(ang - 41) < best.err)) best = { x, y, z, err: Math.abs(ang - 41) };
  }
  const c = g.engine.camera;
  c.position.set(best.x, best.y, best.z); c.up.set(0, 1, 0);
  c.lookAt(M.x, F.poolLevel + 14, M.z);
  c.fov = 45; c.updateProjectionMatrix(); c.updateMatrixWorld(); c.matrixWorldInverse.copy(c.matrixWorld).invert();
  g.terrain.update(c);
  g.render(1 / 60);
}, F);
await snap('falls');

// the Heartbloom wakes
await page.evaluate(() => {
  __g.debugPlay(40, 640, 4, Math.PI, 17.8);
  const pr = __g.progress; pr.stats.pollinations = 40;
  for (const l of __g.world.landmarks) pr.discover(l.id);
  pr.stats.stars = 96;
  const h = __g.world.landmark('heartbloom');
  __g.player.teleport(h.x + 60, h.y + 28, h.z + 60, 0);
  __g.advance(0.4, false);
  __g.advance(5.2, false); __g.advance(0.05, true);
});
await snap('finale');

const bad = logs.filter((l) => /error|pageerror/i.test(l));
console.log(bad.length ? bad.slice(0, 5) : 'no console problems');
console.log(fs.readdirSync(out).map((f) => `${f} ${(fs.statSync(path.join(out, f)).size / 1024).toFixed(0)} KB`).join('\n'));
await browser.close();
