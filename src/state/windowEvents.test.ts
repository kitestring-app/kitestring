import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { IDBFactory } from "fake-indexeddb";

vi.mock("../audio/core", () => ({ cancelAllChimes: vi.fn(), playTimerTick: vi.fn(), cancelChime: vi.fn(), cancelEnd: vi.fn(), releaseChime: vi.fn(), scheduleChime: vi.fn(), scheduleEnd: vi.fn() }));
vi.mock("../audio/companion", () => ({ armCompanionWithSpeech: vi.fn().mockResolvedValue(false), companionAvailable: vi.fn().mockResolvedValue(false), companionKnownUp: vi.fn(() => false), disarmCompanion: vi.fn() }));

const windowEvent = vi.fn();
beforeEach(() => {
  vi.resetModules(); windowEvent.mockReset();
  vi.stubGlobal("indexedDB", new IDBFactory()); vi.stubGlobal("BroadcastChannel", undefined);
  vi.stubGlobal("navigator", {});
  vi.stubGlobal("window", { desktop: { windowEvent }, addEventListener: vi.fn() });
  vi.stubGlobal("document", { addEventListener: vi.fn() });
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

async function load(onStart: "nothing" | "minimise" | "floating", onEnd: "nothing" | "restore" | "full") {
  const t = await import("./timer"), s = await import("./settings"), p = await import("../lib/store");
  await s.calmFoundationReady; await p.flushReadyStores();
  s.settingsUpdate("timer", { mode: "pomodoro", hardMode: false, takeover: false, autoRun: "off", bringToFront: false, notify: false, speak: false, focusDoneSound: "none", breakOverSound: "none" });
  s.windowEvents.set({ onStart, onEnd });
  return t;
}

it("is off by default and drops unknown stored values", async () => {
  const s = await import("./settings");
  expect(s.DEFAULT_WINDOW_EVENTS).toEqual({ onStart: "nothing", onEnd: "nothing" });
  expect(s.sanitizeWindowEvents({ onStart: "close", onEnd: 3 })).toEqual({ onStart: "nothing", onEnd: "nothing" });
  expect(s.sanitizeWindowEvents({ onStart: "floating", onEnd: "full" })).toEqual({ onStart: "floating", onEnd: "full" });
  const t = await load("nothing", "nothing");
  vi.useFakeTimers();
  t.timerActions.start();
  vi.setSystemTime(Date.now() + t.totalMs()!);
  t.timerActions.complete(t.timer.get().segId);
  expect(windowEvent).not.toHaveBeenCalled();
});

it.each(["minimise", "floating"] as const)("starting or resuming focus sends %s", async onStart => {
  const t = await load(onStart, "nothing");
  t.timerActions.start();
  expect(windowEvent.mock.calls).toEqual([[onStart]]);
  t.timerActions.pause(); t.timerActions.start();
  expect(windowEvent.mock.calls).toEqual([[onStart], [onStart]]);
});

it("starting a break does not move the window", async () => {
  const t = await load("minimise", "nothing");
  t.timerActions.goTo("short");
  t.timerActions.start();
  expect(windowEvent).not.toHaveBeenCalled();
});

it.each(["restore", "full"] as const)("the end of a focus block sends %s, and the end of a break does not", async onEnd => {
  const t = await load("nothing", onEnd);
  vi.useFakeTimers();
  t.timerActions.start();
  vi.setSystemTime(Date.now() + t.totalMs()!);
  t.timerActions.complete(t.timer.get().segId);
  expect(windowEvent.mock.calls).toEqual([[onEnd]]);
  expect(t.timer.get().segment).toBe("short");
  t.timerActions.start();
  vi.setSystemTime(Date.now() + t.totalMs()!);
  t.timerActions.complete(t.timer.get().segId);
  expect(windowEvent.mock.calls).toEqual([[onEnd]]);
});

it("a missed ending after sleep does not move the window", async () => {
  const t = await load("nothing", "restore");
  vi.useFakeTimers();
  t.timerActions.start();
  vi.setSystemTime(Date.now() + t.totalMs()! + 60_000);
  t.timerActions.complete(t.timer.get().segId, true);
  expect(windowEvent).not.toHaveBeenCalled();
});

it("the web app has no window bridge and starts normally", async () => {
  vi.stubGlobal("window", { addEventListener: vi.fn() });
  const t = await load("minimise", "full");
  t.timerActions.start();
  expect(t.timer.get().startedAt).not.toBeNull();
});
