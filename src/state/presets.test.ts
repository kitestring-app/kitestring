import { describe, expect, it } from "vitest";
import { matchPreset, PRESETS } from "./presets";

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
});
