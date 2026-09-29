// Button glyphs as inline SVG for PlayStation, Xbox and keyboard. Used in prompts and menus.
const PS_COL = { cross: '#7db7ff', circle: '#ff8290', square: '#f194dd', triangle: '#72e6a8' };

function psFace(sym) {
  const c = PS_COL[sym];
  const body = {
    cross: `<path d="M9.3 9.3l9.4 9.4M18.7 9.3l-9.4 9.4" stroke="${c}" stroke-width="2.5" stroke-linecap="round" fill="none"/>`,
    circle: `<circle cx="14" cy="14" r="5.4" stroke="${c}" stroke-width="2.4" fill="none"/>`,
    square: `<rect x="9" y="9" width="10" height="10" rx="1.4" stroke="${c}" stroke-width="2.4" fill="none"/>`,
    triangle: `<path d="M14 8.4l6 10.4H8z" stroke="${c}" stroke-width="2.4" stroke-linejoin="round" fill="none"/>`,
  }[sym];
  return `<svg class="gl" viewBox="0 0 28 28" width="28" height="28"><circle cx="14" cy="14" r="12.6" fill="rgba(8,12,22,.82)" stroke="rgba(255,255,255,.4)" stroke-width="1"/>${body}</svg>`;
}
function pill(text, w = 38, tint = '#e9e4d8') {
  return `<svg class="gl" viewBox="0 0 ${w} 24" width="${w}" height="24"><rect x="1" y="2" width="${w - 2}" height="20" rx="8" fill="rgba(8,12,22,.82)" stroke="rgba(255,255,255,.4)"/><text x="${w / 2}" y="16" text-anchor="middle" font-family="-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif" font-size="11" font-weight="700" fill="${tint}">${text}</text></svg>`;
}
function stick(letter, press = false) {
  return `<svg class="gl" viewBox="0 0 30 30" width="30" height="30"><circle cx="15" cy="15" r="13" fill="rgba(8,12,22,.82)" stroke="rgba(255,255,255,.4)"/><circle cx="15" cy="15" r="7.4" fill="rgba(255,255,255,.12)" stroke="rgba(255,255,255,.55)"/><text x="15" y="19" text-anchor="middle" font-family="-apple-system,sans-serif" font-size="10.5" font-weight="700" fill="#e9e4d8">${letter}${press ? '3' : ''}</text></svg>`;
}
function dpad(dir) {
  const on = (d) => (dir === d ? '#f3cf85' : 'rgba(255,255,255,.45)');
  return `<svg class="gl" viewBox="0 0 30 30" width="30" height="30"><circle cx="15" cy="15" r="13" fill="rgba(8,12,22,.82)" stroke="rgba(255,255,255,.4)"/><path d="M12.5 6h5v6.5h-5zM12.5 17.5h5V24h-5zM6 12.5h6.5v5H6zM17.5 12.5H24v5h-6.5z" fill="rgba(255,255,255,.2)"/><path d="M15 7l3 4h-6z" fill="${on('up')}"/><path d="M15 23l3-4h-6z" fill="${on('down')}"/><path d="M7 15l4-3v6z" fill="${on('left')}"/><path d="M23 15l-4-3v6z" fill="${on('right')}"/></svg>`;
}
function touchpad() { return `<svg class="gl" viewBox="0 0 40 24" width="40" height="24"><rect x="1.5" y="2" width="37" height="20" rx="6" fill="rgba(8,12,22,.82)" stroke="rgba(255,255,255,.45)"/><rect x="8" y="7" width="24" height="10" rx="3" fill="rgba(255,255,255,.14)"/></svg>`; }
function create() { return `<svg class="gl" viewBox="0 0 28 24" width="28" height="24"><rect x="1" y="2" width="26" height="20" rx="8" fill="rgba(8,12,22,.82)" stroke="rgba(255,255,255,.4)"/><path d="M14 16V7m0 0l-3.4 3.4M14 7l3.4 3.4" stroke="#e9e4d8" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" fill="none"/><path d="M9 14v3.5h10V14" stroke="#e9e4d8" stroke-width="1.6" stroke-linecap="round" fill="none"/></svg>`; }
function options() { return `<svg class="gl" viewBox="0 0 28 24" width="28" height="24"><rect x="1" y="2" width="26" height="20" rx="8" fill="rgba(8,12,22,.82)" stroke="rgba(255,255,255,.4)"/><path d="M8.5 9h11M8.5 12h11M8.5 15h11" stroke="#e9e4d8" stroke-width="1.8" stroke-linecap="round"/></svg>`; }

function xboxFace(letter) {
  const c = { A: '#6be08a', B: '#ff7b7b', X: '#6fb0ff', Y: '#ffd35a' }[letter];
  return `<svg class="gl" viewBox="0 0 28 28" width="28" height="28"><circle cx="14" cy="14" r="12.6" fill="rgba(8,12,22,.82)" stroke="${c}" stroke-width="1.6"/><text x="14" y="19" text-anchor="middle" font-family="-apple-system,sans-serif" font-size="14" font-weight="700" fill="${c}">${letter}</text></svg>`;
}
function key(label) {
  const w = Math.max(26, 12 + label.length * 8.5);
  return `<svg class="gl" viewBox="0 0 ${w} 26" width="${w}" height="26"><rect x="1" y="1.5" width="${w - 2}" height="20" rx="5" fill="rgba(8,12,22,.82)" stroke="rgba(255,255,255,.45)"/><rect x="1" y="20" width="${w - 2}" height="4" rx="2" fill="rgba(255,255,255,.14)"/><text x="${w / 2}" y="15.5" text-anchor="middle" font-family="-apple-system,sans-serif" font-size="11.5" font-weight="700" fill="#e9e4d8">${label}</text></svg>`;
}

const TABLE = {
  ps: {
    climb: () => psFace('cross'), confirm: () => psFace('cross'), interact: () => psFace('circle'), back: () => psFace('circle'),
    pulse: () => psFace('square'), photo: () => psFace('triangle'), boost: () => pill('R2'), descend: () => pill('L2'),
    brake: () => pill('L1'), glide: () => pill('R1'), tabL: () => pill('L1'), tabR: () => pill('R1'),
    move: () => stick('L'), look: () => stick('R'), recenter: () => stick('R', true), pause: () => options(), map: () => create(), journal: () => touchpad(),
    dUp: () => dpad('up'), dDown: () => dpad('down'), dLeft: () => dpad('left'), dRight: () => dpad('right'), dpad: () => dpad(''), nav: () => stick('L'),
  },
  xbox: {
    climb: () => xboxFace('A'), confirm: () => xboxFace('A'), interact: () => xboxFace('B'), back: () => xboxFace('B'),
    pulse: () => xboxFace('X'), photo: () => xboxFace('Y'), boost: () => pill('RT'), descend: () => pill('LT'),
    brake: () => pill('LB'), glide: () => pill('RB'), tabL: () => pill('LB'), tabR: () => pill('RB'),
    move: () => stick('L'), look: () => stick('R'), recenter: () => stick('R', true), pause: () => pill('MENU', 46), map: () => pill('VIEW', 46), journal: () => pill('L3', 34),
    dUp: () => dpad('up'), dDown: () => dpad('down'), dLeft: () => dpad('left'), dRight: () => dpad('right'), dpad: () => dpad(''), nav: () => stick('L'),
  },
  kb: {
    climb: () => key('Space'), confirm: () => key('Enter'), interact: () => key('E'), back: () => key('Esc'),
    pulse: () => key('F'), photo: () => key('P'), boost: () => key('Shift'), descend: () => key('C'),
    brake: () => key('Q'), glide: () => key('G'), tabL: () => key('Q'), tabR: () => key('E'),
    move: () => key('WASD'), look: () => key('Mouse'), recenter: () => key('R'), pause: () => key('Esc'), map: () => key('M'), journal: () => key('J'),
    dUp: () => key('['), dDown: () => key(']'), dLeft: () => key(','), dRight: () => key('.'), dpad: () => key('Arrows'), nav: () => key('Arrows'),
  },
};

export function glyph(action, family = 'ps') {
  const f = TABLE[family] || TABLE.ps;
  const g = f[action] || TABLE.ps[action];
  return g ? g() : '';
}
export { pill, key };
