import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { capParked, isParkedItem } from "../lib/parked";
import type { ParkedItem } from "../lib/parked";
import { applyRemote, flushAll } from "../lib/store";
import { dbGet } from "../lib/db";
import { parked, parkThought, finishThought, taskThought, requestInterruption, interruptionPrompt } from "./parked";
import { tasks } from "./tasks";
const item = (id: string, at: number, status: ParkedItem["status"] = "open"): ParkedItem => ({ id, at, status, text: id, segment: "focus" });
beforeEach(async () => { await Promise.all([parked.ready, tasks.ready]); parked.set([]); tasks.set([]); });
describe("parked thoughts", () => {
  it("trims and strips controls, enforces limits, and records segment and task context", async () => {
    expect(parkThought("  \n\t ", { segment: "short" })).toBeUndefined();
    expect(parkThought("x".repeat(501), { segment: "focus" })).toBeUndefined();
    const id = parkThought("  Read\u0000 later  ", { segment: "focus", segId: "seg", taskId: "task" });
    expect(parked.get()).toEqual([expect.objectContaining({ id, text: "Read later", segment: "focus", segId: "seg", taskId: "task", status: "open" })]);
    await flushAll();
    expect(await dbGet("parked")).toEqual(parked.get());
    expect(parkThought("x".repeat(500), { segment: "long" })).toBeTruthy();
  });
  it("makes a task once and keeps done/tasked items from creating duplicate tasks", () => {
    const id = parkThought("Read later", { segment: "focus" })!;
    const taskId = taskThought(id);
    expect(tasks.get()).toEqual([expect.objectContaining({ id: taskId, title: "Read later", done: false })]);
    expect(parked.get()[0].status).toBe("tasked");
    expect(taskThought(id)).toBeUndefined();
    finishThought(id);
    expect(parked.get()[0].status).toBe("tasked");
    const next = parkThought("Done already", { segment: "short" })!;
    finishThought(next);
    expect(taskThought(next)).toBeUndefined();
    expect(tasks.get()).toHaveLength(1);
  });
  it("prunes the oldest done entries first, then oldest remaining entries, without reordering survivors", () => {
    const all = Array.from({ length: 500 }, (_, i) => item(String(i), i));
    all[20].status = "done"; all[30].status = "done";
    const next = capParked([...all, item("new", 1000)]);
    expect(next).toHaveLength(500);
    expect(next.some(x => x.id === "0")).toBe(true);
    expect(next.some(x => x.id === "20")).toBe(false);
    expect(next.at(-1)?.id).toBe("new");
    const overflow = capParked([...all.filter(x => x.status === "open"), ...Array.from({ length: 4 }, (_, i) => item(`new${i}`, 1000 + i))]);
    expect(overflow).toHaveLength(500);
    expect(overflow[0].id).toBe("2");
  });
  it("sanitizes synced data, removing invalid and duplicate entries and capping the list", async () => {
    await applyRemote("parked", [item("a", 1), item("a", 2), { ...item("b", 1), text: "" }, null]);
    expect(parked.get()).toEqual([item("a", 1)]);
    await applyRemote("parked", Array.from({ length: 501 }, (_, i) => item(String(i), i)));
    expect(parked.get()).toHaveLength(500);
    expect(parked.get()[0].id).toBe("1");
    expect(isParkedItem({ ...item("a", 1), segId: {} })).toBe(false);
  });
});

it("9: turning off interruption capture dismisses an open prompt once", async () => {
  const s = await import("./settings"); await s.calmFoundationReady;
  await (await import("./notes")).notes.ready;
  s.settingsUpdate("timer", { interruptionPrompt: true });
  await requestInterruption({ segId: "once", at: Date.now() });
  expect(interruptionPrompt.get()).not.toBeNull();
  const changed = vi.fn(); const off = interruptionPrompt.subscribe(changed);
  s.settingsUpdate("timer", { interruptionPrompt: false });
  expect(interruptionPrompt.get()).toBeNull(); expect(changed).toHaveBeenCalledOnce(); off();
});
