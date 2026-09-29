import { launch, openGame, scratch } from './lib.mjs';
const { browser, page, logs } = await launch({ width: 1280, height: 720, pad: true });
await openGame(page);
await page.waitForTimeout(1500);
let fails = 0;
const ok = (name, cond, extra = '') => { console.log((cond ? 'PASS ' : 'FAIL ') + name + (extra ? '  ' + extra : '')); if (!cond) fails++; };
const adv = (s, r = false) => page.evaluate(([s, r]) => __g.advance(s, r), [s, r]);
const info = () => page.evaluate(() => __g.debugInfo());

// --- discovery
await page.evaluate(() => __g.debugPlay(40, 640, 4, Math.PI, 10));
const w = await page.evaluate(() => { const l = __g.world.landmark('windmill'); __g.player.teleport(l.x + 10, l.y + 8, l.z + 30, 0); return { x: l.x, z: l.z }; });
await adv(0.6);
let d = await page.evaluate(() => ({ found: !!__g.progress.discovered.windmill, count: __g.progress.discoveredCount, card: document.querySelector('#card .t').textContent }));
ok('windmill discovered by flying near', d.found && d.card === 'Windmill Hill', JSON.stringify(d));

// --- stars
const st0 = await page.evaluate(() => __g.progress.stats.stars);
await page.evaluate(() => { const s = __g.stars.list.find((x) => !__g.progress.starSet.has(x.id)); __g.player.teleport(s.x + 1.2, s.y, s.z, 0); });
await adv(0.5);
const st1 = await page.evaluate(() => __g.progress.stats.stars);
ok('collecting a dew star', st1 === st0 + 1, `${st0} to ${st1}`);

// --- unlocks
await page.evaluate(() => { const pr = __g.progress; pr.stats.pollinations = 40; for (const l of __g.world.landmarks) pr.discover(l.id); pr.stats.stars = 96; __g._unlockCheck(); });
const pct = await page.evaluate(() => __g.progress.bloomPercent());
ok('bloom reaches 100 percent', pct === 100, String(pct));
const unlocked = await page.evaluate(() => __g.progress.unlocked.slice());
ok('species unlocked by progress', unlocked.includes(1) && unlocked.includes(2) && unlocked.includes(3) && unlocked.includes(4), JSON.stringify(unlocked));

// --- finale
await page.evaluate(() => { const h = __g.world.landmark('heartbloom'); __g.player.teleport(h.x + 50, h.y + 25, h.z + 50, 0); });
await adv(0.5);
let s = await info();
ok('finale starts near the Heartbloom', s.state === 'finale', s.state);
await adv(5);
await page.screenshot({ path: `${scratch}/e2e_finale.png` });
await adv(11);
s = await info();
ok('finale returns control', s.state === 'play', s.state);
const fin = await page.evaluate(() => ({ finale: __g.progress.finale, aurora: __g.progress.unlocked.includes(5) }));
ok('aurora wings unlocked by the finale', fin.finale && fin.aurora, JSON.stringify(fin));

// --- save and continue
await page.evaluate(() => { __g.player.teleport(200, 40, 300, 1.0); __g.save(); });
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__g && window.__g.ready, null, { timeout: 120000 });
await page.waitForTimeout(1200);
const cont = await page.evaluate(() => ({ has: __g.progress.hasSave, label: document.querySelector('#titleMenu li .lab').textContent, disc: __g.progress.discoveredCount, blooms: __g.scatter.bloomList.length }));
ok('title offers Continue after a save', cont.has && cont.label === 'Continue', JSON.stringify(cont));
await page.evaluate(() => { __g.ui.title.menu.focus = 0; __g.beginPlay(true); });
await page.waitForTimeout(1200);
await adv(0.5);
s = await info();
ok('continue restores position', s.state === 'play' && Math.abs(s.x - 200) < 5 && Math.abs(s.z - 300) < 5, JSON.stringify(s));
const restored = await page.evaluate(() => ({ disc: __g.progress.discoveredCount, stars: __g.progress.stats.stars, finale: __g.progress.finale }));
ok('continue restores progress', restored.disc === 12 && restored.stars === 96 && restored.finale, JSON.stringify(restored));

const seen = new Set();
for (const l of logs) { const k = l.slice(0, 240); if (seen.has(k)) continue; seen.add(k); if (!l.includes('prefill')) console.log('LOG', l.slice(0, 500)); }
console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED');
await browser.close();
