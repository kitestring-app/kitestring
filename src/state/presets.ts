import type { Settings } from "./settings";

export const PRESETS = [
  { id: "25-5-15", label: "25 · 5", lengths: { pomodoro: 25, short: 5, long: 15 }, longEvery: 4 },
  { id: "30-5-15", label: "30 · 5", lengths: { pomodoro: 30, short: 5, long: 15 }, longEvery: 4 },
  { id: "40-5-10", label: "40 · 5", lengths: { pomodoro: 40, short: 5, long: 10 }, longEvery: 4 },
  { id: "45-5-15", label: "45 · 5", lengths: { pomodoro: 45, short: 5, long: 15 }, longEvery: 4 },
  { id: "50-10-20", label: "50 · 10", lengths: { pomodoro: 50, short: 10, long: 20 }, longEvery: 4 },
  { id: "custom", label: "Custom", lengths: null, longEvery: 4 },
] as const;

export function matchPreset(lengths: Pick<Settings["timer"]["lengths"], "pomodoro" | "short" | "long">): (typeof PRESETS)[number]["id"] {
  return PRESETS.find((p) => p.lengths && p.lengths.pomodoro === lengths.pomodoro && p.lengths.short === lengths.short && p.lengths.long === lengths.long)?.id ?? "custom";
}
