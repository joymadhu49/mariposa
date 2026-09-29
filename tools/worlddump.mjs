import { generateWorld, renderMapPixels, GRID, HALF, CELL } from '../src/world/worldgen.js';
import { BIOMES, TREES } from '../src/world/biomes.js';
import { writePng } from './png.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const out = process.argv[2] || process.env.MARIPOSA_SHOTS || path.join(os.tmpdir(), 'mariposa-shots');
fs.mkdirSync(out, { recursive: true });
let last = -1;
const W = await generateWorld((f, l) => { const p = Math.floor(f * 10); if (p !== last) { last = p; process.stdout.write(`${l} ${Math.round(f*100)}%\n`); } });
console.log('gen ms', W.stats.genMs.toFixed(0), 'trees', W.treeCount);
let mn = 1e9, mx = -1e9; for (const v of W.height) { if (v < mn) mn = v; if (v > mx) mx = v; }
console.log('height range', mn.toFixed(1), mx.toFixed(1));
console.log('lakes', W.lakes.map(l => `${l.key}@${l.x.toFixed(0)},${l.z.toFixed(0)} lvl ${l.level.toFixed(1)}`).join(' | '));
console.log('falls', JSON.stringify(W.falls));
for (const l of W.landmarks) console.log('lm', l.id.padEnd(11), l.x.toFixed(0).padStart(6), l.z.toFixed(0).padStart(6), 'y', l.y.toFixed(1), 'biome', BIOMES[W.dominantBiomeAt(l.x,l.z)].key);
console.log('spawn', JSON.stringify(W.spawn));
const size = 1024;
const px = renderMapPixels(W, size);
// draw landmarks
const mark = (x, z, r, c) => { const cx = Math.round((x + HALF) / (HALF*2) * size), cy = Math.round((z + HALF) / (HALF*2) * size); for (let dy=-r; dy<=r; dy++) for (let dx=-r; dx<=r; dx++) if (dx*dx+dy*dy<=r*r) { const i=((cy+dy)*size+cx+dx)*4; px[i]=c[0]; px[i+1]=c[1]; px[i+2]=c[2]; } };
for (const l of W.landmarks) mark(l.x, l.z, 5, [255, 40, 40]);
mark(W.spawn.x, W.spawn.z, 6, [255, 255, 0]);
writePng(out + '/map.png', size, size, px);
// height map
const hp = new Uint8ClampedArray(GRID * GRID * 4);
for (let k = 0; k < GRID*GRID; k++) { const h = W.height[k]; const v = h < 0 ? 0 : Math.min(255, h / 300 * 255); hp[k*4]= h<0?20:v; hp[k*4+1]= h<0?60+ (h+58)*0: v; hp[k*4+2]= h<0? 140 : v; hp[k*4+3]=255; }
writePng(out + '/height.png', GRID, GRID, hp);
// biome map
const cols = [[120,190,70],[255,160,200],[160,110,220],[30,100,50],[60,170,200],[150,150,160],[220,130,40],[240,220,150]];
const bp = new Uint8ClampedArray(GRID * GRID * 4);
for (let k = 0; k < GRID*GRID; k++) { let best=0,bv=-1; for(let b=0;b<8;b++){const v=W.biome[k*8+b]; if(v>bv){bv=v;best=b;}} const c=cols[best]; const wat = W.height[k]<0; bp[k*4]=wat?20:c[0]; bp[k*4+1]=wat?50:c[1]; bp[k*4+2]=wat?120:c[2]; bp[k*4+3]=255; }
// tree dots
for (let t = 0; t < W.treeCount; t++) { const x = W.trees[t*7], z = W.trees[t*7+2]; const i = Math.round((x+HALF)/CELL), j = Math.round((z+HALF)/CELL); const k=(j*GRID+i)*4; bp[k]=0; bp[k+1]=0; bp[k+2]=0; }
writePng(out + '/biomes.png', GRID, GRID, bp);
// tree counts per kind
const kc = new Array(TREES.length).fill(0); for (let t = 0; t < W.treeCount; t++) kc[W.trees[t*7+5]]++;
console.log('trees by kind', TREES.map((t,i)=>`${t.key}:${kc[i]}`).join(' '));
