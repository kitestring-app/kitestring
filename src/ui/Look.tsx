import { useEffect } from "react";
import { useStore } from "../lib/store";
import { LOOKS, WALLPAPER_FX, settings, settingsUpdate, type LookId, type Settings, type WallpaperFx } from "../state/settings";
import "./Look.css";
import { installFullscreenTransition } from "./fullscreenTransition";

/** Looks drawn on paper bring their own backdrop instead of the photo wallpaper. */
export const PAPER_LOOKS: readonly LookId[] = ["sketch", "companion", "sunrise"];

/** Puts the current look on <html data-look> so every token in index.css follows it. */
export function useLook() {
  const look = useStore(settings, (s) => s.appearance.look);
  useEffect(() => {
    const root = typeof document === "undefined" ? null : document.documentElement;
    if (root?.dataset) {
      root.dataset.look = look;
      const colour = getComputedStyle(root).getPropertyValue("--bg").trim();
      document.querySelector('meta[name="theme-color"]')?.setAttribute("content", colour);
    }
  }, [look]);
  useEffect(() => {
    const subscribe = typeof window === "undefined" ? undefined : window.desktop?.onFullScreenTransition;
    if (subscribe) return installFullscreenTransition(subscribe);
  }, []);
  useEffect(() => {
    // Development only: ?look=sketch&fx=frost&fxs=0.6 lets screenshot tooling review every look. Stripped from builds.
    if (!import.meta.env.DEV || typeof location === "undefined") return;
    const q = new URLSearchParams(location.search);
    const patch: Partial<Settings["appearance"]> = {};
    const l = q.get("look"), f = q.get("fx"), st = Number(q.get("fxs"));
    if (l && (LOOKS as readonly string[]).includes(l)) patch.look = l as LookId;
    if (f && (WALLPAPER_FX as readonly string[]).includes(f)) patch.fx = f as WallpaperFx;
    if (Number.isFinite(st) && q.has("fxs")) patch.fxStrength = st;
    if (Object.keys(patch).length) settingsUpdate("appearance", patch);
    const theme = q.get("theme");
    if (theme && /^[a-z0-9-]{1,64}$/.test(theme)) {
      const ref = { kind: "library" as const, id: theme };
      settingsUpdate("themes", { home: ref, focus: ref, ambient: ref });
    }
  }, []);
  return look;
}

/** Three slightly different ink filters. Sketchbook outlines cycle them at about 6 fps on hover ("boil"). */
export function InkFilters() {
  return (
    <svg width="0" height="0" aria-hidden="true" focusable="false" style={{ position: "absolute" }}>
      {[2, 7, 11].map((seed, i) => (
        <filter key={seed} id={`ink-${i}`} x="-12%" y="-12%" width="124%" height="124%">
          <feTurbulence type="fractalNoise" baseFrequency="0.03" numOctaves={2} seed={seed} result="noise" />
          <feDisplacementMap in="SourceGraphic" in2="noise" scale={3.2} />
        </filter>
      ))}
    </svg>
  );
}

/** The built-in backdrop for the paper looks. Pure CSS and inline SVG, nothing loads. */
export function LookBackdrop({ look }: { look: LookId }) {
  if (look === "sketch") return <div className="look-bg look-bg-sketch" aria-hidden="true" />;
  if (look === "companion") {
    return (
      <svg className="look-bg" viewBox="0 0 1200 800" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
        <rect width="1200" height="800" fill="#f9f2e9" />
        <circle cx="1050" cy="140" r="250" fill="#f2e3d4" />
        <path d="M0 690 C220 640 380 720 600 680 S980 640 1200 690 V800 H0Z" fill="#ece0d0" />
        <path d="M0 735 C260 705 420 765 700 735 S1020 705 1200 740 V800 H0Z" fill="#dfe9e0" />
      </svg>
    );
  }
  if (look === "sunrise") {
    return (
      <svg className="look-bg look-bg-sunrise" viewBox="0 0 1200 800" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
        <rect width="1200" height="800" fill="#fff4e4" />
        <g className="sun">
          <circle cx="600" cy="880" r="470" fill="#ffe1b8" />
          <circle cx="600" cy="880" r="340" fill="#ffc887" />
          <circle cx="600" cy="880" r="215" fill="#ffa25e" />
        </g>
        <circle cx="150" cy="150" r="74" fill="#ffe9c9" />
        <circle cx="1080" cy="250" r="46" fill="#ffe9c9" />
      </svg>
    );
  }
  return null;
}

/** An effect drawn over any wallpaper or backdrop, in every look and dashboard. */
export function WallpaperEffect({ fx, strength }: { fx: WallpaperFx; strength: number }) {
  if (fx === "none") return null;
  return <div className={`wall-fx wall-fx-${fx}`} style={{ ["--fx" as string]: String(strength) }} aria-hidden="true" />;
}
