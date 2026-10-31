// Keep the cleanup obligation separate from its timer so repeated Show cannot lose it.
function createShowWorkspaces({ isAttentionActive, isTransitioning, setTimer = setTimeout, clearTimer = clearTimeout }) {
  let pending = null;
  function cancel() {
    if (!pending) return;
    const request = pending;
    pending = null;
    clearTimer(request.timer);
    request.window.removeListener('leave-full-screen', request.reset);
    request.window.removeListener('closed', cancel);
  }
  function schedule(request, delay) {
    clearTimer(request.timer);
    request.timer = setTimer(request.reset, delay);
    request.timer.unref?.();
  }
  function join(window) {
    if (pending && pending.window !== window) cancel();
    // A full-screen Show must preserve an earlier cleanup, without acquiring a new one.
    if (window.isFullScreen()) return;
    window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true });
    if (!pending) {
      const request = { window, timer: undefined, reset: () => {
        if (pending !== request) return;
        if (window.isDestroyed() || isAttentionActive()) { cancel(); return; }
        if (window.isFullScreen()) { window.once('leave-full-screen', request.reset); return; }
        if (isTransitioning()) { schedule(request, 60); return; }
        window.setVisibleOnAllWorkspaces(false, { skipTransformProcessType: true });
        cancel();
      } };
      pending = request;
      window.once('closed', cancel);
    }
    window.removeListener('leave-full-screen', pending.reset);
    schedule(pending, 250);
  }
  return { join, cancel };
}
module.exports = { createShowWorkspaces };
