import { useStore } from "../../lib/store";
import { LOOKS, settings, settingsUpdate, WALLPAPER_FX, type LookId, type WallpaperFx } from "../../state/settings";
import { applyFont } from "./ClockTab";
import "./LookSection.css";

/** What each look is called and how its preview card is painted. Colours mirror index.css. */
const LOOK_INFO: Record<LookId, { name: string; blurb: string; bg: string; ink: string; chip: string; chipInk: string; accent: string; accentInk: string; font: string; weight: number }> = {
  classic: { name: "Classic", blurb: "The original dark glass with a violet accent.", bg: "linear-gradient(135deg,#1b1640,#0b0c18 70%)", ink: "#f4f2fb", chip: "rgb(18 20 38 / 78%)", chipInk: "#c9c7d6", accent: "#7c5cff", accentInk: "#ffffff", font: "var(--preview-sans)", weight: 800 },
  glass: { name: "Glass", blurb: "See-through frosted glass over your photo.", bg: "linear-gradient(160deg,#9fb1b1,#4f6b5d 55%,#1d2e26)", ink: "#ffffff", chip: "rgb(26 30 38 / 40%)", chipInk: "#ffffff", accent: "#ffffff", accentInk: "#15191d", font: "var(--preview-sans)", weight: 800 },
  sketch: { name: "Sketchbook", blurb: "Paper, ink outlines and a marigold highlighter.", bg: "radial-gradient(circle, rgb(51 48 43 / 9%) 1px, transparent 1.2px) 0 0 / 12px 12px, #faf5ea", ink: "#33302b", chip: "#fffdf6", chipInk: "#33302b", accent: "#f2b63c", accentInk: "#33302b", font: "var(--preview-round)", weight: 800 },
  companion: { name: "Companion", blurb: "Warm paper, terracotta and sage, serif digits.", bg: "radial-gradient(circle at 85% 15%, #f2e3d4 0 30%, transparent 31%), #f9f2e9", ink: "#35201a", chip: "#fcf8f1", chipInk: "#35201a", accent: "#ba4b4c", accentInk: "#fbf8f2", font: "var(--preview-serif)", weight: 400 },
  sunrise: { name: "Sunrise", blurb: "Warm cream, sunny orange, round shapes.", bg: "radial-gradient(circle at 50% 130%, #ffa25e 0 25%, #ffc887 26% 40%, #ffe1b8 41% 55%, transparent 56%), #fff4e4", ink: "#2a2014", chip: "#ffffff", chipInk: "#2a2014", accent: "#ff8a3d", accentInk: "#2a2014", font: "var(--preview-round)", weight: 800 },
};

const FX_INFO: Record<WallpaperFx, { name: string; blurb: string }> = {
  none: { name: "None", blurb: "The wallpaper as it is." },
  frost: { name: "Frost", blurb: "A light, even frosting." },
  "frosted-blur": { name: "Frosted blur", blurb: "Thick glass that keeps the colours." },
  "fog-window": { name: "Foggy window", blurb: "Fogged glass with a wiped clear patch." },
  "rain-glass": { name: "Rain on glass", blurb: "Soft blur with beads of water." },
  grain: { name: "Film grain", blurb: "Fine noise for a printed feel." },
  vignette: { name: "Vignette", blurb: "Darker edges, calmer centre." },
  dim: { name: "Dim", blurb: "Lowers a bright wallpaper evenly." },
};

export function LookSection() {
  const a = useStore(settings, (s) => s.appearance);
  const pickLook = (look: LookId) => {
    settingsUpdate("appearance", { look });
    // A look brings its own timer type; a font picked later in Clock still wins.
    settingsUpdate("clock", { font: "look" });
    applyFont("look");
  };
  return (
    <>
      <div className="card look-card">
        <h3>Look</h3>
        <p className="help">Changes the whole app: colours, type, surfaces, icons and motion. Your wallpapers, timer and tasks stay as they are.</p>
        <div className="look-grid" role="radiogroup" aria-label="Look">
          {LOOKS.map((id) => {
            const l = LOOK_INFO[id];
            return (
              <button key={id} type="button" role="radio" aria-checked={a.look === id} className={`look-option look-option-${id}`} onClick={() => pickLook(id)}>
                <span className="look-preview" style={{ background: l.bg, color: l.ink }} aria-hidden="true">
                  <span className="look-preview-chip" style={{ background: l.chip, color: l.chipInk }}>Focus</span>
                  <span className="look-preview-digits" style={{ fontFamily: l.font, fontWeight: l.weight }}>25:00</span>
                  <span className="look-preview-play" style={{ background: l.accent, color: l.accentInk }}>
                    <svg viewBox="0 0 24 24" width="12" height="12"><path d="M8 5.5v13l10-6.5z" fill="currentColor" /></svg>
                  </span>
                </span>
                <span className="look-name">{l.name}</span>
                <span className="look-blurb">{l.blurb}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="card look-card">
        <h3>Wallpaper effect</h3>
        <p className="help">Drawn over any wallpaper, in every look, on Home, Focus and Ambient.</p>
        <div className="fx-grid" role="radiogroup" aria-label="Wallpaper effect">
          {WALLPAPER_FX.map((fx) => (
            <button key={fx} type="button" role="radio" aria-checked={a.fx === fx} className="fx-option" onClick={() => settingsUpdate("appearance", { fx })}>
              <span className="fx-sample" aria-hidden="true">
                <span className="fx-scene" />
                {fx !== "none" && <span className={`wall-fx wall-fx-${fx} in-tile`} style={{ ["--fx" as string]: String(fx === "dim" || fx === "vignette" ? Math.max(a.fxStrength, 0.8) : a.fxStrength) }} />}
              </span>
              <span className="look-name">{FX_INFO[fx].name}</span>
              <span className="look-blurb">{FX_INFO[fx].blurb}</span>
            </button>
          ))}
        </div>
        <label className="fx-strength">
          <span>Strength</span>
          <input
            id="fx-strength"
            className="range"
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={a.fxStrength}
            disabled={a.fx === "none"}
            aria-valuetext={`${Math.round(a.fxStrength * 100)} percent`}
            onChange={(e) => settingsUpdate("appearance", { fxStrength: Number(e.target.value) })}
          />
          <span className="fx-value">{Math.round(a.fxStrength * 100)}%</span>
        </label>
      </div>
    </>
  );
}
