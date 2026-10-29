import { useSyncExternalStore } from "react";
import { dbGet, dbGetMany, dbKeys, dbSetMany, storageMode } from "./db";

// Persisted stores: one value each, many subscribers.
// - Writes are batched across all stores into one IndexedDB transaction (so related values commit together).
// - Edits made before the saved value loads are replayed on top of it, not lost.
// - Other tabs receive committed edits, never unchanged transaction partners.
// - Failures surface through `persistStatus`.

export interface Store<T> {
  get(): T;
  set(next: T | ((prev: T) => T)): void;
  subscribe(fn: () => void): () => void;
  ready: Promise<void>;
  key: string;
}

type Updater<T> = T | ((prev: T) => T);
interface Registered {
  key: string;
  value: () => unknown;
  receive: (v: unknown, source?: "received" | "committed") => void;
  ready: Promise<void>;
  source: "loading" | "missing" | "disk" | "received" | "edited" | "error" | "committed";
  revision: number;
  editRevision: number;
  readFailed: boolean;
  hydrated: boolean;
}
export const storeSource = (key: string) => registry.get(key)?.source;
export const storeReadFailed = (key: string) => registry.get(key)?.readFailed ?? false;
export const storeRevision = (key: string) => registry.get(key)?.revision ?? 0;
const persistListeners = new Set<(keys: string[]) => void>();
/** Called after local writes commit, with genuinely edited keys (cloud sync listens here). */
export const onPersisted = (fn: (keys: string[]) => void) => (persistListeners.add(fn), () => void persistListeners.delete(fn));
export const storeValue = (key: string) => registry.get(key)?.value();
export const storeReady = (key: string) => registry.get(key)?.ready ?? Promise.resolve();
/** Apply a value that came from the cloud: update the store, save it locally, tell other tabs. Does not trigger onPersisted. */
export async function applyRemote(key: string, value: unknown): Promise<void> {
  const r = registry.get(key);
  if (!r) return;
  if (!canWriteClockStore(key)) {
    if (!(await requestClockAction("remote-store", { key, value })).ok) throw new Error("The saved data changed. Try syncing again.");
    return;
  }
  r.receive(value);
  const received = r.value();
  const write = inflight.catch(() => undefined).then(() => {
    if (!canWriteClockStore(key, true)) throw new Error("The active timer changed before saving.");
    return dbSetMany([[key, received]]);
  });
  inflight = write.catch(() => undefined);
  await write;
  channel?.postMessage({ type: "write", entries: [[key, received]] });
}

const registry = new Map<string, Registered>();
/** These values form the device clock's accounting and recovery state. */
export const CLOCK_OWNED_KEYS = ["timer", "stats", "returnActivity", "parkingReview", "tinyStarts", "clockPresence", "stopAttempt", "stopOutcomes"] as const;
const clockOwned = new Set<string>(CLOCK_OWNED_KEYS);
const defaultClockOwner = typeof window === "undefined" || typeof navigator === "undefined" || !("locks" in navigator);
let ownsClock = () => defaultClockOwner;
let clockDependencies: readonly string[] = CLOCK_OWNED_KEYS;
let ownerRegistered = false;
export function registerClockOwner(owns: () => boolean, dependencies: readonly string[] = CLOCK_OWNED_KEYS) {
  ownsClock = owns; clockDependencies = dependencies; ownerRegistered = true;
}
/** The single gate for local mutations, bulk imports and the eventual durable write. */
export function canWriteClockStore(key: string, warn = false): boolean {
  if (!clockOwned.has(key)) return true;
  const allowed = ownsClock() && clockDependencies.every(k => !registry.has(k) || registry.get(k)!.hydrated);
  if (!allowed && warn && import.meta.env.DEV) console.warn(`Refused clock-owned write: ${key} (owner and hydration required)`);
  return allowed;
}
export interface ClockActionResult { ok: boolean; undoToken?: string; keptTimer?: boolean }
const clockActions = new Map<string, (payload: any) => ClockActionResult | Promise<ClockActionResult>>();
let forwardClockAction: ((action: string, payload: unknown) => Promise<ClockActionResult>) | undefined;
export function registerClockForwarder(forward: typeof forwardClockAction) { forwardClockAction = forward; }
export function registerClockAction(action: string, run: (payload: any) => ClockActionResult | Promise<ClockActionResult>) { clockActions.set(action, run); }
export async function executeClockAction(action: string, payload: unknown): Promise<ClockActionResult> {
  if (!canWriteClockStore("timer", true)) return { ok: false };
  return await clockActions.get(action)?.(payload) ?? { ok: false };
}
export async function requestClockAction(action: string, payload: unknown): Promise<ClockActionResult> {
  if (canWriteClockStore("timer")) return executeClockAction(action, payload);
  if (forwardClockAction) return forwardClockAction(action, payload);
  throw new Error("Could not reach the active timer. Try again.");
}
/** Lock acquisition reads one durable snapshot, including broadcasts this tab missed. */
export async function refreshClockStores(): Promise<void> {
  const keys = CLOCK_OWNED_KEYS.filter(key => registry.has(key));
  await Promise.all(keys.map(key => registry.get(key)!.ready));
  const values = await dbGetMany(keys);
  for (const [key, value] of values) if (value !== undefined) {
    registry.get(key)!.receive(value);
    registry.get(key)!.source = "disk";
  }
}
const defaults = new Map<string, unknown>();
export const defaultStoreValue = (key: string) => defaults.get(key);
/** Persist even a lazy store that has not mounted yet. */
export async function applySyncedValue(key: string, value: unknown): Promise<void> {
  if (registry.has(key)) await applyRemote(key, value);
  else {
    if (!canWriteClockStore(key, true)) throw new Error("The active timer must save this value.");
    await dbSetMany([[key, value]]);
  }
}
const dirty = new Set<string>();
const persistenceGroups: string[][] = [];
const persistenceOwners = new Map<string, () => boolean>();
/** Only an owner may include an unchanged store as a transaction partner. */
export function registerPersistenceOwner(keys: string[], owns: () => boolean) {
  keys.forEach(key => persistenceOwners.set(key, owns));
}
/** Related accounting values must share a transaction even if an unload flush was already queued. */
export function registerPersistenceGroup(keys: string[]) {
  persistenceGroups.push(keys);
}
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let inflight: Promise<void> = Promise.resolve();
const channel: BroadcastChannel | null = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel("custom-pomodoro") : null;

// ---------- persistence status ----------
export interface PersistStatus {
  ok: boolean;
  volatile: boolean; // IndexedDB unavailable: data lives only in this tab
  error?: string;
}
let status: PersistStatus = { ok: true, volatile: false };
const statusSubs = new Set<() => void>();
const setStatus = (s: PersistStatus) => {
  if (s.ok === status.ok && s.volatile === status.volatile && s.error === status.error) return;
  status = s;
  statusSubs.forEach((fn) => fn());
};
export const persistStatus = {
  get: () => status,
  subscribe: (fn: () => void) => (statusSubs.add(fn), () => void statusSubs.delete(fn)),
};

/** Write every dirty store now, in one transaction. Safe to call often; calls are serialized. */
export function flushAll(): Promise<void> {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  const changed = [...dirty];
  const selected = new Set(changed);
  let previousSize: number;
  do {
    previousSize = selected.size;
    for (const group of persistenceGroups) if (group.some(key => selected.has(key))) {
      group.forEach(key => { if (registry.has(key)) selected.add(key); });
    }
  } while (selected.size !== previousSize);
  const keys = [...selected];
  const revisions = new Map(keys.map(key => [key, registry.get(key)!.editRevision]));
  dirty.clear();
  if (!keys.length) return inflight;
  let entries: [string, unknown][] = [];
  let edited = changed;
  inflight = inflight
    .catch(() => undefined)
    .then(async () => {
      await Promise.all(keys.map(key => registry.get(key)!.ready));
      // Expand before waiting, but choose values afterwards: a queued timer save
      // must include a conversion's new cursor, task and thought together.
      edited = keys.filter(key => changed.includes(key) || dirty.has(key) || registry.get(key)!.editRevision !== revisions.get(key));
      entries = keys.filter(key => canWriteClockStore(key)).filter(key => edited.includes(key) || (persistenceOwners.get(key)?.() &&
        persistenceGroups.some(group => group.includes(key) && group.some(partner => persistenceOwners.has(partner) && edited.includes(partner)))))
        .map(key => [key, registry.get(key)!.value()]);
      return dbSetMany(entries);
    })
    .then(() => {
      setStatus({ ok: true, volatile: storageMode() === "memory" });
      channel?.postMessage({ type: "write", entries: entries.filter(([key]) => edited.includes(key)) });
      persistListeners.forEach((fn) => fn(edited));
    })
    .catch((e: unknown) => {
      edited.forEach((k) => dirty.add(k)); // retry genuine edits on the next flush
      const name = (e as DOMException)?.name;
      setStatus({
        ok: false,
        volatile: storageMode() === "memory",
        error: name === "QuotaExceededError" ? "Storage is full. Delete some uploaded backgrounds or export and reset." : "Couldn't save your changes.",
      });
    });
  return inflight;
}

function scheduleFlush() {
  if (flushTimer) return;
  flushTimer = setTimeout(() => void flushAll(), 150);
}

channel?.addEventListener("message", (ev: MessageEvent) => {
  const msg = ev.data as { type?: string; entries?: [string, unknown][] };
  if (msg?.type === "profile-reset") { if (typeof location !== "undefined") location.reload(); return; }
  if (msg?.type !== "write" || !Array.isArray(msg.entries)) return;
  for (const [k, v] of msg.entries) {
    // A delayed former-owner broadcast must never roll the current owner back.
    if (ownerRegistered && clockOwned.has(k) && ownsClock()) continue;
    registry.get(k)?.receive(v);
  }
});

if (typeof window !== "undefined") {
  // the page may be gone before the 150 ms debounce fires
  window.addEventListener("pagehide", () => void flushAll());
  document.addEventListener("visibilitychange", () => document.visibilityState === "hidden" && void flushAll());
}

export function createStore<T>(key: string, initial: T, migrate?: (stored: unknown) => T): Store<T> {
  let value = initial;
  let hydrated = false;
  const pending: Updater<T>[] = [];
  const subs = new Set<() => void>();
  const emit = () => subs.forEach((fn) => fn());
  const apply = (next: Updater<T>) => {
    value = typeof next === "function" ? (next as (p: T) => T)(value) : next;
  };

  const reg: Registered = {
    key,
    source: "loading",
    revision: 0,
    editRevision: 0,
    readFailed: false,
    hydrated: false,
    value: () => value,
    receive: (v, source = "received") => {
      reg.source = source;
      reg.revision++;
      value = migrate ? migrate(v) : mergeDefaults(initial, v);
      emit();
    },
    ready: Promise.resolve(),
  };
  defaults.set(key, initial);
  registry.set(key, reg);

  const ready = dbGet<unknown>(key)
    .catch(() => {
      if (reg.source !== "received") reg.source = "error";
      reg.readFailed = true;
      setStatus({ ok: false, volatile: storageMode() === "memory", error: "Saved data could not be read. Reload to retry storage." });
      return undefined;
    })
    .then((stored) => {
      // start from the saved value (or the default), then replay edits made while loading, exactly once
      if (reg.source !== "received") {
        value = stored !== undefined ? (migrate ? migrate(stored) : mergeDefaults(initial, stored)) : initial;
        if (reg.source !== "error") reg.source = stored === undefined ? "missing" : "disk";
      }
      hydrated = true;
      reg.hydrated = true;
      // replay edits made while loading on top of the saved value
      if (pending.length) {
        reg.source = "edited";
        pending.splice(0).forEach(apply);
        dirty.add(key);
        scheduleFlush();
      }
      emit();
    });
  reg.ready = ready;

  return {
    key,
    ready,
    get: () => value,
    set(next) {
      if (!canWriteClockStore(key, true)) return;
      reg.revision++;
      reg.editRevision++;
      if (hydrated) reg.source = "edited";
      if (!hydrated) pending.push(next);
      apply(next);
      emit();
      if (hydrated) {
        dirty.add(key);
        scheduleFlush();
      }
    },
    subscribe(fn) {
      subs.add(fn);
      return () => subs.delete(fn);
    },
  };
}

export function useStore<T>(store: Store<T>): T;
export function useStore<T, S>(store: Store<T>, select: (v: T) => S): S;
export function useStore<T, S>(store: Store<T>, select?: (v: T) => S) {
  return useSyncExternalStore(store.subscribe, () => (select ? select(store.get()) : store.get()));
}

const RESERVED = new Set(["__proto__", "constructor", "prototype"]);

/**
 * Overlay a stored value on the defaults. For plain objects only keys that exist in the defaults are kept
 * (schema-shaped settings; also blocks __proto__ tricks from imported backups). Type mismatches keep the default.
 */
export function mergeDefaults<T>(defaults: T, stored: unknown): T {
  if (!isPlainObject(defaults)) {
    if (stored === undefined || stored === null) return defaults;
    if (defaults !== null && defaults !== undefined && typeof defaults !== typeof stored) return defaults;
    if (Array.isArray(defaults) !== Array.isArray(stored)) return defaults;
    return stored as T;
  }
  if (!isPlainObject(stored)) return defaults;
  const out: Record<string, unknown> = {};
  for (const [k, d] of Object.entries(defaults as Record<string, unknown>)) {
    if (RESERVED.has(k)) continue;
    out[k] = Object.prototype.hasOwnProperty.call(stored, k) ? mergeDefaults(d, (stored as Record<string, unknown>)[k]) : d;
  }
  return out as T;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;
}

export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

/** Quit waits for hydration and every outstanding IndexedDB commit. */
export async function flushReadyStores(): Promise<void> {
  await Promise.all([...registry.values()].map((store) => store.ready));
  do { await flushAll(); } while (dirty.size && status.ok);
  if (!status.ok) throw new Error(status.error);
}

/** Restore storage and live stores together, ordered with pagehide and debounced writes. */
export async function restoreStoreEntries(input: [string, unknown][] | (() => { entries: [string, unknown][]; keptTimer: boolean })): Promise<boolean> {
  // Owner-only preparation runs after earlier writes, immediately before the
  // live publication and its atomic save. Never forward a captured closure.
  if (typeof input === "function") {
    const write = inflight.catch(() => undefined).then(() => {
      const { entries, keptTimer } = input();
      if (entries.some(([key]) => !canWriteClockStore(key, true))) throw new Error("The active timer changed before importing.");
      const commit = Promise.resolve().then(() => {
        if (entries.some(([key]) => !canWriteClockStore(key, true))) throw new Error("The active timer changed before importing.");
        return dbSetMany(entries);
      });
      return publishRestore(entries, commit).then(() => keptTimer);
    });
    inflight = write.then(() => undefined, () => undefined);
    return write;
  }
  const entries = input;
  if (entries.some(([key]) => !canWriteClockStore(key))) {
    const result = await requestClockAction("restore-stores", entries);
    if (!result.ok) throw new Error("The active timer changed. Try importing again.");
    return result.keptTimer === true;
  }
  // Reserve our place before notifying subscribers, which may themselves flush stores.
  const write = inflight.catch(() => undefined).then(() => {
    if (entries.some(([key]) => !canWriteClockStore(key, true))) throw new Error("The active timer changed before importing.");
    return dbSetMany(entries);
  });
  inflight = write.catch(() => undefined);
  return publishRestore(entries, write);
}

function publishRestore(entries: [string, unknown][], write: Promise<void>): Promise<boolean> {
  const previous = new Map<string, { before: unknown; restored: unknown; wasDirty: boolean }>();
  for (const [key, value] of entries) {
    const store = registry.get(key);
    if (!store) continue;
    const before = store.value();
    const wasDirty = dirty.delete(key);
    store.receive(value);
    previous.set(key, { before, restored: store.value(), wasDirty });
  }
  return write.then(() => {
    channel?.postMessage({ type: "write", entries });
    return false;
  }).catch((error: unknown) => {
    for (const [key, snapshot] of previous) {
      const store = registry.get(key)!;
      if (store.value() !== snapshot.restored) continue;
      store.receive(snapshot.before);
      if (snapshot.wasDirty) dirty.add(key);
    }
    throw error;
  });
}

/** Commit before publishing a preset or its restore point. Local state stays unchanged on failure. */
export function commitStoreEntries(input: [string, unknown][] | (() => [string, unknown][])): Promise<boolean> {
  const write = inflight.catch(() => undefined).then(async () => {
    const entries = typeof input === "function" ? input() : input;
    if (entries.some(([key]) => !canWriteClockStore(key, true))) return false;
    const revisions = new Map(entries.map(([key]) => [key, storeRevision(key)]));
    await dbSetMany(entries);
    // Publish the related values together. A concurrent edit keeps both the latest
    // settings and the unconsumed restore point, including their durable copies.
    if (entries.some(([key]) => storeRevision(key) !== revisions.get(key))) {
      if (entries.some(([key]) => !canWriteClockStore(key, true))) return false;
      await dbSetMany(entries.map(([key]) => [key, registry.get(key)?.value()]));
      return false;
    }
    const published: [string, unknown][] = [];
    for (const [key, value] of entries) {
      dirty.delete(key);
      registry.get(key)?.receive(value, "committed");
      published.push([key, value]);
    }
    channel?.postMessage({ type: "write", entries: published });
    persistListeners.forEach(fn => fn(published.map(([key]) => key)));
    return published.length === entries.length;
  });
  inflight = write.then(() => undefined, () => undefined);
  return write;
}

registerClockAction("remote-store", async ({ key, value }) => {
  if (!clockOwned.has(key)) return { ok: false };
  await applyRemote(key, value); return { ok: true };
});
registerClockAction("restore-stores", async entries => {
  if (!Array.isArray(entries)) return { ok: false };
  await restoreStoreEntries(entries); return { ok: true };
});

/** Reset is a clock mutation too. Publish empty live state before other tabs reload. */
export async function clearStoredProfile(): Promise<void> {
  await flushReadyStores();
  if (!canWriteClockStore("timer", true)) throw new Error("The active timer must reset the data.");
  const keys = await dbKeys();
  if (!canWriteClockStore("timer", true)) throw new Error("The active timer changed. Try resetting again.");
  // Clear the timer first so task/settings subscribers cannot bank the old run.
  const entries: [string, unknown][] = [...registry.keys()].sort((a, b) => Number(b === "timer") - Number(a === "timer"))
    .map(key => [key, defaults.get(key)]);
  for (const [key, value] of entries) registry.get(key)!.receive(value);
  dirty.clear();
  const write = inflight.catch(() => undefined).then(() => {
    if (!canWriteClockStore("timer", true)) throw new Error("The active timer changed before resetting.");
    return dbSetMany([], keys);
  });
  inflight = write.catch(() => undefined);
  await write;
  channel?.postMessage({ type: "profile-reset" });
  if (typeof location !== "undefined") setTimeout(() => location.reload(), 100);
}
