import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.hoisted(() => { vi.stubGlobal("navigator", {}); });
vi.mock("../audio/core", () => ({ cancelAllChimes: vi.fn(), previewChime: vi.fn(), playTimerTick: vi.fn(), cancelChime: vi.fn(), cancelEnd: vi.fn(), releaseChime: vi.fn(), scheduleChime: vi.fn(), scheduleEnd: vi.fn() }));
vi.mock("../audio/companion", () => ({ armCompanionWithSpeech: vi.fn().mockResolvedValue(false), cancelCompanionSpeech: vi.fn(), companionAvailable: vi.fn().mockResolvedValue(false), companionKnownUp: vi.fn(() => false), disarmCompanion: vi.fn() }));
import { DEFAULT_SETTINGS, sanitizeSettings, settings, settingsUpdate } from "./settings";
import { hardModeLocked, runTimerCommand, timer, timerActions, totalMs, startTicker } from "./timer";
import { INITIAL_TIMER } from "./timerEngine";
import { parked } from "./parked";
import { stats, sessionLog, deleteSession } from "./stats";
import { boundaryAlert } from "../audio/boundaryAlert";
import { transitionStore } from "../ui/timer/TransitionStore";
import { sessionLogCsv } from "../ui/stats/csv";
import { BACKUP_FORMAT, parseBackup } from "../lib/backup";
import { applyRemote } from "../lib/store";
import type { Segment } from "./timerEngine";
import { focusPick, tasks } from "./tasks";

beforeEach(async () => {
  await Promise.all([settings.ready, timer.ready, parked.ready, stats.ready]);
  vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 9, 25, 10));
  vi.stubGlobal("window", { desktop: { release: vi.fn() }, speechSynthesis: { cancel: vi.fn() } });
  timer.set({ ...INITIAL_TIMER });
  settings.set({ ...DEFAULT_SETTINGS, timer: { ...DEFAULT_SETTINGS.timer, hardMode: true, notify: false, speak: false, bringToFront: false } });
  stats.set({ chunks: [], tasksDone: [] }); parked.set([]); transitionStore.dismiss();
  timerActions.cancelEndHold();
});
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); });
const begin = (segment: Segment = "focus") => { timer.set({ ...INITIAL_TIMER, segment, segId: `hard-${segment}` }); timerActions.start(); };
const refusal = { ok: false, reason: "hard-mode" };

describe("hard-mode enforcement", () => {
  it("is off for new users and old, malformed or imported settings; true round-trips", () => {
    expect(DEFAULT_SETTINGS.timer.hardMode).toBe(false);
    for (const value of [undefined, null, 1, "true", {}, []]) expect(sanitizeSettings({ timer: { hardMode: value } }).timer.hardMode).toBe(false);
    expect(sanitizeSettings({ timer: { hardMode: true } }).timer.hardMode).toBe(true);
    expect(sanitizeSettings({}).timer.hardMode).toBe(false);
  });
  it.each(["focus", "short", "long"] as const)("refuses every renderer and IPC action on %s without credit or state changes", async segment => {
    begin(segment); vi.advanceTimersByTime(2000);
    const original = timer.get();
    for (const command of ["pause", "toggle", "reset", "skip", "stop", "stopAndPause"] as const) {
      expect(await timerActions[command]()).toMatchObject(refusal);
      expect(await runTimerCommand(command)).toMatchObject(refusal);
      expect(timer.get()).toBe(original);
    }
    for (const to of ["focus", "short", "long"] as const) expect(timerActions.goTo(to)).toMatchObject(refusal);
    transitionStore.show({ segId: `notice-${segment}`, nextSegId: original.segId, ended: "short", breakSegment: "short", breakRound: 0, at: Date.now(), snoozes: 0, autoStarted: true });
    const notice = transitionStore.get();
    for (const action of ["pause", "skip", "snooze"] as const) expect(timerActions.answerTransition(action)).toMatchObject(refusal);
    expect(transitionStore.get()).toBe(notice);
    expect(stats.get().chunks).toEqual([]);
  });
  it("Stop sound works without changing a locked running block", async () => {
    begin("short"); const original = timer.get();
    boundaryAlert.begin("previous", original.segId);
    expect(boundaryAlert.get().ringing).toBe(true);
    await runTimerCommand("stopSound");
    expect(boundaryAlert.get().silenced).toBe(true); expect(timer.get()).toBe(original);
  });
  it.each(["stopAndPause", "pause", "skip", "snooze"] as const)("%s silences the alarm before refusing a locked transition", async action => {
    begin("short"); const original = timer.get();
    transitionStore.show({ segId: "old", nextSegId: original.segId, ended: "short", breakSegment: "short", breakRound: 0, at: Date.now(), snoozes: 0, autoStarted: true });
    const notice = transitionStore.get();
    boundaryAlert.begin("old", original.segId);
    const result = action === "stopAndPause" ? timerActions.stopAndPause() : timerActions.answerTransition(action);
    expect(result).toMatchObject(refusal);
    expect(boundaryAlert.get().silenced).toBe(true);
    expect(window.speechSynthesis.cancel).toHaveBeenCalled();
    expect(timer.get()).toBe(original); expect(transitionStore.get()).toBe(notice);
    expect(stats.get().chunks).toEqual([]);
  });
  it("latches enable mid-block, defers disable, freezes lengths, then unlocks at the next boundary", () => {
    settingsUpdate("timer", { hardMode: false, autoRun: "always" }); begin();
    expect(hardModeLocked()).toBe(false);
    settingsUpdate("timer", { hardMode: true }); expect(timer.get().hardLocked).toBe(true);
    const duration = totalMs()!;
    settingsUpdate("timer", { hardMode: false, lengths: { ...DEFAULT_SETTINGS.timer.lengths, pomodoro: 1 } });
    expect(totalMs()).toBe(duration); expect(timerActions.pause()).toMatchObject(refusal);
    vi.advanceTimersByTime(duration); timerActions.complete(timer.get().segId);
    expect(timer.get().segment).toBe("short"); expect(timer.get().startedAt).not.toBeNull();
    expect(hardModeLocked()).toBe(false); timerActions.pause(); expect(timer.get().startedAt).toBeNull();
  });
  it("auto-run chains locked focus and break blocks normally", () => {
    settingsUpdate("timer", { autoRun: "always" }); begin();
    for (const segment of ["short", "focus"]) {
      vi.advanceTimersByTime(totalMs()!); timerActions.complete(timer.get().segId);
      expect(timer.get().segment).toBe(segment); expect(hardModeLocked()).toBe(true);
    }
    expect(stats.get().chunks.every(c => c.completed)).toBe(true);
  });
  it("retains the latch across reload-shaped state and remote settings updates", async () => {
    begin(); const persisted = JSON.parse(JSON.stringify(timer.get()));
    await applyRemote("settings", { ...settings.get(), timer: { ...settings.get().timer, hardMode: false } });
    timer.set(persisted);
    expect(timerActions.stop()).toMatchObject(refusal);
  });
  it("ordinary controls keep working when hard mode is off", () => {
    settingsUpdate("timer", { hardMode: false }); begin();
    timerActions.pause(); expect(timer.get().startedAt).toBeNull();
    timerActions.start(); timerActions.reset(); expect(timer.get().elapsedBefore).toBe(0);
  });
});

describe("hold and reason authorization", () => {
  it("uses elapsed monotonic time despite forward and backward wall-clock changes", () => {
    begin(); timerActions.beginEndHold();
    vi.setSystemTime(Date.now() + 60_000);
    expect(timerActions.endHardSession("Meeting")).toMatchObject({ reason: "hold-required" });
    vi.advanceTimersByTime(9999);
    vi.setSystemTime(Date.now() - 120_000);
    expect(timerActions.endHardSession("Meeting")).toMatchObject({ reason: "hold-required" });
    vi.advanceTimersByTime(1);
    expect(timerActions.endHardSession("Meeting")).toEqual({ ok: true });
  });
  it("a second renderer begin preserves the earlier hold start for the same segment", async () => {
    begin(); await runTimerCommand("beginEndHold"); vi.advanceTimersByTime(6000);
    await runTimerCommand("beginEndHold"); vi.advanceTimersByTime(3999);
    expect(timerActions.endHardSession("Meeting")).toMatchObject({ reason: "hold-required" });
    vi.advanceTimersByTime(1);
    expect(timerActions.endHardSession("Meeting")).toEqual({ ok: true });
  });
  it.each(["focus", "short", "long"] as const)("only focus exits retain task context (%s)", async segment => {
    await Promise.all([tasks.ready, focusPick.ready]);
    const previousTasks = tasks.get(), previousPick = focusPick.get();
    try {
      tasks.set([{ id: "active-task", title: "Work", done: false, createdAt: Date.now() }]); focusPick.set("active-task");
      begin(segment); timerActions.beginEndHold(); vi.advanceTimersByTime(10_000);
      expect(timerActions.endHardSession("Meeting")).toEqual({ ok: true });
      const taskId = segment === "focus" ? "active-task" : undefined;
      expect(stats.get().chunks.every(chunk => chunk.taskId === taskId)).toBe(true);
      expect(parked.get()[0].taskId).toBe(taskId);
    } finally { tasks.set(previousTasks); focusPick.set(previousPick); }
  });
  it("requires an uninterrupted 10 seconds and a valid single-line reason, and cancellation leaves the timer untouched", () => {
    begin(); const original = timer.get();
    expect(timerActions.endHardSession("Meeting").ok).toBe(false);
    timerActions.beginEndHold(); vi.advanceTimersByTime(9999);
    expect(timerActions.endHardSession("Meeting")).toMatchObject({ reason: "hold-required" });
    timerActions.cancelEndHold(); vi.advanceTimersByTime(1);
    expect(timerActions.endHardSession("Meeting").ok).toBe(false);
    expect(timer.get()).toBe(original);
    timerActions.beginEndHold(); vi.advanceTimersByTime(10_000);
    for (const reason of ["", "  ", "ab", "a\nb", "x".repeat(501)]) expect(timerActions.endHardSession(reason)).toMatchObject({ reason: "reason-required" });
    expect(timer.get()).toBe(original);
    expect(timerActions.endHardSession("Meeting")).toEqual({ ok: true });
  });
  it.each(["focus", "short", "long"] as const)("credits %s partially and saves its tagged reason in interruptions, sessions, backups and CSV", segment => {
    begin(segment); timerActions.beginEndHold(); vi.advanceTimersByTime(10_000);
    expect(timerActions.endHardSession('  Call, "urgent"  ')).toEqual({ ok: true });
    expect(timer.get()).toMatchObject({ segment: "focus", startedAt: null });
    expect(stats.get().chunks.reduce((ms, c) => ms + c.ms, 0)).toBe(10_000);
    expect(stats.get().chunks.some(c => c.completed)).toBe(false);
    expect(parked.get()).toEqual([expect.objectContaining({ segment, tag: "Hard mode: ended early", text: 'Call, "urgent"', segId: `hard-${segment}` })]);
    const days = sessionLog(stats.get(), [], {}, parked.get());
    expect(days[0].sessions[0]).toMatchObject({ earlyEndReason: 'Call, "urgent"', ms: 10_000, interruptions: 1, completed: false });
    expect(sessionLogCsv(days)).toContain('Hard mode: ended early: Call, ""urgent""');
    const backup = parseBackup(JSON.stringify({ format: BACKUP_FORMAT, version: 1, data: { stats: stats.get(), parked: parked.get(), settings: settings.get() } }));
    expect(backup.data.parked).toEqual(parked.get()); expect(backup.data.stats).toEqual(stats.get());
    const undo = deleteSession(days[0].sessions[0]); expect(sessionLog(stats.get(), [], {}, parked.get())).toEqual([]);
    undo!(); expect(sessionLog(stats.get(), [], {}, parked.get())[0].sessions[0].earlyEndReason).toBe('Call, "urgent"');
  });
  it("cannot reuse a completed hold to stop the next auto-run segment", () => {
    settingsUpdate("timer", { autoRun: "always" }); begin(); timerActions.beginEndHold();
    vi.advanceTimersByTime(totalMs()!); timerActions.complete(timer.get().segId);
    const next = timer.get();
    expect(timerActions.endHardSession("Meeting")).toMatchObject({ reason: "stale-segment" }); expect(timer.get()).toBe(next);
  });
  it.each([false, true])("finishes a locked stopwatch with completed credit through skip (IPC=%s)", async ipc => {
    settingsUpdate("timer", { mode: "stopwatch" }); begin(); timerActions.complete(timer.get().segId);
    expect(hardModeLocked()).toBe(true); expect(stats.get().chunks).toEqual([]);
    expect(totalMs()).toBeNull(); vi.advanceTimersByTime(65_000);
    if (ipc) expect(await runTimerCommand("skip")).toEqual({ ok: true }); else timerActions.skip();
    expect(timer.get().startedAt).toBeNull(); expect(hardModeLocked()).toBe(false);
    expect(stats.get().chunks).toEqual([expect.objectContaining({ ms: 65_000, completed: true })]);
    expect(stats.get().chunks.some(chunk => chunk.earlyEndReason)).toBe(false); expect(parked.get()).toEqual([]);
  });
});

it("a follower tab uses the same action refusals and cannot complete the leader's block", async () => {
  begin(); startTicker({ follower: true }); const original = timer.get();
  for (const command of ["pause", "toggle", "reset", "skip", "stop", "stopAndPause"] as const) expect(await runTimerCommand(command)).toMatchObject(refusal);
  vi.advanceTimersByTime(totalMs()!); timerActions.complete(original.segId);
  expect(timer.get()).toBe(original); expect(stats.get().chunks).toEqual([]);
});
