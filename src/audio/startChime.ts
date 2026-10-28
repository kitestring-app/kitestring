import { getCtx, playChimeSamples } from "./core";
import type { Settings } from "../state/settings";
import type { TimerState } from "../state/timerEngine";

export type StartChimeSound = "bubble" | "music-box" | "bell";
export function shouldStartChime(s: TimerState, t: Settings["timer"], muted: boolean) {
  return s.segment === "focus" && s.startedAt === null && s.elapsedBefore === 0 && !s.frozen && !s.boundary && !s.reentry &&
    t.startChime && t.alertVolume > 0 && !muted && (t.focusDoneSound !== "none" || t.breakOverSound !== "none");
}

/** Three quiet rising notes, with a 35 ms attack and a smooth fade to silence. */
export function renderStartChime(sound: StartChimeSound, sr = 44100): Float32Array {
  const out = new Float32Array(Math.ceil(2.5 * sr));
  const notes = sound === "music-box" ? [659.25, 783.99, 1046.5] : sound === "bell" ? [523.25, 659.25, 783.99] : [392, 523.25, 659.25];
  notes.forEach((frequency, note) => {
    const at = Math.floor(note * 0.24 * sr);
    for (let i = at; i < out.length; i++) {
      const t = (i - at) / sr, tail = (out.length - 1 - i) / sr;
      const envelope = Math.min(1, t / 0.035, tail / 0.15) * Math.exp(-t / 0.38);
      const phase = 2 * Math.PI * frequency * t;
      const wave = Math.sin(phase) + (sound === "bubble" ? 0 : 0.15 * Math.sin(phase * 2.76));
      out[i] += wave * envelope * 0.045;
    }
  });
  return out;
}

/** Called during Start or Preview, never by a clock/store subscription. */
export function playStartChime(sound: StartChimeSound, volume: number) {
  if (volume <= 0) return;
  try { playChimeSamples(getCtx(), renderStartChime(sound), volume); }
  catch { /* Audio availability never prevents starting a block. */ }
}
