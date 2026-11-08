import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { AA, contrastRatio, floatingIsDark, floatingSurfaceAlpha, GLASS_RANGE, minSurfaceAlpha, parseColor } from "./floatingScheme";
import { paperIsDark } from "./Background";

describe("floating timer scheme", () => {
  it("matches the Mac's glass on Auto and System, and honours a forced scheme", () => {
    expect(floatingIsDark("auto", true)).toBe(true);
    expect(floatingIsDark("auto", false)).toBe(false);
    expect(floatingIsDark("system", true)).toBe(true);
    expect(floatingIsDark("light", true)).toBe(false);
    expect(floatingIsDark("dark", false)).toBe(true);
  });

  it("paper looks keep light paper on Auto and turn to night paper on Dark or a dark System", () => {
    expect(paperIsDark("auto", true)).toBe(false);
    expect(paperIsDark("system", true)).toBe(true);
    expect(paperIsDark("system", false)).toBe(false);
    expect(paperIsDark("dark", false)).toBe(true);
    expect(paperIsDark("light", true)).toBe(false);
  });

  it("parses the colour formats getComputedStyle returns", () => {
    expect(parseColor("#fff")).toEqual([1, 1, 1]);
    expect(parseColor(" rgb(255, 0, 51) ")).toEqual([1, 0, 0.2]);
    expect(parseColor("rgb(255 255 255 / 55%)")).toEqual([1, 1, 1]);
    expect(parseColor("transparent")).toBeNull();
  });

  it("keeps a clear glass when the ink already reads on the glass the OS draws", () => {
    // Pure white ink over the darkest-to-mid dark glass passes on its own.
    expect(minSurfaceAlpha([0, 0, 0], [[1, 1, 1]], GLASS_RANGE.dark)).toBeLessThan(0.2);
  });

  it("raises the surface when dark ink sits on dark glass (the Sketchbook bug)", () => {
    const alpha = floatingSurfaceAlpha({ chosen: 0.12, osDark: true, surface: "#fffdf6", inks: ["#33302b", "#6a6359"] });
    expect(alpha).toBeGreaterThan(0.6);
    // Never below what the person chose.
    expect(floatingSurfaceAlpha({ chosen: 1, osDark: false, surface: "#fffdf6", inks: ["#33302b"] })).toBe(1);
  });

  it("falls back to a near-solid surface when tokens can't be read", () => {
    expect(floatingSurfaceAlpha({ chosen: 0.12, osDark: true, surface: "", inks: [] })).toBe(0.9);
  });
});

/** Every look in every scheme, read straight from index.css, must reach AA on both kinds of Mac glass. */
describe("every look's floating timer passes WCAG AA on any desktop", () => {
  const css = readFileSync(new URL("../index.css", import.meta.url), "utf8");
  const block = (selector: string) => {
    const at = css.indexOf(`${selector} {`);
    if (at < 0) throw new Error(`missing ${selector}`);
    return Object.fromEntries([...css.slice(at, css.indexOf("\n}", at)).matchAll(/--([\w-]+):\s*(#[0-9a-f]{3,6})\b/gi)].map(m => [m[1], m[2]]));
  };
  const root = block(":root");
  const looks: Record<string, { dark: Record<string, string>; light: Record<string, string> }> = {
    classic: { dark: root, light: { ...root, ...block('html.theme-light:is(:not([data-look]), [data-look="classic"])') } },
    glass: { dark: { ...root, ...block(':root[data-look="glass"]') }, light: { ...root, ...block(':root[data-look="glass"]'), ...block('html.theme-light[data-look="glass"]') } },
    ...Object.fromEntries(["sketch", "companion", "sunrise"].map(look => {
      const day = { ...root, ...block(`:root[data-look="${look}"]`) };
      return [look, { light: day, dark: { ...day, ...block(`html.paper-dark[data-look="${look}"]`) } }];
    })),
  };
  for (const [look, schemes] of Object.entries(looks)) for (const scheme of ["dark", "light"] as const) for (const os of ["dark", "light"] as const) {
    it(`${look}, ${scheme} scheme, ${os} Mac`, () => {
      const t = schemes[scheme];
      const alpha = floatingSurfaceAlpha({ chosen: 0.12, osDark: os === "dark", surface: t["surface-solid"], inks: [t.fg, t["fg-dim"]] });
      const surface = parseColor(t["surface-solid"])!;
      for (const glass of GLASS_RANGE[os]) for (const ink of [t.fg, t["fg-dim"]]) {
        const bg = glass.map((c, i) => c * (1 - alpha) + surface[i] * alpha) as [number, number, number];
        expect(contrastRatio(parseColor(ink)!, bg)).toBeGreaterThanOrEqual(AA);
      }
    });
  }
});
