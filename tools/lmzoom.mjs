import { launch, openGame, scratch } from './lib.mjs';
const { browser, page, logs } = await launch({ width: 960, height: 540 });
await openGame(page);
await page.waitForTimeout(1500);
const shots = JSON.parse(process.argv[2]);
const files = [];
for (const [name, id, dx, dy, dz, lookDy, fov = 55, hour = 11] of shots) {
  await page.evaluate(([id, dx, dy, dz, lookDy, fov, hour]) => {
    const l = __g.world.landmark(id);
    __g.debugPlay(l.x + dx, l.z + dz, 3, 0, hour);
    __g.update(0.01);
    const c = __g.engine.camera;
    c.position.set(l.x + dx, l.y + dy, l.z + dz);
    c.up.set(0, 1, 0);
    c.lookAt(l.x, l.y + lookDy, l.z);
    c.fov = fov; c.updateProjectionMatrix();
    c.updateMatrixWorld(); c.matrixWorldInverse.copy(c.matrixWorld).invert();
    __g.terrain.update(c); __g.scatter.prefill(c.position); __g.trees.force = true; __g.trees.update(c.position);
    __g.bf.begin(); __g.bf.end();
    __g.ui.hudVisible(false);
    __g.render(1 / 60);
  }, [id, dx, dy, dz, lookDy, fov, hour]);
  const f = `${scratch}/lz_${name}.png`;
  await page.screenshot({ path: f });
  files.push(f);
}
console.log(files.join(' '));
await browser.close();
