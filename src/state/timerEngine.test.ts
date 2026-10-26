import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "./settings";
import * as E from "./timerEngine";
import { focusScore, streak, streakMultiplier, summarize, byDay, type StatsData } from "./stats";

const T = DEFAULT_SETTINGS.timer;
const MIN = 60_000;

describe("durations", () => {
  it("pomodoro uses the configured lengths", () => {
    expect(E.durationMs(T, "focus")).toBe(25 * MIN);
    expect(E.durationMs(T, "short")).toBe(5 * MIN);
    expect(E.durationMs(T, "long")).toBe(15 * MIN);
  });
  it("52/17 ignores the configured lengths", () => {
    const t = { ...T, mode: "5217" as const };
    expect(E.durationMs(t, "focus")).toBe(52 * MIN);
    expect(E.durationMs(t, "short")).toBe(17 * MIN);
  });
  it("stopwatch focus is open-ended", () => {
    expect(E.durationMs({ ...T, mode: "stopwatch" }, "focus")).toBeNull();
  });
  it("task ETA mode follows the task estimate", () => {
    expect(E.durationMs({ ...T, taskEta: true }, "focus", 40)).toBe(40 * MIN);
    expect(E.durationMs({ ...T, taskEta: true }, "focus", null)).toBe(25 * MIN);
  });
});

describe("cycle", () => {
  it.each([1, 2, 4])("runs exactly %i focus sessions and stops after the long break", (longEvery) => {
    const t = { ...T, autoRun: "cycle" as const, longEvery };
    let s = E.start(E.INITIAL_TIMER, 0);
    const seen: E.Segment[] = [s.segment];
    let now = 0;
    for (let i = 0; i < longEvery * 2; i++) {
      now += E.durationMs(t, s.segment)!;
      s = E.advance(s, t, now, true);
      seen.push(s.segment);
      expect(s.startedAt).toBe(i === longEvery * 2 - 1 ? null : now);
    }
    expect(seen).toEqual([...Array.from({ length: longEvery }, (_, i) => ["focus", i === longEvery - 1 ? "long" : "short"]).flat(), "focus"]);
    expect(s.round).toBe(0);
    s = E.advance(E.start(s, now), t, now + E.durationMs(t, "focus")!, true);
    expect(s).toMatchObject({ segment: longEvery === 1 ? "long" : "short", startedAt: expect.any(Number), round: 1 });
  });
  it.each(["animedoro", "5217"] as const)("ends a %s cycle after its one break", (mode) => {
    const t = { ...T, mode, autoRun: "cycle" as const };
    const rest = E.advance(E.start(E.INITIAL_TIMER, 0), t, 10, true);
    expect(rest).toMatchObject({ segment: mode === "animedoro" ? "long" : "short", startedAt: 10 });
    expect(E.advance(rest, t, 20, true)).toMatchObject({ segment: "focus", startedAt: null });
  });
  it.each(["cycle", "always"] as const)("manual skip and goTo never auto-start in %s mode", (autoRun) => {
    for (const segment of ["focus", "short", "long"] as const) {
      const s = { ...E.INITIAL_TIMER, segment, startedAt: 0 };
      expect(E.advance(s, { ...T, autoRun }, 10, false).startedAt).toBeNull();
      expect(E.advance(s, { ...T, autoRun }, 10, false, "long").startedAt).toBeNull();
    }
  });
  it.each(["cycle", "always"] as const)("ignores %s auto-run for all countdown and stopwatch segments", (autoRun) => {
    for (const mode of ["countdown", "stopwatch"] as const) {
      for (const segment of ["focus", "short", "long"] as const) {
        expect(E.advance({ ...E.INITIAL_TIMER, segment }, { ...T, mode, autoRun }, 10, true).startedAt).toBeNull();
      }
    }
  });
  it("always mode continues after the long break", () => {
    expect(E.advance({ ...E.INITIAL_TIMER, segment: "long", round: 4 }, { ...T, autoRun: "always" }, 10, true))
      .toMatchObject({ segment: "focus", startedAt: 10, round: 0 });
  });
  it("manual Start resumes auto-run after a mid-cycle pause", () => {
    const t = { ...T, autoRun: "cycle" as const };
    const paused = E.pause(E.start({ ...E.INITIAL_TIMER, segment: "short", round: 1 }, 0), MIN);
    expect(paused.startedAt).toBeNull();
    const resumed = E.start(paused, 2 * MIN);
    expect(E.advance(resumed, t, 6 * MIN, true)).toMatchObject({ segment: "focus", startedAt: 6 * MIN, round: 1 });
  });
  it("pomodoro: long break after every 4th focus", () => {
    let s = E.INITIAL_TIMER;
    const seen: E.Segment[] = [];
    for (let i = 0; i < 8; i++) {
      s = E.advance(s, T, 0, true);
      seen.push(s.segment);
    }
    expect(seen).toEqual(["short", "focus", "short", "focus", "short", "focus", "long", "focus"]);
  });
  it("skipping a focus does not count toward the round", () => {
    const s = E.advance(E.INITIAL_TIMER, T, 0, false);
    expect(s.segment).toBe("short");
    expect(s.round).toBe(0);
  });
  it("animedoro: focus always goes to watch time (long)", () => {
    const s = E.advance(E.INITIAL_TIMER, { ...T, mode: "animedoro" }, 0, true);
    expect(s.segment).toBe("long");
  });
  it("countdown stops after its session even with auto-start", () => {
    const s = E.advance({ ...E.INITIAL_TIMER, startedAt: 0 }, { ...T, mode: "countdown", autoRun: "always" }, 10, true);
    expect(s.startedAt).toBeNull();
  });
  it("auto-start keeps pomodoro running into the break", () => {
    const s = E.advance({ ...E.INITIAL_TIMER, startedAt: 0 }, { ...T, autoRun: "always" }, 10, true);
    expect(s.startedAt).toBe(10);
  });
});

describe("pause, credit", () => {
  it("pause banks elapsed time and credit never double counts", () => {
    let s = E.start(E.INITIAL_TIMER, 0);
    s = E.pause(s, 5 * MIN);
    expect(E.elapsed(s, 99 * MIN)).toBe(5 * MIN);
    expect(E.pendingCredit(s, 5 * MIN, false)?.ms).toBe(5 * MIN);
    s = E.markCredited(s, 5 * MIN);
    s = E.start(s, 10 * MIN);
    expect(E.pendingCredit(s, 12 * MIN, false)?.ms).toBe(2 * MIN);
  });
  it("subsecond partial time is retained across boundaries", () => {
    const s = E.start(E.INITIAL_TIMER, 0);
    expect(E.pendingCredit(s, 500, false)?.ms).toBe(500);
  });
  it("formats", () => {
    expect(E.fmt(25 * MIN)).toBe("25:00");
    expect(E.fmt(61_001)).toBe("01:02");
    expect(E.fmt(3_700_000)).toBe("1:01:40");
  });
});

describe("stats", () => {
  const day = new Date(2026, 9, 24, 10).getTime();
  const data: StatsData = {
    chunks: [
      { id: "a", kind: "focus", segment: "focus", start: day, ms: 25 * MIN, completed: true },
      { id: "b", kind: "break", segment: "short", start: day + 26 * MIN, ms: 5 * MIN, completed: true },
      { id: "c", kind: "focus", segment: "focus", start: day + 32 * MIN, ms: 7 * MIN, completed: false },
    ],
    tasksDone: [{ at: day + 40 * MIN, taskId: "x" }],
  };
  it("summarizes a day", () => {
    const s = summarize(data, day - 1, day + 60 * MIN);
    expect(s.focusMs).toBe(32 * MIN);
    expect(s.sessions).toBe(1);
    expect(s.breakMs).toBe(5 * MIN);
    expect(s.tasks).toBe(1);
  });
  it("streak counts back from today, or yesterday if today is empty", () => {
    const d = byDay({
      chunks: [0, 1, 2].map((n) => ({ id: String(n), kind: "focus", segment: "focus", start: day - n * 86_400_000, ms: 30 * MIN, completed: true })),
      tasksDone: [],
    });
    expect(streak(d, day)).toBe(3);
    expect(streak(d, day + 86_400_000)).toBe(3);
    expect(streak(d, day + 2 * 86_400_000)).toBe(0);
  });
  it("streak multiplier steps", () => {
    expect([0, 7, 30, 90, 180].map(streakMultiplier)).toEqual([1, 1.05, 1.1, 1.15, 1.2]);
  });
  it("focus score stays within 0..100", () => {
    expect(focusScore({ qualifyingSessions: 0, focusMin: 0, tasks: 0, breakMin: 0, streakDays: 0 })).toBe(0);
    expect(focusScore({ qualifyingSessions: 20, focusMin: 600, tasks: 20, breakMin: 120, streakDays: 400 })).toBe(100);
  });
});

import { qualifyingSessions } from "./stats";
describe("review fixes", () => {
  it("a paused session still qualifies when its pieces add up", () => {
    const base = { kind: "focus" as const, segment: "focus" as const, start: 0 };
    expect(qualifyingSessions([
      { ...base, id: "1", ms: 16 * MIN, completed: false, segId: "s1" },
      { ...base, id: "2", ms: 9 * MIN, completed: true, segId: "s1" },
    ])).toBe(1);
    expect(qualifyingSessions([{ ...base, id: "3", ms: 9 * MIN, completed: true, segId: "s2" }])).toBe(0);
  });
  it("credit is capped at the segment length when banking past the end", () => {
    const s = E.start({ ...E.INITIAL_TIMER }, 0);
    expect(E.markCredited(s, 40 * MIN, 25 * MIN).creditedUpTo).toBe(25 * MIN);
  });
  it("count-up rounds down, countdown rounds up", () => {
    expect(E.fmt(999, false, true)).toBe("00:00");
    expect(E.fmt(999)).toBe("00:01");
  });
  it("advance and reset give each run a new segId", () => {
    const a = E.advance(E.INITIAL_TIMER, T, 0, true);
    expect(a.segId).not.toBe(E.INITIAL_TIMER.segId);
    expect(E.resetSegment(a).segId).not.toBe(a.segId);
  });
});

import { focusScore as fs2 } from "./stats";
describe("focus score weighting", () => {
  const z = { qualifyingSessions: 0, focusMin: 0, tasks: 0, breakMin: 0, streakDays: 0 };
  it("a classic full day (4 pomodoros, 3 tasks, 20 min breaks) is close to 100", () => {
    expect(fs2({ ...z, qualifyingSessions: 4, focusMin: 100, tasks: 3, breakMin: 20 })).toBe(93);
  });
  it("messy ADHD day: 2 h of stopwatch flow, no finished sessions, still scores", () => {
    expect(fs2({ ...z, focusMin: 120 })).toBe(45);
  });
  it("skipping breaks earns nothing but costs nothing", () => {
    expect(fs2({ ...z, focusMin: 60, qualifyingSessions: 2 })).toBe(35);
  });
  it("short focus doesn't get break points", () => {
    expect(fs2({ ...z, focusMin: 20, breakMin: 5 })).toBe(8);
  });
  it("streak boost applies and caps at 100", () => {
    expect(fs2({ ...z, qualifyingSessions: 4, focusMin: 100, tasks: 3, breakMin: 20, streakDays: 30 })).toBe(100);
  });
});

describe("countdown repeat", () => {
  it.each(["off", "cycle", "always"] as const)("uses its own switch with auto-run %s", autoRun => {
    const config = { ...DEFAULT_SETTINGS.timer, mode: "countdown" as const, autoRun, countdownRepeat: true };
    const original = { ...E.INITIAL_TIMER, segId: "countdown", startedAt: 1, frozen: true, frozenTotal: 60_000, creditedUpTo: 1000 };
    const next = E.advance(original, config, 60_001, true);
    expect(next).toMatchObject({ segment: "focus", startedAt: 60_001, elapsedBefore: 0, creditedUpTo: 0, frozen: false });
    expect(next.segId).not.toBe(original.segId);
    expect(E.advance(original, { ...config, countdownRepeat: false }, 60_001, true).startedAt).toBeNull();
    expect(E.advance(original, config, 60_001, false).startedAt).toBeNull();
    expect(E.advance(original, { ...config, mode: "stopwatch" }, 60_001, true).startedAt).toBeNull();
  });
});
