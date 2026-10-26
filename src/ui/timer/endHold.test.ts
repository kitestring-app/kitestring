import { afterEach, expect, it, vi } from "vitest";
import { createEndHold } from "./endHold";
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });
it("resets on early release and completes only after a fresh continuous 10 seconds", () => {
  vi.useFakeTimers();
  const progress = vi.fn(), complete = vi.fn();
  const hold = createEndHold(progress, complete);
  hold.start(); vi.advanceTimersByTime(9999); hold.release();
  expect(progress).toHaveBeenLastCalledWith(0); expect(complete).not.toHaveBeenCalled();
  hold.start(); vi.advanceTimersByTime(9999); expect(complete).not.toHaveBeenCalled();
  vi.advanceTimersByTime(1); expect(progress).toHaveBeenLastCalledWith(10_000); expect(complete).toHaveBeenCalledOnce();
  hold.release(); vi.advanceTimersByTime(10_000); expect(complete).toHaveBeenCalledOnce();
});
it("ignores key-repeat starts and cancellation discards progress", () => {
  vi.useFakeTimers(); const complete = vi.fn();
  const hold = createEndHold(() => {}, complete);
  hold.start(); vi.advanceTimersByTime(5000); hold.start(); vi.advanceTimersByTime(5000);
  expect(complete).toHaveBeenCalledOnce();
  hold.cancel(); hold.start(); vi.advanceTimersByTime(5000); hold.cancel(); vi.advanceTimersByTime(10_000);
  expect(complete).toHaveBeenCalledOnce();
});
it("wall-clock jumps cannot complete or prolong a hold", () => {
  vi.useFakeTimers(); const complete = vi.fn();
  const hold = createEndHold(() => {}, complete);
  hold.start(); vi.setSystemTime(Date.now() + 3600_000);
  vi.advanceTimersByTime(9900); expect(complete).not.toHaveBeenCalled();
  vi.setSystemTime(Date.now() - 7200_000); hold.release();
  vi.advanceTimersByTime(100); expect(complete).not.toHaveBeenCalled();
  hold.start(); vi.advanceTimersByTime(10_000); expect(complete).toHaveBeenCalledOnce();
});
