import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createTickScheduler } from "./ticking";
import { DEFAULT_SETTINGS } from "../state/settings";
import { INITIAL_TIMER } from "../state/timerEngine";
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(0); });
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });
const settings = { ...DEFAULT_SETTINGS.timer, ticking: "both" as const };
const state = { ...INITIAL_TIMER, startedAt: 0 };
it("arms one loop aligned to remaining time, ending before the boundary without page timers", () => {
  const play = vi.fn(), clock = createTickScheduler(play);
  clock.sync(state, 3250, settings, false);
  expect(play).toHaveBeenCalledExactlyOnceWith(settings.tickStyle, settings.tickVolume, 0.25, 3);
  expect(vi.getTimerCount()).toBe(0);
  vi.advanceTimersByTime(60_000); // No JS callback is needed to play subsequent ticks.
  expect(play).toHaveBeenCalledOnce();
  clock.sync(state, 3250, settings, false);
  expect(play).toHaveBeenCalledOnce();
});
it("cancels the audio loop on pause and aligns resume with banked elapsed time", () => {
  const cancel = vi.fn(), play = vi.fn(() => cancel), clock = createTickScheduler(play);
  clock.sync(state, 5000, settings, false);
  vi.advanceTimersByTime(1250);
  clock.sync({ ...state, startedAt: null, elapsedBefore: 1250 }, 5000, settings, false);
  expect(cancel).toHaveBeenCalledOnce();
  clock.sync({ ...state, startedAt: Date.now(), elapsedBefore: 1250 }, 5000, settings, false);
  expect(play).toHaveBeenLastCalledWith(settings.tickStyle, settings.tickVolume, 0.75, 3);
  clock.sync({ ...state, startedAt: Date.now(), elapsedBefore: 1250 }, 5000, settings, false);
  expect(play).toHaveBeenCalledTimes(2);
});
it("aligns unlimited stopwatch ticking to elapsed time", () => {
  const play = vi.fn(), clock = createTickScheduler(play);
  vi.setSystemTime(1375); clock.sync(state, null, settings, false);
  expect(play).toHaveBeenCalledWith(settings.tickStyle, settings.tickVolume, 0.625, Infinity);
});
it.each(["off", "breaks", "focus", "both"] as const)("selects the requested segments for %s", ticking => {
  const play = vi.fn(), clock = createTickScheduler(play);
  for (const segment of ["focus", "short", "long"] as const) {
    play.mockClear(); clock.stop();
    clock.sync({ ...state, segment }, 10_000, { ...settings, ticking }, false);
    expect(play.mock.calls.length).toBe(ticking === "both" || (segment === "focus" ? ticking === "focus" : ticking === "breaks") ? 1 : 0);
  }
});
it("respects Off, alert-volume mute, quiet mode and Stop sound suppression", () => {
  const play = vi.fn(), clock = createTickScheduler(play);
  for (const [t, quiet] of [[DEFAULT_SETTINGS.timer, false], [{ ...settings, alertVolume: 0 }, false], [settings, true]] as const) {
    clock.sync(state, 10_000, t, quiet);
  }
  expect(play).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
});

it("cancels an active loop during each chime and rearms the same segment when it becomes quiet", () => {
  const cancel = vi.fn(), play = vi.fn(() => cancel), clock = createTickScheduler(play);
  clock.sync(state, 300_000, settings, false);
  clock.sync(state, 300_000, settings, true);
  expect(cancel).toHaveBeenCalledOnce();
  vi.setSystemTime(12_000);
  clock.sync(state, 300_000, settings, false);
  expect(play).toHaveBeenLastCalledWith(settings.tickStyle, settings.tickVolume, 1, 287);
  vi.setSystemTime(60_000);
  clock.sync(state, 300_000, settings, true);
  expect(cancel).toHaveBeenCalledTimes(2);
});
