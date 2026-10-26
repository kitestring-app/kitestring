import type { Settings } from "../../state/settings";

export type FlipPaletteId = Settings["timer"]["flipPalette"];
// Original colours; each tile pair keeps readable contrast in light and dark themes.
export const FLIP_PALETTES: Record<FlipPaletteId, { name: string; tile: string; ink: string }> = {
  midnight: { name: "Midnight", tile: "#171c31", ink: "#f2f4ff" },
  porcelain: { name: "Porcelain", tile: "#e8edf1", ink: "#273447" },
  mulberry: { name: "Mulberry", tile: "#492c49", ink: "#ffdfef" },
  lagoon: { name: "Lagoon", tile: "#164658", ink: "#d0f4ff" },
  fern: { name: "Fern", tile: "#304737", ink: "#e1f4cc" },
  slate: { name: "Slate", tile: "#3b4051", ink: "#eeecfa" },
  ember: { name: "Ember", tile: "#60382a", ink: "#ffe3c4" },
  sandstone: { name: "Sandstone", tile: "#d9c6a5", ink: "#382f27" },
};
