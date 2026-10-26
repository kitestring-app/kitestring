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
