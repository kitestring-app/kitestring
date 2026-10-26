import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { IDBFactory } from "fake-indexeddb";

vi.mock("../audio/core", () => ({ cancelAllChimes: vi.fn(), playTimerTick: vi.fn(), cancelChime: vi.fn(), cancelEnd: vi.fn(), releaseChime: vi.fn(), scheduleChime: vi.fn(), scheduleEnd: vi.fn() }));
vi.mock("../audio/companion", () => ({ armCompanionWithSpeech: vi.fn().mockResolvedValue(false), companionAvailable: vi.fn().mockResolvedValue(false), companionKnownUp: vi.fn(() => false), disarmCompanion: vi.fn() }));

beforeEach(() => {
  vi.resetModules();
  vi.stubGlobal("indexedDB", new IDBFactory());
  vi.stubGlobal("BroadcastChannel", undefined);
  vi.stubGlobal("navigator", {});
  vi.stubGlobal("window", { desktop: {}, addEventListener: vi.fn() });
  vi.stubGlobal("document", { addEventListener: vi.fn() });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it.each(["toggle", "pause", "skip", "reset", "stop", "stopAndPause", "beginEndHold", "cancelEndHold"] as const)("swallows native %s accelerators during the typing burst", async command => {
  const t = await import("./timer"), s = await import("./settings"), p = await import("../lib/store");
  const { alertTypingGuard } = await import("../lib/alertTypingGuard");
  await s.calmFoundationReady; await p.flushReadyStores();
  s.settingsUpdate("timer", { hardMode: false });
  t.timerActions.start();
  const before = t.timer.get();
  let now = 0;
  vi.spyOn(performance, "now").mockImplementation(() => now);
  alertTypingGuard.begin();
  expect(await t.runTimerCommand(command, "accelerator")).toMatchObject({ ok: false, reason: "typing-guard" });
  expect(t.timer.get()).toBe(before);
  now = 1499;
  expect(await t.runTimerCommand(command, "accelerator")).toMatchObject({ ok: false, reason: "typing-guard" });
  now = 1600; expect(alertTypingGuard.pending()).toBe(true);
  expect(await t.runTimerCommand("stopSound", "accelerator")).toEqual({ ok: true });
  expect(t.timer.get()).toBe(before);
  expect(await t.runTimerCommand("pause", "pointer")).toEqual({ ok: true });
  expect(t.timer.get().startedAt).toBeNull();
  now = 3100;
  expect(await t.runTimerCommand("toggle", "accelerator")).toEqual({ ok: true });
  expect(t.timer.get().startedAt).not.toBeNull();
  await p.flushReadyStores();
});
