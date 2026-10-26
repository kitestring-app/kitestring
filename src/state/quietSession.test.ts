import { afterEach, expect, it, vi } from "vitest";
vi.hoisted(() => { vi.stubGlobal("navigator", {}); });
vi.mock("../audio/core", () => ({ cancelAllChimes: vi.fn(), previewChime: vi.fn(), playTimerTick: vi.fn(), cancelChime: vi.fn(), cancelEnd: vi.fn(), releaseChime: vi.fn(), scheduleChime: vi.fn(), scheduleEnd: vi.fn() }));
vi.mock("../audio/companion", () => ({ armCompanionWithSpeech: vi.fn().mockResolvedValue(false), cancelCompanionSpeech: vi.fn(), companionAvailable: vi.fn().mockResolvedValue(false), companionKnownUp: vi.fn(() => false), disarmCompanion: vi.fn() }));
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.resetModules(); vi.clearAllMocks(); });
async function setup(native: boolean) {
  vi.stubGlobal("navigator", {});
  vi.stubGlobal("BroadcastChannel", undefined);
  const s = await import("./settings"); const state = await import("./timer");
  const parked = await import("./parked");
  await Promise.all([s.calmFoundationReady, state.timer.ready, parked.parked.ready]);
  vi.useFakeTimers(); vi.setSystemTime(100_000);
  const desktop = { armAlarm: vi.fn().mockResolvedValue(true), disarmAlarm: vi.fn().mockResolvedValue(undefined), cancelSpeech: vi.fn(), attention: vi.fn(), release: vi.fn() };
  const speech = { cancel: vi.fn(), speak: vi.fn() }; const Notification = vi.fn();
  Object.assign(Notification, { permission: "granted", requestPermission: vi.fn() });
  vi.stubGlobal("Notification", Notification);
  vi.stubGlobal("window", { desktop: native ? desktop : undefined, speechSynthesis: speech, Notification, addEventListener: vi.fn() });
  vi.stubGlobal("document", { visibilityState: "visible", addEventListener: vi.fn() });
  s.settings.set({ ...s.DEFAULT_SETTINGS, timer: { ...s.DEFAULT_SETTINGS.timer, ...s.CALM_PATCH } });
  const { INITIAL_TIMER } = await import("./timerEngine");
  state.timer.set({ ...INITIAL_TIMER, segId: "quiet", frozen: true, frozenTotal: 60_000 });
  state.startTicker(); await Promise.resolve();
  vi.clearAllMocks();
  return { s, ...state, ...parked, desktop, speech, Notification };
}
it.each([false, true])('V11: Calm full focus, break and pause stay quiet on native=%s', async native => {
  const q = await setup(native);
  q.timerActions.start(); await vi.advanceTimersByTimeAsync(30_000); q.timerActions.pause();
  expect(q.interruptionPrompt.get()).toBeNull();
  q.timerActions.start(); await vi.advanceTimersByTimeAsync(30_250);
  expect(q.timer.get().startedAt).toBeNull();
  const { transitionStore } = await import("../ui/timer/TransitionStore"); expect(transitionStore.get()).toBeNull();
  q.timerActions.start(); await vi.advanceTimersByTimeAsync(5 * 60_000 + 350_000);
  const core = await import("../audio/core"); const companion = await import("../audio/companion");
  expect(core.scheduleChime).not.toHaveBeenCalled(); expect(core.previewChime).not.toHaveBeenCalled();
  expect(core.playTimerTick).not.toHaveBeenCalled(); expect(companion.armCompanionWithSpeech).not.toHaveBeenCalled();
  expect(q.desktop.armAlarm).not.toHaveBeenCalled(); expect(q.desktop.attention).not.toHaveBeenCalled();
  expect(q.speech.speak).not.toHaveBeenCalled(); expect(q.Notification).not.toHaveBeenCalled();
});
it.each([false, true])('V11: switching to Calm just before expiry cancels previous reminders and repeats on native=%s', async native => {
  const q = await setup(native); const { boundaryAlert } = await import("../audio/boundaryAlert");
  const repeats = vi.fn(); boundaryAlert.begin("old", "quiet", repeats);
  q.s.settings.set(q.s.DEFAULT_SETTINGS); q.timerActions.start();
  await vi.advanceTimersByTimeAsync(59_000);
  q.s.settingsUpdate("timer", q.s.CALM_PATCH); await Promise.resolve();
  await vi.advanceTimersByTimeAsync(7 * 60_000);
  expect(repeats).not.toHaveBeenCalled();
  const companion = await import("../audio/companion"); expect(companion.disarmCompanion).toHaveBeenCalled();
  expect(q.speech.cancel).toHaveBeenCalled();
  if (native) expect(q.desktop.release).toHaveBeenCalled(); else expect(q.desktop.release).not.toHaveBeenCalled();
  const { transitionStore } = await import("../ui/timer/TransitionStore"); expect(transitionStore.get()).toBeNull();
});
it.each([false, true])('R12: native arm resolving false or rejecting is visible, and expiry still settles (%s)', async rejects => {
  const q = await setup(true);
  if (rejects) q.desktop.armAlarm.mockRejectedValue(new Error("IPC unavailable")); else q.desktop.armAlarm.mockResolvedValue(false);
  q.s.settings.set(q.s.DEFAULT_SETTINGS); q.timerActions.start(); await Promise.resolve(); await Promise.resolve();
  expect(q.reminderStatus.get()).toContain("Native reminder unavailable");
  // A failed reminder does not stop the timer from settling on the ordinary ticker.
  await vi.advanceTimersByTimeAsync(60_250); expect(q.timer.get().segId).not.toBe("quiet");
});

it("V11: Calm disarms the future native alarm even when Stop sound already silenced this boundary", async () => {
  const q = await setup(true); const { boundaryAlert } = await import("../audio/boundaryAlert");
  q.s.settings.set({ ...q.s.DEFAULT_SETTINGS, timer: { ...q.s.DEFAULT_SETTINGS.timer, autoRun: "always" } });
  q.timerActions.start(); await vi.advanceTimersByTimeAsync(60_250);
  await q.timerActions.stopSound(); expect(boundaryAlert.get().silenced).toBe(true);
  expect(q.desktop.armAlarm).toHaveBeenCalled();
  const companion = await import("../audio/companion"); vi.mocked(companion.disarmCompanion).mockClear();
  q.s.settingsUpdate("timer", q.s.CALM_PATCH);
  expect(companion.disarmCompanion).toHaveBeenCalled();
});

const liveAlertChoices = [
  { sound: true, speak: true, notify: true, attention: true },
  { sound: true, speak: false, notify: false, attention: false },
  { sound: false, speak: true, notify: false, attention: false },
  { sound: false, speak: false, notify: true, attention: false },
  { sound: false, speak: false, notify: false, attention: true },
];
for (const native of [false, true]) it.each(liveAlertChoices)(`PR2 C7: live completion keeps independently enabled alerts with takeover off (native=${native}, %j)`, async choice => {
  const q = await setup(native);
  vi.stubGlobal("SpeechSynthesisUtterance", class { text: string; constructor(text: string) { this.text = text; } });
  q.s.settings.set({ ...q.s.DEFAULT_SETTINGS, timer: { ...q.s.DEFAULT_SETTINGS.timer, takeover: false, autoRun: "off",
    focusDoneSound: choice.sound ? "bell" : "none", alertVolume: 0.6, speak: choice.speak, notify: choice.notify, bringToFront: choice.attention } });
  q.timerActions.start(); await Promise.resolve();
  const core = await import("../audio/core");
  if (native) {
    expect(q.desktop.armAlarm).toHaveBeenLastCalledWith(expect.objectContaining({ alertSound: choice.sound ? "bell" : "none", volume: choice.sound ? 0.6 : 0, speak: choice.speak, notify: choice.notify, attention: choice.attention }));
    expect(core.scheduleChime).not.toHaveBeenCalled();
  } else if (choice.sound) expect(core.scheduleChime).toHaveBeenCalledWith("bell", 0.6, 60, "focus-done");
  vi.mocked(core.cancelAllChimes).mockClear(); q.desktop.disarmAlarm.mockClear(); q.desktop.release.mockClear();
  await vi.advanceTimersByTimeAsync(60_000);
  expect(q.timer.get()).toMatchObject({ startedAt: null, boundary: { missed: false } });
  expect(core.releaseChime).toHaveBeenCalled();
  expect(core.cancelAllChimes).not.toHaveBeenCalled();
  expect(q.desktop.disarmAlarm).not.toHaveBeenCalled();
  expect(q.desktop.release).not.toHaveBeenCalled();
  expect(q.desktop.attention).toHaveBeenCalledTimes(native && choice.attention ? 1 : 0);
  expect(q.Notification).toHaveBeenCalledTimes(!native && choice.notify ? 1 : 0);
  const { boundaryAlert } = await import("../audio/boundaryAlert");
  expect(boundaryAlert.get().ringing).toBe(choice.sound || choice.speak);
  await vi.advanceTimersByTimeAsync(7000);
  expect(q.speech.speak).toHaveBeenCalledTimes(!native && choice.speak ? 1 : 0);
  expect((await import("../ui/timer/TransitionStore")).transitionStore.get()).toBeNull();
});

it.each([false, true])("PR2 C7: missed completion cancels enabled reminders and stays quiet (native=%s)", async native => {
  const q = await setup(native);
  q.s.settings.set({ ...q.s.DEFAULT_SETTINGS, timer: { ...q.s.DEFAULT_SETTINGS.timer, takeover: false, autoRun: "off" } });
  q.timerActions.start(); await Promise.resolve();
  vi.clearAllMocks();
  vi.setSystemTime(Date.now() + 120_000);
  q.checkRecoveryLifecycle(true);
  expect(q.timer.get()).toMatchObject({ startedAt: null, boundary: { missed: true } });
  await vi.advanceTimersByTimeAsync(7000);
  expect(q.desktop.attention).not.toHaveBeenCalled(); expect(q.Notification).not.toHaveBeenCalled(); expect(q.speech.speak).not.toHaveBeenCalled();
  expect((await import("../audio/core")).cancelAllChimes).toHaveBeenCalled();
  expect((await import("../audio/boundaryAlert")).boundaryAlert.get().ringing).toBe(false);
});
