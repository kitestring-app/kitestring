import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IDBFactory } from "fake-indexeddb";
vi.mock("../audio/core", () => ({ cancelAllChimes: vi.fn(), playTimerTick: vi.fn(), cancelChime: vi.fn(), cancelEnd: vi.fn(), releaseChime: vi.fn(), scheduleChime: vi.fn(), scheduleEnd: vi.fn() }));
vi.mock("../audio/companion", () => ({ armCompanionWithSpeech: vi.fn().mockResolvedValue(false), cancelCompanionSpeech: vi.fn(), companionAvailable: vi.fn().mockResolvedValue(false), companionKnownUp: vi.fn(() => false), disarmCompanion: vi.fn() }));
let m: Awaited<ReturnType<typeof setup>>;
async function setup() {
  const [timer, engine, settings, tiny, store] = await Promise.all([
    import("./timer"), import("./timerEngine"), import("./settings"), import("./tinyStarts"), import("../lib/store")]);
  await Promise.all([timer.timer.ready, settings.calmFoundationReady, tiny.tinyStarts.ready]);
  return { ...timer, ...engine, ...settings, ...tiny, ...store };
}
beforeEach(async () => {
  vi.resetModules(); vi.stubGlobal("indexedDB", new IDBFactory()); vi.stubGlobal("BroadcastChannel", undefined);
  vi.stubGlobal("navigator", {});
  vi.stubGlobal("window", { addEventListener: vi.fn(), desktop: { armAlarm: vi.fn().mockResolvedValue(true), disarmAlarm: vi.fn(), release: vi.fn(), cancelSpeech: vi.fn() } });
  vi.stubGlobal("document", { addEventListener: vi.fn(), visibilityState: "visible" });
  m = await setup();
  vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout", "setInterval", "clearInterval"] }); vi.setSystemTime(Date.UTC(2026, 10, 8, 12));
  vi.spyOn(performance, "now").mockImplementation(() => Date.now() - Date.UTC(2026, 10, 8, 12));
  m.settingsUpdate("timer", { autoRun: "off", takeover: false, quickPicks: { enabled: true, focus: [15, 25, 50], breaks: [5, 10] } });
  m.timer.set({ ...m.INITIAL_TIMER, segId: "first" });
});
afterEach(async () => { vi.restoreAllMocks(); vi.clearAllTimers(); vi.useRealTimers(); await m?.flushReadyStores(); vi.unstubAllGlobals(); });
const pick = (kind: "focus" | "break", minutes: number) => m.startQuickPick(m.timer.get().segId, kind, minutes);
function finish() { const id = m.timer.get().segId; vi.setSystemTime(Date.now() + m.totalMs()!); m.timerActions.complete(id); return id; }

describe("quick-pick lengths", () => {
  it("are off by default and refuse to start until turned on", () => {
    expect(m.DEFAULT_SETTINGS.timer.quickPicks.enabled).toBe(false);
    m.settingsUpdate("timer", { quickPicks: { ...m.settings.get().timer.quickPicks, enabled: false } });
    expect(pick("focus", 25)).toBe(false);
    expect(m.timer.get().startedAt).toBeNull();
  });

  it("a focus pick runs one block at that length, leaves saved lengths alone and is not a tiny start", () => {
    const lengths = structuredClone(m.settings.get().timer.lengths);
    expect(pick("focus", 50)).toBe(true);
    expect(m.timer.get()).toMatchObject({ segment: "focus", frozen: true, frozenTotal: 50 * 60_000 });
    expect(m.timer.get().startedAt).not.toBeNull();
    expect(m.timer.get().tinyStart).toBeUndefined();
    expect(m.totalMs()).toBe(50 * 60_000);
    finish();
    expect(m.tinyStarts.get().finished).toEqual([]);
    expect(m.settings.get().timer.lengths).toEqual(lengths);
    m.answerRecovery(m.recoveryCommand(), "stop");
    m.timerActions.start();
    expect(m.totalMs()).toBe(lengths.pomodoro * 60_000);
  });

  it("a break pick from idle focus starts a break of that length without counting a focus round", () => {
    const round = m.timer.get().round;
    expect(pick("break", 10)).toBe(true);
    expect(m.timer.get()).toMatchObject({ segment: "short", round, frozenTotal: 10 * 60_000 });
    expect(m.timer.get().startedAt).not.toBeNull();
    expect(m.timer.get().segId).not.toBe("first");
  });

  it("an idle long break keeps its kind; a focus pick from an idle break moves to focus", () => {
    m.timer.set({ ...m.INITIAL_TIMER, segment: "long", segId: "long-idle", round: 3 });
    expect(pick("break", 5)).toBe(true);
    expect(m.timer.get()).toMatchObject({ segment: "long", segId: "long-idle", frozenTotal: 5 * 60_000 });
    m.timer.set({ ...m.INITIAL_TIMER, segment: "short", segId: "short-idle", round: 1 });
    expect(pick("focus", 15)).toBe(true);
    expect(m.timer.get()).toMatchObject({ segment: "focus", round: 1, frozenTotal: 15 * 60_000 });
  });

  it("refuses stale, running, paused or invalid picks", () => {
    expect(m.startQuickPick("someone-else", "focus", 25)).toBe(false);
    for (const minutes of [0, -5, 2.5, 601, Number.NaN, Number.POSITIVE_INFINITY]) expect(pick("focus", minutes)).toBe(false);
    expect(m.timer.get().startedAt).toBeNull();
    expect(pick("focus", 25)).toBe(true);
    const running = m.timer.get().segId;
    expect(pick("break", 5)).toBe(false);
    vi.setSystemTime(Date.now() + 60_000); m.timerActions.pause();
    expect(pick("focus", 15)).toBe(false);
    expect(m.timer.get().segId).toBe(running);
  });

  it("Hard mode locks the picked block like any other start", () => {
    m.settingsUpdate("timer", { hardMode: true });
    expect(pick("focus", 25)).toBe(true);
    expect(m.hardModeLocked()).toBe(true);
    expect(pick("focus", 15)).toBe(false);
    expect(m.timer.get().frozenTotal).toBe(25 * 60_000);
  });

  it("the shared request checks the same guards", async () => {
    const command = m.recoveryCommand();
    expect(await m.requestQuickPick(command, "focus", 25)).toBe(true);
    expect(await m.requestQuickPick(command, "focus", 15)).toBe(false);
    expect(m.totalMs()).toBe(25 * 60_000);
  });
});

describe("quick-pick settings", () => {
  it("keep whole minutes 1 to 600, drop repeats, sort and cap at five", () => {
    const clean = m.sanitizeSettings({ timer: { quickPicks: { enabled: true, focus: [90, 25, 25, 0, 601, 2.5, "45", 10, 50, 60, 120], breaks: [15, 5] } } }).timer.quickPicks;
    expect(clean).toEqual({ enabled: true, focus: [10, 25, 50, 60, 90], breaks: [5, 15] });
  });
  it("fall back for missing or broken values", () => {
    expect(m.sanitizeSettings({}).timer.quickPicks).toEqual(m.DEFAULT_SETTINGS.timer.quickPicks);
    expect(m.sanitizeSettings({ timer: { quickPicks: { enabled: "yes", focus: "25", breaks: null } } }).timer.quickPicks)
      .toEqual({ enabled: false, focus: m.DEFAULT_SETTINGS.timer.quickPicks.focus, breaks: m.DEFAULT_SETTINGS.timer.quickPicks.breaks });
    expect(m.sanitizeSettings({ timer: { quickPicks: { enabled: true, focus: [], breaks: [] } } }).timer.quickPicks).toEqual({ enabled: true, focus: [], breaks: [] });
  });
});
