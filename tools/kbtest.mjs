// Keyboard + mouse only play test (no gamepad present).
import { launch, openGame, scratch } from './lib.mjs';
const file = process.argv[2] || 'dist/mariposa.html';
const { browser, page, logs } = await launch({ width: 1280, height: 720 });
await openGame(page, file);
await page.waitForTimeout(1200);
let fails = 0;
const ok = (name, cond, extra = '') => { console.log((cond ? 'PASS ' : 'FAIL ') + name + (extra ? '  ' + extra : '')); if (!cond) fails++; };
const adv = (s) => page.evaluate((s) => __g.advance(s, false), s);
const info = () => page.evaluate(() => __g.debugInfo());
const tap = async (code, hold = 0.12) => { await page.keyboard.down(code); await adv(hold); await page.keyboard.up(code); await adv(0.1); };

let s = await info();
ok('boots to title', s.state === 'title');
await adv(0.6);
await page.screenshot({ path: `${scratch}/kb_title.png` });
await tap('Enter');
await page.waitForTimeout(1200);
await adv(0.5);
s = await info();
ok('Enter begins play', s.state === 'play', JSON.stringify(s));
ok('device is keyboard', s.dev === 'keyboard');

await page.evaluate(() => __g.debugPlay(40, 640, 4, Math.PI, 10));
const p0 = await info();
await page.keyboard.down('KeyW');
await adv(2);
const p1 = await info();
ok('W flies forward', Math.hypot(p1.x - p0.x, p1.z - p0.z) > 10, `moved ${Math.hypot(p1.x - p0.x, p1.z - p0.z).toFixed(1)}m hs=${p1.hs}`);
await page.keyboard.down('ShiftLeft');
await adv(1.5);
const p2 = await info();
ok('Shift boosts', p2.hs > p1.hs * 1.8, `hs ${p1.hs} to ${p2.hs}`);
await page.keyboard.up('ShiftLeft');
await page.keyboard.up('KeyW');
await page.keyboard.down('Space');
await adv(1.2);
const p3 = await info();
ok('Space climbs', p3.y > p2.y + 3, `y ${p2.y} to ${p3.y}`);
await page.keyboard.up('Space');
await page.keyboard.down('KeyC');
await adv(1.2);
const p4 = await info();
ok('C dives', p4.y < p3.y - 3, `y ${p3.y} to ${p4.y}`);
await page.keyboard.up('KeyC');
await adv(0.6);

// strafing turns the butterfly with the camera
const yaw0 = (await info()).yaw;
await page.keyboard.down('KeyW');
await page.keyboard.down('KeyA');
await adv(1.2);
const yaw1 = (await info()).yaw;
ok('W+A banks left', Math.abs(yaw1 - yaw0) > 0.3, `yaw ${yaw0} to ${yaw1}`);
await page.keyboard.up('KeyA');
await page.keyboard.up('KeyW');

// camera via arrow keys
const cy0 = (await info()).camYaw;
await page.keyboard.down('ArrowRight');
await adv(0.6);
await page.keyboard.up('ArrowRight');
const cy1 = (await info()).camYaw;
ok('arrow keys turn camera', Math.abs(cy1 - cy0) > 0.5, `${cy0} to ${cy1}`);

// camera via mouse deltas (pointer lock is not available headless, so feed movement directly)
const cm0 = (await info()).camYaw;
await page.evaluate(() => { __g.input.mouse.locked = true; __g.input.mouse.dx += 260; });
await adv(0.1);
const cm1 = (await info()).camYaw;
ok('mouse look turns camera', Math.abs(cm1 - cm0) > 0.3, `${cm0} to ${cm1}`);
await page.evaluate(() => { __g.input.mouse.locked = false; });

// the browser releasing pointer lock (Esc while locked) pauses the game
await page.evaluate(() => {
  let el = document.getElementById('gl');
  Object.defineProperty(document, 'pointerLockElement', { configurable: true, get: () => el });
  document.dispatchEvent(new Event('pointerlockchange'));
  window.__setLock = (v) => { el = v ? document.getElementById('gl') : null; document.dispatchEvent(new Event('pointerlockchange')); };
});
await adv(0.1);
ok('pointer lock registered', await page.evaluate(() => __g.input.mouse.locked === true));
await page.evaluate(() => window.__setLock(false));
await adv(0.3);
s = await info(); ok('losing pointer lock pauses', s.state === 'pause', s.state);
await tap('Escape'); await adv(0.6);
s = await info(); ok('Esc resumes from lock pause', s.state === 'play', s.state);

// prompts and glyphs use keyboard labels
await page.evaluate(() => __g.debugPlay(40, 640, 4, Math.PI, 10));
await adv(0.6);
await page.screenshot({ path: `${scratch}/kb_play.png` });
const hint = await page.evaluate(() => document.querySelector('#hint')?.innerText || '');
console.log('hint text:', JSON.stringify(hint));

// screens
await tap('KeyM'); await adv(0.6);
s = await info(); ok('M opens map', s.state === 'pause' || s.screen === 'map' || s.state !== 'play', JSON.stringify(s));
await page.screenshot({ path: `${scratch}/kb_map.png` });
await tap('Escape'); await adv(0.6);
s = await info(); ok('Esc closes map', s.state === 'play', JSON.stringify(s));
await tap('KeyJ'); await adv(0.6);
s = await info(); ok('J opens journal', s.state !== 'play', JSON.stringify(s));
await tap('Escape'); await adv(0.6);
await tap('Escape'); await adv(0.6);
s = await info(); ok('Esc opens pause', s.state === 'pause', JSON.stringify(s));
await page.screenshot({ path: `${scratch}/kb_pause.png` });
await tap('ArrowDown'); await tap('ArrowUp'); await tap('Enter'); await adv(0.6);
s = await info(); ok('Enter resumes', s.state === 'play', JSON.stringify(s));

// photo mode
await tap('KeyP'); await adv(0.8);
s = await info(); ok('P enters photo mode', s.state === 'photo', JSON.stringify(s));
await tap('Escape'); await adv(0.8);
s = await info(); ok('Esc leaves photo mode', s.state === 'play', JSON.stringify(s));

const errs = logs.filter((l) => /error|warn/i.test(l));
console.log('console problems:', errs.length ? errs.slice(0, 10) : 'none');
console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
await browser.close();
process.exit(fails ? 1 : 0);
