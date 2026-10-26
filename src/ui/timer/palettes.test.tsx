import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { FLIP_PALETTES } from "./palettes";
import type { FlipPaletteId } from "./palettes";
import { FlipFace } from "./styles";

it("renders eight distinct original palettes with readable tile contrast", () => {
  expect(Object.keys(FLIP_PALETTES)).toHaveLength(8);
  expect(new Set(Object.values(FLIP_PALETTES).map(p => p.tile)).size).toBe(8);
  const luminance = (hex: string) => {
    const rgb = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(v => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
    return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
  };
  for (const id of Object.keys(FLIP_PALETTES) as FlipPaletteId[]) {
    const p = FLIP_PALETTES[id];
    const html = renderToStaticMarkup(<FlipFace display="25:00" progress={0} showNumbers palette={id} />);
    expect(html).toContain(`--flip-tile:${p.tile}`); expect(html).toContain(`--flip-ink:${p.ink}`);
    const values = [luminance(p.tile), luminance(p.ink)].sort((a, b) => b - a);
    expect((values[0] + 0.05) / (values[1] + 0.05)).toBeGreaterThan(4.5);
  }
});
