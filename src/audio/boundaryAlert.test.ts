import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("./core", () => ({ cancelAllChimes: vi.fn(), previewChime: vi.fn() }));
import { cancelAllChimes } from "./core";
import { boundaryAlert, createBoundaryAlert } from "./boundaryAlert";
beforeEach(() => { vi.useFakeTimers(); vi.clearAllMocks(); });
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); });

it("cancels queued re-chimes and speech work and is safe to stop repeatedly", async () => {
  const stop = vi.fn(), repeat = vi.fn(), speech = vi.fn();
  const alert = createBoundaryAlert(stop);
  alert.begin("focus", "break", repeat);
  alert.defer(speech, 6500);
  expect(vi.getTimerCount()).toBe(8);
  const first = alert.stop();
  expect(alert.stop()).toBe(first);
  await first;
  expect(stop).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
  vi.advanceTimersByTime(400_000);
  expect(repeat).not.toHaveBeenCalled(); expect(speech).not.toHaveBeenCalled();
  expect(alert.get()).toMatchObject({ ringing: false, silenced: true });
  alert.resumeTicks();
  expect(alert.get().silenced).toBe(false);
});
it("stops released page audio, browser speech, native speech and disarms the Mac alarm", async () => {
  const cancel = vi.fn(), cancelSpeech = vi.fn(), disarmAlarm = vi.fn();
  vi.stubGlobal("window", { speechSynthesis: { cancel }, desktop: { cancelSpeech, disarmAlarm } });
  boundaryAlert.begin("one", "two");
  await boundaryAlert.stop(); await boundaryAlert.stop();
  for (const fn of [cancelAllChimes, cancel, cancelSpeech, disarmAlarm]) expect(fn).toHaveBeenCalledOnce();
});
it("attempts every cancellation even if another channel throws", async () => {
  const disarmAlarm = vi.fn(), cancel = vi.fn();
  vi.stubGlobal("window", { speechSynthesis: { cancel }, desktop: { cancelSpeech: () => { throw new Error("already stopped"); }, disarmAlarm } });
  vi.mocked(cancelAllChimes).mockImplementationOnce(() => { throw new Error("already ended"); });
  boundaryAlert.begin("three", "four");
  await expect(boundaryAlert.stop()).resolves.toBeDefined();
  expect(cancel).toHaveBeenCalledOnce(); expect(disarmAlarm).toHaveBeenCalledOnce();
});
it("replaces old reminders at a new boundary and clears them on acknowledgement", () => {
  const repeat = vi.fn(), old = vi.fn();
  const alert = createBoundaryAlert(vi.fn());
  alert.begin("one", "two", old); alert.begin("two", "three", repeat);
  vi.advanceTimersByTime(60_000);
  expect(old).not.toHaveBeenCalled(); expect(repeat).toHaveBeenCalledOnce();
  alert.endReminders();
  expect(vi.getTimerCount()).toBe(0);
});

it("suppresses ticks only for twelve seconds after each chime, retaining the reminder between repeats", () => {
  const repeat = vi.fn(), alert = createBoundaryAlert(vi.fn());
  alert.begin("focus", "break", repeat);
  expect(alert.get()).toMatchObject({ ringing: true, sounding: true });
  vi.advanceTimersByTime(12_000);
  expect(alert.get()).toMatchObject({ ringing: true, sounding: false });
  vi.advanceTimersByTime(48_000);
  expect(repeat).toHaveBeenCalledOnce();
  expect(alert.get().sounding).toBe(true);
  vi.advanceTimersByTime(12_000);
  expect(alert.get()).toMatchObject({ ringing: true, sounding: false });
  vi.advanceTimersByTime(240_000);
  expect(repeat).toHaveBeenCalledTimes(5);
  expect(alert.get()).toMatchObject({ ringing: false, sounding: false });
});
