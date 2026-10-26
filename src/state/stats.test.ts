import { describe, expect, it } from "vitest";
import {
  addDays, averageFocusScore, byDay, dayKey, focusCalendar, focusLevel, focusScore,
  focusTrend, formatStatsDuration, rangeStart, scoreInputs, startOfDay, statsOverview,
} from "./stats";
import type { LoggedChunk, Range, StatsData } from "./stats";

const MIN = 60_000;
const now = new Date(2026, 9, 24, 20).getTime();
const today = startOfDay(now);
const blank = (): StatsData => ({ chunks: [], tasksDone: [] });
const chunk = (start: number, minutes = 25, patch: Partial<LoggedChunk> = {}): LoggedChunk => ({
  id: String(start), kind: "focus", segment: "focus", start, ms: minutes * MIN, completed: true, ...patch,
});

describe("stats durations", () => {
  it.each([
    [0, "0s"], [999, "0s"], [59_999, "59s"], [MIN, "1m"],
    [59 * MIN, "59m"], [60 * MIN, "1h 0m"], [205 * MIN, "3h 25m"],
    [-MIN, "0s"], [Infinity, "0s"], [NaN, "0s"],
  ])("formats %s as %s", (ms, expected) => {
    expect(formatStatsDuration(ms)).toBe(expected);
  });
});

describe("stats dashboard ranges", () => {
  it.each< [Range, number] >([
    ["today", 0], ["week", 6], ["month", 29], ["3m", 89], ["6m", 181], ["1y", 364], ["all", 0],
  ])("uses the existing %s range contract", (range, offset) => {
    expect(rangeStart(range, now, blank())).toBe(addDays(today, -offset));
    expect(statsOverview(blank(), range, now)).toMatchObject({
      from: addDays(today, -offset), currentStreak: 0, score: 0,
      totals: { focusMs: 0, breakMs: 0, sessions: 0, tasks: 0 },
    });
  });

  it("counts partial focus time, completed sessions, breaks and tasks within boundaries", () => {
    const data: StatsData = {
      chunks: [chunk(addDays(today, -1)), chunk(today), chunk(today + MIN, 7, { completed: false }),
        chunk(today + 2 * MIN, 5, { kind: "break", segment: "short" }), chunk(now + 1)],
      tasksDone: [{ taskId: "old", at: today - 1 }, { taskId: "in", at: now }, { taskId: "future", at: now + 1 }],
    };
    const view = statsOverview(data, "today", now);
    expect(view.totals).toEqual({ focusMs: 32 * MIN, breakMs: 5 * MIN, sessions: 1, tasks: 1, longestFocusMs: 25 * MIN });
    expect(view.currentStreak).toBe(2);
    expect(view.score).toBe(focusScore(scoreInputs({ ...data, chunks: data.chunks.slice(0, -1), tasksDone: data.tasksDone.slice(0, -1) }, now, 2)));
    expect(view.days.get(dayKey(today))?.focusMs).toBe(32 * MIN);
  });

  it("includes task-only history in All Time", () => {
    const data: StatsData = { chunks: [chunk(today)], tasksDone: [{ taskId: "early", at: addDays(today, -400) }] };
    const view = statsOverview(data, "all", now);
    expect(view.from).toBe(addDays(today, -400));
    expect(view.totals.tasks).toBe(1);
    expect(statsOverview({ ...data, chunks: [] }, "all", now).from).toBe(addDays(today, -400));
  });

  it("keeps Current Streak independent of the selected range", () => {
    const data: StatsData = { chunks: Array.from({ length: 10 }, (_, i) => chunk(addDays(today, -i))), tasksDone: [] };
    expect(statsOverview(data, "today", now).currentStreak).toBe(10);
    expect(statsOverview(data, "week", now).currentStreak).toBe(10);
  });
});

describe("daily Focus Score averages", () => {
  it("averages focused days, excluding empty and task-only days", () => {
    const data: StatsData = { chunks: [chunk(addDays(today, -2)), chunk(today, 5)], tasksDone: [{ taskId: "only-task", at: addDays(today, -1) }] };
    const scores = [focusScore(scoreInputs(data, addDays(today, -2), 1)), focusScore(scoreInputs(data, today, 1))];
    expect(averageFocusScore(data, addDays(today, -6), now)).toBe(Math.round((scores[0] + scores[1]) / 2));
    expect(averageFocusScore(blank(), today, now)).toBe(0);
  });

  it("qualifies only completed focus sessions of at least ten minutes", () => {
    const data: StatsData = { chunks: [chunk(today, 10), chunk(today + MIN, 9), chunk(today + 2 * MIN, 40, { completed: false })], tasksDone: [] };
    expect(averageFocusScore(data, today, now)).toBe(focusScore({ qualifyingSessions: 1, focusMin: 59, breakMin: 0, tasks: 0, streakDays: 1 }));
  });

  it("uses historical streaks, including focus before the range begins", () => {
    const data: StatsData = { chunks: Array.from({ length: 180 }, (_, i) => chunk(addDays(today, -i))), tasksDone: [] };
    for (const days of [7, 30, 90, 180]) {
      const at = addDays(today, days - 180);
      expect(averageFocusScore(data, at, at + 12 * 60 * MIN)).toBe(focusScore(scoreInputs(data, at, days)));
    }
    const expected = Array.from({ length: 7 }, (_, i) => focusScore(scoreInputs(data, addDays(today, -i), 180 - i)));
    expect(statsOverview(data, "week", now).score).toBe(Math.round(expected.reduce((a, b) => a + b, 0) / 7));
  });

  it("resets across gaps and preserves yesterday's streak for sub-minute focus", () => {
    const data: StatsData = {
      chunks: [chunk(addDays(today, -10)), chunk(addDays(today, -1)), chunk(today, 0.5)], tasksDone: [],
    };
    expect(averageFocusScore(data, today, now)).toBe(focusScore(scoreInputs(data, today, 1)));
    expect(statsOverview(data, "today", now).currentStreak).toBe(1);
    const reset = { ...data, chunks: [...data.chunks, chunk(addDays(today, 2))] };
    expect(averageFocusScore(reset, addDays(today, 2), addDays(now, 2))).toBe(focusScore(scoreInputs(reset, addDays(today, 2), 1)));
  });

  it("ignores future records and includes task and break contributions", () => {
    const data: StatsData = {
      chunks: [chunk(today), chunk(today + MIN, 5, { kind: "break", segment: "short" }), chunk(addDays(today, 1), 200)],
      tasksDone: [{ taskId: "today", at: today }, { taskId: "later", at: now + 1 }],
    };
    expect(averageFocusScore(data, today, now)).toBe(focusScore({ qualifyingSessions: 1, focusMin: 25, breakMin: 5, tasks: 1, streakDays: 1 }));
  });
});

describe("focus trend", () => {
  it("zero-fills missing dates and includes both endpoints", () => {
    const days = byDay({ chunks: [chunk(addDays(today, -2)), chunk(today, 7, { completed: false })], tasksDone: [] });
    const result = focusTrend(days, addDays(today, -2), now, false);
    expect(result.map((b) => b.focusMs)).toEqual([25 * MIN, 0, 7 * MIN]);
    expect(result[0].start).toBe(addDays(today, -2));
    expect(result[2].end).toBe(today);
    expect(focusTrend(days, today, now, false)).toHaveLength(1);
  });

  it("groups long ranges into Monday-based weeks with partial boundary weeks", () => {
    const from = new Date(2026, 9, 14).getTime(); // Wednesday
    const data = { chunks: Array.from({ length: 11 }, (_, i) => chunk(addDays(from, i), 10)), tasksDone: [] };
    const result = focusTrend(byDay(data), from, now, true);
    expect(result).toEqual([
      { start: from, end: addDays(from, 4), focusMs: 50 * MIN },
      { start: addDays(from, 5), end: today, focusMs: 60 * MIN },
    ]);
    expect(result.reduce((sum, b) => sum + b.focusMs, 0)).toBe(110 * MIN);
  });
});

describe("focus calendar", () => {
  it.each<182 | 365>([182, 365])("has %s focusable dates plus blank alignment cells", (length) => {
    const days = byDay({ chunks: [chunk(today), chunk(addDays(today, -length))], tasksDone: [] });
    const cells = focusCalendar(days, now, length);
    const visible = cells.filter((d) => d.inRange);
    expect(visible).toHaveLength(length);
    expect(cells.length % 7).toBe(0);
    expect(new Date(cells[0].at).getDay()).toBe(0);
    expect(new Date(cells[cells.length - 1].at).getDay()).toBe(6);
    expect(visible[0].at).toBe(addDays(today, 1 - length));
    expect(visible[visible.length - 1]).toMatchObject({ at: today, focusMs: 25 * MIN, sessions: 1 });
    expect(new Set(visible.map((d) => d.key)).size).toBe(length);
  });

  it("uses local calendar dates across leap days and daylight-saving transitions", () => {
    for (const at of [new Date(2024, 2, 12, 12).getTime(), new Date(2026, 10, 5, 12).getTime()]) {
      const cells = focusCalendar(new Map(), at, 365).filter((d) => d.inRange);
      expect(cells).toHaveLength(365);
      expect(new Set(cells.map((d) => d.key)).size).toBe(365);
      const buckets = focusTrend(new Map(), cells[0].at, at, false);
      expect(buckets).toHaveLength(365);
      expect(buckets.every((b) => new Date(b.start).getHours() === 0)).toBe(true);
    }
    const leap = focusCalendar(new Map(), new Date(2024, 2, 12).getTime(), 182);
    expect(leap.some((d) => d.key === "2024-02-29")).toBe(true);
  });

  it("uses four positive intensity levels and zero separately", () => {
    expect([0, 1, 60 * MIN, 120 * MIN, 180 * MIN, 181 * MIN].map((v) => focusLevel(v, "hours"))).toEqual([0, 1, 1, 2, 3, 4]);
    expect([0, 1, 2, 3, 4, 50].map((v) => focusLevel(v, "sessions"))).toEqual([0, 1, 2, 3, 4, 4]);
  });
});
