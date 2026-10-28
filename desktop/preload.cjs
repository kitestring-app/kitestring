const { contextBridge, ipcRenderer } = require('electron');

const mini = process.argv.includes('--mini-timer');
const validTimerCommand = value => typeof value === 'string' ? ['toggle', 'pause', 'reset', 'skip', 'stop', 'stopSound', 'stopAndPause', 'beginEndHold', 'cancelEndHold'].includes(value) : !!value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 2 && value.action === 'endHardSession' && typeof value.reason === 'string' && value.reason.length <= 500;
function subscribe(channel, callback) {
  if (typeof callback !== 'function') return () => {};
  const listener = (_event, value) => callback(value);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}
const floatTimer = (open) => typeof open === 'boolean' ? ipcRenderer.invoke('desktop:float-timer', open) : Promise.resolve(false);
contextBridge.exposeInMainWorld('desktop', Object.freeze(mini ? {
  mini: true,
  onTimerState: (callback) => subscribe('desktop:timer-state', callback),
  requestTimerState: () => ipcRenderer.send('desktop:timer-state-request'),
  audioControl: (value) => ipcRenderer.send('desktop:audio-control', value),
  requestAudioState: () => ipcRenderer.send('desktop:audio-request'),
  onAudioState: (callback) => subscribe('desktop:audio-state', callback),
  floatTimer: (open) => open === false ? floatTimer(false) : Promise.resolve(false),
  showMain: () => ipcRenderer.send('desktop:show-main'),
  timerControl: (action) => { if (validTimerCommand(action) || action === 'endSession') return ipcRenderer.invoke('desktop:timer-control', action); return Promise.resolve({ ok: false, reason: 'invalid-command' }); },
} : {
  platform: process.platform,
  getFullScreen: () => ipcRenderer.invoke('desktop:get-fullscreen'),
  onFullScreenChange: (callback) => subscribe('desktop:fullscreen-state', value => { if (typeof value === 'boolean') callback(value); }),
  cloud: Object.freeze({
    signIn: (email, password) => ipcRenderer.invoke('desktop:cloud-signIn', email, password),
    signOut: () => ipcRenderer.invoke('desktop:cloud-signOut'),
    status: () => ipcRenderer.invoke('desktop:cloud-status'),
    request: (method, path, body) => ipcRenderer.invoke('desktop:cloud-request', method, path, body),
    openReset: () => ipcRenderer.invoke('desktop:cloud-reset'),
  }),
  getSecureDns: () => ipcRenderer.invoke('desktop:dns-get'),
  setSecureDns: (url) => ipcRenderer.invoke('desktop:dns-set', url),
  setFloatingPreferences: (value) => ipcRenderer.invoke('desktop:floating-preferences', value),
  onFloatingPreferences: (callback) => subscribe('desktop:floating-preferences', callback),
  publishAudioState: (value) => ipcRenderer.send('desktop:audio-state', value),
  onAudioAction: (callback) => subscribe('desktop:audio-action', callback),
  onAudioRequest: (callback) => subscribe('desktop:audio-request', callback),
  onMenuCommand: (callback) => subscribe('desktop:menu-command', value => {
    if (['settings', 'home', 'focus', 'ambient', 'tasks', 'sounds', 'notes', 'toggle', 'skip', 'reset', 'shortcuts', 'stop', 'stopSound', 'stopAndPause', 'endSession'].includes(value)) callback(value);
  }),
  parkingStatus: () => ipcRenderer.invoke('desktop:parking-status'),
  toggleFullScreen: () => ipcRenderer.invoke('desktop:toggle-fullscreen'),
  onFullScreenTransition: (callback) => subscribe('desktop:fullscreen-transition', value => { if (value === 'start' || value === 'end') callback(value); }),
  consumeSuspensionAt: () => { const value = ipcRenderer.sendSync('desktop:consume-suspension-at'); return value && typeof value.at === 'number' && Number.isFinite(value.at) && typeof value.suspended === 'boolean' ? { at: value.at, suspended: value.suspended } : null; },
  consumeSuspension: () => ipcRenderer.sendSync('desktop:consume-suspension') === true,
  onLifecycle: (callback) => subscribe('desktop:lifecycle', value => { if (value === 'resume' || value === 'activate' || value === 'suspend') callback(value); }),
  onParked: (callback) => subscribe('desktop:parked', callback),
  publishTimerState: (value) => ipcRenderer.send('desktop:timer-state', value),
  setStatus(text) {
    if (typeof text === 'string') ipcRenderer.send('desktop:status', text.slice(0, 64));
  },
  attention(kind) {
    if (kind === 'focus-done' || kind === 'break-over') ipcRenderer.send('desktop:attention', kind);
  },
  release() { ipcRenderer.send('desktop:release'); },
  floatTimer,
  onFloatTimer: (callback) => subscribe('desktop:floating-state', callback),
  armAlarm: (alarm) => ipcRenderer.invoke('desktop:arm-alarm', alarm),
  disarmAlarm: () => ipcRenderer.send('desktop:disarm-alarm'),
  speak: (input) => ipcRenderer.invoke('desktop:speak', input),
  cancelSpeech: () => ipcRenderer.send('desktop:cancel-speech'),
  notificationStatus: () => ipcRenderer.invoke('desktop:notification-status'),
  testReminder: () => ipcRenderer.invoke('desktop:test-reminder'),
  preventSleep: (on) => { if (typeof on === 'boolean') ipcRenderer.send('desktop:prevent-sleep', on); },
  onTimerRequest: (callback) => subscribe('desktop:timer-request', ({ id, command, origin }) => {
    if (!validTimerCommand(command) || (origin !== undefined && !['accelerator', 'pointer'].includes(origin))) return;
    Promise.resolve().then(() => callback(command, origin)).then(result => ipcRenderer.send('desktop:timer-result', id, result))
      .catch(() => ipcRenderer.send('desktop:timer-result', id, { ok: false, reason: 'stale-segment' }));
  }),
  onTimerAction: (callback) => subscribe('desktop:timer-action', callback),
  onFlush: (callback) => subscribe('desktop:flush', (id) => {
    Promise.resolve().then(callback).then(() => ipcRenderer.send('desktop:flushed', id)).catch(() => {});
  }),
}));

// Native probes for our throwaway packaged smoke process only. They add no
// keys to the public bridge and are absent in normal runs.
if (!mini && process.argv.includes('--smoke-test')) {
  contextBridge.exposeInMainWorld('__desktopSmokeDiagnostics', () => ipcRenderer.invoke('desktop:smoke-diagnostics'));
  contextBridge.exposeInMainWorld('__desktopSmokeFocus', () => ipcRenderer.send('desktop:smoke-focus'));
  contextBridge.exposeInMainWorld('__desktopSmokePark', () => ipcRenderer.send('desktop:smoke-park'));
  contextBridge.exposeInMainWorld('__desktopSmokeQuit', () => ipcRenderer.send('desktop:smoke-quit'));
  contextBridge.exposeInMainWorld('__desktopSmokeClose', () => ipcRenderer.send('desktop:smoke-close'));
  contextBridge.exposeInMainWorld('__desktopSmokeState', () => ipcRenderer.sendSync('desktop:smoke-state'));
}
