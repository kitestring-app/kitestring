import { expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { glyphFor } from "./Glyph";

it("maps legacy emoji and ignores names inherited from Object.prototype", () => {
  expect(glyphFor("🎯")).toBe("target");
  expect(glyphFor("✍️")).toBe("pen-line");
  for (const value of ["constructor", "toString", "__proto__", "hasOwnProperty", "valueOf"]) expect(glyphFor(value)).toBeNull();
});

it("keeps compact timer faces on the panel text colour", () => {
  const css = readFileSync(new URL("./timer/styles.css", import.meta.url), "utf8");
  expect(css).toMatch(/\.timer-face\.is-compact:not\(\.face-flip\) \{ color: var\(--fg\);/);
  // Flip previews keep their palette's ink.
  expect(css).toMatch(/\.face-flip \{ color: var\(--flip-ink/);
});

it("lets reduced transparency reach the glass reminder backdrops", () => {
  const css = readFileSync(new URL("./timer/TransitionScreen.css", import.meta.url), "utf8");
  const media = css.slice(css.indexOf("@media (prefers-reduced-transparency: reduce)"));
  expect(media).toMatch(/^@media \(prefers-reduced-transparency: reduce\) \{\n  \.transition-screen:is\(\.glass-clear, \.glass-frosted\)::backdrop/);
});

it("shows a slider focus ring in Firefox as well as WebKit", () => {
  const css = readFileSync(new URL("../index.css", import.meta.url), "utf8");
  expect(css).toContain(".range:focus-visible::-webkit-slider-thumb { box-shadow: 0 0 0 3px var(--ring); }");
  expect(css).toContain(".range:focus-visible::-moz-range-thumb { box-shadow: 0 0 0 3px var(--ring); }");
});

it("gives the volume caption on a selected sound tile the tile's ink", () => {
  const css = readFileSync(new URL("./panels/SoundsPanel.css", import.meta.url), "utf8");
  expect(css).toContain(".sounds-panel .sound-tile.active label { color: var(--tile-on-fg); }");
});
