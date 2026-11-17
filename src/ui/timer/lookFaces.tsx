import type { CSSProperties } from "react";
import type { FaceProps } from "./faces";
import "./lookFaces.css";

/**
 * Look hero faces. The time digits stay in normal flow using the shared `.timer`
 * class (so layout, contrast and the app's timer contract are unchanged); the
 * chess clock / tape roll is an absolutely-positioned decorative SVG layered
 * behind/around them. Real component identity, no layout/DOM-contract break.
 */
export function ClockFace({ display, progress, showNumbers = true, big = true, segment }: FaceProps) {
  const active = segment === "focus" ? "focus" : segment === "long" ? "long" : "short";
  const sweep = Number.isFinite(progress) ? Math.max(0, Math.min(1, progress)) * 360 : 0;
  const dial = (side: string, label: string, isActive: boolean) => (
    <span className={`clock-dial dial-${side} ${isActive ? "is-active" : "is-inactive"}`} data-active={isActive}>
      <svg viewBox="0 0 100 100" aria-hidden="true" focusable="false">
        <circle className="dial-rim" cx="50" cy="50" r="47" fill="none" />
        <circle className="dial-face" cx="50" cy="50" r="41" />
        <path className="dial-ticks" d="M50 6v6M50 88v6M6 50h6M88 50h6" fill="none" />
        <g className="dial-hand" style={isActive ? ({ "--sweep": `${sweep}deg` } as CSSProperties) : undefined}>
          <path d="M50 50 L50 14" fill="none" />
        </g>
        <path className="dial-flag" d="M63 50 L63 34 L76 39 Z" />
        <circle className="dial-pivot" cx="50" cy="50" r="2.6" />
      </svg>
      <span className="clock-side">{label}</span>
    </span>
  );
  return (
    <div className={`timer-face face-clock ${big ? "is-big" : "is-compact"}`} role="img" aria-label={display}>
      <span className="clock-art hero-art" aria-hidden="true">
        {dial("focus", "FOCUS", active === "focus")}
        <span className="clock-lever" />
        {dial("break", active === "long" ? "ADJOURN" : "BREAK", active !== "focus")}
      </span>
      {showNumbers && <span className="face-time"><span className="timer">{display}</span></span>}
    </div>
  );
}

/** Sweet Tape hero: unwinding roll drawn behind the unchanged `.timer` digits. */
export function TapeFace({ display, progress, showNumbers = true, big = true }: FaceProps) {
  const p = Number.isFinite(progress) ? Math.max(0, Math.min(1, progress)) : 0;
  return (
    <div className={`timer-face face-tape ${big ? "is-big" : "is-compact"}`} role="img" aria-label={display} style={{ "--tape-progress": p } as CSSProperties}>
      <svg className="tape-art hero-art" viewBox="0 0 240 100" aria-hidden="true" focusable="false">
        <circle className="tape-roll" cx="40" cy="52" r="30" />
        <circle className="tape-core" cx="40" cy="52" r="11" fill="none" />
        <rect className="tape-strip" x="62" y="44" width="132" height="16" rx="2" />
        <polygon className="tape-tear" points="190,44 199,47 194,50 202,53 195,56 198,59 190,60" />
      </svg>
      {showNumbers && <span className="face-time"><span className="timer">{display}</span></span>}
    </div>
  );
}
