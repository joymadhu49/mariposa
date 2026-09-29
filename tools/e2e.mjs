import { launch, openGame, scratch } from './lib.mjs';
const { browser, page, logs } = await launch({ width: 1280, height: 720, pad: true });
await openGame(page);
await page.waitForTimeout(1500);
let fails = 0;
const ok = (name, cond, extra = '') => { console.log((cond ? 'PASS ' : 'FAIL ') + name + (extra ? '  ' + extra : '')); if (!cond) fails++; };
const adv = (s) => page.evaluate((s) => __g.advance(s, false), s);
const info = () => page.evaluate(() => __g.debugInfo());
const press = async (b, hold = 0.12) => { await page.evaluate((b) => __pad.set(b, 1), b); await adv(hold); await page.evaluate((b) => __pad.release(b), b); await adv(0.1); };

// --- title
let s = await info();
ok('boots to title', s.state === 'title');
await adv(0.6);
await press('cross');
await page.waitForTimeout(1200);
await adv(0.5);
s = await info();
ok('cross begins play', s.state === 'play', JSON.stringify(s));

// --- flight
await page.evaluate(() => __g.debugPlay(40, 640, 4, Math.PI, 10));
const p0 = await info();
await page.evaluate(() => __pad.axes(0, -1, 0, 0));
await adv(2);
const p1 = await info();
ok('left stick flies forward', Math.hypot(p1.x - p0.x, p1.z - p0.z) > 10, `moved ${Math.hypot(p1.x - p0.x, p1.z - p0.z).toFixed(1)}m hs=${p1.hs}`);
await page.evaluate(() => __pad.set('r2', 1));
await adv(1.5);
const p2 = await info();
ok('R2 boost is faster', p2.hs > p1.hs * 1.8, `hs ${p1.hs} to ${p2.hs}, energy ${p2.energy}`);
ok('boost drains energy', p2.energy < 0.95);
await page.evaluate(() => { __pad.release('r2'); __pad.axes(0, 0, 0, 0); __pad.set('cross', 1); });
await adv(1.2);
const p3 = await info();
ok('cross climbs', p3.y > p2.y + 3, `y ${p2.y} to ${p3.y}`);
await page.evaluate(() => { __pad.release('cross'); __pad.set('l2', 1); });
await adv(1.2);
const p4 = await info();
ok('L2 dives', p4.y < p3.y - 3, `y ${p3.y} to ${p4.y}`);
await page.evaluate(() => { __pad.release('l2'); });
await adv(1);

// --- rumble was used
const rumbles = await page.evaluate(() => window.__rumbles.length);
ok('haptics fired', rumbles > 0, `${rumbles} effects`);

// --- camera control
const cy0 = (await info()).camYaw;
await page.evaluate(() => __pad.axes(0, 0, 1, 0));
await adv(0.6);
const cy1 = (await info()).camYaw;
ok('right stick turns camera', Math.abs(cy1 - cy0) > 0.5, `${cy0} to ${cy1}`);
await page.evaluate(() => __pad.axes(0, 0, 0, 0));

// --- sipping and pollination: find two different species close to each other
const setup = await page.evaluate(() => {
  __g.debugPlay(40, 640, 4, Math.PI, 10);
  const g = __g;
  g.scatter.prefill(g.player.pos);
  const refs = g.scatter.queryFlowers(40, 640, 40, []);
  const bySp = {};
  for (const r of refs) (bySp[r.species] ||= []).push(r);
  const kinds = Object.keys(bySp).filter((k) => bySp[k].length);
  return { kinds: kinds.length, n: refs.length };
});
ok('flowers exist around the meadow', setup.n > 50 && setup.kinds >= 3, JSON.stringify(setup));
async function sipOne(pick) {
  const target = await page.evaluate((pick) => {
    const g = __g;
    const refs = g.scatter.queryFlowers(g.player.pos.x, g.player.pos.z, 40, []).filter((r) => r.state < 0.5 && g.player.isOpen(r, { night: 0, rain: 0 }));
    const ref = pick(refs);
    return ref ? { x: ref.x, z: ref.z, species: ref.species } : null;
  }, null);
  return target;
}
// choose first flower, teleport just above, start perch
const t1 = await page.evaluate(() => {
  const g = __g;
  const refs = g.scatter.queryFlowers(g.player.pos.x, g.player.pos.z, 40, []).filter((r) => r.state < 0.5);
  const r = refs[0];
  const head = g.scatter.headPosition(r, new g.player.pos.constructor());
  g.player.teleport(head.x - 1.2, head.y + 0.8, head.z, 0);
  g.player.mode = 'fly';
  g.advance(0.4, false);
  return { species: r.species, x: r.x, z: r.z, focus: g.player.focus ? g.player.focus.species : null };
});
ok('focus finds a nearby flower', t1.focus !== null, JSON.stringify(t1));
await page.evaluate(() => __pad.set('circle', 1));
await adv(0.3);
let m = await info();
ok('circle starts approach', m.mode === 'approach' || m.mode === 'perch', m.mode);
let sawMeter = false, maxMeter = 0;
for (let i = 0; i < 12; i++) {
  await adv(0.25, true);
  const mm = await page.evaluate(() => { const el = document.querySelector('#prompt .meter i'); return { disp: getComputedStyle(el.parentElement).display, tr: getComputedStyle(el).transform }; });
  if (mm.disp !== 'none') { sawMeter = true; if (mm.tr.startsWith('matrix')) maxMeter = Math.max(maxMeter, parseFloat(mm.tr.slice(mm.tr.indexOf('(') + 1))); }
}
ok('sip meter fills through transform', sawMeter && maxMeter > 0.3, `max scaleX ${maxMeter.toFixed(2)}`);
m = await info();
ok('perched and sipped', m.sips >= 1 || m.mode === 'perch', JSON.stringify(m));
await adv(1.5);
m = await info();
ok('sip counted', m.sips >= 1, `sips ${m.sips} pollen ${m.pollen}`);
await page.evaluate(() => __pad.release('circle'));
await adv(0.8);
m = await info();
ok('takes off after release', m.mode === 'takeoff' || m.mode === 'fly', m.mode);

// second flower of a different species => pollination
const pol0 = await page.evaluate(() => __g.progress.stats.pollinations);
const t2 = await page.evaluate((sp0) => {
  const g = __g;
  const refs = g.scatter.queryFlowers(g.player.pos.x, g.player.pos.z, 60, []).filter((r) => r.state < 0.5 && r.species !== sp0);
  const r = refs[0];
  const head = g.scatter.headPosition(r, new g.player.pos.constructor());
  g.player.teleport(head.x - 1.2, head.y + 0.8, head.z, 0);
  g.player.mode = 'fly';
  g.advance(0.4, false);
  return { species: r.species, focus: g.player.focus ? g.player.focus.species : null };
}, t1.species);
await page.evaluate(() => __pad.set('circle', 1));
await adv(5.5);
await page.evaluate(() => __pad.release('circle'));
await adv(0.8);
const pol1 = await page.evaluate(() => __g.progress.stats.pollinations);
ok('pollination increments', pol1 === pol0 + 1, `pollinations ${pol0} to ${pol1}`);
const blooms = await page.evaluate(() => __g.scatter.bloomList.length);
ok('bloom flowers were created', blooms >= 5, `${blooms}`);
await page.screenshot({ path: `${scratch}/e2e_pollinate.png` });

// --- pulse
const pc0 = await page.evaluate(() => __g.pulseCount);
await press('square', 0.15);
const pc1 = await page.evaluate(() => __g.pulseCount);
ok('square pulses', pc1 === pc0 + 1);

// --- map
await press('create', 0.15);
await adv(0.5);
s = await info();
const mapOpen = await page.evaluate(() => !!document.querySelector('#mapcanvas'));
ok('create opens the map', s.state === 'pause' && mapOpen, s.state);
await adv(0.3);
await press('circle', 0.15);
await adv(0.4);
s = await info();
ok('circle closes the map', s.state === 'play', s.state);

// --- pause menu and journal via menu
await press('options', 0.15);
await adv(0.5);
s = await info();
ok('options pauses', s.state === 'pause');
await adv(0.3);
await press('down', 0.1);
await press('cross', 0.1);
await adv(0.5);
const jr = await page.evaluate(() => !!document.querySelector('.journal'));
ok('menu navigation reaches the journal', jr);
await press('circle', 0.12);
await adv(0.4);
await press('options', 0.12);
await adv(0.5);
s = await info();
ok('options resumes', s.state === 'play', s.state);

// --- photo mode
await press('triangle', 0.15);
await adv(0.5);
s = await info();
ok('triangle enters photo mode', s.state === 'photo', s.state);
await adv(0.5);
await press('circle', 0.15);
await adv(0.4);
s = await info();
ok('circle exits photo mode', s.state === 'play', s.state);

// --- controller disconnect pauses
await page.evaluate(() => __pad.enable(false));
await adv(0.5);
s = await info();
ok('disconnect pauses the game', s.state === 'pause', s.state);
await page.evaluate(() => __pad.enable(true));
await adv(0.5);

// --- tutorial hint hooks and save
const saved = await page.evaluate(() => { __g.save(); return !!localStorage.getItem('mariposa.save.v1'); });
ok('progress saved', saved);

const seen = new Set();
for (const l of logs) { const k = l.slice(0, 240); if (seen.has(k)) continue; seen.add(k); if (!l.includes('prefill')) console.log('LOG', l.slice(0, 500)); }
console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED');
await browser.close();
