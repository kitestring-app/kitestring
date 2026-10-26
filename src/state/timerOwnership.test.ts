import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { IDBFactory } from "fake-indexeddb";
vi.mock("../audio/core", () => ({ cancelAllChimes: vi.fn(), playTimerTick: vi.fn(), cancelChime: vi.fn(), cancelEnd: vi.fn(), releaseChime: vi.fn(), scheduleChime: vi.fn(), scheduleEnd: vi.fn() }));
vi.mock("../audio/companion", () => ({ armCompanionWithSpeech: vi.fn().mockResolvedValue(false), companionAvailable: vi.fn().mockResolvedValue(false), companionKnownUp: vi.fn(() => false), disarmCompanion: vi.fn() }));
class Channel {
  static all: Channel[] = [];
  listeners: ((event: { data: unknown }) => void)[] = [];
  postMessage = vi.fn();
  constructor() { Channel.all.push(this); }
  addEventListener(_type: string, listener: (event: { data: unknown }) => void) { this.listeners.push(listener); }
  receive(data: unknown) { this.listeners.forEach(fn => fn({ data })); }
}
let grant: () => Promise<void>;
let m: Awaited<ReturnType<typeof setup>>;
async function setup() {
  const [t, a, r, p, s, e, f] = await Promise.all([import("./timer"), import("./returnActivity"), import("./parkingReview"), import("./parked"), import("./settings"), import("./timerEngine"), import("../lib/store")]);
  await Promise.all([t.timer.ready, a.returnActivity.ready, r.parkingReview.ready, p.parked.ready, s.calmFoundationReady]);
  return { ...t, ...a, ...r, ...p, ...s, ...e, ...f };
}
beforeEach(async () => {
  vi.resetModules(); Channel.all = [];
  vi.stubGlobal("indexedDB", new IDBFactory()); vi.stubGlobal("BroadcastChannel", Channel);
  vi.stubGlobal("navigator", { locks: { request: vi.fn((_name, callback) => { grant = callback; return new Promise<void>(() => {}); }) } });
  vi.stubGlobal("window", { addEventListener: vi.fn(), desktop: { armAlarm: vi.fn().mockResolvedValue(true), disarmAlarm: vi.fn(), release: vi.fn(), cancelSpeech: vi.fn() } });
  vi.stubGlobal("document", { addEventListener: vi.fn(), visibilityState: "visible" });
  m = await setup();
  vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout", "setInterval", "clearInterval"] }); vi.setSystemTime(1_800_000_000_000);
  m.settingsUpdate("timer", { ...m.STRONG_PATCH, autoRun: "always" });
  m.startTicker(); await new Promise<void>(resolve => queueMicrotask(resolve));
});
afterEach(async () => { vi.restoreAllMocks(); vi.clearAllTimers(); vi.useRealTimers(); await m.flushReadyStores(); vi.unstubAllGlobals(); });
const commandChannel = () => Channel.all[1];
it.each(["running", "paused", "paused-hard", "frozen-zero", "stats-only"])("follower restore preserves the owner's %s timer and latest credit", async mode => {
  await m.acquireTimerOwnership();
  m.settingsUpdate("timer", { hardMode: false });
  const { stats } = await import("./stats");
  const { dbGet } = await import("../lib/db");
  const owner = { ...m.INITIAL_TIMER, segId: "owner-block", startedAt: mode === "running" ? Date.now() : null,
    elapsedBefore: mode === "frozen-zero" ? 0 : 1000, frozen: true, frozenTotal: 60_000, hardLocked: mode === "paused-hard" };
  m.timer.set(owner);
  const chunk = { id: "owner-credit", segId: owner.segId, kind: "focus" as const, segment: "focus" as const, start: Date.now(), ms: 1000, completed: false };
  stats.set({ chunks: [chunk], tasksDone: [] });
  await m.flushReadyStores();
  const archive = { ...chunk, id: "archive", segId: "archive-block" };
  const entries: [string, unknown][] = [["stats", { chunks: [archive, { ...chunk, ms: 1 }], tasksDone: [] }]];
  if (mode !== "stats-only") entries.push(["timer", { ...m.INITIAL_TIMER, segId: "imported" }]);
  commandChannel().receive({ type: "timer-request", id: "follower-restore", request: { kind: "owned", action: "restore-stores", expected: m.recoveryCommand(), payload: entries } });
  await m.flushReadyStores();
  expect(m.timer.get()).toEqual(owner);
  expect(stats.get().chunks).toEqual([archive, chunk]);
  expect(await dbGet("timer")).toEqual(owner);
  expect(await dbGet("stats")).toEqual(stats.get());
  await vi.waitFor(() => expect(commandChannel().postMessage).toHaveBeenCalledWith({ type: "timer-result", id: "follower-restore", result: { ok: true, keptTimer: true } }));
});
it("round5 follower gap checks cannot overwrite an acknowledgement; purposeful edits forward only a timestamp", async () => {
  const stale = { version: 1 as const, lastPurposefulAt: Date.now() - 3 * 86_400_000, pendingGap: "gap:old", acknowledgedGap: null, uncertain: false };
  Channel.all[0].receive({ type: "write", entries: [["returnActivity", stale]] });
  m.checkReturnActivity();
  expect(m.returnActivity.get()).toEqual(stale);
  m.purposefulAction();
  await m.flushReadyStores(); await Promise.resolve();
  expect(m.returnActivity.get()).toEqual(stale);
  const request = commandChannel().postMessage.mock.calls.find(([message]) => message.type === "timer-request")![0];
  expect(request.request).toEqual({ kind: "activity", at: Date.now() });
  const acknowledged = { ...stale, pendingGap: null, acknowledgedGap: "gap:old", lastPurposefulAt: Date.now() + 1 };
  Channel.all[0].receive({ type: "write", entries: [["returnActivity", acknowledged]] });
  vi.setSystemTime(Date.now() + 10); // The owner answered after the follower stamped its edit.
  await m.acquireTimerOwnership();
  commandChannel().receive(request);
  await m.flushReadyStores();
  expect(m.returnActivity.get()).toEqual(acknowledged);
  commandChannel().receive({ type: "timer-result", id: request.id, result: { ok: true } });
});
it("round5 promotion settles a received expired timer quietly, even with a healthy follower heartbeat", async () => {
  const mono = performance.now(), now = Date.now();
  vi.spyOn(performance, "now").mockImplementation(() => mono + Date.now() - now);
  Channel.all[0].receive({ type: "write", entries: [["timer", { ...m.INITIAL_TIMER, segId: "received-run", startedAt: now, frozen: true, frozenTotal: 60_000 }]] });
  vi.advanceTimersByTime(180_000);
  expect(m.storeSource("timer")).toBe("received");
  expect(m.timer.get().startedAt).toBe(now);
  vi.mocked(window.desktop!.armAlarm!).mockClear();
  await m.acquireTimerOwnership();
  expect(m.timer.get()).toMatchObject({ startedAt: null, boundary: { id: "received-run", missed: true } });
  expect(window.desktop!.armAlarm).not.toHaveBeenCalled();
  expect((await import("../ui/timer/TransitionStore")).transitionStore.get()).toBeNull();
});

it.each(["open", "session", "never"] as const)("round5 follower review control %s preserves the owner's cursor and rejects a replaced review", async choice => {
  m.parked.set([{ id: "one", text: "First", at: Date.now(), segment: "focus", status: "open" }, { id: "two", text: "Next", at: Date.now(), segment: "focus", status: "open" }]);
  const stale = { ...m.parkingReview.get(), deferred: true, review: { id: "review", itemIds: ["one", "two"], cursor: 0 } };
  Channel.all[0].receive({ type: "write", entries: [["parkingReview", stale]] });
  if (choice === "open") m.openParkingReview(); else m.chooseReviewBoundary(choice);
  await m.flushReadyStores(); await Promise.resolve();
  expect(m.parkingReview.get()).toEqual(stale);
  const request = commandChannel().postMessage.mock.calls.find(([message]) => message.type === "timer-request")![0];
  const current = { ...stale, review: { ...stale.review, cursor: 1 } };
  Channel.all[0].receive({ type: "write", entries: [["parkingReview", current]] });
  await m.acquireTimerOwnership();
  commandChannel().receive(request); await m.flushReadyStores();
  expect(m.parkingReview.get()).toMatchObject({ review: current.review, deferred: choice !== "open", boundary: choice === "open" ? stale.boundary : choice });
  const newer = { ...current, review: { ...current.review, id: "new-review" } };
  m.parkingReview.set(newer);
  commandChannel().receive(request); await m.flushReadyStores();
  expect(m.parkingReview.get()).toEqual(newer);
  commandChannel().receive({ type: "timer-result", id: request.id, result: { ok: true } });
});

it("Grok 1: loading a follower from disk never stamps or saves its stale clock", async () => {
  const db = await import("../lib/db");
  const saved = { ...m.INITIAL_TIMER, segId: "disk-run", startedAt: Date.now(), frozen: true, frozenTotal: 300_000, creditedUpTo: 750 };
  await db.dbSet("timer", saved);
  vi.resetModules(); Channel.all = [];
  m = await setup(); m.startTicker(); await m.timerHydrationReady;
  const write = vi.spyOn(await import("../lib/db"), "dbSetMany");
  await m.flushReadyStores();
  expect(m.timer.get().reentry).toBeUndefined();
  expect(write).not.toHaveBeenCalled();
  expect(await db.dbGet("timer")).toEqual(saved);
  await m.acquireTimerOwnership();
  expect(m.timer.get().reentry).toEqual(expect.any(String));
});
it.each(["received", "disk"])("Grok 2: an expired %s run cannot auto-run when the lock arrives before hydration", async source => {
  vi.resetModules(); Channel.all = [];
  const db = await import("../lib/db");
  const expired = { ...m.INITIAL_TIMER, segId: "expired-before-load", startedAt: Date.now() - 70_000, frozen: true, frozenTotal: 60_000 };
  if (source === "disk") await db.dbSet("timer", expired);
  let release!: () => void;
  const blocked = new Promise<void>(resolve => { release = resolve; });
  const read = db.dbGet;
  vi.spyOn(db, "dbGet").mockImplementation(async key => { const value = await read(key); await blocked; return value; });
  const clock = await import("./timer");
  const settings = await import("./settings");
  clock.startTicker();
  if (source === "received") Channel.all[0].receive({ type: "write", entries: [["timer", expired]] });
  void grant();
  vi.mocked(window.desktop!.armAlarm!).mockClear();
  vi.advanceTimersByTime(1000);
  expect(clock.timer.get().boundary).toBeUndefined();
  expect(window.desktop!.armAlarm).not.toHaveBeenCalled();
  release(); await clock.timerHydrationReady;
  settings.settingsUpdate("timer", { ...settings.STRONG_PATCH, autoRun: "always" });
  await vi.waitFor(() => expect(clock.timer.get()).toMatchObject({ startedAt: null, boundary: { id: expired.segId, missed: true } }));
  expect(window.desktop!.armAlarm).not.toHaveBeenCalled();
  expect((await import("./stats")).stats.get().chunks.reduce((sum, chunk) => sum + chunk.ms, 0)).toBe(60_000);
  m = { ...m, ...clock, ...(await import("../lib/store")) };
});
it.each(["accepted", "dismissed"] as const)("Grok 3: a follower's %s offer is applied only by the owner and refuses a stale run", async choice => {
  const tiny = await import("./tinyStarts");
  const progression = { version: 1, finished: ["a", "b"], offer: "available" };
  Channel.all[0].receive({ type: "write", entries: [["tinyStarts", progression]] });
  const expected = m.recoveryCommand();
  const result = m.requestLongerOffer(expected, choice, [...progression.finished]);
  await m.flushReadyStores(); await Promise.resolve();
  expect(tiny.tinyStarts.get().offer).toBe("available");
  expect(m.timer.get().startedAt).toBeNull();
  const request = commandChannel().postMessage.mock.calls.find(([message]) => message.type === "timer-request")![0];
  await m.acquireTimerOwnership();
  commandChannel().receive(request);
  await vi.waitFor(() => expect(tiny.tinyStarts.get().offer).toBe(choice));
  expect(m.timer.get().startedAt === null).toBe(choice === "dismissed");
  commandChannel().receive({ type: "timer-result", id: request.id, result: { ok: true } }); await result;
  m.timerActions.stop();
  tiny.tinyStarts.set({ version: 1, finished: ["a", "b"], offer: "available" });
  const current = m.timer.get();
  expect(await m.requestLongerOffer(expected, "accepted", progression.finished)).toBe(false);
  expect(m.timer.get()).toBe(current);
  expect(tiny.tinyStarts.get().offer).toBe("available");
});
