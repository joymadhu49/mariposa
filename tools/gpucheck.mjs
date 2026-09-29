import { chromium } from 'playwright';
const variants = [
  { name: 'headless-shell default', opts: { headless: true } },
  { name: 'headless-shell angle-metal', opts: { headless: true, args: ['--use-angle=metal', '--use-gl=angle', '--enable-gpu', '--ignore-gpu-blocklist'] } },
  { name: 'chromium new-headless metal', opts: { headless: true, channel: 'chromium', args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] } },
];
for (const v of variants) {
  try {
    const b = await chromium.launch(v.opts);
    const p = await b.newPage({ viewport: { width: 800, height: 500 } });
    const info = await p.evaluate(() => {
      const c = document.createElement('canvas');
      const gl = c.getContext('webgl2');
      if (!gl) return 'no webgl2';
      const e = gl.getExtension('WEBGL_debug_renderer_info');
      return { renderer: e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER), maxTex: gl.getParameter(gl.MAX_TEXTURE_SIZE), floatLinear: !!gl.getExtension('OES_texture_float_linear'), colorBufFloat: !!gl.getExtension('EXT_color_buffer_float'), ua: navigator.userAgent };
    });
    console.log(v.name, JSON.stringify(info));
    await b.close();
  } catch (e) { console.log(v.name, 'FAILED', String(e).split('\n')[0]); }
}
