import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.hoisted(() => { vi.stubGlobal("navigator", {}); vi.stubGlobal("BroadcastChannel", undefined); });
vi.mock("../audio/core", () => ({ cancelAllChimes: vi.fn(), playTimerTick: vi.fn(), cancelChime: vi.fn(), cancelEnd: vi.fn(), releaseChime: vi.fn(), scheduleChime: vi.fn(), scheduleEnd: vi.fn() }));
vi.mock("../audio/startChime", async original => ({ ...await original<typeof import("../audio/startChime")>(), playStartChime: vi.fn() }));
import { playStartChime } from "../audio/startChime";
import { calmFoundationReady, DEFAULT_SETTINGS, DEFAULT_LOCAL_PREFERENCES, localPreferences, settings } from "./settings";
import { INITIAL_TIMER } from "./timerEngine";
import { timer, timerActions, startTinyBlock } from "./timer";
import { alertTypingGuard } from "../lib/alertTypingGuard";
beforeEach(async () => {
  await calmFoundationReady; await timer.ready;
  vi.stubGlobal("window", { desktop: {} });
  settings.set({ ...DEFAULT_SETTINGS, timer: { ...DEFAULT_SETTINGS.timer, notify: false } });
  localPreferences.set(DEFAULT_LOCAL_PREFERENCES);
  timer.set({ ...INITIAL_TIMER, segId: "cue-test" });
  vi.useFakeTimers(); vi.setSystemTime(2_000_000);
  vi.clearAllMocks();
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.clearAllMocks(); });
it("explicit start plays once despite typing guard; pause at zero and restore stay silent", () => {
  alertTypingGuard.begin();
  timerActions.start(); timerActions.start();
  expect(playStartChime).toHaveBeenCalledExactlyOnceWith("bubble", DEFAULT_SETTINGS.timer.alertVolume);
  timerActions.pause(); timerActions.start();
  expect(playStartChime).toHaveBeenCalledTimes(1);
  timer.set({ ...timer.get(), startedAt: Date.now() }); // Same incoming running snapshot after reload/sync.
  expect(playStartChime).toHaveBeenCalledTimes(1);
});
it("auto-run focus and manual breaks do not chime", () => {
  settings.set({ ...settings.get(), timer: { ...settings.get().timer, autoRun: "always" } });
  timer.set({ ...INITIAL_TIMER, segment: "short", segId: "break" });
  timerActions.start(); vi.setSystemTime(Date.now() + DEFAULT_SETTINGS.timer.lengths.short * 60_000); timerActions.complete("break");
  expect(timer.get().segment).toBe("focus");
  expect(timer.get().startedAt).not.toBeNull();
  expect(playStartChime).not.toHaveBeenCalled();
});
it("tiny start gets one cue, including a custom preset", () => {
  settings.set({ ...settings.get(), timer: { ...settings.get().timer, startChimeSound: "music-box" } });
  expect(startTinyBlock("cue-test", 5)).toBe(true);
  expect(startTinyBlock("cue-test", 5)).toBe(false);
  expect(playStartChime).toHaveBeenCalledExactlyOnceWith("music-box", DEFAULT_SETTINGS.timer.alertVolume);
});
it.each(["off", "mute", "none", "zero"])("%s suppresses the actual Start side effect", mode => {
  if (mode === "mute") localPreferences.set({ ...DEFAULT_LOCAL_PREFERENCES, muted: true });
  else settings.set({ ...settings.get(), timer: { ...settings.get().timer,
    ...(mode === "off" ? { startChime: false } : mode === "zero" ? { alertVolume: 0 } : { focusDoneSound: "none", breakOverSound: "none" }) } });
  timerActions.start(); expect(playStartChime).not.toHaveBeenCalled();
});
it("receiving a running block never produces a second cue", () => {
  timer.set({ ...INITIAL_TIMER, segId: "other-device", startedAt: Date.now(), frozen: true, frozenTotal: 60_000 });
  timerActions.start();
  expect(playStartChime).not.toHaveBeenCalled();
});
