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

/** Filter automatic speech at delivery time as well as when a native alarm is armed. */
export function timerAnnouncement(choice: Settings["timer"]["display"], announcement?: DesktopAnnouncement) {
  const native = choice === "hidden" ? undefined : announcement;
  return {
    native,
    genericSpeech: choice === "hidden",
    line: !native ? undefined : native.phase === "cycle" ? "Cycle complete. Nice work." :
      `${native.phase === "focus" ? "Focus" : "Break"} started. ${spokenMinutes(native.minutes!)}`,
  };
}

function spokenMinutes(minutes: number) {
  const small = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
  const tens = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];
  const text = !Number.isInteger(minutes) || minutes >= 100 ? String(minutes) : minutes < 20 ? small[minutes]! :
    tens[Math.floor(minutes / 10)] + (minutes % 10 ? `-${small[minutes % 10]}` : "");
  return `${text[0]!.toUpperCase()}${text.slice(1)} ${minutes === 1 ? "minute" : "minutes"}.`;
}
