import "fake-indexeddb/auto";
import { beforeEach, expect, it, vi } from "vitest";

beforeEach(async () => {
  vi.resetModules();
  const { dbDel, dbKeys } = await import("../lib/db");
  for (const key of await dbKeys()) await dbDel(key);
});

it.each([true, false, undefined])("recovers local dev text and migrates prompt %s once", async flag => {
  const { dbGet, dbSet } = await import("../lib/db");
  await dbSet("notes", { version: 2, text: "secret notes\n- [x] done", ...(flag === undefined ? {} : { interruptionPrompt: flag }) });
  const { notes, setInterruptionPrompt } = await import("./notes");
  const { settings } = await import("./settings");
  const { applySyncedValue, flushReadyStores } = await import("../lib/store");
  await notes.ready; await flushReadyStores();
  expect(notes.get()).toBe("secret notes\n- [x] done");
  expect(await dbGet("notes")).toBe(notes.get());
  expect(settings.get().timer.interruptionPrompt).toBe(flag ?? true);
  if (flag !== undefined) expect(await dbGet("settings")).toMatchObject({ timer: { interruptionPrompt: flag } });
  setInterruptionPrompt(!(flag ?? true));
  await applySyncedValue("notes", { text: "same object again", interruptionPrompt: flag ?? true });
  await flushReadyStores();
  expect(settings.get().timer.interruptionPrompt).toBe(!(flag ?? true));
});

it("keeps an explicit saved setting over a temporary object's preference", async () => {
  const { dbSet } = await import("../lib/db");
  await dbSet("settings", { timer: { interruptionPrompt: true, longEvery: 6 } });
  await dbSet("notes", { text: "keep me", interruptionPrompt: false });
  const { notes } = await import("./notes");
  const { settings } = await import("./settings");
  await notes.ready;
  expect(notes.get()).toBe("keep me");
  expect(settings.get().timer).toMatchObject({ interruptionPrompt: true, longEvery: 6 });
});
