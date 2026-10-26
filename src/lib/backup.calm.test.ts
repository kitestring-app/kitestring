import "fake-indexeddb/auto";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.hoisted(() => { vi.stubGlobal("navigator", {}); vi.stubGlobal("BroadcastChannel", undefined); });
const golden = readFileSync(new URL("./fixtures/backup-v1.json", import.meta.url), "utf8");
beforeEach(async () => {
  vi.resetModules(); vi.stubGlobal("BroadcastChannel", undefined);
  const db = await import("./db"); await db.dbSetMany([], await db.dbKeys());
  // A real saved profile prevents fresh initialization from racing a restore.
  await db.dbSet("settings", {});
});
afterEach(() => { vi.unstubAllGlobals(); });
it("V13: golden v1 import, export and re-import retain raw history, old chunks without segId, tasks, notes and settings", async () => {
  const backup = await import("./backup"); const settings = await import("../state/settings");
  await settings.calmFoundationReady;
  const parsed = backup.parseBackup(golden); expect(parsed.data).not.toHaveProperty("intent");
  const metadata = async () => ["sync-meta", {}] as [string, unknown];
  await backup.restoreBackup(parsed, metadata);
  const exported = backup.parseBackup(await backup.createBackup());
  for (const key of ["stats", "tasks", "notes", "focusPick", "mixer"] as const) expect(exported.data[key]).toEqual(parsed.data[key]);
  expect(exported.data.settings).toEqual(parsed.data.settings);
  expect(settings.settings.get()).toEqual(settings.sanitizeSettings(parsed.data.settings));
  await backup.restoreBackup(exported, metadata);
  const roundTrip = backup.parseBackup(await backup.createBackup()); expect(roundTrip.data).toEqual(exported.data);
});
it("V13: intent is additive, explicitly empty is valid and device restore points never export", async () => {
  const backup = await import("./backup"); const { intent, updateIntent } = await import("../state/intent");
  const s = await import("../state/settings"); await s.calmFoundationReady;
  await intent.ready; updateIntent({ action: "Saved text", why: "Independent of task deletion", cue: "After lunch, open the draft", reward: "Tea outside" });
  const exported = JSON.parse(await backup.createBackup());
  expect(exported.data.intent).toEqual(intent.get()); expect(exported.data).not.toHaveProperty(s.presetState.key);
  const empty = { action: "", why: "", rev: 2, updatedAt: Date.now() };
  const parsed = backup.parseBackup(JSON.stringify({ format: backup.BACKUP_FORMAT, version: 1, data: { intent: empty } }));
  await backup.restoreBackup(parsed, async () => ["sync-meta", {}]); expect(intent.get()).toEqual(empty);
  // Absence in a v1 backup preserves the independent next-action document.
  await backup.restoreBackup(backup.parseBackup(golden), async () => ["sync-meta", {}]); expect(intent.get()).toEqual(empty);
});
it.each([null, {}])("V13: rejects invalid or unsupported intent shape %j before writing", async intent => {
  const backup = await import("./backup");
  expect(() => backup.parseBackup(JSON.stringify({ format: backup.BACKUP_FORMAT, version: 1, data: { intent } }))).toThrow("invalid next action");
});

it("4: backup imports strip unknown intent fields while preserving all known fields", async () => {
  const backup = await import("./backup");
  const known = { action: "Draft", why: "Share", cue: "", reward: "", rev: 1, updatedAt: 0 };
  const parsed = backup.parseBackup(JSON.stringify({ format: backup.BACKUP_FORMAT, version: 1, data: { intent: { ...known, futureSchema: true } } }));
  expect(parsed.data.intent).toEqual(known);
  await backup.restoreBackup(parsed, async () => ["sync-meta", {}]);
  expect((await import("../state/intent")).intent.get()).toEqual(known);
});

it("C6: filled cue/reward round-trip, while device-only progress, cursor and acknowledgement stay out", async () => {
  const backup = await import("./backup"); const { intent, updateIntent, rewardMoment } = await import("../state/intent");
  const { tinyStarts } = await import("../state/tinyStarts"); const { parkingReview } = await import("../state/parkingReview");
  await (await import("../state/settings")).calmFoundationReady;
  await Promise.all([intent.ready, rewardMoment.ready, tinyStarts.ready, parkingReview.ready]);
  updateIntent({ action: "Draft", cue: "After lunch, open the draft", reward: "Tea outside" });
  const original = structuredClone(intent.get());
  const exported = backup.parseBackup(await backup.createBackup());
  expect(exported.data.intent).toEqual(original);
  for (const key of ["tinyStarts", "parkingReview", "rewardMoment"]) expect(exported.data).not.toHaveProperty(key);
  updateIntent({ action: "Other", cue: "Other cue", reward: "Other reward" });
  await backup.restoreBackup(exported, async () => ["sync-meta", {}]); expect(intent.get()).toEqual(original);
  await backup.restoreBackup(backup.parseBackup(golden), async () => ["sync-meta", {}]); expect(intent.get()).toEqual(original);
});
