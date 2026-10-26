import { afterEach, beforeEach, expect, it, vi } from "vitest";
const disk = vi.hoisted(() => new Map<string, unknown>());
vi.mock("../lib/db", () => ({
  dbGet: async (key: string) => structuredClone(disk.get(key)),
  dbSetMany: async (entries: [string, unknown][]) => { for (const [key, value] of entries) disk.set(key, structuredClone(value)); },
  dbSet: async (key: string, value: unknown) => { disk.set(key, structuredClone(value)); },
  storageMode: () => "indexeddb",
}));
beforeEach(() => { vi.resetModules(); disk.clear(); vi.stubGlobal("BroadcastChannel", undefined); });
afterEach(() => vi.unstubAllGlobals());
const oldExtras = { floatingTimer: true, floatingOnTop: false, menuBarTime: false, showMenuBar: false };
async function launch() {
  const state = await import("./settings");
  await state.localPreferencesReady;
  return { ...state, ...await import("../lib/store") };
}
it("migrates saved Mac preferences once, strips synced settings and preserves local state across old-client receives and relaunch", async () => {
  disk.set("settings", { extras: { ...oldExtras, displayName: "Saved" } });
  let s = await launch();
  expect(s.localPreferences.get()).toMatchObject({ ...oldExtras, migrated: true });
  expect(s.settings.get().extras.displayName).toBe("Saved");
  for (const key of Object.keys(oldExtras)) expect(s.settings.get().extras).not.toHaveProperty(key);
  const { SYNC_KEYS } = await import("../lib/sync");
  expect(SYNC_KEYS).not.toContain(s.localPreferences.key);
  s.localPreferencesUpdate({ showMenuBar: true, floatingOnTop: true });
  await s.applyRemote("settings", { extras: { floatingTimer: false, showMenuBar: false, floatingOnTop: false } });
  await s.applyRemote("settings", {}); // older clients missing every device preference
  expect(s.localPreferences.get()).toMatchObject({ ...oldExtras, showMenuBar: true, floatingOnTop: true });
  await s.flushAll();
  // An old build can write legacy keys back to disk. The migration marker wins.
  disk.set("settings", { extras: oldExtras });
  vi.resetModules();
  s = await launch();
  expect(s.localPreferences.get()).toMatchObject({ ...oldExtras, showMenuBar: true, floatingOnTop: true });
  await s.flushAll();
});
it("persists mute without changing the synced master level, including a relaunch and remote settings", async () => {
  let s = await launch();
  s.settingsUpdate("sounds", { master: 0.43 });
  s.localPreferencesUpdate({ muted: true });
  await s.flushAll();
  expect(disk.get("settings")).toMatchObject({ sounds: { master: 0.43 } });
  vi.resetModules();
  s = await launch();
  expect(s.localPreferences.get().muted).toBe(true);
  expect(s.settings.get().sounds.master).toBe(0.43);
  await s.applyRemote("settings", { sounds: { master: 0.61 }, extras: oldExtras });
  expect(s.localPreferences.get().muted).toBe(true);
  s.localPreferencesUpdate({ muted: false });
  expect(s.settings.get().sounds.master).toBe(0.61);
  await s.flushAll();
});
it("uses defaults for invalid legacy fields and preserves valid false values", async () => {
  disk.set("settings", { extras: { ...oldExtras, floatingTimer: "true", menuBarTime: null } });
  const s = await launch();
  expect(s.localPreferences.get()).toMatchObject({ floatingTimer: false, floatingOnTop: false, menuBarTime: true, showMenuBar: false });
  await s.flushAll();
});
