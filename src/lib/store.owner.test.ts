import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { IDBFactory } from "fake-indexeddb";

beforeEach(() => { vi.resetModules(); vi.stubGlobal("indexedDB", new IDBFactory()); vi.stubGlobal("BroadcastChannel", undefined); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
it("refuses direct clock writes in a follower, including the usual-length tally", async () => {
  vi.stubGlobal("navigator", { locks: {} }); vi.stubGlobal("window", { addEventListener: vi.fn() }); vi.stubGlobal("document", { addEventListener: vi.fn() });
  const s = await import("./store");
  for (const key of ["timer", "stats", "returnActivity", "parkingReview", "tinyStarts"]) {
    const store = s.createStore(key, { n: 0 }); await store.ready;
    store.set({ n: 1 });
    expect(store.get(), key).toEqual({ n: 0 });
    await s.flushReadyStores();
    expect(await (await import("./db")).dbGet(key), key).toBeUndefined();
  }
});
it("refuses clock edits before hydration rather than replaying a stale snapshot", async () => {
  vi.stubGlobal("navigator", {});
  const s = await import("./store"), store = s.createStore("timer", { n: 0 });
  store.set({ n: 1 }); await store.ready;
  expect(store.get()).toEqual({ n: 0 });
  await s.flushReadyStores();
  expect(await (await import("./db")).dbGet("timer")).toBeUndefined();
});

it("refuses bulk restore, cloud replacement and preset commits in a follower", async () => {
  vi.stubGlobal("navigator", { locks: {} }); vi.stubGlobal("window", { addEventListener: vi.fn() }); vi.stubGlobal("document", { addEventListener: vi.fn() });
  const store = await import("./store"), db = await import("./db");
  const timer = store.createStore("timer", { n: 0 }); await timer.ready;
  await expect(store.restoreStoreEntries([["timer", { n: 1 }]])).rejects.toThrow("active timer");
  await expect(store.applyRemote("timer", { n: 2 })).rejects.toThrow("active timer");
  expect(await store.commitStoreEntries([["timer", { n: 3 }]])).toBe(false);
  await expect(store.clearStoredProfile()).rejects.toThrow("active timer");
  expect(timer.get()).toEqual({ n: 0 });
  expect(await db.dbGet("timer")).toBeUndefined();
});
it("rechecks ownership when a queued clock save reaches persistence", async () => {
  const store = await import("./store"), db = await import("./db");
  let owner = true; store.registerClockOwner(() => owner);
  const timer = store.createStore("timer", { n: 0 }); await timer.ready;
  timer.set({ n: 1 });
  const queued = store.flushAll(); owner = false;
  await queued;
  expect(await db.dbGet("timer")).toBeUndefined();
});
it("an owner reset clears the clock and its durable partners together", async () => {
  const store = await import("./store"), db = await import("./db");
  store.registerClockOwner(() => true);
  const timer = store.createStore("timer", { n: 0 }), stats = store.createStore("stats", { n: 0 });
  await Promise.all([timer.ready, stats.ready]);
  timer.set({ n: 1 }); stats.set({ n: 1 }); await store.flushReadyStores();
  await store.clearStoredProfile();
  expect(timer.get()).toEqual({ n: 0 }); expect(stats.get()).toEqual({ n: 0 });
  expect(await db.dbKeys()).toEqual([]);
});
