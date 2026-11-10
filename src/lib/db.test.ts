import { afterEach, expect, it, vi } from "vitest";
import { IDBFactory } from "fake-indexeddb";

afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

it("rolls back earlier queued writes when a later value cannot be cloned", async () => {
  vi.stubGlobal("indexedDB", new IDBFactory());
  const db = await import("./db");
  await db.dbSet("first", "original");
  await expect(db.dbSetMany([["first", "changed"], ["second", () => {}]])).rejects.toMatchObject({ name: "DataCloneError" });
  expect(await db.dbGet("first")).toBe("original");
  expect(await db.dbGet("second")).toBeUndefined();
});

it("keeps memory fallback consistent when a blocked open later succeeds", async () => {
  const close = vi.fn();
  const request = { result: { close }, onblocked: null as null | (() => void), onsuccess: null as null | (() => void) };
  vi.stubGlobal("indexedDB", { open: () => request });
  const db = await import("./db");
  const write = db.dbSet("saved", "in memory");
  request.onblocked!();
  await write;
  request.onsuccess!();
  expect(db.storageMode()).toBe("memory");
  expect(close).toHaveBeenCalledOnce();
  expect(await db.dbGet("saved")).toBe("in memory");
});
