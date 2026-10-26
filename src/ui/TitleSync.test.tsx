import { beforeEach, expect, it, vi } from "vitest";
const hooks = vi.hoisted(() => ({ effects: [] as (() => void)[], view: { mode: "pomodoro", state: { segment: "focus" }, display: "04:32", running: true, elapsed: 28_000 } }));
vi.mock("react", async original => ({ ...await original<typeof import("react")>(), useEffect: (fn: () => void) => hooks.effects.push(fn), useSyncExternalStore: (_: unknown, get: () => unknown) => get() }));
vi.mock("../state/timer", () => ({ useTimerView: () => hooks.view }));
import { TitleSync } from "./TitleSync";
import { settings, DEFAULT_SETTINGS } from "../state/settings";
import { boundaryAlert } from "../audio/boundaryAlert";
const setStatus = vi.fn(), publishTimerState = vi.fn();
beforeEach(async () => {
  await settings.ready; settings.set(DEFAULT_SETTINGS); hooks.effects = []; vi.clearAllMocks();
  vi.stubGlobal("document", {}); vi.stubGlobal("window", { desktop: { setStatus, publishTimerState } });
  hooks.view.state.segment = "focus"; hooks.view.running = true; hooks.view.elapsed = 28_000;
});
function render() { hooks.effects = []; TitleSync(); hooks.effects.forEach(fn => fn()); }
it.each(["focus", "short", "long"])("publishes the running %s segment and its time", segment => {
  hooks.view.state.segment = segment; render();
  expect(setStatus).toHaveBeenLastCalledWith(segment === "focus" ? "Focus 04:32" : "Break 04:32");
  expect(publishTimerState).toHaveBeenLastCalledWith({ segment, running: true, hasProgress: true, ringing: boundaryAlert.get().ringing, sounding: boundaryAlert.get().sounding, hardLocked: false });
});
it("removes menu-bar time when numbers are hidden and reports a paused break", () => {
  settings.set({ ...DEFAULT_SETTINGS, timer: { ...DEFAULT_SETTINGS.timer, showNumbers: false } });
  hooks.view.state.segment = "long"; hooks.view.running = false; render();
  expect(setStatus).toHaveBeenLastCalledWith("Break (paused)");
  expect(publishTimerState).toHaveBeenLastCalledWith(expect.objectContaining({ running: false, segment: "long" }));
});

it.each(["focus", "short", "long"])("keeps the idle %s tray icon free of text", segment => {
  hooks.view.state.segment = segment; hooks.view.running = false; hooks.view.elapsed = 0;
  render(); expect(setStatus).toHaveBeenLastCalledWith("");
});
