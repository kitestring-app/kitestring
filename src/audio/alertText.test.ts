import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { ALERT_TEXT_MAX, cleanAlertText, customAlertText } from "./alertText";
import { DEFAULT_SETTINGS, sanitizeSettings } from "../state/settings";

const { validAlertText } = createRequire(import.meta.url)("../../desktop/alert-files.cjs") as { validAlertText: (text: unknown) => boolean };

describe("custom reminder text", () => {
  it("flattens to one trimmed line without control characters or a leading dash", () => {
    expect(cleanAlertText("  Stand up,\n\tdrink   water.  ")).toBe("Stand up, drink water.");
    expect(cleanAlertText("-o /tmp/out")).toBe("o /tmp/out");
    expect(cleanAlertText("-- - hi")).toBe("hi");
    expect(cleanAlertText("a b\u0000c")).toBe("a b c");
    expect(cleanAlertText("x".repeat(200))).toHaveLength(ALERT_TEXT_MAX);
    for (const raw of [undefined, null, 3, {}, "   ", "\n"]) expect(cleanAlertText(raw)).toBe("");
    // Emoji count as one character and are never cut into a lone surrogate.
    const emoji = cleanAlertText("x".repeat(139) + "☕🎉🎉");
    expect(Array.from(emoji)).toHaveLength(ALERT_TEXT_MAX);
    expect(emoji.endsWith("☕")).toBe(true);
    expect(validAlertText(cleanAlertText("🎉".repeat(200)))).toBe(true);
  });
  it("produces only text the native side accepts", () => {
    for (const raw of ["  Stand up,\n\tdrink water.", "-o /tmp/out", "a b", "x".repeat(200), "Zurück an die Arbeit ☕", " - " + "y ".repeat(90)]) {
      const clean = cleanAlertText(raw);
      expect(validAlertText(clean)).toBe(true);
    }
    expect(validAlertText(undefined)).toBe(true);
    for (const bad of ["", " x", "x\n", "-x", "x".repeat(141), 1, null]) expect(validAlertText(bad)).toBe(false);
  });
  it("picks the field for each boundary and empty means default", () => {
    const t = { focusDoneText: " Stretch. ", breakOverText: "" };
    expect(customAlertText(t, "focus-done")).toBe("Stretch.");
    expect(customAlertText(t, "break-over")).toBe("");
  });
  it("defaults to empty and is cleaned when settings load or import", () => {
    expect(DEFAULT_SETTINGS.timer.focusDoneText).toBe("");
    expect(DEFAULT_SETTINGS.timer.breakOverText).toBe("");
    const s = sanitizeSettings({ timer: { focusDoneText: "Walk\naround", breakOverText: 42 } });
    expect(s.timer.focusDoneText).toBe("Walk around");
    expect(s.timer.breakOverText).toBe("");
    expect(sanitizeSettings({ timer: {} }).timer.focusDoneText).toBe("");
  });
});
