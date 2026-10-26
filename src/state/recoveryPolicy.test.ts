import { describe, expect, it } from "vitest";
import { clockDiscontinuous, continueDuration, EMPTY_ACTIVITY, evaluateGap, GAP_MS, selectRecovery } from "./recoveryPolicy";

describe("C3 device gap policy", () => {
  const last = Date.UTC(2026, 9, 1, 12);
  const state = { ...EMPTY_ACTIVITY, lastPurposefulAt: last };
  it("uses strictly more than 24 elapsed hours, regardless of calendar or time zone", () => {
    expect(evaluateGap(state, last + GAP_MS).pendingGap).toBeNull();
    expect(evaluateGap(state, last + GAP_MS + 1).pendingGap).toBe(`gap:${last}`);
    for (const zone of ["Pacific/Honolulu", "Asia/Kolkata", "Pacific/Kiritimati", "America/New_York"]) {
      const previous = process.env.TZ; process.env.TZ = zone;
      try { expect(evaluateGap(state, last + GAP_MS + 1).pendingGap).toBe(`gap:${last}`); }
      finally { if (previous === undefined) delete process.env.TZ; else process.env.TZ = previous; }
    }
  });
  it("works during a multi-day process and acknowledges once per gap", () => {
    const eligible = evaluateGap(state, last + 30 * GAP_MS);
    const ack = { ...eligible, pendingGap: null, acknowledgedGap: eligible.pendingGap };
    expect(evaluateGap(ack, last + 31 * GAP_MS).pendingGap).toBeNull();
    expect(evaluateGap({ ...ack, lastPurposefulAt: last + 31 * GAP_MS }, last + 33 * GAP_MS).pendingGap).toBe(`gap:${last + 31 * GAP_MS}`);
  });
  it("suppresses negative, future, backwards and unexplained forward clock changes", () => {
    for (const now of [-1, NaN, last - 1]) expect(evaluateGap(state, now).uncertain).toBe(true);
    const before = { wall: last, mono: 100 };
    expect(clockDiscontinuous(before, { wall: last - 1, mono: 101 })).toBe(true);
    expect(clockDiscontinuous(before, { wall: last + 2 * GAP_MS, mono: 200 })).toBe(true);
    expect(evaluateGap(state, last + 2 * GAP_MS, true).pendingGap).toBeNull();
    expect(evaluateGap({ ...state, uncertain: true }, last + 3 * GAP_MS).pendingGap).toBeNull();
  });
  it("accepts sleep/wake when monotonic time advances or native wake explains a stopped clock", () => {
    const before = { wall: last, mono: 100 };
    const after = { wall: last + 3 * GAP_MS, mono: 100 + 3 * GAP_MS };
    expect(clockDiscontinuous(before, after)).toBe(false);
    expect(clockDiscontinuous(before, { ...after, mono: 101 }, true)).toBe(false);
    expect(clockDiscontinuous(before, { wall: last - 1, mono: 101 }, true)).toBe(true);
    expect(evaluateGap(state, after.wall).pendingGap).toBeTruthy();
  });
});
describe("C4 selector exhaustive truth table", () => {
  for (let bits = 0; bits < 32; bits++) it(`chooses at most one offer for ${bits.toString(2).padStart(5, "0")}`, () => {
    const [boundary, reentry, gap, review, runningFocus] = [1, 2, 4, 8, 16].map(mask => !!(bits & mask));
    expect(selectRecovery({ boundary, reentry, gap, review, runningFocus })).toBe(
      boundary ? "missed-end" : reentry ? "re-entry" : runningFocus ? null : gap ? "gap-return" : review ? "parking-review" : null);
  });
});
it("C5 Continue duration: override, ETA, mode length including stopwatch", () => {
  expect(continueDuration(300_000, 20, 52 * 60_000)).toBe(300_000);
  expect(continueDuration(undefined, 20, 52 * 60_000)).toBe(20 * 60_000);
  expect(continueDuration(undefined, null, 52 * 60_000)).toBe(52 * 60_000);
  expect(continueDuration(undefined, null, null)).toBeNull();
  for (const ms of [0, -1, NaN, Infinity]) expect(() => continueDuration(ms, null, null)).toThrow();
});
