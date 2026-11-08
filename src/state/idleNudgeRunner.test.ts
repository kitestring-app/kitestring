import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.hoisted(() => { vi.stubGlobal("navigator", {}); vi.stubGlobal("BroadcastChannel", undefined); });
vi.mock("../audio/core", () => ({ cancelAllChimes: vi.fn(), playTimerTick: vi.fn(), cancelChime: vi.fn(), cancelEnd: vi.fn(), releaseChime: vi.fn(), scheduleChime: vi.fn(), scheduleEnd: vi.fn(), previewChime: vi.fn() }));
import { calmFoundationReady, DEFAULT_SETTINGS, settings } from "./settings";
import { INITIAL_TIMER } from "./timerEngine";
import { timer } from "./timer";
import { DEFAULT_IDLE_NUDGE, idleNudge, idleNudgeUpdate } from "./idleNudge";
import { deliverNudge, startIdleNudge } from "./idleNudgeRunner";

const MIN = 60_000;
const MONDAY_10 = new Date(2026, 10, 9, 10, 0).getTime();
let runner: ReturnType<typeof startIdleNudge> | undefined;
beforeEach(async () => {
  await calmFoundationReady; await timer.ready; await idleNudge.ready;
  settings.set(DEFAULT_SETTINGS);
  timer.set({ ...INITIAL_TIMER, segId: "idle-test" });
  idleNudge.set(DEFAULT_IDLE_NUDGE);
  vi.useFakeTimers(); vi.setSystemTime(MONDAY_10);
});
afterEach(() => { runner?.stop(); runner = undefined; vi.useRealTimers(); vi.unstubAllGlobals(); });

it("stays silent until switched on, then reminds once per interval", () => {
  const deliver = vi.fn(async () => true);
  runner = startIdleNudge({ deliver });
  vi.advanceTimersByTime(60 * MIN);
  expect(deliver).not.toHaveBeenCalled();
  idleNudgeUpdate({ enabled: true, every: 15, message: "Open the draft" });
  vi.advanceTimersByTime(14 * MIN);
  expect(deliver).not.toHaveBeenCalled(); // switching on starts a fresh interval
  vi.advanceTimersByTime(MIN);
  expect(deliver).toHaveBeenCalledExactlyOnceWith("Open the draft");
  vi.advanceTimersByTime(15 * MIN);
  expect(deliver).toHaveBeenCalledTimes(2);
});

it("never reminds during a block and restarts the interval when the block stops", () => {
  idleNudge.set({ ...DEFAULT_IDLE_NUDGE, enabled: true, every: 10 });
  const deliver = vi.fn(async () => true);
  runner = startIdleNudge({ deliver });
  timer.set({ ...timer.get(), startedAt: Date.now() });
  vi.advanceTimersByTime(40 * MIN);
  expect(deliver).not.toHaveBeenCalled();
  timer.set({ ...timer.get(), startedAt: null, elapsedBefore: 40 * MIN });
  vi.advanceTimersByTime(9 * MIN);
  expect(deliver).not.toHaveBeenCalled();
  vi.advanceTimersByTime(MIN);
  expect(deliver).toHaveBeenCalledOnce();
});

it("waits for the active window", () => {
  vi.setSystemTime(new Date(2026, 10, 9, 7, 0).getTime());
  idleNudge.set({ ...DEFAULT_IDLE_NUDGE, enabled: true, every: 30 });
  const deliver = vi.fn(async () => true);
  runner = startIdleNudge({ deliver });
  vi.advanceTimersByTime(2 * 60 * MIN + 29 * MIN); // 09:29
  expect(deliver).not.toHaveBeenCalled();
  vi.advanceTimersByTime(MIN);
  expect(deliver).toHaveBeenCalledOnce();
});

it("delivers through the Mac bridge when present", async () => {
  const nudge = vi.fn(async () => true);
  vi.stubGlobal("window", { desktop: { nudge } });
  expect(await deliverNudge("Start")).toBe(true);
  expect(nudge).toHaveBeenCalledWith("Start");
});

it("on the web, shows a silent notification only when already allowed", async () => {
  const made: { title: string; options: NotificationOptions }[] = [];
  class FakeNotification { static permission: NotificationPermission = "default"; onclick: (() => void) | null = null; constructor(title: string, options: NotificationOptions) { made.push({ title, options }); } close() {} }
  vi.stubGlobal("window", { Notification: FakeNotification, focus: vi.fn() });
  vi.stubGlobal("Notification", FakeNotification);
  expect(await deliverNudge("Start")).toBe(false);
  FakeNotification.permission = "granted";
  expect(await deliverNudge("Start")).toBe(true);
  expect(made).toEqual([{ title: "Kitestring", options: { body: "Start", tag: "kitestring-idle-nudge", silent: true } }]);
});
