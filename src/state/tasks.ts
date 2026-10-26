import { purposefulAction } from "./returnActivity";
import { createStore, uid } from "../lib/store";
import { logTaskDone, unlogTaskDone } from "./stats";

export const TASK_COLORS = ["#C3B8F5", "#F5B5D2", "#A8E5C0", "#A5D8F0", "#F2DCA8", "#F0938A", "#A8E0DC"] as const;

export interface Task {
  id: string;
  title: string;
  emoji?: string;
  color?: string;
  etaMin?: number;
  done: boolean;
  parentId?: string;
  createdAt: number;
}

export const tasks = createStore<Task[]>("tasks", [], (stored) =>
  Array.isArray(stored)
    ? (stored as Task[]).filter((t) => t && typeof t.id === "string" && typeof t.title === "string").map((t) => (t.color && !/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(t.color) ? { ...t, color: undefined } : t))
    : [],
);

export const topLevel = (all: Task[]) => all.filter((t) => !t.parentId);
export const childrenOf = (all: Task[], id: string) => all.filter((t) => t.parentId === id);

/** Task the user explicitly chose to work on ("Focus on this"). Falls back to list order when empty or done. */
export const focusPick = createStore<string | null>("focusPick", null);

/** The task the timer is working on: the picked task if still open, else the first unfinished top-level task (or its first open subtask). */
export function currentTask(all: Task[], pick: string | null = focusPick.get()): Task | undefined {
  const picked = pick ? all.find((t) => t.id === pick && !t.done) : undefined;
  if (picked) return childrenOf(all, picked.id).find((c) => !c.done) ?? picked;
  const parent = topLevel(all).find((t) => !t.done);
  if (!parent) return undefined;
  return childrenOf(all, parent.id).find((c) => !c.done) ?? parent;
}

/** ETA of a task in minutes; parents with subtasks sum their unfinished subtasks. */
export function etaOf(all: Task[], t: Task): number {
  const kids = childrenOf(all, t.id);
  if (!kids.length) return t.etaMin ?? 0;
  return kids.filter((k) => !k.done).reduce((a, k) => a + (k.etaMin ?? 0), 0);
}

export function remainingMinutes(all: Task[]): number {
  return topLevel(all).filter((t) => !t.done).reduce((a, t) => a + etaOf(all, t), 0);
}

export function addTask(patch: Partial<Task> = {}): string {
  purposefulAction();
  const id = uid();
  tasks.set((all) => {
    const t: Task = { title: "", done: false, createdAt: Date.now(), ...patch, id };
    if (!t.parentId) return [...all, t];
    // insert after the parent's last child
    const idx = all.reduce((last, x, i) => (x.id === t.parentId || x.parentId === t.parentId ? i : last), all.length - 1);
    return [...all.slice(0, idx + 1), t, ...all.slice(idx + 1)];
  });
  return id;
}

export function updateTask(id: string, patch: Partial<Task>) {
  purposefulAction();
  tasks.set((all) => all.map((t) => (t.id === id ? { ...t, ...patch } : t)));
}

export function toggleTask(id: string) {
  purposefulAction();
  const t = tasks.get().find((x) => x.id === id);
  if (!t) return;
  const done = !t.done;
  updateTask(id, { done });
  if (done) logTaskDone(id);
  else unlogTaskDone(id);
  // finishing every subtask finishes the parent
  if (t.parentId) {
    const sibs = childrenOf(tasks.get(), t.parentId);
    const parent = tasks.get().find((x) => x.id === t.parentId);
    if (parent && sibs.every((s) => s.done) !== parent.done) toggleTask(parent.id);
  }
}

export function deleteTask(id: string) {
  purposefulAction();
  tasks.set((all) => all.filter((t) => t.id !== id && t.parentId !== id));
}

export function duplicateTask(id: string) {
  const all = tasks.get();
  const t = all.find((x) => x.id === id);
  if (!t) return;
  const copyId = addTask({ ...t, id: undefined, done: false, createdAt: Date.now(), title: t.title });
  for (const k of childrenOf(all, id)) addTask({ ...k, id: undefined, parentId: copyId, done: false, createdAt: Date.now() });
}

export function moveTask(id: string, dir: -1 | 1) {
  purposefulAction();
  tasks.set((all) => {
    const tops = topLevel(all);
    const i = tops.findIndex((t) => t.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= tops.length) return all;
    [tops[i], tops[j]] = [tops[j], tops[i]];
    return tops.flatMap((t) => [t, ...childrenOf(all, t.id)]);
  });
}

export function clearDone() {
  purposefulAction();
  tasks.set((all) => {
    const doneParents = new Set(all.filter((t) => t.done && !t.parentId).map((t) => t.id));
    return all.filter((t) => !t.done && !(t.parentId && doneParents.has(t.parentId)));
  });
}

/** Insert a sibling directly below a row, keeping a parent's children together. */
export function insertTaskAfter(afterId?: string, patch: Partial<Task> = {}): string {
  const anchor = tasks.get().find((t) => t.id === afterId);
  const id = addTask({ ...patch, parentId: anchor?.parentId ?? patch.parentId });
  if (anchor) tasks.set((all) => {
    const added = all.find((t) => t.id === id)!;
    const rest = all.filter((t) => t.id !== id);
    const index = rest.reduce((last, t, i) =>
      t.id === anchor.id || (!anchor.parentId && t.parentId === anchor.id) ? i : last, -1);
    return [...rest.slice(0, index + 1), added, ...rest.slice(index + 1)];
  });
  const parentId = tasks.get().find((t) => t.id === id)?.parentId;
  if (parentId && tasks.get().find((t) => t.id === parentId)?.done) toggleTask(parentId);
  return id;
}

/** One level of subtasks, matching etaOf and the timer's current-task contract. */
export function addSubtask(id: string): string | undefined {
  const task = tasks.get().find((t) => t.id === id);
  if (!task) return;
  const parentId = task.parentId ?? task.id;
  const all = tasks.get();
  const last = childrenOf(all, parentId).at(-1);
  return insertTaskAfter(last?.id ?? parentId, { parentId });
}

/** Complete/reopen a parent and its children without changing toggleTask's API. */
export function toggleTaskGroup(id: string) {
  purposefulAction();
  const task = tasks.get().find((t) => t.id === id);
  if (!task) return;
  const done = !task.done;
  for (const child of childrenOf(tasks.get(), id)) {
    if (child.done !== done) toggleTask(child.id);
  }
  if (tasks.get().find((t) => t.id === id)?.done !== done) toggleTask(id);
}

/** Move children within their own group; top-level moves retain existing behavior. */
export function moveTaskAmongSiblings(id: string, dir: -1 | 1) {
  purposefulAction();
  const task = tasks.get().find((t) => t.id === id);
  if (!task) return;
  if (!task.parentId) return moveTask(id, dir);
  tasks.set((all) => {
    const siblings = childrenOf(all, task.parentId!);
    const other = siblings[siblings.findIndex((t) => t.id === id) + dir];
    if (!other) return all;
    const next = [...all];
    const i = all.findIndex((t) => t.id === id), j = all.findIndex((t) => t.id === other.id);
    [next[i], next[j]] = [next[j], next[i]];
    return next;
  });
}


/** Explicit list reordering is purposeful activity; incoming sync/backup values are not. */
export function editTaskOrder(reorder: (all: Task[]) => Task[]) {
  purposefulAction();
  tasks.set(reorder);
}
