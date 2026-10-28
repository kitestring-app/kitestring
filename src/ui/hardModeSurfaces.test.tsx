import { Children, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const hooks = vi.hoisted(() => ({ effects: [] as (() => unknown)[] }));
vi.hoisted(() => { vi.stubGlobal("navigator", {}); });
vi.mock("react", async original => ({ ...await original<typeof import("react")>(),
  useSyncExternalStore: (_s: unknown, get: () => unknown) => get(),
  useEffect: (effect: () => unknown) => hooks.effects.push(effect),
  useRef: (initial: unknown) => ({ current: initial }),
  useState: (initial: unknown) => [initial, vi.fn()],
}));
vi.mock("../audio/core", () => ({ cancelAllChimes: vi.fn(), playTimerTick: vi.fn(), cancelChime: vi.fn(), cancelEnd: vi.fn(), releaseChime: vi.fn(), scheduleChime: vi.fn(), scheduleEnd: vi.fn() }));
vi.mock("../audio/companion", () => ({ armCompanionWithSpeech: vi.fn().mockResolvedValue(false), cancelCompanionSpeech: vi.fn(), companionAvailable: vi.fn().mockResolvedValue(false), companionKnownUp: vi.fn(() => false), disarmCompanion: vi.fn() }));
vi.mock("./useExtras", () => ({ useExtras: () => false }));
import App from "../App";
import { MiniTimer } from "./MiniTimer";
import { FocusView } from "./FocusView";
import { AmbientTimer } from "./AmbientTimer";
import { AlarmToast } from "./AlarmToast";
import { TransitionScreen } from "./timer/TransitionScreen";
import { TimerTab } from "./settings/TimerTab";
import { SessionLog } from "./stats/SessionLog";
import { timer, timerActions, runTimerCommand } from "../state/timer";
import { INITIAL_TIMER } from "../state/timerEngine";
import { settings, settingsUpdate, DEFAULT_SETTINGS } from "../state/settings";
import { stats } from "../state/stats";
import { parked } from "../state/parked";
import { boundaryAlert } from "../audio/boundaryAlert";
import { transitionStore } from "./timer/TransitionStore";
type Props = { children?: ReactNode; [key: string]: any };
function elements(node: ReactNode): ReactElement<Props>[] { return Children.toArray(node).flatMap(child => isValidElement<Props>(child) ? [child, ...elements(child.props.children)] : []); }
function openReminder() {
  const prompt = TransitionScreen()!;
  const tree = elements((prompt.type as (props: unknown) => ReactNode)(prompt.props));
  const dialog = tree.find(el => el.type === "dialog")!;
  dialog.props.ref.current = { showModal: vi.fn(), close: vi.fn(), querySelector: () => ({ focus: vi.fn() }) };
  const cleanup = hooks.effects.at(-1)!() as () => void;
  const key = vi.mocked(window.addEventListener).mock.calls.filter(([name]) => name === "keydown").at(-1)![1] as (event: KeyboardEvent) => void;
  return { tree, dialog, cleanup, press: (value: string, metaKey = false) => key({ key: value, metaKey, preventDefault: vi.fn(), stopImmediatePropagation: vi.fn() } as unknown as KeyboardEvent) };
}
beforeEach(async () => {
  await Promise.all([timer.ready, settings.ready, stats.ready, parked.ready]);
  vi.useFakeTimers(); vi.setSystemTime(1_000_000);
  vi.stubGlobal("window", { desktop: { timerControl: vi.fn(runTimerCommand) }, addEventListener: vi.fn(), removeEventListener: vi.fn() });
  vi.stubGlobal("document", { querySelectorAll: () => [], addEventListener: vi.fn() });
  hooks.effects = [];
  transitionStore.dismiss();
  timer.set({ ...INITIAL_TIMER, segId: "surface" });
  settings.set({ ...DEFAULT_SETTINGS, timer: { ...DEFAULT_SETTINGS.timer, hardMode: true, notify: false } });
  timerActions.start();
});
afterEach(() => { transitionStore.dismiss(); vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); });
it.each([false, true])("floating timer (native=%s) shows the Hard mode lock, exposes no timer actions, and keeps direct calls guarded", async native => {
  const original = timer.get();
  const tree = elements(MiniTimer({ native }));
  const display = tree.find(el => el.props.className === "mini-digits")!.props.children;
  expect(display).toMatch(/^\d{2}:\d{2}$/);
  expect(tree.filter(el => el.type === "button").map(el => el.props["aria-label"])).toEqual(native ? ["Close floating timer", `${display}. Open Kitestring`, "Mute audio"] : []);
  const html = renderToStaticMarkup(<MiniTimer native={native} />);
  expect(html).toContain('title="Hard mode: this block runs to the end"');
  expect(html).not.toContain("End session");
  for (const command of ["pause", "toggle", "reset", "skip", "stop", "stopAndPause"] as const) {
    expect(await timerActions[command]()).toMatchObject({ ok: false, reason: "hard-mode" });
    expect(await runTimerCommand(command)).toMatchObject({ ok: false, reason: "hard-mode" });
  }
  expect(timer.get()).toBe(original);
  expect(window.desktop!.timerControl).not.toHaveBeenCalled();
});
it("main and Ambient controls lock and show an End session path", () => {
  for (const node of [FocusView({ captureOpen: false, onPark: vi.fn(), onCaptureClose: vi.fn() }), AmbientTimer()]) {
    const tree = elements(node), buttons = tree.filter(el => el.type === "button" && /Pause|Reset this|Skip/.test(el.props["aria-label"] ?? ""));
    expect(buttons.length).toBeGreaterThanOrEqual(2);
    for (const button of buttons) { expect(button.props.disabled).toBe(true); expect(button.props.onClick()).toMatchObject({ ok: false, reason: "hard-mode" }); }
  }
  expect(renderToStaticMarkup(<AmbientTimer />)).toContain('End session');
});
it("in-app keys and the legacy renderer menu channel cannot bypass the action guard", () => {
  let menu!: (command: DesktopMenuCommand) => void;
  window.desktop!.onMenuCommand = callback => { menu = callback; return vi.fn(); };
  App(); hooks.effects.forEach(effect => effect());
  const original = timer.get();
  const onKey = vi.mocked(window.addEventListener).mock.calls.find(([name]) => name === "keydown")![1] as (event: KeyboardEvent) => void;
  for (const key of [" ", "r", "n"]) onKey({ key, code: key === " " ? "Space" : key, target: { closest: () => null }, preventDefault: vi.fn() } as unknown as KeyboardEvent);
  for (const command of ["toggle", "reset", "skip", "stop", "stopAndPause"] as const) menu(command);
  expect(timer.get()).toBe(original);
});
it("Hard mode reminder has only a locked state chip and guarded continue/later paths, with direct bypasses refused", async () => {
  boundaryAlert.begin("old", timer.get().segId);
  const toast = elements(AlarmToast());
  expect(toast.find(el => el.props.children === "Stop sound")!.props.disabled).toBeUndefined();
  expect(toast.find(el => el.props.children === "Pause")!.props.disabled).toBe(true);
  for (const ended of ["focus", "short"] as const) for (const autoStarted of [false, true]) {
    timer.set({ ...timer.get(), segment: ended === "focus" ? "short" : "focus" });
    const original = timer.get();
    transitionStore.show({ segId: `takeover-${ended}-${autoStarted}`, nextSegId: autoStarted ? original.segId : "stale", ended, breakSegment: "short", breakRound: 0, at: Date.now(), snoozes: 0, autoStarted });
    const notice = transitionStore.get();
    const { tree, dialog, cleanup, press } = openReminder();
    const buttons = tree.filter(el => el.type === "button");
    const accessible = tree.find(el => el.props.className === "sr-only")!;
    expect(elements(accessible.props.children).filter(el => el.type === "button")).toEqual(buttons);
    expect(buttons.map(button => button.props.children)).toEqual(autoStarted ? ["Close"] : [ended === "focus" ? "Start break" : "Start focus", "Later"]);
    expect(tree.some(el => el.props.className === "transition-link")).toBe(false);
    const chip = tree.find(el => el.props.className === "transition-state")!;
    expect(elements(chip.props.children).some(el => el.props.name === "lock" && el.props.title === "Hard mode")).toBe(true);
    const html = renderToStaticMarkup(<TransitionScreen />);
    expect(html).toContain(autoStarted ? "Click anywhere to close" : ended === "focus" ? "Click to start your break · Esc for later" : "Click to start focusing · Esc for later");
    expect(html).not.toContain("End session");
    for (const label of ["Pause", "Skip break", "+5 min break", "Stop sound", "Stop and pause", ">Dismiss</button>", "Not now", "Done for now"]) expect(html).not.toContain(label);
    for (const key of ["Enter", " ", "Escape", "r", "n"]) press(key);
    vi.advanceTimersByTime(399); dialog.props.onClick();
    expect(timer.get()).toBe(original);
    expect(transitionStore.get()).toBe(notice);
    for (const action of ["pause", "skip", "snooze"] as const) {
      boundaryAlert.begin(`alarm-${ended}-${autoStarted}-${action}`, original.segId);
      expect(boundaryAlert.get().silenced).toBe(false);
      expect(timerActions.answerTransition(action)).toMatchObject({ ok: false, reason: "hard-mode" });
      expect(boundaryAlert.get().silenced).toBe(true);
      expect(timer.get()).toBe(original);
      expect(transitionStore.get()).toBe(notice);
    }
    for (const command of ["pause", "toggle", "reset", "skip", "stop", "stopAndPause"] as const) expect(await timerActions[command]()).toMatchObject({ ok: false, reason: "hard-mode" });
    expect(timer.get()).toBe(original);
    expect(transitionStore.get()).toBe(notice);
    cleanup();
    transitionStore.dismiss();
  }
});
it.each([false, true])("every reminder answer silences the alarm through real timer actions (Hard mode=%s)", hardMode => {
  const cases = [
    { ended: "focus", segment: "short", autoStarted: false },
    { ended: "focus", segment: "short", autoStarted: true },
    { ended: "short", segment: "focus", autoStarted: false },
    { ended: "short", segment: "focus", autoStarted: true },
    { ended: "long", segment: "focus", autoStarted: false, cycleComplete: true },
    { ended: "focus", segment: "focus", autoStarted: false, mode: "countdown" },
    { ended: "focus", segment: "focus", autoStarted: true, mode: "countdown" },
  ] as const;
  for (const [index, scenario] of cases.entries()) for (const gesture of ["click", "Enter", " ", "Escape", "cancel", "accessible-proceed", "accessible-later"] as const) {
    if (gesture === "accessible-later" && scenario.autoStarted) continue;
    const id = `${hardMode}-${index}-${gesture}`;
    timer.set({ ...INITIAL_TIMER, segId: `answer-${id}`, segment: scenario.segment });
    settingsUpdate("timer", { hardMode, mode: "mode" in scenario ? scenario.mode : "pomodoro" });
    if (scenario.autoStarted) timerActions.start();
    const original = timer.get();
    transitionStore.show({ ...scenario, segId: `answer-notice-${id}`, nextSegId: original.segId, breakSegment: "short", breakRound: 0, at: Date.now(), snoozes: 0 });
    boundaryAlert.begin(`answer-alarm-${id}`, original.segId);
    expect(boundaryAlert.get()).toMatchObject({ ringing: true, sounding: true });
    const { tree, dialog, cleanup, press } = openReminder();
    vi.advanceTimersByTime(gesture === "click" ? 400 : 1_500);
    if (gesture === "click") dialog.props.onClick();
    else if (gesture === "cancel") dialog.props.onCancel({ preventDefault: vi.fn() });
    else if (gesture === "accessible-proceed" || gesture === "accessible-later") {
      const buttons = tree.filter(el => el.type === "button");
      const event = { stopPropagation: vi.fn() };
      buttons[gesture === "accessible-later" ? 1 : 0].props.onClick(event);
      expect(event.stopPropagation).toHaveBeenCalledOnce();
    }
    else press(gesture);
    expect(boundaryAlert.get()).toMatchObject({ ringing: false, sounding: false });
    expect(transitionStore.get()).toBeNull();
    if (scenario.autoStarted || gesture === "Escape" || gesture === "cancel" || gesture === "accessible-later") expect(timer.get()).toBe(original);
    else {
      expect(timer.get().segment).toBe(scenario.segment);
      expect(timer.get().startedAt).toBe(Date.now());
      expect(timer.get().hardLocked).toBe(hardMode);
    }
    cleanup();
  }
});
it("Cmd+. silences the real alarm without answering, pausing, skipping or snoozing a Hard mode reminder", () => {
  const original = timer.get();
  transitionStore.show({ segId: "silence-only", nextSegId: original.segId, ended: "short", breakSegment: "short", breakRound: 0, at: Date.now(), snoozes: 0, autoStarted: true });
  const notice = transitionStore.get();
  const { cleanup, press } = openReminder();
  for (const elapsed of [0, 999, 1]) {
    vi.advanceTimersByTime(elapsed);
    boundaryAlert.begin(`silence-${elapsed}`, original.segId);
    expect(boundaryAlert.get()).toMatchObject({ ringing: true, sounding: true });
    press(".", true);
    expect(boundaryAlert.get()).toMatchObject({ ringing: false, sounding: false, silenced: true });
    expect(timer.get()).toBe(original);
    expect(transitionStore.get()).toBe(notice);
  }
  cleanup();
});
it("shows deferred disable in Timer settings and a saved reason in the session log", () => {
  settingsUpdate("timer", { hardMode: false });
  expect(renderToStaticMarkup(<TimerTab />)).toContain("Hard mode turns off after this block");
  timerActions.beginEndHold(); vi.advanceTimersByTime(10_000); timerActions.endHardSession("Meeting");
  const html = renderToStaticMarkup(<SessionLog />);
  expect(html).toContain("Hard mode: ended early"); expect(html).toContain("Meeting");
});

it('dismissed paused Hard recovery keeps visible Resume available without unlocking reset or skip', async () => {
  timer.set({ ...timer.get(), startedAt: null, elapsedBefore: 10_000, creditedUpTo: 10_000 });
  for (const node of [FocusView({ captureOpen: false, onPark: vi.fn(), onCaptureClose: vi.fn() }), AmbientTimer()]) {
    const buttons = elements(node).filter(el => el.type === 'button');
    const start = buttons.find(el => /^Start/.test(el.props['aria-label'] ?? ''))!;
    expect(start.props.disabled).toBe(false);
    for (const button of buttons.filter(el => /Reset this|Skip/.test(el.props['aria-label'] ?? ''))) expect(button.props.disabled).toBe(true);
  }
  expect(await runTimerCommand('toggle')).toEqual({ ok: true }); expect(timer.get().startedAt).toBe(Date.now());
});
