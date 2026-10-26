import "fake-indexeddb/auto";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { dbGet, dbSet } from "../lib/db";
import { flushAll } from "../lib/store";
import { clearDoneThoughts, deleteThought, parked, taskThought } from "./parked";
import type { ParkedItem } from "./parked";
import { addDays, deleteSession, sessionLog, startOfDay, stats, statsOverview } from "./stats";
import type { LoggedChunk } from "./stats";
import { tasks } from "./tasks";

const at = new Date(2026, 9, 24, 20).getTime();
const thought = (id: string, status: ParkedItem["status"] = "open"): ParkedItem => ({ id, at, status, text: id, segment: "focus" });
const chunk = (id: string, patch: Partial<LoggedChunk> = {}): LoggedChunk => ({ id, segId: "run", kind: "focus", segment: "focus", start: startOfDay(at), ms: 10 * 60_000, completed: false, ...patch });
beforeEach(async () => {
  await Promise.all([parked.ready, stats.ready, tasks.ready]);
  parked.set([]); stats.set({ chunks: [], tasksDone: [] }); tasks.set([]);
  await flushAll();
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

it("deletes open thoughts and interruptions, and undo preserves newer edits without duplicating IDs", async () => {
  const interruption = { ...thought("phone"), kind: "interruption" as const, tag: "Phone" as const, segId: "run" };
  parked.set([thought("first"), interruption, thought("last")]);
  const undo = deleteThought("phone")!;
  expect(parked.get().map(item => item.id)).toEqual(["first", "last"]);
  await flushAll();
  expect(await dbGet("parked")).toEqual(parked.get());
  parked.set(all => [...all.map(item => item.id === "last" ? { ...item, text: "Edited" } : item), thought("new")]);
  undo(); undo();
  expect(parked.get()).toEqual([thought("first"), interruption, { ...thought("last"), text: "Edited" }, thought("new")]);
  expect(deleteThought("missing")).toBeUndefined();
  const again = deleteThought("phone")!;
  parked.set(all => [...all, { ...interruption, text: "Newer synced copy" }]);
  again();
  expect(parked.get().filter(item => item.id === "phone")).toEqual([{ ...interruption, text: "Newer synced copy" }]);
});

it("clears done and tasked thoughts with undo while retaining the tasks they created", () => {
  parked.set([thought("open"), thought("done", "done"), thought("task")]);
  taskThought("task");
  const savedTasks = tasks.get();
  const saved = parked.get();
  const undo = clearDoneThoughts()!;
  expect(parked.get()).toEqual([thought("open")]);
  expect(clearDoneThoughts()).toBeUndefined();
  undo();
  expect(parked.get()).toEqual(saved);
  expect(tasks.get()).toEqual(savedTasks);
  deleteThought("done")!();
  deleteThought("task")!();
  expect(parked.get()).toEqual(saved);
});

it("deletes all chunks of a session across dates and tasks; totals, score and streak recompute and undo restores them", () => {
  const original = { chunks: [chunk("previous", { segId: "previous", start: addDays(startOfDay(at), -1), completed: true }),
    chunk("a", { start: addDays(startOfDay(at), -2), taskId: "one" }),
    chunk("b", { start: addDays(startOfDay(at), -2) + 20 * 60_000, completed: true, taskId: "two" })],
    tasksDone: [{ at, taskId: "finished" }] };
  stats.set(original);
  const before = statsOverview(stats.get(), "all", at);
  expect(before.currentStreak).toBe(2);
  const selected = sessionLog(stats.get(), [], { taskId: "one" })[0].sessions[0];
  const undo = deleteSession(selected)!;
  expect(stats.get().chunks.map(item => item.id)).toEqual(["previous"]);
  const after = statsOverview(stats.get(), "all", at);
  expect(after.currentStreak).toBe(1);
  expect(after.totals.focusMs).toBe(before.totals.focusMs - 20 * 60_000);
  expect(after.score).not.toBe(before.score);
  expect(sessionLog(stats.get(), [])).toHaveLength(1);
  stats.set(data => ({ ...data, tasksDone: [...data.tasksDone, { at, taskId: "new" }], chunks: [...data.chunks, chunk("new", { segId: "new", ms: 1000 })] }));
  undo(); undo();
  expect(stats.get().chunks).toEqual([...original.chunks, chunk("new", { segId: "new", ms: 1000 })]);
  expect(stats.get().tasksDone).toHaveLength(2);
  expect(statsOverview({ ...stats.get(), chunks: stats.get().chunks.slice(0, -1), tasksDone: original.tasksDone }, "all", at)).toEqual(before);
});

it("removes a single legacy chunk without confusing its ID with a segment ID", () => {
  stats.set({ chunks: [chunk("legacy", { segId: undefined }), chunk("other", { segId: undefined }), chunk("modern", { segId: "legacy" })], tasksDone: [] });
  const row = sessionLog(stats.get(), [])[0].sessions.find(item => !item.segId && item.id.includes('"legacy"'))!;
  const undo = deleteSession(row)!;
  expect(stats.get().chunks.map(item => item.id)).toEqual(["other", "modern"]);
  expect(deleteSession(row)).toBeUndefined();
  undo();
  expect(stats.get().chunks.map(item => item.id)).toEqual(["legacy", "other", "modern"]);
});

it("marks deletes, Clear done and undo dirty through normal persistence and pushes each change to sync", async () => {
  parked.set([thought("open"), thought("done", "done")]);
  stats.set({ chunks: [chunk("a"), chunk("b", { completed: true })], tasksDone: [] });
  await flushAll();
  await dbSet("sync-account", "test@example.invalid");
  vi.stubGlobal("location", { protocol: "https:", hostname: "custom-pomodoro.custom-pomodoro.workers.dev" });
  vi.stubGlobal("document", { addEventListener: vi.fn(), visibilityState: "visible" });
  const puts: { entries: { key: string; value: unknown; updatedAt: number }[] }[] = [];
  const remote = new Map<string, { key: string; value: unknown; updatedAt: number }>();
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
    if (url === "/api/me") return Response.json({ email: "test@example.invalid" });
    if (init.method === "GET") return Response.json({ entries: [...remote.values()] });
    if (init.method === "PUT") {
      const payload = JSON.parse(init.body as string) as (typeof puts)[number];
      puts.push(payload);
      for (const entry of payload.entries) remote.set(entry.key, entry);
    }
    return Response.json({ ok: true });
  }));
  vi.useFakeTimers({ toFake: ["setInterval"] });
  const sync = await import("../lib/sync");
  await sync.startSync();
  const checkPush = async () => {
    puts.length = 0;
    await flushAll();
    await sync.syncNow();
    const entries = puts.flatMap(put => put.entries);
    expect(entries).toEqual(expect.arrayContaining([
      { key: "parked", value: parked.get(), updatedAt: expect.any(Number) },
      { key: "stats", value: stats.get(), updatedAt: expect.any(Number) },
    ]));
    expect(await dbGet("parked")).toEqual(parked.get());
    expect(await dbGet("stats")).toEqual(stats.get());
  };
  try {
    const undoThought = deleteThought("open")!;
    const undoSession = deleteSession(sessionLog(stats.get(), [])[0].sessions[0])!;
    await checkPush();
    undoThought(); undoSession();
    await checkPush();
    const undoDone = clearDoneThoughts()!;
    const undoAgain = deleteSession(sessionLog(stats.get(), [])[0].sessions[0])!;
    await checkPush();
    undoDone(); undoAgain();
    await checkPush();
  } finally { await sync.signOut(); }
});
