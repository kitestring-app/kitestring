import { createStore } from "../lib/store";
import type { Segment } from "./timerEngine";

/** Extra menu-bar title options for the Mac app. Device-only, like the other menu bar preferences. */
export interface MenuBarText {
  task: boolean; // show the pinned next action, or the current task, during focus
  maxLength: number; // longest task name, in characters
  breakTime: boolean; // show the countdown during breaks
  seconds: boolean; // off shows whole minutes ("12m")
}
export const MENU_BAR_LENGTHS = [12, 16, 24, 32, 40] as const;
/** Defaults keep the menu bar exactly as it was before these options existed. */
export const DEFAULT_MENU_BAR_TEXT: MenuBarText = { task: false, maxLength: 24, breakTime: true, seconds: true };

export function sanitizeMenuBarText(stored: unknown): MenuBarText {
  const raw = (stored && typeof stored === "object" && !Array.isArray(stored) ? stored : {}) as Partial<Record<keyof MenuBarText, unknown>>;
  const d = DEFAULT_MENU_BAR_TEXT;
  const bool = (v: unknown, fallback: boolean) => (typeof v === "boolean" ? v : fallback);
  const length = Number(raw.maxLength);
  return {
    task: bool(raw.task, d.task),
    maxLength: Number.isFinite(length) ? Math.min(40, Math.max(8, Math.round(length))) : d.maxLength,
    breakTime: bool(raw.breakTime, d.breakTime),
    seconds: bool(raw.seconds, d.seconds),
  };
}
export const menuBarText = createStore<MenuBarText>("menuBarText", DEFAULT_MENU_BAR_TEXT, sanitizeMenuBarText);

/** One line, at most `max` characters (counted by code point so emoji are never split). */
export function clipName(text: string, max: number): string {
  const chars = Array.from(text.replace(/\s+/g, " ").trim());
  return chars.length <= max ? chars.join("") : `${chars.slice(0, max - 1).join("").trimEnd()}…`;
}

/** Whole minutes for a menu bar that only needs to change once a minute. */
export function minutesOnly(ms: number, countUp: boolean): string {
  const total = Math.max(0, countUp ? Math.floor(ms / 60_000) : Math.ceil(ms / 60_000));
  const h = Math.floor(total / 60), m = total % 60;
  return h > 0 ? `${h}h ${String(m).padStart(2, "0")}m` : `${m}m`;
}

export interface TrayInput {
  segment: Segment;
  running: boolean;
  elapsed: number;
  remaining: number;
  countUp: boolean;
  display: string; // the full mm:ss reading
  hiddenTime: boolean;
  hiddenStatus: string; // what hidden-time mode shows instead
  showNumbers: boolean;
  name: string; // pinned next action or current task title, "" when none
  prefs: MenuBarText;
}

/** The menu bar title. Idle stays empty so only the icon shows. */
export function trayStatus(v: TrayInput): string {
  if (v.hiddenTime) return v.hiddenStatus;
  const started = v.running || v.elapsed > 0;
  if (!started) return "";
  const focus = v.segment === "focus";
  const time = !v.showNumbers || (!focus && !v.prefs.breakTime) ? "" :
    v.prefs.seconds ? v.display : minutesOnly(v.countUp ? v.elapsed : v.remaining, v.countUp);
  const name = focus && v.prefs.task ? clipName(v.name, v.prefs.maxLength) : "";
  const paused = v.running ? "" : " (paused)";
  // A task name already says this is focus time, so it replaces the "Focus" word.
  if (name) return `${time ? `${time} · ` : ""}${name}${paused}`;
  return `${focus ? "Focus" : "Break"}${time ? ` ${time}` : ""}${paused}`;
}
