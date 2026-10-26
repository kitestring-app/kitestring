import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { INITIAL_RADIO, RADIO_STATIONS } from "../data/radio";
import { RadioPlayer, nowPlaying, pinRadio, radioStore, setRadioVolume } from "./radio";
import { dbGet } from "../lib/db";
import { flushAll } from "../lib/store";

class FakeAudio extends EventTarget {
  preload = "";
  crossOrigin: string | null = null;
  src = "";
  volume = 1;
  play = vi.fn(() => Promise.resolve());
  pause = vi.fn();
  load = vi.fn();
  removeAttribute = vi.fn((name: string) => {
    if (name === "src") this.src = "";
    if (name === "crossorigin") this.crossOrigin = null;
  });
}

const players: RadioPlayer[] = [];
function harness() {
  const audio = new FakeAudio();
  const factory = vi.fn(() => audio as unknown as HTMLAudioElement);
  const events = { onmessage: null as ((event: MessageEvent) => void) | null, onerror: null as (() => void) | null, close: vi.fn() };
  const source = vi.fn(() => events as unknown as EventSource);
  const request = vi.fn<typeof fetch>();
  const player = new RadioPlayer({ audio: factory, events: source, fetch: request });
  players.push(player);
  return { audio, factory, events, source, request, player };
}

beforeEach(async () => {
  vi.useFakeTimers();
  await radioStore.ready;
  nowPlaying.set(null);
  radioStore.set({ ...INITIAL_RADIO, pinned: [] });
});
afterEach(() => {
  players.splice(0).forEach((p) => p.dispose());
  vi.useRealTimers();
});

describe("shared radio transport", () => {
  it("applies master volume and mute without changing station volume or starting audio", async () => {
    const h = harness();
    h.player.setMasterVolume(0.5);
    expect(h.factory).not.toHaveBeenCalled();
    setRadioVolume(0.8);
    await h.player.play("nightride");
    expect(h.audio.volume).toBe(0.4);
    h.player.setMasterVolume(0);
    expect(h.audio.volume).toBe(0);
    setRadioVolume(0.6);
    expect(h.audio.volume).toBe(0);
    h.player.setMasterVolume(0.5);
    expect(h.audio.volume).toBe(0.3);
    expect(radioStore.get().volume).toBe(0.6);
  });
  it("does nothing until Play, reuses one element, saves selection and respects volume", async () => {
    const h = harness();
    expect(h.factory).not.toHaveBeenCalled();
    expect(h.source).not.toHaveBeenCalled();
    expect(h.request).not.toHaveBeenCalled();
    setRadioVolume(0.23);
    await h.player.play("nightride");
    expect(h.audio.preload).toBe("none");
    expect(h.audio.crossOrigin).toBe("anonymous");
    expect(h.audio.volume).toBe(0.23);
    expect(h.player.state.get().status).toBe("playing");
    expect(nowPlaying.get()).toBe("radio");
    await h.player.play("chillsynth");
    expect(h.factory).toHaveBeenCalledOnce();
    expect(h.audio.src).toContain("chillsynth.mp3");
    expect(radioStore.get().lastStation).toBe("chillsynth");
    setRadioVolume(0.8);
    expect(h.audio.volume).toBe(0.8);
    expect(h.events.close).toHaveBeenCalledOnce();
  });

  it("stops radio synchronously for embeds and does not resume it when the embed stops", async () => {
    const h = harness();
    await h.player.play("nightride");
    nowPlaying.set("embed");
    expect(h.audio.pause).toHaveBeenCalled();
    expect(h.audio.src).toBe("");
    expect(h.player.state.get().status).toBe("paused");
    expect(h.events.close).toHaveBeenCalled();
    nowPlaying.set(null);
    expect(h.audio.play).toHaveBeenCalledOnce();
  });

  it("claims music ownership before attempting playback", async () => {
    const h = harness();
    nowPlaying.set("embed");
    const stopEmbed = vi.fn();
    const unsubscribe = nowPlaying.subscribe(() => { if (nowPlaying.get() === "radio") stopEmbed(); });
    h.audio.play.mockImplementationOnce(() => { expect(stopEmbed).toHaveBeenCalledOnce(); return Promise.resolve(); });
    await h.player.play("nightride");
    unsubscribe();
  });

  it("ignores an old play rejection after a new selection, and a late resolution after pause", async () => {
    const h = harness();
    let reject!: (reason: Error) => void;
    h.audio.play.mockImplementationOnce(() => new Promise((_, fail) => { reject = fail; }));
    const first = h.player.play("nightride");
    await h.player.play("chillsynth");
    reject(new Error("aborted old stream"));
    await first;
    expect(h.player.state.get()).toMatchObject({ stationId: "chillsynth", status: "playing", error: "" });
    let resolve!: () => void;
    h.audio.play.mockImplementationOnce(() => new Promise<void>((done) => { resolve = done; }));
    const second = h.player.play("darksynth");
    h.player.pause();
    resolve();
    await second;
    expect(h.player.state.get().status).toBe("paused");
    expect(nowPlaying.get()).toBeNull();
  });

  it("releases a never-ending stream on pause and reconnects to live on resume", async () => {
    const h = harness();
    await h.player.play("nightride");
    h.player.toggle("nightride");
    expect(h.audio.src).toBe("");
    expect(h.audio.load).toHaveBeenCalled();
    expect(h.player.state.get().status).toBe("paused");
    h.player.toggle("nightride");
    await Promise.resolve();
    expect(h.audio.play).toHaveBeenCalledTimes(2);
    expect(h.player.state.get().status).toBe("playing");
  });

  it("handles connection errors and timeouts with a retry", async () => {
    const h = harness();
    h.audio.play.mockRejectedValueOnce(new Error("offline"));
    await h.player.play("nightride");
    expect(h.player.state.get().status).toBe("error");
    expect(h.player.state.get().error).toContain("retry");
    await h.player.play("nightride");
    expect(h.player.state.get().status).toBe("playing");
    h.audio.dispatchEvent(new Event("error"));
    expect(h.player.state.get().status).toBe("error");
    h.audio.play.mockImplementationOnce(() => new Promise(() => {}));
    void h.player.play("nightride");
    await vi.advanceTimersByTimeAsync(20_000);
    expect(h.player.state.get().status).toBe("error");
    expect(h.audio.src).toBe("");
  });

  it("shows buffering state and resumes the visualizer only on playing", async () => {
    const h = harness();
    await h.player.play("nightride");
    h.audio.dispatchEvent(new Event("waiting"));
    expect(h.player.state.get().status).toBe("loading");
    h.audio.dispatchEvent(new Event("playing"));
    expect(h.player.state.get().status).toBe("playing");
    expect(h.source).toHaveBeenCalledOnce();
    h.audio.dispatchEvent(new Event("ended"));
    expect(h.player.state.get().status).toBe("error");
  });

  it("toggles pins and advances through pinned order with wraparound", async () => {
    const h = harness();
    pinRadio("eve"); pinRadio("missing");
    expect(radioStore.get().pinned).toEqual(["eve"]);
    await h.player.play("paradise-mellow");
    h.player.next();
    await Promise.resolve();
    expect(h.player.state.get().stationId).toBe("eve");
    pinRadio("eve");
    expect(radioStore.get().pinned).toEqual([]);
    h.player.next();
    await Promise.resolve();
    expect(h.player.state.get().stationId).toBe("nightride");
  });

  it("persists preferences without saving transport ownership or playing state", async () => {
    const h = harness();
    pinRadio("eve");
    setRadioVolume(0.37);
    await h.player.play("paradise-mellow");
    await flushAll();
    expect(await dbGet("radio")).toEqual({ pinned: ["eve"], lastStation: "paradise-mellow", volume: 0.37 });
    expect(await dbGet("nowPlaying")).toBeUndefined();
    expect(await dbGet("radioPlayback")).toBeUndefined();
  });

  it("omits crossOrigin when a station has no CORS support", async () => {
    const h = harness();
    const station = RADIO_STATIONS[0];
    const previous = station.cors;
    try {
      station.cors = false;
      await h.player.play(station.id);
      expect(h.audio.crossOrigin).toBeNull();
      expect(h.audio.removeAttribute).toHaveBeenCalledWith("crossorigin");
    } finally { station.cors = previous; }
  });
});

describe("radio metadata lifecycle", () => {
  it("opens SSE only for active playback; unrelated updates do not erase the song", async () => {
    const h = harness();
    await h.player.play("nightride");
    const message = h.events.onmessage!;
    message({ data: '[{"station":"nightride","artist":"Artist","title":"Track"}]' } as MessageEvent);
    message({ data: '[{"station":"chillsynth","artist":"Other","title":"Track"}]' } as MessageEvent);
    expect(h.player.state.get().track).toBe("Artist — Track");
    h.events.onerror!();
    expect(h.player.state.get().track).toBeNull();
    expect(h.player.state.get().status).toBe("playing");
    h.player.pause();
    message({ data: '[{"station":"nightride","artist":"Late","title":"Update"}]' } as MessageEvent);
    expect(h.player.state.get().track).toBeNull();
    expect(h.events.onmessage).toBeNull();
  });

  it("plays Paradise without attempting a metadata API blocked by CORS", async () => {
    const h = harness();
    await h.player.play("paradise-main");
    expect(h.player.state.get().status).toBe("playing");
    expect(h.source).not.toHaveBeenCalled();
    expect(h.request).not.toHaveBeenCalled();
  });

  it("keeps audio playing when SSE cannot be created or polled metadata fails", async () => {
    const h = harness();
    h.source.mockImplementationOnce(() => { throw new Error("CORS blocked"); });
    await h.player.play("nightride");
    expect(h.player.state.get()).toMatchObject({ status: "playing", track: null });
    h.request.mockRejectedValueOnce(new Error("offline metadata"));
    await h.player.play("eve");
    await vi.advanceTimersByTimeAsync(0);
    expect(h.player.state.get()).toMatchObject({ status: "playing", track: null });
    h.player.pause();
    await vi.advanceTimersByTimeAsync(40_000);
    expect(h.request).toHaveBeenCalledOnce();
  });

  it("polls EVE metadata only while active and ignores a response after switching", async () => {
    const h = harness();
    h.request.mockResolvedValue({ ok: true, json: async () => ({ icestats: { source: { listenurl: "http://example.test/erweb.mp3", title: "Artist - Song" } } }) } as Response);
    await h.player.play("eve");
    await vi.advanceTimersByTimeAsync(0);
    expect(h.player.state.get().track).toBe("Artist — Song");
    await vi.advanceTimersByTimeAsync(20_000);
    expect(h.request).toHaveBeenCalledTimes(2);
    let resolve!: (value: Response) => void;
    h.request.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    await vi.advanceTimersByTimeAsync(20_000);
    const signal = h.request.mock.calls[2][1]?.signal;
    await h.player.play("chillsynth");
    expect(signal?.aborted).toBe(true);
    resolve({ ok: true, json: async () => ({ icestats: { source: { listenurl: "http://example.test/erweb.mp3", title: "Stale - Song" } } }) } as Response);
    await vi.advanceTimersByTimeAsync(40_000);
    expect(h.player.state.get().track).toBeNull();
    expect(h.request).toHaveBeenCalledTimes(3);
  });
});
