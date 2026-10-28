import { expect, it } from "vitest";
import { breathingFrame } from "./breathing";

it("paces ordinary breathing without holds and supports a slower cycle", () => {
  expect(breathingFrame(0, 1, "even", 1).phase).toBe("Breathe in");
  expect(breathingFrame(4000, 1, "even", 1).phase).toBe("Breathe out");
  expect(breathingFrame(10000, 1, "even", 1).phase).toBe("Breathe in");
  expect(breathingFrame(4000, 1, "even", 1.5).phase).toBe("Breathe in");
  expect(breathingFrame(6000, 1, "even", 1.5).phase).toBe("Breathe out");
});
it("cycles two short inhales followed by a long exhale", () => {
  expect(breathingFrame(0, 5, "sigh", 1).phase).toBe("Breathe in");
  expect(breathingFrame(2000, 5, "sigh", 1).phase).toBe("A little more in");
  expect(breathingFrame(3000, 5, "sigh", 1).phase).toBe("Breathe out");
  expect(breathingFrame(10000, 5, "sigh", 1).phase).toBe("Breathe in");
});
it.each([1, 5] as const)("ends a %s minute guide at its deadline, including after suspension", minutes => {
  expect(breathingFrame(minutes * 60000 - 1, minutes, "sigh", 1).done).toBe(false);
  expect(breathingFrame(minutes * 60000, minutes, "sigh", 1)).toMatchObject({ done: true, remaining: 0 });
  expect(breathingFrame(9999999, minutes, "even", 1.5)).toMatchObject({ done: true, remaining: 0 });
});
