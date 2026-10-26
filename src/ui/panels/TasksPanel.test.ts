import { describe, expect, it } from "vitest";
import { estimateTaskFinish, reorderTask, safeTaskColor, visualTaskOrder } from "./TasksPanel";
import type { Task } from "../../state/tasks";
import { DEFAULT_SETTINGS } from "../../state/settings";
import { INITIAL_TIMER } from "../../state/timerEngine";

const task = (id: string, patch: Partial<Task> = {}): Task => ({ id, title: id, done: false, createdAt: 0, etaMin: 25, ...patch });
const ids = (rows: Task[]) => rows.map((t) => t.id);
const view = (patch: Partial<Parameters<typeof estimateTaskFinish>[3]> = {}) => ({ state: INITIAL_TIMER, running: false, elapsed: 0, total: 25 * 60_000, ...patch });
const config = DEFAULT_SETTINGS.timer;

describe("visual task ordering", () => {
  const rows = [task("done", { done: true }), task("b"), task("bc", { parentId: "b", done: true }), task("bo", { parentId: "b" }), task("a"), task("ac", { parentId: "a" })];
  it("moves a parent with its children and persists open-first order", () => {
    expect(ids(reorderTask(rows, "a", "b"))).toEqual(["a", "ac", "b", "bo", "bc", "done"]);
    expect(ids(reorderTask(rows, "b", "a", true))).toEqual(["a", "ac", "b", "bo", "bc", "done"]);
    expect(ids(visualTaskOrder(rows))).toEqual(["b", "bo", "bc", "a", "ac", "done"]);
  });
  it("keeps children within their parent and completion partition", () => {
    const children = [...rows, task("bo2", { parentId: "b" })];
    expect(ids(reorderTask(children, "bo2", "bo"))).toEqual(["b", "bo2", "bo", "bc", "a", "ac", "done"]);
    for (const [from, to] of [["bo", "ac"], ["b", "done"], ["bo", "bc"], ["b", "b"], ["missing", "a"]]) {
      expect(reorderTask(rows, from, to)).toBe(rows);
    }
  });
  it("does not discard orphaned imported tasks", () => {
    const orphan = task("orphan", { parentId: "missing" });
    expect(reorderTask([...rows, orphan], "a", "b")).toContain(orphan);
  });
});

describe("task finish estimate", () => {
  it("subtracts running focus only from the current task, capped at its ETA", () => {
    const rows = [task("a", { etaMin: 5 }), task("b", { etaMin: 25 })];
    expect(estimateTaskFinish(rows, "a", config, view({ running: true, elapsed: 10 * 60_000 }))).toEqual({ focusMinutes: 25, breakMinutes: 5, totalMinutes: 30 });
    expect(estimateTaskFinish(rows, "a", config, view({ elapsed: 10 * 60_000 }))).toEqual({ focusMinutes: 30, breakMinutes: 5, totalMinutes: 35 });
  });
  it("includes the long break due in the round, and no break after the last work", () => {
    expect(estimateTaskFinish([task("a", { etaMin: 60 })], null, config, view({ running: true, elapsed: 10 * 60_000, state: { ...INITIAL_TIMER, round: 3 } }))).toEqual({ focusMinutes: 50, breakMinutes: 20, totalMinutes: 70 });
    expect(estimateTaskFinish([task("a")], null, config, view()).breakMinutes).toBe(0);
    expect(estimateTaskFinish([task("a", { etaMin: 125 })], null, config, view()).breakMinutes).toBe(30);
  });
  it("counts only leaf ETAs and handles the remainder of an active break", () => {
    const rows = [task("a", { etaMin: 120 }), task("child", { parentId: "a", etaMin: 25 }), task("done", { done: true })];
    expect(estimateTaskFinish(rows, null, config, view({ running: true, elapsed: 2 * 60_000, total: 5 * 60_000, state: { ...INITIAL_TIMER, segment: "short", round: 1 } }))).toEqual({ focusMinutes: 25, breakMinutes: 3, totalMinutes: 28 });
    expect(estimateTaskFinish([], null, config, view()).totalMinutes).toBe(0);
  });
  it("uses the captured duration for an in-progress segment", () => {
    expect(estimateTaskFinish([task("a", { etaMin: 50 })], null, config, view({ total: 60 * 60_000 })).breakMinutes).toBe(0);
  });
  it("follows countdown, stopwatch, 52/17 and Animedoro break rules", () => {
    const rows = [task("a", { etaMin: 110 })];
    for (const mode of ["countdown", "stopwatch"] as const) expect(estimateTaskFinish(rows, null, { ...config, mode }, view()).breakMinutes).toBe(0);
    expect(estimateTaskFinish(rows, null, { ...config, mode: "5217" }, view({ total: 52 * 60_000 })).breakMinutes).toBe(34);
    expect(estimateTaskFinish([task("a", { etaMin: 60 })], null, { ...config, mode: "animedoro" }, view()).breakMinutes).toBe(30);
  });
});

it("renders only three/six-digit hex colours", () => {
  for (const color of ["#abc", "#ABCDEF", "#123456"]) expect(safeTaskColor(color)).toBe(color);
  for (const color of [undefined, null, 123, "url(https://example.com)", "red", "#abcd", "#12345678", "#abc "]) expect(safeTaskColor(color)).toBe("var(--fg-faint)");
});
