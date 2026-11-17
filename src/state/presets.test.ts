import { describe, expect, it } from "vitest";
import { CHESS_PRESET_ID, CHESS_THEME_ID, matchPreset, PRESETS, themeTimerPatch } from "./presets";

describe("Pomodoro presets", () => {
  it("matches all three lengths and uses four sessions for every preset", () => {
    for (const p of PRESETS) {
      if (!p.lengths) continue;
      expect(matchPreset(p.lengths)).toBe(p.id);
      expect(p.longEvery).toBe(4);
      expect(matchPreset({ ...p.lengths, long: p.lengths.long + 1 })).toBe("custom");
      expect(matchPreset({ ...p.lengths, short: p.lengths.short + 1 })).toBe("custom");
    }
  });
  it("treats arbitrary and fractional focus lengths as custom", () => {
    expect(matchPreset({ pomodoro: 26, short: 5, long: 15 })).toBe("custom");
    expect(matchPreset({ pomodoro: 25.5, short: 5, long: 15 })).toBe("custom");
    expect(PRESETS.at(-1)?.label).toBe("Custom");
  });
  it("ships the featured 45-12-25 preset and the chess wallpaper patch returns it", () => {
    const row = PRESETS.find((p) => p.id === CHESS_PRESET_ID);
    expect(row).toBeDefined();
    expect(row?.label).toBe("45 · 12");
    expect(row?.lengths).toEqual({ pomodoro: 45, short: 12, long: 25 });
    expect(row?.longEvery).toBe(4);
    expect(themeTimerPatch(CHESS_THEME_ID)).toEqual({ lengths: { pomodoro: 45, short: 12, long: 25 }, longEvery: 4 });
  });
  it("matches the 45/12/25 preset and keeps near misses custom", () => {
    expect(matchPreset({ pomodoro: 45, short: 12, long: 25 })).toBe(CHESS_PRESET_ID);
    for (const combo of [
      { pomodoro: 45, short: 12, long: 26 },
      { pomodoro: 45, short: 13, long: 25 },
      { pomodoro: 44, short: 12, long: 25 },
    ]) expect(matchPreset(combo)).toBe("custom");
  });
});

describe("themeTimerPatch", () => {
  it("returns the chess preset with exactly pomodoro/short/long and longEvery 4", () => {
    const patch = themeTimerPatch(CHESS_THEME_ID);
    expect(patch?.lengths).toEqual({ pomodoro: 45, short: 12, long: 25 });
    expect(patch?.longEvery).toBe(4);
    expect(Object.keys(patch?.lengths ?? {}).sort()).toEqual(["long", "pomodoro", "short"]);
    expect(patch?.lengths).not.toHaveProperty("countdown");
    const row = PRESETS.find((p) => p.id === CHESS_PRESET_ID);
    expect(patch).toEqual({ lengths: row?.lengths, longEvery: row?.longEvery });
  });
  it("returns null for every non-chess theme id", () => {
    for (const id of ["", "custom", "dusk-glass", "not-a-real-theme"]) expect(themeTimerPatch(id)).toBeNull();
  });
});
