import { afterEach, expect, it, vi } from "vitest";
import { localPreferences, localPreferencesUpdate, localPreferencesReady, settingsUpdate } from "../state/settings";
import { connectFloatingSettings, floatingWindowOpen } from "./floatingDesktop";
afterEach(() => vi.unstubAllGlobals());
it("restores persisted preferences and mirrors tray changes into the same settings", async () => {
  await localPreferencesReady;
  localPreferencesUpdate({ floatingTimer: true, floatingOnTop: false });
  let change!: (value: FloatingPreferences) => void;
  const send = vi.fn(async () => true), off = vi.fn();
  vi.stubGlobal("window", { desktop: { setFloatingPreferences: send, onFloatingPreferences: (fn: typeof change) => { change = fn; return off; } } });
  const disconnect = await connectFloatingSettings();
  expect(send).toHaveBeenLastCalledWith({ floatingTimer: true, floatingOnTop: false, menuBarTime: true, showMenuBar: true });
  change({ floatingTimer: false, floatingOnTop: true, menuBarTime: false, showMenuBar: false });
  expect(localPreferences.get()).toMatchObject({ floatingTimer: false, floatingOnTop: true, menuBarTime: false, showMenuBar: false });
  expect(send).toHaveBeenCalledTimes(2);
  settingsUpdate("extras", { displayName: "" });
  expect(send).toHaveBeenCalledTimes(2);
  disconnect();
  localPreferencesUpdate({ floatingTimer: true });
  expect(send).toHaveBeenCalledTimes(2);
  expect(off).toHaveBeenCalledOnce();
});
it("does not expose desktop preferences on web or in a mini renderer", async () => {
  vi.stubGlobal("window", {});
  await connectFloatingSettings();
  const send = vi.fn();
  vi.stubGlobal("window", { desktop: { mini: true, setFloatingPreferences: send } });
  await connectFloatingSettings();
  expect(send).not.toHaveBeenCalled();
});

it("tracks whether the floating window is open, separately from the saved setting", async () => {
  await localPreferencesReady;
  localPreferencesUpdate({ floatingTimer: false });
  let changed!: (open: boolean) => void;
  const offLive = vi.fn();
  vi.stubGlobal("window", { desktop: { setFloatingPreferences: vi.fn(async () => true), onFloatTimer: (fn: typeof changed) => { changed = fn; return offLive; } } });
  expect(floatingWindowOpen()).toBeNull();
  const disconnect = await connectFloatingSettings();
  changed(true);
  expect(floatingWindowOpen()).toBe(true);
  expect(localPreferences.get().floatingTimer).toBe(false);
  disconnect();
  expect(offLive).toHaveBeenCalledOnce();
  expect(floatingWindowOpen()).toBeNull();
});
