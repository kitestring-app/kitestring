import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.hoisted(() => { vi.stubGlobal("navigator", {}); });
vi.mock("../audio/core", () => ({ cancelAllChimes: vi.fn(), playTimerTick: vi.fn(), cancelChime: vi.fn(), cancelEnd: vi.fn(), releaseChime: vi.fn(), scheduleChime: vi.fn(), scheduleEnd: vi.fn() }));
vi.mock("../audio/companion", () => ({ armCompanionWithSpeech: vi.fn().mockResolvedValue(false), cancelCompanionSpeech: vi.fn(), companionAvailable: vi.fn().mockResolvedValue(false), companionKnownUp: vi.fn(() => false), disarmCompanion: vi.fn() }));
import { BACKUP_FORMAT, createBackup, parseBackup, restoreBackup } from "./backup";
import { dbGet } from "./db";
import { createStore, flushReadyStores, restoreStoreEntries } from "./store";
import * as db from "./db";
import { DEFAULT_SETTINGS, settings } from "../state/settings";
import { startTicker, timer, timerActions } from "../state/timer";
import { INITIAL_TIMER } from "../state/timerEngine";
import { stats } from "../state/stats";
import { focusPick, tasks } from "../state/tasks";

const notes = createStore("notes", "old notes");
let pagehide: (() => void)[];
beforeEach(async () => {
  await Promise.all([timer.ready, settings.ready, stats.ready, notes.ready, tasks.ready, focusPick.ready]);
  vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 9, 25, 10));
  pagehide = [];
  vi.stubGlobal("window", { desktop: {}, addEventListener: (name: string, fn: () => void) => { if (name === "pagehide") pagehide.push(fn); } });
  vi.stubGlobal("document", { addEventListener: vi.fn() });
  timer.set({ ...INITIAL_TIMER, segId: "kept-block" });
  settings.set({ ...DEFAULT_SETTINGS, timer: { ...DEFAULT_SETTINGS.timer, hardMode: true, notify: false, speak: false } });
  stats.set({ chunks: [], tasksDone: [] }); notes.set("old notes");
  tasks.set([{ id: "old-task", title: "Old task", done: false, createdAt: Date.now() }]); focusPick.set("old-task");
  timerActions.start();
});
afterEach(() => { vi.restoreAllMocks(); vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); });
const backup = () => parseBackup(JSON.stringify({ format: BACKUP_FORMAT, version: 1, data: {
  timer: { ...INITIAL_TIMER, segId: "imported-idle" }, settings: DEFAULT_SETTINGS,
  notes: "restored notes", stats: { chunks: [], tasksDone: [{ taskId: "restored-task", at: Date.now() }] },
  tasks: [{ id: "restored-task", title: "Restored task", done: false, createdAt: Date.now() }], focusPick: "restored-task",
} }));
const metadata = async () => ["sync-meta", {}] as [string, unknown];

it("keeps the locked timer and imports other data through pagehide banking and flushing", async () => {
  startTicker();
  const original = timer.get(); vi.advanceTimersByTime(2000);
  expect(await restoreBackup(backup(), metadata)).toBe(true);
  expect(timer.get()).toMatchObject({ segId: original.segId, startedAt: original.startedAt, frozenTotal: original.frozenTotal, hardLocked: true });
  expect((await dbGet<{ segId: string }>("timer"))?.segId).toBe(original.segId);
  expect(notes.get()).toBe("restored notes");
  // The actual ticker pagehide listener credits the preserved block against restored stats.
  pagehide.forEach(fn => fn()); await flushReadyStores();
  expect(await dbGet("notes")).toBe("restored notes");
  expect(stats.get().tasksDone).toEqual([{ taskId: "restored-task", at: Date.now() }]);
  expect(stats.get().chunks).toEqual([expect.objectContaining({ segId: original.segId, ms: 2000 })]);
  expect(await dbGet("stats")).toEqual(stats.get());
  expect(await dbGet("timer")).toEqual(timer.get());
  expect(timer.get()).toMatchObject({ segId: original.segId, startedAt: original.startedAt, hardLocked: true, creditedUpTo: 2000 });
});
it("imports the timer when unlocked", async () => {
  timer.set({ ...INITIAL_TIMER });
  expect(await restoreBackup(backup(), metadata)).toBe(false);
  expect(timer.get().segId).toBe("imported-idle");
  await flushReadyStores(); expect((await dbGet<{ segId: string }>("timer"))?.segId).toBe("imported-idle");
});
it("rechecks the lock after asynchronous preparation", async () => {
  timer.set({ ...INITIAL_TIMER });
  const parsed = backup();
  expect(await restoreBackup(parsed, async () => { timerActions.start(); return metadata(); })).toBe(true);
  expect(timer.get().segId).not.toBe("imported-idle"); expect(timer.get().startedAt).not.toBeNull();
});
it("rolls live stores back if the atomic restore write fails", async () => {
  await flushReadyStores();
  const write = vi.spyOn(db, "dbSetMany").mockRejectedValueOnce(new Error("Storage is full"));
  await expect(restoreStoreEntries([["notes", "failed restore"]])).rejects.toThrow("Storage is full");
  expect(notes.get()).toBe("old notes");
  write.mockRestore(); await flushReadyStores();
  expect(await dbGet("notes")).toBe("old notes");
});

it("never exports a locked timer, and includes unlocked timers only in focus data", async () => {
  expect(parseBackup(await createBackup()).data).not.toHaveProperty("timer");
  timer.set({ ...INITIAL_TIMER });
  expect(parseBackup(await createBackup()).data).toHaveProperty("timer");
  expect(parseBackup(await createBackup({ sections: ["settings"] })).data).not.toHaveProperty("timer");
});


it.each(["pomodoro", "countdown", "stopwatch"] as const)("Focus import preserves a running %s block and all its credit", async mode => {
  timer.set({ ...INITIAL_TIMER, segId: "ordinary-block" });
  settings.set({ ...DEFAULT_SETTINGS, timer: { ...DEFAULT_SETTINGS.timer, mode, hardMode: false, notify: false, speak: false } });
  timerActions.start();
  vi.advanceTimersByTime(2000);
  timerActions.pause(); timerActions.start(); // Already banked credit must survive replacing history too.
  const original = timer.get();
  await flushReadyStores();
  vi.advanceTimersByTime(3000);
  const parsed = backup(); parsed.version = 2; parsed.sections = ["settings", "focus"];
  expect(await restoreBackup(parsed, metadata, ["focus"])).toBe(true);
  expect(timer.get()).toMatchObject({ segId: original.segId, startedAt: original.startedAt, frozenTotal: original.frozenTotal });
  timerActions.pause(); await flushReadyStores();
  expect(stats.get().chunks.filter(c => c.segId === original.segId).reduce((sum, c) => sum + c.ms, 0)).toBe(5000);
  expect(await dbGet("timer")).toEqual(timer.get());
  expect(await dbGet("stats")).toEqual(stats.get());
});

it("rechecks a normal timer started during asynchronous import preparation", async () => {
  timer.set({ ...INITIAL_TIMER });
  settings.set({ ...DEFAULT_SETTINGS, timer: { ...DEFAULT_SETTINGS.timer, hardMode: false } });
  expect(await restoreBackup(backup(), async () => { timerActions.start(); return metadata(); }, ["focus"])).toBe(true);
  expect(timer.get().startedAt).not.toBeNull();
  expect(timer.get().segId).not.toBe("imported-idle");
});


it.each([0, 2000])("preserves a paused ordinary block after %s ms", async elapsed => {
  timer.set({ ...INITIAL_TIMER });
  settings.set({ ...DEFAULT_SETTINGS, timer: { ...DEFAULT_SETTINGS.timer, hardMode: false } });
  timerActions.start(); vi.advanceTimersByTime(elapsed); timerActions.pause();
  const original = timer.get();
  expect(await restoreBackup(backup(), metadata, ["focus"])).toBe(true);
  expect(timer.get()).toMatchObject({ segId: original.segId, startedAt: null, elapsedBefore: elapsed, frozen: true });
});
