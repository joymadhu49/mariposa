import { Game } from './game/game.js';

const canvas = document.getElementById('gl');

function notice(title, body) {
  const d = document.createElement('div');
  d.style.cssText = 'position:fixed;inset:0;z-index:200;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;background:radial-gradient(120% 90% at 50% 40%,#16264a 0%,#0a0f1c 68%);color:#f6f1e7;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;text-align:center;padding:24px';
  d.innerHTML = '<div style="font-family:Iowan Old Style,Palatino,Georgia,serif;font-size:44px;letter-spacing:.08em"></div><div style="max-width:32em;line-height:1.6;color:rgba(246,241,231,.75);font-size:16px"></div>';
  d.children[0].textContent = title;
  d.children[1].textContent = body;
  document.body.appendChild(d);
}

function hasWebGL2() {
  try { return !!document.createElement('canvas').getContext('webgl2'); } catch (e) { return false; }
}

if (!hasWebGL2()) {
  notice('Mariposa', 'This game needs WebGL 2. Please open it in a recent version of Chrome, Safari, Edge or Firefox and make sure hardware acceleration is switched on.');
} else {
  let game;
  try {
    game = new Game(canvas);
  } catch (e) {
    console.error('startup failed', e);
    notice('Mariposa', 'The graphics could not be started on this device. Please try another browser or check that hardware acceleration is on.');
  }
  if (game) {
    window.__g = game;
    window.__m = game; // legacy hook used by older test tools
    canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      try { game.save(); } catch (err) { /* ignore */ }
      notice('Mariposa', 'The graphics connection was interrupted. Your journey is saved and the game will restart in a moment.');
      setTimeout(() => location.reload(), 2600);
    });
    (async () => {
      try {
        await game.boot();
      } catch (e) {
        console.error('boot failed', e);
        const l = document.querySelector('#loading .label');
        if (l) l.textContent = 'Something went wrong while loading. Please reload the page.';
        return;
      }
      if (!window.__manual) game.start();
    })();
  }
}
