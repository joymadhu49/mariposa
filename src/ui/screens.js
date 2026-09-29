// Menus and full screen views: title, pause, settings, controls, journal, map, photo.
import { clamp, lerp, smoothstep, TAU } from '../core/util.js';
import { glyph } from './glyphs.js';
import { ICON } from './ui.js';
import { BIOMES, FLOWERS, LANDMARKS, VARIANTS } from '../world/biomes.js';
import { SPECIES, PLAYABLE } from '../render/butterfly.js';
import { UNLOCKS, FOG_N, STAR_COUNT } from '../game/progress.js';
import { renderMapPixels, HALF } from '../world/worldgen.js';

// ------------------------------------------------------------------------------------------------
export class Menu {
  constructor(items, { el = null, compact = false, onSound = null } = {}) {
    this.items = items;
    this.el = el || document.createElement('ul');
    this.el.className = 'menu' + (compact ? ' compact' : '');
    this.onSound = onSound;
    this.focus = Math.max(0, items.findIndex((i) => !i.disabled && !(i.hidden && i.hidden())));
    this._build();
  }
  _build() {
    this.el.innerHTML = '';
    this.rows = this.items.map((it, i) => {
      const li = document.createElement('li');
      li.innerHTML = `<span class="pip"></span><span class="lab"></span>${it.type === 'slider' ? '<div class="slider"><i></i></div>' : ''}<span class="val"></span>`;
      li.addEventListener('mouseenter', () => { if (!it.disabled && this.focus !== i) { this.focus = i; this.refresh(); this.onSound && this.onSound('ui.move'); } });
      li.addEventListener('click', (e) => {
        if (it.disabled) return;
        this.focus = i;
        if (it.type === 'slider') {
          const sl = li.querySelector('.slider').getBoundingClientRect();
          const t = clamp((e.clientX - sl.left) / sl.width, 0, 1);
          this._setSlider(it, it.min + (it.max - it.min) * t);
        } else this.activate();
      });
      this.el.appendChild(li);
      return { li, lab: li.querySelector('.lab'), val: li.querySelector('.val'), fill: li.querySelector('.slider i') };
    });
    this.refresh();
  }
  refresh() {
    this.items.forEach((it, i) => {
      const r = this.rows[i];
      const label = typeof it.label === 'function' ? it.label() : it.label;
      if (r.lab.textContent !== label) r.lab.textContent = label;
      r.li.classList.toggle('focus', i === this.focus);
      r.li.classList.toggle('disabled', !!it.disabled);
      r.li.style.display = it.hidden && it.hidden() ? 'none' : '';
      if (it.type === 'slider') {
        const v = it.get();
        r.fill.style.width = Math.round(((v - it.min) / (it.max - it.min)) * 100) + '%';
        r.val.textContent = it.format ? it.format(v) : String(v);
      } else if (it.type === 'toggle') r.val.textContent = it.get() ? 'On' : 'Off';
      else if (it.type === 'choice') r.val.textContent = it.options[it.get()] ?? '';
      else r.val.textContent = it.value ? it.value() : '';
    });
  }
  move(d) {
    const n = this.items.length;
    let i = this.focus;
    for (let k = 0; k < n; k++) { i = (i + d + n) % n; const it = this.items[i]; if (!it.disabled && !(it.hidden && it.hidden())) break; }
    if (i !== this.focus) { this.focus = i; this.onSound && this.onSound('ui.move'); this.refresh(); }
  }
  _setSlider(it, v) {
    const step = it.step || 1;
    v = clamp(Math.round(v / step) * step, it.min, it.max);
    if (v !== it.get()) { it.set(v); this.onSound && this.onSound('ui.move'); }
    this.refresh();
  }
  adjust(d) {
    const it = this.items[this.focus];
    if (!it || it.disabled) return;
    if (it.type === 'slider') this._setSlider(it, it.get() + (it.step || 1) * d);
    else if (it.type === 'toggle') { it.set(!it.get()); this.onSound && this.onSound('ui.toggle'); this.refresh(); }
    else if (it.type === 'choice') { const n = it.options.length; it.set((it.get() + d + n) % n); this.onSound && this.onSound('ui.toggle'); this.refresh(); }
  }
  activate() {
    const it = this.items[this.focus];
    if (!it || it.disabled) return;
    if (it.type === 'toggle') { it.set(!it.get()); this.onSound && this.onSound('ui.toggle'); }
    else if (it.type === 'choice') { it.set((it.get() + 1) % it.options.length); this.onSound && this.onSound('ui.toggle'); }
    else if (it.action) { this.onSound && this.onSound('ui.select'); it.action(); }
    this.refresh();
  }
  // returns true if the input was consumed
  handle(input) {
    let used = false;
    if (input.navFire.up) { this.move(-1); used = true; }
    if (input.navFire.down) { this.move(1); used = true; }
    const it = this.items[this.focus];
    if (input.navFire.left && it && it.type !== 'button') { this.adjust(-1); used = true; }
    if (input.navFire.right && it && it.type !== 'button') { this.adjust(1); used = true; }
    if (input.ap.confirm) { this.activate(); used = true; }
    return used;
  }
}

// ------------------------------------------------------------------------------------------------
class Screen {
  constructor(ui, name) { this.ui = ui; this.game = ui.game; this.name = name; this.age = 0; this.el = null; }
  mount(html, cls = '') {
    this.el = document.createElement('div');
    this.el.className = 'screen ' + cls;
    this.el.innerHTML = html;
    this.ui.el.screens.appendChild(this.el);
  }
  open() {}
  close() { if (this.el) { this.el.remove(); this.el = null; } }
  update(dt, input) { this.age += dt; }
  get snd() { return (n) => this.game.audio.play(n); }
  hintBar(items) {
    const fam = this.ui.family;
    return `<div class="hintbar">${items.map(([a, t]) => `<span class="k">${glyph(a, fam)}<span>${t}</span></span>`).join('')}</div>`;
  }
}

// ------------------------------------------------------------------------------------------------
export class TitleScreen {
  constructor(ui) {
    this.ui = ui; this.game = ui.game; this.armed = 0; this.confirmT = 0;
    const g = this.game;
    this.items = [
      { label: () => (g.progress.hasSave ? 'Continue' : 'Begin'), type: 'button', action: () => g.beginPlay(g.progress.hasSave) },
      { label: () => (this.confirmT > 0 ? 'Press again to erase your journey' : 'New journey'), type: 'button', hidden: () => !g.progress.hasSave, action: () => this.newJourney() },
      { label: 'Settings', type: 'button', action: () => ui.open('settings', { from: 'title' }) },
      { label: 'Controls', type: 'button', action: () => ui.open('controls', { from: 'title' }) },
    ];
    this.menu = new Menu(this.items, { el: ui.el.titleMenu, onSound: (n) => g.audio.play(n) });
  }
  newJourney() {
    const g = this.game;
    if (!g.progress.hasSave) { g.beginPlay(false); return; }
    if (this.confirmT > 0) { this.confirmT = 0; g.progress.reset(); g.applySavedSettings(); g.beginPlay(false, true); }
    else this.confirmT = 3.2;
  }
  open() { this.ui.showTitle(true); this.menu.focus = 0; this.menu.refresh(); this.age = 0; }
  close() { this.ui.el.title.classList.add('out'); setTimeout(() => this.ui.showTitle(false), 700); }
  update(dt, input) {
    this.age += dt;
    const g = this.game, ui = this.ui, fam = ui.family;
    if (this.confirmT > 0) { this.confirmT -= dt; if (this.confirmT <= 0) this.menu.refresh(); }
    if (this.age > 0.35) this.menu.handle(input);
    this.items[1].disabled = !g.progress.hasSave;
    this.menu.refresh();
    const keys = ui.el.titleKeys;
    const html = `<span class="k">${glyph('confirm', fam)}<span>Select</span></span><span class="k">${glyph('nav', fam)}<span>Choose</span></span>`;
    if (keys.dataset.f !== fam) { keys.innerHTML = html; keys.dataset.f = fam; }
    const st = ui.el.padStatus;
    const txt = g.input.padKind !== 'none' ? `${g.input.padName} connected` : 'Press any button on your controller, or use the keyboard';
    if (st.textContent !== txt) st.textContent = txt;
    ui.el.soundHint.classList.toggle('on', g.audio.ctx && !g.audio.running && this.age > 1.5);
  }
}

// ------------------------------------------------------------------------------------------------
export class PauseScreen extends Screen {
  open() {
    const g = this.game, ui = this.ui;
    this.mount(`<div class="card" style="min-width:26em"><h2>Paused</h2><div class="sub" id="pauseSub"></div><ul class="menu" id="pm"></ul></div>${''}`);
    const items = [
      { label: 'Resume', type: 'button', action: () => g.resume() },
      { label: 'Journal', type: 'button', action: () => ui.open('journal') },
      { label: 'Map', type: 'button', action: () => ui.open('map') },
      { label: 'Photo mode', type: 'button', action: () => g.enterPhoto() },
      { label: 'Settings', type: 'button', action: () => ui.open('settings', { from: 'pause' }) },
      { label: 'Controls', type: 'button', action: () => ui.open('controls', { from: 'pause' }) },
      { label: 'Save and exit to title', type: 'button', action: () => g.exitToTitle() },
    ];
    this.menu = new Menu(items, { el: this.el.querySelector('#pm'), onSound: (n) => g.audio.play(n) });
    this.el.querySelector('#pauseSub').textContent = `${g.timeLabel()} in ${BIOMES[g.currentBiome].name}`;
    this.el.insertAdjacentHTML('beforeend', this.hintBar([['confirm', 'Select'], ['back', 'Resume']]));
  }
  update(dt, input) {
    super.update(dt, input);
    if (this.age < 0.18) return;
    if (input.ap.pause || input.ap.back) { this.game.resume(); return; }
    this.menu.handle(input);
  }
}

// ------------------------------------------------------------------------------------------------
export class SettingsScreen extends Screen {
  open(params = {}) {
    const g = this.game, ui = this.ui;
    this.from = params.from || 'pause';
    this.mount(`<div class="card" style="min-width:34em"><h2>Settings</h2><ul class="menu" id="sm"></ul></div>`);
    const S = g.settings, inp = g.input, aud = g.audio;
    const save = () => g.saveSettings();
    const items = [
      { label: 'Music', type: 'slider', min: 0, max: 100, step: 5, get: () => Math.round(aud.vol.music * 100), set: (v) => { aud.vol.music = v / 100; aud.applyVolumes(); save(); }, format: (v) => v + '%' },
      { label: 'Effects and nature', type: 'slider', min: 0, max: 100, step: 5, get: () => Math.round(aud.vol.sfx * 100), set: (v) => { aud.vol.sfx = v / 100; aud.applyVolumes(); save(); }, format: (v) => v + '%' },
      { label: 'Look speed', type: 'slider', min: 40, max: 200, step: 10, get: () => Math.round(inp.settings.lookSpeed * 100), set: (v) => { inp.settings.lookSpeed = v / 100; save(); }, format: (v) => v + '%' },
      { label: 'Invert look', type: 'toggle', get: () => inp.settings.invertY, set: (v) => { inp.settings.invertY = v; save(); } },
      { label: 'Follow camera', type: 'toggle', get: () => S.autoCamera, set: (v) => { S.autoCamera = v; save(); } },
      { label: 'Vibration', type: 'choice', options: ['Off', 'Light', 'Full'], get: () => (inp.settings.vibration <= 0 ? 0 : inp.settings.vibration < 0.8 ? 1 : 2), set: (v) => { inp.settings.vibration = [0, 0.55, 1][v]; if (v) inp.rumble(0.5, 0.8, 140); save(); } },
      { label: 'Stick dead zone', type: 'slider', min: 4, max: 30, step: 2, get: () => Math.round(inp.settings.deadzone * 100), set: (v) => { inp.settings.deadzone = v / 100; save(); }, format: (v) => v + '%' },
      { label: 'Graphics', type: 'choice', options: ['Auto', 'Low', 'Medium', 'High', 'Ultra'], get: () => ['auto', 'low', 'medium', 'high', 'ultra'].indexOf(S.quality), set: (v) => { g.setQuality(['auto', 'low', 'medium', 'high', 'ultra'][v]); save(); } },
      { label: 'Time of day', type: 'choice', options: ['Paused', 'Slow', 'Normal', 'Fast'], get: () => S.timeScale, set: (v) => { S.timeScale = v; save(); } },
      { label: 'Reduce motion', type: 'toggle', get: () => S.reduceMotion, set: (v) => { S.reduceMotion = v; document.body.classList.toggle('rm', v); save(); } },
      { label: 'Guidance hints', type: 'toggle', get: () => S.hints, set: (v) => { S.hints = v; save(); } },
      { label: 'Full screen', type: 'button', value: () => (document.fullscreenElement ? 'On' : 'Off'), action: () => { try { if (document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen(); } catch (e) { /* ignore */ } } },
      { label: 'Back', type: 'button', action: () => ui.back() },
    ];
    this.menu = new Menu(items, { el: this.el.querySelector('#sm'), compact: true, onSound: (n) => g.audio.play(n) });
    this.el.insertAdjacentHTML('beforeend', this.hintBar([['confirm', 'Select'], ['nav', 'Adjust'], ['back', 'Back']]));
  }
  update(dt, input) {
    super.update(dt, input);
    if (this.age < 0.18) return;
    if (input.ap.back || input.ap.pause) { this.ui.back(); return; }
    this.menu.handle(input);
  }
}

// ------------------------------------------------------------------------------------------------
const PAD_SVG = `
<svg viewBox="0 0 640 400" xmlns="http://www.w3.org/2000/svg">
  <g fill="none" stroke="rgba(255,255,255,.55)" stroke-width="2">
    <path d="M148 128C88 128 40 210 48 302c6 62 58 82 100 40 24-24 44-60 76-68h192c32 8 52 44 76 68 42 42 94 22 100-40 8-92-40-174-100-174-52-2-92 12-172 12s-120-14-172-12z" fill="rgba(22,30,50,.82)"/>
    <rect x="236" y="148" width="168" height="84" rx="22" fill="rgba(255,255,255,.06)"/>
  </g>
  <g fill="rgba(255,255,255,.14)" stroke="rgba(255,255,255,.5)" stroke-width="1.6">
    <rect x="70" y="92" width="110" height="20" rx="10"/><rect x="460" y="92" width="110" height="20" rx="10"/>
    <rect x="86" y="58" width="80" height="26" rx="12"/><rect x="474" y="58" width="80" height="26" rx="12"/>
  </g>
  <g class="hits">
    <rect class="hit" data-b="l1" x="70" y="92" width="110" height="20" rx="10"/><rect class="hit" data-b="r1" x="460" y="92" width="110" height="20" rx="10"/>
    <rect class="hit" data-b="l2" x="86" y="58" width="80" height="26" rx="12"/><rect class="hit" data-b="r2" x="474" y="58" width="80" height="26" rx="12"/>
    <rect class="hit" data-b="touchpad" x="236" y="148" width="168" height="84" rx="22"/>
  </g>
  <g fill="rgba(255,255,255,.2)" stroke="rgba(255,255,255,.5)" stroke-width="1.4">
    <rect x="186" y="150" width="26" height="12" rx="6"/><rect class="hit" data-b="create" x="186" y="150" width="26" height="12" rx="6"/>
    <rect x="428" y="150" width="26" height="12" rx="6"/><rect class="hit" data-b="options" x="428" y="150" width="26" height="12" rx="6"/>
    <circle cx="320" cy="296" r="9"/><circle class="hit" data-b="ps" cx="320" cy="296" r="9"/>
  </g>
  <g transform="translate(146 194)" fill="rgba(255,255,255,.16)" stroke="rgba(255,255,255,.5)" stroke-width="1.4">
    <path d="M-9 -34h18v25h-18zM-9 9h18v25h-18zM-34 -9h25v18h-25zM9 -9h25v18H9z"/>
    <path class="hit" data-b="up" d="M-9 -34h18v25h-18z"/><path class="hit" data-b="down" d="M-9 9h18v25h-18z"/><path class="hit" data-b="left" d="M-34 -9h25v18h-25z"/><path class="hit" data-b="right" d="M9 -9h25v18H9z"/>
  </g>
  <g transform="translate(494 194)" stroke-width="2" fill="rgba(255,255,255,.1)">
    <circle cx="0" cy="-32" r="17" stroke="#72e6a8"/><path d="M0 -42l8 14h-16z" stroke="#72e6a8" fill="none"/><circle class="hit" data-b="triangle" cx="0" cy="-32" r="17"/>
    <circle cx="32" cy="0" r="17" stroke="#ff8290"/><circle cx="32" cy="0" r="7" stroke="#ff8290" fill="none"/><circle class="hit" data-b="circle" cx="32" cy="0" r="17"/>
    <circle cx="0" cy="32" r="17" stroke="#7db7ff"/><path d="M-7 25l14 14M7 25l-14 14" stroke="#7db7ff" fill="none"/><circle class="hit" data-b="cross" cx="0" cy="32" r="17"/>
    <circle cx="-32" cy="0" r="17" stroke="#f194dd"/><rect x="-39" y="-7" width="14" height="14" stroke="#f194dd" fill="none"/><circle class="hit" data-b="square" cx="-32" cy="0" r="17"/>
  </g>
  <g fill="rgba(255,255,255,.12)" stroke="rgba(255,255,255,.55)" stroke-width="1.6">
    <circle cx="238" cy="294" r="34"/><circle cx="402" cy="294" r="34"/>
  </g>
  <g><circle class="hit" data-b="l3" cx="238" cy="294" r="34"/><circle class="hit" data-b="r3" cx="402" cy="294" r="34"/>
    <circle id="lcap" cx="238" cy="294" r="22" fill="rgba(255,255,255,.22)" stroke="rgba(255,255,255,.7)" stroke-width="1.6"/>
    <circle id="rcap" cx="402" cy="294" r="22" fill="rgba(255,255,255,.22)" stroke="rgba(255,255,255,.7)" stroke-width="1.6"/></g>
  <g class="lbl" font-size="13">
    <text x="20" y="88">Hover</text><text x="20" y="52">Dive</text><text x="620" y="88" text-anchor="end">Glide</text><text x="620" y="52" text-anchor="end">Boost</text>
    <text x="320" y="252" text-anchor="middle">Journal</text><text x="190" y="140" text-anchor="middle">Map</text><text x="450" y="140" text-anchor="middle">Pause</text>
    <text x="146" y="252" text-anchor="middle">Zoom</text><text x="494" y="112" text-anchor="middle">Photo</text><text x="560" y="200">Sip</text><text x="494" y="262" text-anchor="middle">Climb</text><text x="424" y="200" text-anchor="end">Pulse</text>
    <text x="238" y="352" text-anchor="middle">Fly</text><text x="402" y="352" text-anchor="middle">Look, press to recenter</text>
  </g>
</svg>`;

export class ControlsScreen extends Screen {
  open(params = {}) {
    const fam = this.ui.family;
    this.mount(`<div class="card" style="width:min(74em,94vw)"><h2>Controls</h2><div class="cols"><div class="pad">${PAD_SVG}</div><div class="bind" id="bind"></div></div></div>`);
    this._fam = '';
    this.el.insertAdjacentHTML('beforeend', this.hintBar([['back', 'Back']]));
    this.hits = Array.from(this.el.querySelectorAll('.hit'));
    this.lcap = this.el.querySelector('#lcap'); this.rcap = this.el.querySelector('#rcap');
  }
  _bindings(fam) {
    const rows = [
      ['move', 'Fly with the <b>left stick</b>'], ['look', 'Look around with the <b>right stick</b>'], ['climb', 'Hold to <b>climb</b>'], ['descend', 'Hold to <b>dive</b>'],
      ['boost', 'Hold to <b>boost</b>, it uses energy'], ['interact', 'Hold near a flower to <b>sip nectar</b>'], ['pulse', 'Send out a <b>pulse</b> that reveals stars'],
      ['glide', 'Hold to <b>glide</b> and recover'], ['brake', 'Hold to <b>hover</b> in place'], ['recenter', 'Press to <b>recenter</b> the camera'],
      ['dUp', 'Zoom the camera in and out'], ['photo', 'Open <b>photo mode</b>'], ['pause', '<b>Pause</b> menu'], ['map', 'Open the <b>map</b>'], ['journal', 'Open the <b>journal</b>'],
    ];
    return rows.map(([a, t]) => `<div>${glyph(a, fam)}</div><div class="t">${t}</div>`).join('');
  }
  update(dt, input) {
    super.update(dt, input);
    const fam = this.ui.family;
    if (this._fam !== fam) { this._fam = fam; this.el.querySelector('#bind').innerHTML = this._bindings(fam); }
    // live highlight
    const map = { cross: 0, circle: 1, square: 2, triangle: 3, l1: 4, r1: 5, l2: 6, r2: 7, create: 8, options: 9, l3: 10, r3: 11, up: 12, down: 13, left: 14, right: 15, ps: 16, touchpad: 17 };
    for (const h of this.hits) h.classList.toggle('on', !!input.btn[map[h.dataset.b]]);
    this.lcap.setAttribute('cx', 238 + input.axes[0] * 12); this.lcap.setAttribute('cy', 294 + input.axes[1] * 12);
    this.rcap.setAttribute('cx', 402 + input.axes[2] * 12); this.rcap.setAttribute('cy', 294 + input.axes[3] * 12);
    if (this.age < 0.18) return;
    if (input.ap.back || input.ap.pause) this.ui.back();
  }
}

// ------------------------------------------------------------------------------------------------
export class JournalScreen extends Screen {
  open() {
    this.tab = this.ui.journalTab ?? 0;
    this.mount(`<div class="card journal"><h2>Journal</h2><div class="tabs" id="jt"></div><div id="jc"></div></div>`);
    this.focus = 0;
    this._render();
    this.el.insertAdjacentHTML('beforeend', this.hintBar([['tabL', 'Previous page'], ['tabR', 'Next page'], ['confirm', 'Choose'], ['back', 'Back']]));
  }
  _tabs() { return ['Places', 'Flowers', 'Wings', 'Progress']; }
  _render() {
    const g = this.game, pr = g.progress, fam = this.ui.family;
    const tabs = this._tabs();
    this.el.querySelector('#jt').innerHTML = `<span class="g">${glyph('tabL', fam)}</span>` + tabs.map((t, i) => `<span class="tab${i === this.tab ? ' on' : ''}" data-i="${i}">${t}</span>`).join('') + `<span class="g">${glyph('tabR', fam)}</span>`;
    this.el.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => { this.tab = +t.dataset.i; this.focus = 0; this._render(); this.snd('ui.select'); }));
    const c = this.el.querySelector('#jc');
    this.cells = [];
    if (this.tab === 0) {
      c.innerHTML = '<div class="grid">' + g.world.landmarks.map((l, i) => {
        const found = !!pr.discovered[l.id];
        return `<div class="cell${found ? '' : ' locked'}" data-i="${i}"><div class="badge">${found ? BIOMES[g.biomeIndex(l.biome)].name : 'Undiscovered'}</div><div class="n">${found ? l.name : 'A place yet to find'}</div><div class="d">${found ? l.blurb : 'Explore ' + BIOMES[g.biomeIndex(l.biome)].name + ' to find it.'}</div></div>`;
      }).join('') + '</div>';
    } else if (this.tab === 1) {
      const list = FLOWERS.filter((f) => !f.padOnly);
      c.innerHTML = '<div class="grid">' + list.map((f, i) => {
        const n = pr.data.tasted[f.key] || 0;
        return `<div class="cell${n ? '' : ' locked'}" data-i="${i}"><div class="n">${f.name}</div><div class="d">${n ? 'Tasted ' + n + (n === 1 ? ' time' : ' times') : 'Not tasted yet'}${f.nocturnal ? '. Blooms at night' : ''}</div><div class="sw">${f.petals.slice(0, 4).map((p) => `<i style="background:${p}"></i>`).join('')}</div></div>`;
      }).join('') + '</div>';
    } else if (this.tab === 2) {
      c.innerHTML = '<div class="grid">' + SPECIES.slice(0, PLAYABLE).map((s, i) => {
        const u = UNLOCKS.find((x) => x.species === i);
        const got = pr.unlocked.includes(i);
        const prog = u.progress ? u.progress(pr) : null;
        const eq = pr.data.species === i;
        return `<div class="cell${got ? '' : ' locked'}" data-i="${i}"><div class="badge">${eq ? 'Wearing' : got ? 'Unlocked' : 'Locked'}</div><div class="n">${s.name}</div><div class="d">${got ? (eq ? 'These are your wings.' : 'Choose these wings') : u.hint}</div>${!got && prog ? `<div class="bar"><i style="width:${(prog[0] / prog[1]) * 100}%"></i></div>` : ''}</div>`;
      }).join('') + '</div>';
    } else {
      const s = pr.stats;
      const km = (s.distance / 1000).toFixed(1);
      const mins = Math.floor(s.playSeconds / 60);
      const bl = pr.bloomPercent();
      c.innerHTML = `<div class="stats">
        <div class="stat"><div class="v">${bl}%</div><div class="l">Bloom</div><div class="bar"><i style="width:${bl}%"></i></div></div>
        <div class="stat"><div class="v">${pr.discoveredCount} of ${LANDMARKS.length}</div><div class="l">Places found</div></div>
        <div class="stat"><div class="v">${s.stars} of ${STAR_COUNT}</div><div class="l">Dew stars</div></div>
        <div class="stat"><div class="v">${s.pollinations}</div><div class="l">Flowers pollinated</div></div>
        <div class="stat"><div class="v">${s.sips}</div><div class="l">Sips of nectar</div></div>
        <div class="stat"><div class="v">${km} km</div><div class="l">Distance flown</div></div>
        <div class="stat"><div class="v">${Math.round(pr.exploredFraction() * 100)}%</div><div class="l">Island explored</div></div>
        <div class="stat"><div class="v">${mins} min</div><div class="l">Time aloft</div></div>
      </div>`;
    }
    this.cells = Array.from(c.querySelectorAll('.cell'));
    this.cells.forEach((el, i) => {
      el.addEventListener('mouseenter', () => { this.focus = i; this._focus(); });
      el.addEventListener('click', () => { this.focus = i; this._focus(); this._choose(); });
    });
    this._focus();
  }
  _focus() {
    this.cells.forEach((el, i) => el.classList.toggle('focus', i === this.focus));
    const f = this.cells[this.focus];
    if (f && f.scrollIntoView) f.scrollIntoView({ block: 'nearest' });
  }
  _choose() {
    if (this.tab !== 2) return;
    const pr = this.game.progress;
    if (pr.unlocked.includes(this.focus) && pr.data.species !== this.focus) {
      pr.data.species = this.focus; this.game.player.species = this.focus; pr.dirty = true;
      this.snd('species'); this.game.ui.toast('Now flying as the ' + SPECIES[this.focus].name, 'butterfly');
      this._render();
    }
  }
  update(dt, input) {
    super.update(dt, input);
    if (this.age < 0.18) return;
    if (input.ap.back || input.ap.pause || input.ap.journal) { this.ui.back(); return; }
    if (input.ap.tabL) { this.tab = (this.tab + 3) % 4; this.focus = 0; this.ui.journalTab = this.tab; this._render(); this.snd('ui.move'); }
    if (input.ap.tabR) { this.tab = (this.tab + 1) % 4; this.focus = 0; this.ui.journalTab = this.tab; this._render(); this.snd('ui.move'); }
    if (this.cells.length) {
      const cols = Math.max(1, Math.round(this.el.querySelector('.grid').clientWidth / (this.cells[0].clientWidth + 12)));
      let moved = false;
      if (input.navFire.right) { this.focus = Math.min(this.cells.length - 1, this.focus + 1); moved = true; }
      if (input.navFire.left) { this.focus = Math.max(0, this.focus - 1); moved = true; }
      if (input.navFire.down) { this.focus = Math.min(this.cells.length - 1, this.focus + cols); moved = true; }
      if (input.navFire.up) { this.focus = Math.max(0, this.focus - cols); moved = true; }
      if (moved) { this._focus(); this.snd('ui.move'); }
      if (input.ap.confirm) this._choose();
    }
  }
}

// ------------------------------------------------------------------------------------------------
let MAP_BASE = null;
export class MapScreen extends Screen {
  open() {
    const g = this.game;
    this.mount(`<div id="mapwrap"><canvas id="mapcanvas"></canvas></div><div id="maplabel"><div class="n"></div><div class="b"></div></div>`, 'mapscr');
    this.el.style.background = 'rgba(4,7,14,0.72)';
    this.cv = this.el.querySelector('#mapcanvas');
    this.size = Math.floor(Math.min(window.innerWidth * 0.9, window.innerHeight * 0.84));
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.cv.width = this.size * dpr; this.cv.height = this.size * dpr;
    this.cv.style.width = this.size + 'px'; this.cv.style.height = this.size + 'px';
    this.dpr = dpr;
    this.ctx = this.cv.getContext('2d');
    if (!MAP_BASE) {
      const N = 720;
      const px = renderMapPixels(g.world, N);
      const cv = document.createElement('canvas'); cv.width = cv.height = N;
      cv.getContext('2d').putImageData(new ImageData(px, N, N), 0, 0);
      MAP_BASE = cv;
    }
    this.fogCv = document.createElement('canvas'); this.fogCv.width = this.fogCv.height = FOG_N;
    this._fog();
    const p = g.player.pos;
    this.rx = p.x; this.rz = p.z;
    this.sel = -1;
    this.el.insertAdjacentHTML('beforeend', this.hintBar([['move', 'Move cursor'], ['confirm', 'Set waypoint'], ['pulse', 'Clear waypoint'], ['tabL', 'Previous place'], ['tabR', 'Next place'], ['back', 'Close']]));
    this.cv.addEventListener('click', (e) => {
      const r = this.cv.getBoundingClientRect();
      this.rx = ((e.clientX - r.left) / r.width) * 4096 - HALF; this.rz = ((e.clientY - r.top) / r.height) * 4096 - HALF;
      this._setWaypoint();
    });
    this.cv.addEventListener('mousemove', (e) => {
      const r = this.cv.getBoundingClientRect();
      this.rx = ((e.clientX - r.left) / r.width) * 4096 - HALF; this.rz = ((e.clientY - r.top) / r.height) * 4096 - HALF;
    });
  }
  _fog() {
    const pr = this.game.progress, c = this.fogCv.getContext('2d');
    const img = c.createImageData(FOG_N, FOG_N);
    for (let i = 0; i < FOG_N * FOG_N; i++) { img.data[i * 4] = 14; img.data[i * 4 + 1] = 20; img.data[i * 4 + 2] = 36; img.data[i * 4 + 3] = 255 - pr.fog[i]; }
    c.putImageData(img, 0, 0);
  }
  _setWaypoint() {
    const g = this.game;
    g.waypoint = { x: this.rx, z: this.rz };
    this.snd('ui.select');
    g.ui.toast('Waypoint set', 'pin', 2200);
  }
  update(dt, input) {
    super.update(dt, input);
    const g = this.game;
    if (this.age < 0.18) return;
    if (input.ap.back || input.ap.pause || input.ap.map) { this.ui.back(); return; }
    const sp = 900 * dt;
    if (Math.abs(input.move.x) + Math.abs(input.move.y) > 0.05) { this.rx += input.move.x * sp; this.rz -= input.move.y * sp; this.sel = -1; }
    this.rx = clamp(this.rx, -HALF, HALF); this.rz = clamp(this.rz, -HALF, HALF);
    const found = g.world.landmarks.filter((l) => g.progress.discovered[l.id]);
    if ((input.ap.tabL || input.ap.tabR) && found.length) {
      this.sel = (this.sel + (input.ap.tabR ? 1 : found.length - 1) + found.length) % found.length;
      this.rx = found[this.sel].x; this.rz = found[this.sel].z; this.snd('ui.move');
    }
    if (input.ap.confirm) this._setWaypoint();
    if (input.ap.pulse) { g.waypoint = null; this.snd('ui.back'); }
    this._fogT = (this._fogT || 0) + dt;
    if (this._fogT > 0.5) { this._fogT = 0; this._fog(); }
    this._draw();
  }
  _draw() {
    const g = this.game, c = this.ctx, S = this.size * this.dpr, d = this.dpr;
    const W = (x) => ((x + HALF) / 4096) * S;
    c.clearRect(0, 0, S, S);
    c.imageSmoothingEnabled = true; c.imageSmoothingQuality = 'high';
    c.filter = 'saturate(0.9) brightness(0.95)';
    c.drawImage(MAP_BASE, 0, 0, S, S);
    c.filter = 'none';
    // parchment tint
    c.fillStyle = 'rgba(255,236,190,0.06)'; c.fillRect(0, 0, S, S);
    // fog of war
    c.globalAlpha = 0.93;
    c.imageSmoothingEnabled = true;
    c.drawImage(this.fogCv, 0, 0, S, S);
    c.globalAlpha = 1;
    // grid
    c.strokeStyle = 'rgba(255,255,255,0.07)'; c.lineWidth = 1 * d;
    for (let i = 1; i < 8; i++) { const p = (i / 8) * S; c.beginPath(); c.moveTo(p, 0); c.lineTo(p, S); c.stroke(); c.beginPath(); c.moveTo(0, p); c.lineTo(S, p); c.stroke(); }
    // landmarks
    const label = { n: '', b: '' };
    for (const l of g.world.landmarks) {
      const found = !!g.progress.discovered[l.id];
      const fx = Math.round(((l.x + HALF) / 4096) * FOG_N), fz = Math.round(((l.z + HALF) / 4096) * FOG_N);
      const seen = g.progress.fog[clamp(fz, 0, FOG_N - 1) * FOG_N + clamp(fx, 0, FOG_N - 1)] > 110;
      const x = W(l.x), y = W(l.z);
      if (found) {
        c.fillStyle = '#f3cf85'; c.shadowColor = 'rgba(243,207,133,.9)'; c.shadowBlur = 10 * d;
        c.beginPath(); c.moveTo(x, y - 8 * d); c.lineTo(x + 7 * d, y); c.lineTo(x, y + 8 * d); c.lineTo(x - 7 * d, y); c.closePath(); c.fill(); c.shadowBlur = 0;
        if (Math.hypot(this.rx - l.x, this.rz - l.z) < 90) { label.n = l.name; label.b = l.blurb; }
      } else if (seen) {
        c.strokeStyle = 'rgba(246,241,231,.85)'; c.lineWidth = 1.6 * d;
        c.beginPath(); c.moveTo(x, y - 7 * d); c.lineTo(x + 6 * d, y); c.lineTo(x, y + 7 * d); c.lineTo(x - 6 * d, y); c.closePath(); c.stroke();
        c.fillStyle = 'rgba(246,241,231,.9)'; c.font = `${12 * d}px -apple-system, sans-serif`; c.textAlign = 'center'; c.fillText('?', x, y + 4.4 * d);
      }
    }
    // waypoint
    if (g.waypoint) {
      const x = W(g.waypoint.x), y = W(g.waypoint.z);
      c.fillStyle = '#9fe8ff'; c.shadowColor = 'rgba(159,232,255,.9)'; c.shadowBlur = 12 * d;
      c.beginPath(); c.arc(x, y - 9 * d, 6 * d, 0, TAU); c.fill();
      c.beginPath(); c.moveTo(x - 4 * d, y - 6 * d); c.lineTo(x + 4 * d, y - 6 * d); c.lineTo(x, y + 2 * d); c.closePath(); c.fill(); c.shadowBlur = 0;
    }
    // player
    const p = g.player;
    const px = W(p.pos.x), py = W(p.pos.z);
    c.save(); c.translate(px, py); c.rotate(Math.atan2(Math.sin(p.yaw), -Math.cos(p.yaw)) + Math.PI);
    c.rotate(0);
    c.fillStyle = '#ffffff'; c.strokeStyle = 'rgba(0,0,0,.6)'; c.lineWidth = 1.6 * d;
    c.beginPath(); c.moveTo(0, -11 * d); c.lineTo(7.5 * d, 8 * d); c.lineTo(0, 4 * d); c.lineTo(-7.5 * d, 8 * d); c.closePath(); c.fill(); c.stroke();
    c.restore();
    // reticle
    const rx = W(this.rx), ry = W(this.rz);
    c.strokeStyle = 'rgba(255,255,255,.9)'; c.lineWidth = 1.6 * d;
    c.beginPath(); c.arc(rx, ry, 9 * d, 0, TAU); c.stroke();
    c.beginPath(); c.moveTo(rx - 15 * d, ry); c.lineTo(rx - 5 * d, ry); c.moveTo(rx + 5 * d, ry); c.lineTo(rx + 15 * d, ry); c.moveTo(rx, ry - 15 * d); c.lineTo(rx, ry - 5 * d); c.moveTo(rx, ry + 5 * d); c.lineTo(rx, ry + 15 * d); c.stroke();
    // compass rose
    c.fillStyle = 'rgba(246,241,231,.85)'; c.font = `${20 * d}px "Iowan Old Style", Georgia, serif`; c.textAlign = 'center';
    c.fillText('N', S / 2, 26 * d);
    const ml = this.el.querySelector('#maplabel');
    if (!label.n) { const bi = g.world.dominantBiomeAt(this.rx, this.rz); const fx = Math.round(((this.rx + HALF) / 4096) * FOG_N), fz = Math.round(((this.rz + HALF) / 4096) * FOG_N); const known = g.progress.fog[clamp(fz, 0, FOG_N - 1) * FOG_N + clamp(fx, 0, FOG_N - 1)] > 60; label.n = known ? BIOMES[bi].name : 'Unexplored'; label.b = known ? '' : 'Fly here to reveal the map'; }
    if (ml.dataset.k !== label.n + label.b) { ml.dataset.k = label.n + label.b; ml.querySelector('.n').textContent = label.n; ml.querySelector('.b').textContent = label.b; }
  }
}

// ------------------------------------------------------------------------------------------------
export class PhotoScreen extends Screen {
  open() {
    const ui = this.ui;
    ui.el.photo.classList.remove('hidden');
    this.clean = false;
    this._bar();
  }
  _bar() {
    const fam = this.ui.family;
    this.ui.el.photoBar.innerHTML = [['confirm', 'Take photo'], ['look', 'Orbit'], ['descend', 'Closer'], ['boost', 'Farther'], ['tabL', 'Filter'], ['photo', 'Hide frame'], ['back', 'Exit']].map(([a, t]) => `<span class="k">${glyph(a, fam)}<span>${t}</span></span>`).join('');
    this._fam = fam;
  }
  close() { this.ui.el.photo.classList.add('hidden'); }
  update(dt, input) {
    this.age += dt;
    if (this._fam !== this.ui.family) this._bar();
    if (this.age < 0.25) return;
    const g = this.game;
    if (input.ap.back || input.ap.pause) { g.exitPhoto(); return; }
    if (input.ap.photo) { this.clean = !this.clean; this.ui.el.photo.classList.toggle('hidden', false); this.ui.el.photo.querySelector('.frame').style.opacity = this.clean ? 0 : 1; this.ui.el.photoBar.style.opacity = this.clean ? 0 : 1; }
    if (input.ap.confirm) g.capturePhoto();
    if (input.ap.tabL) g.cycleFilter(-1);
    if (input.ap.tabR) g.cycleFilter(1);
  }
}
