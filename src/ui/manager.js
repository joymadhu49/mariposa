// Screen stack for the UI: open, back, close all. Kept separate from ui.js to avoid an import cycle.
import { TitleScreen, PauseScreen, SettingsScreen, ControlsScreen, JournalScreen, MapScreen, PhotoScreen } from './screens.js';

const CLASSES = { pause: PauseScreen, settings: SettingsScreen, controls: ControlsScreen, journal: JournalScreen, map: MapScreen };

export function attachScreens(ui) {
  ui.stack = [];
  ui.current = null;
  ui.journalTab = 0;
  ui.title = new TitleScreen(ui);
  ui.photoScreen = new PhotoScreen(ui, 'photo');

  const show = (entry) => {
    const S = CLASSES[entry.name];
    const scr = new S(ui, entry.name);
    ui.current = scr;
    scr.open(entry.params || {});
    ui.game.audio.play('ui.open');
  };

  ui.open = (name, params = {}) => {
    if (ui.current) { ui.current.close(); ui.current = null; }
    ui.stack.push({ name, params });
    show(ui.stack[ui.stack.length - 1]);
  };
  ui.back = () => {
    if (ui.current) { ui.current.close(); ui.current = null; }
    ui.stack.pop();
    if (ui.stack.length) { show(ui.stack[ui.stack.length - 1]); ui.game.audio.play('ui.back'); }
    else ui.game.onScreensEmpty();
  };
  ui.closeAll = () => {
    if (ui.current) { ui.current.close(); ui.current = null; }
    ui.stack.length = 0;
  };
  ui.updateScreens = (dt, input) => {
    if (ui.current) ui.current.update(dt, input);
  };
}
