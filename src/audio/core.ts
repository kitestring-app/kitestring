// Shared AudioContext + alert chimes. The sound mixer (audio/mixer.ts) builds on getCtx()/masterOut().

let ctx: AudioContext | null = null;
let master: GainNode | null = null;

export function getCtx(): AudioContext {
  if (!ctx) {
    ctx = new AudioContext();
    // ambient bus: master volume → +12 dB make-up → limiter → speakers.
    // Per-sound and master volumes are squared (perceptual), which leaves layers ~35 dB down without make-up;
    // the limiter keeps stacked layers from clipping.
    master = ctx.createGain();
    const makeup = ctx.createGain();
    makeup.gain.value = 4;
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -6;
    limiter.knee.value = 6;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.25;
    master.connect(makeup).connect(limiter).connect(ctx.destination);
  }
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

/** Output node for ambient sounds (respects the master volume). Alerts bypass it. */
export function masterOut(): GainNode {
  getCtx();
  return master!;
}

export function setMasterVolume(v: number) {
  const c = getCtx();
  masterOut().gain.setTargetAtTime(v * v, c.currentTime, 0.1);
}

import { ALERT_SAMPLE_RATE, renderSelectedAlert, type AlertKind, type AlertSound } from "./alertSynth";
export type { AlertSound } from "./alertSynth";

type AlertVoice = { out: GainNode; oscs: AudioScheduledSourceNode[] };
let scheduled: AlertVoice | null = null;
const active = new Set<AlertVoice>();
const rendered = new Map<string, AudioBuffer>();
let endWatch: ConstantSourceNode | null = null;

/** Page previews and scheduled alerts play the same waveform as the bundled native WAVs. */
function playVoice(sound: Exclude<AlertSound, "none">, volume: number, inSeconds: number, kind: AlertKind = "focus-done") {
  const c = getCtx();
  const key = `${sound}:${kind}`;
  let buf = rendered.get(key);
  if (!buf) {
    const data = renderSelectedAlert(sound, kind);
    buf = c.createBuffer(1, data.length, ALERT_SAMPLE_RATE);
    buf.copyToChannel(data as Float32Array<ArrayBuffer>, 0);
    rendered.set(key, buf);
  }
  const out = c.createGain();
  out.gain.value = Math.min(1, Math.max(0, volume));
  out.connect(c.destination);
  const src = c.createBufferSource();
  src.buffer = buf;
  src.connect(out);
  const voice = { out, oscs: [src] as AudioScheduledSourceNode[] };
  active.add(voice);
  src.onended = () => { active.delete(voice); out.disconnect(); };
  src.start(c.currentTime + Math.max(0, inSeconds));
  return voice;
}

/** Arm the end-of-segment chime `inSeconds` from now on the audio clock (accurate even in throttled background tabs). */
export function scheduleChime(sound: AlertSound, volume: number, inSeconds = 0, kind: AlertKind = "focus-done") {
  cancelChime();
  if (sound === "none") return;
  scheduled = playVoice(sound, volume, inSeconds, kind);
}

/** Play an alert now without touching the armed end chime (settings previews). */
export function previewChime(sound: AlertSound, volume: number, kind: AlertKind = "focus-done") {
  if (sound !== "none") playVoice(sound, volume, 0, kind);
}

/** Let a chime that is already sounding (or about to) finish, and forget it so the next arm won't stop it. */
export function releaseChime() {
  scheduled = null;
}

export function cancelChime() {
  if (!scheduled) return;
  for (const o of scheduled.oscs) {
    try { o.stop(); } catch { /* already stopped */ }
  }
  active.delete(scheduled);
  scheduled.out.disconnect();
  scheduled = null;
}

/**
 * Call `onEnd` when `inSeconds` have passed, using an audio-clock event.
 * setInterval is throttled to once a minute in hidden tabs; audio `ended` events are not.
 * A silent source keeps the context running while a segment is armed.
 */
export function scheduleEnd(inSeconds: number, onEnd: () => void) {
  cancelEnd();
  const c = getCtx();
  const src = c.createConstantSource();
  const mute = c.createGain();
  mute.gain.value = 0;
  src.connect(mute).connect(c.destination);
  src.onended = () => {
    if (endWatch === src) endWatch = null;
    mute.disconnect();
    onEnd();
  };
  src.start();
  src.stop(c.currentTime + Math.max(0, inSeconds));
  endWatch = src;
}

export function cancelEnd() {
  if (!endWatch) return;
  const src = endWatch;
  endWatch = null;
  src.onended = null;
  try { src.stop(); } catch { /* not started */ }
}

/** Includes released boundary voices and previews, without forgetting playing sources. */
export function cancelAllChimes() {
  cancelChime();
  for (const voice of active) {
    for (const source of voice.oscs) { try { source.stop(); } catch { /* already ended */ } }
    voice.out.disconnect();
  }
  active.clear();
}

/** A one-second buffer loops on the audio clock even when page timers are throttled. */
export function playTimerTick(style: "soft" | "wood" | "digital", volume: number, inSeconds = 0, duration = 0.045) {
  const c = getCtx();
  const buffer = c.createBuffer(1, c.sampleRate, c.sampleRate);
  const samples = new Float32Array(c.sampleRate);
  const frequency = style === "wood" ? 640 : style === "digital" ? 1500 : 900;
  const rate = Math.log(180 / frequency) / 0.035;
  const peak = Math.max(0.00001, volume * volume * 0.16);
  for (let i = 0; i < 0.045 * c.sampleRate; i++) {
    const t = i / c.sampleRate;
    const phase = 2 * Math.PI * frequency * (Math.exp(rate * t) - 1) / rate;
    const wave = style === "digital" ? Math.sign(Math.sin(phase)) : Math.sin(phase);
    samples[i] = wave * peak * Math.pow(0.00001 / peak, Math.min(1, t / 0.04));
  }
  buffer.copyToChannel(samples, 0);
  const source = c.createBufferSource();
  source.buffer = buffer;
  source.loop = true;
  source.connect(c.destination);
  source.onended = () => source.disconnect();
  const at = c.currentTime + Math.max(0, inSeconds);
  source.start(at);
  if (Number.isFinite(duration)) source.stop(at + duration);
  return () => { try { source.stop(); } catch { /* Already ended. */ } source.disconnect(); };
}
