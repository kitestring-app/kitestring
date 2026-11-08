import { afterEach, expect, it, vi } from "vitest";
vi.hoisted(() => { vi.stubGlobal("navigator", {}); });
// The audio clock is mocked away, so these tests exercise the 250 ms ticker path that backs it up.
vi.mock("../audio/core", () => ({ cancelAllChimes: vi.fn(), previewChime: vi.fn(), playTimerTick: vi.fn(), cancelChime: vi.fn(), cancelEnd: vi.fn(),
  releaseChime: vi.fn(), scheduleChime: vi.fn(), scheduleEnd: vi.fn(), watchAudioClock: vi.fn(() => vi.fn()) }));
vi.mock("../audio/startChime", () => ({ playStartChime: vi.fn(), shouldStartChime: vi.fn(() => false) }));
vi.mock("../audio/companion", () => ({ armCompanionWithSpeech: vi.fn().mockResolvedValue(false), cancelCompanionSpeech: vi.fn(), companionAvailable: vi.fn().mockResolvedValue(false), companionKnownUp: vi.fn(() => false), disarmCompanion: vi.fn() }));
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.resetModules(); vi.clearAllMocks(); });

const MIN = 60_000;
async function setup(native: boolean, timer: Record<string, unknown> = {}) {
  vi.stubGlobal("navigator", {});
  vi.stubGlobal("BroadcastChannel", undefined);
  vi.stubGlobal("SpeechSynthesisUtterance", class { text: string; constructor(text: string) { this.text = text; } });
  const s = await import("./settings"); const state = await import("./timer");
  const parked = await import("./parked");
  await Promise.all([s.calmFoundationReady, state.timer.ready, parked.parked.ready]);
  vi.useFakeTimers(); vi.setSystemTime(100_000);
  const desktop = { armAlarm: vi.fn().mockResolvedValue(true), disarmAlarm: vi.fn(), cancelSpeech: vi.fn(), attention: vi.fn(), release: vi.fn(), speak: vi.fn().mockResolvedValue(true) };
  const speech = { cancel: vi.fn(), speak: vi.fn() };
  vi.stubGlobal("window", { desktop: native ? desktop : undefined, speechSynthesis: speech, addEventListener: vi.fn() });
  vi.stubGlobal("document", { visibilityState: "visible", addEventListener: vi.fn() });
  // Only the heads-up is on, so no end-of-block speech or chime muddies the counts.
  s.settings.set({ ...s.DEFAULT_SETTINGS, timer: { ...s.DEFAULT_SETTINGS.timer, ...s.CALM_PATCH, speak: true, warnBefore: 2, ...timer } });
  const { INITIAL_TIMER } = await import("./timerEngine");
  state.timer.set({ ...INITIAL_TIMER, segId: "warn", frozen: true, frozenTotal: 10 * MIN });
  state.startTicker(); await Promise.resolve();
  vi.clearAllMocks();
  const { playStartChime } = await import("../audio/startChime");
  return { s, ...state, desktop, speech, chime: vi.mocked(playStartChime) };
}

it.each([false, true])("plays the start sound and says the time left two minutes before a focus block ends (native=%s)", async native => {
  const q = await setup(native);
  q.timerActions.start();
  await vi.advanceTimersByTimeAsync(8 * MIN - 1_000);
  expect(q.chime).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1_250);
  expect(q.chime).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1_000);
  if (native) {
    expect(q.desktop.speak).toHaveBeenCalledWith({ kind: "focus-done", announcement: { phase: "warning", minutes: 2 } });
    expect(q.speech.speak).not.toHaveBeenCalled();
  } else {
    expect(q.speech.speak).toHaveBeenCalledTimes(1);
    expect(q.speech.speak.mock.calls[0]![0]).toMatchObject({ text: "Two minutes left." });
  }
  await vi.advanceTimersByTimeAsync(MIN);
  expect(q.chime).toHaveBeenCalledTimes(1); // Once per block.
});

it("stays silent in Calm", async () => {
  const q = await setup(false, { speak: false, warnBefore: 0 });
  q.timerActions.start();
  await vi.advanceTimersByTimeAsync(10 * MIN - 1_000);
  expect(q.chime).not.toHaveBeenCalled();
  expect(q.speech.speak).not.toHaveBeenCalled();
});

it("sounds without speech when speech is off, and Hidden time hears no number", async () => {
  const quiet = await setup(false, { speak: false });
  quiet.timerActions.start();
  await vi.advanceTimersByTimeAsync(8 * MIN + 2_000);
  expect(quiet.chime).toHaveBeenCalledTimes(1);
  expect(quiet.speech.speak).not.toHaveBeenCalled();
  vi.resetModules(); vi.useRealTimers();
  const hidden = await setup(false, { display: "hidden" });
  hidden.timerActions.start();
  await vi.advanceTimersByTimeAsync(8 * MIN + 2_000);
  expect(hidden.speech.speak.mock.calls[0]![0]).toMatchObject({ text: "Focus is nearly done." });
});

it("a pause moves the cue with the deadline, and a paused block never warns", async () => {
  const q = await setup(false);
  q.timerActions.start();
  await vi.advanceTimersByTimeAsync(5 * MIN);
  q.timerActions.pause();
  await vi.advanceTimersByTimeAsync(10 * MIN);
  expect(q.chime).not.toHaveBeenCalled();
  q.timerActions.start();
  await vi.advanceTimersByTimeAsync(3 * MIN - 1_000);
  expect(q.chime).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1_250);
  expect(q.chime).toHaveBeenCalledTimes(1);
});

it("muted or zero alert volume keeps the sound off but still speaks", async () => {
  const q = await setup(false, { alertVolume: 0 });
  q.timerActions.start();
  await vi.advanceTimersByTimeAsync(8 * MIN + 2_000);
  expect(q.chime).not.toHaveBeenCalled();
  expect(q.speech.speak).toHaveBeenCalledTimes(1);
});

it("arms the audio clock for the cue, so a throttled background tab still hears it on time", async () => {
  const q = await setup(false);
  const core = await import("../audio/core");
  q.timerActions.start();
  const watch = vi.mocked(core.watchAudioClock);
  expect(watch).toHaveBeenCalledTimes(1);
  expect(watch.mock.calls[0]![0]).toBeCloseTo(8 * 60, 0);
  // The audio clock fires while page timers are still held back.
  vi.setSystemTime(Date.now() + 8 * MIN);
  watch.mock.calls[0]![1]();
  expect(q.chime).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(2_000);
  expect(q.chime).toHaveBeenCalledTimes(1);
});

it.each(["pause", "off"] as const)("drops the spoken line if the block changes during the chime (%s)", async change => {
  const q = await setup(false);
  q.timerActions.start();
  await vi.advanceTimersByTimeAsync(8 * MIN + 250);
  expect(q.chime).toHaveBeenCalledTimes(1);
  if (change === "pause") q.timerActions.pause(); else q.s.settingsUpdate("timer", { warnBefore: 0 });
  await vi.advanceTimersByTimeAsync(2_000);
  expect(q.speech.speak).not.toHaveBeenCalled();
});
