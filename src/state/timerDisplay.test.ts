import { expect, it } from "vitest";
import { timerAnnouncement, timerDisplay } from "./timerDisplay";
import { sanitizeSettings } from "./settings";

it("defaults old and invalid settings to Remaining and retains all display choices", () => {
  for (const display of [undefined, "bogus", null]) expect(sanitizeSettings({ timer: { display } }).timer.display).toBe("remaining");
  for (const display of ["remaining", "elapsed", "hidden"]) expect(sanitizeSettings({ timer: { display } }).timer.display).toBe(display);
});
it("uses countdown rounding for remaining and count-up rounding for elapsed, including overtime", () => {
  expect(timerDisplay("remaining", 1_500, 58_500, 60_000)).toMatchObject({ display: "00:59", hiddenTime: false, timeDescription: "1 minutes left" });
  expect(timerDisplay("elapsed", 1_500, 58_500, 60_000)).toMatchObject({ display: "00:01", timeDescription: "0 minutes elapsed" });
  expect(timerDisplay("elapsed", 65_500, 0, 60_000).display).toBe("01:05");
  expect(timerDisplay("remaining", 65_500, 0, null).display).toBe("01:05");
});
it("hides the shared visible reading but keeps a manual time description", () => {
  expect(timerDisplay("hidden", 1_500, 58_500, 60_000)).toEqual({ display: "", hiddenTime: true, timeDescription: "1 minutes left" });
});

it.each(["focus", "break", "cycle"] as const)("Hidden filters automatic %s speech for page and native alarms", phase => {
  expect(timerAnnouncement("hidden", { phase, minutes: 5 })).toEqual({ native: undefined, line: undefined, genericSpeech: true });
});
it.each(["remaining", "elapsed"] as const)("%s keeps the existing automatic page and native announcements", display => {
  expect(timerAnnouncement(display, { phase: "break", minutes: 5 })).toEqual({
    native: { phase: "break", minutes: 5 }, genericSpeech: false, line: "Break started. Five minutes.",
  });
  expect(timerAnnouncement(display, { phase: "focus", minutes: 25 })?.line).toBe("Focus started. Twenty-five minutes.");
  expect(timerAnnouncement(display, { phase: "cycle" })?.line).toBe("Cycle complete. Nice work.");
  expect(timerAnnouncement(display)).toEqual({ native: undefined, line: undefined, genericSpeech: false });
});
