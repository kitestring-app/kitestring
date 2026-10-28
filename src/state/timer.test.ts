import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => { vi.stubGlobal("navigator", {}); });

vi.mock("../audio/core", () => ({ cancelAllChimes: vi.fn(), playTimerTick: vi.fn(), previewChime: vi.fn(), cancelChime: vi.fn(), cancelEnd: vi.fn(), releaseChime: vi.fn(), scheduleChime: vi.fn(), scheduleEnd: vi.fn() }));
vi.mock("../audio/companion", () => ({ armCompanionWithSpeech: vi.fn().mockResolvedValue(false), cancelCompanionSpeech: vi.fn(), companionAvailable: vi.fn().mockResolvedValue(false), companionKnownUp: vi.fn(() => false), disarmCompanion: vi.fn() }));
vi.mock("./stats", () => ({ logChunk: vi.fn() }));

import { armCompanionWithSpeech, companionKnownUp } from "../audio/companion";
import { DEFAULT_SETTINGS, settings } from "./settings";
import { INITIAL_TIMER } from "./timerEngine";
import { timer, timerActions, totalMs, startTicker } from "./timer";
import { focusPick, tasks } from "./tasks";
import { transitionStore } from "../ui/timer/TransitionStore";
import { ALERT_SOUNDS } from "../audio/alertSynth";

let sequence = 0;
const attention = vi.fn(), release = vi.fn(), speak = vi.fn(), cancel = vi.fn();

beforeEach(async () => {
  await Promise.all([settings.ready, timer.ready, tasks.ready, focusPick.ready]);
  vi.useFakeTimers();
  vi.setSystemTime(2_000_000);
  vi.stubGlobal("window", { desktop: { attention, release }, speechSynthesis: { speak, cancel } });
  vi.stubGlobal("SpeechSynthesisUtterance", class { text: string; constructor(text: string) { this.text = text; } });
  settings.set({ ...DEFAULT_SETTINGS, timer: { ...DEFAULT_SETTINGS.timer, notify: false } });
  tasks.set([]);
  focusPick.set(null);
  timer.set({ ...INITIAL_TIMER, segId: `test-${sequence++}` });
  transitionStore.dismiss();
  vi.clearAllMocks();
  vi.mocked(companionKnownUp).mockReturnValue(false);
});

afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); });

function finish() {
  timerActions.start();
  vi.setSystemTime(Date.now() + totalMs()!);
  const id = timer.get().segId;
  timerActions.complete(id);
  return id;
}

describe("timer transitions", () => {
  it.each(ALERT_SOUNDS)("sends the selected %s sound to companion alarms for both phases", (alertSound) => {
    vi.stubGlobal("document", { addEventListener: vi.fn() });
    window.addEventListener = vi.fn();
    settings.set({ ...settings.get(), timer: { ...settings.get().timer, alertSound, focusDoneSound: alertSound, breakOverSound: alertSound, speak: false } });
    startTicker();
    timerActions.start();
    const volume = alertSound === "none" ? 0 : DEFAULT_SETTINGS.timer.alertVolume;
    expect(armCompanionWithSpeech).toHaveBeenLastCalledWith(expect.any(Number), "focus-done", volume, false, alertSound);
    timerActions.goTo("short");
    timerActions.start();
    expect(armCompanionWithSpeech).toHaveBeenLastCalledWith(expect.any(Number), "break-over", volume, false, alertSound);
  });
  it("raises the app and replaces an unanswered notice at every switch through a full cycle", () => {
    settings.set({ ...settings.get(), timer: { ...settings.get().timer, autoRun: "cycle" } });
    const ids = [];
    for (let i = 0; i < 8; i++) {
      ids.push(finish());
      expect(transitionStore.get()).toMatchObject({ segId: ids[i], nextSegId: timer.get().segId, autoStarted: i < 7, cycleComplete: i === 7 });
      expect(timer.get().startedAt).toBe(i === 7 ? null : Date.now());
      expect(attention).toHaveBeenCalledTimes(i + 1);
      expect(attention).toHaveBeenLastCalledWith(i % 2 === 0 ? "focus-done" : "break-over", timer.get().segId);
    }
    expect(timer.get()).toMatchObject({ segment: "focus", round: 0 });
    const done = timer.get();
    timerActions.answerTransition("dismiss");
    expect(timer.get()).toBe(done);
    expect(transitionStore.get()).toBeNull();
    expect(release).toHaveBeenCalledOnce();
    finish();
    expect(timer.get()).toMatchObject({ segment: "short", round: 1, startedAt: Date.now() });
  });

  it.each(["pomodoro", "animedoro", "5217"] as const)("starts the next %s cycle only when requested", (mode) => {
    settings.set({ ...settings.get(), timer: { ...settings.get().timer, mode, autoRun: "cycle" } });
    timer.set({ ...timer.get(), segment: mode === "5217" ? "short" : "long", round: 4 });
    finish();
    expect(transitionStore.get()?.cycleComplete).toBe(true);
    expect(timer.get().startedAt).toBeNull();
    timerActions.answerTransition("start");
    expect(timer.get()).toMatchObject({ segment: "focus", startedAt: Date.now() });
    finish();
    expect(timer.get()).toMatchObject({ segment: mode === "animedoro" ? "long" : "short", startedAt: Date.now() });
  });

  it("OK only dismisses, Pause banks time, and manual Start continues the cycle", () => {
    settings.set({ ...settings.get(), timer: { ...settings.get().timer, autoRun: "cycle" } });
    finish();
    const running = timer.get();
    timerActions.answerTransition("dismiss");
    expect(timer.get()).toBe(running);
    finish();
    vi.setSystemTime(Date.now() + 1000);
    timerActions.answerTransition("pause");
    expect(timer.get()).toMatchObject({ segment: "focus", round: 1, startedAt: null, elapsedBefore: 1000, creditedUpTo: 1000 });
    expect(transitionStore.get()).toBeNull();
    finish();
    expect(timer.get()).toMatchObject({ segment: "short", round: 2, startedAt: Date.now() });
  });

  it("skip and goTo pause without disabling the next manual run's auto-cycle", () => {
    settings.set({ ...settings.get(), timer: { ...settings.get().timer, autoRun: "cycle" } });
    finish();
    timerActions.skip();
    expect(timer.get()).toMatchObject({ segment: "focus", round: 1, startedAt: null });
    timerActions.goTo("short");
    expect(timer.get().startedAt).toBeNull();
    finish();
    expect(timer.get()).toMatchObject({ segment: "focus", round: 1, startedAt: Date.now() });
  });

  it.each(["dismiss", "pause"] as const)("a stale %s answer cannot change a newer segment", (action) => {
    settings.set({ ...settings.get(), timer: { ...settings.get().timer, autoRun: "cycle" } });
    finish();
    timerActions.goTo("long");
    timerActions.start();
    const newer = timer.get();
    timerActions.answerTransition(action);
    expect(timer.get()).toBe(newer);
  });

  it("completes once, preserves the frozen length, and starts or skips the offered break", () => {
    timerActions.start();
    const frozen = totalMs();
    settings.set({ ...settings.get(), timer: { ...settings.get().timer, lengths: { ...DEFAULT_SETTINGS.timer.lengths, pomodoro: 50 } } });
    expect(totalMs()).toBe(frozen);
    vi.setSystemTime(Date.now() + frozen!);
    const id = timer.get().segId;
    timerActions.complete(id);
    const next = timer.get();
    timerActions.complete(id);
    expect(timer.get()).toBe(next);
    expect(transitionStore.get()).toMatchObject({ segId: id, ended: "focus", at: Date.now() });
    expect(attention).toHaveBeenCalledExactlyOnceWith("focus-done", next.segId);
    timerActions.answerTransition("start");
    expect(timer.get()).toMatchObject({ segment: "short", startedAt: Date.now(), frozenTotal: 300_000 });
    expect(transitionStore.get()).toBeNull();
    expect(release).toHaveBeenCalledOnce();
  });

  it("leaves auto-started breaks running when acknowledged", () => {
    settings.set({ ...settings.get(), timer: { ...settings.get().timer, autoRun: "always" } });
    finish();
    const next = timer.get();
    timerActions.answerTransition("start");
    expect(timer.get()).toBe(next);
    expect(next).toMatchObject({ segment: "short", frozenTotal: 300_000, startedAt: Date.now() });
  });

  it("skips a break and starts focus", () => {
    finish();
    timerActions.answerTransition("skip");
    expect(timer.get()).toMatchObject({ segment: "focus", startedAt: Date.now() });
  });

  it.each(["off", "always"] as const)("allows exactly two five-minute snoozes per long break (auto-run %s)", (autoRun) => {
    settings.set({ ...settings.get(), timer: { ...settings.get().timer, autoRun } });
    timer.set({ ...timer.get(), segment: "long", round: 4 });
    finish();
    for (let n = 1; n <= 2; n++) {
      timerActions.answerTransition("snooze");
      expect(timer.get()).toMatchObject({ segment: "long", round: 4, startedAt: Date.now(), frozenTotal: 300_000 });
      expect(transitionStore.get()).toBeNull();
      finish();
      expect(transitionStore.get()).toMatchObject({ ended: "long", snoozes: n });
    }
    const before = timer.get();
    timerActions.answerTransition("snooze");
    expect(timer.get()).toBe(before);
    expect(transitionStore.get()?.snoozes).toBe(2);
    timerActions.answerTransition("start");
    expect(timer.get()).toMatchObject({ segment: "focus", round: 0, startedAt: Date.now() });
  });

  it("does not change a newer timer when an old notice is answered", () => {
    finish();
    timerActions.goTo("long");
    const next = timer.get();
    timerActions.answerTransition("start");
    expect(timer.get()).toBe(next);
    expect(transitionStore.get()).toBeNull();
    expect(release).toHaveBeenCalledOnce();
  });

  it.each(["off", "cycle", "always"] as const)("respects takeover and attention preferences in %s mode", (autoRun) => {
    settings.set({ ...settings.get(), timer: { ...settings.get().timer, autoRun, takeover: false, bringToFront: false, speak: false } });
    finish();
    expect(transitionStore.get()).toBeNull();
    expect(attention).not.toHaveBeenCalled();
    vi.advanceTimersByTime(10_000);
    expect(speak).not.toHaveBeenCalled();
  });
});

describe("spoken announcements", () => {
  it.each([
    ["animedoro", "Break started. Fifteen minutes."],
    ["5217", "Break started. Seventeen minutes."],
  ] as const)("announces the configured %s break length", (mode, text) => {
    settings.set({ ...settings.get(), timer: { ...settings.get().timer, mode, autoRun: "cycle", focusDoneSound: "none", breakOverSound: "none" } });
    finish();
    vi.advanceTimersByTime(0);
    expect(speak).toHaveBeenLastCalledWith(expect.objectContaining({ text }));
  });
  it("announces auto-started breaks, focus, and cycle completion with the companion available", () => {
    vi.mocked(companionKnownUp).mockReturnValue(true);
    settings.set({ ...settings.get(), timer: { ...settings.get().timer, autoRun: "cycle", focusDoneSound: "none", breakOverSound: "none" } });
    finish();
    vi.advanceTimersByTime(0);
    expect(speak).toHaveBeenLastCalledWith(expect.objectContaining({ text: "Break started. Five minutes." }));
    finish();
    vi.advanceTimersByTime(0);
    expect(speak).toHaveBeenLastCalledWith(expect.objectContaining({ text: "Focus started. Twenty-five minutes." }));
    timerActions.goTo("long");
    finish();
    vi.advanceTimersByTime(0);
    expect(speak).toHaveBeenLastCalledWith(expect.objectContaining({ text: "Cycle complete. Nice work." }));
  });

  it("arms the companion chime without its generic speech in auto-run mode", () => {
    vi.stubGlobal("document", { addEventListener: vi.fn() });
    window.addEventListener = vi.fn();
    settings.set({ ...settings.get(), timer: { ...settings.get().timer, autoRun: "cycle" } });
    startTicker();
    timerActions.start();
    expect(armCompanionWithSpeech).toHaveBeenLastCalledWith(expect.any(Number), "focus-done", 0.85, false, "signature");
    settings.set({ ...settings.get(), timer: { ...settings.get().timer, autoRun: "off" } });
    expect(armCompanionWithSpeech).toHaveBeenLastCalledWith(expect.any(Number), "focus-done", 0.85, true, "signature");
  });

  it.each([false, true])("Hidden auto-starts use generic speech with companion available %s", companion => {
    vi.mocked(companionKnownUp).mockReturnValue(companion);
    vi.stubGlobal("document", { addEventListener: vi.fn() });
    window.addEventListener = vi.fn();
    settings.set({ ...settings.get(), timer: { ...settings.get().timer, display: "hidden", autoRun: "always", focusDoneSound: "none", breakOverSound: "none" } });
    startTicker();
    for (const [segment, text] of [["focus", "Focus session done. Time for a break."], ["short", "Break is over. Time to focus."]] as const) {
      timerActions.goTo(segment);
      finish();
      vi.advanceTimersByTime(0);
      expect(armCompanionWithSpeech).toHaveBeenLastCalledWith(expect.any(Number), segment === "focus" ? "break-over" : "focus-done", 0, true, "none");
      if (companion) expect(speak).not.toHaveBeenCalled();
      else expect(speak).toHaveBeenLastCalledWith(expect.objectContaining({ text }));
    }
  });

  it("Hidden countdown repeat speaks no block length", () => {
    settings.set({ ...settings.get(), timer: { ...settings.get().timer, display: "hidden", mode: "countdown", countdownRepeat: true, focusDoneSound: "none" } });
    finish(); vi.advanceTimersByTime(0);
    expect(speak).toHaveBeenLastCalledWith(expect.objectContaining({ text: "Focus session done. Time for a break." }));
  });

  it("switching to Hidden while speech waits for the chime removes its duration", () => {
    settings.set({ ...settings.get(), timer: { ...settings.get().timer, autoRun: "always" } });
    finish();
    settings.set({ ...settings.get(), timer: { ...settings.get().timer, display: "hidden" } });
    vi.advanceTimersByTime(6500);
    expect(speak).toHaveBeenLastCalledWith(expect.objectContaining({ text: "Focus session done. Time for a break." }));
  });

  it("keeps the page's generic fallback when Hidden is selected during a companion chime", () => {
    vi.mocked(companionKnownUp).mockReturnValue(true);
    settings.set({ ...settings.get(), timer: { ...settings.get().timer, autoRun: "always" } });
    finish();
    settings.set({ ...settings.get(), timer: { ...settings.get().timer, display: "hidden" } });
    vi.advanceTimersByTime(6500);
    expect(speak).toHaveBeenLastCalledWith(expect.objectContaining({ text: "Focus session done. Time for a break." }));
  });

  it.each([false, true])("Hidden stops an active timed page announcement, but leaves completed speech alone (%s)", ended => {
    vi.stubGlobal("document", { addEventListener: vi.fn() });
    window.addEventListener = vi.fn();
    settings.set({ ...settings.get(), timer: { ...settings.get().timer, autoRun: "always", focusDoneSound: "none" } });
    startTicker();
    finish(); vi.advanceTimersByTime(0);
    const utterance = speak.mock.calls.at(-1)![0];
    expect(utterance.text).toBe("Break started. Five minutes.");
    if (ended) utterance.onend?.();
    cancel.mockClear();
    settings.set({ ...settings.get(), timer: { ...settings.get().timer, display: "hidden" } });
    expect(cancel).toHaveBeenCalledTimes(ended ? 0 : 1);
  });

  it("keeps a Hidden generic reminder speaking when another timer setting changes", () => {
    vi.stubGlobal("document", { addEventListener: vi.fn() });
    window.addEventListener = vi.fn();
    settings.set({ ...settings.get(), timer: { ...settings.get().timer, display: "hidden", autoRun: "always", focusDoneSound: "none" } });
    startTicker();
    finish(); vi.advanceTimersByTime(0);
    expect(speak).toHaveBeenLastCalledWith(expect.objectContaining({ text: "Focus session done. Time for a break." }));
    cancel.mockClear();
    settings.set({ ...settings.get(), timer: { ...settings.get().timer, alertVolume: 0.5 } });
    expect(cancel).not.toHaveBeenCalled();
  });

  it("waits for the focus chime and includes the next task", () => {
    tasks.set([{ id: "task", title: "Write the outline", done: false, createdAt: 0 }]);
    finish();
    vi.advanceTimersByTime(6499);
    expect(speak).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(speak).toHaveBeenCalledWith(expect.objectContaining({ text: "Focus session done. Time for a break. Next up: Write the outline" }));
  });

  it("waits 5.5 seconds after a break and cancels on a button press", () => {
    timer.set({ ...timer.get(), segment: "short" });
    finish();
    vi.advanceTimersByTime(5499);
    expect(speak).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(speak).toHaveBeenCalledWith(expect.objectContaining({ text: "Break is over. Time to focus." }));
    timerActions.answerTransition("start");
    expect(cancel).toHaveBeenCalled();
  });

  it("cancels a pending announcement when the user answers early", () => {
    finish();
    timerActions.answerTransition("skip");
    vi.advanceTimersByTime(10_000);
    expect(speak).not.toHaveBeenCalled();
  });

  it("speaks with sound off but stays quiet when the companion owns alerts", () => {
    settings.set({ ...settings.get(), timer: { ...settings.get().timer, focusDoneSound: "none", breakOverSound: "none" } });
    finish();
    vi.advanceTimersByTime(0);
    expect(speak).toHaveBeenCalledOnce();
    vi.mocked(companionKnownUp).mockReturnValue(true);
    speak.mockClear();
    timerActions.answerTransition("start");
    finish();
    vi.advanceTimersByTime(10_000);
    expect(speak).not.toHaveBeenCalled();
  });
});

it("repeats countdowns once, credits the completed run, and lets Pause and Skip stop them", () => {
  settings.set({ ...settings.get(), timer: { ...settings.get().timer, mode: "countdown", countdownRepeat: true, autoRun: "off" } });
  const previous = finish();
  expect(timer.get()).toMatchObject({ segment: "focus", startedAt: Date.now(), elapsedBefore: 0, frozen: true });
  expect(transitionStore.get()).toMatchObject({ autoStarted: true });
  const repeated = timer.get();
  timerActions.complete(previous);
  expect(timer.get()).toBe(repeated);
  timerActions.answerTransition("pause");
  expect(timer.get().startedAt).toBeNull();
  timerActions.start(); timerActions.skip();
  expect(timer.get()).toMatchObject({ segment: "focus", startedAt: null, elapsedBefore: 0 });
});
it("starts a completed nonrepeating countdown again without inserting a break", () => {
  settings.set({ ...settings.get(), timer: { ...settings.get().timer, mode: "countdown" } });
  finish();
  expect(timer.get().startedAt).toBeNull();
  timerActions.answerTransition("start");
  expect(timer.get()).toMatchObject({ segment: "focus", startedAt: Date.now() });
});

it.each(["pause", "stop"] as const)("cancels web deadlines after Stop sound twice then %s", async action => {
  vi.stubGlobal("document", { addEventListener: vi.fn() }); window.addEventListener = vi.fn();
  settings.set({ ...settings.get(), timer: { ...settings.get().timer, autoRun: "always", speak: false } });
  startTicker(); finish();
  await timerActions.stopSound(); await timerActions.stopSound();
  const core = await import("../audio/core"), companion = await import("../audio/companion");
  vi.clearAllMocks();
  timerActions[action]();
  expect(core.cancelChime).toHaveBeenCalledOnce(); expect(core.cancelEnd).toHaveBeenCalledOnce();
  expect(companion.disarmCompanion).toHaveBeenCalledOnce();
  await Promise.resolve();
  expect(core.scheduleChime).not.toHaveBeenCalled(); expect(core.scheduleEnd).not.toHaveBeenCalled();
  expect(companion.armCompanionWithSpeech).not.toHaveBeenCalled();
});
