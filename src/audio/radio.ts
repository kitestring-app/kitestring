import { INITIAL_RADIO, RADIO_STATIONS, parseIcecast, parseNightride, radioVolume, restoreRadio, selectRadioStations } from "../data/radio";
import type { RadioPreferences, RadioStation } from "../data/radio";
import { createStore } from "../lib/store";
import type { Store } from "../lib/store";

// Transport state is deliberately volatile: hydration / another tab must never autoplay.
function liveStore<T>(key: string, initial: T): Store<T> {
  let value = initial;
  const listeners = new Set<() => void>();
  return {
    key, ready: Promise.resolve(), get: () => value,
    set(next) {
      value = typeof next === "function" ? (next as (prev: T) => T)(value) : next;
      listeners.forEach((fn) => fn());
    },
    subscribe(fn) { listeners.add(fn); return () => { listeners.delete(fn); }; },
  };
}

export const radioStore = createStore<RadioPreferences>("radio", INITIAL_RADIO, restoreRadio);
export const nowPlaying = liveStore<"radio" | "embed" | null>("nowPlaying", null);
export interface RadioPlayback {
  stationId: string | null;
  status: "idle" | "loading" | "playing" | "paused" | "error";
  track: string | null;
  error: string;
}
const INITIAL_PLAYBACK: RadioPlayback = { stationId: null, status: "idle", track: null, error: "" };

interface RadioDependencies {
  audio: () => HTMLAudioElement;
  events: (url: string) => EventSource;
  fetch: typeof fetch;
}

export class RadioPlayer {
  readonly state = liveStore<RadioPlayback>("radioPlayback", INITIAL_PLAYBACK);
  private audio: HTMLAudioElement | null = null;
  private masterVolume = 1;
  private generation = 0;
  private cleanup = () => {};
  private unsubscribeOwner: () => void;
  private unsubscribeVolume: () => void;
  private deps: RadioDependencies;

  constructor(deps: Partial<RadioDependencies> = {}) {
    this.deps = {
      audio: () => new Audio(), events: (url) => new EventSource(url),
      fetch: (...args) => fetch(...args), ...deps,
    };
    this.unsubscribeOwner = nowPlaying.subscribe(() => {
      if (nowPlaying.get() !== "radio") this.pause();
    });
    this.unsubscribeVolume = radioStore.subscribe(() => {
      if (this.audio) this.audio.volume = radioVolume(radioStore.get().volume) * this.masterVolume;
    });
  }

  setMasterVolume(volume: number) {
    this.masterVolume = radioVolume(volume);
    if (this.audio) this.audio.volume = radioVolume(radioStore.get().volume) * this.masterVolume;
  }

  async play(id: string) {
    const station = RADIO_STATIONS.find((s) => s.id === id);
    if (!station) return;
    this.stopTransport();
    const generation = this.generation;
    const current = () => generation === this.generation;
    this.state.set({ stationId: id, status: "loading", track: null, error: "" });
    radioStore.set((s) => ({ ...s, lastStation: id }));
    nowPlaying.set("radio");
    try {
      const audio = this.audio ??= this.deps.audio();
      audio.preload = "none";
      if (station.cors) audio.crossOrigin = "anonymous";
      else audio.removeAttribute("crossorigin");
      audio.volume = radioVolume(radioStore.get().volume) * this.masterVolume;
      let metadataCleanup: (() => void) | null = null;
      const update = (patch: Partial<RadioPlayback>) => {
        if (current()) this.state.set((s) => ({ ...s, ...patch }));
      };
      const playing = () => {
        if (!current()) return;
        clearTimeout(timeout);
        update({ status: "playing", error: "" });
        metadataCleanup ??= this.metadata(station, (track) => update({ track }));
      };
      const waiting = () => update({ status: "loading" });
      const failed = () => this.fail(generation);
      const paused = () => update({ status: "paused", track: null });
      const events: [string, () => void][] = [
        ["playing", playing], ["waiting", waiting], ["stalled", waiting],
        ["pause", paused], ["error", failed], ["ended", failed],
      ];
      events.forEach(([name, fn]) => audio.addEventListener(name, fn));
      const timeout = setTimeout(failed, 20_000);
      this.cleanup = () => {
        clearTimeout(timeout);
        metadataCleanup?.();
        events.forEach(([name, fn]) => audio.removeEventListener(name, fn));
      };
      audio.src = station.stream;
      // play() resolves only once playback starts; rejection must not overwrite a newer choice.
      // https://developer.mozilla.org/en-US/docs/Web/API/HTMLMediaElement/play
      await audio.play();
      if (current()) playing();
    } catch {
      this.fail(generation);
    }
  }

  pause() {
    this.stopTransport();
    this.state.set((s) => ({ ...s, status: s.stationId ? "paused" : "idle", track: null, error: "" }));
    if (nowPlaying.get() === "radio") nowPlaying.set(null);
  }

  toggle(id = radioStore.get().lastStation) {
    const state = this.state.get();
    if (state.stationId === id && (state.status === "playing" || state.status === "loading")) this.pause();
    else void this.play(id);
  }

  next() {
    const stations = selectRadioStations("", radioStore.get().pinned);
    const id = this.state.get().stationId ?? radioStore.get().lastStation;
    void this.play(stations[(stations.findIndex((s) => s.id === id) + 1) % stations.length].id);
  }

  dispose() {
    this.pause();
    this.unsubscribeOwner();
    this.unsubscribeVolume();
    this.audio = null;
  }

  private stopTransport() {
    this.generation++;
    this.cleanup();
    this.cleanup = () => {};
    if (this.audio) {
      this.audio.pause();
      this.audio.removeAttribute("src");
      this.audio.load(); // release the never-ending connection, resume at the live edge
    }
  }

  private fail(generation: number) {
    if (generation !== this.generation) return;
    this.stopTransport();
    if (nowPlaying.get() === "radio") nowPlaying.set(null);
    this.state.set((s) => ({ ...s, status: "error", track: null, error: "Station could not play. Check your connection, then retry or choose another station." }));
  }

  private metadata(station: RadioStation, update: (value: string | null) => void): () => void {
    const metadata = station.metadata;
    if (!metadata) return () => {};
    if (metadata.kind === "nightride") {
      try {
        const events = this.deps.events(metadata.url);
        events.onmessage = (event) => {
          const track = parseNightride(event.data, station.id);
          if (track) update(track); // updates for other stations must not clear this one
        };
        events.onerror = () => { events.close(); update(null); };
        return () => { events.onmessage = null; events.onerror = null; events.close(); };
      } catch { return () => {}; }
    }
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let request: AbortController | undefined;
    const poll = async () => {
      request = new AbortController();
      const timeout = setTimeout(() => request?.abort(), 8_000);
      try {
        const response = await this.deps.fetch(metadata.url, { signal: request.signal, credentials: "omit" });
        const track = response.ok ? parseIcecast(await response.json(), station.stream) : null;
        if (!stopped) update(track);
      } catch { if (!stopped) update(null); }
      finally {
        clearTimeout(timeout);
        if (!stopped) timer = setTimeout(() => void poll(), 20_000);
      }
    };
    void poll();
    return () => { stopped = true; clearTimeout(timer); request?.abort(); };
  }
}

// A single module-owned element survives panel closure and tab changes. Created only on Play.
export const radioPlayer = new RadioPlayer();
export function pinRadio(id: string) {
  if (!RADIO_STATIONS.some((s) => s.id === id)) return;
  radioStore.set((s) => ({ ...s, pinned: s.pinned.includes(id) ? s.pinned.filter((v) => v !== id) : [...s.pinned, id] }));
}
export function setRadioVolume(volume: number) {
  radioStore.set((s) => ({ ...s, volume: radioVolume(volume) }));
}
