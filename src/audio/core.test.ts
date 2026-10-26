import { afterEach, expect, it, vi } from "vitest";
import { ALERT_KINDS, ALERT_SAMPLE_RATE, ALERT_SOUNDS, renderSelectedAlert } from "./alertSynth";

afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

it("previews and schedules the bundled waveform, phase and volume on any output sample rate", async () => {
  const buffers: { samples: Float32Array; rate: number }[] = [];
  const sources: { buffer: unknown; start: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn> }[] = [];
  const gains: { gain: { value: number }; connect: () => unknown; disconnect: ReturnType<typeof vi.fn> }[] = [];
  class Context {
    sampleRate = 48000;
    currentTime = 10;
    destination = {};
    createGain() {
      const node = { gain: { value: 0 }, connect: () => node, disconnect: vi.fn() };
      gains.push(node);
      return node;
    }
    createDynamicsCompressor() {
      return { threshold: {}, knee: {}, ratio: {}, attack: {}, release: {}, connect() {} };
    }
    createBuffer(_channels: number, length: number, rate: number) {
      const buffer = { samples: new Float32Array(length), rate, copyToChannel(data: Float32Array) { this.samples.set(data); } };
      buffers.push(buffer);
      return buffer;
    }
    createBufferSource() {
      const node = { buffer: null as unknown, connect() {}, start: vi.fn(), stop: vi.fn() };
      sources.push(node);
      return node;
    }
  }
  vi.stubGlobal("AudioContext", Context);
  const { previewChime, scheduleChime, cancelChime, releaseChime, cancelAllChimes } = await import("./core");
  for (const sound of ALERT_SOUNDS.filter(sound => sound !== "none")) {
    for (const kind of ALERT_KINDS) {
      previewChime(sound, 0.4, kind);
      const preview = sources.at(-1)!;
      const buffer = buffers.at(-1)!;
      expect(buffer.rate).toBe(ALERT_SAMPLE_RATE);
      expect(buffer.samples).toEqual(renderSelectedAlert(sound, kind));
      expect(preview.start).toHaveBeenCalledWith(10);
      expect(gains.at(-1)!.gain.value).toBe(0.4);
      scheduleChime(sound, 0.4, 30, kind);
      expect(sources.at(-1)!.buffer).toBe(preview.buffer);
      expect(sources.at(-1)!.start).toHaveBeenCalledWith(40);
      cancelChime();
      expect(sources.at(-1)!.stop).toHaveBeenCalledOnce();
      expect(preview.stop).not.toHaveBeenCalled();
    }
  }
  const count = sources.length;
  previewChime("none", 1);
  scheduleChime("none", 1);
  expect(sources).toHaveLength(count);
  scheduleChime("bell", 0.5);
  const released = sources.at(-1)!;
  releaseChime();
  scheduleChime("wood", 0.5, 60);
  const future = sources.at(-1)!;
  cancelAllChimes(); cancelAllChimes();
  expect(released.stop).toHaveBeenCalledOnce();
  expect(future.stop).toHaveBeenCalledOnce();
  expect(sources.every(source => source.stop.mock.calls.length >= 1)).toBe(true);
});

it("runs tick loops entirely on the audio clock, with a scheduled end and immediate cancellation", async () => {
  const source = { buffer: null as unknown, loop: false, connect: vi.fn(), disconnect: vi.fn(), start: vi.fn(), stop: vi.fn() };
  const samples: Float32Array[] = [];
  class Context {
    sampleRate = 48000; currentTime = 10; destination = {};
    createGain() { const node = { gain: {}, connect: () => node }; return node; }
    createDynamicsCompressor() { return { threshold: {}, knee: {}, ratio: {}, attack: {}, release: {}, connect() {} }; }
    createBuffer(_channels: number, length: number, rate: number) {
      expect(length).toBe(rate); expect(rate).toBe(48000);
      return { copyToChannel: (data: Float32Array) => samples.push(data) };
    }
    createBufferSource() { return source; }
  }
  vi.stubGlobal("AudioContext", Context);
  const pageTimer = vi.spyOn(globalThis, "setTimeout");
  try {
    const { playTimerTick } = await import("./core");
    for (const style of ["soft", "wood", "digital"] as const) {
      const cancel = playTimerTick(style, 0.5, 0.25, 3);
      expect(source.loop).toBe(true);
      expect(source.start).toHaveBeenLastCalledWith(10.25);
      expect(source.stop).toHaveBeenLastCalledWith(13.25);
      const data = samples.at(-1)!;
      expect(data.slice(0, 2000).some(value => value !== 0)).toBe(true);
      expect(data.slice(2160).every(value => value === 0)).toBe(true);
      cancel(); expect(source.stop).toHaveBeenLastCalledWith(); expect(source.disconnect).toHaveBeenCalled();
    }
    source.stop.mockClear();
    const cancel = playTimerTick("soft", 0.5, 0.625, Infinity);
    expect(source.start).toHaveBeenLastCalledWith(10.625);
    expect(source.stop).not.toHaveBeenCalled();
    cancel(); expect(source.stop).toHaveBeenCalledOnce();
    expect(pageTimer).not.toHaveBeenCalled();
  } finally { pageTimer.mockRestore(); }
});
