import { afterEach, describe, expect, it, vi } from "vitest";

const locks = vi.hoisted(() => {
  const locks = { request: vi.fn(() => new Promise<void>(() => {})) };
  vi.stubGlobal("navigator", { locks });
  vi.stubGlobal("window", { addEventListener: vi.fn() }); vi.stubGlobal("document", { addEventListener: vi.fn() });
  return locks;
});
vi.mock("../audio/core", () => ({ cancelAllChimes: vi.fn(), playTimerTick: vi.fn(), previewChime: vi.fn(), cancelChime: vi.fn(), cancelEnd: vi.fn(), releaseChime: vi.fn(), scheduleChime: vi.fn(), scheduleEnd: vi.fn() }));
vi.mock("../audio/companion", () => ({ armCompanionWithSpeech: vi.fn().mockResolvedValue(false), cancelCompanionSpeech: vi.fn(), companionAvailable: vi.fn().mockResolvedValue(false), companionKnownUp: vi.fn(() => false), disarmCompanion: vi.fn() }));
vi.mock("./stats", () => ({ logChunk: vi.fn() }));

import { armCompanionWithSpeech } from "../audio/companion";
import { settings, DEFAULT_SETTINGS } from "./settings";
import { INITIAL_TIMER } from "./timerEngine";
import { acquireTimerOwnership, timer, timerHydrationReady, startTicker, timerActions } from "./timer";
import { tasks } from "./tasks";
import { transitionStore } from "../ui/timer/TransitionStore";

afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("transition leadership", () => {
  it("lets only the elected tab complete and show the reminder", async () => {
    await Promise.all([timer.ready, settings.ready, tasks.ready, timerHydrationReady]);
    vi.useFakeTimers();
    vi.setSystemTime(100_000);
    vi.stubGlobal("window", { addEventListener: vi.fn() });
    vi.stubGlobal("document", { addEventListener: vi.fn() });
    settings.set({ ...DEFAULT_SETTINGS, timer: { ...DEFAULT_SETTINGS.timer, notify: false } });
    const store = await import("../lib/store"), db = await import("../lib/db");
    await db.dbSet("timer", { ...INITIAL_TIMER, segId: "leader-test", startedAt: Date.now(), frozen: true, frozenTotal: 60_000 });
    await store.refreshClockStores();
    startTicker();
    vi.advanceTimersByTime(60_000);
    timerActions.complete("leader-test");
    expect(transitionStore.get()).toBeNull();
    expect(timer.get().segId).toBe("leader-test");
    expect(armCompanionWithSpeech).not.toHaveBeenCalled();
    expect(locks.request).toHaveBeenCalledOnce();
    await acquireTimerOwnership();
    expect(armCompanionWithSpeech).not.toHaveBeenCalled();
    expect(transitionStore.get()).toBeNull();
    expect(timer.get()).toMatchObject({ startedAt: null, boundary: { id: "leader-test", missed: true } });
    const nextId = timer.get().segId;
    timerActions.complete("leader-test");
    expect(timer.get().segId).toBe(nextId);
  });
});
