import { cancelAllChimes, previewChime } from "./core";
import { cancelCompanionSpeech, disarmCompanion } from "./companion";
import type { AlertKind, AlertSound } from "./alertSynth";
import { alertTypingGuard } from "../lib/alertTypingGuard";

export interface BoundarySound { segId: string; nextSegId: string; ringing: boolean; sounding: boolean; silenced: boolean }
export function createBoundaryAlert(stopChannels: () => void | Promise<unknown>) {
  let state: BoundarySound = { segId: "", nextSegId: "", ringing: false, sounding: false, silenced: false };
  const listeners = new Set<() => void>();
  const timers = new Set<ReturnType<typeof setTimeout>>();
  let stopping: Promise<unknown> = Promise.resolve();
  const emit = () => listeners.forEach(fn => fn());
  const clear = () => { timers.forEach(clearTimeout); timers.clear(); };
  const defer = (fn: () => void, ms: number) => {
    const id = setTimeout(() => { timers.delete(id); fn(); }, ms);
    timers.add(id);
    return () => { clearTimeout(id); timers.delete(id); };
  };
  return {
    get: () => state,
    subscribe(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn); }; },
    begin(segId: string, nextSegId: string, repeat?: () => void) {
      alertTypingGuard.begin();
      clear();
      const soundWindow = () => {
        state = { ...state, sounding: true }; emit();
        defer(() => { state = { ...state, sounding: false }; emit(); }, 12_000);
      };
      state = { segId, nextSegId, ringing: true, sounding: false, silenced: false };
      soundWindow();
      if (repeat) for (let i = 1; i <= 5; i++) defer(() => { if (state.ringing) { repeat(); soundWindow(); } }, i * 60_000);
      defer(() => { state = { ...state, ringing: false, sounding: false }; emit(); }, repeat ? 312_000 : 12_000);
    },
    defer,
    stop() {
      if (state.silenced) return stopping;
      clear();
      state = { ...state, ringing: false, sounding: false, silenced: true }; emit();
      // Every channel is attempted even if another throws or rejects.
      try { stopping = Promise.resolve(stopChannels()).catch(() => undefined); } catch { stopping = Promise.resolve(); }
      return stopping;
    },
    resumeTicks() { if (state.silenced) { state = { ...state, silenced: false }; emit(); } },
    endReminders() { clear(); state = { ...state, ringing: false, sounding: false }; emit(); },
  };
}

export const boundaryAlert = createBoundaryAlert(() => {
  const results: Promise<unknown>[] = [];
  for (const stop of [cancelAllChimes, () => window.speechSynthesis?.cancel(), cancelCompanionSpeech, disarmCompanion]) {
    try { results.push(Promise.resolve(stop())); } catch { /* Still attempt the other channels. */ }
  }
  return Promise.allSettled(results);
});

export function repeatBoundarySound(sound: AlertSound, volume: number, kind: AlertKind) {
  previewChime(sound, volume, kind);
}
