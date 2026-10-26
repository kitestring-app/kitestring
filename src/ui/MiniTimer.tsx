import { useEffect, useRef, useState } from "react";
import { useTimerView } from "../state/timer";
import { floatingGlass, settings } from "../state/settings";
import { useStore } from "../lib/store";
import { SEGMENT_LABEL } from "../state/timerEngine";
import { Glyph, type GlyphName } from "./Glyph";
import { Icon } from "./icons";
import "./MiniTimer.css";
import { useLook } from "./Look";

/** Each segment gets its own icon; its colour comes from the look (--state-*). */
const STATE_GLYPH: Record<"focus" | "short" | "long", GlyphName> = { focus: "target", short: "coffee", long: "moon" };

/**
 * The floating timer is a glance, not a remote: time, which segment you are in, and volume.
 * Timer decisions happen in the main window, so nothing here can pause, skip or end a block.
 */
export function MiniTimer({ native = false }: { native?: boolean }) {
  const v = useTimerView();
  const reduceMotion = useStore(settings, s => s.extras.reduceMotion);
  const glass = useStore(floatingGlass);
  const [audio, setAudio] = useState<FloatingAudioState>({ volume: 0.7, muted: false, playing: false, available: false });
  const [volume, setVolume] = useState(0.7);
  const dragging = useRef(false);
  const pendingVolume = useRef<number | null>(null);
  useEffect(() => {
    if (!native) return;
    const off = window.desktop?.onAudioState?.(value => {
      setAudio(value);
      if (!dragging.current && (pendingVolume.current === null || value.volume === pendingVolume.current)) {
        pendingVolume.current = null;
        setVolume(value.volume);
      }
    });
    window.desktop?.requestAudioState?.();
    return off;
  }, [native]);
  useLook();
  useEffect(() => {
    if (!native) return;
    document.documentElement.classList.add("native-mini");
    return () => document.documentElement.classList.remove("native-mini");
  }, [native]);
  useEffect(() => {
    if (!native) return;
    document.documentElement.classList.toggle("reduce-motion", reduceMotion);
    return () => document.documentElement.classList.remove("reduce-motion");
  }, [native, reduceMotion]);
  const segment = v.state.segment as "focus" | "short" | "long";
  const label = v.hiddenTime ? SEGMENT_LABEL[segment] : v.mode === "animedoro" && segment === "long" ? "Watch time" : SEGMENT_LABEL[segment];
  return (
    <main className={`mini-timer is-${segment}${v.running ? " is-running" : ""}`} style={{ ["--mini-alpha" as string]: String(glass.opacity) }} aria-label={`Floating timer, ${label}`}>
      {native && <button className="mini-close" aria-label="Close floating timer" onClick={() => void window.desktop?.floatTimer?.(false)}><span aria-hidden="true">×</span></button>}
      <div className="mini-state">
        <span className="mini-state-icon"><Glyph name={STATE_GLYPH[segment] ?? "target"} size={14} /></span>
        <span>{label}</span>
        {v.hardLocked && <span className="mini-lock" title="Hard mode: this block runs to the end"><Glyph name="lock" size={12} title="Hard mode" /></span>}
        {!v.running && !v.hiddenTime && <span className="mini-paused">{v.elapsed > 0 ? "Paused" : "Ready"}</span>}
      </div>
      {v.hiddenTime && (native ? <button className="btn small" aria-label="Open Kitestring" onClick={() => window.desktop?.showMain?.()}>{v.running ? "Running" : "Paused"}</button> : <span>{v.running ? "Running" : "Paused"}</span>)}
      {v.hiddenTime && <span className="sr-only" role="timer" aria-live="off">{label}: {v.timeDescription}</span>}
      {!v.hiddenTime && (native
        ? <button className="mini-digits" aria-label={`${v.display}. Open Kitestring`} onClick={() => window.desktop?.showMain?.()}>{v.display}</button>
        : <div className="mini-digits">{v.display}</div>)}
      {!v.hiddenTime && <div className="mini-progress" aria-hidden="true"><i style={{ width: `${v.progress * 100}%` }} /></div>}
      {native && <div className="mini-volume" role="group" aria-label="Volume">
        <button className="mini-mute" aria-label={audio.muted ? "Unmute audio" : "Mute audio"} aria-pressed={audio.muted} onClick={() => window.desktop?.audioControl?.({ action: "mute" })}>
          {audio.muted ? <Icon.muted /> : <Icon.volume />}
        </button>
        <input className="range" type="range" min="0" max="1" step="0.01" value={volume} aria-label="Master volume" aria-description="Ambient sounds and radio. Embedded music uses its own volume control." aria-valuetext={`${Math.round(volume * 100)} percent`} onPointerDown={event => { dragging.current = true; event.currentTarget.setPointerCapture(event.pointerId); }} onPointerUp={() => { dragging.current = false; window.desktop?.requestAudioState?.(); }} onPointerCancel={() => { dragging.current = false; window.desktop?.requestAudioState?.(); }} onChange={event => {
          const value = Number(event.target.value);
          setVolume(value); pendingVolume.current = value;
          window.desktop?.audioControl?.({ action: "volume", value });
        }} />
      </div>}
    </main>
  );
}
