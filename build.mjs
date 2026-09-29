// Bundles src/ into one self contained HTML file (no network, no external assets).
import { build } from 'esbuild';
import fs from 'node:fs';

const dev = process.argv.includes('--dev');
const t0 = Date.now();
const result = await build({
  entryPoints: ['src/main.js'],
  bundle: true,
  format: 'iife',
  minify: !dev,
  target: 'es2022',
  write: false,
  legalComments: dev ? 'none' : 'eof', // release keeps the Three.js licence notice inside the file
  logLevel: 'warning',
  define: { 'process.env.NODE_ENV': '"production"', __DEV__: dev ? 'true' : 'false' },
});
const js = result.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
const css = fs.readFileSync('src/style.css', 'utf8');
const html = fs.readFileSync('src/index.html', 'utf8')
  .replace('/*__CSS__*/', () => css)
  .replace('/*__JS__*/', () => js);
// the bundle contains three.js (MIT): carry its full licence text inside the file
const three = fs.readFileSync('node_modules/three/LICENSE', 'utf8').trim().replace(/--/g, '- -');
const banner = `<!--\nMariposa. Everything in this file is generated in code, no external assets.\nIt bundles three.js, used under the MIT licence:\n\n${three}\n-->\n`;
const withBanner = html.replace(/^<!doctype html>\s*/i, (m) => m + banner);
fs.mkdirSync('dist', { recursive: true });
fs.writeFileSync('dist/mariposa.html', withBanner);
const kb = (withBanner.length / 1024).toFixed(0);
console.log(`built dist/mariposa.html ${kb} KB (${dev ? 'dev' : 'min'}) in ${Date.now() - t0} ms`);
if (process.argv.includes('--release')) {
  // mariposa.html is the file to hand around; index.html is the same file so a static host (GitHub Pages) serves it at the root
  fs.copyFileSync('dist/mariposa.html', 'mariposa.html');
  fs.copyFileSync('dist/mariposa.html', 'index.html');
  console.log('copied to mariposa.html and index.html');
}
