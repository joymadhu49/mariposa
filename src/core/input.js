// Unified input: DualSense (Gamepad API, standard mapping), keyboard and mouse.
// The rest of the game only reads `actions`, edges and menu navigation from here.
import { clamp } from './util.js';

export const BTN = {
  CROSS: 0, CIRCLE: 1, SQUARE: 2, TRIANGLE: 3, L1: 4, R1: 5, L2: 6, R2: 7, CREATE: 8, OPTIONS: 9, L3: 10, R3: 11,
  UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15, PS: 16, TOUCHPAD: 17,
};
const BTN_COUNT = 18;

const GAME_KEYS = new Set(['Space', 'Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ShiftLeft', 'ShiftRight', 'ControlLeft', 'KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE', 'KeyC', 'KeyF', 'KeyR', 'KeyG', 'KeyM', 'KeyJ', 'KeyP', 'Escape', 'Enter', 'Backspace', 'BracketLeft', 'BracketRight', 'Comma', 'Period']);

function radial(x, y, inner, outer = 0.97, power = 1.35) {
  const m = Math.hypot(x, y);
  if (m <= inner) return [0, 0];
  const t = clamp((m - inner) / (outer - inner), 0, 1);
  const s = Math.pow(t, power) / m;
  return [x * s, y * s];
}

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.pad = null;
    this.padId = '';
    this.padKind = 'none'; // 'dualsense' | 'dualshock' | 'xbox' | 'other' | 'none'
    this.device = 'keyboard'; // last used device
    this.keys = new Set();
    this.keyEdge = new Set();
    this.mouse = { dx: 0, dy: 0, wheel: 0, locked: false, down: false };
    this.btn = new Array(BTN_COUNT).fill(false);
    this.prev = new Array(BTN_COUNT).fill(false);
    this.val = new Array(BTN_COUNT).fill(0);
    this.axes = [0, 0, 0, 0];
    this.rawAxes = [0, 0, 0, 0];
    this.settings = { deadzone: 0.14, invertY: false, lookSpeed: 1, vibration: 1, stickCurve: 1.35 };
    this.move = { x: 0, y: 0 };
    this.look = { x: 0, y: 0 };
    this.lookDelta = { x: 0, y: 0 };
    this.a = {}; // held actions (numbers 0..1)
    this.ap = {}; // pressed this frame
    this.ar = {}; // released this frame
    this.prevA = {};
    this.nav = { up: 0, down: 0, left: 0, right: 0 };
    this.navRepeat = { up: 0, down: 0, left: 0, right: 0 };
    this.navFire = { up: false, down: false, left: false, right: false };
    this.callbacks = { pad: [], gesture: [], device: [], lockLost: [] };
    this.lastRumble = 0;
    this.rumbleUntil = 0;
    this.time = 0;
    this._bind();
  }

  on(evt, fn) { this.callbacks[evt].push(fn); }
  _emit(evt, ...args) { for (const f of this.callbacks[evt]) f(...args); }

  _bind() {
    const kd = (e) => {
      if (GAME_KEYS.has(e.code) && !e.metaKey && !e.ctrlKey) e.preventDefault();
      if (!this.keys.has(e.code)) this.keyEdge.add(e.code);
      this.keys.add(e.code);
      this._setDevice('keyboard');
      this._emit('gesture');
    };
    const ku = (e) => { this.keys.delete(e.code); };
    window.addEventListener('keydown', kd);
    window.addEventListener('keyup', ku);
    window.addEventListener('blur', () => { this.keys.clear(); this.mouse.down = false; });
    document.addEventListener('pointerlockchange', () => {
      const was = this.mouse.locked;
      this.mouse.locked = document.pointerLockElement === this.canvas;
      // the browser takes the lock back on Esc and swallows that key press, so tell the game
      if (was && !this.mouse.locked && !this._ownUnlock) this._emit('lockLost');
      this._ownUnlock = false;
    });
    window.addEventListener('mousemove', (e) => {
      if (this.mouse.locked) { this.mouse.dx += e.movementX; this.mouse.dy += e.movementY; this._setDevice('keyboard'); }
      else if (this.mouse.down) { this.mouse.dx += e.movementX; this.mouse.dy += e.movementY; }
    });
    window.addEventListener('mousedown', () => { this.mouse.down = true; this._emit('gesture'); });
    window.addEventListener('mouseup', () => { this.mouse.down = false; });
    window.addEventListener('pointerdown', () => this._emit('gesture'));
    window.addEventListener('touchstart', () => this._emit('gesture'), { passive: true });
    window.addEventListener('wheel', (e) => { this.mouse.wheel += e.deltaY; }, { passive: true });
    window.addEventListener('gamepadconnected', () => this._scanPads(true));
    window.addEventListener('gamepaddisconnected', () => this._scanPads(true));
  }

  _setDevice(d) {
    if (this.device !== d) { this.device = d; this._emit('device', d); }
  }

  requestPointerLock() {
    try { if (this.canvas.requestPointerLock && !this.mouse.locked) { const p = this.canvas.requestPointerLock(); if (p && p.catch) p.catch(() => {}); } } catch (e) { /* ignore */ }
  }
  exitPointerLock() { try { if (document.exitPointerLock && this.mouse.locked) { this._ownUnlock = true; document.exitPointerLock(); } } catch (e) { /* ignore */ } }

  _classify(id, mapping) {
    const s = (id || '').toLowerCase();
    if (s.includes('dualsense') || s.includes('0ce6') || s.includes('0df2')) return 'dualsense';
    if (s.includes('dualshock') || s.includes('054c') || s.includes('wireless controller')) return s.includes('054c') && s.includes('0ce6') ? 'dualsense' : 'dualshock';
    if (s.includes('xbox') || s.includes('045e') || s.includes('xinput')) return 'xbox';
    return 'other';
  }

  _scanPads(force = false) {
    let list = [];
    try { list = navigator.getGamepads ? Array.from(navigator.getGamepads()) : []; } catch (e) { list = []; }
    let best = null;
    for (const p of list) {
      if (!p || !p.connected) continue;
      const score = (p.mapping === 'standard' ? 10 : 0) + (this._classify(p.id, p.mapping) === 'dualsense' ? 5 : 0) + (p.buttons.length >= 16 ? 2 : 0);
      if (!best || score > best.score) best = { p, score };
    }
    const next = best ? best.p : null;
    const changed = (next ? next.id + next.index : '') !== (this.pad ? this.padId + this.pad.index : '');
    this.pad = next;
    if (changed || force) {
      this.padId = next ? next.id : '';
      this.padKind = next ? this._classify(next.id, next.mapping) : 'none';
      this._emit('pad', !!next, this.padKind, this.padId);
    }
  }

  // Human friendly controller name
  get padName() {
    return { dualsense: 'DualSense', dualshock: 'DualShock', xbox: 'Xbox controller', other: 'Controller', none: '' }[this.padKind];
  }

  // Glyph family the UI should show
  get glyphs() {
    if (this.device === 'keyboard') return 'kb';
    if (this.padKind === 'xbox') return 'xbox';
    return 'ps';
  }

  key(code) { return this.keys.has(code); }
  keyPressed(code) { return this.keyEdge.has(code); }

  update(dt) {
    this.time += dt;
    this._scanPads();
    const p = this.pad;
    const dz = this.settings.deadzone;
    // ---- buttons
    for (let i = 0; i < BTN_COUNT; i++) this.prev[i] = this.btn[i];
    let anyPad = false;
    if (p) {
      for (let i = 0; i < BTN_COUNT; i++) {
        const b = p.buttons[i];
        if (b) {
          const v = b.value !== undefined ? b.value : (b.pressed ? 1 : 0);
          this.val[i] = v;
          this.btn[i] = b.pressed || v > 0.5;
          if ((i === 6 || i === 7) ? v > 0.12 : this.btn[i]) anyPad = true;
        } else { this.val[i] = 0; this.btn[i] = false; }
      }
      // analogue triggers: pressed threshold is lower so a light pull registers
      this.btn[6] = this.val[6] > 0.18; this.btn[7] = this.val[7] > 0.18;
      const ax = p.axes;
      this.rawAxes[0] = ax[0] || 0; this.rawAxes[1] = ax[1] || 0; this.rawAxes[2] = ax[2] || 0; this.rawAxes[3] = ax[3] || 0;
      if (Math.hypot(ax[0] || 0, ax[1] || 0) > 0.3 || Math.hypot(ax[2] || 0, ax[3] || 0) > 0.3) anyPad = true;
    } else {
      for (let i = 0; i < BTN_COUNT; i++) { this.btn[i] = false; this.val[i] = 0; }
      this.rawAxes[0] = this.rawAxes[1] = this.rawAxes[2] = this.rawAxes[3] = 0;
    }
    if (anyPad) { this._setDevice('pad'); this._emit('gesture'); }
    const pressed = (i) => this.btn[i] && !this.prev[i];
    const released = (i) => !this.btn[i] && this.prev[i];
    this.padPressed = pressed; this.padReleased = released;

    // ---- sticks
    const [lx, ly] = radial(this.rawAxes[0], this.rawAxes[1], dz, 0.97, this.settings.stickCurve);
    const [rx, ry] = radial(this.rawAxes[2], this.rawAxes[3], Math.max(0.1, dz * 0.85), 0.97, 1.6);
    this.axes[0] = lx; this.axes[1] = ly; this.axes[2] = rx; this.axes[3] = ry;
    const K = (c) => (this.keys.has(c) ? 1 : 0);
    let mx = lx + K('KeyD') - K('KeyA');
    let my = -ly + K('KeyW') - K('KeyS');
    const ml = Math.hypot(mx, my);
    if (ml > 1) { mx /= ml; my /= ml; }
    this.move.x = mx; this.move.y = my;
    // look: right stick rate (rad/s) plus mouse and arrow keys
    const sp = this.settings.lookSpeed;
    const inv = this.settings.invertY ? -1 : 1;
    const lookX = rx * 2.7 * sp + (K('ArrowRight') - K('ArrowLeft')) * 1.9 * sp;
    const lookY = ry * 1.8 * sp * inv + (K('ArrowDown') - K('ArrowUp')) * 1.3 * sp * inv;
    this.lookDelta.x = lookX * dt + this.mouse.dx * 0.0024 * sp;
    this.lookDelta.y = lookY * dt + this.mouse.dy * 0.0021 * sp * inv;
    this.look.x = rx + (K('ArrowRight') - K('ArrowLeft')); this.look.y = ry + (K('ArrowDown') - K('ArrowUp'));
    this.mouse.dx = 0; this.mouse.dy = 0;
    this.wheel = this.mouse.wheel; this.mouse.wheel = 0;

    // ---- actions
    const kb = (c) => (this.keys.has(c) ? 1 : 0);
    const A = {
      climb: Math.max(this.btn[BTN.CROSS] ? 1 : 0, kb('Space')),
      descend: Math.max(this.val[BTN.L2] > 0.1 ? this.val[BTN.L2] : 0, kb('KeyC'), kb('ControlLeft')),
      boost: Math.max(this.val[BTN.R2] > 0.1 ? this.val[BTN.R2] : 0, kb('ShiftLeft'), kb('ShiftRight')),
      interact: Math.max(this.btn[BTN.CIRCLE] ? 1 : 0, kb('KeyE')),
      pulse: Math.max(this.btn[BTN.SQUARE] ? 1 : 0, kb('KeyF')),
      photo: Math.max(this.btn[BTN.TRIANGLE] ? 1 : 0, kb('KeyP')),
      brake: Math.max(this.btn[BTN.L1] ? 1 : 0, kb('KeyQ')),
      glide: Math.max(this.btn[BTN.R1] ? 1 : 0, kb('KeyG')),
      recenter: Math.max(this.btn[BTN.R3] ? 1 : 0, kb('KeyR')),
      dUp: Math.max(this.btn[BTN.UP] ? 1 : 0, kb('BracketRight')),
      dDown: Math.max(this.btn[BTN.DOWN] ? 1 : 0, kb('BracketLeft')),
      dLeft: Math.max(this.btn[BTN.LEFT] ? 1 : 0, kb('Comma')),
      dRight: Math.max(this.btn[BTN.RIGHT] ? 1 : 0, kb('Period')),
      pause: Math.max(this.btn[BTN.OPTIONS] ? 1 : 0, kb('Escape')),
      map: Math.max(this.btn[BTN.CREATE] ? 1 : 0, kb('KeyM'), kb('Tab')),
      journal: Math.max(this.btn[BTN.TOUCHPAD] ? 1 : 0, kb('KeyJ')),
      confirm: Math.max(this.btn[BTN.CROSS] ? 1 : 0, kb('Enter'), kb('Space')),
      back: Math.max(this.btn[BTN.CIRCLE] ? 1 : 0, kb('Escape'), kb('Backspace')),
      tabL: Math.max(this.btn[BTN.L1] ? 1 : 0, kb('KeyQ')),
      tabR: Math.max(this.btn[BTN.R1] ? 1 : 0, kb('KeyE')),
    };
    for (const k in A) {
      const was = (this.prevA[k] || 0) > 0.5;
      const now = A[k] > 0.5;
      this.ap[k] = now && !was;
      this.ar[k] = !now && was;
      this.prevA[k] = A[k];
    }
    this.a = A;

    // ---- menu navigation with auto repeat (dpad, left stick, arrows)
    const dirs = {
      up: this.btn[BTN.UP] || ly < -0.55 || this.keys.has('ArrowUp') || this.keys.has('KeyW'),
      down: this.btn[BTN.DOWN] || ly > 0.55 || this.keys.has('ArrowDown') || this.keys.has('KeyS'),
      left: this.btn[BTN.LEFT] || lx < -0.55 || this.keys.has('ArrowLeft') || this.keys.has('KeyA'),
      right: this.btn[BTN.RIGHT] || lx > 0.55 || this.keys.has('ArrowRight') || this.keys.has('KeyD'),
    };
    for (const d of ['up', 'down', 'left', 'right']) {
      this.navFire[d] = false;
      if (dirs[d]) {
        if (this.nav[d] === 0) { this.navFire[d] = true; this.navRepeat[d] = 0.38; }
        else { this.navRepeat[d] -= dt; if (this.navRepeat[d] <= 0) { this.navFire[d] = true; this.navRepeat[d] = 0.085; } }
        this.nav[d] += dt;
      } else { this.nav[d] = 0; }
    }
    this.keyEdge.clear();
  }

  // ---- haptics ------------------------------------------------------------------------------
  // strong and weak are 0..1 magnitudes for the low and high frequency motors.
  rumble(strong, weak, ms = 80) {
    const v = this.settings.vibration;
    if (!v || !this.pad || this.device !== 'pad') return;
    const now = performance.now();
    if (now - this.lastRumble < 32) return;
    const act = this.pad.vibrationActuator;
    if (!act || typeof act.playEffect !== 'function') return;
    this.lastRumble = now;
    try {
      const pr = act.playEffect('dual-rumble', { startDelay: 0, duration: ms, weakMagnitude: clamp(weak * v, 0, 1), strongMagnitude: clamp(strong * v, 0, 1) });
      if (pr && pr.catch) pr.catch(() => {});
    } catch (e) { /* unsupported */ }
  }
  stopRumble() {
    try { const a = this.pad && this.pad.vibrationActuator; if (a && a.reset) { const p = a.reset(); if (p && p.catch) p.catch(() => {}); } } catch (e) { /* ignore */ }
  }
}
