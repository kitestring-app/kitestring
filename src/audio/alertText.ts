// Custom reminder text for the end of a focus block or a break. One line per boundary,
// shared by the web notification, the native Mac alert, the companion and the spoken reminder.
import type { AlertKind } from "./alertSynth";

export const ALERT_TEXT_MAX = 140;

/** Default spoken reminder when no custom text is set. */
export const SPOKEN_REMINDER: Record<AlertKind, string> = {
  "focus-done": "Focus session done. Time for a break.",
  "break-over": "Break is over. Time to focus.",
};

/**
 * One plain line: control characters and line breaks become spaces, runs of spaces collapse,
 * a leading dash is dropped (native tools read "-x" as an option) and the length is capped.
 * Anything that is not a string becomes "", which means "use the default".
 */
export function cleanAlertText(raw: unknown): string {
  if (typeof raw !== "string") return "";
  const flat = raw.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, " ").replace(/\s+/g, " ").trim();
  return flat.replace(/^[-\s]+/, "").slice(0, ALERT_TEXT_MAX).trim();
}

interface CustomText { focusDoneText: string; breakOverText: string }

/** The cleaned custom text for this boundary, or "" when the default should be used. */
export const customAlertText = (timer: CustomText, kind: AlertKind) =>
  cleanAlertText(kind === "focus-done" ? timer.focusDoneText : timer.breakOverText);
