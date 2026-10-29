import { preserveTaskAllowances, validTaskAllowances } from "./taskAllowance";
import type { Task } from "../state/tasks";
// Cookie transport on the hosted site; credentials stay in Electron's main process.
import { parseIntentDocument, preserveIntentFinish } from "./intent";
import { intent } from "../state/intent";
import { calmFoundationReady, presetState } from "../state/settings";
import { dbGet, dbSet } from "./db";
import { applySyncedValue, defaultStoreValue, flushAll, onPersisted, storeReady, storeValue } from "./store";

export const CLOUD_ORIGIN = "https://kitestring.custom-pomodoro.workers.dev";
export const SYNC_KEYS = ["settings", "tasks", "focusPick", "stats", "notes", "mixer", "radio", "parked", "intent"] as const;
type Key = (typeof SYNC_KEYS)[number];
const META = "sync-meta";
export interface SyncStatus {
  state: "off" | "signedOut" | "choice" | "syncing" | "ok" | "error";
  email?: string;
  at?: number;
  error?: string;
  warnings?: Partial<Record<Key, string>>;
}
let status: SyncStatus = { state: "off" };
const subs = new Set<() => void>();
const set = (s: SyncStatus) => { status = s; subs.forEach(f => f()); };
export const syncStatus = { get: () => status, subscribe: (f: () => void) => (subs.add(f), () => void subs.delete(f)) };
const desktop = () => typeof window === "undefined" ? undefined : window.desktop?.cloud;
const isKey = (k: string): k is Key => (SYNC_KEYS as readonly string[]).includes(k);
let meta: Partial<Record<Key, number>> = {};
let dirty = new Set<Key>();
let timer: ReturnType<typeof setTimeout> | undefined;
let started = false;
let epoch = 0;
let queue: Promise<void> = Promise.resolve();
function serial<T>(job: () => Promise<T>): Promise<T> { const result = queue.then(job); queue = result.then(() => undefined, () => undefined); return result; }

export function decide(local: number | undefined, remote: number | undefined): "pull" | "push" | "same" {
  if (remote === undefined && local === undefined) return "same";
  if (remote === undefined) return "push";
  if (local === undefined || remote > local) return "pull";
  return remote < local ? "push" : "same";
}
export function syncAvailableAt(loc: { protocol: string; hostname: string }, native = !!desktop()): boolean {
  return native || (loc.protocol === "https:" && [new URL(CLOUD_ORIGIN).hostname, "custom-pomodoro.custom-pomodoro.workers.dev"].includes(loc.hostname));
}
export function syncAllowedAt(loc: { protocol: string; hostname: string }, signedIn = !!status.email, native = !!desktop()): boolean {
  return signedIn && syncAvailableAt(loc, native);
}
export async function cloudRequest<T>(method: string, path: string, body?: unknown): Promise<T> {
  const bridge = desktop();
  let code: number, data: { error?: string }, retry: string | null | undefined;
  if (bridge) {
    const reply = path === "/api/auth/login" ? await bridge.signIn((body as { email: string }).email, (body as { password: string }).password)
      : path === "/api/auth/logout" ? await bridge.signOut()
      : path === "/api/me" ? await bridge.status() : await bridge.request(method, path, body);
    code = reply.status; data = reply.data; retry = reply.retryAfter;
  } else {
    const r = await fetch(path, { method, credentials: "same-origin", redirect: "error", cache: "no-store", headers: { "Content-Type": "application/json", "X-Custom-Pomodoro": "1" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    code = r.status; retry = r.headers.get("Retry-After"); data = await r.json();
  }
  if (code === 401) { set({ state: "signedOut", error: path === "/api/auth/login" ? data.error : "Your sign-in expired. Sign in again." }); throw new Error(data.error ?? "Sign in to sync."); }
  if (code === 429) throw new Error(`Too many sign-in attempts. Try again in ${Math.max(1, Math.ceil(Number(retry || 900) / 60))} minutes.`);
  if (code < 200 || code >= 300) throw new Error(data.error ?? `Could not sync (${code}). Try again.`);
  return data as T;
}
export async function openPasswordReset(): Promise<void> {
  if (desktop()) { if (!await desktop()!.openReset()) throw new Error("Could not open your browser."); }
  else window.open(CLOUD_ORIGIN + "/account/reset/", "_blank", "noopener,noreferrer");
}
function schedulePush(delay = 2000) {
  clearTimeout(timer);
  if (!status.email || status.state === "choice") return;
  timer = setTimeout(() => void syncNow(), delay);
}
async function entries() {
  return (await cloudRequest<{ entries: { key: string; value: unknown; updatedAt: number }[] }>("GET", "/api/sync")).entries.filter(e => isKey(e.key));
}
async function reconcile(choice?: "keep" | "replace") {
  const current = epoch;
  const remote = new Map((await entries()).map(e => [e.key as Key, e]));
  if (current !== epoch) return;
  await flushAll();
  const warnings: Partial<Record<Key, string>> = {};
  for (const key of SYNC_KEYS) {
    const r = remote.get(key);
    const incomingIntent = key === "intent" && r ? parseIntentDocument(r.value) : null;
    if (key === "intent" && r && !incomingIntent) {
      warnings.intent = "The synced next action is invalid. Your local next action is kept.";
      continue;
    }
    if (key === "tasks" && r && !validTaskAllowances(r.value)) {
      warnings.tasks = "The synced transition allowance is invalid. Your local tasks are kept.";
      continue;
    }
    const provisionalSettings = key === "settings" && presetState.get().provisional;
    if (provisionalSettings) {
      delete meta.settings;
      dirty.delete("settings");
      if (!r) continue;
    }
    const d = provisionalSettings ? "pull" : choice === "keep" ? "push" : choice === "replace" ? "pull" : decide(meta[key], r?.updatedAt);
    if (d === "pull") {
      if (r || choice === "replace") {
        const before = meta[key];
        await applySyncedValue(key, r ? (key === "intent" ? preserveIntentFinish(incomingIntent!, intent.get()) : key === "tasks" && Array.isArray(r.value) ? preserveTaskAllowances(r.value as Task[], (storeValue("tasks") as Task[] | undefined) ?? []) : r.value) : defaultStoreValue(key));
        if (meta[key] === before) {
          if (r) meta[key] = r.updatedAt;
          else delete meta[key];
          dirty.delete(key);
        }
      }
    } else if (d === "push" && (storeValue(key) ?? await dbGet(key)) !== undefined) {
      if (choice === "keep") meta[key] = Math.max(Date.now(), (r?.updatedAt ?? 0) + 1);
      meta[key] ??= Date.now();
      dirty.add(key);
    }
  }
  await dbSet(META, meta);
  const keys = [...dirty].filter(key => !warnings[key]);
  if (keys.length) {
    const saved = await Promise.all(keys.map(async key => ({ key, value: storeValue(key) ?? await dbGet(key), updatedAt: meta[key] ?? Date.now() })));
    await cloudRequest("PUT", "/api/sync", { entries: saved });
    for (const entry of saved) if (meta[entry.key] === entry.updatedAt) dirty.delete(entry.key);
  }
  if (current === epoch) set({ state: "ok", email: status.email, at: Date.now(), warnings });
}
export function syncNow(): Promise<void> {
  return serial(async () => {
    if (!status.email || status.state === "choice") return;
    set({ ...status, state: "syncing", error: undefined });
    try { await reconcile(); }
    catch (e) { if (status.email) set({ ...status, state: "error", error: (e as Error).message }); }
  });
}
async function activate(email: string) {
  await Promise.all([...SYNC_KEYS.map(storeReady), calmFoundationReady]);
  const previous = await dbGet<string>("sync-account");
  const hasLocal = (await Promise.all(SYNC_KEYS.map(key => key === "settings" && presetState.get().provisional ? undefined : dbGet(key)))).some(value => value !== undefined);
  set({ state: previous !== email && hasLocal ? "choice" : "syncing", email });
  if (status.state === "choice") return;
  await reconcile();
  await dbSet("sync-account", email);
}
export function signIn(email: string, password: string): Promise<void> {
  return serial(async () => {
    if (!syncAvailableAt(location)) return;
    await flushAll();
    const me = await cloudRequest<{ email: string }>("POST", "/api/auth/login", { email, password });
    epoch++;
    await activate(me.email);
  });
}
export function chooseInitialData(choice: "keep" | "replace"): Promise<void> {
  return serial(async () => {
    if (status.state !== "choice" || !status.email) return;
    const email = status.email;
    try {
      await reconcile(choice);
      await dbSet("sync-account", email);
    } catch (e) { if (status.email) set({ state: "choice", email, error: (e as Error).message }); }
  });
}
export function signOut(): Promise<void> {
  epoch++;
  clearTimeout(timer);
  return serial(async () => {
    await cloudRequest("POST", "/api/auth/logout");
    dirty.clear();
    set({ state: "signedOut" });
  });
}
export async function metaAfterImport(keys: readonly string[], now = Date.now()): Promise<[string, Partial<Record<Key, number>>]> {
  const current = (await dbGet<Partial<Record<Key, number>>>(META).catch(() => undefined)) ?? {};
  const next = { ...current };
  for (const k of keys) if (isKey(k)) next[k] = Math.max(now, (current[k] ?? 0) + 1, (meta[k] ?? 0) + 1);
  return [META, next];
}
export async function startSync(): Promise<void> {
  if (started || typeof location === "undefined" || !syncAvailableAt(location)) return;
  started = true;
  meta = (await dbGet<typeof meta>(META)) ?? {};
  onPersisted(keys => {
    for (const k of keys) if (isKey(k) && !(k === "settings" && presetState.get().provisional)) { meta[k] = Math.max(Date.now(), (meta[k] ?? 0) + 1); dirty.add(k); }
    void dbSet(META, meta);
    schedulePush();
  });
  set({ state: "signedOut" });
  try { const me = await cloudRequest<{ email: string }>("GET", "/api/me"); await serial(() => activate(me.email)); }
  catch (e) { set({ state: "signedOut", error: status.error ? undefined : (e as Error).message }); }
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") void syncNow(); });
  setInterval(() => { if (document.visibilityState === "visible") void syncNow(); }, 30_000);
}

/** Import owns the sync queue until its local transaction and stamps have committed. */
export function withSyncPaused<T>(restore: () => Promise<T>): Promise<T> {
  epoch++; // Invalidate an outstanding pull before it starts applying account data.
  clearTimeout(timer);
  return serial(async () => {
    const result = await restore();
    const imported = (await dbGet<typeof meta>(META)) ?? {};
    for (const key of SYNC_KEYS) if (imported[key] !== undefined && imported[key] !== meta[key]) dirty.add(key);
    meta = imported;
    schedulePush();
    return result;
  });
}
