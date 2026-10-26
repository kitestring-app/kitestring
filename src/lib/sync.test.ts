import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { decide } from "./sync";

describe("sync last-writer-wins", () => {
  it("pulls newer remote copies and pushes newer local ones", () => {
    expect(decide(undefined, 5)).toBe("pull");
    expect(decide(3, 5)).toBe("pull");
    expect(decide(9, 5)).toBe("push");
    expect(decide(9, undefined)).toBe("push");
    expect(decide(5, 5)).toBe("same");
    expect(decide(undefined, undefined)).toBe("same");
  });
});

describe("where sync runs", () => {
  it("requires sign-in on the hosted copy or a native cloud bridge", async () => {
    const { syncAllowedAt } = await import("./sync");
    expect(syncAllowedAt({ protocol: "https:", hostname: "kitestring.custom-pomodoro.workers.dev" }, true)).toBe(true);
    expect(syncAllowedAt({ protocol: "https:", hostname: "custom-pomodoro.custom-pomodoro.workers.dev" }, true)).toBe(true);
    expect(syncAllowedAt({ protocol: "http:", hostname: "localhost" })).toBe(false);
    expect(syncAllowedAt({ protocol: "http:", hostname: "127.0.0.1" })).toBe(false);
    expect(syncAllowedAt({ protocol: "app:", hostname: "custom-pomodoro" })).toBe(false);
    expect(syncAllowedAt({ protocol: "app:", hostname: "custom-pomodoro" }, true, true)).toBe(true);
    expect(syncAllowedAt({ protocol: "https:", hostname: "custom-pomodoro.custom-pomodoro.workers.dev" }, false)).toBe(false);
    expect(syncAllowedAt({ protocol: "https:", hostname: "foreign.invalid" }, true)).toBe(false); // no bridge or session
  });
});

describe("backup import and sync", () => {
  it("stamps imported sync keys as newest so they push, keeps other stamps, ignores non-sync keys", async () => {
    const { dbSet } = await import("./db");
    const { metaAfterImport } = await import("./sync");
    await dbSet("sync-meta", { notes: 7, radio: 3 });
    const [key, meta] = await metaAfterImport(["tasks", "notes", "timer"], 1000);
    expect(key).toBe("sync-meta");
    expect(meta).toEqual({ tasks: 1000, notes: 1000, radio: 3 });
    expect(decide(meta.tasks, 900)).toBe("push"); // an older cloud copy no longer overwrites the import
  });
});

it("includes parked thoughts in sync and stamps backup imports", async () => {
  const { SYNC_KEYS, metaAfterImport } = await import("./sync");
  expect(SYNC_KEYS).toContain("parked");
  const [, meta] = await metaAfterImport(["parked"], 2000);
  expect(meta.parked).toBe(2000);
});
