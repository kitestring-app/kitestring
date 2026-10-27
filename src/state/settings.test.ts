import { describe, expect, it } from "vitest";
import { effectiveDefaultTab, sanitizeSettings } from "./settings";
import { BACKUP_FORMAT, parseBackup } from "../lib/backup";

describe("effective default settings tab", () => {
  it("temporarily treats a hidden Stats default as recent without rewriting the preference", () => {
    const extras = { hideStats: true, defaultTab: "stats" as const };
    expect(effectiveDefaultTab(extras)).toBe("recent");
    expect(extras.defaultTab).toBe("stats");
    expect(effectiveDefaultTab({ ...extras, hideStats: false })).toBe("stats");
  });
  it.each(["recent", "themes", "clock", "timer", "quotes", "extras", "data", "about"] as const)("preserves the %s preference with Stats hidden", defaultTab => {
    expect(effectiveDefaultTab({ hideStats: true, defaultTab })).toBe(defaultTab);
  });
});

describe("interruption preference", () => {
  it("defaults on for old settings and sanitizes non-booleans", () => {
    expect(sanitizeSettings({}).timer.interruptionPrompt).toBe(true);
    for (const value of [undefined, null, 0, "false", {}, []]) {
      expect(sanitizeSettings({ timer: { interruptionPrompt: value } }).timer.interruptionPrompt).toBe(true);
    }
  });
  it.each([true, false])("preserves %s through settings and backups", interruptionPrompt => {
    const clean = sanitizeSettings({ timer: { interruptionPrompt } });
    const { data } = parseBackup(JSON.stringify({ format: BACKUP_FORMAT, version: 1, data: { settings: clean } }));
    expect(sanitizeSettings(data.settings).timer.interruptionPrompt).toBe(interruptionPrompt);
  });
});

describe("auto-run settings", () => {
  it.each([true, false, undefined, "true", null])("migrates the legacy autoStart flag %s", (autoStart) => {
    const t = sanitizeSettings({ timer: { autoStart } }).timer;
    expect(t.autoRun).toBe(autoStart === true ? "always" : "off");
    expect(t).not.toHaveProperty("autoStart");
  });
  it.each(["off", "cycle", "always"] as const)("preserves %s over the legacy flag", (autoRun) => {
    expect(sanitizeSettings({ timer: { autoRun, autoStart: true } }).timer.autoRun).toBe(autoRun);
  });
  it.each(["invalid", null, true, {}, []])("rejects invalid auto-run values %s", (autoRun) => {
    expect(sanitizeSettings({ timer: { autoRun } }).timer.autoRun).toBe("off");
  });
  it("migrates old backups and preserves new backups through parsing and sanitizing", () => {
    for (const timer of [{ autoStart: true }, { autoStart: false }, { autoRun: "cycle" }]) {
      const { data } = parseBackup(JSON.stringify({ format: BACKUP_FORMAT, version: 1, data: { settings: { timer } } }));
      const clean = sanitizeSettings(data.settings);
      expect(clean.timer.autoRun).toBe("autoRun" in timer ? "cycle" : timer.autoStart ? "always" : "off");
      expect(sanitizeSettings(JSON.parse(JSON.stringify(clean)))).toEqual(clean);
    }
  });
});

describe("transition preferences", () => {
  it("enables all three reminders for old settings", () => {
    const t = sanitizeSettings({ timer: { lengths: { pomodoro: 40 } } }).timer;
    expect(t).toMatchObject({ takeover: true, speak: true, bringToFront: true });
    expect(t.lengths.pomodoro).toBe(40);
  });
  it("preserves explicit false and rejects non-booleans", () => {
    expect(sanitizeSettings({ timer: { takeover: false, speak: false, bringToFront: false } }).timer)
      .toMatchObject({ takeover: false, speak: false, bringToFront: false });
    for (const invalid of [null, 0, "false", {}, []]) {
      expect(sanitizeSettings({ timer: { takeover: invalid, speak: invalid, bringToFront: invalid } }).timer)
        .toMatchObject({ takeover: true, speak: true, bringToFront: true });
    }
  });
});


describe("floating timer preferences", () => {
  it("drops device-only preferences from synced settings and backups", () => {
    const extras = { floatingTimer: true, floatingOnTop: false, menuBarTime: false, showMenuBar: false };
    const { data } = parseBackup(JSON.stringify({ format: BACKUP_FORMAT, version: 1, data: { settings: { extras } } }));
    for (const value of [sanitizeSettings({ extras }), sanitizeSettings(data.settings)]) {
      for (const key of Object.keys(extras)) expect(value.extras).not.toHaveProperty(key);
    }
  });
});

it.each(["signature", "bell", "chime", "digital", "wood", "none"] as const)("migrates the legacy %s selection into both event sounds", alertSound => {
  const migrated = sanitizeSettings({ timer: { alertSound } }).timer;
  expect(migrated.focusDoneSound).toBe(alertSound);
  expect(migrated.breakOverSound).toBe(alertSound);
  expect(migrated.ticking).toBe("off");
});
it("retains independent event choices on reload and import", () => {
  const migrated = sanitizeSettings({ timer: { alertSound: "wood", focusDoneSound: "none", breakOverSound: "digital", ticking: "both", tickStyle: "wood", tickVolume: 0.4 } });
  expect(migrated.timer).toMatchObject({ focusDoneSound: "none", breakOverSound: "digital", ticking: "both", tickStyle: "wood", tickVolume: 0.4 });
  expect(sanitizeSettings(migrated)).toEqual(migrated);
});
