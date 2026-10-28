import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { IDBFactory } from "fake-indexeddb";

vi.mock("../audio/core", () => ({ cancelAllChimes: vi.fn(), playTimerTick: vi.fn(), cancelChime: vi.fn(), cancelEnd: vi.fn(), releaseChime: vi.fn(), scheduleChime: vi.fn(), scheduleEnd: vi.fn() }));
vi.mock("../audio/companion", () => ({ armCompanionWithSpeech: vi.fn().mockResolvedValue(false), companionAvailable: vi.fn().mockResolvedValue(false), companionKnownUp: vi.fn(() => false), disarmCompanion: vi.fn() }));

beforeEach(() => {
  vi.resetModules();
  vi.stubGlobal("indexedDB", new IDBFactory()); vi.stubGlobal("BroadcastChannel", undefined);
  vi.stubGlobal("navigator", {});
  vi.stubGlobal("window", { desktop: { attention: vi.fn(), release: vi.fn() }, addEventListener: vi.fn() });
  vi.stubGlobal("document", { addEventListener: vi.fn() });
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

async function boundary(takeover = false, autoRun: "off" | "always" = "off") {
  const t = await import("./timer"), s = await import("./settings"), p = await import("../lib/store");
  await s.calmFoundationReady; await p.flushReadyStores();
  vi.useFakeTimers();
  s.settingsUpdate("timer", { hardMode: false, takeover, autoRun, bringToFront: true, notify: false, speak: false, focusDoneSound: "none", breakOverSound: "none" });
  t.timerActions.start();
  vi.setSystemTime(Date.now() + 25 * 60_000);
  t.timerActions.complete(t.timer.get().segId);
  return t;
}
const command = (segId: string, choice = "continue") => ({ action: "answerAttention", segId, choice }) as DesktopTimerCommand;

it.each([false, true])("Take a break starts the break with takeover=%s", async takeover => {
  const t = await boundary(takeover), segId = t.timer.get().segId;
  expect(await t.runTimerCommand(command(segId), "pointer")).toEqual({ ok: true });
  expect(t.timer.get().segment).toBe("short");
  expect(t.timer.get().startedAt).not.toBeNull();
});

it("stale banner Continue and Stop cannot touch the newer segment after Skip Break", async () => {
  const t = await boundary(), old = t.timer.get().segId;
  t.timerActions.skip(); const current = t.timer.get();
  for (const choice of ["continue", "stop", "dismiss"]) {
    expect(await t.runTimerCommand(command(old, choice), "pointer")).toMatchObject({ ok: false, reason: "stale-segment" });
    expect(t.timer.get()).toBe(current);
  }
});

it("Continue acknowledges an auto-running break without pausing it", async () => {
  const t = await boundary(true, "always"), current = t.timer.get();
  expect(await t.runTimerCommand(command(current.segId), "pointer")).toEqual({ ok: true });
  expect(t.timer.get().startedAt).toBe(current.startedAt);
  expect(t.timer.get().segment).toBe("short");
});

it("the same banner action cannot execute twice and Stop preserves Hard mode", async () => {
  const t = await boundary(), segId = t.timer.get().segId;
  expect(await t.runTimerCommand(command(segId), "pointer")).toEqual({ ok: true });
  expect(await t.runTimerCommand(command(segId), "pointer")).toMatchObject({ ok: false, reason: "stale-segment" });
  const s = await import("./settings"); s.settingsUpdate("timer", { hardMode: true });
  t.timerActions.stop(); t.timerActions.start();
  vi.setSystemTime(Date.now() + 25 * 60_000); t.timerActions.complete(t.timer.get().segId);
  t.timer.set({ ...t.timer.get(), startedAt: Date.now(), hardLocked: true });
  const current = t.timer.get();
  expect(await t.runTimerCommand(command(current.segId, "stop"), "pointer")).toMatchObject({ ok: false, reason: "hard-mode" });
  expect(t.timer.get()).toBe(current);
});

it("break-end Continue starts focus, and only pointer actions bypass the typing guard", async () => {
  const t = await boundary(), segId = t.timer.get().segId;
  expect(await t.runTimerCommand(command(segId), "accelerator")).toMatchObject({ ok: false, reason: "typing-guard" });
  await t.runTimerCommand(command(segId), "pointer");
  vi.setSystemTime(Date.now() + 5 * 60_000); t.timerActions.complete(t.timer.get().segId);
  expect(await t.runTimerCommand(command(t.timer.get().segId), "pointer")).toEqual({ ok: true });
  expect(t.timer.get().segment).toBe("focus"); expect(t.timer.get().startedAt).not.toBeNull();
});
