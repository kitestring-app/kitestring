import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IDBFactory } from "fake-indexeddb";
vi.mock("../audio/core", () => ({ cancelAllChimes: vi.fn(), playTimerTick: vi.fn(), cancelChime: vi.fn(), cancelEnd: vi.fn(), releaseChime: vi.fn(), scheduleChime: vi.fn(), scheduleEnd: vi.fn() }));
vi.mock("../audio/companion", () => ({ armCompanionWithSpeech: vi.fn().mockResolvedValue(false), cancelCompanionSpeech: vi.fn(), companionAvailable: vi.fn().mockResolvedValue(false), companionKnownUp: vi.fn(() => false), disarmCompanion: vi.fn() }));
describe.each(["remaining", "elapsed", "hidden"] as const)("Recovery with %s time", display => {
let modules: Awaited<ReturnType<typeof setup>>;
async function setup() {
  const [t, e, st, ts, i, a, store, db, stats] = await Promise.all([
    import("./timer"), import("./timerEngine"), import("./settings"), import("./tasks"), import("./intent"),
    import("./returnActivity"), import("../lib/store"), import("../lib/db"), import("./stats")]);
  await Promise.all([t.timer.ready, st.settings.ready, ts.tasks.ready, ts.focusPick.ready, i.intent.ready, a.returnActivity.ready, stats.stats.ready, st.calmFoundationReady]);
  return { ...t, ...e, ...st, ...ts, ...i, ...a, ...store, ...db, ...stats };
}
beforeEach(async () => {
  vi.resetModules(); vi.stubGlobal("indexedDB", new IDBFactory()); vi.stubGlobal("BroadcastChannel", undefined);
  vi.stubGlobal("navigator", {});
  vi.stubGlobal("window", { addEventListener: vi.fn(), desktop: { armAlarm: vi.fn().mockResolvedValue(true), disarmAlarm: vi.fn(), release: vi.fn(), cancelSpeech: vi.fn(), onLifecycle: vi.fn() } });
  vi.stubGlobal("document", { addEventListener: vi.fn(), visibilityState: "visible" });
  vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout", "setInterval", "clearInterval"] }); vi.setSystemTime(Date.UTC(2026, 9, 20, 12));
  modules = await setup();
  modules.settings.set({ ...modules.DEFAULT_SETTINGS, timer: { ...modules.DEFAULT_SETTINGS.timer, display, autoRun: "always", takeover: false, speak: false, notify: false, bringToFront: false } });
  modules.intent.set({ action: "Write the first paragraph", why: "Send a draft", cue: "After tea", rev: 3, updatedAt: Date.now() });
  modules.tasks.set([{ id: "draft", title: "Draft", done: false, createdAt: Date.now(), etaMin: 7 }]);
  modules.timer.set({ ...modules.INITIAL_TIMER, segId: "first", frozen: true, frozenTotal: 60_000 });
});
afterEach(async () => { vi.restoreAllMocks(); vi.clearAllTimers(); vi.useRealTimers(); await modules?.flushReadyStores(); vi.unstubAllGlobals(); });
function finish(missed = true) {
  modules.timerActions.start();
  vi.setSystemTime(Date.now() + 120_000);
  modules.timerActions.complete("first", missed);
}
const focusMs = () => modules.stats.get().chunks.filter(c => c.kind === "focus").reduce((sum, c) => sum + c.ms, 0);

it("PR2 round 2: reset clears pause recovery, preserves context and credit, and allows a tiny start", async () => {
  modules.timerActions.start();
  vi.setSystemTime(Date.now() + 15_000);
  modules.timerActions.pause();
  expect(modules.recoveryOffer()).toBe("re-entry");
  const context = modules.timer.get().context!;
  modules.timerActions.reset();
  expect(modules.timer.get()).toMatchObject({ startedAt: null, elapsedBefore: 0, creditedUpTo: 0,
    context: { ...context, spentMs: 15_000 } });
  expect(modules.timer.get().reentry).toBeUndefined();
  expect(modules.timer.get().boundary).toBeUndefined();
  expect(modules.recoveryOffer()).toBeNull();
  expect(focusMs()).toBe(15_000);
  expect(modules.startTinyBlock(modules.timer.get().segId, 5)).toBe(true);
  vi.setSystemTime(Date.now() + 1000);
  modules.timerActions.pause();
  expect(focusMs()).toBe(16_000);
  await modules.flushReadyStores();
  expect((await modules.dbGet<any>("stats")).chunks.reduce((sum: number, c: any) => sum + c.ms, 0)).toBe(16_000);
});

it("PR2 round 2: reset clears the completion boundary and Start runs the reset break", () => {
  modules.settings.set({ ...modules.settings.get(), timer: { ...modules.settings.get().timer, autoRun: "off" } });
  finish(false);
  const context = modules.timer.get().context;
  expect(modules.timer.get()).toMatchObject({ segment: "short", boundary: { id: "first" } });
  modules.timerActions.reset();
  expect(modules.timer.get().boundary).toBeUndefined();
  expect(modules.timer.get().reentry).toBeUndefined();
  expect(modules.recoveryOffer()).toBeNull();
  expect(modules.timer.get().context).toEqual(context);
  modules.timerActions.start();
  expect(modules.timer.get()).toMatchObject({ segment: "short", startedAt: Date.now(), frozenTotal: 300_000 });
  expect(focusMs()).toBe(60_000);
});

describe("C5 saved settlement and accounting", () => {
  it("settles a missed end once without Strong auto-run, retains context and the real deadline", async () => {
    const start = Date.now(); finish();
    expect(modules.timer.get()).toMatchObject({ startedAt: null, boundary: { id: "first", missed: true }, context: { action: "Write the first paragraph", why: "Send a draft", taskTitle: "Draft", spentMs: 60_000 } });
    expect(focusMs()).toBe(60_000);
    expect(modules.stats.get().chunks[0].start).toBe(start);
    modules.timerActions.complete("first", true);
    expect(focusMs()).toBe(60_000);
    await modules.flushReadyStores();
    expect((await modules.dbGet<any>("timer")).boundary.id).toBe("first");
  });
  it.each(["continue", "break", "stop"] as const)("%s consumes its boundary once and retains every partial millisecond", action => {
    finish(); const command = modules.recoveryCommand();
    expect(modules.answerRecovery(command, action, 5000)).toBe(true);
    const next = modules.timer.get();
    expect(modules.answerRecovery(command, action, 5000)).toBe(false);
    expect(modules.timer.get()).toBe(next);
    if (action !== "stop") {
      vi.setSystemTime(Date.now() + 600);
      modules.timerActions.pause(); modules.timerActions.stop();
    }
    expect(focusMs()).toBe(action === "continue" ? 60_600 : 60_000);
    const breakMs = modules.stats.get().chunks.filter(c => c.kind === "break").reduce((sum, c) => sum + c.ms, 0);
    expect(breakMs).toBe(action === "break" ? 600 : 0);
    expect(modules.stats.get().chunks.filter(c => c.segId === "first" && c.completed)).toHaveLength(1);
  });
  it("recovers the committed boundary on restart and never credits it again", async () => {
    finish(); await modules.flushReadyStores();
    const saved = await modules.dbGet<any>("timer");
    vi.clearAllTimers(); vi.resetModules(); modules = await setup();
    expect(modules.timer.get()).toMatchObject(saved);
    modules.timerActions.complete("first", true);
    expect(focusMs()).toBe(60_000);
    expect(modules.answerRecovery(modules.recoveryCommand(), "continue", 5000)).toBe(true);
    expect(modules.timer.get().segId).not.toBe(saved.segId);
  });
  it("keeps Strong auto-run during a live completion", () => {
    finish(false);
    expect(modules.timer.get()).toMatchObject({ segment: "short", startedAt: Date.now() });
    expect(modules.timer.get().boundary).toBeUndefined();
  });
  it("banks a partial before Continue and respects task ETA behind an override", () => {
    modules.settings.set({ ...modules.settings.get(), timer: { ...modules.settings.get().timer, taskEta: true } });
    modules.timerActions.start(); vi.setSystemTime(Date.now() + 20_000); modules.timerActions.pause(); modules.timerActions.start();
    vi.setSystemTime(Date.now() + 40_000); modules.timerActions.complete("first", true);
    expect(focusMs()).toBe(60_000);
    expect(modules.answerRecovery(modules.recoveryCommand(), "continue")).toBe(true);
    expect(modules.timer.get().frozenTotal).toBe(7 * 60_000);
  });
});
describe("C4 stale session/action commands and preserved context", () => {
  it("rejects stale boundary, session, action ID and revision before any mutation", () => {
    finish(); const command = modules.recoveryCommand(), before = modules.timer.get();
    for (const patch of [{ offerId: "old" }, { expectedSegId: "old" }, { actionId: "old" }, { actionRevision: 9 }, { intentRevision: 9 }]) {
      expect(modules.answerRecovery({ ...command, ...patch }, "continue")).toBe(false);
      expect(modules.timer.get()).toBe(before);
    }
    modules.updateIntent({ action: "A different action" });
    expect(modules.answerRecovery(command, "continue")).toBe(false);
    expect(focusMs()).toBe(60_000);
  });
  it("pause card resumes once, remains usable after task deletion, and cannot toggle back", () => {
    modules.timerActions.start(); vi.setSystemTime(Date.now() + 15_000); modules.timerActions.pause();
    modules.deleteTask("draft");
    const command = modules.recoveryCommand();
    expect(modules.recoveryOffer()).toBe("re-entry");
    expect(modules.timer.get().context?.taskTitle).toBe("Draft");
    expect(modules.answerRecovery(command, "resume")).toBe(true);
    expect(modules.answerRecovery(command, "resume")).toBe(false);
    expect(modules.timer.get().startedAt).toBe(Date.now());
  });
  it("returns from a partial break without losing break time", () => {
    finish(); modules.answerRecovery(modules.recoveryCommand(), "break");
    modules.timer.set({ ...modules.timer.get(), reentry: "reopened-break" });
    vi.setSystemTime(Date.now() + 1000);
    expect(modules.answerRecovery(modules.recoveryCommand(), "resume")).toBe(true);
    expect(modules.timer.get().segment).toBe("short");
    modules.timerActions.pause();
    expect(modules.stats.get().chunks.filter(c => c.kind === "break").reduce((s, c) => s + c.ms, 0)).toBe(1000);
    expect(modules.timer.get().context?.spentMs).toBe(60_000);
  });
});
it("C3 lifecycle native wake settles first and defers the gap behind recovery", async () => {
  modules.startTicker(); await Promise.resolve(); await Promise.resolve();
  modules.timerActions.start();
  const old = Date.now();
  modules.returnActivity.set({ version: 1, lastPurposefulAt: old, pendingGap: null, acknowledgedGap: null, uncertain: false });
  vi.setSystemTime(old + 3 * 86_400_000);
  modules.checkRecoveryLifecycle(true);
  expect(modules.returnActivity.get().pendingGap).toBe(`gap:${old}`);
  expect(modules.recoveryOffer()).toBe("missed-end");
  modules.answerRecovery(modules.recoveryCommand(), "stop");
  expect(modules.recoveryOffer()).toBe("gap-return");
});
it.each(["keep", "move", "drop"] as const)("C3/C6 gap %s is acknowledged once and never changes tasks/history", action => {
  const before = modules.tasks.get();
  modules.returnActivity.set({ version: 1, lastPurposefulAt: Date.now() - 3 * 86_400_000, pendingGap: "gap:old", acknowledgedGap: null, uncertain: false });
  const command = modules.recoveryCommand();
  expect(modules.answerRecovery(command, action)).toBe(true);
  expect(modules.answerRecovery(command, action)).toBe(false);
  expect(modules.tasks.get()).toBe(before);
  expect(modules.intent.get().action).toBe(action === "keep" ? "Write the first paragraph" : "");
  expect(modules.intent.get().cue).toBe(action === "keep" ? "After tea" : undefined);
  expect(modules.returnActivity.get().acknowledgedGap).toBe("gap:old");
});
it("C5 interrupted durable settle leaves both old timer and old credit intact, then retry commits both", async () => {
  await modules.flushReadyStores();
  const oldTimer = await modules.dbGet("timer"), oldStats = await modules.dbGet("stats");
  const dbModule = await import("../lib/db");
  const original = dbModule.dbSetMany;
  const write = vi.spyOn(dbModule, "dbSetMany").mockRejectedValueOnce(new DOMException("Disk full", "QuotaExceededError"));
  finish(); await modules.flushAll();
  expect(await modules.dbGet("timer")).toEqual(oldTimer);
  expect(await modules.dbGet("stats")).toEqual(oldStats);
  expect(modules.persistStatus.get().ok).toBe(false);
  write.mockImplementation(original);
  await modules.flushReadyStores();
  expect((await modules.dbGet<any>("timer")).boundary.id).toBe("first");
  expect((await modules.dbGet<any>("stats")).chunks.filter((c: any) => c.completed)).toHaveLength(1);
  write.mockRestore();
});
it("C5 an unload flush queued before banking cannot persist creditedUpTo without its matching credit", async () => {
  modules.timerActions.start();
  const queued = modules.flushAll();
  vi.setSystemTime(Date.now() + 1234); modules.timerActions.pause();
  await queued; await modules.flushReadyStores();
  const saved = await modules.dbGet<any>("timer"), stats = await modules.dbGet<any>("stats");
  expect(saved.creditedUpTo).toBe(1234);
  expect(stats.chunks.reduce((sum: number, c: any) => sum + c.ms, 0)).toBe(1234);
});
it("C6 v1 backup still imports; saved context is additive while gap metadata stays on this device", async () => {
  finish(); await modules.flushReadyStores();
  const backup = await import("../lib/backup");
  const exported = backup.parseBackup(await backup.createBackup());
  expect(exported.data.timer).toMatchObject({ boundary: { id: "first" }, context: { action: "Write the first paragraph" } });
  expect(exported.data).not.toHaveProperty("returnActivity");
  const localActivity = modules.returnActivity.get();
  const { readFileSync } = await import("node:fs");
  const golden = backup.parseBackup(readFileSync(new URL("../lib/fixtures/backup-v1.json", import.meta.url), "utf8"));
  await backup.restoreBackup(golden, async () => ["sync-meta", {}]);
  expect(modules.returnActivity.get()).toBe(localActivity);
  expect(modules.timer.get().boundary).toBeUndefined();
  expect(modules.timer.get().context).toBeUndefined();
  expect(modules.stats.get()).toEqual(golden.data.stats);
  for (const field of [{ context: {} }, { boundary: { id: "bad" } }, { reentry: {} }]) {
    expect(() => backup.parseBackup(JSON.stringify({ format: backup.BACKUP_FORMAT, version: 1, data: { timer: { ...modules.INITIAL_TIMER, ...field } } }))).toThrow("invalid timer");
  }
});
it("C3 a multi-day running process evaluates at cadence, queues during work, and focus alone never counts as activity", async () => {
  modules.startTicker(); await Promise.resolve(); await Promise.resolve();
  const last = Date.now() - 3 * 86_400_000;
  modules.returnActivity.set({ version: 1, lastPurposefulAt: last, pendingGap: null, acknowledgedGap: null, uncertain: false });
  vi.advanceTimersByTime(30_000);
  expect(modules.returnActivity.get().pendingGap).toBe(`gap:${last}`);
  expect(modules.recoveryOffer()).toBe("gap-return");
  modules.checkRecoveryLifecycle();
  expect(modules.returnActivity.get().lastPurposefulAt).toBe(last);
  modules.timerActions.start();
  expect(modules.recoveryOffer()).toBeNull();
  modules.timerActions.pause();
  expect(modules.recoveryOffer()).toBe("re-entry");
  modules.answerRecovery(modules.recoveryCommand(), "dismiss");
  expect(modules.recoveryOffer()).toBe("gap-return");
});
it("C3 an unexplained clock change suppresses a pending gap until purposeful action rebases", () => {
  modules.checkReturnActivity();
  modules.returnActivity.set({ version: 1, lastPurposefulAt: Date.now(), pendingGap: null, acknowledgedGap: null, uncertain: false });
  vi.setSystemTime(Date.now() - 48 * 3_600_000); modules.checkReturnActivity();
  expect(modules.returnActivity.get()).toMatchObject({ pendingGap: null, uncertain: true });
  modules.purposefulAction();
  expect(modules.returnActivity.get()).toMatchObject({ lastPurposefulAt: Date.now(), uncertain: false });
});
it("C4/C5 a live break ends in one Resume card without pausing a running focus", () => {
  modules.settings.set({ ...modules.settings.get(), timer: { ...modules.settings.get().timer, autoRun: "off" } });
  modules.timerActions.goTo("short"); modules.timerActions.start();
  const id = modules.timer.get().segId;
  vi.setSystemTime(Date.now() + modules.totalMs()!);
  modules.timerActions.complete(id);
  expect(modules.recoveryOffer()).toBe("re-entry");
  expect(modules.timer.get()).toMatchObject({ segment: "focus", startedAt: null });
  expect(modules.answerRecovery(modules.recoveryCommand(), "resume")).toBe(true);
  expect(modules.timer.get().startedAt).toBe(Date.now());
});
it("C5 late leader election settles the restored run before arming an alarm or auto-starting", async () => {
  await modules.flushReadyStores();
  await modules.dbSet("timer", { ...modules.INITIAL_TIMER, segId: "late-election", startedAt: Date.now() - 120_000, frozen: true, frozenTotal: 60_000 });
  vi.resetModules();
  let grant: (() => Promise<void>) | undefined;
  vi.stubGlobal("navigator", { locks: { request: (_name: string, callback: () => Promise<void>) => { grant = callback; return new Promise<void>(() => {}); } } });
  modules = await setup();
  modules.startTicker(); await Promise.resolve(); await Promise.resolve();
  expect(modules.timer.get().segId).toBe("late-election");
  expect(grant).toEqual(expect.any(Function));
  await modules.acquireTimerOwnership();
  expect(modules.timer.get()).toMatchObject({ startedAt: null, boundary: { id: "late-election", missed: true } });
  expect(focusMs()).toBe(60_000);
  expect(modules.recoveryOffer()).toBe("missed-end");
});
it("C4 a stale card cannot even settle or credit a newer expired session", () => {
  finish(); const old = modules.recoveryCommand();
  modules.answerRecovery(old, "continue", 1000);
  vi.setSystemTime(Date.now() + 2000);
  const before = modules.timer.get(), beforeStats = modules.stats.get();
  expect(modules.answerRecovery(old, "continue")).toBe(false);
  expect(modules.timer.get()).toBe(before);
  expect(modules.stats.get()).toBe(beforeStats);
});
it("C3 cloud/backup receives do not count as purposeful task edits", async () => {
  const original = modules.returnActivity.get();
  await modules.applyRemote("tasks", [{ id: "remote", title: "Synced", createdAt: Date.now(), done: false }]);
  expect(modules.returnActivity.get()).toBe(original);
  modules.editTaskOrder(all => [...all]);
  expect(modules.returnActivity.get().lastPurposefulAt).toBe(Date.now());
});
it("C4 a return offer cannot bypass Hard mode with an optional short block", () => {
  modules.settings.set({ ...modules.settings.get(), timer: { ...modules.settings.get().timer, hardMode: true } });
  modules.timerActions.goTo("short"); modules.timerActions.start();
  modules.returnActivity.set({ version: 1, lastPurposefulAt: Date.now() - 3 * 86_400_000, pendingGap: "gap:locked", acknowledgedGap: null, uncertain: false });
  const before = modules.timer.get();
  expect(modules.answerRecovery(modules.recoveryCommand(), "short-block")).toBe(false);
  expect(modules.timer.get()).toBe(before);
  expect(modules.returnActivity.get().pendingGap).toBe("gap:locked");
});

it("review2 P2: switching A to B, pausing and resuming keeps B attribution and its context", async () => {
  modules.timer.set({ ...modules.INITIAL_TIMER, segId: "task-switch" });
  modules.tasks.set([{ id: "A", title: "Task A", done: false, createdAt: 1 }, { id: "B", title: "Task B", done: false, createdAt: 2 }]);
  modules.startTicker(); await Promise.resolve(); await Promise.resolve();
  modules.timerActions.start(); vi.setSystemTime(Date.now() + 60_000);
  modules.focusPick.set("B"); vi.setSystemTime(Date.now() + 60_000); modules.timerActions.pause();
  expect(modules.timer.get().context).toMatchObject({ taskId: "B", taskTitle: "Task B" });
  modules.timerActions.start(); vi.setSystemTime(Date.now() + 60_000); modules.timerActions.pause();
  expect(modules.stats.get().chunks.filter(c => c.kind === "focus").map(c => [c.taskId, c.ms])).toEqual([["A", 60_000], ["B", 60_000], ["B", 60_000]]);
  modules.focusPick.set("A"); modules.timerActions.start();
  expect(modules.timer.get()).toMatchObject({ taskId: "A", context: { taskId: "A", taskTitle: "Task A" } });
});
it("review2 P2: idle Start captures a remote intent with equal revision and newer timestamp", async () => {
  modules.timerActions.start(); modules.timerActions.stop();
  const pin = modules.intent.get();
  await modules.applyRemote("intent", { ...pin, action: "New remote action", cue: "New remote cue", updatedAt: pin.updatedAt + 1 });
  modules.timerActions.start();
  expect(modules.timer.get().context).toMatchObject({ action: "New remote action", cue: "New remote cue", actionId: `intent:${pin.updatedAt + 1}` });
});
it("review2 P2: a native wake reconciles suspension after ordinary checks already latched uncertainty", () => {
  const last = Date.now();
  modules.returnActivity.set({ version: 1, lastPurposefulAt: last, pendingGap: null, acknowledgedGap: null, uncertain: false });
  modules.checkReturnActivity(false, last, 100);
  modules.checkReturnActivity(false, last + 3 * 86_400_000, 200);
  expect(modules.returnActivity.get()).toMatchObject({ uncertain: true, pendingGap: null });
  modules.checkReturnActivity(false, last + 3 * 86_400_000 + 30_000, 30_200);
  modules.checkReturnActivity(true, last + 3 * 86_400_000 + 30_001, 30_201);
  expect(modules.returnActivity.get()).toMatchObject({ uncertain: false, pendingGap: `gap:${last}` });
});
it("review2 P2: native wake never clears backwards-clock or pre-existing uncertainty", () => {
  const last = Date.now();
  modules.returnActivity.set({ version: 1, lastPurposefulAt: last, pendingGap: null, acknowledgedGap: null, uncertain: true });
  modules.checkReturnActivity(false, last, 100);
  modules.checkReturnActivity(false, last + 3 * 86_400_000, 200);
  modules.checkReturnActivity(true, last + 3 * 86_400_000 + 1, 201);
  expect(modules.returnActivity.get().uncertain).toBe(true);
  modules.returnActivity.set({ ...modules.returnActivity.get(), uncertain: false });
  modules.checkReturnActivity(false, last - 1, 202);
  modules.checkReturnActivity(true, last + 4 * 86_400_000, 203);
  expect(modules.returnActivity.get()).toMatchObject({ uncertain: true, pendingGap: null });
});

it.each([false, true])("PR2: explicit task choice after deletion banks old credit and switches attribution (paused=%s)", async paused => {
  modules.timer.set({ ...modules.INITIAL_TIMER, segId: "deleted-task-switch" });
  modules.tasks.set([{ id: "A", title: "Deleted task context", done: false, createdAt: 1 }, { id: "B", title: "New task", done: false, createdAt: 2 }]);
  modules.startTicker(); await Promise.resolve(); await Promise.resolve();
  modules.timerActions.start();
  vi.setSystemTime(Date.now() + 10_000);
  if (paused) modules.timerActions.pause();
  modules.deleteTask("A");
  expect(modules.timer.get()).toMatchObject({ taskId: "A", context: { taskId: "A", taskTitle: "Deleted task context" } });
  // A later list edit must not silently replace the deleted task's saved context.
  modules.updateTask("B", { title: "Chosen task" });
  expect(modules.timer.get().context?.taskTitle).toBe("Deleted task context");
  if (!paused) vi.setSystemTime(Date.now() + 5000);
  modules.focusPick.set("B");
  expect(modules.timer.get()).toMatchObject({ taskId: "B", context: { taskId: "B", taskTitle: "Chosen task", action: "Write the first paragraph" } });
  const oldCredit = paused ? 10_000 : 15_000;
  expect(modules.timer.get().creditedUpTo).toBe(oldCredit);
  if (paused) modules.timerActions.start();
  vi.setSystemTime(Date.now() + 5000); modules.timerActions.pause();
  expect(modules.stats.get().chunks.filter(c => c.kind === "focus").map(c => [c.taskId, c.ms])).toEqual([["A", oldCredit], ["B", 5000]]);
});

it("PR2: parking conversion after a queued timer flush commits the cursor, task and thought together", async () => {
  const review = await import("./parkingReview");
  const { parked } = await import("./parked");
  await Promise.all([review.parkingReview.ready, parked.ready]);
  parked.set([{ id: "convert", text: "Make an outline", at: Date.now(), segment: "focus", status: "open" },
    { id: "later", text: "Check references", at: Date.now(), segment: "focus", status: "open" }]);
  review.openParkingReview();
  await modules.flushReadyStores();
  const db = await import("../lib/db");
  const write = vi.spyOn(db, "dbSetMany");
  try {
    modules.timer.set({ ...modules.timer.get(), reentry: "queued-before-conversion" });
    const queued = modules.flushAll();
    const id = review.parkingReview.get().review!.id;
    expect(review.answerParkingReview(id, "convert", "task").ok).toBe(true);
    await queued;
    const entries = new Map(write.mock.calls[0][0]);
    expect(entries.get("parkingReview")).toMatchObject({ review: { id, cursor: 1 } });
    expect(entries.get("parked")).toEqual(parked.get());
    expect(entries.get("tasks")).toEqual(modules.tasks.get());
    expect(await modules.dbGet("tasks")).toEqual(expect.arrayContaining([expect.objectContaining({ title: "Make an outline" })]));
    expect(await modules.dbGet("parked")).toEqual(expect.arrayContaining([expect.objectContaining({ id: "convert", status: "tasked" })]));
    expect(await modules.dbGet("parkingReview")).toMatchObject({ review: { id, cursor: 1 } });
  } finally { write.mockRestore(); }
});

it.each(["off", "always"] as const)("round3 task selection during a break refreshes fresh focus attribution (autoRun=%s)", async autoRun => {
  modules.settings.set({ ...modules.settings.get(), timer: { ...modules.settings.get().timer, autoRun } });
  modules.tasks.set([{ id: "A", title: "Task A", done: false, createdAt: 1 }, { id: "B", title: "Task B", done: false, createdAt: 2 }]);
  modules.startTicker(); await Promise.resolve(); await Promise.resolve();
  modules.timerActions.start();
  vi.setSystemTime(Date.now() + modules.totalMs()!); modules.timerActions.complete("first");
  if (autoRun === "off") { modules.timerActions.reset(); modules.timerActions.start(); }
  modules.focusPick.set("B");
  const id = modules.timer.get().segId;
  vi.setSystemTime(Date.now() + modules.totalMs()!); modules.timerActions.complete(id);
  if (autoRun === "off") modules.timerActions.start();
  expect(modules.timer.get()).toMatchObject({ segment: "focus", taskId: "B", context: { taskId: "B", taskTitle: "Task B", action: "Write the first paragraph" } });
  vi.setSystemTime(Date.now() + 1000); modules.timerActions.pause();
  expect(modules.stats.get().chunks.at(-1)).toMatchObject({ kind: "focus", taskId: "B", ms: 1000 });
});

it.each([false, true])("round3 Resume retains an unfinished break and its credit (running=%s)", running => {
  modules.timerActions.goTo("short"); modules.timerActions.start();
  vi.setSystemTime(Date.now() + 60_000);
  if (!running) modules.timerActions.pause();
  else modules.timer.set({ ...modules.timer.get(), reentry: "hidden-break" });
  const before = modules.timer.get();
  expect(modules.answerRecovery(modules.recoveryCommand(), "resume")).toBe(true);
  expect(modules.timer.get()).toMatchObject({ segId: before.segId, segment: "short", frozenTotal: 300_000 });
  expect(modules.timer.get().startedAt).not.toBeNull();
  expect(modules.timer.get().reentry).toBeUndefined();
  expect(modules.elapsed(modules.timer.get(), Date.now())).toBe(60_000);
  vi.setSystemTime(Date.now() + 1000); modules.timerActions.pause();
  expect(modules.stats.get().chunks.filter(c => c.kind === "break").reduce((sum, c) => sum + c.ms, 0)).toBe(61_000);
});

it.each(["off", "always", "cycle"] as const)("round3 live break takeover is reachable without a competing recovery (autoRun=%s)", async autoRun => {
  const { transitionStore } = await import("../ui/timer/TransitionStore");
  modules.settings.set({ ...modules.settings.get(), timer: { ...modules.settings.get().timer, takeover: true, autoRun } });
  modules.timerActions.goTo("short"); modules.timerActions.start();
  vi.setSystemTime(Date.now() + modules.totalMs()!); modules.timerActions.complete(modules.timer.get().segId);
  expect(transitionStore.get()).not.toBeNull();
  expect(modules.recoveryOffer()).toBeNull();
  if (modules.timer.get().startedAt === null) {
    modules.timerActions.start();
    expect(transitionStore.get()).toBeNull();
  }
});
it("round3 auto-run focus without takeover has no Resume card", () => {
  modules.timerActions.goTo("short"); modules.timerActions.start();
  vi.setSystemTime(Date.now() + modules.totalMs()!); modules.timerActions.complete(modules.timer.get().segId);
  expect(modules.timer.get()).toMatchObject({ segment: "focus", startedAt: Date.now() });
  expect(modules.recoveryOffer()).toBeNull();
});

it.each(["move", "drop"] as const)("round3 gap %s clears the whole intent document", action => {
  modules.updateIntent({ reward: "Tea" });
  modules.returnActivity.set({ version: 1, lastPurposefulAt: Date.now() - 3 * 86_400_000, pendingGap: "gap:old", acknowledgedGap: null, uncertain: false });
  expect(modules.answerRecovery(modules.recoveryCommand(), action)).toBe(true);
  expect(modules.intent.get()).toMatchObject({ action: "", why: "", cue: undefined, reward: undefined });
});
it("round3 Keep rebases purposeful activity so another gap can be detected", () => {
  const now = Date.now();
  modules.returnActivity.set({ version: 1, lastPurposefulAt: now - 3 * 86_400_000, pendingGap: "gap:old", acknowledgedGap: null, uncertain: false });
  expect(modules.answerRecovery(modules.recoveryCommand(), "keep")).toBe(true);
  expect(modules.returnActivity.get().lastPurposefulAt).toBe(now);
  modules.checkReturnActivity(false, now + 2 * 86_400_000, performance.now() + 2 * 86_400_000);
  expect(modules.returnActivity.get().pendingGap).toBe(`gap:${now}`);
});
it("round3 suspect web sleep is conservative, and purposeful activity restores future gap detection", () => {
  window.desktop = undefined;
  const now = Date.now(), mono = performance.now();
  modules.returnActivity.set({ version: 1, lastPurposefulAt: now, pendingGap: null, acknowledgedGap: null, uncertain: false });
  modules.checkReturnActivity(false, now, mono);
  modules.checkReturnActivity(false, now + 3 * 86_400_000, mono + 1);
  expect(modules.returnActivity.get()).toMatchObject({ uncertain: true, pendingGap: null });
  vi.setSystemTime(now + 3 * 86_400_000);
  modules.purposefulAction();
  expect(modules.returnActivity.get().uncertain).toBe(false);
  modules.checkReturnActivity(false, Date.now() + 2 * 86_400_000, performance.now() + 2 * 86_400_000);
  expect(modules.returnActivity.get().pendingGap).toBe(`gap:${Date.now()}`);
});

it.each(["audio", "pause", "lifecycle", "ticker", "hide"] as const)("round3 a throttled live %s ending preserves auto-run", async path => {
  window.desktop = undefined;
  modules.startTicker(); await new Promise<void>(resolve => queueMicrotask(resolve));
  modules.timerActions.start();
  const now = Date.now(), mono = performance.now();
  vi.spyOn(performance, "now").mockImplementation(() => mono + Date.now() - now);
  vi.setSystemTime(now + 60_000);
  if (path === "audio") {
    const { scheduleEnd } = await import("../audio/core");
    vi.mocked(scheduleEnd).mock.calls.at(-1)![1]();
  } else if (path === "pause") modules.timerActions.pause();
  else if (path === "lifecycle") modules.checkRecoveryLifecycle();
  else if (path === "hide") {
    const bank = vi.mocked(window.addEventListener).mock.calls.filter(([event]) => event === "pagehide").at(-1)![1] as () => void;
    bank();
  } else vi.advanceTimersByTime(250);
  expect(modules.timer.get().boundary).toBeUndefined();
  expect(modules.timer.get()).toMatchObject({ segment: "short", startedAt: expect.any(Number) });
  vi.mocked(performance.now).mockRestore();
});
it.each([false, true])("round3 real clock jumps and native wake remain quiet (nativeWake=%s)", async nativeWake => {
  modules.startTicker(); await new Promise<void>(resolve => queueMicrotask(resolve));
  modules.timerActions.start();
  vi.setSystemTime(Date.now() + 120_000);
  modules.checkRecoveryLifecycle(nativeWake);
  expect(modules.timer.get()).toMatchObject({ startedAt: null, boundary: { missed: true } });
  expect(focusMs()).toBe(60_000);
});

it("round3 reloading an unfinished break resumes its remaining time", async () => {
  modules.timerActions.goTo("short"); modules.timerActions.start();
  const id = modules.timer.get().segId;
  vi.setSystemTime(Date.now() + 60_000);
  await modules.flushReadyStores();
  vi.resetModules(); modules = await setup();
  modules.startTicker(); await new Promise<void>(resolve => queueMicrotask(resolve));
  expect(modules.recoveryOffer()).toBe("re-entry");
  expect(modules.answerRecovery(modules.recoveryCommand(), "resume")).toBe(true);
  expect(modules.timer.get()).toMatchObject({ segId: id, segment: "short", frozenTotal: 300_000 });
  expect(modules.elapsed(modules.timer.get(), Date.now())).toBe(60_000);
  vi.setSystemTime(Date.now() + 1000); modules.timerActions.pause();
  expect(modules.stats.get().chunks.filter(c => c.kind === "break").reduce((sum, c) => sum + c.ms, 0)).toBe(61_000);
});
it("round3 tiny Start clears a pending takeover before running focus", async () => {
  const { transitionStore } = await import("../ui/timer/TransitionStore");
  modules.settings.set({ ...modules.settings.get(), timer: { ...modules.settings.get().timer, takeover: true, autoRun: "off" } });
  modules.timerActions.goTo("short"); modules.timerActions.start();
  vi.setSystemTime(Date.now() + modules.totalMs()!); modules.timerActions.complete(modules.timer.get().segId);
  expect(transitionStore.get()).not.toBeNull();
  expect(modules.startTinyBlock(modules.timer.get().segId, 5)).toBe(true);
  expect(modules.timer.get()).toMatchObject({ segment: "focus", tinyStart: true, startedAt: Date.now() });
  expect(transitionStore.get()).toBeNull();
});


it.each(["together", "stopped"] as const)("round4 suspend latch beats a post-wake tick before resume IPC (clocks=%s)", async clocks => {
  const consumeSuspension = vi.fn(() => false);
  Object.assign(window.desktop!, { consumeSuspension });
  modules.startTicker(); await new Promise<void>(resolve => queueMicrotask(resolve));
  modules.timerActions.start();
  const now = Date.now(), mono = performance.now();
  vi.spyOn(performance, "now").mockImplementation(() => clocks === "together" ? mono + Date.now() - now : mono);
  consumeSuspension.mockReturnValueOnce(true);
  vi.setSystemTime(now + 3_600_000);
  vi.advanceTimersByTime(250); // No resume lifecycle callback has arrived.
  expect(modules.timer.get()).toMatchObject({ startedAt: null, boundary: { id: "first", missed: true } });
  expect(focusMs()).toBe(60_000);
  expect(consumeSuspension).toHaveBeenCalled();
  expect(modules.recoveryOffer()).toBe("missed-end");
  modules.answerRecovery(modules.recoveryCommand(), "continue", 1000);
  vi.setSystemTime(Date.now() + 1000); vi.advanceTimersByTime(250);
  expect(modules.timer.get()).toMatchObject({ segment: "short", startedAt: expect.any(Number) });
  expect(modules.timer.get().boundary).toBeUndefined();
});

it.each([
  ["web", "ticker"], ["web", "lifecycle"], ["web", "syncAudio"], ["web", "audio"],
  ["Mac", "ticker"], ["Mac", "lifecycle"], ["Mac", "syncAudio"],
] as const)("round7 a banked running block reopened on %s ends live through %s", async (platform, path) => {
  if (platform === "web") window.desktop = undefined;
  modules.settingsUpdate("timer", { ...modules.STRONG_PATCH, autoRun: "always" });
  modules.startTicker(); await modules.timerHydrationReady;
  await new Promise<void>(resolve => queueMicrotask(resolve));
  modules.timerActions.start();
  vi.setSystemTime(Date.now() + 15_000);
  const bank = vi.mocked(window.addEventListener).mock.calls.filter(([event]) => event === "pagehide").at(-1)![1] as () => void;
  bank(); await modules.flushReadyStores();
  const saved = modules.timer.get();
  expect(saved).toMatchObject({ startedAt: expect.any(Number), creditedUpTo: 15_000, reentry: expect.any(String) });

  vi.clearAllTimers(); vi.resetModules();
  vi.setSystemTime(saved.startedAt! + 15_000);
  modules = await setup();
  expect(modules.timer.get()).toMatchObject(saved);
  expect(modules.storeSource("timer")).toBe("disk");
  const now = Date.now(), mono = performance.now();
  vi.spyOn(performance, "now").mockImplementation(() => mono + Date.now() - now);
  modules.startTicker(); await modules.timerHydrationReady;
  await new Promise<void>(resolve => queueMicrotask(resolve));
  expect(modules.timer.get()).toEqual(saved);
  expect(modules.storeSource("timer")).toBe("disk");
  const audio = await import("../audio/core");
  const companion = await import("../audio/companion");
  if (platform === "Mac") expect(window.desktop!.armAlarm).toHaveBeenLastCalledWith(expect.objectContaining({ at: saved.startedAt! + 60_000 }));
  else expect(audio.scheduleChime).toHaveBeenLastCalledWith(expect.any(String), expect.any(Number), 45, "focus-done");
  vi.mocked(audio.cancelAllChimes).mockClear();
  vi.mocked(companion.disarmCompanion).mockClear();
  if (platform === "Mac") vi.mocked(window.desktop!.disarmAlarm!).mockClear();

  if (path === "ticker") vi.advanceTimersByTime(45_000);
  else {
    vi.setSystemTime(now + 45_000);
    if (path === "lifecycle") modules.checkRecoveryLifecycle();
    else if (path === "syncAudio") {
      modules.settingsUpdate("timer", { alertVolume: 0.6 });
      expect(modules.timer.get()).toMatchObject({ segId: saved.segId, startedAt: saved.startedAt });
      expect(modules.timer.get().boundary).toBeUndefined();
      vi.advanceTimersByTime(250);
    }
    else vi.mocked(audio.scheduleEnd).mock.calls.at(-1)![1]();
  }
  expect(modules.timer.get()).toMatchObject({ segment: "short", startedAt: now + 45_000 + (path === "syncAudio" ? 250 : 0) });
  expect(modules.timer.get().boundary).toBeUndefined();
  expect(modules.recoveryOffer()).toBeNull();
  expect(focusMs()).toBe(60_000);
  expect(modules.stats.get().chunks.filter(c => c.segId === saved.segId && c.completed)).toHaveLength(1);
  expect((await import("../audio/boundaryAlert")).boundaryAlert.get()).toMatchObject({ segId: saved.segId, sounding: true, silenced: false });
  expect(audio.cancelAllChimes).not.toHaveBeenCalled();
  expect(companion.disarmCompanion).not.toHaveBeenCalled();
  if (platform === "Mac") expect(window.desktop!.disarmAlarm).not.toHaveBeenCalled();
});

it.each(["single", "group"])("Gemini 1: toggling a %s task is purposeful device activity", async kind => {
  const tasks = await import("./tasks");
  const id = tasks.addTask({ title: "Done" });
  const before = Date.now();
  vi.setSystemTime(before + 20 * 60 * 60_000);
  if (kind === "group") tasks.toggleTaskGroup(id); else tasks.toggleTask(id);
  expect(modules.returnActivity.get().lastPurposefulAt).toBe(Date.now());
  vi.setSystemTime(before + 24 * 60 * 60_000 + 1);
  modules.checkReturnActivity(true);
  expect(modules.returnActivity.get().pendingGap).toBeNull();
});

});
