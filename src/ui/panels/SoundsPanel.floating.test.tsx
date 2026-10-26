import { beforeEach, expect, it, vi } from "vitest";
import { getCtx } from "../../audio/core";
import { useFloatingAudio } from "../../audio/floatingControls";
import { mixerStore } from "../../audio/mixer";
import { nowPlaying } from "../../audio/radio";
import { settings } from "../../state/settings";
import { SoundsPanel } from "./SoundsPanel";
const hooks = vi.hoisted(() => ({ state: [] as unknown[], refs: [] as { current: unknown }[], stateIndex: 0, refIndex: 0 }));
vi.mock("react", async original => ({ ...await original<typeof import("react")>(),
  useSyncExternalStore: (_subscribe: unknown, get: () => unknown) => get(),
  useEffect: vi.fn(),
  useRef: (value: unknown) => { const i = hooks.refIndex++; return hooks.refs[i] ??= { current: value }; },
  useState: (initial: unknown) => {
    const i = hooks.stateIndex++;
    if (!(i in hooks.state)) hooks.state[i] = typeof initial === "function" ? initial() : initial;
    return [hooks.state[i], (value: unknown) => { hooks.state[i] = value; }];
  },
}));
vi.mock("../../audio/core", () => ({ getCtx: vi.fn(), masterOut: vi.fn(), setMasterVolume: vi.fn() }));
vi.mock("../../audio/floatingControls", () => ({ useFloatingAudio: vi.fn() }));
const station = { provider: "YouTube", url: "https://www.youtube.com/embed/rFZHOHl-L8A?autoplay=1", name: "Lofi Girl" };
function render() {
  hooks.stateIndex = hooks.refIndex = 0;
  SoundsPanel({ open: false, onClose: vi.fn() });
  return vi.mocked(useFloatingAudio).mock.calls.at(-1)![0];
}
beforeEach(async () => {
  await Promise.all([settings.ready, mixerStore.ready]);
  mixerStore.set({ layers: [], mixes: [], favourites: [] });
  hooks.state = []; hooks.refs = [];
  vi.clearAllMocks();
});
it("pauses a selected embedded station while the panel is hidden and restores that source", () => {
  render();
  hooks.state[6] = station;
  nowPlaying.set("embed");
  let audio = render();
  expect(audio).toMatchObject({ playing: true, available: true });
  audio.toggle();
  expect(hooks.state[6]).toBeNull();
  expect(nowPlaying.get()).toBeNull();
  audio = render();
  expect(audio).toMatchObject({ playing: false, available: true });
  audio.toggle();
  expect(hooks.state[6]).toEqual(station);
  expect(nowPlaying.get()).toBe("embed");
  expect(getCtx).not.toHaveBeenCalled();
});
it("does not advertise playback or start audio when no source has been chosen", () => {
  expect(render()).toMatchObject({ playing: false, available: false });
  expect(getCtx).not.toHaveBeenCalled();
});
