// Installs a fake DualSense (standard mapping) into a page. Control it with window.__pad.
(() => {
  const mkBtn = () => ({ pressed: false, touched: false, value: 0 });
  const pad = {
    id: 'DualSense Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 0ce6)', index: 0, connected: true, mapping: 'standard', timestamp: 0,
    axes: [0, 0, 0, 0], buttons: Array.from({ length: 18 }, mkBtn),
    vibrationActuator: { effects: [], playEffect(type, p) { this.effects.push({ type, ...p, t: performance.now() }); return Promise.resolve('complete'); }, reset() { return Promise.resolve('complete'); } },
  };
  window.__padState = { enabled: true };
  window.__rumbles = pad.vibrationActuator.effects;
  const names = ['cross', 'circle', 'square', 'triangle', 'l1', 'r1', 'l2', 'r2', 'create', 'options', 'l3', 'r3', 'up', 'down', 'left', 'right', 'ps', 'touchpad'];
  window.__pad = {
    raw: pad,
    axes(lx, ly, rx, ry) { pad.axes = [lx, ly, rx, ry]; pad.timestamp = performance.now(); },
    set(name, v = 1) { const i = names.indexOf(name); if (i < 0) throw new Error('bad button ' + name); pad.buttons[i] = { pressed: v > 0.5 && (i < 6 || i > 7) ? true : v > 0.5, touched: v > 0, value: v }; pad.timestamp = performance.now(); },
    release(name) { this.set(name, 0); },
    clear() { pad.axes = [0, 0, 0, 0]; pad.buttons = Array.from({ length: 18 }, mkBtn); },
    enable(v) { window.__padState.enabled = v; },
  };
  navigator.getGamepads = () => (window.__padState.enabled ? [pad, null, null, null] : [null, null, null, null]);
  setTimeout(() => { const e = new Event('gamepadconnected'); e.gamepad = pad; window.dispatchEvent(e); }, 0);
})();
