import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { THEMES } from "../data/themes";
const css = readFileSync(new URL("../index.css", import.meta.url), "utf8");
type RGB = number[];
const rgb = (hex: string): RGB => [0, 2, 4].map(i => parseInt(hex.replace("#", "").slice(i, i + 2), 16));
const lum = (c: RGB) => c.map(v => v / 255).map(v => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4).reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0);
const ratio = (a: RGB, b: RGB) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
/** The token block for one selector, so each look is read from its own definition. */
function block(selector: string) {
  const start = css.indexOf(`${selector} {`);
  expect(start, selector).toBeGreaterThanOrEqual(0);
  return css.slice(start, css.indexOf("}", start));
}
const surface = (b: string) => { const m = b.match(/--surface: rgb\((\d+) (\d+) (\d+) \/ (\d+)%\)/)!; return { base: m.slice(1, 4).map(Number), alpha: Number(m[4]) / 100 }; };
const hex = (b: string, token: string) => b.match(new RegExp(`--${token}: (#[a-f0-9]{6});`, "i"))![1];
const over = (s: { base: number[]; alpha: number }, under: RGB) => under.map((v, i) => s.base[i] * s.alpha + v * (1 - s.alpha));
const colorsOf = (id: string) => [...THEMES.find(t => t.id === id)!.background.matchAll(/#[a-f0-9]{6}\b/gi)].map(m => rgb(m[0]));

it.each(["cotton", "midnight", "autumn"])("Classic chrome text meets AA over %s and the all-white worst case", id => {
  const b = block(":root"), s = surface(b);
  for (const token of ["fg", "fg-dim", "fg-faint"]) for (const under of [...colorsOf(id), [255, 255, 255]]) {
    expect(ratio(rgb(hex(b, token)), over(s, under)), `${token} over ${under}`).toBeGreaterThanOrEqual(4.5);
  }
});

it("Glass on a light wallpaper uses dark ink on light frost, AA over white and over dark patches", () => {
  const b = block('html.theme-light[data-look="glass"]'), s = surface(b);
  for (const token of ["fg", "fg-dim", "fg-faint"]) for (const under of [[255, 255, 255], [29, 46, 38], [120, 130, 140]]) {
    expect(ratio(rgb(hex(b, token)), over(s, under)), `${token} over ${under}`).toBeGreaterThanOrEqual(4.5);
  }
});

// Glass is light frost with white ink, as in the approved mockup. Over truly dark wallpaper the text meets AA on its own;
// over mid-tone wallpaper it relies on the soft text shadow, and over light wallpaper the look switches to dark ink.
it.each(THEMES.filter(t => !t.light && t.background.includes("#")).map(t => t.id).slice(0, 12))("Glass on dark wallpaper %s keeps white chrome text at AA", id => {
  const b = block(':root[data-look="glass"]'), s = surface(b);
  for (const under of colorsOf(id).filter(c => lum(c) < 0.12)) {
    expect(ratio(rgb(hex(b, "fg")), over(s, under)), `fg over ${under}`).toBeGreaterThanOrEqual(4.5);
  }
});

it("Glass keeps a text shadow on its surfaces for mid-tone wallpaper", () => {
  expect(css).toMatch(/html:not\(\.theme-light\)\[data-look="glass"\] :is\(\.panel[^{]*\{ text-shadow: 0 1px 2px rgb\(0 0 0 \/ 28%\)/);
});
