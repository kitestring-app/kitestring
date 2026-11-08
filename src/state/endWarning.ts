import type { Settings } from "./settings";
import type { TimerState } from "./timerEngine";

/**
 * When to give the soft heads-up before a focus block ends, as a wall-clock time, or null for none.
 * Only running focus blocks get one, and only when the block is more than twice as long as the lead,
 * so a short block never starts with a warning.
 */
export function endWarningAt(s: TimerState, total: number | null, t: Pick<Settings["timer"], "warnBefore">): number | null {
  if (!t.warnBefore || s.segment !== "focus" || s.startedAt === null || total === null || s.boundary) return null;
  const lead = t.warnBefore * 60_000;
  if (total <= lead * 2) return null;
  return s.startedAt - s.elapsedBefore + total - lead;
}

const WORDS = ["Zero", "One", "Two", "Three", "Four", "Five"];
/** Hidden time never hears a number, only that the block is nearly over. */
export function endWarningLine(minutes: number, display: Settings["timer"]["display"]) {
  if (display === "hidden") return "Focus is nearly done.";
  return `${WORDS[minutes] ?? minutes} ${minutes === 1 ? "minute" : "minutes"} left.`;
}
