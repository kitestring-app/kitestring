import { expect, it } from "vitest";
import { DEFAULT_MENU_BAR_TEXT, NATIVE_STATUS_LIMIT, clipName, minutesOnly, sanitizeMenuBarText, trayStatus, type TrayInput } from "./menuBar";

const base: TrayInput = { segment: "focus", running: true, elapsed: 28_000, remaining: 272_000, countUp: false, display: "04:32",
  hiddenTime: false, hiddenStatus: "Focus · Running", showNumbers: true, name: "Write the intro", prefs: DEFAULT_MENU_BAR_TEXT };
const on = { ...DEFAULT_MENU_BAR_TEXT, task: true };

it("defaults keep the original menu bar text", () => {
  expect(trayStatus(base)).toBe("Focus 04:32");
  expect(trayStatus({ ...base, segment: "short" })).toBe("Break 04:32");
  expect(trayStatus({ ...base, running: false })).toBe("Focus 04:32 (paused)");
  expect(trayStatus({ ...base, running: false, elapsed: 0 })).toBe("");
  expect(trayStatus({ ...base, hiddenTime: true })).toBe("Focus · Running");
});

it("shows the task name during focus only, clipped to the chosen length", () => {
  expect(trayStatus({ ...base, prefs: on })).toBe("04:32 · Write the intro");
  expect(trayStatus({ ...base, prefs: { ...on, maxLength: 8 } })).toBe("04:32 · Write t…");
  expect(trayStatus({ ...base, prefs: on, running: false })).toBe("04:32 · Write the intro (paused)");
  expect(trayStatus({ ...base, prefs: on, showNumbers: false })).toBe("Write the intro");
  expect(trayStatus({ ...base, prefs: on, segment: "long" })).toBe("Break 04:32");
  expect(trayStatus({ ...base, prefs: on, name: "   " })).toBe("Focus 04:32");
  expect(trayStatus({ ...base, prefs: on, running: false, elapsed: 0 })).toBe("");
});

it("can hide break time and seconds", () => {
  expect(trayStatus({ ...base, segment: "short", prefs: { ...on, breakTime: false } })).toBe("Break");
  expect(trayStatus({ ...base, segment: "short", running: false, prefs: { ...on, breakTime: false } })).toBe("Break (paused)");
  expect(trayStatus({ ...base, prefs: { ...on, seconds: false } })).toBe("5m · Write the intro");
  expect(trayStatus({ ...base, countUp: true, prefs: { ...DEFAULT_MENU_BAR_TEXT, seconds: false } })).toBe("Focus 0m");
});

it("formats whole minutes and clips names safely", () => {
  expect(minutesOnly(272_000, false)).toBe("5m");
  expect(minutesOnly(240_000, false)).toBe("4m");
  expect(minutesOnly(299_000, true)).toBe("4m");
  expect(minutesOnly(65 * 60_000, false)).toBe("1h 05m");
  expect(minutesOnly(-5, false)).toBe("0m");
  expect(clipName("  a\n  b  ", 10)).toBe("a b");
  expect(clipName("🪁🪁🪁🪁🪁🪁🪁🪁🪁🪁", 8)).toBe("🪁🪁🪁🪁🪁🪁🪁…");
});

it("sanitizes stored preferences", () => {
  expect(sanitizeMenuBarText(null)).toEqual(DEFAULT_MENU_BAR_TEXT);
  expect(sanitizeMenuBarText({ task: "yes", maxLength: 500, breakTime: false, seconds: 1 })).toEqual({ ...DEFAULT_MENU_BAR_TEXT, maxLength: 40, breakTime: false });
  expect(sanitizeMenuBarText({ maxLength: 2 }).maxLength).toBe(8);
  expect(sanitizeMenuBarText({ maxLength: "x" }).maxLength).toBe(24);
});

it("keeps the whole title within the native limit, even for emoji-heavy names", () => {
  const emoji = "🪁".repeat(40);
  const title = trayStatus({ ...base, running: false, name: emoji, prefs: { ...on, maxLength: 40 } });
  expect(title.length).toBeLessThanOrEqual(NATIVE_STATUS_LIMIT);
  expect(title.startsWith("04:32 · 🪁")).toBe(true);
  expect(title.endsWith("… (paused)")).toBe(true);
  expect(title).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/); // no split surrogate pair
  const plain = trayStatus({ ...base, running: false, name: "x".repeat(40), prefs: { ...on, maxLength: 40 } });
  expect(plain).toBe(`04:32 · ${"x".repeat(40)} (paused)`);
  expect(clipName("🪁🪁🪁", 10, 1)).toBe("");
});
