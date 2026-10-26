import { Children, isValidElement, type ReactElement, type ReactNode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const hooks = vi.hoisted(() => ({
  effects: [] as (() => (() => void))[],
  heading: { focus: vi.fn() },
  dialog: { showModal: vi.fn(), close: vi.fn(), focus: vi.fn(), querySelector: vi.fn(), querySelectorAll: vi.fn<() => { focus: () => void }[]>(() => []) },
}));
const view = vi.hoisted(() => ({ state: { segId: "next", segment: "short" }, running: false, total: 300_000, display: "04:59" }));
vi.mock("react", async original => ({ ...await original<typeof import("react")>(),
  useEffect: (fn: () => (() => void)) => hooks.effects.push(fn),
  useRef: (initial: unknown) => ({ current: initial === null ? hooks.dialog : initial }),
  useSyncExternalStore: (_subscribe: unknown, get: () => unknown) => get(),
}));
vi.mock("../../state/timer", () => ({ useTimerView: () => view, timerActions: { stopSound: vi.fn(), stopAndPause: vi.fn(), answerTransition: vi.fn() } }));
import { TransitionScreen } from "./TransitionScreen";
import { transitionStore, type TransitionNotice } from "./TransitionStore";
import { timerActions } from "../../state/timer";
import { DEFAULT_SETTINGS, settings } from "../../state/settings";

type Props = {
  children?: ReactNode; tabIndex?: number; className?: string;
  onClick?: (event?: unknown) => void;
  onCancel?: (event: { preventDefault: () => void }) => void;
};
function elements(node: ReactNode): ReactElement<Props>[] { return Children.toArray(node).flatMap(child => isValidElement<Props>(child) ? [child, ...elements(child.props.children)] : []); }
let now = 5_000;
let sequence = 0;
let key: (event: unknown) => void;
let cleanup: (() => void) | undefined;
beforeEach(async () => {
  await settings.ready;
  settings.set(DEFAULT_SETTINGS);
  view.state = { segId: "next", segment: "short" }; view.running = false;
  now = 5_000;
  vi.spyOn(performance, "now").mockImplementation(() => now);
  hooks.dialog.querySelector.mockReturnValue(hooks.heading);
  hooks.dialog.querySelectorAll.mockReturnValue([]);
  vi.stubGlobal("document", { activeElement: hooks.heading });
  vi.stubGlobal("window", {
    addEventListener: vi.fn((_type: string, fn: typeof key) => { key = fn; }),
    removeEventListener: vi.fn(),
  });
});
afterEach(() => {
  cleanup?.(); cleanup = undefined;
  hooks.effects = []; transitionStore.dismiss();
  vi.restoreAllMocks(); vi.clearAllMocks(); vi.unstubAllGlobals();
});
function open(patch: Partial<TransitionNotice> = {}) {
  transitionStore.show({ segId: `controls-${sequence++}`, nextSegId: "next", ended: "focus", at: 0, breakSegment: "short", breakRound: 0, snoozes: 0, ...patch });
  const prompt = TransitionScreen()!;
  const tree = elements((prompt.type as (props: unknown) => ReactNode)(prompt.props));
  cleanup = hooks.effects.at(-1)!();
  return tree;
}
function press(value: string, metaKey = false, shiftKey = false) {
  const event = { key: value, metaKey, shiftKey, preventDefault: vi.fn(), stopImmediatePropagation: vi.fn() };
  key(event);
  expect(event.stopImmediatePropagation).toHaveBeenCalledOnce();
  return event;
}

it("opens a modal with heading focus and sr-only controls, and removes its capture listener on close", () => {
  const tree = open();
  expect(hooks.dialog.showModal).toHaveBeenCalledOnce();
  expect(hooks.dialog.querySelector).toHaveBeenCalledExactlyOnceWith("#transition-title");
  expect(hooks.heading.focus).toHaveBeenCalledOnce();
  expect(hooks.dialog.focus).not.toHaveBeenCalled();
  expect(tree.find(el => el.type === "h1")!.props.tabIndex).toBe(-1);
  const controls = tree.find(el => el.type === "div" && el.props.className === "sr-only")!;
  expect(elements(controls.props.children).filter(el => el.type === "button").map(el => el.props.children)).toEqual(["Start break", "Later"]);
  expect(tree.filter(el => el.type === "button")).toHaveLength(2);
  expect(window.addEventListener).toHaveBeenCalledWith("keydown", key, true);
  expect(press("Tab").preventDefault).toHaveBeenCalledOnce();
  expect(timerActions.answerTransition).not.toHaveBeenCalled();
  cleanup!(); cleanup = undefined;
  expect(hooks.dialog.close).toHaveBeenCalledOnce();
  expect(window.removeEventListener).toHaveBeenCalledWith("keydown", key, true);
});

it("Tab and Shift+Tab reach and wrap the accessible controls without answering", () => {
  const buttons = [{ focus: vi.fn() }, { focus: vi.fn() }];
  hooks.dialog.querySelectorAll.mockReturnValue(buttons);
  open();
  now += 1500;
  press("Tab");
  expect(buttons[0].focus).toHaveBeenCalledOnce();
  vi.stubGlobal("document", { activeElement: buttons[0] });
  press("Tab");
  expect(buttons[1].focus).toHaveBeenCalledOnce();
  press("Tab", false, true);
  expect(buttons[1].focus).toHaveBeenCalledTimes(2);
  vi.stubGlobal("document", { activeElement: buttons[1] });
  press("Tab");
  expect(buttons[0].focus).toHaveBeenCalledTimes(2);
  expect(hooks.dialog.querySelectorAll).toHaveBeenCalledWith("button:not(:disabled)");
  expect(timerActions.answerTransition).not.toHaveBeenCalled();
});

it.each(["backdrop", "content"])("clicking the %s proceeds at 400 ms, with earlier clicks ignored", target => {
  const dialog = open().find(el => el.type === "dialog")!;
  const surface = {};
  const event = { currentTarget: surface, target: target === "backdrop" ? surface : {} };
  for (const elapsed of [0, 399]) { now = 5_000 + elapsed; dialog.props.onClick!(event); }
  expect(timerActions.answerTransition).not.toHaveBeenCalled();
  now = 5_400; dialog.props.onClick!(event);
  expect(timerActions.answerTransition).toHaveBeenCalledExactlyOnceWith("start");
  expect(timerActions.stopAndPause).not.toHaveBeenCalled();
});

it.each(["focus", "short", "long"] as const)("clicking after %s answers start, or dismiss when the next segment is already running", ended => {
  for (const autoStarted of [false, true]) {
    view.state.segment = ended === "focus" ? "short" : "focus";
    view.running = autoStarted;
    const dialog = open({ ended, autoStarted, cycleComplete: ended === "long" }).find(el => el.type === "dialog")!;
    now += 400; dialog.props.onClick!();
    expect(timerActions.answerTransition).toHaveBeenCalledExactlyOnceWith(autoStarted ? "dismiss" : "start");
    expect(timerActions.stopAndPause).not.toHaveBeenCalled();
    vi.mocked(timerActions.answerTransition).mockClear();
    cleanup!(); cleanup = undefined;
  }
});

it.each(["Enter", " "])("swallows %j until 1.5 seconds after the latest keydown, then proceeds", activation => {
  open();
  for (const elapsed of [0, 399, 400, 999]) {
    now = 5_000 + elapsed;
    expect(press(activation).preventDefault).toHaveBeenCalledOnce();
    expect(timerActions.answerTransition).not.toHaveBeenCalled();
  }
  now += 1_500;
  expect(press(activation).preventDefault).toHaveBeenCalledOnce();
  expect(timerActions.answerTransition).toHaveBeenCalledExactlyOnceWith("start");
  expect(timerActions.stopAndPause).not.toHaveBeenCalled();
});

it.each(["Enter", " "])("%j dismisses rather than restarting an already running segment after the guard", activation => {
  view.running = true;
  open();
  now += 1_500; press(activation);
  expect(timerActions.answerTransition).toHaveBeenCalledExactlyOnceWith("dismiss");
});

it.each(["Enter", " "])("%j on a focused reminder button runs that button after the guard, not continue", activation => {
  open();
  const button = { closest: (selector: string) => (selector === "button" ? button : null) };
  const contains = vi.fn(() => true);
  Object.assign(hooks.dialog, { contains });
  const pressOn = () => {
    const event = { key: activation, target: button, metaKey: false, shiftKey: false, preventDefault: vi.fn(), stopImmediatePropagation: vi.fn() };
    key(event); return event;
  };
  // Inside the guard a keystroke in flight still does nothing at all.
  expect(pressOn().preventDefault).toHaveBeenCalledOnce();
  now += 1_500;
  const late = pressOn();
  // The browser's own activation is left alone, so "Later" dismisses instead of starting the next block.
  expect(late.preventDefault).not.toHaveBeenCalled();
  expect(late.stopImmediatePropagation).not.toHaveBeenCalled();
  expect(timerActions.answerTransition).not.toHaveBeenCalled();
  Reflect.deleteProperty(hooks.dialog, "contains");
});

it("blocks dashboard shortcuts and ordinary typing during the quiet window", () => {
  open();
  for (const elapsed of [0, 999]) for (const value of ["r", "n", "t", "m", "s", "f", "a", ".", "Tab"]) {
    now = 5_000 + elapsed; press(value);
  }
  expect(timerActions.answerTransition).not.toHaveBeenCalled();
  expect(timerActions.stopSound).not.toHaveBeenCalled();
  expect(timerActions.stopAndPause).not.toHaveBeenCalled();
});

it.each(["Escape", "cancel"])("%s waits for keyboard quiet before meaning later", gesture => {
  const dialog = open().find(el => el.type === "dialog")!;
  const attempt = () => {
    const event = gesture === "Escape" ? press("Escape") : { preventDefault: vi.fn() };
    if (gesture === "cancel") dialog.props.onCancel!(event);
    expect(event.preventDefault).toHaveBeenCalledOnce();
  };
  for (const elapsed of [0, 399, 400, 999]) {
    now = 5_000 + elapsed; attempt();
    expect(timerActions.answerTransition).not.toHaveBeenCalled();
  }
  now += 1500; attempt();
  expect(timerActions.answerTransition).toHaveBeenCalledExactlyOnceWith("dismiss");
  expect(timerActions.stopSound).not.toHaveBeenCalled();
  expect(timerActions.stopAndPause).not.toHaveBeenCalled();
});

it.each(["focus", "short", "long"] as const)("sr-only controls after %s use the same start, close and later paths without bubbling", ended => {
  for (const autoStarted of [false, true]) {
    view.state.segment = ended === "focus" ? "short" : "focus";
    view.running = autoStarted;
    const buttons = open({ ended, autoStarted }).filter(el => el.type === "button");
    expect(buttons.map(button => button.props.children)).toEqual(autoStarted ? ["Close"] : [ended === "focus" ? "Start break" : "Start focus", "Later"]);
    now += 1000;
    for (const button of buttons) {
      vi.mocked(timerActions.answerTransition).mockClear();
      const event = { stopPropagation: vi.fn() };
      button.props.onClick!(event);
      expect(event.stopPropagation).toHaveBeenCalledOnce();
      expect(timerActions.answerTransition).toHaveBeenCalledExactlyOnceWith(autoStarted || button.props.children === "Later" ? "dismiss" : "start");
      expect(timerActions.stopAndPause).not.toHaveBeenCalled();
      expect(timerActions.stopSound).not.toHaveBeenCalled();
    }
    cleanup!(); cleanup = undefined;
  }
});

it("Cmd+. only silences, both during and after the opening guard", () => {
  open();
  const notice = transitionStore.get();
  for (const elapsed of [0, 999, 1_000]) {
    now = 5_000 + elapsed;
    vi.mocked(timerActions.stopSound).mockClear();
    expect(press(".", true).preventDefault).toHaveBeenCalledOnce();
    expect(timerActions.stopSound).toHaveBeenCalledOnce();
    expect(timerActions.answerTransition).not.toHaveBeenCalled();
    expect(timerActions.stopAndPause).not.toHaveBeenCalled();
    expect(transitionStore.get()).toBe(notice);
  }
});
