import { Children, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MiniTimer } from "./MiniTimer";
import { ExtrasTab } from "./settings/ExtrasTab";
const view = vi.hoisted(() => ({ hiddenTime: false, timeDescription: "25 minutes left", mode: "pomodoro", state: { segment: "focus" }, display: "25:00", running: false, progress: 0, elapsed: 0, hardLocked: false }));
const hooks = vi.hoisted(() => ({ state: [] as unknown[], refs: [] as { current: unknown }[], effects: [] as (() => unknown)[], stateIndex: 0, refIndex: 0 }));
beforeEach(() => { view.hiddenTime = false; view.state.segment = "focus"; view.running = false; view.elapsed = view.progress = 0; view.display = "25:00"; view.hardLocked = false; hooks.state = []; hooks.refs = []; hooks.effects = []; hooks.stateIndex = hooks.refIndex = 0; });
vi.mock("react", async original => ({ ...await original<typeof import("react")>(),
  useSyncExternalStore: (_subscribe: unknown, get: () => unknown) => get(),
  useEffect: (effect: () => unknown) => { hooks.effects.push(effect); },
  useRef: (value: unknown) => { const i = hooks.refIndex++; return hooks.refs[i] ??= { current: value }; },
  useState: (value: unknown) => { const i = hooks.stateIndex++; if (!(i in hooks.state)) hooks.state[i] = value; return [hooks.state[i], (next: unknown) => { hooks.state[i] = next; }]; },
}));
vi.mock("../state/timer", () => ({ useTimerView: () => view, timerActions: {} }));
afterEach(() => vi.unstubAllGlobals());
type Props = { children?: ReactNode; className?: string; "aria-label"?: string; onClick?: () => void; onChange?: (event: { target: { value: string } }) => void };
function elements(node: ReactNode): ReactElement<Props>[] {
  return Children.toArray(node).flatMap(child => isValidElement<Props>(child) ? [child, ...elements(child.props.children)] : []);
}
it("labels native audio controls and routes them through the bridge", () => {
  const audioControl = vi.fn();
  let receive!: (state: FloatingAudioState) => void;
  vi.stubGlobal("window", { desktop: { audioControl, onAudioState: (fn: typeof receive) => { receive = fn; return vi.fn(); } } });
  expect(renderToStaticMarkup(<MiniTimer native />)).toContain('aria-valuetext="70 percent"');
  const render = () => { hooks.stateIndex = hooks.refIndex = 0; return elements(MiniTimer({ native: true })); };
  const tree = render();
  hooks.effects[0]();
  const mute = tree.find(el => el.props["aria-label"] === "Mute audio")!;
  expect(mute.props).toMatchObject({ "aria-pressed": false });
  mute.props.onClick!();
  tree.find(el => el.props["aria-label"] === "Master volume")!.props.onChange!({ target: { value: "0.25" } });
  receive({ volume: 0.25, muted: true, available: true, playing: true });
  const mutedTree = render();
  const unmute = mutedTree.find(el => el.props["aria-label"] === "Unmute audio")!;
  expect(unmute.props).toMatchObject({ "aria-pressed": true });
  unmute.props.onClick!();
  expect(audioControl.mock.calls).toEqual([[{ action: "mute" }], [{ action: "volume", value: 0.25 }], [{ action: "mute" }]]);
  expect(mutedTree.filter(el => el.type === "button").map(el => el.props["aria-label"])).toEqual(["Close floating timer", "25:00. Open Kitestring", "Unmute audio"]);
  expect(mutedTree.find(el => el.props["aria-label"] === "Master volume")!.props).toMatchObject({ type: "range", min: "0", max: "1", step: "0.01", value: 0.25, "aria-valuetext": "25 percent" });
});
it("keeps the optional web PiP volume row out of the web renderer", () => {
  vi.stubGlobal("window", {});
  expect(renderToStaticMarkup(<MiniTimer />)).not.toContain('aria-label="Master volume"');
});
it("shows all three shared toggles only on Mac", () => {
  vi.stubGlobal("navigator", {});
  vi.stubGlobal("window", {});
  const web = renderToStaticMarkup(<ExtrasTab />);
  for (const label of ["Floating timer", "Keep floating timer on top", "Show time in menu bar"]) expect(web).not.toContain(label);
  vi.stubGlobal("window", { desktop: { floatTimer: vi.fn() } });
  const mac = renderToStaticMarkup(<ExtrasTab />);
  for (const label of ["Floating timer", "Keep floating timer on top", "Show time in menu bar"]) expect(mac).toContain(`<b>${label}</b>`);
});

it("keeps the drag value through stale echoes and accepts external volume after acknowledgement", () => {
  let receive!: (state: FloatingAudioState) => void;
  vi.stubGlobal("window", { desktop: { onAudioState: (fn: typeof receive) => { receive = fn; return vi.fn(); }, requestAudioState: vi.fn(), audioControl: vi.fn() } });
  const render = () => { hooks.stateIndex = hooks.refIndex = 0; return elements(MiniTimer({ native: true })).find(el => el.type === "input")!; };
  let slider = render();
  hooks.effects[0]();
  type Slider = { value: number; onPointerDown: (event: { currentTarget: { setPointerCapture: (id: number) => void }; pointerId: number }) => void; onPointerUp: () => void };
  (slider.props as unknown as Slider).onPointerDown({ currentTarget: { setPointerCapture: vi.fn() }, pointerId: 1 });
  slider.props.onChange!({ target: { value: "0.23" } });
  const echo = (volume: number) => receive({ volume, muted: false, available: false, playing: false });
  echo(0.7); slider = render();
  expect((slider.props as unknown as Slider).value).toBe(0.23);
  (slider.props as unknown as Slider).onPointerUp();
  echo(0.5); slider = render();
  expect((slider.props as unknown as Slider).value).toBe(0.23);
  echo(0.23); echo(0.61); slider = render();
  expect((slider.props as unknown as Slider).value).toBe(0.61);
});

it("only opens the main window, closes the float, or mutes audio while displaying a running segment", () => {
  const timerControl = vi.fn(), showMain = vi.fn(), floatTimer = vi.fn(), audioControl = vi.fn();
  vi.stubGlobal("window", { desktop: { timerControl, showMain, floatTimer, audioControl } });
  for (const [segment, label] of [["focus", "Focus"], ["short", "Short break"], ["long", "Long break"]]) {
    view.state.segment = segment; view.running = true; view.display = "04:59"; view.progress = 0.4;
    hooks.stateIndex = hooks.refIndex = 0;
    const tree = elements(MiniTimer({ native: true }));
    const buttons = tree.filter(el => el.type === "button");
    expect(buttons.map(el => el.props["aria-label"])).toEqual(["Close floating timer", "04:59. Open Kitestring", "Mute audio"]);
    for (const button of buttons) button.props.onClick!();
    const html = renderToStaticMarkup(<MiniTimer native />);
    expect(html).toContain(`aria-label="Floating timer, ${label}"`);
    expect(html).toContain('class="mini-progress" aria-hidden="true"><i style="width:40%"');
    expect(html).not.toContain('class="mini-paused"');
  }
  expect(showMain).toHaveBeenCalledTimes(3);
  expect(floatTimer.mock.calls).toEqual([[false], [false], [false]]);
  expect(audioControl.mock.calls).toEqual([[{ action: "mute" }], [{ action: "mute" }], [{ action: "mute" }]]);
  expect(timerControl).not.toHaveBeenCalled();
});

it.each(["short", "long"])("displays a new %s break as Ready and an elapsed break as Paused without timer controls", segment => {
  view.state.segment = segment; view.running = false;
  for (const native of [false, true]) for (const elapsed of [0, 1000]) {
    vi.stubGlobal("window", { desktop: {} });
    view.elapsed = elapsed;
    hooks.stateIndex = hooks.refIndex = 0;
    const tree = elements(MiniTimer({ native }));
    expect(tree.find(el => el.props.className === "mini-paused")!.props.children).toBe(elapsed ? "Paused" : "Ready");
    expect(tree.filter(el => el.type === "button").map(el => el.props["aria-label"])).toEqual(native ? ["Close floating timer", "25:00. Open Kitestring", "Mute audio"] : []);
    expect(renderToStaticMarkup(<MiniTimer native={native} />)).toContain(`aria-label="Floating timer, ${segment === "short" ? "Short break" : "Long break"}"`);
  }
});

it.each([false, true])("hidden floating time removes digits and progress, preserves native opener %s", native => {
  const showMain = vi.fn(); vi.stubGlobal("window", { desktop: { showMain } });
  view.hiddenTime = true; view.running = true;
  const html = renderToStaticMarkup(<MiniTimer native={native} />);
  expect(html).not.toMatch(/class="mini-(digits|progress)"/);
  expect(html).toContain("Running"); expect(html).toContain('role="timer" aria-live="off">Focus: 25 minutes left');
  if (native) {
    hooks.stateIndex = hooks.refIndex = 0;
    elements(MiniTimer({ native })).find(el => el.props["aria-label"] === "Open Kitestring")!.props.onClick!();
    expect(showMain).toHaveBeenCalledOnce();
  }
});
