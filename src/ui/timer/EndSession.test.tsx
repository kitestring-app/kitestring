import { Children, isValidElement, type ReactElement, type ReactNode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const hooks = vi.hoisted(() => ({ values: [] as unknown[], refs: [] as { current: unknown }[], effects: [] as (() => (() => void))[], stateIndex: 0, refIndex: 0 }));
vi.hoisted(() => { vi.stubGlobal("navigator", {}); });
vi.mock("react", async original => ({ ...await original<typeof import("react")>(),
  useSyncExternalStore: (_s: unknown, get: () => unknown) => get(),
  useEffect: (effect: () => (() => void)) => hooks.effects.push(effect),
  useRef: (initial: unknown) => { const i = hooks.refIndex++; return hooks.refs[i] ??= { current: initial }; },
  useState: (initial: unknown) => { const i = hooks.stateIndex++; if (!(i in hooks.values)) hooks.values[i] = initial; return [hooks.values[i], (value: unknown) => { hooks.values[i] = value; }]; },
}));
vi.mock("../../audio/core", () => ({ cancelAllChimes: vi.fn(), playTimerTick: vi.fn(), cancelChime: vi.fn(), cancelEnd: vi.fn(), releaseChime: vi.fn(), scheduleChime: vi.fn(), scheduleEnd: vi.fn() }));
vi.mock("../../audio/companion", () => ({ armCompanionWithSpeech: vi.fn().mockResolvedValue(false), cancelCompanionSpeech: vi.fn(), companionAvailable: vi.fn().mockResolvedValue(false), companionKnownUp: vi.fn(() => false), disarmCompanion: vi.fn() }));
import { EndSessionControl, EndSessionDialog, EndSessionHost, requestEndSession } from "./EndSession";
import { timer, timerActions, runTimerCommand } from "../../state/timer";
import { DEFAULT_SETTINGS, settings } from "../../state/settings";
import { INITIAL_TIMER } from "../../state/timerEngine";
import { stats } from "../../state/stats";
type Props = { children?: ReactNode; [key: string]: any };
function elements(node: ReactNode): ReactElement<Props>[] { return Children.toArray(node).flatMap(child => isValidElement<Props>(child) ? [child, ...elements(child.props.children)] : []); }
const close = vi.fn();
const render = (native = false) => { hooks.stateIndex = hooks.refIndex = 0; return elements(EndSessionDialog({ close, native })); };
const key = (name: string, repeat = false) => ({ key: name, repeat, preventDefault: vi.fn(), stopPropagation: vi.fn() });
let cleanup: () => void;
beforeEach(async () => {
  await Promise.all([timer.ready, settings.ready, stats.ready]);
  vi.useFakeTimers(); vi.setSystemTime(1_000_000);
  vi.stubGlobal("window", { desktop: { timerControl: vi.fn(runTimerCommand), release: vi.fn() } });
  hooks.values = []; hooks.refs = []; hooks.effects = []; vi.clearAllMocks(); cleanup = () => {};
  timer.set({ ...INITIAL_TIMER, segId: "end-ui" });
  settings.set({ ...DEFAULT_SETTINGS, timer: { ...DEFAULT_SETTINGS.timer, hardMode: true, notify: false } });
  timerActions.start(); stats.set({ chunks: [], tasksDone: [] });
});
afterEach(() => { cleanup?.(); vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); });
function mount(native = false) {
  const tree = render(native);
  const eventTarget = { addEventListener: vi.fn(), removeEventListener: vi.fn() };
  hooks.refs[0].current = { showModal: vi.fn(), close: vi.fn(), ownerDocument: { ...eventTarget, defaultView: eventTarget } };
  hooks.refs[1].current = { focus: vi.fn() };
  cleanup = hooks.effects[0]();
  return tree.find(el => el.props["aria-label"] === "Hold for 10 seconds to end session")!;
}
it.each([false, true])("keyboard hold cancels early, restarts at zero, then exposes a required reason without another delay (native=%s)", async native => {
  const original = timer.get();
  let button = mount(native);
  button.props.onKeyDown(key(" ")); await vi.advanceTimersByTimeAsync(5000);
  button = render(native).find(el => el.props["aria-label"] === "Hold for 10 seconds to end session")!;
  button.props.onKeyUp(key(" "));
  expect(JSON.stringify(render(native).map(el => el.props.children))).toContain("Hold to continue");
  expect(timer.get()).toBe(original);
  button.props.onKeyDown(key("Enter")); await vi.advanceTimersByTimeAsync(0);
  button.props.onKeyDown(key("Enter", true));
  await vi.advanceTimersByTimeAsync(9999); expect(render(native).some(el => el.type === "input")).toBe(false);
  await vi.advanceTimersByTimeAsync(1);
  let tree = render(native); const input = tree.find(el => el.type === "input")!;
  expect(input.props).toMatchObject({ autoFocus: true, required: true, minLength: 3, maxLength: 500 });
  expect(tree.find(el => el.props.type === "submit")!.props.disabled).toBe(true);
  input.props.onChange({ target: { value: "ab" } }); tree = render(native);
  expect(tree.find(el => el.props.type === "submit")!.props.disabled).toBe(true);
  input.props.onChange({ target: { value: "Urgent meeting" } }); tree = render(native);
  expect(tree.find(el => el.props.type === "submit")!.props.disabled).toBe(false);
  await tree.find(el => el.type === "form")!.props.onSubmit({ preventDefault: vi.fn() });
  expect(close).toHaveBeenCalledOnce(); expect(timer.get().startedAt).toBeNull();
  expect(stats.get().chunks.find(chunk => chunk.earlyEndReason)?.earlyEndReason).toBe("Urgent meeting");
});
it.each(["onPointerUp", "onPointerCancel", "onLostPointerCapture", "onBlur"])("mouse/touch holds reset on %s", async release => {
  const button = mount();
  const capture = vi.fn();
  button.props.onPointerDown({ button: 0, pointerId: 7, pointerType: "touch", currentTarget: { setPointerCapture: capture } });
  await vi.advanceTimersByTimeAsync(9900); button.props[release]();
  await vi.advanceTimersByTimeAsync(1000);
  expect(capture).toHaveBeenCalledWith(7); expect(render().some(el => el.type === "input")).toBe(false);
  expect(timerActions.endHardSession("Meeting").ok).toBe(false); expect(timer.get().startedAt).not.toBeNull();
});
it("cancel on the reason step leaves the running block untouched", async () => {
  const original = timer.get(), button = mount();
  button.props.onKeyDown(key("Enter")); await vi.advanceTimersByTimeAsync(10_000);
  const tree = render(); tree.find(el => el.props.children === "Cancel")!.props.onClick();
  expect(close).toHaveBeenCalledOnce(); expect(timer.get()).toBe(original); expect(stats.get().chunks).toEqual([]);
});
it("discarded native acknowledgements cannot restart a released hold", async () => {
  let acknowledge!: (value: DesktopTimerResult) => void;
  window.desktop!.timerControl = vi.fn((command: DesktopTimerCommand | "endSession"): Promise<DesktopTimerResult> => command === "beginEndHold" ? new Promise<DesktopTimerResult>(resolve => { acknowledge = resolve; }) : Promise.resolve({ ok: true }));
  const button = mount(true);
  button.props.onKeyDown(key("Enter")); button.props.onKeyUp(key("Enter"));
  acknowledge({ ok: true }); await vi.advanceTimersByTimeAsync(10_000);
  expect(render(true).some(el => el.type === "input")).toBe(false);
});
it("marks the hold as a modal dialog for the page shortcut guard", () => {
  const dialog = render().find(el => el.type === "dialog")!;
  expect(dialog.props).toMatchObject({ role: "dialog", "aria-modal": "true" });
});
it.each(["hold-required", "stale-segment", "unavailable"] as const)("allows a fresh hold after a refused native submit (%s)", async reason => {
  const button = mount(true);
  button.props.onKeyDown(key("Enter")); await vi.advanceTimersByTimeAsync(10_000);
  window.desktop!.timerControl = vi.fn().mockResolvedValueOnce({ ok: false, reason }).mockImplementation(runTimerCommand);
  let tree = render(true);
  tree.find(el => el.type === "input")!.props.onChange({ target: { value: "Meeting" } });
  tree = render(true); await tree.find(el => el.type === "form")!.props.onSubmit({ preventDefault: vi.fn() });
  expect(close).not.toHaveBeenCalled(); expect(render(true).some(el => el.type === "input")).toBe(false);
  const retry = render(true).find(el => el.props["aria-label"] === "Hold for 10 seconds to end session")!;
  retry.props.onKeyDown(key("Enter")); await vi.advanceTimersByTimeAsync(9999);
  expect(render(true).some(el => el.type === "input")).toBe(false);
  await vi.advanceTimersByTimeAsync(1);
  tree = render(true); await tree.find(el => el.type === "form")!.props.onSubmit({ preventDefault: vi.fn() });
  expect(close).toHaveBeenCalledOnce();
});
it("ignores idle requests, shares the control's flag, and clears it across an unlock", () => {
  timer.set({ ...INITIAL_TIMER });
  requestEndSession(); timerActions.start();
  expect(EndSessionHost()).toBeNull();
  const cleanups = hooks.effects.map(effect => effect());
  const control = elements(EndSessionControl({}));
  control.find(el => el.type === "button")!.props.onClick(); requestEndSession();
  expect(control.some(el => el.type === EndSessionDialog)).toBe(false);
  expect(EndSessionHost()?.type).toBe(EndSessionDialog);
  timer.set({ ...INITIAL_TIMER }); timerActions.start();
  expect(EndSessionHost()).toBeNull();
  cleanups.forEach(off => off?.());
});
it.each([false, true])("offers Finish session for a locked stopwatch (native=%s)", async native => {
  timer.set({ ...timer.get(), frozenTotal: null });
  const tree = elements(EndSessionControl({ native }));
  const finish = tree.find(el => el.props.children === "Finish session")!;
  expect(finish).toBeDefined(); await finish.props.onClick();
  expect(timer.get().startedAt).toBeNull();
});
