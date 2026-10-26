import { Children, isValidElement } from "react";
import type { ReactElement, ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";

vi.mock("react", async original => ({ ...await original<typeof import("react")>(), useSyncExternalStore: (_s: unknown, get: () => unknown) => get() }));
const view = vi.hoisted(() => ({ state: { segment: "focus" }, running: false, display: "25:00" }));
vi.mock("../state/timer", () => ({ useTimerView: () => view, timerActions: { toggle: vi.fn(), skip: vi.fn() } }));
import { AmbientTimer } from "./AmbientTimer";
import { ClockView, DashboardStreak } from "./ClockView";
import { timerActions } from "../state/timer";
import { DEFAULT_SETTINGS, sanitizeSettings, settings } from "../state/settings";
import { stats } from "../state/stats";

beforeEach(async () => {
  await Promise.all([settings.ready, stats.ready]);
  settings.set(DEFAULT_SETTINGS);
  stats.set({ chunks: [], tasksDone: [] });
  view.state.segment = "focus"; view.running = false;
  vi.clearAllMocks();
});
it("only adds the mini timer in Ambient", () => {
  expect(renderToStaticMarkup(<ClockView ambient />)).toContain('aria-label="Ambient timer"');
  expect(renderToStaticMarkup(<ClockView />)).not.toContain('aria-label="Ambient timer"');
});
it.each([
  ["pomodoro", "short", "Short break"], ["animedoro", "long", "Watch time"],
  ["countdown", "focus", "Countdown"], ["stopwatch", "focus", "Stopwatch"],
] as const)("labels the %s %s segment", (mode, segment, label) => {
  settings.set({ ...DEFAULT_SETTINGS, timer: { ...DEFAULT_SETTINGS.timer, mode } });
  view.state.segment = segment;
  expect(renderToStaticMarkup(<AmbientTimer />)).toContain(`${label}: 25:00`);
});
it("uses shared controls and follows running state", () => {
  type Props = { children?: ReactNode; onClick?: () => void; "aria-label"?: string };
  const elements = (node: ReactNode): ReactElement<Props>[] => Children.toArray(node).flatMap(child =>
    isValidElement<Props>(child) ? [child, ...elements(child.props.children)] : []);
  const buttons = elements(AmbientTimer()).filter(e => e.type === "button");
  buttons[0].props.onClick!(); buttons[1].props.onClick!();
  expect(timerActions.toggle).toHaveBeenCalledOnce(); expect(timerActions.skip).toHaveBeenCalledOnce();
  expect(renderToStaticMarkup(<AmbientTimer />)).toContain('class="ambient-timer chrome"');
  view.running = true;
  expect(renderToStaticMarkup(<AmbientTimer />)).toContain('aria-label="Pause ambient timer"');
});
it("keeps legacy streak preferences and history without displaying a streak", () => {
  expect(renderToStaticMarkup(<DashboardStreak />)).toBe("");
  settings.set({ ...DEFAULT_SETTINGS, clock: { ...DEFAULT_SETTINGS.clock, showStreak: true } });
  expect(renderToStaticMarkup(<DashboardStreak />)).toBe("");
  stats.set({ chunks: [{ id: "today", kind: "focus", segment: "focus", start: Date.now() - 60_000, ms: 60_000, completed: false }], tasksDone: [] });
  expect(renderToStaticMarkup(<DashboardStreak />)).toBe("");
  expect(stats.get().chunks).toHaveLength(1);
});
it("migrates and validates the new preferences", () => {
  expect(sanitizeSettings({})).toMatchObject({ clock: { showStreak: false }, quotes: { randomCategory: false }, timer: { countdownRepeat: false, flipPalette: "midnight" } });
  expect(sanitizeSettings({ clock: { showStreak: "true" }, quotes: { randomCategory: "yes" }, timer: { countdownRepeat: 1, flipPalette: "url(evil)" } })).toMatchObject({ clock: { showStreak: false }, quotes: { randomCategory: false }, timer: { countdownRepeat: false, flipPalette: "midnight" } });
  const clean = sanitizeSettings({ clock: { showStreak: true }, quotes: { randomCategory: true }, timer: { countdownRepeat: true, flipPalette: "fern" } });
  expect(sanitizeSettings(JSON.parse(JSON.stringify(clean)))).toEqual(clean);
  expect(clean).toMatchObject({ clock: { showStreak: true }, quotes: { randomCategory: true }, timer: { countdownRepeat: true, flipPalette: "fern" } });
});
