import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IDBFactory } from "fake-indexeddb";

describe("returnActivity acknowledgeRound and legacy migration", () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.stubGlobal("indexedDB", new IDBFactory());
    vi.stubGlobal("BroadcastChannel", undefined);
    vi.stubGlobal("navigator", {});
    vi.stubGlobal("window", { addEventListener: vi.fn() });
    vi.stubGlobal("document", { addEventListener: vi.fn(), visibilityState: "visible" });
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  it("accepts a legacy record missing acknowledgedRound and defaults it to null", async () => {
    const db = await import("../lib/db");
    await db.dbSet("returnActivity", { version: 1, lastPurposefulAt: 123, pendingGap: "gap:123", acknowledgedGap: null, uncertain: false });
    const activity = await import("./returnActivity");
    await activity.returnActivity.ready;
    expect(activity.returnActivity.get()).toMatchObject({ acknowledgedRound: null, pendingGap: "gap:123" });
  });

  it("rejects an invalid acknowledgedRound and marks uncertain", async () => {
    const db = await import("../lib/db");
    await db.dbSet("returnActivity", { version: 1, lastPurposefulAt: 123, pendingGap: null, acknowledgedGap: null, acknowledgedRound: 42, uncertain: false });
    const activity = await import("./returnActivity");
    await activity.returnActivity.ready;
    expect(activity.returnActivity.get()).toMatchObject({ acknowledgedRound: null, uncertain: true });
  });

  it("acknowledgeRound sets the token without clearing pendingGap or acknowledgedGap", async () => {
    const activity = await import("./returnActivity");
    await activity.returnActivity.ready;
    activity.returnActivity.set({ version: 1, lastPurposefulAt: Date.now() - 3 * 86_400_000, pendingGap: "gap:old", acknowledgedGap: "gap:older", acknowledgedRound: null, uncertain: false });
    expect(activity.acknowledgeRound("gap:old")).toBe(true);
    expect(activity.returnActivity.get()).toMatchObject({ acknowledgedRound: "gap:old", pendingGap: "gap:old", acknowledgedGap: "gap:older" });
  });

  it("acknowledgeRound rejects a mismatched or missing pending gap", async () => {
    const activity = await import("./returnActivity");
    await activity.returnActivity.ready;
    activity.returnActivity.set({ version: 1, lastPurposefulAt: Date.now(), pendingGap: "gap:old", acknowledgedGap: null, acknowledgedRound: null, uncertain: false });
    expect(activity.acknowledgeRound("gap:other")).toBe(false);
    expect(activity.returnActivity.get().acknowledgedRound).toBeNull();
    activity.returnActivity.set({ version: 1, lastPurposefulAt: Date.now(), pendingGap: null, acknowledgedGap: null, acknowledgedRound: null, uncertain: false });
    expect(activity.acknowledgeRound("gap:old")).toBe(false);
  });

  it("acknowledgeRound is owner-guarded", async () => {
    const activity = await import("./returnActivity");
    await activity.returnActivity.ready;
    activity.registerActivityOwner(() => false, () => {});
    activity.returnActivity.set({ version: 1, lastPurposefulAt: Date.now(), pendingGap: "gap:old", acknowledgedGap: null, acknowledgedRound: null, uncertain: false });
    expect(activity.acknowledgeRound("gap:old")).toBe(false);
    expect(activity.returnActivity.get().acknowledgedRound).toBeNull();
  });
});