import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("react", async (original) => ({
  ...await original<typeof import("react")>(),
  useSyncExternalStore: (_subscribe: unknown, get: () => unknown) => get(),
}));
const view = vi.hoisted(() => ({
  hiddenTime: false, state: { segId: "next", segment: "short" }, running: false, total: 300_000, display: "04:59", elapsed: 1000,
}));
vi.mock("../../state/timer", () => ({ useTimerView: () => view, timerActions: { answerTransition: vi.fn() } }));

import { settings, DEFAULT_SETTINGS } from "../../state/settings";
import { tasks, focusPick } from "../../state/tasks";
import { TimerTab } from "../settings/TimerTab";
import { Choices } from "../settings/SettingsDrawer";
import { TransitionScreen } from "./TransitionScreen";
import { transitionStore, type TransitionNotice } from "./TransitionStore";

let sequence = 0;
const show = (patch: Partial<TransitionNotice> = {}) => transitionStore.show({
  segId: `render-${sequence++}`, ended: "focus", at: 100, nextSegId: "next", breakSegment: "short", breakRound: 0, snoozes: 0, ...patch,
});

function expectReminder(html: string, hint: string) {
  const controls = html.match(/<div class="sr-only">(.*?)<\/div>/)?.[1];
  expect(controls).toBeDefined();
  const labels = hint === "Click anywhere to close" ? ["Close"] : [hint.includes("your break") ? "Start break" : "Start focus", "Later"];
  expect(controls).toBe(labels.map(label => `<button type="button">${label}</button>`).join(""));
  expect(html.replace(`<div class="sr-only">${controls}</div>`, "")).not.toMatch(/<button\b|role="button"/);
  expect(html).toContain(`<p class="transition-hint" id="transition-hint">${hint}</p>`);
  for (const label of ["Stop sound", "Stop and pause", "Skip break", "+5 min break", "End session", 'class="transition-link"']) expect(html).not.toContain(label);
}

beforeEach(async () => {
  await Promise.all([settings.ready, tasks.ready, focusPick.ready]);
  vi.stubGlobal("window", {});
  settings.set(DEFAULT_SETTINGS);
  tasks.set([]);
  focusPick.set(null);
  transitionStore.dismiss();
  view.state = { segId: "next", segment: "short" };
  view.hiddenTime = false; view.running = false;
  view.display = "04:59";
});
afterEach(() => vi.unstubAllGlobals());

describe("takeover content", () => {
  it("renders nothing until there is a transition", () => {
    expect(renderToStaticMarkup(<TransitionScreen />)).toBe("");
  });
  it("offers a visually buttonless glass reminder with accessible controls and a click hint", () => {
    show();
    const html = renderToStaticMarkup(<TransitionScreen />);
    for (const content of ['role="alertdialog"', 'aria-modal="true"', 'aria-labelledby="transition-title"', 'aria-describedby="transition-instruction transition-hint"', '<h1 id="transition-title" tabindex="-1">Time for a break</h1>', 'Short break', '<p class="transition-length">5 min</p>', "Stand up, look far away, drink some water."]) expect(html).toContain(content);
    expect(html).toContain('class="transition-screen is-short glass-frosted"');
    expect(DEFAULT_SETTINGS.appearance.reminderGlass).toBe("frosted");
    expectReminder(html, "Click to start your break · Esc for later");
  });
  it.each(["clear", "frosted"] as const)("uses the selected %s reminder glass", reminderGlass => {
    settings.set({ ...DEFAULT_SETTINGS, appearance: { ...DEFAULT_SETTINGS.appearance, reminderGlass } });
    show();
    const html = renderToStaticMarkup(<TransitionScreen />);
    expect(html).toContain(`class="transition-screen is-short glass-${reminderGlass}"`);
    expectReminder(html, "Click to start your break · Esc for later");
  });
  it("shows a close hint and a live countdown when the break already started", () => {
    show();
    view.running = true;
    const html = renderToStaticMarkup(<TransitionScreen />);
    expect(html).toContain("04:59");
    expect(html).not.toContain("Start break");
    expect(html).toContain("Your break has started");
    expectReminder(html, "Click anywhere to close");
    view.display = "04:58";
    expect(renderToStaticMarkup(<TransitionScreen />)).toContain("04:58");
  });
  it("announces auto-started focus with the live countdown and a close hint", () => {
    view.state.segment = "focus";
    view.running = true;
    show({ ended: "short", autoStarted: true });
    const html = renderToStaticMarkup(<TransitionScreen />);
    for (const text of ["Focus has started", "04:59"]) expect(html).toContain(text);
    expect(html).not.toContain("+5 min break");
    expectReminder(html, "Click anywhere to close");
  });
  it("offers a click to start the next cycle at the end of a cycle", () => {
    view.state.segment = "focus";
    show({ ended: "long", cycleComplete: true });
    const html = renderToStaticMarkup(<TransitionScreen />);
    for (const text of ["Cycle complete", "Nice work. Start another cycle when you’re ready."]) expect(html).toContain(text);
    for (const text of ["04:59", "+5 min break", ">OK</button>", ">Pause</button>"]) expect(html).not.toContain(text);
    expectReminder(html, "Click to start the next cycle · Esc for later");
  });
  it.each([0, 1, 2])("shows the selected task with no snooze control after %s extensions", snoozes => {
    tasks.set([{ id: "task", title: "Write the outline", done: false, createdAt: 0 }]);
    view.state.segment = "focus";
    show({ ended: "short", snoozes });
    const html = renderToStaticMarkup(<TransitionScreen />);
    for (const text of ["Ready to focus", "Write the outline"]) expect(html).toContain(text);
    expectReminder(html, "Click to start focusing · Esc for later");
  });
});

describe("timer settings content", () => {
  it.each(["off", "cycle", "always"] as const)("offers all three auto-run choices and marks %s selected", (autoRun) => {
    settings.set({ ...DEFAULT_SETTINGS, timer: { ...DEFAULT_SETTINGS.timer, autoRun } });
    const html = renderToStaticMarkup(<TimerTab />);
    const autoRunSection = html.split("<h3>Auto-run</h3>")[1].split("<h3>Timer style</h3>")[0];
    expect(autoRunSection).toContain('<div class="segmented" role="group">');
    expect(autoRunSection).not.toContain('class="choice"');
    const labels = { off: "Off: wait for me", cycle: "Run one full cycle", always: "Keep going" };
    const help = { off: "Waits for you to start each focus session and break.", cycle: "Continues through the long break, then waits before the next focus session.", always: "Starts every next focus session and break on its own." };
    for (const option of ["off", "cycle", "always"] as const) {
      expect(autoRunSection).toContain(`<button type="button" aria-pressed="${option === autoRun}">${labels[option]}</button>`);
      if (option === autoRun) expect(autoRunSection).toContain(`<p class="help choice-help">${help[option]}</p>`);
      else expect(autoRunSection).not.toContain(help[option]);
    }
    expect(autoRunSection.match(/class="help choice-help"/g)).toHaveLength(1);
    expect(autoRunSection).not.toContain("Auto-run has no effect on Countdown or Stopwatch.");
    expect(html).not.toContain("Auto start timer on segment end");
  });
  it.each(["countdown", "stopwatch"] as const)("keeps the auto-run compatibility help in %s", mode => {
    settings.set({ ...DEFAULT_SETTINGS, timer: { ...DEFAULT_SETTINGS.timer, mode } });
    expect(renderToStaticMarkup(<TimerTab />)).toContain("Auto-run has no effect on Countdown or Stopwatch.");
  });
  it("renders text-only Choices as segmented buttons and dispatches the selected id", () => {
    const onChange = vi.fn();
    const options = [{ id: "clear", label: "Clear" }, { id: "frosted", label: "Frosted" }];
    const group = Choices({ value: "frosted", options, onChange });
    const html = renderToStaticMarkup(group);
    expect(html).toBe('<div class="segmented" role="group"><button type="button" aria-pressed="false">Clear</button><button type="button" aria-pressed="true">Frosted</button></div>');
    group.props.children[0].props.onClick();
    expect(onChange).toHaveBeenCalledExactlyOnceWith("clear");
  });
  it("keeps Choices with previews as choice cards", () => {
    const html = renderToStaticMarkup(<Choices value="preview" options={[{ id: "preview", label: "Preview", preview: <span>Artwork</span> }, { id: "plain", label: "Plain" }]} onChange={vi.fn()} />);
    expect(html).toBe('<div class="grid3"><button class="choice" aria-pressed="true"><span>Artwork</span><span class="lbl">Preview</span></button><button class="choice" aria-pressed="false"><span class="lbl">Plain</span></button></div>');
  });
  it.each(["pomodoro", "animedoro"] as const)("offers presets, all length fields, and quick break values in %s", (mode) => {
    settings.set({ ...DEFAULT_SETTINGS, timer: { ...DEFAULT_SETTINGS.timer, mode } });
    const html = renderToStaticMarkup(<TimerTab />);
    for (const text of ["25 · 5", "30 · 5", "40 · 5", "45 · 5", "50 · 10", "Custom", "Short break quick lengths", 'min="1" max="600"', "Full-screen break/focus reminder", "Say it out loud", "Bring the app to the front (Mac app)"]) expect(html).toContain(text);
    expect(html.match(/aria-pressed="true"/g)?.length).toBeGreaterThanOrEqual(3);
  });
  it("marks a custom combination as Custom", () => {
    settings.set({ ...DEFAULT_SETTINGS, timer: { ...DEFAULT_SETTINGS.timer, lengths: { ...DEFAULT_SETTINGS.timer.lengths, long: 17 } } });
    expect(renderToStaticMarkup(<TimerTab />)).toMatch(/aria-pressed="true">Custom<\/button>/);
  });
});

it.each([false, true])("describes a countdown completion without break actions (repeat=%s)", repeat => {
  settings.set({ ...DEFAULT_SETTINGS, timer: { ...DEFAULT_SETTINGS.timer, mode: "countdown", countdownRepeat: repeat } });
  view.state.segment = "focus"; view.running = repeat;
  show({ ended: "focus", autoStarted: repeat });
  const html = renderToStaticMarkup(<TransitionScreen />);
  expect(html).toContain(repeat ? "Countdown restarted" : "Session complete");
  expectReminder(html, repeat ? "Click anywhere to close" : "Click to start again · Esc for later");
  for (const label of ["Start break", "Skip break", "+5 min break", "Break started"]) expect(html).not.toContain(label);
});

it.each([false, true])("hidden time keeps reminder actions and removes durations with auto-start %s", running => {
  view.hiddenTime = true; view.running = running; show();
  const html = renderToStaticMarkup(<TransitionScreen />);
  expect(html).not.toContain('class="transition-length"');
  expect(html).toContain("Short break");
  expectReminder(html, running ? "Click anywhere to close" : "Click to start your break · Esc for later");
});
