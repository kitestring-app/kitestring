import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
const next = readFileSync(new URL("./NextAction.css", import.meta.url), "utf8");
const credits = readFileSync(new URL("./Credits.css", import.meta.url), "utf8");
const global = readFileSync(new URL("../index.css", import.meta.url), "utf8");
it("13: the compact next action centers its text and button on the timer axis", () => {
  const block = next.match(/\.next-action\s*\{([^}]+)\}/)![1];
  expect(block).toMatch(/width:\s*min\(460px,\s*90vw\)/);
  expect(block).toMatch(/margin:\s*12px auto 0/);
  expect(block).toMatch(/text-align:\s*center/);
  expect(next).toMatch(/\.next-action \.btn\s*\{[^}]*justify-self:\s*center/);
});
it("14: every credits glass rule forbids growing and the footer stays on the right", () => {
  const rules = [...(global + credits).matchAll(/\.credits\s*\{([^}]+)\}/g)].map(match => match[1]);
  const flex = rules.flatMap(rule => [...rule.matchAll(/(?:^|;)\s*flex:\s*([^;]+)/g)].map(match => match[1]));
  expect(flex.length).toBeGreaterThan(0);
  for (const value of flex) expect(value.trim().split(/\s+/)[0]).toBe("0");
  expect(credits).toMatch(/margin:\s*0 0 0 auto/);
});
