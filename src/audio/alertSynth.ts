// Alerts rendered as raw samples so the browser and native players share one waveform.
// "focus-done": warm rising bell arpeggio, three times (~6 s). "break-over": urgent two-tone pattern (~5 s).
// Pure functions: no Web Audio, no DOM. scripts/gen-alerts.mts writes them to public/alerts/*.wav.

export type AlertKind = "focus-done" | "break-over";
export const ALERT_KINDS: AlertKind[] = ["focus-done", "break-over"];
import type { Settings } from "../state/settings";
export type AlertSound = Settings["timer"]["alertSound"];
export const ALERT_SOUNDS = ["signature", "bell", "chime", "digital", "wood", "none"] as const satisfies readonly AlertSound[];
export const ALERT_SAMPLE_RATE = 44100;

const VOICES: Record<Exclude<AlertSound, "none" | "signature">, { notes: number[]; type: "sine" | "triangle" | "square"; gap: number; decay: number }> = {
  bell: { notes: [523.25, 659.25, 783.99], type: "sine", gap: 0.18, decay: 2.4 },
  chime: { notes: [880, 1174.66, 1567.98, 1174.66], type: "triangle", gap: 0.14, decay: 1.8 },
  digital: { notes: [1046.5, 0, 1046.5, 0, 1046.5], type: "square", gap: 0.12, decay: 0.12 },
  wood: { notes: [392, 523.25], type: "triangle", gap: 0.22, decay: 0.35 },
};

/** Each pack settles downward after focus and rises more brightly after a break. */
export function renderSelectedAlert(sound: AlertSound, kind: AlertKind, sr = ALERT_SAMPLE_RATE): Float32Array {
  if (sound === "signature") return renderAlert(kind, sr);
  if (sound === "none") return new Float32Array(1);
  const voice = VOICES[sound];
  const out = new Float32Array(Math.ceil(((voice.notes.length - 1) * voice.gap + voice.decay + 0.05) * sr));
  const peak = 0.22 * (voice.type === "square" ? 0.35 : 1);
  const notes = voice.notes.filter(Boolean).sort((a, b) => kind === "focus-done" ? b - a : a - b);
  if (kind === "break-over") notes[notes.length - 1] *= 1.5;
  let pitchedNote = 0;
  voice.notes.forEach((original, note) => {
    const freq = original ? notes[pitchedNote++]! : 0;
    if (!freq) return;
    const start = Math.floor(note * voice.gap * sr);
    for (let i = 0; i < Math.ceil((voice.decay + 0.05) * sr) && start + i < out.length; i++) {
      const t = i / sr;
      const phase = freq * t;
      // Band-limit non-sine waves at Nyquist, like Web Audio's oscillators.
      let wave = Math.sin(TAU * phase);
      if (voice.type !== "sine") {
        wave = 0;
        for (let harmonic = 1; harmonic * freq < sr / 2; harmonic += 2) {
          wave += Math.sin(TAU * phase * harmonic) * (voice.type === "square" ? 4 / (Math.PI * harmonic) :
            8 / (Math.PI * Math.PI) * (harmonic % 4 === 1 ? 1 : -1) / (harmonic * harmonic));
        }
      }
      const gain = t < 0.01 ? peak * t / 0.01 :
        t < voice.decay ? peak * Math.pow(0.0001 / peak, (t - 0.01) / (voice.decay - 0.01)) : 0.0001;
      out[start + i] += wave * gain;
    }
  });
  return out;
}

const TAU = Math.PI * 2;

/** A struck bell: fundamental + soft inharmonic partials, fast attack, exponential decay. */
function bell(out: Float32Array, sr: number, at: number, freq: number, amp: number, decay: number) {
  const start = Math.floor(at * sr);
  const len = Math.min(out.length - start, Math.floor((decay * 5) * sr));
  const partials: [number, number][] = [[1, 1], [2.0, 0.42], [2.76, 0.22], [4.07, 0.1]];
  for (let i = 0; i < len; i++) {
    const t = i / sr;
    const env = Math.min(1, t / 0.004) * Math.exp(-t / decay);
    let v = 0;
    for (const [mult, a] of partials) v += a * Math.sin(TAU * freq * mult * t) * Math.exp(-t * (mult - 1) * 0.9);
    out[start + i] += amp * env * v;
  }
}

/** A short bright beep with a soft edge (no clicks): triangle-ish via odd harmonics. */
function beep(out: Float32Array, sr: number, at: number, freq: number, amp: number, dur: number) {
  const start = Math.floor(at * sr);
  const len = Math.min(out.length - start, Math.floor(dur * sr));
  const edge = 0.008 * sr;
  for (let i = 0; i < len; i++) {
    const t = i / sr;
    const env = Math.min(1, i / edge, (len - i) / edge);
    const v = Math.sin(TAU * freq * t) - Math.sin(TAU * 3 * freq * t) / 9 + Math.sin(TAU * 5 * freq * t) / 25;
    out[start + i] += amp * env * v;
  }
}

export function renderAlert(kind: AlertKind, sr = 44100): Float32Array {
  if (kind === "focus-done") {
    // C5 E5 G5 C6, played three times, the last one held longer
    const out = new Float32Array(Math.ceil(sr * 6.4));
    const notes = [523.25, 659.25, 783.99, 1046.5];
    for (let rep = 0; rep < 3; rep++) {
      const base = rep * 1.75;
      notes.forEach((f, i) => bell(out, sr, base + i * 0.16, f, 0.5, rep === 2 && i === 3 ? 1.1 : 0.55));
    }
    return normalize(out, 0.7); // ≈ -3 dBFS peak
  }
  // break-over: "da-da-DA" in two tones, four times, with a low pulse underneath
  const out = new Float32Array(Math.ceil(sr * 5.2));
  for (let rep = 0; rep < 4; rep++) {
    const base = rep * 1.25;
    beep(out, sr, base, 880, 0.55, 0.13);
    beep(out, sr, base + 0.18, 880, 0.55, 0.13);
    beep(out, sr, base + 0.36, 1174.66, 0.65, 0.34);
    bell(out, sr, base, 220, 0.35, 0.25);
  }
  return normalize(out, 0.7);
}

function normalize(buf: Float32Array, peak: number): Float32Array {
  let m = 0;
  for (const v of buf) m = Math.max(m, Math.abs(v));
  if (m > 0) for (let i = 0; i < buf.length; i++) buf[i] = (buf[i] / m) * peak;
  return buf;
}

/** 16-bit PCM mono WAV bytes. */
export function toWav(samples: Float32Array, sr = 44100): Uint8Array {
  const data = samples.length * 2;
  const buf = new ArrayBuffer(44 + data);
  const v = new DataView(buf);
  const str = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, "RIFF");
  v.setUint32(4, 36 + data, true);
  str(8, "WAVE");
  str(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, 1, true); // mono
  v.setUint32(24, sr, true);
  v.setUint32(28, sr * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  str(36, "data");
  v.setUint32(40, data, true);
  for (let i = 0; i < samples.length; i++) v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, samples[i])) * 0x7fff, true);
  return new Uint8Array(buf);
}

export const ALERT_TEXT: Record<AlertKind, { title: string; body: string }> = {
  "focus-done": { title: "Focus session done", body: "Nice work. Take your break: stand up, look far away, drink water." },
  "break-over": { title: "Break's over", body: "Back to it. Your next focus session is ready." },
};
