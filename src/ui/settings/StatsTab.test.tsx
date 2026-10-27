import "fake-indexeddb/auto";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { addDays, byDay, dayKey, focusRecordDays, focusRecords, startOfDay, stats } from "../../state/stats";
import { DEFAULT_SETTINGS, sanitizeSettings, settings } from "../../state/settings";
import { StatsTab } from "./StatsTab";
vi.hoisted(() => { vi.stubGlobal("navigator", {}); vi.stubGlobal("BroadcastChannel", undefined); });
vi.mock("react", async original => ({ ...await original<typeof import("react")>(), useSyncExternalStore: (_subscribe: unknown, get: () => unknown) => get() }));
beforeEach(async () => { await import("../../lib/backup"); await (await import("../../lib/store")).flushReadyStores(); });
afterEach(() => { vi.useRealTimers(); });

it("records partial focus and task completions by local day and Monday week, without changing history", () => {
  const monday = startOfDay(new Date(2026, 9, 19).getTime());
  const data = { chunks: [{ id: "partial", kind: "focus" as const, segment: "focus" as const, start: monday, ms: 300000, completed: false }], tasksDone: [{ taskId: "a", at: addDays(monday, -1) }, { taskId: "b", at: monday }] };
  const before = structuredClone(data), days = byDay(data);
  expect(focusRecords(days, addDays(monday, -1), addDays(monday, 1), false).map(r => [r.focusMs, r.tasks])).toEqual([[0, 1], [300000, 1], [0, 0]]);
  expect(focusRecords(days, addDays(monday, -1), addDays(monday, 1), true).map(r => [r.focusMs, r.tasks])).toEqual([[0, 1], [300000, 1]]);
  expect(data).toEqual(before);
});
it("renders neutral empty records, with no score, streak or graded calendar", async () => {
  await stats.ready; stats.set({ chunks: [], tasksDone: [] });
  const html = renderToStaticMarkup(<StatsTab />);
  expect(html).toContain("No records in this period.");
  expect(html).toContain("Time focused"); expect(html).toContain("Actions finished");
  expect(html).not.toMatch(/score|streak|stats-level|good|bad|story starts|first point/i);
});
it("keeps task-only history visible and excludes future records", async () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 9, 27, 12));
  await stats.ready; stats.set({ chunks: [], tasksDone: [{ taskId: "now", at: Date.now() }, { taskId: "future", at: Date.now() + 1 }] });
  const html = renderToStaticMarkup(<StatsTab />);
  expect(html).not.toContain("No records"); expect(html).toContain("<td>1</td>");
});
it("shows today's slice of focus that began before midnight without an empty-period message", async () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 9, 27, 0, 15));
  await stats.ready;
  stats.set({ chunks: [{ id: "midnight", kind: "focus", segment: "focus", start: new Date(2026, 9, 26, 23, 50).getTime(), ms: 25 * 60000, completed: true }], tasksDone: [] });
  const html = renderToStaticMarkup(<StatsTab />);
  expect(html).toContain("<td>15m</td>");
  expect(html).not.toContain("No records in this period.");
});
it("splits a completed 25-minute block at midnight without changing raw history or legacy buckets", () => {
  const start = new Date(2026, 9, 26, 23, 50).getTime(), end = new Date(2026, 9, 27, 0, 15).getTime();
  const data = { chunks: [{ id: "midnight", kind: "focus" as const, segment: "focus" as const, start, ms: end - start, completed: true }], tasksDone: [{ taskId: "done", at: end }] };
  const before = structuredClone(data), legacy = byDay(data);
  const records = focusRecords(focusRecordDays(data, end), start, end, false);
  expect(records.map(record => [record.focusMs, record.tasks])).toEqual([[10 * 60000, 0], [15 * 60000, 1]]);
  expect(records.reduce((sum, record) => sum + record.focusMs, 0)).toBe(end - start);
  expect(data).toEqual(before);
  expect(byDay(data)).toEqual(legacy);
  expect(legacy.get(dayKey(start))?.focusMs).toBe(25 * 60000);
});
it("splits a multi-day stopwatch into calendar days and Monday-based weeks", () => {
  const start = new Date(2026, 9, 17, 22).getTime(), end = new Date(2026, 9, 19, 2).getTime();
  const data = { chunks: [{ id: "stopwatch", kind: "focus" as const, segment: "focus" as const, start, ms: end - start, completed: false }], tasksDone: [] };
  const days = focusRecordDays(data, end);
  expect(focusRecords(days, start, end, false).map(record => record.focusMs / 3600000)).toEqual([2, 24, 2]);
  const weekly = focusRecords(days, start, end, true);
  expect(weekly.map(record => record.focusMs / 3600000)).toEqual([26, 2]);
  expect(weekly.reduce((sum, record) => sum + record.focusMs, 0)).toBe(end - start);
});
it.each([
  [2, 7, 23], // Spring forward: Sunday has 23 elapsed hours.
  [9, 31, 25], // Fall back: Sunday has 25 elapsed hours.
])("uses local midnights across the DST transition after month %s day %s", (month, date, hours) => {
  vi.stubEnv("TZ", "America/New_York");
  try {
    const start = new Date(2026, month, date, 22).getTime(), end = new Date(2026, month, date + 2, 2).getTime();
    const transitionDay = new Date(2026, month, date + 1).getTime();
    expect(addDays(transitionDay, 1) - transitionDay).toBe(hours * 3600000);
    const data = { chunks: [{ id: "dst", kind: "focus" as const, segment: "focus" as const, start, ms: end - start, completed: false }], tasksDone: [] };
    const days = focusRecordDays(data, end);
    const daily = focusRecords(days, start, end, false);
    expect(daily.map(record => record.focusMs / 3600000)).toEqual([2, hours, 2]);
    expect(daily.every(record => new Date(record.start).getHours() === 0)).toBe(true);
    expect(focusRecords(days, start, end, true).map(record => record.focusMs / 3600000)).toEqual([2 + hours, 2]);
    expect(daily.reduce((sum, record) => sum + record.focusMs, 0)).toBe(end - start);
  } finally { vi.unstubAllEnvs(); }
});
it("assigns a Sunday-to-Monday block to both weeks and keeps an exact-midnight end on Sunday", () => {
  const start = new Date(2026, 9, 18, 23, 50).getTime(), midnight = new Date(2026, 9, 19).getTime(), end = midnight + 15 * 60000;
  const data = { chunks: [{ id: "boundary", kind: "focus" as const, segment: "focus" as const, start, ms: end - start, completed: true }], tasksDone: [{ taskId: "monday", at: end }] };
  expect(focusRecords(focusRecordDays(data, end), start, end, true).map(record => [record.focusMs, record.tasks])).toEqual([[10 * 60000, 0], [15 * 60000, 1]]);
  const exact = { ...data, chunks: [{ ...data.chunks[0], ms: midnight - start }], tasksDone: [] };
  expect([...focusRecordDays(exact, end).keys()]).toEqual([dayKey(start)]);
});
it("excludes future credit and break time while keeping task-only days", () => {
  const at = new Date(2026, 9, 27, 12).getTime();
  const data = { chunks: [
    { id: "break", kind: "break" as const, segment: "short" as const, start: at - 60000, ms: 60000, completed: true },
    { id: "future", kind: "focus" as const, segment: "focus" as const, start: at + 1, ms: 60000, completed: true },
    { id: "zero", kind: "focus" as const, segment: "focus" as const, start: at, ms: 0, completed: true },
  ], tasksDone: [{ taskId: "done", at }, { taskId: "later", at: at + 1 }] };
  expect(focusRecords(focusRecordDays(data, at), at, at, false).map(record => [record.focusMs, record.tasks])).toEqual([[0, 1]]);
});
it("defaults old settings to visible stats and preserves the hide choice through settings backup", async () => {
  const b = await import("../../lib/backup"); await settings.ready;
  expect(sanitizeSettings({ extras: {} }).extras.hideStats).toBe(false);
  settings.set({ ...DEFAULT_SETTINGS, extras: { ...DEFAULT_SETTINGS.extras, hideStats: true } });
  const parsed = b.parseBackup(await b.createBackup({ sections: ["settings"] }));
  expect((parsed.data.settings as typeof DEFAULT_SETTINGS).extras.hideStats).toBe(true);
  settings.set(DEFAULT_SETTINGS); await b.restoreBackup(parsed, async () => ["sync-meta", {}]);
  expect(settings.get().extras.hideStats).toBe(true);
});
