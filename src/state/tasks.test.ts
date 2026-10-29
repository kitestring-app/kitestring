import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import {
  addSubtask, childrenOf, clearDone, currentTask, deleteTask, duplicateTask, etaOf,
  insertTaskAfter, moveTaskAmongSiblings, remainingMinutes, tasks, toggleTaskGroup,
} from "./tasks";
import type { Task } from "./tasks";
import { stats } from "./stats";

const task = (id: string, patch: Partial<Task> = {}): Task => ({ id, title: id, done: false, createdAt: 0, ...patch });
const ids = () => tasks.get().map((t) => t.id);

beforeEach(async () => {
  await Promise.all([tasks.ready, stats.ready]);
  tasks.set([]);
  stats.set({ chunks: [], tasksDone: [] });
});

describe("task insertion and grouping", () => {
  it("inserts a top-level sibling after the parent's entire group", () => {
    tasks.set([task("a"), task("a1", { parentId: "a" }), task("b")]);
    const id = insertTaskAfter("a");
    expect(ids()).toEqual(["a", "a1", id, "b"]);
    expect(tasks.get().find((t) => t.id === id)?.parentId).toBeUndefined();
  });
  it("inserts a subtask sibling directly below the selected child", () => {
    tasks.set([task("a"), task("a1", { parentId: "a" }), task("a2", { parentId: "a" }), task("b")]);
    const id = insertTaskAfter("a1");
    expect(ids()).toEqual(["a", "a1", id, "a2", "b"]);
    expect(tasks.get().find((t) => t.id === id)?.parentId).toBe("a");
  });
  it("adds children under their parent, and a child's add-subtask action adds a sibling", () => {
    tasks.set([task("a"), task("b")]);
    const one = addSubtask("a")!;
    const two = addSubtask(one)!;
    expect(ids()).toEqual(["a", one, two, "b"]);
    expect(childrenOf(tasks.get(), "a").map((t) => t.id)).toEqual([one, two]);
    expect(addSubtask("missing")).toBeUndefined();
  });
  it("reopens a completed parent when another child is inserted", () => {
    tasks.set([task("a"), task("a1", { parentId: "a" })]);
    toggleTaskGroup("a");
    const id = insertTaskAfter("a1");
    expect(currentTask(tasks.get())?.id).toBe(id);
    expect(stats.get().tasksDone.map((t) => t.taskId)).toEqual(["a1"]);
  });
});

describe("completion, current task and estimates", () => {
  it("completes/reopens a group and logs each task exactly once", () => {
    tasks.set([task("a"), task("a1", { parentId: "a" }), task("a2", { parentId: "a" })]);
    toggleTaskGroup("a1");
    expect(tasks.get()[0].done).toBe(false);
    toggleTaskGroup("a");
    expect(tasks.get().every((t) => t.done)).toBe(true);
    expect(stats.get().tasksDone.map((t) => t.taskId).sort()).toEqual(["a", "a1", "a2"]);
    expect(currentTask(tasks.get())).toBeUndefined();
    toggleTaskGroup("a");
    expect(tasks.get().every((t) => !t.done)).toBe(true);
    expect(stats.get().tasksDone).toEqual([]);
    expect(ids()).toEqual(["a", "a1", "a2"]);
  });
  it("finishing the last child completes the parent; reopening a child reopens it", () => {
    tasks.set([task("a"), task("a1", { parentId: "a" })]);
    toggleTaskGroup("a1");
    expect(tasks.get()[0].done).toBe(true);
    toggleTaskGroup("a1");
    expect(tasks.get()[0].done).toBe(false);
    expect(currentTask(tasks.get())?.id).toBe("a1");
  });
  it("uses unfinished child ETAs without double-counting parent estimates", () => {
    const all = [task("a", { etaMin: 120 }), task("a1", { parentId: "a", etaMin: 10, done: true }), task("a2", { parentId: "a", etaMin: 30 }), task("b", { etaMin: 25 }), task("c", { done: true, etaMin: 90 })];
    expect(etaOf(all, all[0])).toBe(30);
    expect(remainingMinutes(all)).toBe(55);
    expect(currentTask(all)?.id).toBe("a2");
    expect(remainingMinutes([])).toBe(0);
  });
  it("ignores a missing task when toggling", () => {
    toggleTaskGroup("missing");
    expect(tasks.get()).toEqual([]);
    expect(stats.get().tasksDone).toEqual([]);
  });
});

describe("reordering and existing list actions", () => {
  it("moves a parent with its children and respects list edges", () => {
    tasks.set([task("a"), task("a1", { parentId: "a" }), task("b")]);
    moveTaskAmongSiblings("a", -1);
    expect(ids()).toEqual(["a", "a1", "b"]);
    moveTaskAmongSiblings("a", 1);
    expect(ids()).toEqual(["b", "a", "a1"]);
    moveTaskAmongSiblings("a", 1);
    expect(ids()).toEqual(["b", "a", "a1"]);
  });
  it("moves children only inside their own sibling group", () => {
    tasks.set([task("a"), task("a1", { parentId: "a" }), task("a2", { parentId: "a" }), task("b")]);
    moveTaskAmongSiblings("a1", -1);
    expect(ids()).toEqual(["a", "a1", "a2", "b"]);
    moveTaskAmongSiblings("a1", 1);
    expect(ids()).toEqual(["a", "a2", "a1", "b"]);
    moveTaskAmongSiblings("a1", 1);
    moveTaskAmongSiblings("missing", 1);
    expect(ids()).toEqual(["a", "a2", "a1", "b"]);
  });
  it("duplicates a completed group as new open tasks with metadata intact", () => {
    tasks.set([task("a", { done: true, color: "#C3B8F5", emoji: "🎯" }), task("a1", { done: true, parentId: "a", etaMin: 30 })]);
    duplicateTask("a");
    const copy = tasks.get()[2];
    expect(copy.id).not.toBe("a");
    expect(copy).toMatchObject({ title: "a", done: false, color: "#C3B8F5", emoji: "🎯" });
    expect(childrenOf(tasks.get(), copy.id)[0]).toMatchObject({ title: "a1", done: false, etaMin: 30 });
  });
  it("clears completed rows and removes a deleted parent's children", () => {
    tasks.set([task("a"), task("a1", { parentId: "a", done: true }), task("a2", { parentId: "a" }), task("b", { done: true }), task("b1", { parentId: "b" })]);
    clearDone();
    expect(ids()).toEqual(["a", "a2"]);
    deleteTask("a");
    expect(tasks.get()).toEqual([]);
  });
});

it('N2: a new subtask clears a parent allowance without adding any work estimate', () => {
  tasks.set([task('a', { etaMin: 20, transitionAllowanceMin: 10 })]);
  const child = addSubtask('a')!;
  expect(tasks.get()[0].transitionAllowanceMin).toBeNull();
  expect(remainingMinutes(tasks.get())).toBe(0);
  expect(tasks.get().find(t => t.id === child)?.etaMin).toBeUndefined();
});
