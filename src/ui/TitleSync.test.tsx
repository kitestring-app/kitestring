import { beforeEach, expect, it, vi } from "vitest";
const hooks = vi.hoisted(() => ({ effects: [] as (() => void)[], view: { hiddenTime: false, mode: "pomodoro", state: { segment: "focus" }, display: "04:32", running: true, elapsed: 28_000, remaining: 272_000, total: 300_000 } }));
vi.mock("react", async original => ({ ...await original<typeof import("react")>(), useEffect: (fn: () => void) => hooks.effects.push(fn), useSyncExternalStore: (_: unknown, get: () => unknown) => get() }));
vi.mock("../state/timer", () => ({ useTimerView: () => hooks.view }));
import { TitleSync } from "./TitleSync";
import { settings, DEFAULT_SETTINGS, localPreferences, DEFAULT_LOCAL_PREFERENCES } from "../state/settings";
import { boundaryAlert } from "../audio/boundaryAlert";
import { DEFAULT_MENU_BAR_TEXT, menuBarText } from "../state/menuBar";
import { intent } from "../state/intent";
import { focusPick, tasks } from "../state/tasks";
import { EMPTY_INTENT } from "../lib/intent";
const setStatus = vi.fn(), publishTimerState = vi.fn();
beforeEach(async () => {
  await settings.ready; settings.set(DEFAULT_SETTINGS); menuBarText.set(DEFAULT_MENU_BAR_TEXT); localPreferences.set({ ...DEFAULT_LOCAL_PREFERENCES, migrated: true }); tasks.set([]); focusPick.set(null); intent.set({ ...EMPTY_INTENT }); hooks.effects = []; vi.clearAllMocks();
  vi.stubGlobal("document", {}); vi.stubGlobal("window", { desktop: { setStatus, publishTimerState } });
  hooks.view.hiddenTime = false; hooks.view.state.segment = "focus"; hooks.view.running = true; hooks.view.elapsed = 28_000;
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

it.each(["focus", "short", "long"])("hidden %s time keeps segment and status in title and menu bar, even idle", segment => {
  hooks.view.hiddenTime = true; hooks.view.state.segment = segment;
  for (const running of [true, false]) for (const elapsed of [0, 28000]) {
    hooks.view.running = running; hooks.view.elapsed = elapsed; render();
    const label = { focus: "Focus", short: "Short break", long: "Long break" }[segment as "focus" | "short" | "long"];
    const text = `${label} · ${running ? "Running" : "Paused"}`;
    expect(document.title).toBe(text); expect(setStatus).toHaveBeenLastCalledWith(text);
  }
});

it("opt-in task name prefers the pinned next action over the current task", () => {
  menuBarText.set({ ...DEFAULT_MENU_BAR_TEXT, task: true, seconds: false });
  tasks.set([{ id: "t1", title: "Draft the outline", done: false, createdAt: 1 }]);
  render(); expect(setStatus).toHaveBeenLastCalledWith("5m · Draft the outline");
  intent.set({ ...EMPTY_INTENT, action: "Write two paragraphs" });
  render(); expect(setStatus).toHaveBeenLastCalledWith("5m · Write two paragraphs");
  expect(document.title).toBe("04:32 · Focus");
});

it("keeps the task name out of the tooltip while menu-bar text is off", () => {
  menuBarText.set({ ...DEFAULT_MENU_BAR_TEXT, task: true });
  tasks.set([{ id: "t1", title: "Draft the outline", done: false, createdAt: 1 }]);
  for (const off of [{ menuBarTime: false }, { showMenuBar: false }]) {
    localPreferences.set({ ...DEFAULT_LOCAL_PREFERENCES, migrated: true, ...off });
    render(); expect(setStatus).toHaveBeenLastCalledWith("Focus 04:32");
  }
});
