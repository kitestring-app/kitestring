export const END_HOLD_MS = 10_000;

/** One continuous hold. Release, focus loss and cancellation discard all progress. */
export function createEndHold(onProgress: (ms: number) => void, onComplete: () => void) {
  let at: number | null = null;
  let interval: ReturnType<typeof setInterval> | undefined;
  const cancel = () => { clearInterval(interval); interval = undefined; at = null; onProgress(0); };
  return {
    start() {
      if (at !== null) return;
      at = performance.now();
      interval = setInterval(() => {
        if (at === null) return;
        const elapsed = Math.min(END_HOLD_MS, performance.now() - at);
        onProgress(elapsed);
        if (elapsed >= END_HOLD_MS) { clearInterval(interval); interval = undefined; onComplete(); }
      }, 100);
    },
    cancel,
    release() { if (at !== null && performance.now() - at < END_HOLD_MS) cancel(); },
  };
}
