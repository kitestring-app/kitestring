import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { IDBFactory } from "fake-indexeddb";

// Each module instance has its own registry, channel and IndexedDB connection,
// just like two tabs. Deliver messages explicitly to exercise stale snapshots.
class Channel {
  static all: Channel[] = [];
  static messages: { sender: Channel; data: { type: string; entries: [string, unknown][] } }[] = [];
  listeners: ((event: { data: unknown }) => void)[] = [];
  constructor() { Channel.all.push(this); }
  addEventListener(_type: string, listener: (event: { data: unknown }) => void) { this.listeners.push(listener); }
  postMessage(data: { type: string; entries: [string, unknown][] }) {
    Channel.messages.push({ sender: this, data: structuredClone(data) });
  }
  static deliver() {
    for (const { sender, data } of Channel.messages.splice(0)) {
      for (const channel of Channel.all) if (channel !== sender) channel.listeners.forEach(fn => fn({ data }));
    }
  }
}

beforeEach(() => {
  vi.resetModules();
  vi.stubGlobal("indexedDB", new IDBFactory());
  vi.stubGlobal("BroadcastChannel", Channel);
  Channel.all = []; Channel.messages = [];
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
});
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); });

async function tab(owner: boolean) {
  const store = await import("./store");
  const db = await import("./db");
  store.registerClockOwner(() => owner);
  const timer = store.createStore("timer", { startedAt: null as number | null, creditedUpTo: 0 });
  const stats = store.createStore("stats", { ms: 0 });
  const tasks = store.createStore("tasks", [] as string[]);
  const parked = store.createStore("parked", [] as string[]);
  const review = store.createStore("parkingReview", { cursor: 0 });
  const clockOnly = store.createStore("clockOnly", { tick: 0 });
  store.registerPersistenceGroup(["timer", "stats", "clockOnly", "parkingReview"]);
  store.registerPersistenceGroup(["parkingReview", "parked", "tasks"]);
  store.registerPersistenceOwner(["timer", "stats", "clockOnly"], () => owner);
  await Promise.all([timer.ready, stats.ready, tasks.ready, parked.ready, review.ready, clockOnly.ready]);
  return { ...store, ...db, timer, stats, tasks, parked, review, clockOnly, setOwner(value: boolean) { owner = value; } };
}

it.each(["tasks", "parked"] as const)("PR2 round 2: a follower's %s edits never publish another tab's clock or credit", async key => {
  const leader = await tab(true);
  await leader.flushReadyStores();
  vi.resetModules();
  const follower = await tab(false);
  const write = vi.spyOn(await import("./db"), "dbSetMany");
  const clock = { startedAt: 1000, creditedUpTo: 750 };
  leader.timer.set(clock); leader.stats.set({ ms: 750 }); leader.clockOnly.set({ tick: 1 });
  follower[key].set(["first edit"]);
  await follower.flushReadyStores();
  expect(write.mock.calls.flatMap(([entries]) => entries.map(([key]) => key))).toEqual([key]);
  expect(Channel.messages.flatMap(({ data }) => data.entries.map(([key]) => key))).toEqual([key]);
  Channel.deliver();
  expect(leader.timer.get()).toEqual(clock);
  expect(leader.stats.get()).toEqual({ ms: 750 });
  expect(leader.clockOnly.get()).toEqual({ tick: 1 });
  expect(leader[key].get()).toEqual(["first edit"]);
  await leader.flushReadyStores();
  // The leader committed, but its broadcast has not reached the follower yet.
  expect(follower.timer.get().startedAt).toBeNull();
  follower[key].set(["second edit"]);
  await follower.flushReadyStores();
  expect(await follower.dbGet("timer")).toEqual(clock);
  expect(await follower.dbGet("stats")).toEqual({ ms: 750 });
  expect(await follower.dbGet("clockOnly")).toEqual({ tick: 1 });
  expect(write.mock.calls.flatMap(([entries]) => entries.map(([key]) => key))).toEqual([key, key]);
  Channel.deliver();
  expect(leader.timer.get()).toEqual(clock);
  expect(leader.stats.get()).toEqual({ ms: 750 });
  expect(follower.timer.get()).toEqual(clock);
  write.mockRestore();
});

it("PR2 round 2: owned unchanged partners commit atomically but cannot replace another tab's pending edit", async () => {
  const leader = await tab(true);
  vi.resetModules();
  const follower = await tab(false);
  const write = vi.spyOn(await import("./db"), "dbSetMany");
  // Ownership is evaluated when values are read, after a queued save waits.
  follower.setOwner(true);
  follower.registerPersistenceOwner(["timer", "stats", "clockOnly"], () => true);
  leader.stats.set({ ms: 900 });
  follower.timer.set({ startedAt: 1000, creditedUpTo: 0 });
  await follower.flushReadyStores();
  expect(write.mock.calls[0][0].map(([key]) => key)).toEqual(["timer", "stats", "clockOnly"]);
  expect(Channel.messages[0].data.entries.map(([key]) => key)).toEqual(["timer"]);
  Channel.deliver();
  expect(leader.stats.get()).toEqual({ ms: 900 });
  await leader.flushReadyStores();
  expect(await leader.dbGet("stats")).toEqual({ ms: 900 });
  write.mockRestore();
});

it("PR2 round 2: a queued timer save includes a later conversion even when a second flush already claimed its edits", async () => {
  const leader = await tab(true);
  const db = await import("./db");
  vi.resetModules();
  const follower = await tab(false);
  const write = vi.spyOn(db, "dbSetMany");
  leader.timer.set({ startedAt: 1000, creditedUpTo: 0 });
  const queued = leader.flushAll();
  leader.review.set({ cursor: 1 });
  leader.tasks.set(["converted task"]);
  leader.parked.set(["tasked thought"]);
  const later = leader.flushAll();
  await queued;
  const first = new Map(write.mock.calls[0][0]);
  expect(first.get("parkingReview")).toEqual({ cursor: 1 });
  expect(first.get("tasks")).toEqual(["converted task"]);
  expect(first.get("parked")).toEqual(["tasked thought"]);
  expect(Channel.messages[0].data.entries.map(([key]) => key).sort()).toEqual(["parked", "parkingReview", "tasks", "timer"]);
  Channel.deliver();
  expect(follower.review.get()).toEqual({ cursor: 1 });
  expect(follower.tasks.get()).toEqual(["converted task"]);
  expect(follower.parked.get()).toEqual(["tasked thought"]);
  await later;
  write.mockRestore();
});

it("round3 a leader task flush cannot overwrite Tab B's undelivered Start and credit", async () => {
  const leader = await tab(true);
  await leader.flushReadyStores();
  vi.resetModules();
  const tabB = await tab(false);
  leader.setOwner(false); tabB.setOwner(true);
  const started = { startedAt: 2000, creditedUpTo: 500 };
  tabB.timer.set(started); tabB.stats.set({ ms: 500 });
  await tabB.flushReadyStores();
  // Tab A has not received B's Start. Its unrelated task edit must leave disk intact.
  expect(leader.timer.get().startedAt).toBeNull();
  leader.tasks.set(["unrelated task edit"]);
  await leader.flushReadyStores();
  expect(await leader.dbGet("timer")).toEqual(started);
  expect(await leader.dbGet("stats")).toEqual({ ms: 500 });
  Channel.deliver();
  expect(leader.timer.get()).toEqual(started);
  expect(tabB.timer.get()).toEqual(started);
});
