const path = require('node:path');
const { statSync } = require('node:fs');

function prepareIdentity(app) {
  app.setName('Kitestring');
  const support = app.getPath('appData');
  const legacyNames = ['Custom Pomodoro', 'custom-pomodoro-desktop'];
  let directory = path.join(support, 'Kitestring');
  if (app.commandLine.hasSwitch('user-data-dir')) {
    directory = path.resolve(app.commandLine.getSwitchValue('user-data-dir'));
  } else {
    for (const name of legacyNames) {
      const legacy = path.join(support, name);
      try { if (statSync(legacy).isDirectory()) { directory = legacy; break; } } catch { /* Try the next historical folder. */ }
    }
  }
  // Pin before the single-instance lock, sessions, or any storage reader.
  app.setPath('userData', directory);
  // Electron 45 captures this name for macOS Keychain in PostCreateMainMessageLoop.
  // The old package name was custom-pomodoro-desktop. Keep its encryption identity for existing cloud-session.enc files. The visible
  // name is restored in whenReady, before menus and windows are created.
  app.setName('custom-pomodoro-desktop');
}

module.exports = { prepareIdentity };
