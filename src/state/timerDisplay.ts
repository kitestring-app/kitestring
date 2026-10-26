import type { Settings } from "./settings";
import { fmt } from "./timerEngine";

/** Shared reading for the dashboard, Ambient, both floating renderers, title and tray. */
export function timerDisplay(choice: Settings["timer"]["display"], elapsed: number, remaining: number, total: number | null) {
  const countUp = choice === "elapsed" || total === null;
  return {
    display: choice === "hidden" ? "" : countUp ? fmt(elapsed, false, true) : fmt(remaining),
    hiddenTime: choice === "hidden",
    timeDescription: countUp ? `${Math.floor(elapsed / 60_000)} minutes elapsed` : `${Math.ceil(remaining / 60_000)} minutes left`,
  };
}
