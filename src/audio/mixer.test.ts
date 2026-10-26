import { afterEach, describe, expect, it, vi } from "vitest";
import { layeredVoice, SoundMixer } from "./mixer";
import type { SoundVoice } from "./procedural";

function harness() {
  const gains: {
    gain: {
      value: number;
      cancelAndHoldAtTime: ReturnType<typeof vi.fn>;
      linearRampToValueAtTime: ReturnType<typeof vi.fn>;
    };
    connect: ReturnType<typeof vi.fn>;
    disconnect: ReturnType<typeof vi.fn>;
  }[] = [];
  const ctx = {
    currentTime: 12,
    state: "running",
    resume: vi.fn(async () => {}),
    createGain: () => {
      const gain = {
        gain: {
          value: 1,
          cancelAndHoldAtTime: vi.fn(),
          linearRampToValueAtTime: vi.fn(),
        },
        connect: vi.fn(),
        disconnect: vi.fn(),
      };
      gains.push(gain);
      return gain;
    },
  };
  const voices: SoundVoice[] = [];
  const create = (): SoundVoice => {
    const voice = {
      output: { connect: vi.fn() } as unknown as AudioNode,
      stop: vi.fn(),
    };
    voices.push(voice);
    return voice;
  };
  const load = vi.fn(async () => create());
  const mixer = new SoundMixer({
    context: () => ctx as unknown as AudioContext,
    output: () => ({}) as AudioNode,
    voice: load,
  });
  return { mixer, ctx, gains, voices, load, create };
}

afterEach(() => {
  vi.useRealTimers();
});
describe("mixer lifecycle", () => {
  it("stops and disconnects every scene child once at the parent's fade deadline", async () => {
    vi.useFakeTimers();
    const h = harness();
    const connect = (node: AudioNode) => node;
    const load = vi.fn(async () => ({ output: { connect } as AudioNode, stop: vi.fn() }));
    const ctx = { ...h.ctx, createGain: () => {
      const node = h.ctx.createGain(); node.connect.mockImplementation(connect); return node;
    } } as unknown as AudioContext;
    const voice = await layeredVoice(ctx, [{ id: "birds", volume: 0.55 }, { id: "wind", volume: 0.2 }], load);
    expect(h.gains.slice(1).map((gain) => gain.gain.value)).toEqual([0.55, 0.2]);
    voice.stop(12.3); voice.stop(13);
    for (const result of load.mock.results) expect((await result.value).stop).toHaveBeenCalledExactlyOnceWith(12.3);
    await vi.runAllTimersAsync();
    expect(h.gains.every((node) => node.disconnect.mock.calls.length === 1)).toBe(true);
  });
  it("cleans up a scene even when one recording fails before a sibling finishes loading", async () => {
    vi.useFakeTimers();
    const h = harness();
    const connect = (node: AudioNode) => node;
    let resolve!: (voice: SoundVoice) => void;
    const child = { output: { connect } as AudioNode, stop: vi.fn() };
    const load = vi.fn().mockRejectedValueOnce(new Error("Unavailable")).mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    const ctx = { ...h.ctx, createGain: () => {
      const node = h.ctx.createGain(); node.connect.mockImplementation(connect); return node;
    } } as unknown as AudioContext;
    const scene = layeredVoice(ctx, [{ id: "birds", volume: 0.5 }, { id: "wind", volume: 0.2 }], load);
    const rejected = expect(scene).rejects.toThrow("Scene recording unavailable");
    resolve(child);
    await rejected;
    expect(child.stop).toHaveBeenCalledExactlyOnceWith(12);
    await vi.runAllTimersAsync();
    expect(h.gains.every((node) => node.disconnect.mock.calls.length === 1)).toBe(true);
  });
  it("layers independent voices, changes levels without restarting, and fades out in 300 ms", async () => {
    vi.useFakeTimers();
    const h = harness();
    await h.mixer.sync(
      [
        { id: "rain", volume: 0.5 },
        { id: "brown", volume: 0.3 },
      ],
      true,
    );
    expect(h.load).toHaveBeenCalledTimes(2);
    expect(h.gains[0].gain.linearRampToValueAtTime).toHaveBeenLastCalledWith(
      0.25,
      12.3,
    );
    await h.mixer.sync([{ id: "rain", volume: 0.8 }], true);
    expect(h.load).toHaveBeenCalledTimes(2);
    expect(h.gains[0].gain.linearRampToValueAtTime).toHaveBeenLastCalledWith(
      0.8 ** 2,
      12.3,
    );
    expect(h.voices[1].stop).toHaveBeenCalledWith(12.3);
    await h.mixer.sync([{ id: "rain", volume: 0.8 }], false);
    expect(h.voices[0].stop).toHaveBeenCalledWith(12.3);
    await vi.runAllTimersAsync();
    expect(h.gains.every((g) => g.disconnect.mock.calls.length === 1)).toBe(
      true,
    );
  });
  it("stops a late recording after pause rather than connecting it", async () => {
    vi.useFakeTimers();
    const h = harness();
    let resolve!: (voice: SoundVoice) => void;
    h.load.mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    const pending = h.mixer.sync([{ id: "cafe", volume: 0.5 }], true);
    await Promise.resolve();
    const paused = h.mixer.sync([], false);
    const voice = h.create();
    resolve(voice);
    await Promise.all([pending, paused]);
    expect(voice.stop).toHaveBeenCalled();
    expect(voice.output.connect).not.toHaveBeenCalled();
    await vi.runAllTimersAsync();
  });
  it("a delayed resume cannot undo a newer pause", async () => {
    const h = harness();
    let resolve!: () => void;
    h.ctx.state = "suspended";
    h.ctx.resume.mockImplementationOnce(
      () =>
        new Promise<void>((r) => {
          resolve = r;
        }),
    );
    const pending = h.mixer.sync([{ id: "rain", volume: 0.5 }], true);
    await Promise.resolve();
    const paused = h.mixer.sync([], false);
    resolve();
    await Promise.all([pending, paused]);
    expect(h.load).not.toHaveBeenCalled();
  });
  it("serializes applies, coalesces slider updates, and disconnects a superseded voice", async () => {
    const h = harness();
    let resolve!: (voice: SoundVoice) => void;
    h.load.mockImplementationOnce(() => new Promise((r) => { resolve = r; }));
    const first = h.mixer.sync([{ id: "rain", volume: 0.1 }], true);
    await Promise.resolve();
    const middle = h.mixer.sync([{ id: "rain", volume: 0.4 }], true);
    const latest = h.mixer.sync([{ id: "rain", volume: 0.9 }], true);
    expect(h.load).toHaveBeenCalledTimes(1);
    const stale = h.create();
    resolve(stale);
    await Promise.all([first, middle, latest]);
    expect(stale.stop).toHaveBeenCalledOnce();
    expect(stale.output.connect).not.toHaveBeenCalled();
    expect(h.gains[0].disconnect).toHaveBeenCalledOnce();
    expect(h.load).toHaveBeenCalledTimes(2);
    expect(h.gains[1].gain.linearRampToValueAtTime).toHaveBeenLastCalledWith(0.9 ** 2, 12.3);
    h.mixer.dispose();
  });
  it("dispose during loading discards stale results and permits Strict Mode reuse", async () => {
    vi.useFakeTimers();
    const h = harness();
    let resolve!: (voice: SoundVoice) => void;
    h.load.mockImplementationOnce(() => new Promise((r) => { resolve = r; }));
    const first = h.mixer.sync([{ id: "cafe", volume: 0.5 }], true);
    await Promise.resolve();
    h.mixer.dispose();
    const reused = h.mixer.sync([{ id: "brown", volume: 0.6 }], true);
    const stale = h.create(); resolve(stale);
    await Promise.all([first, reused]);
    await vi.runAllTimersAsync();
    expect(stale.output.connect).not.toHaveBeenCalled();
    expect(stale.stop).toHaveBeenCalledOnce();
    expect(h.gains[0].disconnect).toHaveBeenCalledOnce();
    expect(h.voices[1].output.connect).toHaveBeenCalledOnce();
    h.mixer.dispose();
    await vi.runAllTimersAsync();
    expect(h.gains.every((gain) => gain.disconnect.mock.calls.length === 1)).toBe(true);
  });
  it("does not report a stale loading failure or remove the latest layer", async () => {
    const h = harness(), error = vi.fn();
    let reject!: (error: Error) => void;
    h.load.mockImplementationOnce(() => new Promise((_, fail) => { reject = fail; }));
    const first = h.mixer.sync([{ id: "rain", volume: 0.1 }], true, error);
    await Promise.resolve();
    const latest = h.mixer.sync([{ id: "brown", volume: 0.8 }], true, error);
    reject(new Error("old failure"));
    await Promise.all([first, latest]);
    expect(error).not.toHaveBeenCalled();
    expect(h.gains[0].disconnect).toHaveBeenCalledOnce();
    expect(h.voices[0].output.connect).toHaveBeenCalledOnce();
    h.mixer.dispose();
  });
  it("only applies the latest synchronous request before any voices are loaded", async () => {
    const h = harness();
    await Promise.all([
      h.mixer.sync([{ id: "rain", volume: 0.1 }], true),
      h.mixer.sync([{ id: "cafe", volume: 0.4 }], true),
      h.mixer.sync([{ id: "brown", volume: 0.9 }], true),
    ]);
    expect(h.load).toHaveBeenCalledTimes(1);
    expect(h.load.mock.calls[0]).toEqual(expect.arrayContaining([expect.objectContaining({ id: "brown" })]));
    h.mixer.dispose();
  });
  it("reports loading failures, cleans up, and allows retry", async () => {
    const h = harness();
    const error = vi.fn();
    h.load.mockRejectedValueOnce(new Error("offline"));
    await h.mixer.sync([{ id: "cafe", volume: 0.5 }], true, error);
    expect(error).toHaveBeenCalledWith("cafe");
    expect(h.gains[0].disconnect).toHaveBeenCalled();
    await h.mixer.sync([{ id: "cafe", volume: 0.5 }], true, error);
    expect(h.load).toHaveBeenCalledTimes(2);
    h.mixer.dispose();
  });
  it("never creates an audio context for an idle mixer", async () => {
    const context = vi.fn();
    const mixer = new SoundMixer({ context });
    await mixer.sync([{ id: "rain", volume: 0.5 }], false);
    mixer.dispose();
    expect(context).not.toHaveBeenCalled();
  });
});
