import { afterEach, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS, CALM_PATCH, sanitizeSettings } from "../state/settings";
import { INITIAL_TIMER } from "../state/timerEngine";
import { renderSelectedAlert } from "./alertSynth";
import { renderStartChime, shouldStartChime, playStartChime } from "./startChime";
import { getCtx } from "./core";

vi.mock("./core", async original => ({ ...await original<typeof import("./core")>(), getCtx: vi.fn() }));
afterEach(() => vi.clearAllMocks());
const t = DEFAULT_SETTINGS.timer;
it("starts focus, including stopwatch, but never resume, restore, follower or break", () => {
  expect(shouldStartChime(INITIAL_TIMER, t, false)).toBe(true);
  expect(shouldStartChime(INITIAL_TIMER, { ...t, mode: "stopwatch" }, false)).toBe(true);
  for (const state of [ { ...INITIAL_TIMER, elapsedBefore: 1 }, { ...INITIAL_TIMER, frozen: true },
    { ...INITIAL_TIMER, startedAt: 100 }, { ...INITIAL_TIMER, segment: "short" as const },
    { ...INITIAL_TIMER, segment: "long" as const } ]) expect(shouldStartChime(state, t, false)).toBe(false);
  for (const patch of [{ startChime: false }, { alertVolume: 0 }, { focusDoneSound: "none" as const, breakOverSound: "none" as const }, CALM_PATCH])
    expect(shouldStartChime(INITIAL_TIMER, { ...t, ...patch }, false)).toBe(false);
  expect(shouldStartChime(INITIAL_TIMER, t, true)).toBe(false);
  // Hard mode does not forbid sounds. Its normal quiet choices still apply.
  expect(shouldStartChime(INITIAL_TIMER, { ...t, hardMode: true }, false)).toBe(true);
});
it("defaults on and sanitizes the portable settings", () => {
  expect(sanitizeSettings({}).timer).toMatchObject({ startChime: true, startChimeSound: "bubble" });
  expect(sanitizeSettings({ timer: { startChime: false, startChimeSound: "bell" } }).timer).toMatchObject({ startChime: false, startChimeSound: "bell" });
  expect(sanitizeSettings({ timer: { startChime: "yes", startChimeSound: "invalid" } }).timer).toMatchObject({ startChime: true, startChimeSound: "bubble" });
});
it.each(["bubble", "music-box", "bell"] as const)("%s is deterministic, soft, click-free and 2.5 seconds", sound => {
  const samples = renderStartChime(sound, 8000);
  const peak = (s: Float32Array) => s.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
  expect(samples.length / 8000).toBe(2.5);
  expect(samples).toEqual(renderStartChime(sound, 8000));
  expect(peak(samples)).toBeGreaterThan(0.01);
  expect(peak(samples)).toBeLessThan(peak(renderSelectedAlert("wood", "focus-done", 8000)));
  expect(samples.every(Number.isFinite)).toBe(true);
  expect(samples[0]).toBe(0); expect(samples.at(-1)).toBeCloseTo(0, 6);
  expect(peak(samples.slice(0, 40))).toBeLessThan(0.02);
});
it("starts on the shared audio clock and tolerates unavailable or suspended audio", () => {
  const start = vi.fn(), disconnect = vi.fn();
  const source = { buffer: null, connect: vi.fn(), start, onended: null as null | (() => void), disconnect };
  vi.mocked(getCtx).mockReturnValue({ currentTime: 7, destination: {}, createBuffer: () => ({ copyToChannel: vi.fn() }),
    createGain: () => ({ gain: { value: 0 }, connect: vi.fn(), disconnect }), createBufferSource: () => source } as unknown as AudioContext);
  playStartChime("bubble", 0.5);
  expect(start).toHaveBeenCalledWith(7);
  source.onended!(); expect(disconnect).toHaveBeenCalled();
  vi.mocked(getCtx).mockImplementation(() => { throw new Error("Audio unavailable"); });
  expect(() => playStartChime("bubble", 0.5)).not.toThrow();
});
it("does not queue a stale cue behind a blocked AudioContext", async () => {
  const start = vi.fn();
  let resume!: () => void;
  const c = { state: "suspended", resume: vi.fn(() => new Promise<void>(resolve => { resume = resolve; })),
    currentTime: 0, destination: {}, createBuffer: () => ({ copyToChannel: vi.fn() }),
    createGain: () => ({ gain: {}, connect: vi.fn(), disconnect: vi.fn() }),
    createBufferSource: () => ({ start, connect: vi.fn(), disconnect: vi.fn() }) };
  vi.mocked(getCtx).mockReturnValue(c as unknown as AudioContext);
  playStartChime("bubble", 0.5);
  expect(c.resume).toHaveBeenCalled();
  resume(); await Promise.resolve();
  expect(start).not.toHaveBeenCalled();
});
