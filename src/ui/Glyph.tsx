import { createElement } from "react";
import { GLYPH_DATA, type GlyphName } from "./glyphs.data";

export type { GlyphName };

/** One icon from the app's line set. Stroke weight follows the look (--icon-stroke). */
export function Glyph({ name, size = 20, filled = false, className = "", title }: { name: GlyphName; size?: number; filled?: boolean; className?: string; title?: string }) {
  return (
    <svg
      className={`glyph ${className}`.trim()}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth="var(--icon-stroke, 1.8)"
      strokeLinecap="round"
      strokeLinejoin="round"
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      focusable="false"
    >
      {GLYPH_DATA[name].map(([tag, attrs], i) => createElement(tag, { key: i, ...attrs }))}
    </svg>
  );
}

export const isGlyphName = (v: unknown): v is GlyphName => typeof v === "string" && Object.prototype.hasOwnProperty.call(GLYPH_DATA, v);

/** Older tasks and saved mixes stored an emoji. Show the matching line icon instead. */
const LEGACY: Record<string, GlyphName> = {
  "🎯": "target", "📚": "library", "💻": "laptop", "✍️": "pen-line", "📝": "notebook-pen", "🧠": "brain", "🎨": "palette", "💡": "lightbulb",
  "🚀": "rocket", "⭐": "star", "🌱": "sprout", "🌸": "flower-2", "☀️": "sun", "🌙": "moon", "🔥": "flame", "💪": "dumbbell", "🏃": "footprints",
  "🧘": "sparkles", "🎵": "music", "🎧": "headphones", "☕": "coffee", "🍵": "leaf", "🍎": "apple", "🥗": "salad", "🏠": "house", "🧹": "brush",
  "🛒": "shopping-cart", "📞": "phone", "✉️": "mail", "📅": "calendar", "📊": "chart-column", "🧪": "flask-conical", "🔬": "microscope",
  "🛠️": "wrench", "📦": "package", "💰": "wallet", "🎬": "clapperboard", "🐱": "cat", "🌍": "globe", "✅": "circle-check",
  "🌿": "leaf", "🎹": "keyboard-music", "📻": "radio", "✨": "sparkles",
};

/** A stored icon value: a glyph name, a legacy emoji, or nothing. */
export function glyphFor(value: string | undefined | null): GlyphName | null {
  if (!value) return null;
  if (isGlyphName(value)) return value;
  // Own keys only: a saved "constructor" or "__proto__" must fall back, not hit Object.prototype.
  const bare = value.replace(/️/g, "");
  return Object.hasOwn(LEGACY, value) ? LEGACY[value] : Object.hasOwn(LEGACY, bare) ? LEGACY[bare] : null;
}
