import type { Scheme } from "../state/settings";

/**
 * The floating timer sits on the Mac's own glass, not on the app's wallpaper. That glass follows the OS
 * appearance (dark glass in Dark Mode, light glass in Light Mode), whatever is on the desktop behind it.
 * So the floating window picks its ink from the OS unless the person forced Light or Dark, and then lays
 * down enough of the look's own surface that the ink still reads on the opposite glass.
 */
export function floatingIsDark(scheme: Scheme, osDark: boolean): boolean {
  if (scheme === "light") return false;
  if (scheme === "dark") return true;
  return osDark; // Auto and System: match the glass
}

type Rgb = [number, number, number]; // gamma-encoded sRGB, 0..1, the space CSS blends layers in

/** Parses #rgb, #rrggbb, rgb(r g b) and rgb(r, g, b). Alpha is ignored. */
export function parseColor(value: string): Rgb | null {
  const s = value.trim();
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(s);
  if (hex) {
    const h = hex[1].length === 3 ? hex[1].split("").map((c) => c + c).join("") : hex[1];
    return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255) as Rgb;
  }
  const fn = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(s);
  if (fn) return [fn[1], fn[2], fn[3]].map((v) => Math.min(255, Number(v)) / 255) as Rgb;
  return null;
}

const lum = (c: Rgb) => {
  const [r, g, b] = c.map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
export const contrastRatio = (a: Rgb, b: Rgb) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const over = (under: Rgb, top: Rgb, alpha: number): Rgb => under.map((c, i) => c * (1 - alpha) + top[i] * alpha) as Rgb;

/**
 * The darkest and lightest the Mac's under-window glass gets, over a black or a white desktop.
 * Measured from screenshots of the real window and widened for bright, busy wallpapers.
 */
export const GLASS_RANGE: Record<"dark" | "light", Rgb[]> = {
  dark: [[0.1, 0.1, 0.1], [0.45, 0.45, 0.45]],
  light: [[0.66, 0.66, 0.66], [0.98, 0.98, 0.98]],
};

/** WCAG AA for normal-size text. The floating window's smallest text ("Ready", "Focus") is 12px. */
export const AA = 4.5;

/**
 * The least opacity of `surface` that keeps every ink at `target` contrast over every glass colour.
 * Returns 1 when even a solid surface can't reach it (the ink then sits on the solid surface, as designed).
 */
export function minSurfaceAlpha(surface: Rgb, inks: Rgb[], glass: Rgb[], target = AA): number {
  const ok = (a: number) => glass.every((g) => inks.every((ink) => contrastRatio(ink, over(g, surface, a)) >= target));
  for (let step = 0; step <= 100; step++) if (ok(step / 100)) return step / 100;
  return 1;
}

/**
 * How solid the floating window's surface must be: the person's own setting, raised just enough that the
 * time and labels pass AA on the glass the OS is drawing. Tokens come from the look in force (computed style).
 */
export function floatingSurfaceAlpha(opts: { chosen: number; osDark: boolean; surface: string; inks: string[] }): number {
  const surface = parseColor(opts.surface);
  const inks = opts.inks.map(parseColor).filter((c): c is Rgb => !!c);
  if (!surface || !inks.length) return Math.max(opts.chosen, 0.9);
  const floor = minSurfaceAlpha(surface, inks, GLASS_RANGE[opts.osDark ? "dark" : "light"]);
  return Math.min(1, Math.max(opts.chosen, floor));
}
