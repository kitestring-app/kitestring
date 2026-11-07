import { expect, it } from "vitest";
import { resolveScheme } from "./Background";
import { sanitizeSettings } from "../state/settings";

it("auto follows the wallpaper and never counts as forced", () => {
  expect(resolveScheme("auto", true, true, false)).toEqual({ light: true, forced: false });
  expect(resolveScheme("auto", false, false, false)).toEqual({ light: false, forced: false });
});

it("light and dark override the wallpaper and say so", () => {
  expect(resolveScheme("light", false, false, false)).toEqual({ light: true, forced: true });
  expect(resolveScheme("light", true, false, false)).toEqual({ light: true, forced: false });
  expect(resolveScheme("dark", true, false, false)).toEqual({ light: false, forced: true });
  expect(resolveScheme("dark", false, false, false)).toEqual({ light: false, forced: false });
});

it("system follows the OS appearance", () => {
  expect(resolveScheme("system", false, false, false)).toEqual({ light: true, forced: true });
  expect(resolveScheme("system", false, true, false)).toEqual({ light: false, forced: false });
  expect(resolveScheme("system", true, true, false)).toEqual({ light: false, forced: true });
});

it("paper looks ignore a stored scheme", () => {
  for (const scheme of ["system", "light", "dark"] as const) {
    expect(resolveScheme(scheme, false, true, true)).toEqual({ light: false, forced: false });
    expect(resolveScheme(scheme, true, true, true)).toEqual({ light: true, forced: false });
  }
});

it("sanitises the scheme and defaults old setups to auto", () => {
  expect(sanitizeSettings({ appearance: { look: "classic" } }).appearance.scheme).toBe("auto");
  expect(sanitizeSettings({ appearance: { look: "classic", scheme: "neon" } }).appearance.scheme).toBe("auto");
  expect(sanitizeSettings({ appearance: { look: "classic", scheme: "system" } }).appearance.scheme).toBe("system");
  expect(sanitizeSettings(null).appearance.scheme).toBe("auto");
});
