import "fake-indexeddb/auto";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
beforeEach(async () => { vi.resetModules(); vi.stubGlobal("BroadcastChannel", undefined);
  const db = await import("../lib/db"); await db.dbSetMany([], await db.dbKeys()); });
afterEach(() => vi.unstubAllGlobals());
it("the action and why reload together and preserve reserved fields across edits and remote receives", async () => {
  let state = await import("./intent"); const store = await import("../lib/store"); await state.intent.ready;
  await store.applyRemote("intent", { action: "Open the file", why: "Send a draft", cue: "", reward: "", rev: 8, updatedAt: 100 });
  state.updateIntent({ why: "Send an outline" }); await store.flushReadyStores();
  const saved = structuredClone(state.intent.get());
  expect(saved).toMatchObject({ action: "Open the file", why: "Send an outline", cue: "", reward: "", rev: 9 });
  vi.resetModules(); state = await import("./intent"); await state.intent.ready;
  expect(state.intent.get()).toEqual(saved);
  state.updateIntent({ action: "", why: "" }); await (await import("../lib/store")).flushReadyStores();
  vi.resetModules(); state = await import("./intent"); await state.intent.ready;
  expect(state.intent.get()).toMatchObject({ action: "", why: "", rev: 10 });
});
it("rejects oversized or multiline edits without changing the saved document", async () => {
  const { intent, updateIntent } = await import("./intent"); await intent.ready;
  const before = intent.get();
  for (const action of ["x".repeat(501), "first\nsecond"]) expect(() => updateIntent({ action })).toThrow();
  expect(intent.get()).toBe(before);
});

it("C2: a slice-1 client preserves the reserved cue and reward when editing only the action or why", async () => {
  const { intent, updateIntent } = await import("./intent"); const { applyRemote, flushReadyStores } = await import("../lib/store");
  await intent.ready;
  await applyRemote("intent", { action: "Open draft", why: "Share", cue: "After lunch, open the draft", reward: "Tea outside", rev: 1, updatedAt: 100 });
  // The old editor supplied only these two fields. Its reserved-field parser and spread retain the others.
  updateIntent({ action: "Write the opening line", why: "Share an outline" }); await flushReadyStores();
  expect(intent.get()).toMatchObject({ cue: "After lunch, open the draft", reward: "Tea outside" });
});

it("cue and reward are single-line bounded text and revisions advance within the same clock tick", async () => {
  const { intent, updateIntent } = await import("./intent"); await intent.ready;
  for (const key of ["cue", "reward"] as const) {
    for (const value of ["x".repeat(501), "two\nlines"]) expect(() => updateIntent({ [key]: value })).toThrow();
  }
  updateIntent({ cue: "After lunch" }); const first = intent.get().updatedAt;
  updateIntent({ reward: "Tea" }); expect(intent.get().updatedAt).toBeGreaterThan(first);
});

it("N1: finish is bounded, stale edits keep it, and replacements and explicit finish clear it", async () => {
  const { intent, updateIntent, finishIntent } = await import("./intent"); await intent.ready;
  updateIntent({ action: "Draft", sufficientFinish: "Three paragraphs" }); const saved = intent.get();
  for (const sufficientFinish of ["x".repeat(501), "two\nlines"]) expect(() => updateIntent({ sufficientFinish })).toThrow();
  expect(() => updateIntent({ sufficientFinish: "Old" }, { rev: 0, updatedAt: 0 })).toThrow();
  expect(intent.get()).toEqual(saved);
  updateIntent({ why: "Share" }); expect(intent.get().sufficientFinish).toBe("Three paragraphs");
  updateIntent({ action: "Read" }); expect(intent.get().sufficientFinish).toBe("");
  updateIntent({ sufficientFinish: "One page" }); expect(finishIntent(intent.get())).toBe(true);
  expect(intent.get().sufficientFinish).toBe("");
});
