import { expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { wallpaperIsLight } from "./Background";

const color = (id: string) => ({ kind: "color" as const, id });

it("keeps light text on a dark wallpaper even at full frost", () => {
  for (const strength of [0.35, 0.5, 1]) expect(wallpaperIsLight(color("#000000"), "frost", strength)).toBe(false);
  expect(wallpaperIsLight({ kind: "custom", id: "photo" }, "frost", 1)).toBe(false);
});

it("switches to ink when frost turns a mid-tone wallpaper truly pale", () => {
  expect(wallpaperIsLight(color("#777777"), "frost", 1)).toBe(true);
  expect(wallpaperIsLight(color("#555555"), "frost", 0)).toBe(false);
  expect(wallpaperIsLight(color("#555555"), "none", 1)).toBe(false);
});

it("never flips text for fog window, whose centre stays clear", () => {
  expect(wallpaperIsLight(color("#555555"), "fog-window", 1)).toBe(false);
  expect(wallpaperIsLight({ kind: "library", id: "cotton" }, "fog-window", 1)).toBe(true);
  expect(wallpaperIsLight(color("#ffffff"), "fog-window", 1)).toBe(true);
});

it("switches back to light text when Dim darkens a light wallpaper", () => {
  expect(wallpaperIsLight(color("#bfbfbf"), "none", 1)).toBe(true);
  expect(wallpaperIsLight(color("#bfbfbf"), "dim", 1)).toBe(false);
  expect(wallpaperIsLight(color("#ffffff"), "dim", 0)).toBe(true);
  expect(wallpaperIsLight({ kind: "library", id: "cotton" }, "dim", 1)).toBe(false);
});

it("keeps the frost estimate in step with the CSS that draws it", () => {
  const css = readFileSync(new URL("./Look.css", import.meta.url), "utf8");
  expect(css).toContain("background: rgb(255 255 255 / calc(6% + 22% * var(--fx)));");
  expect(css).toContain(".wall-fx-dim { background: rgb(0 0 0 / calc(10% + 55% * var(--fx))); }");
});

it("leaves Sketchbook task popovers fixed to the viewport", () => {
  const css = readFileSync(new URL("../index.css", import.meta.url), "utf8");
  const rule = css.split("\n").find((line) => line.includes('[data-look="sketch"] :is(') && line.includes("{ position: relative; }"))!;
  expect(rule).toBeTruthy();
  expect(rule).not.toContain(".tasks-popover");
});

it("lets reduced transparency beat every look's glass tokens", () => {
  const css = readFileSync(new URL("../index.css", import.meta.url), "utf8");
  const block = css.slice(css.indexOf("@media (prefers-reduced-transparency: reduce) {\n  :root"));
  expect(block).toMatch(/^@media \(prefers-reduced-transparency: reduce\) \{\n  :root, :root:root\[data-look\] \{ --surface: var\(--surface-solid\)/);
});

it("shows the reminder's keyboard controls while one has focus", () => {
  const css = readFileSync(new URL("./timer/TransitionScreen.css", import.meta.url), "utf8");
  expect(css).toMatch(/\.transition-screen \.sr-only:focus-within \{[^}]*clip: auto;[^}]*width: auto;|\.transition-screen \.sr-only:focus-within \{[^}]*width: auto;[^}]*clip: auto;/);
});

it("picks whichever ink reads better, judged in sRGB like the browser blends", () => {
  // Codex's case: Classic, black wallpaper, Frost at 50%. Light text keeps far better contrast.
  expect(wallpaperIsLight(color("#000000"), "frost", 0.5)).toBe(false);
  // A mid grey reads better with dark ink than with light.
  expect(wallpaperIsLight(color("#a0a0a0"), "none", 0)).toBe(true);
});

it("switches paper looks to light ink only when Dim really darkens the paper", () => {
  const any = color("#000000");
  for (const look of ["sketch", "companion", "sunrise"] as const) {
    expect(wallpaperIsLight(any, "none", 1, look)).toBe(true);
    expect(wallpaperIsLight(any, "dim", 0.3, look)).toBe(true);
    expect(wallpaperIsLight(any, "dim", 1, look)).toBe(false);
  }
});

it("gives dimmed paper looks a light ink token", () => {
  const css = readFileSync(new URL("../index.css", import.meta.url), "utf8");
  expect(css).toMatch(/html\.paper-dimmed:is\(\[data-look="sketch"\], \[data-look="companion"\], \[data-look="sunrise"\]\) \{\n  --on-bg: #fbf7ef;/);
});
