import { afterEach, describe, expect, it, vi } from "vitest";
import { endWarningAt, endWarningLine } from "./endWarning";
import { INITIAL_TIMER, type TimerState } from "./timerEngine";

const running = (patch: Partial<TimerState> = {}): TimerState => ({ ...INITIAL_TIMER, segId: "a", segment: "focus", startedAt: 1_000_000, elapsedBefore: 0, ...patch });
const MIN = 60_000;

describe("endWarningAt", () => {
  it("lands N minutes before the end of a running focus block", () => {
    expect(endWarningAt(running(), 25 * MIN, { warnBefore: 2 })).toBe(1_000_000 + 23 * MIN);
  });
  it("accounts for time banked before a pause", () => {
    expect(endWarningAt(running({ elapsedBefore: 10 * MIN }), 25 * MIN, { warnBefore: 5 })).toBe(1_000_000 + 10 * MIN);
  });
  it("is off at 0, for breaks, paused blocks, stopwatch and a ringing boundary", () => {
    expect(endWarningAt(running(), 25 * MIN, { warnBefore: 0 })).toBeNull();
    expect(endWarningAt(running({ segment: "short" }), 25 * MIN, { warnBefore: 2 })).toBeNull();
    expect(endWarningAt(running({ startedAt: null }), 25 * MIN, { warnBefore: 2 })).toBeNull();
    expect(endWarningAt(running(), null, { warnBefore: 2 })).toBeNull();
    expect(endWarningAt(running({ boundary: { id: "x", ended: "focus", at: 0, missed: false } as unknown as TimerState["boundary"] }), 25 * MIN, { warnBefore: 2 })).toBeNull();
  });
  it("skips blocks of twice the lead or less", () => {
    expect(endWarningAt(running(), 4 * MIN, { warnBefore: 2 })).toBeNull();
    expect(endWarningAt(running(), 4 * MIN + 1, { warnBefore: 2 })).not.toBeNull();
  });
});

describe("endWarningLine", () => {
  it("says the minutes, or only that focus is nearly done under Hidden time", () => {
    expect(endWarningLine(1, "remaining")).toBe("One minute left.");
    expect(endWarningLine(2, "elapsed")).toBe("Two minutes left.");
    expect(endWarningLine(5, "hidden")).toBe("Focus is nearly done.");
  });
});

describe("settings", () => {
  afterEach(() => { vi.resetModules(); });
  it("Calm turns the heads-up off and Strong (the default) turns it on", async () => {
    const s = await import("./settings");
    expect(s.CALM_PATCH.warnBefore).toBe(0);
    expect(s.STRONG_PATCH.warnBefore).toBe(2);
  });
  it("upgrades setups saved before the option: Strong gets it, Calm and custom setups stay quiet", async () => {
    const s = await import("./settings");
    const { warnBefore: _, ...legacyStrong } = s.DEFAULT_SETTINGS.timer;
    expect(s.sanitizeSettings({ timer: legacyStrong }).timer.warnBefore).toBe(2);
    expect(s.sanitizeSettings({ timer: { ...legacyStrong, ...s.CALM_PATCH, warnBefore: undefined } }).timer.warnBefore).toBe(0);
    expect(s.sanitizeSettings({ timer: { ...legacyStrong, ticking: "focus" } }).timer.warnBefore).toBe(0);
  });
  it("keeps an explicit choice and rejects values outside the list", async () => {
    const s = await import("./settings");
    expect(s.sanitizeSettings({ timer: { ...s.DEFAULT_SETTINGS.timer, ...s.CALM_PATCH, warnBefore: 5 } }).timer.warnBefore).toBe(5);
    expect(s.sanitizeSettings({ timer: { ...s.DEFAULT_SETTINGS.timer, warnBefore: 4 } }).timer.warnBefore).toBe(0);
    expect(s.sanitizeSettings({ timer: { ...s.DEFAULT_SETTINGS.timer, warnBefore: "2" } }).timer.warnBefore).toBe(0);
  });
});
