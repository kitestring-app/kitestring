import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { IDBFactory } from "fake-indexeddb";

vi.mock("../audio/core", () => ({ cancelAllChimes: vi.fn(), playTimerTick: vi.fn(), previewChime: vi.fn(), cancelChime: vi.fn(), cancelEnd: vi.fn(), releaseChime: vi.fn(), scheduleChime: vi.fn(), scheduleEnd: vi.fn() }));
vi.mock("../audio/companion", () => ({ armCompanionWithSpeech: vi.fn().mockResolvedValue(false), cancelCompanionSpeech: vi.fn(), companionAvailable: vi.fn().mockResolvedValue(false), companionKnownUp: vi.fn(() => false), disarmCompanion: vi.fn() }));

type Message = { type: string; entries?: [string, unknown][] };
// Independent real registries and IDB connections, with transport under the
// test's control. Snapshots can lag or disappear; commands still receive replies.
class Channel {
  static importing = "";
  static all: Channel[] = [];
  static messages: { sender: Channel; data: Message }[] = [];
  tab = Channel.importing;
  listeners: ((event: { data: unknown }) => void)[] = [];
  constructor() { Channel.all.push(this); }
  addEventListener(_type: string, listener: (event: { data: unknown }) => void) { this.listeners.push(listener); }
  postMessage(data: Message) { Channel.messages.push({ sender: this, data: structuredClone(data) }); }
  static deliver(writes: "deliver" | "delay" | "drop") {
    for (const message of Channel.messages.splice(0)) {
      if (message.data.type === "write" && writes === "delay") { Channel.messages.push(message); continue; }
      if (message.data.type === "write" && writes === "drop") continue;
      for (const channel of Channel.all) {
        if (channel !== message.sender) channel.listeners.forEach(fn => fn({ data: structuredClone(message.data) }));
      }
    }
  }
  static close(tab: string) { Channel.all = Channel.all.filter(channel => channel.tab !== tab); }
}

const pendingLocks = new Map<string, () => Promise<unknown>>();
const writes: { tab: string; owner: boolean; keys: string[] }[] = [];
let generation = 0;
async function loadTab(slot: number) {
  vi.resetModules();
  const label = `${slot}:${generation++}`;
  Channel.importing = label;
  const db = await import("../lib/db");
  const ownership = { active: false };
  const persist = db.dbSetMany;
  vi.spyOn(db, "dbSetMany").mockImplementation((entries, deletes) => {
    writes.push({ tab: label, owner: ownership.active, keys: entries.map(([key]) => key) });
    return persist(entries, deletes);
  });
  const [clock, store, tasks, stats, settings, tiny, parking, parked, activity, transition] = await Promise.all([
    import("./timer"), import("../lib/store"), import("./tasks"), import("./stats"), import("./settings"),
    import("./tinyStarts"), import("./parkingReview"), import("./parked"), import("./returnActivity"), import("../ui/timer/TransitionStore"),
  ]);
  await clock.timerHydrationReady;
  clock.startTicker();
  return { label, ownership, db, clock, store, tasks, stats, settings, tiny, parking, parked, activity, transition };
}
type Tab = Awaited<ReturnType<typeof loadTab>>;

function random(seed: number) {
  let state = seed >>> 0;
  return () => { state += 0x6d2b79f5; let x = Math.imul(state ^ state >>> 15, 1 | state); x ^= x + Math.imul(x ^ x >>> 7, 61 | x); return ((x ^ x >>> 14) >>> 0) / 4294967296; };
}

beforeEach(() => {
  writes.length = 0; generation = 0; pendingLocks.clear(); Channel.all = []; Channel.messages = [];
  vi.stubGlobal("indexedDB", new IDBFactory());
  vi.stubGlobal("BroadcastChannel", Channel);
  vi.stubGlobal("navigator", { locks: { request: vi.fn((_name: string, callback: () => Promise<unknown>) => {
    pendingLocks.set(Channel.importing, callback);
    return new Promise(() => {});
  }) } });
  vi.stubGlobal("window", { addEventListener: vi.fn(), desktop: {
    armAlarm: vi.fn().mockResolvedValue(true), disarmAlarm: vi.fn(), release: vi.fn(), cancelSpeech: vi.fn(), onLifecycle: vi.fn(),
  } });
  vi.stubGlobal("document", { addEventListener: vi.fn(), visibilityState: "visible" });
  // IDB keeps its real asynchronous scheduling. Clock and browser debounces are
  // explicit, so a simulated sleeping tab cannot accidentally run a heartbeat.
  vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
  vi.setSystemTime(Date.UTC(2026, 9, 20, 12));
  vi.spyOn(performance, "now").mockImplementation(() => Date.now() - Date.UTC(2026, 9, 20, 12));
  // Refused writes are expected when stale snapshots notify follower subscribers.
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it.each([0x60c10c, 0xc0ffee])("seeded real two-tab owner history, seed %i", async seed => {
  const rng = random(seed), ids = random(seed ^ 0x1978);
  vi.spyOn(Math, "random").mockImplementation(ids);
  const tabs = [await loadTab(0), await loadTab(1)];
  let owner = 0;
  let transport: "deliver" | "delay" | "drop" = "deliver";
  let step = -1;
  const trace: string[] = [];
  const ledger = new Map<string, number>();
  let expectedAway = 0;
  const elapsedSeen = new Map<string, number>();
  const coverage = new Set<string>();
  const lead = () => tabs[owner]!;
  const elapsed = (tab: Tab) => {
    const s = tab.clock.timer.get();
    return Math.min(s.segment === "focus" ? tab.clock.totalMs(s) ?? Infinity : Infinity, s.elapsedBefore + (s.startedAt === null ? 0 : Math.max(0, Date.now() - s.startedAt)));
  };
  async function flush() { for (const tab of tabs) await tab.store.flushReadyStores(); }
  async function drain() {
    // Command -> owner commit -> state -> reply is asynchronous across IDB.
    for (let round = 0; round < 4; round++) { await flush(); Channel.deliver(transport); await Promise.resolve(); }
  }
  async function invoke(work: () => unknown) {
    let settled = false, error: unknown;
    void Promise.resolve(work()).then(() => { settled = true; }, caught => { error = caught; settled = true; });
    for (let round = 0; round < 12 && (!settled || round < 3); round++) await drain();
    if (error) throw error;
    expect(settled, "a transported command must receive its owner's reply").toBe(true);
  }
  function advance(ms: number) {
    const tab = lead(), s = tab.clock.timer.get();
    if (s.startedAt !== null) {
      // Independent wall-time ledger: integrate time actually running, capped at
      // the frozen deadline. No timer engine or stats function calculates this.
      const remaining = s.segment === "focus" ? Math.max(0, (tab.clock.totalMs(s) ?? Infinity) - elapsed(tab)) : Infinity;
      ledger.set(s.segId, (ledger.get(s.segId) ?? 0) + Math.min(ms, remaining));
    }
    vi.setSystemTime(Date.now() + ms);
  }
  async function promote(index: number) {
    // The deferred browser lock invokes this same lifecycle method. Await it
    // directly, rather than awaiting the callback's lifetime-long lock promise.
    tabs[index]!.ownership.active = true;
    await tabs[index]!.clock.acquireTimerOwnership();
    owner = index;
  }
  async function handoff(reload: boolean, expired: boolean) {
    const previous = lead();
    if (expired) {
      await invoke(() => previous.clock.timerActions.start());
      if (previous.clock.timer.get().startedAt !== null) advance((previous.clock.totalMs() ?? 60_000) + 1000);
    }
    const s = previous.clock.timer.get(), total = previous.clock.totalMs(s);
    const shouldSettle = s.startedAt !== null && total !== null && elapsed(previous) >= total;
    // This renderer was alive through this handoff. Bank that fact before destroying it.
    await previous.clock.prepareTimerDeparture();
    await previous.clock.releaseTimerOwnership();
    previous.ownership.active = false;
    if (reload) {
      Channel.close(previous.label);
      tabs[owner] = await loadTab(owner);
    }
    const target = reload ? owner : 1 - owner;
    const alarmCalls = vi.mocked(window.desktop!.armAlarm!).mock.calls.length;
    await promote(target);
    if (shouldSettle) {
      expect(lead().clock.timer.get()).toMatchObject({ startedAt: null, boundary: { id: s.segId, missed: true } });
      expect(vi.mocked(window.desktop!.armAlarm!).mock.calls).toHaveLength(alarmCalls);
      expect(lead().transition.transitionStore.get()).toBeNull();
    }
  }
  function invariant() {
    const tab = lead(), current = tab.clock.timer.get(), chunks = tab.stats.stats.get().chunks;
    const accounted = new Map<string, number>();
    const completed = new Set<string>();
    const intervals = new Map<string, { start: number; end: number }[]>();
    expect(chunks.filter(c => c.away).reduce((sum, c) => sum + c.ms, 0)).toBe(expectedAway);
    for (const chunk of chunks.filter(c => !c.away)) {
      expect(chunk.ms).toBeGreaterThanOrEqual(0);
      expect(chunk.segId).toBeTruthy();
      const id = chunk.segId!;
      accounted.set(id, (accounted.get(id) ?? 0) + chunk.ms);
      const previous = intervals.get(id) ?? [];
      if (chunk.ms > 0) previous.push({ start: chunk.start, end: chunk.start + chunk.ms });
      intervals.set(id, previous);
      if (chunk.completed) { expect(completed.has(id), `duplicate completion ${id}`).toBe(false); completed.add(id); }
    }
    const unbanked = Math.max(0, elapsed(tab) - current.creditedUpTo);
    accounted.set(current.segId, (accounted.get(current.segId) ?? 0) + unbanked);
    const entries = (map: Map<string, number>) => [...map].filter(([, ms]) => ms > 0).sort(([a], [b]) => a.localeCompare(b));
    for (const [id, parts] of intervals) {
      parts.sort((a, b) => a.start - b.start);
      for (let index = 1; index < parts.length; index++) expect(parts[index]!.start, `overlapping credit intervals in ${id}`).toBeGreaterThanOrEqual(parts[index - 1]!.end);
    }
    expect(entries(accounted), `every running interval is credited exactly once: actual=${JSON.stringify(entries(accounted))} expected=${JSON.stringify(entries(ledger))}`).toEqual(entries(ledger));
    const now = elapsed(tab), last = elapsedSeen.get(current.segId) ?? 0;
    expect(now, `elapsed rolled back in ${current.segId}`).toBeGreaterThanOrEqual(last);
    elapsedSeen.set(current.segId, now);
    const offer = tab.clock.recoveryOffer();
    const expected = current.boundary ? "missed-end" : current.reentry ? "re-entry" : current.startedAt !== null && current.segment === "focus" ? null :
      tab.activity.returnActivity.get().pendingGap ? "gap-return" : tab.parking.parkingReview.get().review && !tab.parking.parkingReview.get().deferred ? "parking-review" : null;
    expect(offer).toBe(expected);
    for (const renderer of tabs) {
      expect(Number(!!renderer.clock.recoveryOffer()) + Number(!!renderer.transition.transitionStore.get()), `only one recovery surface is visible in ${renderer.label}`).toBeLessThanOrEqual(1);
    }
    const clockKeys = new Set<string>(tab.store.CLOCK_OWNED_KEYS);
    expect(writes.filter(write => !write.owner && write.keys.some(key => clockKeys.has(key))), "a follower persisted a clock-owned key").toEqual([]);
  }
  async function tinyFinish() {
    await invoke(() => lead().clock.timerActions.stop());
    await invoke(() => lead().clock.requestTinyBlock(lead().clock.recoveryCommand(), 1));
    advance(60_000);
    lead().clock.timerActions.complete(lead().clock.timer.get().segId, true);
    await invoke(() => lead().clock.requestRecovery(lead().clock.recoveryCommand(), "stop"));
  }

  try {
    await promote(0);
    lead().settings.settingsUpdate("timer", { ...lead().settings.STRONG_PATCH, autoRun: "always", takeover: false, notify: false, speak: false, bringToFront: false,
      focusDoneSound: "none", breakOverSound: "none", lengths: { ...lead().settings.settings.get().timer.lengths, pomodoro: 1, short: 1, long: 1 } });
    await drain();
    // Real completions guarantee both seeds exercise a usable usual-length offer.
    await tinyFinish(); invariant(); await tinyFinish(); invariant();
    const offerTab = tabs[1]!;
    await invoke(() => offerTab.clock.requestLongerOffer(offerTab.clock.recoveryCommand(), seed === 0x60c10c ? "accepted" : "dismissed", [...offerTab.tiny.tinyStarts.get().finished]));
    expect(lead().tiny.tinyStarts.get().offer).toBe(seed === 0x60c10c ? "accepted" : "dismissed");
    invariant();

    const operations = ["start", "pause", "resume", "skip", "reset", "task-edit", "tiny", "offer", "parking", "load", "reload", "handoff", "sleep", "delay", "drop", "deliver", "elapsed", "expired-handoff", "expired-reload"] as const;
    for (step = 0; step < 340; step++) {
      const operation = operations[step < operations.length ? step : Math.floor(rng() * operations.length)]!;
      const actor = tabs[rng() < 0.5 ? owner : 1 - owner]!;
      trace.push(`${step} ${operation} actor=${actor.label} owner=${lead().label} seg=${lead().clock.timer.get().segId} at=${Date.now()}`);
      coverage.add(operation);
      if (operation === "start") await invoke(() => actor.clock.timerActions.start());
      else if (operation === "pause") await invoke(() => actor.clock.timerActions.pause());
      else if (operation === "resume") await invoke(() => actor.clock.requestRecovery(actor.clock.recoveryCommand(), "resume"));
      else if (operation === "skip") await invoke(() => actor.clock.timerActions.skip());
      else if (operation === "reset") await invoke(() => actor.clock.timerActions.reset());
      else if (operation === "task-edit") {
        const task = actor.tasks.tasks.get()[0];
        await invoke(() => task ? actor.tasks.updateTask(task.id, { title: `Edited ${step}`, etaMin: 1 + Math.floor(rng() * 5) }) : actor.tasks.addTask({ title: `Task ${step}`, etaMin: 2 }));
      } else if (operation === "tiny") await invoke(() => actor.clock.requestTinyBlock(actor.clock.recoveryCommand(), 1));
      else if (operation === "offer") await invoke(() => actor.clock.requestLongerOffer(actor.clock.recoveryCommand(), rng() < 0.5 ? "accepted" : "dismissed", [...actor.tiny.tinyStarts.get().finished]));
      else if (operation === "parking") {
        actor.parked.parkThought(`Thought ${step}`, { segment: "focus", segId: actor.clock.timer.get().segId });
        await invoke(() => actor.parking.chooseReviewBoundary(rng() < 0.5 ? "block" : "session"));
        await invoke(() => actor.parking.openParkingReview());
        const item = actor.parking.currentReviewItem();
        if (item) await invoke(() => actor.clock.requestParkingRecovery(actor.clock.recoveryCommand(), item.id, (["keep", "task", "drop", "defer", "close"] as const)[Math.floor(rng() * 5)]!));
      } else if (operation === "load") {
        const follower = 1 - owner;
        await tabs[follower]!.store.flushReadyStores(); Channel.close(tabs[follower]!.label);
        tabs[follower] = await loadTab(follower);
      } else if (operation === "reload" || operation === "expired-reload") await handoff(true, operation === "expired-reload");
      else if (operation === "handoff" || operation === "expired-handoff") await handoff(false, operation === "expired-handoff");
      else if (operation === "sleep") {
        const gap = 90_000 + Math.floor(rng() * 86_400_000), running = lead().clock.timer.get().startedAt !== null;
        await lead().clock.prepareTimerDeparture();
        if (running) expectedAway += gap;
        vi.setSystemTime(Date.now() + gap); lead().clock.checkRecoveryLifecycle(true);
      }
      else if (operation === "elapsed") { advance(1 + Math.floor(rng() * 5000)); lead().clock.checkRecoveryLifecycle(); }
      else transport = operation === "delay" ? "delay" : operation === "drop" ? "drop" : "deliver";
      await drain();
      invariant();
    }
    expect([...coverage].sort()).toEqual([...operations].sort());
    transport = "deliver"; await drain();
    await invoke(() => lead().clock.timerActions.pause());
    invariant();
    const durable = await lead().db.dbGet<{ chunks: { ms: number }[] }>("stats");
    expect(durable!.chunks.reduce((sum, chunk) => sum + chunk.ms, 0)).toBe([...ledger.values()].reduce((sum, ms) => sum + ms, 0) + expectedAway);
    expect(pendingLocks.size).toBeGreaterThanOrEqual(2);
    expect(ledger.size, "the seed must exercise several distinct credited segments").toBeGreaterThan(8);
    expect(writes.some(write => write.owner && write.keys.includes("stats"))).toBe(true);
  } catch (error) {
    throw new Error(`Replay seed=${seed} step=${step}\n${trace.slice(-24).join("\n")}\n${error instanceof Error ? error.stack : String(error)}`);
  }
}, 30_000);
