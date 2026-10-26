import { Children, isValidElement, type ReactElement, type ReactNode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import App from "./App";
import { boundaryAlert } from "./audio/boundaryAlert";
import { localPreferencesReady, settings, DEFAULT_SETTINGS } from "./state/settings";
import { SettingsDrawer } from "./ui/settings/SettingsDrawer";
import { startTicker, timer, timerActions } from "./state/timer";
const hooks = vi.hoisted(() => ({ state: [] as unknown[], refs: [] as { current: unknown }[], effects: [] as (() => unknown)[], stateIndex: 0, refIndex: 0 }));
vi.mock("react", async original => ({ ...await original<typeof import("react")>(),
  useSyncExternalStore: (_subscribe: unknown, get: () => unknown) => get(),
  useEffect: (effect: () => unknown) => { hooks.effects.push(effect); },
  useRef: (value: unknown) => { const i = hooks.refIndex++; return hooks.refs[i] ??= { current: value }; },
  useState: (initial: unknown) => {
    const i = hooks.stateIndex++;
    if (!(i in hooks.state)) hooks.state[i] = initial;
    return [hooks.state[i], (next: unknown) => { hooks.state[i] = typeof next === "function" ? next(hooks.state[i]) : next; }];
  },
}));
vi.mock("./lib/sync", () => ({ syncStatus: { subscribe: vi.fn(), get: () => ({ state: "off" }) } }));
vi.mock("./state/timer", () => ({ recoveryOffer: () => null, timer: { get: vi.fn(() => ({ startedAt: null, elapsedBefore: 0 })) }, timerActions: { toggle: vi.fn(), reset: vi.fn(), skip: vi.fn(), stopSound: vi.fn() }, startTicker: vi.fn() }));
vi.mock("./ui/useExtras", () => ({ useExtras: () => false }));
vi.mock("./ui/panels/SoundsPanel", () => ({ SoundsPanel: () => null }));
let command: (command: DesktopMenuCommand) => void;
const off = vi.fn();
function elements(node: ReactNode): ReactElement<{ children?: ReactNode; initialTab?: string; "aria-label"?: string }>[] {
  return Children.toArray(node).flatMap(child => isValidElement<{ children?: ReactNode }>(child) ? [child, ...elements(child.props.children)] : []);
}
function render() { hooks.stateIndex = hooks.refIndex = 0; return elements(App()); }
beforeEach(async () => {
  await localPreferencesReady;
  hooks.state = []; hooks.refs = []; hooks.effects = [];
  vi.clearAllMocks();
  settings.set(DEFAULT_SETTINGS);
  vi.stubGlobal("document", { querySelectorAll: () => [] });
  vi.stubGlobal("window", { desktop: { onMenuCommand: (fn: typeof command) => { command = fn; return off; } }, addEventListener: vi.fn(), removeEventListener: vi.fn() });
});
afterEach(() => vi.unstubAllGlobals());
it("opens Settings, switches an already-open drawer to shortcuts, and unsubscribes", () => {
  render();
  const cleanups = hooks.effects.map(effect => effect());
  command("settings");
  let drawer = render().find(el => el.type === SettingsDrawer)!;
  expect(drawer).toBeDefined();
  expect(drawer.props.initialTab).toBeUndefined();
  const previousKey = drawer.key;
  command("shortcuts");
  drawer = render().find(el => el.type === SettingsDrawer)!;
  expect(drawer.props.initialTab).toBe("about");
  expect(drawer.key).not.toBe(previousKey);
  cleanups.forEach(fn => { if (typeof fn === "function") fn(); });
  expect(off).toHaveBeenCalledOnce();
});
it("selects dashboards and panels, and keeps idle Skip a no-op", () => {
  render(); hooks.effects.forEach(effect => effect());
  for (const dash of ["home", "focus", "ambient"] as const) { command(dash); expect(settings.get().dash).toBe(dash); }
  command("tasks"); expect(render().some(el => typeof el.type === "function" && el.type.name === "TasksPanel")).toBe(true);
  command("notes"); expect(render().some(el => typeof el.type === "function" && el.type.name === "NotepadPanel")).toBe(true);
  command("toggle"); command("reset"); command("skip");
  expect(timerActions.toggle).toHaveBeenCalledOnce(); expect(timerActions.reset).toHaveBeenCalledOnce(); expect(timerActions.skip).not.toHaveBeenCalled();
  vi.mocked(timer.get).mockReturnValueOnce({ startedAt: 123, elapsedBefore: 0 } as ReturnType<typeof timer.get>);
  command("skip"); expect(timerActions.skip).toHaveBeenCalledOnce();
});

it("Cmd+. stops the boundary while typing, leaves other keys alone, and unsubscribes", () => {
  render();
  const cleanups = hooks.effects.map(effect => effect());
  const onKey = vi.mocked(window.addEventListener).mock.calls.find(([name]) => name === "keydown")![1] as (event: KeyboardEvent) => void;
  const get = vi.spyOn(boundaryAlert, "get");
  try {
    get.mockReturnValue({ segId: "one", nextSegId: "two", ringing: true, sounding: false, silenced: false });
    const preventDefault = vi.fn();
    const event = { metaKey: true, key: ".", preventDefault, target: { closest: () => ({}) } } as unknown as KeyboardEvent;
    onKey(event);
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(timerActions.stopSound).toHaveBeenCalledOnce();
    onKey({ ...event, metaKey: false } as KeyboardEvent);
    get.mockReturnValue({ ...boundaryAlert.get(), ringing: false });
    onKey(event);
    expect(timerActions.stopSound).toHaveBeenCalledOnce();
    expect(preventDefault).toHaveBeenCalledOnce();
    cleanups.forEach(fn => { if (typeof fn === "function") fn(); });
    expect(window.removeEventListener).toHaveBeenCalledWith("keydown", onKey);
  } finally { get.mockRestore(); }
});
it("ignores page shortcuts from a modal dialog during an end-session hold", () => {
  render(); const cleanups = hooks.effects.map(effect => effect());
  const stateBefore = [...hooks.state];
  const onKey = vi.mocked(window.addEventListener).mock.calls.find(([name]) => name === "keydown")![1] as (event: KeyboardEvent) => void;
  const closest = vi.fn((selector: string) => selector.includes("[role=dialog]") ? {} : null);
  for (const key of [" ", "r", "n", "t", "m", "p", "s", "f"]) {
    onKey({ key, code: key === " " ? "Space" : key, target: { closest }, preventDefault: vi.fn() } as unknown as KeyboardEvent);
  }
  expect(closest).toHaveBeenCalledWith(expect.stringContaining("[role=dialog]"));
  expect(hooks.state).toEqual(stateBefore);
  for (const action of [timerActions.toggle, timerActions.reset, timerActions.skip]) expect(action).not.toHaveBeenCalled();
  cleanups.forEach(off => { if (typeof off === "function") off(); });
});

it("10: starts the ticker synchronously with the mount effect", () => {
  render(); hooks.effects.forEach(effect => effect());
  expect(startTicker).toHaveBeenCalledOnce();
});
