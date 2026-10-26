import { describe, expect, it, vi } from "vitest";
import { createTransitionStore, type TransitionNotice } from "./TransitionStore";

describe("transition reminders", () => {
  const notice: TransitionNotice = { segId: "one", ended: "focus", at: 100, nextSegId: "two", breakSegment: "short", breakRound: 0, snoozes: 0 };
  it("shows each segment once, including after it was answered", () => {
    const store = createTransitionStore();
    const changed = vi.fn();
    store.subscribe(changed);
    expect(store.show(notice)).toBe(true);
    expect(store.show({ ...notice, at: 200 })).toBe(false);
    expect(store.get()).toEqual(notice);
    expect(changed).toHaveBeenCalledTimes(1);
    store.dismiss();
    expect(store.get()).toBeNull();
    expect(store.show(notice)).toBe(false);
    expect(store.get()).toBeNull();
    expect(store.show({ ...notice, segId: "two" })).toBe(true);
  });
  it("keeps separate tabs' stores independent and allows unsubscribe", () => {
    const a = createTransitionStore(), b = createTransitionStore();
    const changed = vi.fn();
    const off = a.subscribe(changed);
    off();
    a.show(notice);
    expect(b.get()).toBeNull();
    expect(changed).not.toHaveBeenCalled();
  });
});
