import { launch, openGame } from './lib.mjs';
const { browser, page, logs } = await launch({ width: 1440, height: 810, pad: true });
await openGame(page);
await page.waitForTimeout(1500);
const bad = /[-‐-―−]|\p{Extended_Pictographic}/u;
const seenAll = new Set();
const check = async (label) => {
  const texts = await page.evaluate(() => {
    const out = [];
    const walker = document.createTreeWalker(document.getElementById('ui'), NodeFilter.SHOW_TEXT);
    let n;
    while ((n = walker.nextNode())) { const t = n.textContent.trim(); if (t) { const el = n.parentElement; const st = el && getComputedStyle(el); if (st && st.display !== 'none' && st.visibility !== 'hidden') out.push(t); } }
    return out;
  });
  const hits = texts.filter((t) => bad.test(t));
  for (const t of texts) seenAll.add(t);
  console.log(label.padEnd(12), texts.length, 'strings', hits.length ? 'BAD ' + JSON.stringify(hits) : 'ok');
};
await check('title');
await page.evaluate(() => __g.debugPlay(40, 640, 4, Math.PI, 10));
await page.evaluate(() => { const ui = __g.ui; ui.toast('Pollinated. Poppy and Daisy bloom together', 'bloom'); ui.card('Discovered', 'Lighthouse Point', 'A red and white tower guides sleepy travellers home.'); __g.advance(0.5, false); });
await check('hud');
await page.evaluate(() => { __g.progress.discover('windmill'); __g.ui.hint((f) => '', 'Fly close to a flower and hold to sip nectar', 5000); __g.advance(0.3, false); });
await check('hud2');
for (const [name, fn] of [
  ['pause', () => __g.pause()],
  ['settings', () => __g.ui.open('settings', { from: 'pause' })],
  ['controls', () => { __g.ui.closeAll(); __g.ui.open('controls'); }],
  ['journal0', () => { __g.ui.closeAll(); __g.ui.journalTab = 0; __g.ui.open('journal'); }],
  ['journal1', () => { __g.ui.closeAll(); __g.ui.journalTab = 1; __g.ui.open('journal'); }],
  ['journal2', () => { __g.ui.closeAll(); __g.ui.journalTab = 2; __g.ui.open('journal'); }],
  ['journal3', () => { __g.ui.closeAll(); __g.ui.journalTab = 3; __g.ui.open('journal'); }],
  ['map', () => { __g.ui.closeAll(); __g.ui.open('map'); }],
]) {
  await page.evaluate(fn);
  await page.evaluate(() => __g.advance(0.5, false));
  await check(name);
}
await page.evaluate(() => { __g.ui.closeAll(); __g.state = 'play'; __g.enterPhoto(); __g.advance(0.4, false); });
await check('photo');
console.log('\nall visible strings:', [...seenAll].filter((t) => t.length > 12).length, 'longer strings scanned');
const seen = new Set();
for (const l of logs) { const k = l.slice(0, 200); if (seen.has(k)) continue; seen.add(k); if (!l.includes('prefill')) console.log('LOG', l.slice(0, 400)); }
await browser.close();
