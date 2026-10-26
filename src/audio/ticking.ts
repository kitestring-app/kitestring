import type { Settings } from "../state/settings";
import type { TimerState } from "../state/timerEngine";
import { elapsed } from "../state/timerEngine";

/** One audio-clock loop per segment, with no page-timer callbacks between ticks. */
export function createTickScheduler(play: (style: Settings["timer"]["tickStyle"], volume: number, delay: number, duration: number) => (() => void) | void,
  now = () => Date.now()) {
  let stopVoice: (() => void) | void;
  let key = "";
  const stop = () => { stopVoice?.(); stopVoice = undefined; key = ""; };
  return {
    stop,
    sync(s: TimerState, total: number | null, t: Settings["timer"], quiet: boolean) {
      const enabled = t.ticking === "both" || (s.segment === "focus" ? t.ticking === "focus" : t.ticking === "breaks");
      const e = elapsed(s, now());
      if (quiet || !enabled || s.startedAt === null || t.alertVolume <= 0 || t.tickVolume <= 0 || (total !== null && e >= total)) return stop();
      const nextKey = `${s.segId}:${s.startedAt}:${s.elapsedBefore}:${total}:${t.tickStyle}:${t.tickVolume}`;
      if (key === nextKey) return;
      stop(); key = nextKey;
      const phase = total === null ? e % 1000 : (total - e) % 1000;
      const delay = (total === null ? 1000 - phase : phase || 1000) / 1000;
      const duration = total === null ? Infinity : (total - e) / 1000 - delay;
      // Exclude the boundary tick, even if the renderer has not woken up yet.
      if (duration > 0) stopVoice = play(t.tickStyle, t.tickVolume, delay, duration);
    },
  };
}
