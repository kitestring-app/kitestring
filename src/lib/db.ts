// Tiny IndexedDB key-value store. Everything the app persists goes through here.
// Writes resolve only when their transaction commits, and reject on error/abort (e.g. quota exceeded).
// Falls back to an in-memory map when IndexedDB is unavailable; `storageMode()` reports which one is live.

const DB_NAME = "custom-pomodoro";
const STORE = "kv";

let dbPromise: Promise<IDBDatabase | null> | null = null;
const memory = new Map<string, unknown>();
let mode: "indexeddb" | "memory" | "unknown" = "unknown";

export const storageMode = () => mode;

function open(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    const fallback = () => {
      mode = "memory";
      resolve(null);
    };
    try {
      if (typeof indexedDB === "undefined") return fallback();
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => {
        mode = "indexeddb";
        resolve(req.result);
      };
      req.onerror = fallback;
      req.onblocked = fallback;
    } catch {
      fallback();
    }
  });
  return dbPromise;
}

export async function dbGet<T>(key: string): Promise<T | undefined> {
  const db = await open();
  if (!db) return memory.get(key) as T | undefined;
  return new Promise<T | undefined>((resolve, reject) => {
    try {
      const req = db.transaction(STORE, "readonly").objectStore(STORE).get(key);
      req.onsuccess = () => resolve(req.result as T | undefined);
      req.onerror = () => reject(req.error ?? new Error(`read failed: ${key}`));
    } catch (e) {
      reject(e);
    }
  });
}

/** Write several keys in one transaction: all of them land, or none do. */
export async function dbSetMany(entries: [string, unknown][], deletes: string[] = []): Promise<void> {
  if (!entries.length && !deletes.length) return;
  const db = await open();
  if (!db) {
    for (const [k, v] of entries) memory.set(k, v);
    for (const k of deletes) memory.delete(k);
    return;
  }
  return new Promise<void>((resolve, reject) => {
    try {
      const tx = db.transaction(STORE, "readwrite");
      const s = tx.objectStore(STORE);
      for (const [k, v] of entries) s.put(v, k);
      for (const k of deletes) s.delete(k);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("write failed"));
      tx.onabort = () => reject(tx.error ?? new Error("write aborted"));
    } catch (e) {
      reject(e);
    }
  });
}

export const dbSet = (key: string, value: unknown) => dbSetMany([[key, value]]);
export const dbDel = (key: string) => dbSetMany([], [key]);

export async function dbKeys(): Promise<string[]> {
  const db = await open();
  if (!db) return [...memory.keys()];
  return new Promise<string[]>((resolve, reject) => {
    try {
      const req = db.transaction(STORE, "readonly").objectStore(STORE).getAllKeys();
      req.onsuccess = () => resolve(req.result.map(String));
      req.onerror = () => reject(req.error ?? new Error("keys failed"));
    } catch (e) {
      reject(e);
    }
  });
}

/** Read accounting partners from the same transaction during an owner handoff. */
export async function dbGetMany(keys: readonly string[]): Promise<[string, unknown][]> {
  const db = await open();
  if (!db) return keys.map(key => [key, memory.get(key)]);
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly"), store = tx.objectStore(STORE);
    const values: [string, unknown][] = keys.map(key => [key, undefined]);
    keys.forEach((key, index) => { const req = store.get(key); req.onsuccess = () => { values[index][1] = req.result; }; });
    tx.oncomplete = () => resolve(values);
    tx.onerror = () => reject(tx.error ?? new Error("Could not read the clock snapshot"));
    tx.onabort = () => reject(tx.error ?? new Error("Clock snapshot read aborted"));
  });
}
