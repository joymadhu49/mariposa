// Damaged or odd save data must never break the game.
import { launch, openGame } from './lib.mjs';
const KEY = process.argv[2] || 'mariposa.save.v1';
const cases = {
  garbage: 'this is not json {{{',
  wrongTypes: JSON.stringify({ version: 1, discovered: 5, unlocked: 'x', stats: null, tasted: [], settings: 3, pos: { x: 'a', y: 1, z: 2 }, time: { hour: 'zz', day: null }, blooms: [1, null, { x: 1 }], stars: 'abc', species: 44 }),
  farAway: JSON.stringify({ version: 1, pos: { x: 1e9, y: 1e9, z: -1e9, yaw: 1 }, discovered: { windmill: 1 }, unlocked: [0, 1], species: 1 }),
  badFog: JSON.stringify({ version: 1, discovered: { windmill: 1, heartbloom: 1 }, fog: '***not base64***', unlocked: [0, 3, 4] }),
  oldVersion: JSON.stringify({ version: 0, discovered: { windmill: 1 } }),
};
let fails = 0;
for (const [name, value] of Object.entries(cases)) {
  const { browser, page, logs } = await launch({ width: 1000, height: 600, pad: true });
  await page.addInitScript(([k, v]) => { try { localStorage.setItem(k, v); } catch (e) { /* ignore */ } }, [KEY, value]);
  let msg = '';
  try {
    await openGame(page, 'dist/mariposa.html', 60000);
    await page.waitForTimeout(600);
    const before = await page.evaluate(() => ({ state: __g.state, hasSave: __g.progress.hasSave, disc: __g.progress.discoveredCount, unlocked: __g.progress.unlocked.slice(), species: __g.progress.data.species }));
    await page.evaluate(() => { __g.ui.title.open && 0; __g.beginPlay(__g.progress.hasSave); });
    await page.waitForTimeout(1400);
    const after = await page.evaluate(() => { __g.advance(1.5, false); __g.advance(0.2); const p = __g.player.pos; return { state: __g.state, finite: Number.isFinite(p.x + p.y + p.z), y: +p.y.toFixed(1), x: Math.round(p.x), z: Math.round(p.z), hour: +__g.hour.toFixed(1) }; });
    const errs = logs.filter((l) => /pageerror|error/i.test(l));
    const ok = after.state === 'play' && after.finite && Number.isFinite(after.hour) && errs.length === 0;
    if (!ok) fails++;
    msg = `${ok ? 'PASS' : 'FAIL'} ${name}  before=${JSON.stringify(before)} after=${JSON.stringify(after)}${errs.length ? ' errors=' + errs.slice(0, 3).join(' | ') : ''}`;
  } catch (e) { fails++; msg = `FAIL ${name}  ${e.message.split('\n')[0]}  logs=${logs.slice(0, 3).join(' | ')}`; }
  console.log(msg);
  await browser.close();
}
console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
process.exit(fails ? 1 : 0);
