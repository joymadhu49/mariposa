// Photo mode: every filter must produce a real PNG download of a sensible size.
import { launch, openGame, scratch } from './lib.mjs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
const { browser, context, page, logs } = await launch({ width: 1280, height: 720, dpr: 2, pad: true });
await openGame(page, 'dist/mariposa.html');
await page.waitForTimeout(800);
let fails = 0;
const ok = (name, cond, extra = '') => { console.log((cond ? 'PASS ' : 'FAIL ') + name + (extra ? '  ' + extra : '')); if (!cond) fails++; };
const adv = (s, r = false) => page.evaluate(([s, r]) => __g.advance(s, r), [s, r]);
const press = async (b, hold = 0.12) => { await page.evaluate((b) => __pad.set(b, 1), b); await adv(hold); await page.evaluate((b) => __pad.release(b), b); await adv(0.12); };
await page.evaluate(() => __g.debugPlay(40, 640, 5, Math.PI, 10.5));
await adv(0.5);
const normal = await page.evaluate(() => __g.engine._lastRes);
await press('triangle');
await adv(0.6);
const photoRes = await page.evaluate(() => ({ state: __g.state, res: __g.engine._lastRes }));
ok('triangle enters photo mode', photoRes.state === 'photo', JSON.stringify(photoRes));
console.log('resolution normal', normal, 'photo', photoRes.res);
const names = await page.evaluate(() => (window.__filters = null, 1));
for (let i = 0; i < 6; i++) {
  const fname = await page.evaluate(() => `${__g.filterIdx}`);
  const dl = page.waitForEvent('download', { timeout: 8000 }).catch(() => null);
  await page.evaluate(() => __pad.set('cross', 1));
  await adv(0.12, true);
  await page.evaluate(() => __pad.release('cross'));
  await adv(0.2, true);
  const d = await dl;
  if (!d) { ok(`filter ${fname} downloads a photo`, false, 'no download event'); }
  else {
    const file = path.join(scratch, `photo_${fname}.png`);
    await d.saveAs(file);
    const out = execFileSync('magick', ['identify', '-format', '%w %h %[fx:mean] %[fx:standard_deviation]', file]).toString().split(' ').map(Number);
    ok(`filter ${fname} photo is a real image`, out[0] > 1000 && out[1] > 600 && out[2] > 0.04 && out[2] < 0.97 && out[3] > 0.03, `${out[0]}x${out[1]} mean=${out[2].toFixed(3)} sd=${out[3].toFixed(3)} (${d.suggestedFilename()})`);
  }
  await press('r1');
}
await press('circle');
await adv(0.6);
const after = await page.evaluate(() => ({ state: __g.state, res: __g.engine._lastRes }));
ok('circle exits photo mode', after.state === 'play', JSON.stringify(after));
ok('resolution restored after photo mode', after.res === normal, `${after.res} vs ${normal}`);
const errs = logs.filter((l) => /error|pageerror/i.test(l));
console.log('console problems:', errs.length ? errs.slice(0, 5) : 'none');
console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
await browser.close();
process.exit(fails ? 1 : 0);
