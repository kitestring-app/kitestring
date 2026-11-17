// Self-authored line-art chess pieces for the Chessboard look. CC0-compatible. NOT Lucide.
// Staunton silhouettes (public-domain functional shapes, 1849); drawn here, not copied.
import type { GlyphElement } from "./glyphs.data";

export const LOOK_GLYPH_DATA = {
  "chess-pawn": [
    ["circle", { cx: "12", cy: "5", r: "2.2" }],
    ["path", { d: "M9 9.4h6" }],
    ["path", { d: "M10.2 9c-.2 2.4-1.6 3.8-2.8 5.4-.7.9-1 1.9-1 3h11.2c0-1.1-.3-2.1-1-3-1.2-1.6-2.6-3-2.8-5.4" }],
    ["path", { d: "M5.6 18.8h12.8" }],
    ["path", { d: "M4.6 21h14.8" }],
  ],
  "chess-knight": [
    ["path", { d: "M8.4 21h8.2" }],
    ["path", { d: "M8.2 19h8.6" }],
    ["path", { d: "M9.6 18.6c-1.6-2.2-1.4-5.2.2-7.4 1-1.4 2-2.4 2-4.2 0-1.6-.7-2.8-1.8-3.8 3 .2 5.2 1.8 6 4.4.5 1.7.2 3-.6 4.4l1.6.9-2.2.8c-.6 2-1.8 3.6-3.4 4.9Z" }],
    ["path", { d: "M9.4 8.6h.01" }],
  ],
  "chess-bishop": [
    ["circle", { cx: "12", cy: "4.2", r: "1.5" }],
    ["path", { d: "M12 5.7c1.8 1.4 2.8 3 2.8 4.8 0 1.6-.8 2.9-2.2 3.9l1.4 2.2H9.9l1.4-2.2c-1.4-1-2.2-2.3-2.2-3.9 0-1.8 1-3.4 2.8-4.8Z" }],
    ["path", { d: "M12.4 7.6 10.6 10" }],
    ["path", { d: "M9.4 12.6h5.2" }],
    ["path", { d: "M10 13c-.2 2-.9 3.4-1.8 4.6h7.6c-.9-1.2-1.6-2.6-1.8-4.6" }],
    ["path", { d: "M7.4 18.8h9.2" }],
    ["path", { d: "M6.6 21h10.8" }],
  ],
  "chess-rook": [
    ["path", { d: "M7.4 4.2h2v2h1.6v-2h2v2h1.6v-2h2v6H7.4Z" }],
    ["path", { d: "M8.6 10.2v5.4" }],
    ["path", { d: "M15.4 10.2v5.4" }],
    ["path", { d: "M7.6 15.6h8.8" }],
    ["path", { d: "M9 15.8c-.4 1.9-1.1 3.2-2 4.4h10c-.9-1.2-1.6-2.5-2-4.4" }],
    ["path", { d: "M6.4 21h11.2" }],
  ],
  "chess-queen": [
    ["circle", { cx: "12", cy: "3.2", r: "1.3" }],
    ["path", { d: "M8.2 6.4 7 4.8l2.4 1.2L12 4l2.6 2 2.4-1.2-1.2 1.6" }],
    ["path", { d: "M8.4 6.6c-.6 2-1.2 3.6-1.6 5.6h10.4c-.4-2-1-3.6-1.6-5.6" }],
    ["path", { d: "M8.6 12.4h6.8" }],
    ["path", { d: "M9.4 12.8c-.3 2-1 3.4-1.8 4.6h8.8c-.8-1.2-1.5-2.6-1.8-4.6" }],
    ["path", { d: "M7 18.8h10" }],
    ["path", { d: "M6.2 21h11.6" }],
  ],
  "chess-king": [
    ["path", { d: "M12 2v4" }],
    ["path", { d: "M10 4h4" }],
    ["path", { d: "M8.4 7.2c-.6 1.6-1 3.4-1 5.2h9.2c0-1.8-.4-3.6-1-5.2" }],
    ["path", { d: "M8.6 12.6h6.8" }],
    ["path", { d: "M9.4 13c-.3 2-1 3.4-1.8 4.6h8.8c-.8-1.2-1.5-2.6-1.8-4.6" }],
    ["path", { d: "M7 18.8h10" }],
    ["path", { d: "M6.2 21h11.6" }],
  ],
} satisfies Record<string, GlyphElement[]>;
