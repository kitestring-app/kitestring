// Fixed command names are the complete renderer menu surface.
const MENU_COMMANDS = Object.freeze(['settings', 'home', 'focus', 'ambient', 'tasks', 'sounds', 'notes', 'toggle', 'skip', 'reset', 'shortcuts', 'stopSound', 'stopAndPause', 'stop', 'endSession']);
const validMenuCommand = value => typeof value === 'string' && MENU_COMMANDS.includes(value);
const menuOrigin = event => event?.triggeredByAccelerator === true ? 'accelerator' : 'pointer';
function registerMenuCommands(ipc, trustedSender, dispatch) {
  ipc.on('desktop:menu-command', (event, command) => {
    if (trustedSender(event) && validMenuCommand(command)) dispatch(command);
  });
}
function applicationMenu({ command, showWindow, closeWindow, toggleTimer, floatingControls, park, openGitHub, timerState, globalStopRegistered = false }) {
  const item = (label, accelerator, value) => ({ label, accelerator, click: (_item, _window, event) => command(value, menuOrigin(event)) });
  const floatingItems = floatingControls.menu();
  return [
    { label: 'Kitestring', submenu: [
      { role: 'about' }, item('Settings…', 'Command+,', 'settings'), { type: 'separator' },
      floatingControls.appMenuItem(), ...floatingItems, { type: 'separator' },
      { role: 'services' }, { type: 'separator' },
      { role: 'hide', accelerator: 'Command+H' }, { role: 'hideOthers', accelerator: 'Alt+Command+H' }, { role: 'unhide' },
      { type: 'separator' }, { role: 'quit', accelerator: 'Command+Q' },
    ] },
    { role: 'editMenu' },
    { label: 'View', submenu: [
      { role: 'togglefullscreen', accelerator: 'Control+Command+F' }, { type: 'separator' },
      item('Home', 'Command+1', 'home'), item('Focus', 'Command+2', 'focus'), item('Ambient', 'Command+3', 'ambient'),
      { type: 'separator' }, item('Show Tasks', 'Command+Shift+T', 'tasks'),
      item('Sounds & music', 'Command+Shift+M', 'sounds'), item('Notepad', 'Command+Shift+N', 'notes'),
    ] },
    { label: 'Timer', submenu: [
      ...(timerState ? timerMenuItems(timerState, command, true, globalStopRegistered) : [
        { label: 'Start/Pause', accelerator: 'Command+Return', click: (_item, _window, event) => toggleTimer(menuOrigin(event)) },
        item('Skip', 'Command+]', 'skip'),
      ]),
      { ...item('Reset', 'Command+Shift+R', 'reset'), enabled: !timerState?.hardLocked, ...(timerState?.hardLocked ? { label: '🔒 Reset', toolTip: 'Hard mode: this block runs to the end' } : {}) },
      { ...floatingItems[0], label: 'Floating Timer', accelerator: 'Command+Shift+F' },
      // The global shortcut is registered by parking.cjs. Do not register it twice.
      { label: 'Park a Thought', accelerator: 'Alt+Command+P', registerAccelerator: false, click: park },
    ] },
    { label: 'Window', role: 'windowMenu', submenu: [
      { role: 'minimize', accelerator: 'Command+M' }, { role: 'zoom' },
      { label: 'Close', accelerator: 'Command+W', click: closeWindow }, { type: 'separator' },
      { role: 'front' }, { label: 'Show Kitestring', click: showWindow },
    ] },
    { role: 'help', submenu: [
      { label: 'Keyboard Shortcuts', click: () => command('shortcuts') },
      { label: 'Kitestring on GitHub', click: openGitHub },
    ] },
  ];
}
function validTimerState(value) {
  return value && typeof value === 'object' && ['focus', 'short', 'long'].includes(value.segment) &&
    ['running', 'hasProgress', 'ringing', 'sounding'].every(key => typeof value[key] === 'boolean') && (value.hardLocked === undefined || typeof value.hardLocked === 'boolean');
}
function timerMenuItems(state, command, appMenu = false, globalStopRegistered = false) {
  const breakTime = state.segment !== 'focus';
  const item = (label, value, accelerator) => ({ label, ...(appMenu && accelerator ? { accelerator } : {}), ...(state.hardLocked && value !== 'endSession' ? { label: `🔒 ${label}`, enabled: false, toolTip: 'Hard mode: this block runs to the end' } : {}), click: (_item, _window, event) => command(value, menuOrigin(event)) });
  const stop = { label: 'Stop Sound', ...(appMenu ? { accelerator: 'Command+.' } : {}), click: (_item, _window, event) => command('stopSound', menuOrigin(event)), enabled: state.ringing,
    ...(appMenu ? { registerAccelerator: !globalStopRegistered } : {}) };
  return [
    ...(state.ringing || appMenu ? [stop] : []),
    ...(state.ringing ? [item('Stop and Pause', 'stopAndPause')] : []),
    item(breakTime ? state.running ? 'Pause Break' : state.hasProgress ? 'Resume Break' : 'Start Break' : state.running ? 'Pause' : state.hasProgress ? 'Resume' : 'Start', 'toggle', 'Command+Return'),
    item(breakTime ? 'Skip Break' : 'Skip', 'skip', 'Command+]'),
    item(breakTime ? 'End Break and Stop' : 'Stop', 'stop'),
    ...(state.hardLocked ? [item('End session…', 'endSession')] : []),
  ];
}
module.exports = { timerMenuItems, validTimerState, MENU_COMMANDS, validMenuCommand, registerMenuCommands, applicationMenu };
