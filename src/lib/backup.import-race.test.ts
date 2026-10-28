import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { IDBFactory } from "fake-indexeddb";

vi.mock("../audio/core", () => ({ cancelAllChimes: vi.fn(), playTimerTick: vi.fn(), cancelChime: vi.fn(), cancelEnd: vi.fn(), releaseChime: vi.fn(), scheduleChime: vi.fn(), scheduleEnd: vi.fn() }));
vi.mock("../audio/companion", () => ({ armCompanionWithSpeech: vi.fn().mockResolvedValue(false), cancelCompanionSpeech: vi.fn(), companionAvailable: vi.fn().mockResolvedValue(false), companionKnownUp: vi.fn(() => false), disarmCompanion: vi.fn() }));

beforeEach(() => {
  vi.resetModules();
  vi.stubGlobal("indexedDB", new IDBFactory());
  vi.stubGlobal("BroadcastChannel", undefined);
  vi.stubGlobal("navigator", {});
  vi.stubGlobal("window", { desktop: {}, addEventListener: vi.fn() });
  vi.stubGlobal("document", { addEventListener: vi.fn() });
  vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout", "setInterval", "clearInterval"] }); vi.setSystemTime(new Date(2026, 9, 27, 10));
});
afterEach(() => { vi.restoreAllMocks(); vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); });

async function setup() {
  const clock = await import("../state/timer");
  const { settings, calmFoundationReady } = await import("../state/settings");
  const { stats } = await import("../state/stats");
  const store = await import("./store");
  const db = await import("./db");
  const backup = await import("./backup");
  await Promise.all([clock.timerHydrationReady, calmFoundationReady, stats.ready]);
  settings.set({ ...settings.get(), timer: { ...settings.get().timer, hardMode: false, autoRun: "off", interruptionPrompt: false } });
  const archive = { id: "archive-first-session", segId: "initial", kind: "focus" as const, segment: "focus" as const,
    start: Date.now() - 86_400_000, ms: 25 * 60_000, completed: true };
  const file = { data: { timer: { ...clock.timer.get(), segId: "file-timer", startedAt: null }, stats: { chunks: [archive], tasksDone: [] } } };
  return { ...clock, ...store, ...db, ...backup, settings, stats, archive, file };
}
const stamp = async () => ["sync-meta", {}] as [string, unknown];

const imageBase64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aNc8AAAAASUVORK5CYII=";
const backupImage = { id: "imported", name: "Imported image", type: "image/png", base64: imageBase64 };
const imageBlob = () => new Blob([Uint8Array.from(atob(imageBase64), char => char.charCodeAt(0))], { type: "image/png" });
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

it("keeps uploads saved during image transcoding and metadata preparation in the import transaction", async () => {
  const m = await setup();
  const themes = await import("../data/themes"); await themes.customBgs.ready;
  const entered = deferred(), release = deferred(), blob = imageBlob();
  themes.customBgs.set([{ id: "before", name: "Existing", size: blob.size }]);
  await m.dbSet("custom-bg:before", blob);
  vi.spyOn(themes, "prepareBackground").mockImplementationOnce(async () => {
    entered.resolve(); await release.promise; return blob;
  });
  const upload = async (id: string) => {
    await m.dbSet(`custom-bg:${id}`, blob);
    themes.customBgs.set(items => [...items, { id, name: id, size: blob.size }]);
  };
  const restoring = m.restoreBackup({ sections: ["images"], data: {}, images: [backupImage] }, async () => {
    await upload("during-metadata"); return stamp();
  });
  await entered.promise;
  await upload("during-transcode");
  release.resolve();
  await restoring;
  const expected = ["before", "during-transcode", "during-metadata", "imported"];
  expect(themes.customBgs.get().map(item => item.id)).toEqual(expected);
  expect((await m.dbGet<{ id: string }[]>("customBgs"))?.map(item => item.id)).toEqual(expected);
  for (const id of expected) expect(await (await m.dbGet<Blob>(`custom-bg:${id}`))?.arrayBuffer()).toEqual(await blob.arrayBuffer());
});

it.each(["count", "bytes"])("rechecks the live background %s limit before publishing an import", async limit => {
  const m = await setup();
  const themes = await import("../data/themes"); await themes.customBgs.ready;
  vi.spyOn(themes, "prepareBackground").mockResolvedValue(imageBlob());
  const saved = Array.from({ length: limit === "count" ? themes.BACKGROUND_LIMITS.count : 1 }, (_, i) =>
    ({ id: `upload-${i}`, name: "Uploaded", size: limit === "bytes" ? themes.BACKGROUND_LIMITS.bytes : imageBlob().size }));
  await expect(m.restoreBackup({ sections: ["images"], data: {}, images: [backupImage] }, async () => {
    themes.customBgs.set(saved); await m.flushReadyStores(); return stamp();
  })).rejects.toThrow(/background limit/);
  expect(themes.customBgs.get()).toEqual(saved);
  expect(await m.dbGet("customBgs")).toEqual(saved);
  expect(await m.dbGet("custom-bg:imported")).toBeUndefined();
});

it.each([false, true])("exports the completed session and settled timer when a block ends during image encoding (Hard mode: %s)", async hardMode => {
  const m = await setup();
  m.settings.set({ ...m.settings.get(), timer: { ...m.settings.get().timer, hardMode, takeover: false } });
  m.timerActions.start();
  const original = m.timer.get(), total = m.totalMs()!;
  const themes = await import("../data/themes"); await themes.customBgs.ready;
  themes.customBgs.set([{ id: "saved", name: "Saved", size: imageBlob().size }]);
  await m.dbSet("custom-bg:saved", imageBlob());
  const entered = deferred(), release = deferred();
  vi.stubGlobal("createImageBitmap", vi.fn(async () => {
    entered.resolve(); await release.promise; return { close: vi.fn() };
  }));
  const exporting = m.createBackup({ sections: ["focus", "images"] });
  await entered.promise;
  vi.advanceTimersByTime(total); m.timerActions.complete(original.segId);
  expect(m.stats.get().chunks).toContainEqual(expect.objectContaining({ segId: original.segId, completed: true, ms: total }));
  expect(m.timer.get().startedAt).toBeNull();
  release.resolve();
  const exported = m.parseBackup(await exporting);
  expect(exported.data.stats).toEqual(m.stats.get());
  expect(exported.data.timer).toEqual(m.timer.get());
});

it("omits a Hard mode timer started during image encoding", async () => {
  const m = await setup();
  m.settings.set({ ...m.settings.get(), timer: { ...m.settings.get().timer, hardMode: true } });
  const themes = await import("../data/themes"); await themes.customBgs.ready;
  themes.customBgs.set([{ id: "saved", name: "Saved", size: imageBlob().size }]);
  await m.dbSet("custom-bg:saved", imageBlob());
  vi.stubGlobal("createImageBitmap", vi.fn(async () => {
    m.timerActions.start(); return { close: vi.fn() };
  }));
  const exported = m.parseBackup(await m.createBackup({ sections: ["focus", "images"] }));
  expect(m.hardModeLocked()).toBe(true);
  expect(exported.data).not.toHaveProperty("timer");
});

it("imports a legacy first session into a fresh mid-block profile without losing or doubling either session", async () => {
  const m = await setup();
  const freshId = m.timer.get().segId;
  m.timerActions.start(); vi.advanceTimersByTime(1000); m.timerActions.pause(); m.timerActions.start();
  vi.advanceTimersByTime(2000);
  expect(await m.restoreBackup(m.file, stamp)).toBe(true);
  m.timerActions.pause();
  // Re-importing the same file must replace the archive, preserving local credit once.
  expect(await m.restoreBackup(m.file, stamp)).toBe(true);
  await m.flushReadyStores();
  expect(m.stats.get().chunks).toContainEqual(m.archive);
  expect(freshId).not.toBe("initial");
  expect(m.stats.get().chunks.filter(c => c.segId === freshId).reduce((sum, c) => sum + c.ms, 0)).toBe(3000);
  expect(new Set(m.stats.get().chunks.map(c => c.id)).size).toBe(m.stats.get().chunks.length);
  expect(await m.dbGet("stats")).toEqual(m.stats.get());
});

it.each(["paused", "running", "follower promotion"])("migrates a pre-fix initial segment at hydration: %s", async mode => {
  const db = await import("./db"), engine = await import("../state/timerEngine");
  const local = { id: "local-first-credit", segId: "initial", kind: "focus", segment: "focus", start: Date.now() - 3000, ms: 1000, completed: false };
  await db.dbSetMany([
    ["timer", { ...engine.INITIAL_TIMER, elapsedBefore: 1000, creditedUpTo: 1000, startedAt: mode === "running" ? Date.now() - 2000 : null }],
    ["stats", { chunks: [local], tasksDone: [] }],
  ]);
  if (mode === "follower promotion") vi.stubGlobal("navigator", { locks: {} });
  const m = await setup();
  if (mode === "follower promotion") {
    expect(m.timer.get().segId).toBe("initial");
    await m.acquireTimerOwnership();
  }
  const id = m.timer.get().segId;
  expect(id).not.toBe("initial");
  expect(m.timer.get().creditedUpTo).toBe(1000);
  m.startTicker(); await Promise.resolve();
  expect(m.timer.get().reentry).toBeTruthy();
  expect(m.stats.get().chunks.filter(c => !c.away)).toEqual([{ ...local, segId: id }]);
  expect(m.stats.get().chunks.filter(c => c.away)).toMatchObject(mode === "running" ? [{ kind: "break", ms: 2000 }] : []);
  await m.flushReadyStores();
  expect((await m.dbGet<{ segId: string }>("timer"))?.segId).toBe(id);
  expect(await m.dbGet("stats")).toEqual(m.stats.get());
  expect(await m.restoreBackup(m.file, stamp)).toBe(true);
  m.timerActions.pause();
  expect(await m.restoreBackup(m.file, stamp)).toBe(true);
  expect(m.stats.get().chunks).toContainEqual(m.archive);
  expect(m.stats.get().chunks.filter(c => c.segId === id && c.kind === "focus").reduce((sum, c) => sum + c.ms, 0)).toBe(1000);
  expect(m.stats.get().chunks.filter(c => c.away)).toMatchObject(mode === "running" ? [{ ms: 2000, segId: id }] : []);
  expect(new Set(m.stats.get().chunks.map(c => c.id)).size).toBe(m.stats.get().chunks.length);
});

it.each(["complete", "stop", "skip", "reset"] as const)("preserves credit when %s changes the segment during import preparation", async action => {
  const m = await setup();
  m.timer.set({ ...m.timer.get(), segId: "local-run" });
  m.timerActions.start();
  const original = m.timer.get();
  const elapsed = action === "complete" ? m.totalMs()! : 2000;
  let localChunks: ReturnType<typeof m.stats.get>["chunks"] = [];
  expect(await m.restoreBackup(m.file, async () => {
    vi.advanceTimersByTime(elapsed);
    m.timerActions[action]();
    localChunks = m.stats.get().chunks;
    expect(m.timer.get().segId).not.toBe(original.segId);
    return stamp();
  })).toBe(true);
  expect(m.timer.get().segId).not.toBe("file-timer");
  expect(m.stats.get().chunks).toEqual([m.archive, ...localChunks]);
  expect(localChunks.reduce((sum, c) => sum + c.ms, 0)).toBe(elapsed);
  await m.flushReadyStores();
  expect(await m.dbGet("stats")).toEqual(m.stats.get());
  expect(await m.dbGet("timer")).toEqual(m.timer.get());
});

it("keeps a Hard mode completion and the auto-started break when the block ends during preparation", async () => {
  const m = await setup();
  m.settings.set({ ...m.settings.get(), timer: { ...m.settings.get().timer, hardMode: true, autoRun: "always" } });
  m.timerActions.start();
  const original = m.timer.get(), total = m.totalMs()!;
  await m.flushReadyStores();
  const write = vi.spyOn(await import("./db"), "dbSetMany");
  expect(await m.restoreBackup(m.file, async () => {
    vi.advanceTimersByTime(total); m.timerActions.complete(original.segId);
    return stamp();
  })).toBe(true);
  expect(m.timer.get()).toMatchObject({ segment: "short", startedAt: Date.now(), hardLocked: true });
  const completed = m.stats.get().chunks.find(c => c.segId === original.segId);
  expect(completed).toMatchObject({ ms: total, completed: true });
  expect(m.stats.get().chunks).toContainEqual(m.archive);
  const transaction = write.mock.calls.find(([entries]) => entries.some(([key]) => key === "sync-meta"))![0];
  expect(new Map(transaction).get("timer")).toEqual(m.timer.get());
  expect(new Map(transaction).get("stats")).toEqual(m.stats.get());
  expect(await m.dbGet("stats")).toEqual(m.stats.get());
  expect(await m.dbGet("timer")).toEqual(m.timer.get());
});

it("re-reads the owner's timer and all intervening segments after a queued write, before applying the transaction", async () => {
  const m = await setup();
  m.timer.set({ ...m.timer.get(), segId: "before-queue" });
  m.timerActions.start();
  await m.flushReadyStores();
  let release!: () => void, reached!: () => void, prepared!: () => void;
  const blocked = new Promise<void>(resolve => { release = resolve; });
  const entered = new Promise<void>(resolve => { reached = resolve; });
  const ready = new Promise<void>(resolve => { prepared = resolve; });
  const db = await import("./db"), write = db.dbSetMany;
  vi.spyOn(db, "dbSetMany").mockImplementationOnce(async entries => { reached(); await blocked; return write(entries); });
  const restoring = m.restoreBackup(m.file, async () => {
    const blocker = m.createStore("import-queue-test", 0); await blocker.ready;
    blocker.set(1); void m.flushAll(); await entered;
    prepared(); return stamp();
  });
  await ready;
  // Let metadata return and the restore reserve its position behind the blocked save.
  for (let i = 0; i < 10; i++) await Promise.resolve();
  vi.advanceTimersByTime(1000); m.timerActions.stop();
  m.timerActions.start(); vi.advanceTimersByTime(2000); m.timerActions.reset();
  m.timerActions.start(); vi.advanceTimersByTime(3000); m.timerActions.pause();
  const local = m.stats.get().chunks, current = m.timer.get();
  expect(local.reduce((sum, chunk) => sum + chunk.ms, 0)).toBe(6000);
  release();
  expect(await restoring).toBe(true);
  expect(m.stats.get().chunks).toEqual([m.archive, ...local]);
  expect(m.timer.get()).toEqual(current);
  await m.flushReadyStores();
  expect(await m.dbGet("stats")).toEqual(m.stats.get());
  expect(await m.dbGet("timer")).toEqual(current);
});

it("rolls back the prepared restore and preserves its timer-credit pair when the atomic write fails", async () => {
  const m = await setup();
  m.timerActions.start(); vi.advanceTimersByTime(2000); m.timerActions.pause();
  await m.flushReadyStores();
  const beforeTimer = m.timer.get(), beforeStats = m.stats.get();
  vi.spyOn(await import("./db"), "dbSetMany").mockRejectedValueOnce(new Error("Storage is full"));
  await expect(m.restoreBackup(m.file, stamp)).rejects.toThrow("Storage is full");
  expect(m.timer.get()).toEqual(beforeTimer);
  expect(m.stats.get()).toEqual(beforeStats);
  expect(await m.dbGet("timer")).toEqual(beforeTimer);
  expect(await m.dbGet("stats")).toEqual(beforeStats);
});
