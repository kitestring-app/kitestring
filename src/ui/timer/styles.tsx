import { useState, useSyncExternalStore } from "react";
import type { CSSProperties } from "react";
import type { FaceProps } from "./faces";
import { settings } from "../../state/settings";
import { FLIP_PALETTES } from "./palettes";
import type { FlipPaletteId } from "./palettes";
import "./styles.css";

function remainingFraction(progress: number) {
  return Number.isFinite(progress) ? 1 - Math.max(0, Math.min(1, progress)) : 1;
}

// A full circle needs two arcs; an empty slice must have no visible seam.
function remainingPiePath(remaining: number) {
  if (remaining <= 0) return "";
  if (remaining >= 1) return "M 50 50 L 50 4 A 46 46 0 1 1 50 96 A 46 46 0 1 1 50 4 Z";
  const angle = remaining * Math.PI * 2;
  return `M 50 50 L 50 4 A 46 46 0 ${remaining > 0.5 ? 1 : 0} 1 ${50 + 46 * Math.sin(angle)} ${50 - 46 * Math.cos(angle)} Z`;
}

function FlipDigit({ digit }: { digit: string }) {
  const [frame, setFrame] = useState({ digit, previous: digit, version: 0 });
  // Derive the next frame before painting a changed digit.
  if (frame.digit !== digit) {
    setFrame({ digit, previous: frame.digit, version: frame.version + 1 });
  }
  return (
    <span className="flip-card">
      <span className="flip-half flip-top"><span>{digit}</span></span>
      <span className="flip-half flip-bottom"><span>{digit}</span></span>
      {frame.version > 0 && (
        <span className="flip-fold" key={frame.version}>
          <span className="flip-half flip-bottom flip-old-bottom"><span>{frame.previous}</span></span>
          <span className="flip-half flip-top flip-old-top"><span>{frame.previous}</span></span>
          <span className="flip-half flip-bottom flip-new-bottom"><span>{digit}</span></span>
        </span>
      )}
    </span>
  );
}

export function FlipFace({ display, big = true, palette }: FaceProps & { palette?: FlipPaletteId }) {
  const selected = useSyncExternalStore(settings.subscribe, () => settings.get().timer.flipPalette, () => settings.get().timer.flipPalette);
  const colours = FLIP_PALETTES[palette ?? selected] ?? FLIP_PALETTES.midnight;
  return (
    <div className={`timer-face face-flip ${big ? "is-big" : "is-compact"}`} role="img" aria-label={display}
      style={{ "--flip-width": display.length * 0.72, "--flip-tile": colours.tile, "--flip-ink": colours.ink } as CSSProperties}>
      <span className="flip-digits" aria-hidden="true">
        {display.split("").map((digit, index) => digit === ":" ? (
          <span className="flip-colon" key={display.length - index}>:</span>
        ) : (
          // Right alignment preserves minutes/seconds when the hour width changes.
          <FlipDigit digit={digit} key={display.length - index} />
        ))}
      </span>
    </div>
  );
}

export function BarFace({ display, progress, showNumbers, big = true }: FaceProps) {
  return (
    <div className={`timer-face face-bar ${big ? "is-big" : "is-compact"}`} role="img" aria-label={display}>
      {showNumbers && <span className="face-time" aria-hidden="true">{display}</span>}
      <span className="face-bar-track" aria-hidden="true">
        <span className="face-bar-fill" style={{ transform: `scaleX(${remainingFraction(progress)})` }} />
      </span>
    </div>
  );
}

export function GaugeFace({ display, progress, showNumbers, big = true }: FaceProps) {
  const remaining = remainingFraction(progress);
  return (
    <div className={`timer-face face-gauge ${big ? "is-big" : "is-compact"}`} role="img" aria-label={display}>
      <svg className="face-round" viewBox="0 0 100 100" aria-hidden="true">
        <circle className="face-track" cx="50" cy="50" r="44" fill="none" strokeWidth="5" />
        <circle className="face-gauge-fill" cx="50" cy="50" r="44" fill="none" strokeWidth="5" pathLength="1"
          strokeDasharray="1 1" strokeDashoffset={1 - remaining} strokeLinecap="round"
          transform="rotate(-90 50 50)" opacity={remaining === 0 ? 0 : 1} />
      </svg>
      {showNumbers && <span className="face-time" aria-hidden="true">{display}</span>}
    </div>
  );
}

export function DotsFace({ display, progress, showNumbers, big = true }: FaceProps) {
  // Avoid an extra lit dot from floating-point noise at exact boundaries.
  const lit = Math.ceil(remainingFraction(progress) * 30 - Number.EPSILON * 30);
  return (
    <div className={`timer-face face-dots ${big ? "is-big" : "is-compact"}`} role="img" aria-label={display}>
      <span className="face-dot-grid" aria-hidden="true">
        {Array.from({ length: 30 }, (_, index) => (
          <span className={`face-dot ${index < lit ? "is-lit" : ""}`} key={index} />
        ))}
      </span>
      {showNumbers && <span className="face-time" aria-hidden="true">{display}</span>}
    </div>
  );
}

export function PieFace({ display, progress, showNumbers, big = true }: FaceProps) {
  return (
    <div className={`timer-face face-pie ${big ? "is-big" : "is-compact"}`} role="img" aria-label={display}>
      <svg className="face-round" viewBox="0 0 100 100" aria-hidden="true">
        <circle className="face-track" cx="50" cy="50" r="46" />
        <path className="face-pie-fill" d={remainingPiePath(remainingFraction(progress))} />
      </svg>
      {showNumbers && <span className="face-time" aria-hidden="true">{display}</span>}
    </div>
  );
}
