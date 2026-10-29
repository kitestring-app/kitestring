import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { applySyncedValue, flushAll, mergeDefaults, storeValue } from "../lib/store";
import { dbGet, dbSet } from "../lib/db";
import { BACKUP_FORMAT, createBackup, parseBackup } from "../lib/backup";
import { EMPTY_NOTES, isNotesValue, migrateNotes } from "./notesModel";
import { notes, setInterruptionPrompt, setNotesText } from "./notes";
import { settings } from "./settings";
const backup = (data: unknown) => JSON.stringify({ format: BACKUP_FORMAT, version: 1, data });
beforeEach(async () => { await notes.ready; notes.set(EMPTY_NOTES); });
describe("plain-string notes", () => {
  it("keeps every character of legacy notes, including whitespace, markup and controls", () => {
    const text = " \r\n<script>alert('hi')</script> **old text**\n\t\u0000 ";
    expect(migrateNotes(text)).toBe(text);
    expect(parseBackup(backup({ notes: text })).data.notes).toBe(text);
    const longLegacy = "x".repeat(1_000_001);
    expect(migrateNotes(migrateNotes(longLegacy))).toBe(longLegacy);
  });
  it.each([
    { version: 1, format: "markdown", text: "keep me\n- [x] done", interruptionPrompt: false },
    { version: 1, format: "markdown", text: "secret notes" },
    { version: 42, text: "future text", interruptionPrompt: true },
    { text: "  \r\n\t" },
    { text: "" },
  ])("recovers object text without requiring a version or prompt flag: %j", value => {
    expect(migrateNotes(value)).toBe(value.text);
    expect(parseBackup(backup({ notes: value })).data.notes).toBe(value.text);
  });
  it("autosaves and exports a string that the old build reads unchanged", async () => {
    const text = "## Plan\n- [ ] Write **draft**";
    setNotesText(text); setInterruptionPrompt(false);
    await flushAll();
    expect(await dbGet("notes")).toBe(text);
    expect(storeValue("notes")).toBe(text);
    expect(mergeDefaults("", storeValue("notes"))).toBe(text);
    expect(settings.get().timer.interruptionPrompt).toBe(false);
    const saved = JSON.parse(await createBackup());
    expect(saved.data.notes).toBe(text);
    expect(saved.data.settings.timer.interruptionPrompt).toBe(false);
  });
  it("accepts old and temporary-object synced notes, including missing flags", async () => {
    for (const value of ["  older notes\n", { text: "keep me", interruptionPrompt: false }, { text: "missing flag" }, { version: 99, text: "newer field" }, ""]) {
      await applySyncedValue("notes", value);
      const text = typeof value === "string" ? value : value.text;
      expect(notes.get()).toBe(text);
      expect(await dbGet("notes")).toBe(text);
    }
  });
  it("hydrates old IndexedDB strings and objects without losing characters", async () => {
    const { createStore } = await import("../lib/store");
    for (const value of ["\n  original\r\n", { text: "original without flag" }]) {
      await dbSet("notes-migration-test", value);
      const restored = createStore("notes-migration-test", EMPTY_NOTES, migrateNotes);
      await restored.ready;
      expect(restored.get()).toBe(typeof value === "string" ? value : value.text);
    }
  });
  it("imports a legacy preference into settings and honors an explicit new setting", () => {
    const value = { text: "keep me", interruptionPrompt: false };
    const result = parseBackup(backup({ notes: value }));
    expect(result.data.notes).toBe("keep me");
    expect(result.data.settings).toMatchObject({ timer: { interruptionPrompt: false } });
    const explicit = parseBackup(backup({ notes: value, settings: { timer: { interruptionPrompt: true } } }));
    expect(explicit.data.settings).toMatchObject({ timer: { interruptionPrompt: true } });
    expect(parseBackup(backup({ notes: { text: "no flag" } })).data).toEqual({ notes: "no flag" });
  });
  it("rejects unreadable values without overwriting existing notes", async () => {
    setNotesText("original"); await flushAll();
    for (const value of [null, [], { text: 1 }, { text: "x".repeat(1_000_001) }]) {
      expect(isNotesValue(value)).toBe(false);
      expect(() => parseBackup(backup({ notes: value }))).toThrow(/notes/);
      await expect(applySyncedValue("notes", value)).rejects.toThrow(/notes/);
      expect(notes.get()).toBe("original");
      expect(await dbGet("notes")).toBe("original");
    }
    expect(() => parseBackup(backup({ notes: "x".repeat(1_000_001) }))).toThrow(/notes/);
  });
});

it("N5: explanation appends to the latest notes durably and travels only with Focus data", async () => {
  const { appendRecall } = await import("./notes");
  setNotesText("Original\nNewer edit"); await flushAll();
  await appendRecall("A concept in my own words");
  const expected = "Original\nNewer edit\n\n## Explain from memory\nA concept in my own words";
  expect(notes.get()).toBe(expected); expect(await dbGet("notes")).toBe(expected);
  const b = await import("../lib/backup");
  expect(JSON.parse(await b.createBackup({ sections: ["focus"] })).data.notes).toBe(expected);
  expect(JSON.parse(await b.createBackup({ sections: [] })).data).not.toHaveProperty("notes");
});
it("N5: blank and over-cap explanations leave Notes intact", async () => {
  const { appendRecall } = await import("./notes");
  setNotesText("x".repeat(999_990)); await flushAll(); const previous = notes.get();
  for (const text of ["   ", "an explanation that does not fit"]) await expect(appendRecall(text)).rejects.toThrow();
  expect(notes.get()).toBe(previous); expect(await dbGet("notes")).toBe(previous);
});
it.each(["QuotaExceededError", "AbortError", "UnknownError"])("N5: %s keeps saved notes and permits retry", async name => {
  const { vi } = await import("vitest"); const db = await import("../lib/db"); const { appendRecall } = await import("./notes");
  setNotesText("Keep"); await flushAll();
  const fail = vi.spyOn(db, "dbSetMany").mockRejectedValueOnce(new DOMException("Could not save", name));
  await expect(appendRecall("Explanation")).rejects.toThrow(); fail.mockRestore();
  expect(notes.get()).toBe("Keep"); expect(await dbGet("notes")).toBe("Keep");
  await appendRecall("Explanation"); expect(notes.get()).toBe("Keep\n\n## Explain from memory\nExplanation");
});
it("N5: an edit during append wins and rejects the append for explicit retry", async () => {
  const { vi } = await import("vitest"); const db = await import("../lib/db"); const { appendRecall } = await import("./notes");
  setNotesText("Before"); await flushAll();
  const original = db.dbSetMany; let edited = false;
  const race = vi.spyOn(db, "dbSetMany").mockImplementation(async (...args) => {
    if (!edited) { edited = true; setNotesText("Concurrent edit"); }
    return original(...args);
  });
  await expect(appendRecall("Explanation")).rejects.toThrow(/changed/i); race.mockRestore();
  expect(notes.get()).toBe("Concurrent edit"); expect(await dbGet("notes")).toBe("Concurrent edit");
  await appendRecall("Explanation"); expect(notes.get()).toBe("Concurrent edit\n\n## Explain from memory\nExplanation");
});
