// HUD, title, loading, prompts, toasts and cards. Screens (pause, journal, map...) live in screens.js.
import { clamp, damp, smoothstep, wrapAngle, TAU } from '../core/util.js';
import { glyph } from './glyphs.js';
import { BIOMES, FLOWERS, LANDMARKS } from '../world/biomes.js';
import { STAR_COUNT } from '../game/progress.js';

const ICON = {
  butterfly: '<svg viewBox="0 0 24 24"><path d="M12 12c-1.2-3.6-4.6-6.4-8.4-6.1-.9 2.9.8 6.2 4.2 7-2.9.6-4.2 3.2-3.2 5.6 2.5.6 5-.6 6.6-3.1V12zm0 0c1.2-3.6 4.6-6.4 8.4-6.1.9 2.9-.8 6.2-4.2 7 2.9.6 4.2 3.2 3.2 5.6-2.5.6-5-.6-6.6-3.1V12z" fill="currentColor"/></svg>',
  star: '<svg viewBox="0 0 24 24"><path d="M12 2l2.2 7.8L22 12l-7.8 2.2L12 22l-2.2-7.8L2 12l7.8-2.2z" fill="currentColor"/></svg>',
  bloom: '<svg viewBox="0 0 24 24"><g fill="currentColor"><circle cx="12" cy="6.2" r="3.4"/><circle cx="17.8" cy="10.4" r="3.4"/><circle cx="15.6" cy="17.2" r="3.4"/><circle cx="8.4" cy="17.2" r="3.4"/><circle cx="6.2" cy="10.4" r="3.4"/></g><circle cx="12" cy="12" r="3" fill="#0e1424"/></svg>',
  pin: '<svg viewBox="0 0 24 24"><path d="M12 2a7 7 0 0 0-7 7c0 5 7 13 7 13s7-8 7-13a7 7 0 0 0-7-7zm0 9.5A2.5 2.5 0 1 1 12 6.5a2.5 2.5 0 0 1 0 5z" fill="currentColor"/></svg>',
  book: '<svg viewBox="0 0 24 24"><path d="M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3zm3 0v13M8 17h11" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linejoin="round"/></svg>',
  pad: '<svg viewBox="0 0 24 24"><path d="M7 7h10a5 5 0 0 1 4.8 6.4l-1 3.6a2.4 2.4 0 0 1-4 1L15.4 16H8.6l-1.4 2a2.4 2.4 0 0 1-4-1l-1-3.6A5 5 0 0 1 7 7z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>',
  sun: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="4.2" fill="currentColor"/><g stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M18.7 5.3l-2.1 2.1M7.4 16.6l-2.1 2.1"/></g></svg>',
  moon: '<svg viewBox="0 0 24 24"><path d="M20 14.5A8 8 0 1 1 9.5 4a6.6 6.6 0 0 0 10.5 10.5z" fill="currentColor"/></svg>',
  drop: '<svg viewBox="0 0 24 24"><path d="M12 3c3.6 4.4 6 7.6 6 11a6 6 0 0 1-12 0c0-3.4 2.4-6.6 6-11z" fill="currentColor"/></svg>',
  sound: '<svg viewBox="0 0 24 24"><path d="M4 9.5h3.6L12 5.5v13l-4.4-4H4z" fill="currentColor"/><path d="M15.4 9a4.2 4.2 0 0 1 0 6M17.8 6.6a7.6 7.6 0 0 1 0 10.8" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round"/></svg>',
  cam: '<svg viewBox="0 0 24 24"><path d="M4 8h3l1.6-2.4h6.8L17 8h3v11H4z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><circle cx="12" cy="13.4" r="3.4" fill="none" stroke="currentColor" stroke-width="1.7"/></svg>',
};
export { ICON };

const DIR8 = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
const SPECIES_NAME = (i) => FLOWERS[i]?.name || 'Blossom';

export class UI {
  constructor(game, root) {
    this.game = game;
    this.root = root;
    this.family = 'ps';
    this.toasts = [];
    this.lastRegion = -1;
    this.regionT = 0;
    this.bloomLast = -1; this.starLast = -1; this.chipT = 0;
    this.hintQueue = []; this.hintT = 0; this.curHint = null;
    this.cardT = 0;
    this.compassBlink = 0;
    this._build();
  }

  _build() {
    const wing = ICON.butterfly.replace('<svg', '<svg class="wing"');
    this.root.innerHTML = `
      <div id="hud" class="layer hidden">
        <canvas id="compass"></canvas>
        <div id="region"><div class="n"></div><div class="s"></div></div>
        <div id="chips"><div class="chip" id="chipBloom">${ICON.bloom}<b>0%</b></div><div class="chip" id="chipStar">${ICON.star}<b>0</b></div></div>
        <div id="prompt"><span class="g"></span><span class="t"></span><div class="meter"><i></i></div></div>
        <div id="hint"><span class="g"></span><span class="t"></span></div>
        <div id="energy"><svg viewBox="0 0 64 64"><circle class="track" cx="32" cy="32" r="27" fill="none" stroke-width="4"/><circle class="fill" cx="32" cy="32" r="27" fill="none" stroke-width="4" stroke-dasharray="169.6" stroke-dashoffset="0" transform="rotate(-90 32 32)"/><g class="ico" transform="translate(20 20) scale(1)">${ICON.butterfly.replace(/<svg[^>]*>/, '').replace('</svg>', '')}</g></svg></div>
        <div id="pollen"><i></i><span></span></div>
        <div id="toasts"></div>
        <div id="card"><div class="k"></div><div class="t"></div><div class="b"></div></div>
      </div>
      <div id="title" class="layer hidden">
        <div class="sound" id="soundHint">Click or press a key once to switch the sound on</div>
        <div class="block"><h1>Mariposa</h1><div class="tag">An open world for one small butterfly</div><ul class="menu" id="titleMenu"></ul></div>
        <div class="footer"><div class="keys" id="titleKeys"></div><div id="padStatus"></div></div>
      </div>
      <div id="screens"></div>
      <div id="photo" class="layer hidden"><div class="frame"></div><div class="bar" id="photoBar"></div></div>
      <div id="flash" class="layer"></div>
      <div id="fade" class="layer"></div>
      <div id="loading" class="layer"><div class="mark">Mariposa</div>${wing}<div class="bar"><i></i></div><div class="label">Unfolding the world</div></div>`;
    const $ = (s) => this.root.querySelector(s);
    this.el = {
      hud: $('#hud'), compass: $('#compass'), region: $('#region'), chips: $('#chips'), chipBloom: $('#chipBloom b'), chipStar: $('#chipStar b'),
      prompt: $('#prompt'), promptG: $('#prompt .g'), promptT: $('#prompt .t'), promptM: $('#prompt .meter i'),
      hint: $('#hint'), hintG: $('#hint .g'), hintT: $('#hint .t'),
      energy: $('#energy'), energyFill: $('#energy .fill'), pollen: $('#pollen'), pollenDot: $('#pollen i'), pollenT: $('#pollen span'),
      toasts: $('#toasts'), card: $('#card'), title: $('#title'), titleMenu: $('#titleMenu'), titleKeys: $('#titleKeys'), padStatus: $('#padStatus'), soundHint: $('#soundHint'),
      screens: $('#screens'), photo: $('#photo'), photoBar: $('#photoBar'), flash: $('#flash'), fade: $('#fade'), loading: $('#loading'),
      loadBar: $('#loading .bar i'), loadLabel: $('#loading .label'),
    };
    this.cctx = this.el.compass.getContext('2d');
    this._sizeCompass();
    window.addEventListener('resize', () => this._sizeCompass());
  }

  _sizeCompass() {
    const c = this.el.compass;
    const r = c.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    c.width = Math.max(10, Math.round(r.width * dpr)); c.height = Math.max(10, Math.round(r.height * dpr));
    this.cdpr = dpr;
  }

  // ---- loading ----------------------------------------------------------------------------
  setLoading(f, label) {
    this.el.loadBar.style.transform = `scaleX(${clamp(f, 0, 1).toFixed(3)})`;
    if (label) this.el.loadLabel.textContent = label;
  }
  hideLoading() { this.el.loading.classList.add('done'); setTimeout(() => this.el.loading.classList.add('hidden'), 1000); }

  fade(on, ms) { this.el.fade.classList.toggle('on', on); }
  flash() { this.el.flash.classList.add('on'); requestAnimationFrame(() => requestAnimationFrame(() => this.el.flash.classList.remove('on'))); }

  // ---- title -------------------------------------------------------------------------------
  showTitle(show) {
    this.el.title.classList.toggle('hidden', !show);
    this.el.title.classList.remove('out');
    if (!show) return;
  }
  hudVisible(v) { this.el.hud.classList.toggle('hidden', !v); }

  // ---- toasts and cards ----------------------------------------------------------------------
  toast(text, icon = 'star', ms = 3600) {
    const d = document.createElement('div');
    d.className = 'toast';
    d.innerHTML = `${ICON[icon] || ''}<span></span>`;
    d.querySelector('span').textContent = text;
    this.el.toasts.appendChild(d);
    while (this.el.toasts.children.length > 4) this.el.toasts.firstChild.remove();
    setTimeout(() => d.classList.add('out'), ms);
    setTimeout(() => d.remove(), ms + 700);
  }

  card(kicker, title, body = '') {
    const c = this.el.card;
    c.querySelector('.k').textContent = kicker;
    c.querySelector('.t').textContent = title;
    c.querySelector('.b').textContent = body;
    c.classList.remove('show');
    void c.offsetWidth;
    c.classList.add('show');
  }

  // a single line of tutorial guidance
  hint(actionsHtml, text, ms = 9000) { this.curHint = { html: actionsHtml, text, t: ms / 1000 }; }
  clearHint() { this.curHint = null; }

  // ---- per frame ---------------------------------------------------------------------------
  update(dt, ctx) {
    const g = this.game;
    const fam = g.input.glyphs;
    this.family = fam;
    const el = this.el;
    if (ctx.showHud) {
      // energy
      const p = g.player;
      const showE = p.energy < 0.985 || p.boostAmt > 0.15 || p.exhausted;
      el.energy.classList.toggle('show', showE);
      el.energy.classList.toggle('low', p.energy < 0.25);
      el.energyFill.style.strokeDashoffset = String(169.6 * (1 - clamp(p.energy, 0, 1)));
      // pollen
      const pol = p.pollen;
      if (pol !== null && pol !== undefined) {
        const f = FLOWERS[pol];
        el.pollen.classList.add('show');
        el.pollenT.textContent = f.name + ' pollen';
        const col = f.petals[0];
        el.pollenDot.style.background = col; el.pollenDot.style.color = col;
      } else el.pollen.classList.remove('show');
      // chips
      const pr = g.progress;
      const bl = pr.bloomPercent();
      if (bl !== this.bloomLast) { el.chipBloom.textContent = bl + '%'; if (this.bloomLast >= 0) this.chipT = 4; this.bloomLast = bl; }
      const sc = pr.stats.stars;
      if (sc !== this.starLast) { el.chipStar.textContent = sc + ' of ' + STAR_COUNT; if (this.starLast >= 0) this.chipT = 4; this.starLast = sc; }
      this.chipT = Math.max(0, this.chipT - dt);
      el.chips.classList.toggle('lit', this.chipT > 0 || ctx.showChips);
      this._prompt(ctx);
      this._hint(dt);
      this._region(dt, ctx);
      this._compass(ctx);
    }
  }

  _prompt(ctx) {
    const g = this.game, p = g.player, fam = this.family;
    let html = '', text = '', meter = -1;
    if (p.mode === 'perch') {
      if (p.sipDone) { html = glyph('climb', fam); text = 'Nectar collected. Fly on when you are ready'; }
      else if (g.input.a.interact > 0.5) { html = glyph('interact', fam); text = 'Sipping nectar'; meter = p.sipT / 2.0; }
      else { html = glyph('interact', fam); text = 'Hold to sip nectar'; }
    } else if (p.mode === 'fly' && p.focus) {
      const f = FLOWERS[p.focus.species];
      const cross = p.pollen !== null && p.pollen !== undefined && p.pollen !== p.focus.species;
      html = glyph('interact', fam);
      text = cross ? `Hold to pollinate the ${f.name}` : `Hold to sip from the ${f.name}`;
    } else if (p.exhausted && ctx.tired) {
      html = glyph('glide', fam); text = 'Glide to catch your breath';
    } else if (ctx.customPrompt) { html = ctx.customPrompt.html; text = ctx.customPrompt.text; }
    const el = this.el;
    if (text) {
      if (el.promptT.textContent !== text || el.promptG.dataset.f !== fam + html.length) { el.promptG.innerHTML = html; el.promptG.dataset.f = fam + html.length; el.promptT.textContent = text; }
      el.prompt.classList.add('show');
      el.promptM.parentElement.style.display = meter >= 0 ? 'block' : 'none';
      if (meter >= 0) el.promptM.style.transform = `scaleX(${clamp(meter, 0, 1).toFixed(3)})`;
    } else el.prompt.classList.remove('show');
  }

  _hint(dt) {
    const el = this.el;
    const h = this.curHint;
    if (h) {
      h.t -= dt;
      if (h.t <= 0) { this.curHint = null; el.hint.classList.remove('show'); return; }
      if (el.hintT.textContent !== h.text) { el.hintG.innerHTML = typeof h.html === 'function' ? h.html(this.family) : h.html; el.hintT.textContent = h.text; }
      else if (typeof h.html === 'function') el.hintG.innerHTML = h.html(this.family);
      el.hint.classList.add('show');
    } else el.hint.classList.remove('show');
  }

  _region(dt, ctx) {
    const g = this.game;
    const b = g.currentBiome;
    if (b !== this.lastRegion && g.state === 'play') {
      this.lastRegion = b;
      this.el.region.querySelector('.n').textContent = BIOMES[b].name;
      this.el.region.querySelector('.s').textContent = g.timeLabel();
      this.el.region.classList.add('show');
      this.regionT = 4.6;
    }
    if (this.regionT > 0) { this.regionT -= dt; if (this.regionT <= 0) this.el.region.classList.remove('show'); }
  }

  _compass(ctx) {
    const g = this.game, c = this.cctx, cv = this.el.compass;
    const want = Math.round(cv.clientWidth * this.cdpr);
    if (cv.clientWidth > 0 && Math.abs(cv.width - want) > 1) this._sizeCompass();
    const W = cv.width, H = cv.height, d = this.cdpr;
    c.clearRect(0, 0, W, H);
    const bgr = c.createLinearGradient(0, 0, 0, H);
    bgr.addColorStop(0, 'rgba(8,12,26,0.42)'); bgr.addColorStop(0.75, 'rgba(8,12,26,0.16)'); bgr.addColorStop(1, 'rgba(8,12,26,0)');
    c.fillStyle = bgr; c.fillRect(0, 0, W, H);
    c.shadowColor = 'rgba(0,0,0,0.55)'; c.shadowBlur = 4 * d;
    const yaw = g.camRig.yaw;
    const bearing = ((Math.atan2(Math.sin(yaw), -Math.cos(yaw)) * 180) / Math.PI + 360) % 360;
    const SPAN = 130;
    const xOf = (deg) => { let dd = ((deg - bearing + 540) % 360) - 180; return W / 2 + (dd / SPAN) * W; };
    const inView = (deg) => Math.abs(((deg - bearing + 540) % 360) - 180) < SPAN / 2 + 6;
    // baseline
    const midY = H * 0.62;
    c.strokeStyle = 'rgba(255,255,255,0.28)'; c.lineWidth = 1 * d;
    c.beginPath(); c.moveTo(0, midY); c.lineTo(W, midY); c.stroke();
    c.textAlign = 'center'; c.textBaseline = 'alphabetic';
    for (let a = 0; a < 360; a += 5) {
      if (!inView(a)) continue;
      const x = xOf(a);
      const major = a % 45 === 0, med = a % 15 === 0;
      c.strokeStyle = major ? 'rgba(255,255,255,0.85)' : 'rgba(255,255,255,0.4)';
      c.lineWidth = (major ? 1.6 : 1) * d;
      c.beginPath(); c.moveTo(x, midY); c.lineTo(x, midY - (major ? 11 : med ? 7 : 4) * d); c.stroke();
      if (major) {
        c.fillStyle = a % 90 === 0 ? '#f6f1e7' : 'rgba(246,241,231,0.7)';
        c.font = `${(a % 90 === 0 ? 17 : 12) * d}px "Iowan Old Style", Palatino, Georgia, serif`;
        c.fillText(DIR8[a / 45], x, midY - 15 * d);
      }
    }
    // markers
    const px = g.player.pos.x, pz = g.player.pos.z;
    const bearingTo = (x, z) => ((Math.atan2(x - px, -(z - pz)) * 180) / Math.PI + 360) % 360;
    const marker = (deg, kind, label, alpha = 1, glow = false) => {
      if (!inView(deg)) return;
      const x = xOf(deg);
      c.globalAlpha = alpha;
      const y = midY + 8 * d, s = 6 * d;
      c.beginPath();
      if (kind === 'pin') { c.moveTo(x, y - s * 0.4); c.lineTo(x + s * 0.9, y + s * 1.3); c.lineTo(x - s * 0.9, y + s * 1.3); c.closePath(); }
      else { c.moveTo(x, y - s); c.lineTo(x + s, y); c.lineTo(x, y + s); c.lineTo(x - s, y); c.closePath(); }
      if (kind === 'found') { c.fillStyle = '#f3cf85'; c.shadowColor = 'rgba(243,207,133,0.8)'; c.shadowBlur = 10 * d; c.fill(); c.shadowBlur = 0; }
      else if (kind === 'pin') { c.fillStyle = '#9fe8ff'; c.shadowColor = 'rgba(159,232,255,0.8)'; c.shadowBlur = 10 * d; c.fill(); c.shadowBlur = 0; }
      else { c.strokeStyle = 'rgba(246,241,231,0.75)'; c.lineWidth = 1.4 * d; c.stroke(); }
      if (label && Math.abs(((deg - bearing + 540) % 360) - 180) < 16) {
        c.fillStyle = 'rgba(246,241,231,0.95)'; c.font = `${12.5 * d}px -apple-system, "SF Pro Text", sans-serif`;
        c.fillText(label, x, y + 24 * d);
      }
      c.globalAlpha = 1;
    };
    for (const l of g.world.landmarks) {
      const dist = Math.hypot(l.x - px, l.z - pz);
      const found = !!g.progress.discovered[l.id];
      const hint = g.hintUntil > g.time;
      if (found) marker(bearingTo(l.x, l.z), 'found', l.name, 1);
      else if (dist < 520 || hint) marker(bearingTo(l.x, l.z), 'hollow', '', hint ? 0.9 : clamp(1 - (dist - 260) / 300, 0.25, 0.85));
    }
    if (g.waypoint) marker(bearingTo(g.waypoint.x, g.waypoint.z), 'pin', 'Waypoint', 1);
    // centre caret
    c.fillStyle = '#f3cf85';
    c.beginPath(); c.moveTo(W / 2, midY + 1 * d); c.lineTo(W / 2 - 5 * d, midY - 7 * d); c.lineTo(W / 2 + 5 * d, midY - 7 * d); c.closePath(); c.fill();
    // fade the edges
    c.shadowBlur = 0;
    c.globalCompositeOperation = 'destination-in';
    const gr = c.createLinearGradient(0, 0, W, 0);
    gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(0.16, 'rgba(0,0,0,1)'); gr.addColorStop(0.84, 'rgba(0,0,0,1)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = gr; c.fillRect(0, 0, W, H);
    c.globalCompositeOperation = 'source-over';
  }
}
