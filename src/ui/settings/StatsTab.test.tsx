import "fake-indexeddb/auto";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { addDays, byDay, focusRecords, startOfDay, stats } from "../../state/stats";
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
it("defaults old settings to visible stats and preserves the hide choice through settings backup", async () => {
  const b = await import("../../lib/backup"); await settings.ready;
  expect(sanitizeSettings({ extras: {} }).extras.hideStats).toBe(false);
  settings.set({ ...DEFAULT_SETTINGS, extras: { ...DEFAULT_SETTINGS.extras, hideStats: true } });
  const parsed = b.parseBackup(await b.createBackup({ sections: ["settings"] }));
  expect((parsed.data.settings as typeof DEFAULT_SETTINGS).extras.hideStats).toBe(true);
  settings.set(DEFAULT_SETTINGS); await b.restoreBackup(parsed, async () => ["sync-meta", {}]);
  expect(settings.get().extras.hideStats).toBe(true);
});
