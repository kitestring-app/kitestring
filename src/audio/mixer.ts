import { getCtx, masterOut } from "./core";
import { bufferVoice, createProcedural, seamlessBuffer } from "./procedural";
import type { SoundVoice } from "./procedural";
import { clampVolume, parseLayers, parseMix, SOUNDS } from "../data/sounds";
import type { MixLayer, SoundDefinition, SoundMix } from "../data/sounds";
import { musicFavouriteUrl, toEmbedUrl } from "../data/stations";
import { createStore } from "../lib/store";

export interface MusicFavourite {
  id: string;
  name: string;
  emoji: string;
  url: string;
}
export interface MixerData {
  layers: MixLayer[];
  mixes: SoundMix[];
  favourites: MusicFavourite[];
}

export function parseMixerData(input: unknown): MixerData {
  const data =
    input && typeof input === "object" ? (input as Partial<MixerData>) : {};
  return {
    layers: parseLayers(data.layers),
    mixes: Array.isArray(data.mixes)
      ? data.mixes.map(parseMix).filter((m): m is SoundMix => m !== null)
      : [],
    favourites: Array.isArray(data.favourites)
      ? data.favourites
          .filter(
            (f) =>
              f &&
              typeof f.id === "string" &&
              typeof f.name === "string" &&
              typeof f.emoji === "string" &&
              typeof f.url === "string" &&
              toEmbedUrl(f.url),
          )
          .slice(0, 5)
          .map((f) => ({
            id: f.id.slice(0, 80),
            name: f.name.slice(0, 60),
            emoji: f.emoji.slice(0, 16),
            url: musicFavouriteUrl(f.url)!,
          }))
      : [],
  };
}

export const mixerStore = createStore<MixerData>(
  "mixer",
  { layers: [], mixes: [], favourites: [] },
  parseMixerData,
);

const FADE = 0.3;
interface Layer {
  gain: GainNode;
  voice?: SoundVoice;
  volume: number;
}
interface MixerDependencies {
  context: () => AudioContext;
  output: () => AudioNode;
  voice: (ctx: AudioContext, sound: SoundDefinition) => Promise<SoundVoice>;
}

const recordings = new WeakMap<
  AudioContext,
  Map<string, Promise<AudioBuffer>>
>();
async function loadVoice(
  ctx: AudioContext,
  sound: SoundDefinition,
): Promise<SoundVoice> {
  if (sound.layers) return layeredVoice(ctx, sound.layers, loadVoice);
  if (!sound.file) return createProcedural(ctx, sound);
  let cache = recordings.get(ctx);
  if (!cache) {
    cache = new Map();
    recordings.set(ctx, cache);
  }
  let pending = cache.get(sound.id);
  if (!pending) {
    pending = fetch(`${import.meta.env.BASE_URL}sounds/${sound.file}`)
      .then((r) => {
        if (!r.ok) throw new Error("Recording unavailable");
        return r.arrayBuffer();
      })
      .then((bytes) => ctx.decodeAudioData(bytes))
      .then((buffer) => seamlessBuffer(ctx, buffer));
    cache.set(sound.id, pending);
    void pending.catch(() => cache!.delete(sound.id));
  }
  return bufferVoice(ctx, await pending);
}

/** All child voices share the parent's fade, volume and lifetime. */
export async function layeredVoice(
  ctx: AudioContext,
  layers: readonly MixLayer[],
  voice: MixerDependencies["voice"],
): Promise<SoundVoice> {
  const output = ctx.createGain();
  const children: SoundVoice[] = [];
  const gains: GainNode[] = [];
  const results = await Promise.allSettled(layers.map(async (layer) => {
    const definition = SOUNDS.find((item) => item.id === layer.id);
    if (!definition) throw new Error(`Unknown scene layer: ${layer.id}`);
    const child = await voice(ctx, definition);
    children.push(child);
    const gain = ctx.createGain();
    gains.push(gain);
    gain.gain.value = clampVolume(layer.volume);
    child.output.connect(gain).connect(output);
  }));
  let stopped = false;
  const stop = (at = ctx.currentTime) => {
    if (stopped) return;
    stopped = true;
    children.forEach((child) => child.stop(at));
    setTimeout(() => {
      gains.forEach((gain) => gain.disconnect());
      output.disconnect();
    }, Math.max(0, at - ctx.currentTime) * 1000 + 50);
  };
  if (results.some((result) => result.status === "rejected")) {
    stop();
    throw new Error("Scene recording unavailable");
  }
  return { output, stop };
}

export class SoundMixer {
  private layers = new Map<string, Layer>();
  private revision = 0;
  private deps: MixerDependencies;
  private pending: { revision: number; desired: MixLayer[]; onError: (id: string) => void } | null = null;
  private inFlight: Promise<void> | null = null;

  constructor(deps: Partial<MixerDependencies> = {}) {
    this.deps = {
      context: getCtx,
      output: masterOut,
      voice: loadVoice,
      ...deps,
    };
  }

  private ramp(gain: GainNode, volume: number, ctx: AudioContext) {
    const at = ctx.currentTime;
    if (typeof gain.gain.cancelAndHoldAtTime === "function")
      gain.gain.cancelAndHoldAtTime(at);
    else {
      gain.gain.cancelScheduledValues(at);
      gain.gain.setValueAtTime(gain.gain.value, at);
    }
    gain.gain.linearRampToValueAtTime(clampVolume(volume) ** 2, at + FADE);
  }

  private remove(id: string, layer: Layer, ctx: AudioContext) {
    this.layers.delete(id);
    this.ramp(layer.gain, 0, ctx);
    layer.voice?.stop(ctx.currentTime + FADE);
    setTimeout(() => layer.gain.disconnect(), FADE * 1000 + 50);
  }

  sync(input: MixLayer[], playing: boolean, onError: (id: string) => void = () => {}): Promise<void> {
    this.pending = { revision: ++this.revision, desired: playing ? parseLayers(input) : [], onError };
    if (!this.inFlight) {
      // Assign the promise before invoking dependencies, including synchronous/reentrant ones.
      this.inFlight = Promise.resolve().then(() => this.drain());
    }
    return this.inFlight;
  }

  private async drain() {
    try {
      while (this.pending) {
        const request = this.pending;
        this.pending = null;
        if (!request.desired.length && !this.layers.size) continue;
        try {
          const ctx = this.deps.context();
          if (ctx.state === "suspended") await ctx.resume();
          if (request.revision !== this.revision) continue;
          await this.apply(request.desired, ctx, request.onError, request.revision);
        } catch (error) {
          if (request.revision === this.revision) throw error;
        }
      }
    } finally { this.inFlight = null; }
  }

  private async apply(
    desired: MixLayer[],
    ctx: AudioContext,
    onError: (id: string) => void,
    revision: number,
  ) {
    for (const [id, layer] of this.layers)
      if (!desired.some((l) => l.id === id)) this.remove(id, layer, ctx);
    await Promise.all(
      desired.map(async ({ id, volume }) => {
        const existing = this.layers.get(id);
        if (existing) {
          existing.volume = volume;
          if (existing.voice) this.ramp(existing.gain, volume, ctx);
          return;
        }
        const sound = SOUNDS.find((s) => s.id === id)!;
        const gain = ctx.createGain();
        gain.gain.value = 0;
        gain.connect(this.deps.output());
        const layer: Layer = { gain, volume };
        this.layers.set(id, layer);
        try {
          const voice = await this.deps.voice(ctx, sound);
          if (revision !== this.revision || this.layers.get(id) !== layer) {
            voice.stop();
            // dispose() already scheduled disconnection if it removed this layer.
            if (this.layers.get(id) === layer) { this.layers.delete(id); gain.disconnect(); }
            return;
          }
          layer.voice = voice;
          voice.output.connect(gain);
          this.ramp(gain, layer.volume, ctx);
        } catch {
          if (this.layers.get(id) === layer) {
            this.layers.delete(id);
            gain.disconnect();
            if (revision === this.revision) onError(id);
          }
        }
      }),
    );
  }

  dispose() {
    ++this.revision;
    this.pending = null;
    if (!this.layers.size) return;
    const ctx = this.deps.context();
    for (const [id, layer] of this.layers) this.remove(id, layer, ctx);
  }
}
