import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { IDBFactory } from "fake-indexeddb";
vi.mock("../audio/core", () => ({ cancelAllChimes: vi.fn(), playTimerTick: vi.fn(), cancelChime: vi.fn(), cancelEnd: vi.fn(), releaseChime: vi.fn(), scheduleChime: vi.fn(), scheduleEnd: vi.fn() }));
vi.mock("../audio/companion", () => ({ armCompanionWithSpeech: vi.fn().mockResolvedValue(false), companionAvailable: vi.fn().mockResolvedValue(false), companionKnownUp: vi.fn(() => false), disarmCompanion: vi.fn() }));
let m: Awaited<ReturnType<typeof setup>>;
async function setup() {
  const [t, s, e, st, store, db] = await Promise.all([import("./timer"), import("./settings"), import("./timerEngine"), import("./stats"), import("../lib/store"), import("../lib/db")]);
  await t.timerHydrationReady;
  return { ...t, ...s, ...e, ...st, ...store, ...db };
}
beforeEach(async () => {
  vi.resetModules(); vi.stubGlobal("indexedDB", new IDBFactory()); vi.stubGlobal("BroadcastChannel", undefined); vi.stubGlobal("navigator", {});
  vi.stubGlobal("window", { addEventListener: vi.fn(), desktop: { armAlarm: vi.fn().mockResolvedValue(true), disarmAlarm: vi.fn(), release: vi.fn(), cancelSpeech: vi.fn(), onLifecycle: vi.fn() } });
  vi.stubGlobal("document", { addEventListener: vi.fn(), visibilityState: "visible" });
  vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout", "setInterval", "clearInterval", "performance"] }); vi.setSystemTime(Date.UTC(2026, 9, 20, 12));
  m = await setup(); m.settingsUpdate("timer", { ...m.STRONG_PATCH, autoRun: "always", countdownRepeat: true });
  m.startTicker(); await Promise.resolve();
});
afterEach(async () => { vi.clearAllTimers(); vi.useRealTimers(); await m.flushReadyStores(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const focus = () => m.stats.get().chunks.filter(c => c.kind === "focus").reduce((n, c) => n + c.ms, 0);
const away = () => m.stats.get().chunks.filter(c => (c as any).away);
const hide = () => (vi.mocked(window.addEventListener).mock.calls.filter(([e]) => e === "pagehide").at(-1)![1] as () => void)();
async function reopen(gap: number) {
  const now = Date.now(); await m.flushReadyStores(); vi.clearAllTimers(); vi.setSystemTime(now + gap); vi.resetModules();
  m = await setup(); m.startTicker(); await Promise.resolve();
}
it.each(["web", "Mac"])("clean %s close records focus through departure and one real away break", async platform => {
  if (platform === "web") window.desktop = undefined;
  m.timerActions.start(); vi.advanceTimersByTime(600_000); hide();
  expect(focus()).toBe(600_000);
  await reopen(3_840_000);
  expect(focus()).toBe(600_000); expect(away()).toMatchObject([{ kind: "break", ms: 3_840_000 }]);
  expect(m.timer.get()).toMatchObject({ startedAt: null, boundary: { missed: true } });
  expect(m.recoveryOffer()).toBe("missed-end");
  m.checkRecoveryLifecycle(); vi.advanceTimersByTime(60_000); expect(away()).toHaveLength(1); expect(focus()).toBe(600_000);
  expect((await import("../ui/timer/TransitionStore")).transitionStore.get()).toBeNull();
});
it.each(["short", "long"] as const)("a departed %s break records 23 h 5 min without starting focus", async segment => {
  m.timerActions.goTo(segment); m.timerActions.start(); hide(); await reopen(83_100_000);
  expect(focus()).toBe(0); expect(away()).toMatchObject([{ kind: "break", segment, ms: 83_100_000 }]);
  expect(m.timer.get().startedAt).toBeNull();
});
it("power loss recovers the last persisted heartbeat, never the planned focus length", async () => {
  m.timerActions.start(); vi.advanceTimersByTime(31_000); await m.flushReadyStores(); await reopen(3_600_000);
  expect(focus()).toBe(30_000); expect(away()[0]?.ms).toBe(3_601_000);
});
it("task banking advances the cutoff so away cannot overlap already committed focus", async () => {
  const tasks = await import("./tasks"); tasks.addTask({ title: "First" }); const id = tasks.addTask({ title: "Next" });
  m.timerActions.start(); vi.advanceTimersByTime(10_000); tasks.focusPick.set(id); await reopen(3_600_000);
  expect(focus()).toBe(10_000); expect(away()[0]?.start).toBe(m.stats.get().chunks[0].start + 10_000);
});
it.each(["together", "stopped"])("native sleep timestamp wins before resume IPC with %s clocks", async clocks => {
  m.timerActions.start(); vi.advanceTimersByTime(10_000); const at = Date.now();
  Object.assign(window.desktop!, { consumeSuspensionAt: vi.fn().mockReturnValueOnce({ at, suspended: false }).mockReturnValue(null) });
  vi.setSystemTime(at + 3_600_000);
  if (clocks === "together") vi.spyOn(performance, "now").mockReturnValue(3_610_000);
  vi.advanceTimersByTime(250);
  expect(focus()).toBe(10_000); expect(away()[0]?.ms).toBe(3_600_250); expect(m.timer.get().startedAt).toBeNull();
});
it("a hidden throttled open tab is still present, including when both clocks advance", () => {
  window.desktop = undefined; m.timerActions.start(); Object.assign(document, { visibilityState: "hidden" });
  const now = Date.now(), mono = performance.now(); vi.setSystemTime(now + 600_000); vi.spyOn(performance, "now").mockReturnValue(mono + 600_000);
  m.checkRecoveryLifecycle(); expect(away()).toHaveLength(0); expect(m.timer.get().startedAt).not.toBeNull();
  m.timerActions.pause(); expect(focus()).toBe(600_000);
});
it("stopwatch return stops and records only actual work", async () => {
  m.settingsUpdate("timer", { mode: "stopwatch" }); m.timerActions.start(); vi.advanceTimersByTime(10_000); hide(); await reopen(3_600_000);
  expect(focus()).toBe(10_000); expect(away()[0]?.ms).toBe(3_600_000); expect(m.timer.get()).toMatchObject({ startedAt: null, reentry: expect.any(String) });
});
it("a Hard return before its deadline retains the lock while allowing explicit Resume", async () => {
  m.settingsUpdate("timer", { hardMode: true }); m.timerActions.start(); vi.advanceTimersByTime(10_000); hide(); await reopen(10_000);
  expect(m.timer.get().startedAt).toBeNull(); expect(m.hardModeLocked()).toBe(true);
  expect(m.timerActions.reset()).toMatchObject({ ok: false });
  expect(m.answerRecovery(m.recoveryCommand(), "resume")).toBe(true); expect(m.timer.get().startedAt).toBe(Date.now());
});
it("a Hard break ended while away never starts a focus block", async () => {
  m.settingsUpdate("timer", { hardMode: true }); m.timerActions.goTo("short"); m.timerActions.start(); hide(); await reopen(83_100_000);
  expect(focus()).toBe(0); expect(m.timer.get()).toMatchObject({ startedAt: null, boundary: { missed: true } }); expect(m.hardModeLocked()).toBe(false);
});
it("legacy recovery preserves committed credit without inventing the rest of a block", async () => {
  const start = Date.now(); await m.dbSetMany([["timer", { ...m.INITIAL_TIMER, segId: "legacy", startedAt: start, creditedUpTo: 600_000, frozen: true, frozenTotal: 1_500_000 }], ["stats", { chunks: [{ id: "old", segId: "legacy", kind: "focus", segment: "focus", start, ms: 600_000, completed: false }], tasksDone: [] }]]);
  vi.clearAllTimers(); vi.setSystemTime(start + 4_440_000); vi.resetModules(); m = await setup(); m.startTicker(); await Promise.resolve();
  expect(focus()).toBe(600_000); expect(away()[0]?.start).toBe(start + 600_000); expect(away()[0]?.ms).toBe(3_840_000);
});
it("backward clocks cannot create negative or future credit", async () => {
  m.timerActions.start(); vi.advanceTimersByTime(10_000); hide(); await reopen(-20_000);
  expect(focus()).toBe(10_000); expect(away()).toHaveLength(0); expect(m.timer.get().startedAt).toBeNull();
});
it("away does not alter compatibility score inputs or streaks", async () => {
  const data = { chunks: [{ id: "away", kind: "break" as const, segment: "short" as const, start: Date.now(), ms: 83_100_000, completed: false, away: true }], tasksDone: [] };
  expect(m.summarize(data, 0).breakMs).toBe(83_100_000); expect(m.scoreInputs(data, Date.now(), 0).breakMin).toBe(0);
  expect(m.streak(m.byDay(data))).toBe(0); expect(m.focusRecordDays(data).size).toBe(0);
});

it('a web audio deadline callback after sleep settles before it can award the planned block', async () => {
  window.desktop = undefined; m.timerActions.start(); vi.advanceTimersByTime(10_000);
  const { scheduleEnd } = await import('../audio/core'); const callback = vi.mocked(scheduleEnd).mock.calls.at(-1)![1];
  vi.setSystemTime(Date.now() + 3_600_000); callback();
  expect(focus()).toBe(0); expect(away()[0]?.ms).toBe(3_610_000); expect(m.timer.get().startedAt).toBeNull();
});
it('native pause arriving before the wake tick cannot bank sleep as focus', () => {
  m.timerActions.start(); vi.advanceTimersByTime(10_000); const at = Date.now();
  Object.assign(window.desktop!, { consumeSuspensionAt: vi.fn().mockReturnValueOnce({ at, suspended: false }).mockReturnValue(null) });
  vi.setSystemTime(at + 60_000); m.timerActions.pause();
  expect(focus()).toBe(10_000); expect(away()[0]?.ms).toBe(60_000);
});
it('a portable running timer cannot carry another device clock into this idle timer', () => {
  const snapshot = { ...m.INITIAL_TIMER, segId: 'imported', startedAt: Date.now() - 3_600_000, creditedUpTo: 10_000, frozen: true, frozenTotal: 1_500_000 };
  const restored = m.prepareTimerRestore([['timer', snapshot]], false).entries;
  expect(new Map(restored).get('timer')).toMatchObject({ startedAt: null, elapsedBefore: 10_000, reentry: expect.any(String) });
});

it('a clock discontinuity while stopped cannot spill into a newly started block', () => {
  window.desktop = undefined; const mono = performance.now();
  vi.spyOn(performance, 'now').mockReturnValue(mono + 61_000); m.checkRecoveryLifecycle();
  vi.mocked(performance.now).mockReturnValue(mono); m.timerActions.start(); m.checkRecoveryLifecycle();
  expect(m.timer.get().startedAt).not.toBeNull(); expect(away()).toHaveLength(0);
});

it('native pre-sleep callbacks retain departure until the explicit post-wake latch', async () => {
  m.timerActions.start(); vi.advanceTimersByTime(10_000); const at = Date.now(); let suspended = true;
  Object.assign(window.desktop!, { consumeSuspensionAt: () => ({ at, suspended }) });
  const lifecycle = vi.mocked(window.desktop!.onLifecycle!).mock.calls.at(-1)![0]; lifecycle('suspend');
  vi.advanceTimersByTime(1_000); expect(away()).toHaveLength(0);
  expect(m.clockPresence.get()).toMatchObject({ departedAt: at });
  vi.setSystemTime(at + 3_600_000); suspended = false; lifecycle('resume');
  expect(focus()).toBe(10_000); expect(away()[0]?.ms).toBe(3_600_000);
});
it.each(['pause', 'task', 'quit'])('web %s before the wake tick cannot overwrite the last heartbeat', async action => {
  window.desktop = undefined; const tasks = await import('./tasks'); tasks.addTask({ title: 'First' });
  const id = tasks.addTask({ title: 'Next' }); m.timerActions.start(); vi.advanceTimersByTime(30_000);
  vi.setSystemTime(Date.now() + 60_000);
  if (action === 'pause') m.timerActions.pause();
  else if (action === 'task') tasks.focusPick.set(id);
  else await m.prepareTimerDeparture();
  expect(focus()).toBe(30_000); expect(away()[0]?.ms).toBe(60_000); expect(m.timer.get().startedAt).toBeNull();
});
it('zero-credit Hard recovery cannot replace the locked block with a tiny start', async () => {
  m.settingsUpdate('timer', { hardMode: true }); m.timerActions.start(); hide(); await reopen(10_000);
  m.answerRecovery(m.recoveryCommand(), 'dismiss');
  expect(await m.requestTinyBlock(m.recoveryCommand(), 1)).toBe(false);
  expect(m.timer.get()).toMatchObject({ startedAt: null, frozenTotal: 1_500_000, hardLocked: true });
});

it('a queued deadline callback after pagehide cannot settle departure before the next return', async () => {
  window.desktop = undefined; m.timerActions.start(); vi.advanceTimersByTime(30_000); hide();
  vi.setSystemTime(Date.now() + 3_600_000); m.timerActions.complete(m.timer.get().segId, true);
  expect(m.clockPresence.get()).toMatchObject({ departedAt: expect.any(Number) }); expect(away()).toHaveLength(0);
  await reopen(60_000); expect(focus()).toBe(30_000); expect(away()[0]?.ms).toBe(3_660_000);
});

it.each([
  ['pomodoro', 'focus', 'block'], ['countdown', 'focus', 'session'], ['pomodoro', 'long', 'session'],
] as const)('completed %s %s recovery preserves the configured %s parking review', async (mode, segment, boundary) => {
  const p = await import('./parkingReview'), thoughts = await import('./parked');
  m.settingsUpdate('timer', { mode }); p.chooseReviewBoundary(boundary);
  thoughts.parkThought('Read later', { segment: 'focus' }); const id = thoughts.parked.get()[0].id;
  m.timerActions.goTo(segment); m.timerActions.start(); const start = Date.now(), mono = performance.now();
  vi.spyOn(performance, 'now').mockImplementation(() => mono + Date.now() - start);
  vi.setSystemTime(start + m.totalMs()!); await m.prepareTimerDeparture(); await reopen(3_600_000);
  expect((await import('./parkingReview')).parkingReview.get().review?.itemIds).toEqual([id]);
  m.answerRecovery(m.recoveryCommand(), 'dismiss'); expect(m.recoveryOffer()).toBe('parking-review');
});


it.each(["local", "owner request"])("deleting an away log row through %s preserves its focus row and supports Undo", async route => {
  const tasks = await import("./tasks"); tasks.addTask({ title: "Focus task" });
  m.timerActions.start(); vi.advanceTimersByTime(30_000); hide(); await reopen(60_000);
  const original = m.stats.get().chunks;
  const row = m.sessionLog(m.stats.get(), [], { taskId: "" }).flatMap(day => day.sessions).find(item => item.kind === "break")!;
  expect(row).toBeDefined();
  const undo = route === "local" ? m.deleteSession(row)! : await m.requestDeleteSession(row);
  expect(m.stats.get().chunks).toEqual(original.filter(chunk => chunk.kind === "focus"));
  expect(focus()).toBe(30_000);
  undo(); await Promise.resolve();
  expect(m.stats.get().chunks).toEqual(original);
});

it.each(["web", "Mac"])("a %s task selection before wake reconciliation owns the resumed focus time", async platform => {
  if (platform === "web") window.desktop = undefined;
  const tasks = await import("./tasks");
  const first = tasks.addTask({ title: "First" }), next = tasks.addTask({ title: "Next" });
  m.timerActions.start(); vi.advanceTimersByTime(30_000); const at = Date.now();
  if (platform === "Mac") Object.assign(window.desktop!, {
    consumeSuspensionAt: vi.fn().mockReturnValueOnce({ at, suspended: false }).mockReturnValue(null),
  });
  vi.setSystemTime(at + 60_000); tasks.focusPick.set(next);
  expect(m.timer.get()).toMatchObject({ startedAt: null, taskId: next, context: { taskId: next, taskTitle: "Next" } });
  expect(m.answerRecovery(m.recoveryCommand(), "resume")).toBe(true);
  vi.advanceTimersByTime(5_000); m.timerActions.pause();
  const chunks = m.stats.get().chunks.filter(chunk => chunk.kind === "focus");
  expect(chunks.filter(chunk => chunk.taskId === first).reduce((n, chunk) => n + chunk.ms, 0)).toBe(30_000);
  expect(chunks.filter(chunk => chunk.taskId === next).reduce((n, chunk) => n + chunk.ms, 0)).toBe(5_000);
  expect(away()[0]?.ms).toBe(60_000);
});
