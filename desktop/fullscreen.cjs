// Native events also cover the View menu and the green traffic light.
function attachFullscreen(window) {
  let transitioning = false;
  let settled = window.isFullScreen();
  let repair, safety;
  const end = () => {
    clearTimeout(repair); clearTimeout(safety);
    repair = safety = undefined;
    transitioning = false;
    if (window.isDestroyed()) return;
    settled = window.isFullScreen();
    window.webContents.send('desktop:fullscreen-state', settled);
    send('end');
  };
  const armSafety = () => { if (safety === undefined) safety = setTimeout(end, 2500); };
  const send = phase => window.webContents.send('desktop:fullscreen-transition', phase);
  const start = () => {
    if (transitioning) return;
    transitioning = true;
    armSafety();
    send('start');
  };
  for (const name of ['will-enter-full-screen', 'will-leave-full-screen']) window.on(name, start);
  // Electron 45 has no public will-full-screen events. Native menu/traffic-light
  // changes are observable when the fullscreen state flips during resize.
  const resized = () => {
    if (!transitioning && window.isFullScreen() !== settled) start();
    else if (transitioning && repair === undefined && window.isFullScreen() === settled) end();
  };
  window.on('will-resize', resized);
  window.on('resize', resized);
  for (const name of ['enter-full-screen', 'leave-full-screen']) window.on(name, () => {
    transitioning = true;
    armSafety();
    clearTimeout(repair);
    repair = setTimeout(() => {
      if (window.isDestroyed()) return;
      // Chromium can retain the fullscreen viewport after leaving the Space.
      if (name === 'leave-full-screen' && typeof window.getSize === 'function') {
        const [w, h] = window.getSize();
        window.setSize(w, h + 1); window.setSize(w, h);
      }
      window.webContents.invalidate?.();
      end();
    }, 60);
  });
  window.once('closed', () => { clearTimeout(repair); clearTimeout(safety); transitioning = false; });
  return {
    isTransitioning: () => transitioning,
    toggle() {
      if (transitioning) return window.isFullScreen();
      const next = !window.isFullScreen();
      // Lock before setFullScreen: macOS reports the old state until completion.
      start();
      window.setFullScreen(next);
      return next;
    },
  };
}
module.exports = { attachFullscreen };
