// Scans UI copy for banned characters: hyphen, en dash, em dash, minus, and emoji. Reports string literals for review.
import fs from 'node:fs';
import path from 'node:path';
const files = ['src/ui/ui.js', 'src/ui/screens.js', 'src/ui/glyphs.js', 'src/ui/manager.js', 'src/game/game.js', 'src/game/progress.js', 'src/game/player.js', 'src/world/biomes.js', 'src/render/butterfly.js', 'src/index.html'];
const bad = /[-‐-―−]|\p{Extended_Pictographic}/u;
const emoji = /\p{Extended_Pictographic}/u;
const skip = (s) => /^#[0-9a-fA-F]{3,8}$/.test(s) || /^[a-zA-Z_.]+$/.test(s) || /^(rgba?|hsla?|translate|scale|rotate|linear|radial|calc|url)\(/.test(s) || /(px|em|vh|vw|%|ms)$/.test(s.trim()) && !/ /.test(s.trim()) || /^-?[0-9.]+/.test(s.trim()) && !/[a-z]{3}/i.test(s);
let count = 0;
for (const f of files) {
  const src = fs.readFileSync(f, 'utf8');
  const lines = src.split('\n');
  lines.forEach((line, i) => {
    const t = line.trim();
    if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) return;
    const re = /'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"|`((?:[^`\\]|\\.)*)`/g;
    let m;
    while ((m = re.exec(line))) {
      const s = m[1] ?? m[2] ?? m[3];
      if (!s || s.length < 3) continue;
      if (!bad.test(s)) continue;
      // only strings that look like human sentences: contain a space and a letter run, or contain an emoji
      const human = emoji.test(s) || (/[A-Za-z]{3,}/.test(s) && / /.test(s) && !/[{};=<>]/.test(s.replace(/\$\{[^}]*\}/g, '')) );
      if (!human) continue;
      if (skip(s)) continue;
      console.log(`${f}:${i + 1}: ${JSON.stringify(s.slice(0, 140))}`);
      count++;
    }
  });
}
console.log(count ? `\n${count} candidate strings to review` : '\nno banned characters found in UI copy candidates');
