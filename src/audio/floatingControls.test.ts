import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { localPreferences, localPreferencesReady, localPreferencesUpdate, settings, settingsUpdate, DEFAULT_SETTINGS } from "../state/settings";
import { radioPlayer } from "./radio";
import { useFloatingAudio } from "./floatingControls";
const cleanups: (() => void)[] = [];
vi.mock("react", async original => ({
  ...await original<typeof import("react")>(),
  useRef: (current: unknown) => ({ current }),
  useEffect: (effect: () => (() => void) | void) => { const cleanup = effect(); if (cleanup) cleanups.push(cleanup); },
}));
let command: (value: FloatingAudioCommand) => void;
let request: () => void;
const publish = vi.fn(), unsubscribe = vi.fn();
beforeEach(async () => {
  await localPreferencesReady;
  localPreferencesUpdate({ muted: false });
  settings.set(DEFAULT_SETTINGS);
  radioPlayer.state.set({ stationId: null, status: "idle", track: null, error: "" });
  vi.stubGlobal("window", { desktop: {
    publishAudioState: publish,
    onAudioAction: (fn: typeof command) => { command = fn; return unsubscribe; },
    onAudioRequest: (fn: typeof request) => { request = fn; return unsubscribe; },
  } });
  publish.mockClear();
});
afterEach(() => { cleanups.splice(0).forEach(fn => fn()); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
it("changes the shared volume, restores the last audible level, and answers a newly opened mini", () => {
  useFloatingAudio({ playing: false, available: false, toggle: vi.fn() });
  command({ action: "volume", value: 0.35 });
  expect(settings.get().sounds.master).toBe(0.35);
  command({ action: "mute" });
  expect(settings.get().sounds.master).toBe(0.35);
  expect(localPreferences.get().muted).toBe(true);
  expect(publish).toHaveBeenLastCalledWith({ volume: 0.35, muted: true, playing: false, available: false });
  command({ action: "mute" });
  expect(settings.get().sounds.master).toBe(0.35);
  settingsUpdate("sounds", { master: 0.6 });
  request();
  expect(publish).toHaveBeenLastCalledWith({ volume: 0.6, muted: false, playing: false, available: false });
});
it("pauses and resumes the main-window mix and radio together", () => {
  const mix = { playing: true, available: true, toggle: () => { mix.playing = !mix.playing; } };
  radioPlayer.state.set({ stationId: "nightride", status: "playing", track: null, error: "" });
  const pause = vi.spyOn(radioPlayer, "pause").mockImplementation(() => { radioPlayer.state.set(s => ({ ...s, status: "paused" })); });
  const toggle = vi.spyOn(radioPlayer, "toggle").mockImplementation(() => {});
  useFloatingAudio(mix);
  command({ action: "toggle" });
  expect(mix.playing).toBe(false);
  expect(pause).toHaveBeenCalledOnce();
  command({ action: "toggle" });
  expect(mix.playing).toBe(true);
  expect(toggle).toHaveBeenCalledExactlyOnceWith("nightride");
});
it("does not start a source when none has been selected", () => {
  const toggle = vi.fn();
  useFloatingAudio({ playing: false, available: false, toggle });
  command({ action: "toggle" });
  expect(toggle).not.toHaveBeenCalled();
});

it("retains mute and the saved master when the audio controller remounts", () => {
  settingsUpdate("sounds", { master: 0.42 });
  useFloatingAudio({ playing: false, available: false, toggle: vi.fn() });
  command({ action: "mute" });
  cleanups.splice(0).forEach(fn => fn());
  useFloatingAudio({ playing: false, available: false, toggle: vi.fn() });
  request();
  expect(publish).toHaveBeenLastCalledWith({ volume: 0.42, muted: true, playing: false, available: false });
  command({ action: "mute" });
  expect(settings.get().sounds.master).toBe(0.42);
  expect(localPreferences.get().muted).toBe(false);
});
