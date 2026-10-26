import { expect, it } from "vitest";
import { dailyQuoteCategory, QUOTE_CATEGORIES, quoteForDay } from "./quotes";

it("keeps the selected category when shuffle is off", () => {
  expect(dailyQuoteCategory("calm", new Date(2026, 9, 24), false)).toBe("calm");
});
it("shuffles across real categories and stays stable through the local day", () => {
  const selected = new Set<string>();
  for (let day = 1; day <= 60; day++) {
    const morning = new Date(2026, 9, day, 1), evening = new Date(2026, 9, day, 23);
    const category = dailyQuoteCategory("calm", morning, true);
    expect(dailyQuoteCategory("all", evening, true)).toBe(category);
    expect(quoteForDay(category, morning)?.category).toBe(category);
    selected.add(category);
  }
  expect([...selected].sort()).toEqual(QUOTE_CATEGORIES.filter(c => c.id !== "all").map(c => c.id).sort());
});
