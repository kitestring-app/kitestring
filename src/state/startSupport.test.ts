import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IDBFactory } from "fake-indexeddb";
vi.mock("../audio/core", () => ({ cancelAllChimes: vi.fn(), playTimerTick: vi.fn(), cancelChime: vi.fn(), cancelEnd: vi.fn(), releaseChime: vi.fn(), scheduleChime: vi.fn(), scheduleEnd: vi.fn() }));
vi.mock("../audio/companion", () => ({ armCompanionWithSpeech: vi.fn().mockResolvedValue(false), cancelCompanionSpeech: vi.fn(), companionAvailable: vi.fn().mockResolvedValue(false), companionKnownUp: vi.fn(() => false), disarmCompanion: vi.fn() }));
let m: Awaited<ReturnType<typeof setup>>;
async function setup() {
  const [timer, engine, settings, intent, tiny, review, parked, store, db, tasks, activity] = await Promise.all([
    import("./timer"), import("./timerEngine"), import("./settings"), import("./intent"), import("./tinyStarts"),
    import("./parkingReview"), import("./parked"), import("../lib/store"), import("../lib/db"), import("./tasks"), import("./returnActivity")]);
  await Promise.all([timer.timer.ready, settings.calmFoundationReady, intent.intent.ready, intent.rewardMoment.ready,
    tiny.tinyStarts.ready, review.parkingReview.ready, parked.parked.ready, tasks.tasks.ready, activity.returnActivity.ready]);
  return { ...timer, ...engine, ...settings, ...intent, ...tiny, ...review, ...parked, ...store, ...db, ...tasks, ...activity };
}
beforeEach(async () => {
  vi.resetModules(); vi.stubGlobal("indexedDB", new IDBFactory()); vi.stubGlobal("BroadcastChannel", undefined);
  vi.stubGlobal("navigator", {});
  vi.stubGlobal("window", { addEventListener: vi.fn(), desktop: { armAlarm: vi.fn().mockResolvedValue(true), disarmAlarm: vi.fn(), release: vi.fn(), cancelSpeech: vi.fn() } });
  vi.stubGlobal("document", { addEventListener: vi.fn(), visibilityState: "visible" });
  m = await setup();
  vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout", "setInterval", "clearInterval"] }); vi.setSystemTime(Date.UTC(2026, 9, 26, 12));
  m.settingsUpdate("timer", { autoRun: "off", takeover: false });
  m.timer.set({ ...m.INITIAL_TIMER, segId: "first" });
});
afterEach(async () => { vi.clearAllTimers(); vi.useRealTimers(); await m?.flushReadyStores(); vi.unstubAllGlobals(); });
const tiny = (minutes = 5) => m.startTinyBlock(m.timer.get().segId, minutes);
function finish() { const id = m.timer.get().segId; vi.setSystemTime(Date.now() + m.totalMs()!); m.timerActions.complete(id); return id; }

describe("tiny starts", () => {
  it("counts only finished tiny blocks, dedupes boundaries and leaves chosen lengths alone", () => {
    const lengths = structuredClone(m.settings.get().timer.lengths);
    expect(tiny()).toBe(true); const first = m.timer.get().segId;
    expect(m.totalMs()).toBe(5 * 60_000); expect(tiny(10)).toBe(false);
    vi.setSystemTime(Date.now() + 60_000); m.timerActions.pause();
    expect(m.tinyStarts.get().finished).toEqual([]);
    m.timerActions.start(); m.timerActions.skip();
    expect(m.tinyStarts.get().finished).toEqual([]);
    m.timerActions.stop(); expect(tiny(10)).toBe(true); const id = finish();
    m.timerActions.complete(id); expect(m.tinyStarts.get().finished).toEqual([id]);
    m.answerRecovery(m.recoveryCommand(), "stop");
    m.timerActions.start(); finish(); // ordinary block, including short configured lengths, does not count
    m.answerRecovery(m.recoveryCommand(), "stop");
    expect(m.tinyStarts.get().finished).toEqual([id]); expect(id).not.toBe(first);
    expect(tiny(3)).toBe(true); finish();
    expect(m.longerOfferAvailable()).toBe(true);
    expect(m.settings.get().timer.lengths).toEqual(lengths);
    m.settleLongerOffer("dismissed"); expect(m.longerOfferAvailable()).toBe(false);
    m.answerRecovery(m.recoveryCommand(), "stop"); expect(tiny()).toBe(true); finish();
    expect(m.longerOfferAvailable()).toBe(false); expect(m.tinyStarts.get().finished).toHaveLength(2);
  });
  it("persists the run marker, two finishes and dismissal, without counting opens or gaps", async () => {
    tiny(); await m.flushReadyStores();
    expect((await m.dbGet<any>("timer")).tinyStart).toBe(true);
    finish(); m.answerRecovery(m.recoveryCommand(), "stop"); tiny(); finish(); m.settleLongerOffer("dismissed");
    await m.flushReadyStores(); vi.resetModules();
    const next = await setup(); expect(next.tinyStarts.get()).toMatchObject({ offer: "dismissed", finished: expect.any(Array) });
    expect(next.tinyStarts.get().finished).toHaveLength(2); expect(next.longerOfferAvailable()).toBe(false);
    next.checkReturnActivity(); expect(next.tinyStarts.get().finished).toHaveLength(2);
  });
  it("reset cancels the tiny marker and rejects empty, invalid, stale or active starts", () => {
    for (const minutes of [0, NaN, Infinity, -2, 1441]) expect(tiny(minutes)).toBe(false);
    expect(m.startTinyBlock("stale", 5)).toBe(false);
    tiny(); m.timerActions.reset(); expect(m.timer.get().tinyStart).toBeUndefined();
    m.timerActions.start(); finish(); expect(m.tinyStarts.get().finished).toEqual([]);
  });
  it.each(["5217", "stopwatch", "countdown", "pomodoro"] as const)("%s and task ETA still use a one-off override", mode => {
    m.settingsUpdate("timer", { mode, taskEta: true }); m.addTask({ title: "Long task", etaMin: 90 });
    expect(tiny(10)).toBe(true); expect(m.totalMs()).toBe(600_000);
    m.timerActions.pause(); m.timerActions.start(); expect(m.totalMs()).toBe(600_000);
  });
  it("a restored missed tiny end counts once and never rewards the action", () => {
    m.updateIntent({ action: "Open draft", reward: "Tea" }); tiny(); const id = m.timer.get().segId;
    vi.setSystemTime(Date.now() + 86400_000); m.timerActions.complete(id, true); m.timerActions.complete(id, true);
    expect(m.tinyStarts.get().finished).toEqual([id]); expect(m.rewardMoment.get()).toBeNull();
  });
});

describe("parking review and C4", () => {
  it("defaults to never; the chosen block boundary queues behind recovery and never interrupts focus", () => {
    m.parkThought("Read later", { segment: "focus" }); tiny(); finish();
    expect(m.parkingReview.get().review).toBeNull(); m.answerRecovery(m.recoveryCommand(), "stop");
    m.chooseReviewBoundary("block"); tiny(); finish();
    expect(m.recoveryOffer()).toBe("missed-end"); m.answerRecovery(m.recoveryCommand(), "continue");
    expect(m.recoveryOffer()).toBeNull(); m.timerActions.pause(); expect(m.recoveryOffer()).toBe("re-entry");
    m.answerRecovery(m.recoveryCommand(), "dismiss"); expect(m.recoveryOffer()).toBe("parking-review");
    m.returnActivity.set({ ...m.returnActivity.get(), pendingGap: "gap:test" }); expect(m.recoveryOffer()).toBe("gap-return");
    m.answerRecovery(m.recoveryCommand(), "keep"); expect(m.recoveryOffer()).toBe("parking-review");
  });
  it("end-session waits for Stop, not each block, and cycle endings also qualify", () => {
    m.parkThought("Later", { segment: "focus" }); m.chooseReviewBoundary("session"); tiny(); finish();
    expect(m.parkingReview.get().review).toBeNull(); m.answerRecovery(m.recoveryCommand(), "stop");
    expect(m.recoveryOffer()).toBe("parking-review");
  });
  it("Keep stays open, task conversion is once, Drop removes with undo, and new captures wait", () => {
    const a = m.parkThought("Keep me", { segment: "focus" })!;
    const b = m.parkThought("Task me", { segment: "focus" })!;
    const c = m.parkThought("Drop me", { segment: "focus" })!;
    m.openParkingReview(); const id = m.parkingReview.get().review!.id;
    const later = m.parkThought("Next review", { segment: "short" })!;
    expect(m.answerParkingReview(id, a, "keep").ok).toBe(true);
    expect(m.parked.get().find(p => p.id === a)?.status).toBe("open");
    expect(m.answerParkingReview(id, a, "task").ok).toBe(false);
    expect(m.answerParkingReview(id, b, "task").ok).toBe(true);
    expect(m.answerParkingReview(id, b, "task").ok).toBe(false); expect(m.tasks.get()).toHaveLength(1);
    const dropped = m.answerParkingReview(id, c, "drop"); expect(dropped.ok).toBe(true);
    expect(m.parkingReview.get().review).toBeNull(); expect(m.parked.get().some(p => p.id === c)).toBe(false);
    dropped.undo!(); dropped.undo!(); expect(m.parked.get().filter(p => p.id === c)).toHaveLength(1);
    expect(m.parked.get().some(p => p.id === later)).toBe(true);
  });
  it("resumes a durable device cursor and skips remotely deleted/converted items", async () => {
    const a = m.parkThought("First", { segment: "focus" })!;
    const b = m.parkThought("Second", { segment: "focus" })!;
    m.openParkingReview(); const id = m.parkingReview.get().review!.id;
    m.answerParkingReview(id, a, "keep"); m.deferParkingReview(id); await m.flushReadyStores();
    vi.resetModules(); const next = await setup();
    expect(next.parkingReview.get().review).toMatchObject({ id, cursor: 1 }); expect(next.parkingReview.get().deferred).toBe(true);
    next.openParkingReview(); expect(next.currentReviewItem()?.id).toBe(b);
    await next.applyRemote("parked", next.parked.get().filter(p => p.id !== b));
    expect(next.currentReviewItem()).toBeUndefined(); expect(next.answerParkingReview(id, b, "task").ok).toBe(false);
    expect(next.tasks.get()).toHaveLength(0);
  });
});

describe("cue and chosen reward", () => {
  it("captures the cue for re-entry even if the synced pin later changes", () => {
    m.updateIntent({ action: "Draft", cue: "After lunch, open the draft" }); tiny(); m.timerActions.pause();
    m.updateIntent({ action: "Read", cue: "After tea, open the book" });
    expect(m.timer.get().context?.cue).toBe("After lunch, open the draft");
  });
  it("finishes once, preserves tasks and breaks, and dismissal survives reload", async () => {
    m.addTask({ title: "A task" }); m.updateIntent({ action: "Open draft", cue: "After lunch", reward: "Tea outside" });
    const pin = m.intent.get(); expect(m.finishIntent(pin)).toBe(true); expect(m.finishIntent(pin)).toBe(false);
    expect(m.rewardMoment.get()).toMatchObject({ action: "Open draft", reward: "Tea outside" });
    expect(m.tasks.get()[0].done).toBe(false); m.timerActions.goTo("short"); m.timerActions.start();
    expect(m.timer.get().startedAt).not.toBeNull(); expect(m.rewardMoment.get()?.reward).toBe("Tea outside");
    m.dismissReward(m.rewardMoment.get()!.id); await m.flushReadyStores(); vi.resetModules();
    const next = await setup(); expect(next.rewardMoment.get()).toBeNull(); expect(next.intent.get().action).toBe("");
  });
  it("retains a newer synced action and rejects a stale cue/reward editor", () => {
    m.updateIntent({ action: "First", cue: "First cue", reward: "Tea" }); const first = m.intent.get();
    m.updateIntent({ action: "Second", cue: "Second cue", reward: "Walk" });
    expect(m.finishIntent(first)).toBe(false);
    expect(() => m.updateIntent({ cue: "Old draft cue" }, first)).toThrow("changed elsewhere");
    expect(m.intent.get()).toMatchObject({ action: "Second", cue: "Second cue", reward: "Walk" });
  });
});

it("C4: a stale parking card cannot convert a thought after Start or an intent replacement", () => {
  const id = m.parkThought("Later", { segment: "focus" })!; m.openParkingReview();
  const beforeEdit = m.recoveryCommand(); m.updateIntent({ action: "A newer action" });
  expect(m.answerParkingRecovery(beforeEdit, id, "task").ok).toBe(false);
  const beforeStart = m.recoveryCommand(); m.timerActions.start();
  expect(m.answerParkingRecovery(beforeStart, id, "task").ok).toBe(false);
  expect(m.tasks.get()).toHaveLength(0); expect(m.parked.get()[0].status).toBe("open");
});

it("end-session review also follows an explicitly finished open stopwatch", () => {
  m.settingsUpdate("timer", { mode: "stopwatch" }); m.chooseReviewBoundary("session");
  m.parkThought("Read later", { segment: "focus" }); m.timerActions.start();
  vi.setSystemTime(Date.now() + 60_000); m.timerActions.skip();
  expect(m.recoveryOffer()).toBe("parking-review"); expect(m.tinyStarts.get().finished).toEqual([]);
});


it("round4 two tiny blocks retain the same action's recorded total", () => {
  m.updateIntent({ action: "Open the draft" });
  expect(tiny()).toBe(true); finish();
  m.answerRecovery(m.recoveryCommand(), "stop");
  expect(m.timer.get().context?.spentMs).toBe(300_000);
  expect(tiny()).toBe(true); finish();
  expect(m.timer.get().context?.spentMs).toBe(600_000);
});
it.each([false, true])("round4 gap short block carries banked time and current focus time (running=%s)", running => {
  m.updateIntent({ action: "Open the draft" });
  tiny(); finish(); m.answerRecovery(m.recoveryCommand(), "stop");
  if (running) { m.timerActions.start(); vi.setSystemTime(Date.now() + 60_000); }
  m.returnActivity.set({ ...m.returnActivity.get(), pendingGap: "gap:short" });
  if (running) m.timerActions.pause();
  if (m.timer.get().reentry) m.answerRecovery(m.recoveryCommand(), "dismiss");
  expect(m.answerRecovery(m.recoveryCommand(), "short-block")).toBe(true);
  expect(m.timer.get().context?.spentMs).toBe(running ? 360_000 : 300_000);
  finish(); expect(m.timer.get().context?.spentMs).toBe(running ? 660_000 : 600_000);
});
it.each(["tiny", "gap"] as const)("round4 %s start resets context time for a different intent document", kind => {
  m.updateIntent({ action: "First action" }); tiny(); finish(); m.answerRecovery(m.recoveryCommand(), "stop");
  m.updateIntent({ action: "Different action" });
  if (kind === "tiny") expect(tiny()).toBe(true);
  else {
    m.returnActivity.set({ ...m.returnActivity.get(), pendingGap: "gap:new-action" });
    expect(m.answerRecovery(m.recoveryCommand(), "short-block")).toBe(true);
  }
  expect(m.timer.get().context).toMatchObject({ action: "Different action", spentMs: 0 });
});


it.each(["defer", "close"] as const)("round4 guarded review %s preserves current cursor and refuses a newer review or session", async choice => {
  const first = m.parkThought("First", { segment: "focus" })!;
  m.parkThought("Second", { segment: "focus" }); m.openParkingReview();
  const command = m.recoveryCommand();
  m.answerParkingReview(command.offerId!, first, "keep");
  expect((await m.requestParkingRecovery(command, "", choice)).ok).toBe(true);
  expect(m.parkingReview.get()).toMatchObject(choice === "defer" ? { deferred: true, review: { cursor: 1 } } : { review: null });
  m.parkingReview.set({ ...m.parkingReview.get(), review: null }); m.openParkingReview();
  const current = m.parkingReview.get();
  expect((await m.requestParkingRecovery(command, "", choice)).ok).toBe(false);
  expect(m.parkingReview.get()).toBe(current);
  const beforeStart = m.recoveryCommand(); m.timerActions.start();
  expect((await m.requestParkingRecovery(beforeStart, "", choice)).ok).toBe(false);
  expect(m.parkingReview.get()).toBe(current);
});

it.each([false, true])("round5 a gap block never counts as a tiny finish (missed=%s)", missed => {
  expect(tiny()).toBe(true); const first = finish();
  m.answerRecovery(m.recoveryCommand(), "stop");
  m.returnActivity.set({ ...m.returnActivity.get(), pendingGap: "gap:short" });
  expect(m.answerRecovery(m.recoveryCommand(), "short-block")).toBe(true);
  expect(m.totalMs()).toBe(300_000);
  const id = m.timer.get().segId;
  vi.setSystemTime(Date.now() + 300_000); m.timerActions.complete(id, missed);
  expect(m.tinyStarts.get().finished).toEqual([first]);
  expect(m.longerOfferAvailable()).toBe(false);
});
