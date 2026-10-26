import { describe, expect, it } from "vitest";
import { loopSamples, noiseSamples, sceneSamples } from "./procedural";

describe("generated samples", () => {
  it.each(["exam-hall", "thunderstorm", "record-static", "copper-chimes"] as const)(
    "%s events stay bounded, audible and silent at the loop seam", (kind) => {
      let seed = 321;
      const random = () => ((seed = (1664525 * seed + 1013904223) >>> 0) / 4294967296);
      for (const rate of [8000, 44100, 48000]) {
        const data = sceneSamples(rate, kind, random);
        expect(data).toHaveLength(rate * 32);
        expect(data.every(Number.isFinite)).toBe(true);
        expect(data.some((value) => Math.abs(value) > 0.01)).toBe(true);
        expect(data.every((value) => Math.abs(value) < 1)).toBe(true);
        expect([...data.slice(0, rate / 20), ...data.slice(-rate / 20)].every((value) => value === 0)).toBe(true);
        expect(Math.abs(data.reduce((sum, value) => sum + value, 0) / data.length)).toBeLessThan(0.01);
      }
    },
  );
  it.each(["white", "pink", "brown"] as const)(
    "produces finite, centered, non-silent %s noise",
    (color) => {
      let seed = 123;
      const random = () => {
        seed = (1664525 * seed + 1013904223) >>> 0;
        return seed / 4294967296;
      };
      const samples = noiseSamples(48000, color, random);
      expect(samples.every(Number.isFinite)).toBe(true);
      expect(
        Math.abs(samples.reduce((a, b) => a + b, 0) / samples.length),
      ).toBeLessThan(0.05);
      expect(samples.some((v) => Math.abs(v) > 0.1)).toBe(true);
      if (color === "brown") {
        const differences =
          samples
            .slice(1)
            .reduce((sum, v, i) => sum + Math.abs(v - samples[i]), 0) /
          (samples.length - 1);
        expect(differences).toBeLessThan(0.05);
      }
    },
  );
  it("crossfades tail into head then wraps continuously into the body", () => {
    const input = new Float32Array([1, 2, 3, 4, 5, 6, 7, 8]);
    expect([...loopSamples(input, 2)]).toEqual([3, 4, 5, 6, 7, 2]);
    expect([...input]).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect([...loopSamples(input, 0)]).toEqual([...input]);
  });
  it("handles short and empty samples without NaN", () => {
    expect(loopSamples(new Float32Array(), 100).length).toBe(0);
    expect([...loopSamples(new Float32Array([1, 2]), 1)]).toEqual([1]);
  });
});
