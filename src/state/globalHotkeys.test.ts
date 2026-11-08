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
const load = () => import("./globalHotkeys");
const key = (code: string, mods: Partial<Record<"ctrlKey" | "altKey" | "shiftKey" | "metaKey", boolean>> = {}) =>
  ({ code, ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, ...mods });

it("defaults every action to off and keeps the store out of sync", async () => {
  const h = await load();
  await h.globalHotkeys.ready;
  expect(h.globalHotkeys.get()).toEqual({ showApp: null, toggle: null, stop: null, skip: null });
  const { SYNC_KEYS } = await import("../lib/sync");
  expect(SYNC_KEYS).not.toContain("globalHotkeys");
});

it("sanitizes stored values to canonical shortcuts and drops unsafe ones", async () => {
  disk.set("globalHotkeys", { showApp: "Command+Control+K", toggle: "Command+K", stop: 7, skip: "Alt+F5", extra: "Control+Alt+X" });
  const h = await load();
  await h.globalHotkeys.ready;
  expect(h.globalHotkeys.get()).toEqual({ showApp: "Control+Command+K", toggle: null, stop: null, skip: "Alt+F5" });
});

it("records physical keys, ignoring the Option-shifted character", async () => {
  const h = await load();
  // ⌥⌘P types "π"; the code still says KeyP.
  expect(h.hotkeyFromEvent(key("KeyP", { altKey: true, ctrlKey: true }))).toBe("Control+Alt+P");
  expect(h.hotkeyFromEvent(key("Digit1", { shiftKey: true, metaKey: true }))).toBe("Shift+Command+1");
  expect(h.hotkeyFromEvent(key("ArrowRight", { ctrlKey: true, altKey: true }))).toBe("Control+Alt+Right");
  expect(h.hotkeyFromEvent(key("F6", { metaKey: true }))).toBe("Command+F6");
  expect(h.hotkeyFromEvent(key("AltLeft", { altKey: true }))).toBe("");
  expect(h.hotkeyFromEvent(key("MetaRight", { metaKey: true }))).toBe("");
  expect(h.hotkeyFromEvent(key("KeyK", { metaKey: true }))).toBeNull(); // one modifier would steal ⌘K everywhere
  expect(h.hotkeyFromEvent(key("KeyK"))).toBeNull();
  expect(h.hotkeyFromEvent(key("Enter", { ctrlKey: true, altKey: true }))).toBeNull();
  expect(h.formatHotkey("Control+Alt+Shift+Command+Space")).toBe("⌃⌥⇧⌘Space");
  expect(h.formatHotkey("Control+Alt+Up")).toBe("⌃⌥↑");
});

it("validates backup values strictly", async () => {
  const { validHotkeys } = await load();
  expect(validHotkeys({ showApp: null, toggle: "Control+Alt+T", stop: null, skip: null })).toBe(true);
  expect(validHotkeys({ toggle: "Control+Alt+T" })).toBe(true);
  expect(validHotkeys({ toggle: "Command+T" })).toBe(false);
  expect(validHotkeys({ toggle: "Alt+Control+T" })).toBe(false); // not canonical
  expect(validHotkeys({ bogus: null })).toBe(false);
  expect(validHotkeys([])).toBe(false);
  // An import can't hold states the recorder refuses.
  expect(validHotkeys({ showApp: "Control+Alt+K", toggle: "Control+Alt+K" })).toBe(false);
  expect(validHotkeys({ toggle: "Shift+Command+R" })).toBe(false); // Reset in the Timer menu
  expect(validHotkeys({ toggle: "Shift+Command+Z" })).toBe(false); // Redo
});

it("drops reserved and duplicate shortcuts from saved data, keeping the first holder", async () => {
  disk.set("globalHotkeys", { showApp: "Control+Alt+K", toggle: "Alt+Control+K", stop: "Shift+Command+T", skip: "Control+Alt+N" });
  const h = await load();
  await h.globalHotkeys.ready;
  expect(h.globalHotkeys.get()).toEqual({ showApp: "Control+Alt+K", toggle: null, stop: null, skip: "Control+Alt+N" });
});

it("retries a shortcut another app held when Kitestring comes forward", async () => {
  const h = await load();
  let taken = true;
  const setGlobalHotkeys = vi.fn(async () => ({ showApp: "off", toggle: taken ? "taken" : "ok", stop: "off", skip: "off" } as const));
  const listeners = new Map<string, () => void>();
  vi.stubGlobal("window", { desktop: { setGlobalHotkeys }, addEventListener: (type: string, fn: () => void) => listeners.set(type, fn), removeEventListener: (type: string) => listeners.delete(type) });
  h.globalHotkeys.set(current => ({ ...current, toggle: "Control+Alt+T" }));
  const off = await h.connectGlobalHotkeys();
  await vi.waitFor(() => expect(h.hotkeyStatus.get()?.toggle).toBe("taken"));
  taken = false;
  listeners.get("focus")!();
  await vi.waitFor(() => expect(h.hotkeyStatus.get()?.toggle).toBe("ok"));
  expect(setGlobalHotkeys).toHaveBeenCalledTimes(2);
  listeners.get("focus")!(); // nothing taken now: no extra call
  expect(setGlobalHotkeys).toHaveBeenCalledTimes(2);
  off();
  expect(listeners.has("focus")).toBe(false);
});

it("publishes saved shortcuts to the Mac bridge on start and on change, and keeps the latest status", async () => {
  const h = await load();
  const calls: unknown[] = [];
  const setGlobalHotkeys = vi.fn(async (value: Record<string, string | null>) => {
    calls.push(value);
    return { showApp: "off", toggle: value.toggle ? "ok" : "off", stop: "off", skip: "off" } as const;
  });
  vi.stubGlobal("window", { desktop: { setGlobalHotkeys } });
  const seen: unknown[] = [];
  h.hotkeyStatus.subscribe(status => seen.push(status));
  const off = await h.connectGlobalHotkeys();
  await vi.waitFor(() => expect(h.hotkeyStatus.get()?.toggle).toBe("off"));
  h.globalHotkeys.set(current => ({ ...current, toggle: "Control+Alt+T" }));
  await vi.waitFor(() => expect(h.hotkeyStatus.get()?.toggle).toBe("ok"));
  h.globalHotkeys.set(current => ({ ...current })); // same value: no extra call
  expect(calls).toEqual([
    { showApp: null, toggle: null, stop: null, skip: null },
    { showApp: null, toggle: "Control+Alt+T", stop: null, skip: null },
  ]);
  expect(seen).toHaveLength(2);
  off();
});

it("does nothing on the web or in the mini timer", async () => {
  const h = await load();
  for (const win of [{}, { desktop: { mini: true, setGlobalHotkeys: vi.fn() } }]) {
    vi.stubGlobal("window", win);
    const off = await h.connectGlobalHotkeys();
    off();
  }
  expect(h.hotkeyStatus.get()).toBeNull();
});

it("unregisters every shortcut while one is being recorded, then restores them", async () => {
  const h = await load();
  const calls: unknown[] = [];
  const setGlobalHotkeys = vi.fn(async (value: Record<string, string | null>) => {
    calls.push(value);
    return { showApp: "off", toggle: "off", stop: value.stop ? "ok" : "off", skip: "off" } as const;
  });
  vi.stubGlobal("window", { desktop: { setGlobalHotkeys } });
  h.globalHotkeys.set(current => ({ ...current, stop: "Control+Alt+S" }));
  const off = await h.connectGlobalHotkeys();
  await vi.waitFor(() => expect(h.hotkeyStatus.get()?.stop).toBe("ok"));
  h.pauseGlobalHotkeys(true);
  h.pauseGlobalHotkeys(true); // repeat is a no-op
  await vi.waitFor(() => expect(calls).toHaveLength(2));
  expect(calls[1]).toEqual({ showApp: null, toggle: null, stop: null, skip: null, recording: true });
  await Promise.resolve();
  expect(h.hotkeyStatus.get()?.stop).toBe("ok"); // the paused "off" answer isn't shown
  h.pauseGlobalHotkeys(false);
  await vi.waitFor(() => expect(calls).toHaveLength(3));
  expect(calls[2]).toEqual({ showApp: null, toggle: null, stop: "Control+Alt+S", skip: null });
  off();
});
