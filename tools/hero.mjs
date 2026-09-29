import { launch, openGame, scratch } from './lib.mjs';
const { browser, page, logs } = await launch({ width: 1200, height: 760 });
await openGame(page);
await page.waitForTimeout(1500);
const species = (process.argv[2] || '0,1,2,4').split(',').map(Number);
const hour = +(process.argv[3] || 11);
const shots = [];
const view = async (name, sp, cam, flap, yaw = 0, pitch = 0, roll = 0) => {
  await page.evaluate(([sp, cam, flap, yaw, pitch, roll, hour]) => {
    __g.debugPlay(40, 640, 3, 0, hour);
    __g.update(0.01);
    const g = __g.world.heightAt(40, 640) + 3.2;
    const cx = 40, cz = 640;
    const c = __g.engine.camera;
    c.position.set(cx + cam[0], g + cam[1], cz + cam[2]);
    c.up.set(0, 1, 0);
    c.lookAt(cx, g + 0.1, cz);
    c.fov = cam[3] || 40; c.updateProjectionMatrix();
    c.updateMatrixWorld(); c.matrixWorldInverse.copy(c.matrixWorld).invert();
    __g.terrain.update(c);
    __g.bf.begin();
    __g.bf.add(sp, cx, g, cz, 1.22, yaw, pitch, roll, flap, 0, 3.0, undefined);
    __g.bf.end();
    __g.render(1 / 60);
  }, [sp, cam, flap, yaw, pitch, roll, hour]);
  await page.screenshot({ path: `${scratch}/hero_${name}.png` });
  shots.push(`${scratch}/hero_${name}.png`);
};
for (const sp of species) {
  await view(`s${sp}_chaseUp`, sp, [0, 1.2, -3.6, 55], 1.0);
  await view(`s${sp}_chaseMid`, sp, [0, 1.2, -3.6, 55], 0.2);
  await view(`s${sp}_side`, sp, [3.0, 0.9, -1.2, 38], 0.75, 0, 0, 0.0);
  await view(`s${sp}_top`, sp, [0.01, 3.6, -0.6, 45], 0.05);
  await view(`s${sp}_front`, sp, [0.3, 0.8, 3.8, 40], 0.55, Math.PI);
}
console.log(shots.join('\n'));
await browser.close();
