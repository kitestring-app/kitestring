import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.hoisted(() => { vi.stubGlobal("navigator", {}); });
vi.mock("../audio/core", () => ({ cancelChime: vi.fn(), cancelEnd: vi.fn(), releaseChime: vi.fn(), scheduleChime: vi.fn(), scheduleEnd: vi.fn() }));
vi.mock("../audio/companion", () => ({ armCompanionWithSpeech: vi.fn().mockResolvedValue(false), cancelCompanionSpeech: vi.fn(), companionAvailable: vi.fn().mockResolvedValue(false), companionKnownUp: vi.fn(() => false), disarmCompanion: vi.fn() }));
import { dismissInterruption, getInterruptions, interruptionPrompt, keepInterruption, parked, requestInterruption, saveInterruption, finishThought } from "./parked";
import { notes, setInterruptionPrompt } from "./notes";
import { EMPTY_NOTES } from "./notesModel";
import { timer, timerActions } from "./timer";
import { INITIAL_TIMER } from "./timerEngine";
import { settings, DEFAULT_SETTINGS } from "./settings";
import { tasks, focusPick } from "./tasks";
import { isParkedItem } from "../lib/parked";
import { BACKUP_FORMAT, parseBackup } from "../lib/backup";
import { applySyncedValue, flushAll } from "../lib/store";
import { dbGet } from "../lib/db";
const at = new Date(2026, 9, 24, 12).getTime();
beforeEach(async () => {
  await Promise.all([notes.ready, parked.ready, timer.ready, settings.ready, tasks.ready, focusPick.ready]);
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] }); vi.setSystemTime(at);
  vi.stubGlobal("window", {});
  notes.set(EMPTY_NOTES); parked.set([]); tasks.set([]); focusPick.set(null);
  settings.set({ ...DEFAULT_SETTINGS, timer: { ...DEFAULT_SETTINGS.timer, notify: false } });
  timer.set({ ...INITIAL_TIMER, segId: "paused-session" });
  dismissInterruption();
});
afterEach(() => { dismissInterruption(); vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); });
describe("focus interruptions", () => {
  it("prompts only on an actual running focus pause and preserves pause accounting", async () => {
    timerActions.pause(); await Promise.resolve(); expect(interruptionPrompt.get()).toBeNull();
    tasks.set([{ id: "task", title: "Write", done: false, createdAt: at }]);
    timerActions.start(); vi.advanceTimersByTime(2000); timerActions.pause(); await Promise.resolve();
    expect(timer.get()).toMatchObject({ startedAt: null, elapsedBefore: 2000, creditedUpTo: 2000 });
    expect(interruptionPrompt.get()).toMatchObject({ segId: "paused-session", taskId: "task", at: at + 2000 });
    const prompt = interruptionPrompt.get();
    timerActions.pause(); await Promise.resolve(); expect(interruptionPrompt.get()).toBe(prompt);
    dismissInterruption(); timerActions.goTo("short"); timerActions.start(); timerActions.pause(); await Promise.resolve();
    expect(interruptionPrompt.get()).toBeNull();
    setInterruptionPrompt(false); timerActions.goTo("focus"); timerActions.start(); timerActions.pause(); await Promise.resolve();
    expect(interruptionPrompt.get()).toBeNull();
  });
  it("dismisses after eight seconds, Keep stops expiry, and disabling closes a prompt", async () => {
    await requestInterruption({ segId: "s", at });
    vi.advanceTimersByTime(7999); expect(interruptionPrompt.get()).not.toBeNull();
    vi.advanceTimersByTime(1); expect(interruptionPrompt.get()).toBeNull(); expect(parked.get()).toHaveLength(0);
    await requestInterruption({ segId: "s", at }); const id = interruptionPrompt.get()!.id;
    keepInterruption(id); vi.advanceTimersByTime(20_000); expect(interruptionPrompt.get()?.expiresAt).toBeNull();
    setInterruptionPrompt(false); expect(interruptionPrompt.get()).toBeNull();
    expect(saveInterruption(id, "Phone", "late")).toBeUndefined();
  });
  it("stores the original pause context, limits the optional note, and saves once", async () => {
    await requestInterruption({ segId: "s", taskId: "t", at }); const id = interruptionPrompt.get()!.id;
    expect(saveInterruption(id, "Phone", "x".repeat(501))).toBeUndefined();
    expect(saveInterruption(id, "invalid" as "Phone", "")).toBeUndefined();
    vi.advanceTimersByTime(1000);
    const saved = saveInterruption(id, "Person", "  question\u0000  ");
    expect(parked.get()).toEqual([expect.objectContaining({ id: saved, kind: "interruption", tag: "Person", text: "question", segId: "s", taskId: "t", at, segment: "focus", status: "open" })]);
    expect(saveInterruption(id, "Person", "again")).toBeUndefined();
    await flushAll(); expect(await dbGet("parked")).toEqual(parked.get());
    await requestInterruption({ segId: "s", at }); saveInterruption(interruptionPrompt.get()!.id, "Meeting", "");
    expect(parked.get()[1].text).toBe("Meeting");
  });
  it("counts done entries in an exclusive date range and preserves them through backup and sync", async () => {
    await requestInterruption({ segId: "s", at }); saveInterruption(interruptionPrompt.get()!.id, "Phone", "");
    finishThought(parked.get()[0].id);
    const all = parked.get();
    expect(getInterruptions({ start: at, end: at + 1 })).toEqual(all);
    expect(getInterruptions({ from: at, to: at + 1 })).toEqual(all);
    expect(getInterruptions()).toEqual(all);
    expect(getInterruptions({ start: at - 1, end: at })).toEqual([]);
    const result = parseBackup(JSON.stringify({ format: BACKUP_FORMAT, version: 1, data: { parked: all } }));
    await applySyncedValue("parked", result.data.parked); expect(parked.get()).toEqual(all);
    for (const patch of [{ tag: "bad" }, { segId: undefined }, { segment: "short" }, { kind: "bad" }]) {
      const invalid = { ...all[0], ...patch };
      expect(isParkedItem(invalid)).toBe(false);
      expect(() => parseBackup(JSON.stringify({ format: BACKUP_FORMAT, version: 1, data: { parked: [invalid] } }))).toThrow(/parked/);
    }
    await applySyncedValue("parked", [{ ...all[0], kind: "unknown" }]); expect(parked.get()).toEqual([]);
  });
});
