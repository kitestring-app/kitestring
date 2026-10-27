import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ALERT_SOUNDS } from "../audio/alertSynth";

vi.mock("../audio/core", () => ({ cancelAllChimes: vi.fn(), playTimerTick: vi.fn(), previewChime: vi.fn(), cancelChime: vi.fn(), cancelEnd: vi.fn(), releaseChime: vi.fn(), scheduleChime: vi.fn(), scheduleEnd: vi.fn() }));
vi.mock("../audio/companion", () => ({ armCompanionWithSpeech: vi.fn(), cancelCompanionSpeech: vi.fn(), companionAvailable: vi.fn().mockResolvedValue(false), companionKnownUp: vi.fn(() => false), disarmCompanion: vi.fn() }));
vi.mock("./stats", () => ({ logChunk: vi.fn() }));
const armAlarm = vi.fn().mockResolvedValue(true), disarmAlarm = vi.fn(), speech = vi.fn(), attention = vi.fn();

beforeEach(() => {
  vi.stubGlobal("BroadcastChannel", undefined);
  vi.resetModules();
  vi.useFakeTimers(); vi.setSystemTime(2_000_000); vi.clearAllMocks();
  vi.stubGlobal("navigator", {});
  vi.stubGlobal("window", { desktop: { armAlarm, disarmAlarm, attention }, addEventListener: vi.fn(), speechSynthesis: { speak: speech } });
  vi.stubGlobal("document", { addEventListener: vi.fn() });
});
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); });
async function setup(follower = false) {
  const t = await import("./timer");
  const { settings, DEFAULT_SETTINGS } = await import("./settings");
  const { tasks } = await import("./tasks");
  await Promise.all([t.timer.ready, settings.ready, tasks.ready]);
  settings.set({ ...DEFAULT_SETTINGS, timer: { ...DEFAULT_SETTINGS.timer, autoRun: "always" } });
  t.timer.set({ ...(await import("./timerEngine")).INITIAL_TIMER, segId: "native-test" });
  t.startTicker({ follower });
  return { ...t, settings };
}
it.each(ALERT_SOUNDS)("arms and refreshes native alarms with the selected %s sound", async (alertSound) => {
  const { timerActions, settings } = await setup();
  timerActions.start();
  const at = armAlarm.mock.calls.at(-1)![0].at;
  settings.set({ ...settings.get(), timer: { ...settings.get().timer, alertSound, focusDoneSound: alertSound, breakOverSound: alertSound } });
  expect(armAlarm).toHaveBeenLastCalledWith(expect.objectContaining({ at, alertSound }));
  timerActions.goTo("short");
  timerActions.start();
  expect(armAlarm).toHaveBeenLastCalledWith(expect.objectContaining({ kind: "break-over", alertSound }));
});
it("uses one native alarm for sound, notification, attention and auto-run speech", async () => {
  const { timerActions, totalMs } = await setup();
  timerActions.start();
  expect(armAlarm).toHaveBeenLastCalledWith(expect.objectContaining({ at: Date.now() + totalMs()!, kind: "focus-done", speak: true, notify: true, attention: true, announcement: { phase: "break", minutes: 5 } }));
  const core = await import("../audio/core");
  const companion = await import("../audio/companion");
  expect(core.scheduleChime).not.toHaveBeenCalled();
  expect(core.scheduleEnd).not.toHaveBeenCalled();
  expect(companion.armCompanionWithSpeech).not.toHaveBeenCalled();
  vi.advanceTimersByTime(totalMs()!);
  expect(speech).not.toHaveBeenCalled();
  expect(armAlarm).toHaveBeenCalledTimes(2);
  timerActions.pause();
  expect(disarmAlarm).toHaveBeenCalledOnce();
});
it("keeps a mini window a follower even without navigator locks", async () => {
  const { timer, timerActions } = await setup(true);
  timerActions.start();
  const started = timer.get();
  vi.advanceTimersByTime(26 * 60_000);
  expect(timer.get()).toEqual(started);
  expect(armAlarm).not.toHaveBeenCalled();
  expect(attention).not.toHaveBeenCalled();
  expect((await import("./stats")).logChunk).not.toHaveBeenCalled();
});
it("keeps the exact wall-clock deadline and does not complete a native segment early", async () => {
  const { timer, timerActions, totalMs } = await setup();
  timerActions.start();
  const original = timer.get();
  vi.setSystemTime(Date.now() + totalMs()! - 100);
  timerActions.complete(original.segId);
  expect(timer.get().segId).toBe(original.segId);
});
it("arms native attention even when sound, speech and notifications are disabled", async () => {
  const { timerActions, settings } = await setup();
  settings.set({ ...settings.get(), timer: { ...settings.get().timer, focusDoneSound: "none", breakOverSound: "none", speak: false, notify: false } });
  timerActions.start();
  expect(armAlarm).toHaveBeenLastCalledWith(expect.objectContaining({ volume: 0, speak: false, notify: false, attention: true }));
});
it("refreshes the native auto-run announcement when the next break length changes", async () => {
  const { timerActions, settings } = await setup();
  timerActions.start();
  const deadline = armAlarm.mock.calls.at(-1)![0].at;
  settings.set({ ...settings.get(), timer: { ...settings.get().timer, lengths: { ...settings.get().timer.lengths, short: 10 } } });
  expect(armAlarm).toHaveBeenLastCalledWith(expect.objectContaining({ at: deadline, announcement: { phase: "break", minutes: 10 } }));
});

it("rearms native countdown repeat with a focus announcement and honours disabling it", async () => {
  const { timerActions, timer, settings, totalMs } = await setup();
  settings.set({ ...settings.get(), timer: { ...settings.get().timer, mode: "countdown", autoRun: "off", countdownRepeat: false } });
  timerActions.start();
  const at = armAlarm.mock.calls.at(-1)![0].at;
  expect(armAlarm.mock.calls.at(-1)![0].announcement).toBeUndefined();
  settings.set({ ...settings.get(), timer: { ...settings.get().timer, countdownRepeat: true } });
  expect(armAlarm).toHaveBeenLastCalledWith(expect.objectContaining({ at, announcement: { phase: "focus", minutes: 60 } }));
  vi.advanceTimersByTime(totalMs()!);
  expect(timer.get()).toMatchObject({ segment: "focus", startedAt: Date.now(), frozen: true });
  expect(armAlarm).toHaveBeenLastCalledWith(expect.objectContaining({ at: Date.now() + totalMs()!, announcement: { phase: "focus", minutes: 60 } }));
  settings.set({ ...settings.get(), timer: { ...settings.get().timer, countdownRepeat: false } });
  expect(armAlarm.mock.calls.at(-1)![0].announcement).toBeUndefined();
  vi.advanceTimersByTime(totalMs()!);
  expect(timer.get().startedAt).toBeNull();
});

it("keeps an auto-started break running when silenced and rearms its future native alarm", async () => {
  const { timerActions, timer, totalMs } = await setup();
  timerActions.start();
  vi.advanceTimersByTime(totalMs()!);
  const breakState = timer.get();
  expect(breakState.segment).toBe("short");
  const deadline = armAlarm.mock.calls.at(-1)![0].at;
  await timerActions.stopSound();
  await timerActions.stopSound();
  expect(timer.get()).toBe(breakState);
  expect((await import("../audio/companion")).disarmCompanion).toHaveBeenCalled();
  expect(armAlarm).toHaveBeenLastCalledWith(expect.objectContaining({ kind: "break-over", at: deadline }));
  expect((await import("../audio/boundaryAlert")).boundaryAlert.get()).toMatchObject({ ringing: false, silenced: true });
});
it("silences and pauses the auto-started next segment, without dismissing the takeover", async () => {
  const { timerActions, timer, totalMs } = await setup();
  timerActions.start(); vi.advanceTimersByTime(totalMs()!);
  vi.advanceTimersByTime(1500);
  await timerActions.stopAndPause();
  expect(timer.get()).toMatchObject({ segment: "short", startedAt: null, elapsedBefore: 1500 });
  expect((await import("../ui/timer/TransitionStore")).transitionStore.get()).not.toBeNull();
});
it("silences a native boundary received before the renderer's next clock check", async () => {
  const { timerActions, timer, totalMs } = await setup();
  timerActions.start();
  vi.setSystemTime(Date.now() + totalMs()!);
  await timerActions.stopAndPause();
  expect(timer.get()).toMatchObject({ segment: "short", startedAt: null });
  expect((await import("../audio/boundaryAlert")).boundaryAlert.get()).toMatchObject({ ringing: false, silenced: true });
});
it("selects independent native event sounds, and break Skip and Stop never auto-start focus", async () => {
  const { timerActions, timer, totalMs, settings } = await setup();
  settings.set({ ...settings.get(), timer: { ...settings.get().timer, focusDoneSound: "wood", breakOverSound: "digital" } });
  timerActions.start();
  expect(armAlarm).toHaveBeenLastCalledWith(expect.objectContaining({ kind: "focus-done", alertSound: "wood" }));
  vi.advanceTimersByTime(totalMs()!);
  expect(armAlarm).toHaveBeenLastCalledWith(expect.objectContaining({ kind: "break-over", alertSound: "digital" }));
  timerActions.toggle(); expect(timer.get().startedAt).toBeNull();
  timerActions.toggle(); expect(timer.get().startedAt).not.toBeNull();
  timerActions.skip(); expect(timer.get()).toMatchObject({ segment: "focus", startedAt: null, elapsedBefore: 0 });
  timerActions.goTo("long"); timerActions.start(); timerActions.stop();
  expect(timer.get()).toMatchObject({ segment: "focus", startedAt: null, elapsedBefore: 0 });
});

it("resumes auto-started ticking between chimes and suppresses it again for each repeat", async () => {
  const { timerActions, settings, totalMs } = await setup();
  const { playTimerTick } = await import("../audio/core");
  const { boundaryAlert } = await import("../audio/boundaryAlert");
  settings.set({ ...settings.get(), timer: { ...settings.get().timer, ticking: "both", lengths: { ...settings.get().timer.lengths, pomodoro: 1 } } });
  timerActions.start();
  expect(playTimerTick).toHaveBeenCalledOnce();
  vi.advanceTimersByTime(totalMs()!);
  expect(boundaryAlert.get().sounding).toBe(true);
  expect(playTimerTick).toHaveBeenCalledOnce();
  vi.advanceTimersByTime(12_000);
  expect(playTimerTick).toHaveBeenCalledTimes(2);
  expect(boundaryAlert.get()).toMatchObject({ ringing: true, sounding: false });
  vi.advanceTimersByTime(48_000);
  expect(boundaryAlert.get().sounding).toBe(true);
  expect(playTimerTick).toHaveBeenCalledTimes(2);
  vi.advanceTimersByTime(12_000);
  expect(playTimerTick).toHaveBeenCalledTimes(3);
  await timerActions.stopSound();
  timerActions.answerTransition("dismiss");
  expect(boundaryAlert.get().silenced).toBe(false);
  expect(playTimerTick).toHaveBeenCalledTimes(4);
  await timerActions.stopSound();
  timerActions.goTo("long");
  expect(boundaryAlert.get().silenced).toBe(false);
  timerActions.start();
  expect(playTimerTick).toHaveBeenCalledTimes(5);
});
it.each(["pause", "stop"] as const)("disarms the rearmed alarm after Stop sound twice then %s", async action => {
  const { timerActions, totalMs } = await setup();
  const { cancelChime, cancelEnd } = await import("../audio/core");
  timerActions.start(); vi.advanceTimersByTime(totalMs()!);
  await timerActions.stopSound(); await timerActions.stopSound();
  vi.clearAllMocks();
  timerActions[action]();
  expect(disarmAlarm).toHaveBeenCalledOnce();
  expect(cancelChime).toHaveBeenCalledOnce(); expect(cancelEnd).toHaveBeenCalledOnce();
  await Promise.resolve();
  expect(armAlarm).not.toHaveBeenCalled();
});
it("disarms when pause races an unfinished Stop sound", async () => {
  const { timerActions, totalMs } = await setup();
  timerActions.start(); vi.advanceTimersByTime(totalMs()!);
  const stopped = timerActions.stopSound();
  timerActions.pause();
  await stopped;
  expect(disarmAlarm).toHaveBeenCalled();
  expect(armAlarm).toHaveBeenCalledTimes(2);
});
it.each([0, 0.7])("does not begin a stop-sound boundary for None without speech (volume %s)", async alertVolume => {
  const { timerActions, settings, totalMs } = await setup();
  const { boundaryAlert } = await import("../audio/boundaryAlert");
  const begin = vi.spyOn(boundaryAlert, "begin");
  settings.set({ ...settings.get(), timer: { ...settings.get().timer, focusDoneSound: "none", breakOverSound: "none", speak: false, alertVolume } });
  timerActions.start(); vi.advanceTimersByTime(totalMs()!);
  expect(begin).not.toHaveBeenCalled();
  expect(boundaryAlert.get()).toMatchObject({ ringing: false, sounding: false });
});
it("does not create tick audio in a native floating follower", async () => {
  const { timerActions, settings } = await setup(true);
  settings.set({ ...settings.get(), timer: { ...settings.get().timer, ticking: "both" } });
  timerActions.start(); vi.advanceTimersByTime(5000);
  expect((await import("../audio/core")).playTimerTick).not.toHaveBeenCalled();
});

it.each(["pomodoro", "countdown"] as const)("Hidden %s arms generic native speech and refreshes on display changes", async mode => {
  const { timerActions, settings, totalMs } = await setup();
  settings.set({ ...settings.get(), timer: { ...settings.get().timer, mode, countdownRepeat: true } });
  timerActions.start();
  const at = armAlarm.mock.calls.at(-1)![0].at;
  expect(armAlarm.mock.calls.at(-1)![0].announcement).toBeDefined();
  settings.set({ ...settings.get(), timer: { ...settings.get().timer, display: "hidden" } });
  expect(armAlarm).toHaveBeenLastCalledWith(expect.objectContaining({ at, speak: true, genericSpeech: true }));
  expect(armAlarm.mock.calls.at(-1)![0].announcement).toBeUndefined();
  vi.advanceTimersByTime(totalMs()!);
  expect(armAlarm.mock.calls.at(-1)![0].announcement).toBeUndefined();
  expect(speech).not.toHaveBeenCalled();
  settings.set({ ...settings.get(), timer: { ...settings.get().timer, display: "elapsed" } });
  expect(armAlarm.mock.calls.at(-1)![0].announcement).toBeDefined();
});
