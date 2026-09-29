import { chromium, webkit } from 'playwright';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// screenshots and other artefacts of the capture tools land here (override with MARIPOSA_SHOTS)
export const scratch = process.env.MARIPOSA_SHOTS || path.join(os.tmpdir(), 'mariposa-shots');
fs.mkdirSync(scratch, { recursive: true });

export async function launch({ width = 1280, height = 720, dpr = 1, gpu = true, manual = true, pad = false } = {}) {
  // BROWSER=webkit runs any test in Playwright's WebKit (the Safari engine)
  if (process.env.BROWSER === 'webkit') {
    const cache = path.join(process.env.HOME, 'Library/Caches/ms-playwright');
    let exe = process.env.WEBKIT_EXE;
    if (!exe) { const dirs = fs.existsSync(cache) ? fs.readdirSync(cache).filter((d) => d.startsWith('webkit-')).sort().reverse() : []; exe = dirs.length ? path.join(cache, dirs[0], 'pw_run.sh') : undefined; }
    const browser = await webkit.launch({ headless: true, ...(exe ? { executablePath: exe } : {}) });
    const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: dpr });
    const page = await context.newPage();
    const logs = [];
    page.on('console', (m) => { logs.push(`[${m.type()}] ${m.text()}`); });
    page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
    page.on('dialog', (d) => d.dismiss());
    if (manual) await page.addInitScript(() => { window.__manual = true; });
    if (pad) await page.addInitScript({ path: path.join(root, 'tools/fakepad.js') });
    return { browser, context, page, logs };
  }
  const args = gpu ? ['--use-angle=metal', '--use-gl=angle', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'] : ['--enable-unsafe-swiftshader'];
  const browser = await chromium.launch({ headless: true, args });
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: dpr });
  const page = await context.newPage();
  const logs = [];
  page.on('console', (m) => { const t = m.text(); logs.push(`[${m.type()}] ${t}`); });
  page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
  page.on('dialog', (d) => d.dismiss());
  if (manual) await page.addInitScript(() => { window.__manual = true; });
  if (pad) await page.addInitScript({ path: path.join(root, 'tools/fakepad.js') });
  return { browser, context, page, logs };
}

export async function openGame(page, file = 'dist/mariposa.html', timeout = 120000) {
  await page.goto('file://' + path.join(root, file), { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__g && window.__g.ready, null, { timeout });
}
