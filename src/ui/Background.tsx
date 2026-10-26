import { useEffect, useState } from "react";
import { dbGet } from "../lib/db";
import { useStore } from "../lib/store";
import { settings, type LookId, type ThemeRef, type WallpaperFx } from "../state/settings";
import { findTheme, THEMES } from "../data/themes";
import { useBackgroundMotion } from "./BackgroundMotion";
import { LookBackdrop, PAPER_LOOKS, WallpaperEffect } from "./Look";

/** Custom uploads are stored as Blobs in IndexedDB under `custom-bg:<id>`. */
function useCustomUrl(ref: ThemeRef) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (ref.kind !== "custom") return setUrl(null);
    let alive = true;
    let made: string | null = null;
    void dbGet<Blob>(`custom-bg:${ref.id}`).then((b) => {
      if (!alive || !b) return;
      made = URL.createObjectURL(b);
      setUrl(made);
    });
    return () => {
      alive = false;
      if (made) URL.revokeObjectURL(made);
    };
  }, [ref.kind, ref.id]);
  return url;
}

export function themeStyle(ref: ThemeRef, customUrl: string | null, disableAnimated: boolean) {
  if (ref.kind === "color") return { style: { background: /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(ref.id) ? ref.id : "#14121C" }, cls: "" };
  if (ref.kind === "custom") return { style: { background: customUrl ? `center / cover no-repeat url(${customUrl}), #111` : "#111" }, cls: "" };
  const t = findTheme(ref.id) ?? THEMES[0];
  return { style: { background: t.background, backgroundSize: t.animated ? "400% 400%" : "cover" }, cls: !disableAnimated && t.animated ? t.animated : "" };
}

/** Relative luminance of a #rgb/#rrggbb colour (0..1); null for anything else. */
export function luminance(color: string): number | null {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color.trim());
  if (!m) return null;
  const hex = m[1].length === 3 ? m[1].split("").map((c) => c + c).join("") : m[1];
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function isLightTheme(ref: ThemeRef): boolean {
  if (ref.kind === "color") return (luminance(ref.id) ?? 0) > 0.45;
  if (ref.kind === "library") return !!findTheme(ref.id)?.light;
  return false; // custom photos keep light text over the scrim
}

type Rgb = [number, number, number]; // gamma-encoded sRGB, 0..1, the space CSS blends layers in
const rgbOf = (hex: string): Rgb | null => {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const h = m[1].length === 3 ? m[1].split("").map((c) => c + c).join("") : m[1];
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255) as Rgb;
};
const mix = (under: Rgb, top: number, alpha: number): Rgb => under.map((c) => c * (1 - alpha) + top * alpha) as Rgb;
const lumOf = (c: Rgb) => { const [r, g, b] = c.map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const contrast = (a: Rgb, b: Rgb) => { const [x, y] = [lumOf(a), lumOf(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

/** The paper colour and ink of each paper look's built-in backdrop (see index.css and LookBackdrop). */
const PAPER: Partial<Record<LookId, { paper: string; ink: string }>> = {
  sketch: { paper: "#faf5ea", ink: "#33302b" }, companion: { paper: "#f9f2e9", ink: "#35201a" }, sunrise: { paper: "#fff4e4", ink: "#2a2014" },
};
const LIGHT_INK = "#f4f2fb", DARK_INK = "#1a1726", PAPER_LIGHT_INK = "#fbf7ef";

/**
 * Should wallpaper text be dark ink? Works out the colour behind the timer after the effect and the scrim,
 * blended in sRGB like the browser does, and picks whichever ink reads better there.
 * Frost adds white (6% + 22% x strength) and Dim adds black (10% + 55% x strength), matching Look.css.
 * Fog window and vignette leave the centre clear, so they change nothing. Photos have no measured
 * brightness, so without frost or dim they go by their light tag.
 */
export function wallpaperIsLight(ref: ThemeRef, fx: WallpaperFx, strength: number, look: LookId = "classic"): boolean {
  const k = Math.min(1, Math.max(0, strength));
  const paper = PAPER[look];
  const tints = fx === "frost" || fx === "dim";
  if (!paper && ref.kind !== "color" && !tints) return isLightTheme(ref);
  let base: Rgb = paper ? rgbOf(paper.paper)! : ref.kind === "color" ? (rgbOf(ref.id) ?? [0, 0, 0]) : isLightTheme(ref) ? [0.85, 0.85, 0.85] : [0.2, 0.2, 0.2];
  if (fx === "frost") base = mix(base, 1, 0.06 + 0.22 * k);
  if (fx === "dim") base = mix(base, 0, 0.1 + 0.55 * k);
  if (paper) return contrast(rgbOf(paper.ink)!, base) >= contrast(rgbOf(PAPER_LIGHT_INK)!, base);
  // Dark ink brings the light scrim (8% white at the centre); light ink keeps the look's dark one.
  const darkScrim = look === "glass" ? 0.04 : 0.12;
  return contrast(rgbOf(DARK_INK)!, mix(base, 1, 0.08)) >= contrast(rgbOf(LIGHT_INK)!, mix(base, 0, darkScrim));
}

export function Background() {
  useBackgroundMotion();
  const s = useStore(settings);
  const ref = s.themes[s.dash];
  const url = useCustomUrl(ref);
  const { style, cls } = themeStyle(ref, url, s.extras.disableAnimated);
  const { look, fx, fxStrength } = s.appearance;
  const paper = PAPER_LOOKS.includes(look);
  // Paper looks draw their own backdrop; dimming it can call for light ink instead of their usual dark one.
  const darkInk = wallpaperIsLight(ref, fx, fxStrength, look);
  const light = !paper && darkInk, paperDimmed = paper && !darkInk;
  useEffect(() => {
    document.documentElement.classList.toggle("theme-light", light);
    document.documentElement.classList.toggle("paper-dimmed", paperDimmed);
  }, [light, paperDimmed]);
  return (
    <>
      {paper ? <LookBackdrop look={look} /> : <div key={`${ref.kind}:${ref.id}`} className={`bg ${cls}`} style={style} />}
      <WallpaperEffect fx={fx} strength={fxStrength} />
      <div className="scrim" />
    </>
  );
}
