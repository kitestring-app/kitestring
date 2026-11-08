import { expect, it } from "vitest";
import { DEFAULT_IDLE_NUDGE, DEFAULT_NUDGE_MESSAGE, isIdleNudge, nudgeDue, nudgeText, sanitizeIdleNudge, windowStart, type IdleNudge } from "./idleNudge";

const MIN = 60_000;
// 2026-11-09 is a Monday. Local time, like the user's clock.
const at = (day: number, hh: number, mm = 0) => new Date(2026, 10, 9 + day, hh, mm).getTime();
const on = (patch: Partial<IdleNudge> = {}): IdleNudge => ({ ...DEFAULT_IDLE_NUDGE, enabled: true, ...patch });

it("is off by default and sanitizes bad stored values", () => {
  expect(DEFAULT_IDLE_NUDGE.enabled).toBe(false);
  expect(sanitizeIdleNudge(null)).toEqual(DEFAULT_IDLE_NUDGE);
  expect(sanitizeIdleNudge({ enabled: "yes", every: 9999, from: "25:00", to: "7:00", days: [true], message: "a\nb" + "x".repeat(200) }))
    .toEqual({ ...DEFAULT_IDLE_NUDGE, every: 240, message: ("a b" + "x".repeat(200)).slice(0, 120) });
  expect(sanitizeIdleNudge({ every: 1 }).every).toBe(5);
  expect(sanitizeIdleNudge({ every: Number.NaN }).every).toBe(30);
});

it("backup check accepts only in-range values", () => {
  expect(isIdleNudge(on())).toBe(true);
  expect(isIdleNudge({ ...on(), every: 1 })).toBe(false);
  expect(isIdleNudge({ ...on(), days: [true] })).toBe(false);
  expect(isIdleNudge([])).toBe(false);
});

it("uses the custom message, or a calm default", () => {
  expect(nudgeText({ message: "  " })).toBe(DEFAULT_NUDGE_MESSAGE);
  expect(nudgeText({ message: "Write the intro" })).toBe("Write the intro");
});

it("respects the active window and weekdays", () => {
  const cfg = on(); // 09:00-18:00, Mon-Fri
  expect(windowStart(cfg, new Date(at(0, 8, 59)))).toBeNull();
  expect(windowStart(cfg, new Date(at(0, 9)))).toBe(at(0, 9));
  expect(windowStart(cfg, new Date(at(0, 17, 59)))).toBe(at(0, 9));
  expect(windowStart(cfg, new Date(at(0, 18)))).toBeNull();
  expect(windowStart(cfg, new Date(at(5, 12)))).toBeNull(); // Saturday
  expect(windowStart(cfg, new Date(at(6, 12)))).toBeNull(); // Sunday
});

it("an overnight window belongs to the day it opened", () => {
  const cfg = on({ from: "22:00", to: "02:00", days: [false, false, false, false, false, true, false] }); // Friday night only
  expect(windowStart(cfg, new Date(at(4, 23)))).toBe(at(4, 22)); // Friday 23:00
  expect(windowStart(cfg, new Date(at(5, 1)))).toBe(at(4, 22)); // Saturday 01:00 still Friday's window
  expect(windowStart(cfg, new Date(at(5, 23)))).toBeNull(); // Saturday night is off
  expect(windowStart(cfg, new Date(at(5, 3)))).toBeNull();
});

it("equal start and end times mean all day on the picked days", () => {
  const cfg = on({ from: "00:00", to: "00:00" });
  expect(windowStart(cfg, new Date(at(0, 3)))).toBe(at(0, 0));
  expect(windowStart(cfg, new Date(at(5, 3)))).toBeNull();
});

it("reminds one interval after the latest of idle, last reminder and window opening", () => {
  const cfg = on({ every: 30 });
  const base = { busy: false, lastNudgeAt: null };
  // Idle since last night: first reminder 30 minutes after 09:00, not at 09:00.
  expect(nudgeDue(cfg, { ...base, idleSince: at(-1, 20), now: at(0, 9, 29) })).toBe(false);
  expect(nudgeDue(cfg, { ...base, idleSince: at(-1, 20), now: at(0, 9, 30) })).toBe(true);
  // Timer stopped at 11:00.
  expect(nudgeDue(cfg, { ...base, idleSince: at(0, 11), now: at(0, 11) + 29 * MIN })).toBe(false);
  expect(nudgeDue(cfg, { ...base, idleSince: at(0, 11), now: at(0, 11) + 30 * MIN })).toBe(true);
  // Then every 30 minutes after the last reminder.
  expect(nudgeDue(cfg, { ...base, idleSince: at(0, 11), lastNudgeAt: at(0, 11, 30), now: at(0, 11, 59) })).toBe(false);
  expect(nudgeDue(cfg, { ...base, idleSince: at(0, 11), lastNudgeAt: at(0, 11, 30), now: at(0, 12) })).toBe(true);
});

it("never reminds when off, during a block or outside the window", () => {
  const input = { idleSince: at(0, 9), lastNudgeAt: null, now: at(0, 12) };
  expect(nudgeDue(on(), { ...input, busy: false })).toBe(true);
  expect(nudgeDue(on(), { ...input, busy: true })).toBe(false);
  expect(nudgeDue({ ...on(), enabled: false }, { ...input, busy: false })).toBe(false);
  expect(nudgeDue(on({ days: [false, false, false, false, false, false, false] }), { ...input, busy: false })).toBe(false);
  expect(nudgeDue(on(), { ...input, busy: false, now: at(0, 19) })).toBe(false);
});
