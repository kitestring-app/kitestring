import { afterEach, describe, expect, it, vi } from "vitest";
import { ALERT_SOUNDS } from "./alertSynth";

afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

describe("spoken companion alarms", () => {
  it.each(ALERT_SOUNDS)("sends %s through alarm, speech and test requests", async (alertSound) => {
    vi.stubGlobal("location", { hostname: "localhost" });
    const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
    vi.stubGlobal("fetch", fetch);
    const { armCompanion, armCompanionWithSpeech, testCompanion } = await import("./companion");
    await armCompanion(123, "focus-done", 0.6, alertSound);
    expect(JSON.parse(fetch.mock.calls.at(-1)![1].body)).toEqual({ at: 123, kind: "focus-done", volume: 0.6, speak: false, alertSound });
    await armCompanionWithSpeech(456, "break-over", 0.6, true, alertSound);
    expect(JSON.parse(fetch.mock.calls.at(-1)![1].body)).toEqual({ at: 456, kind: "break-over", volume: 0.6, speak: true, alertSound });
    await testCompanion("break-over", 0.6, alertSound);
    expect(fetch.mock.calls.at(-1)![0]).toBe("/api/test");
    expect(JSON.parse(fetch.mock.calls.at(-1)![1].body)).toEqual({ kind: "break-over", volume: 0.6, alertSound });
  });
  it.each(ALERT_SOUNDS)("passes %s through the desktop bridge without HTTP", async (alertSound) => {
    const armAlarm = vi.fn().mockResolvedValue(true), fetch = vi.fn();
    vi.stubGlobal("window", { desktop: { armAlarm } });
    vi.stubGlobal("fetch", fetch);
    const { armCompanionWithSpeech } = await import("./companion");
    await armCompanionWithSpeech(123, "break-over", 0.5, true, alertSound);
    expect(armAlarm).toHaveBeenCalledWith({ at: 123, kind: "break-over", volume: 0.5, speak: true, alertSound });
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each([true, false])("sends the explicit speech preference (%s)", async (speak) => {
    vi.stubGlobal("location", { hostname: "localhost" });
    const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
    vi.stubGlobal("fetch", fetch);
    const { armCompanionWithSpeech } = await import("./companion");
    expect(await armCompanionWithSpeech(123, "focus-done", 0.8, speak)).toBe(true);
    expect(fetch).toHaveBeenLastCalledWith("/api/alarm", expect.objectContaining({
      method: "POST", body: JSON.stringify({ at: 123, kind: "focus-done", volume: 0.8, speak, alertSound: "signature" }),
    }));
  });
  it("keeps speech-only alarms silent and falls back when the request fails", async () => {
    vi.stubGlobal("location", { hostname: "localhost" });
    const fetch = vi.fn().mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true }) }).mockResolvedValue({ ok: false });
    vi.stubGlobal("fetch", fetch);
    const { armCompanionWithSpeech, companionKnownUp } = await import("./companion");
    expect(await armCompanionWithSpeech(123, "break-over", 0, true)).toBe(false);
    expect(companionKnownUp()).toBe(false);
    expect(fetch).toHaveBeenLastCalledWith("/api/alarm", expect.objectContaining({ body: JSON.stringify({ at: 123, kind: "break-over", volume: 0, speak: true, alertSound: "signature" }) }));
  });
  it("cancels speech without cancelling the next alarm", async () => {
    vi.stubGlobal("location", { hostname: "localhost" });
    const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
    vi.stubGlobal("fetch", fetch);
    const { companionAvailable, cancelCompanionSpeech } = await import("./companion");
    await companionAvailable();
    await cancelCompanionSpeech();
    expect(fetch).toHaveBeenLastCalledWith("/api/speech", expect.objectContaining({ method: "DELETE" }));
    expect(fetch.mock.calls.some(([url]) => url === "/api/alarm")).toBe(false);
  });
});

it("does not arm a stale boundary when Stop sound arrives during companion discovery", async () => {
  vi.stubGlobal("location", { hostname: "localhost" });
  let finish!: (value: unknown) => void;
  const fetch = vi.fn().mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })).mockResolvedValue({ ok: true });
  vi.stubGlobal("fetch", fetch);
  const { armCompanionWithSpeech, disarmCompanion } = await import("./companion");
  const arming = armCompanionWithSpeech(123, "focus-done", 0.5, true);
  const stopping = disarmCompanion();
  finish({ ok: true, json: async () => ({ ok: true }) });
  await Promise.all([arming, stopping]);
  expect(fetch.mock.calls.filter(([url, options]) => url === "/api/alarm" && options.method === "POST")).toHaveLength(0);
  expect(fetch).toHaveBeenLastCalledWith("/api/alarm", expect.objectContaining({ method: "DELETE" }));
});
it("finishes an in-flight companion arm before disarming, then accepts the next segment", async () => {
  vi.stubGlobal("location", { hostname: "localhost" });
  const calls: string[] = [];
  let finish!: (value: unknown) => void;
  vi.stubGlobal("fetch", vi.fn((url, options) => {
    if (url === "/api/health") return Promise.resolve({ ok: true, json: async () => ({ ok: true }) });
    calls.push(options.method);
    if (options.method === "POST" && calls.length === 1) return new Promise(resolve => { finish = resolve; });
    return Promise.resolve({ ok: true });
  }));
  const { companionAvailable, armCompanionWithSpeech, disarmCompanion } = await import("./companion");
  await companionAvailable();
  const first = armCompanionWithSpeech(123, "focus-done", 0.5, true);
  await vi.waitFor(() => expect(finish).toBeDefined());
  const stopping = disarmCompanion();
  expect(calls).toEqual(["POST"]);
  finish({ ok: true }); await first; await stopping;
  await armCompanionWithSpeech(456, "break-over", 0.5, true);
  expect(calls).toEqual(["POST", "DELETE", "POST"]);
});
