import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BACKUP_FORMAT, BACKUP_KEYS, MAX_BACKUP_BYTES, MAX_BACKUP_IMAGE_BYTES, backupImageEntries, createBackup, parseBackup } from "../../lib/backup";
import { dbDel, dbGet, dbKeys, dbSet, dbSetMany } from "../../lib/db";
import { flushReadyStores } from "../../lib/store";
const wrap = (data: unknown, images?: unknown) => JSON.stringify({ format: BACKUP_FORMAT, version: 1, data, ...(images === undefined ? {} : { images }) });
const radio = { pinned: ["nightride", "chillsynth"], lastStation: "chillsynth", volume: 0.7 };
const base64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aNc8AAAAASUVORK5CYII=";
const image = { id: "bg-one", name: "A local image", type: "image/png", base64 };
const blob = () => new Blob([Uint8Array.from(atob(base64), char => char.charCodeAt(0))], { type: "image/png" });
const processed = new Blob(["resized WebP"], { type: "image/webp" });
let canvas: { width: number; height: number; getContext: ReturnType<typeof vi.fn>; toBlob: ReturnType<typeof vi.fn> };
let drawImage: ReturnType<typeof vi.fn>;
beforeEach(async () => {
  await flushReadyStores(); for (const key of await dbKeys()) await dbDel(key);
  drawImage = vi.fn();
  canvas = { width: 0, height: 0, getContext: vi.fn(() => ({ drawImage })), toBlob: vi.fn((callback: (b: Blob | null) => void) => callback(processed)) };
  vi.stubGlobal("document", { createElement: vi.fn(() => canvas) });
  vi.stubGlobal("Image", class { src = ""; naturalWidth = 1; naturalHeight = 1; decode = vi.fn().mockResolvedValue(undefined); });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("backup scope", () => {
  it("includes validated radio preferences and remains compatible with old backups", () => {
    expect(BACKUP_KEYS).toContain("radio"); expect(BACKUP_KEYS).toContain("parked");
    expect(parseBackup(wrap({ radio })).data.radio).toEqual(radio);
    expect(parseBackup(wrap({ notes: "old backup" }))).toEqual({ version: 1, sections: ["focus"], data: { notes: "old backup" } });
  });
  it("rejects invalid radio state before restoring anything", () => {
    for (const patch of [{ volume: -1 }, { volume: 2 }, { volume: "0.5" }, { lastStation: "https://evil.invalid" }, { pinned: ["missing"] }, { pinned: ["nightride", "nightride"] }, { pinned: "all" }]) {
      expect(() => parseBackup(wrap({ notes: "valid", radio: { ...radio, ...patch } }))).toThrow(/radio/);
    }
  });
  it("exports radio and parked entries while leaving images out by default", async () => {
    const parked = [{ id: "p", text: "later", at: Date.now(), segment: "focus", status: "open" }];
    await dbSetMany([["radio", radio], ["parked", parked], ["customBgs", [{ id: image.id, name: image.name }]], [`custom-bg:${image.id}`, blob()]]);
    const saved = JSON.parse(await createBackup());
    expect(saved.data.radio).toEqual(radio); expect(saved.data.parked).toEqual(parked);
    expect(saved.images).toBeUndefined(); expect(saved.data.customBgs).toBeUndefined();
  });
  it("restores image metadata and re-encodes images without losing unrelated uploads", async () => {
    await dbSetMany([["notes", "backup"], ["customBgs", [{ id: image.id, name: image.name }]], [`custom-bg:${image.id}`, blob()]]);
    const backup = await createBackup(true);
    const parsed = parseBackup(backup);
    expect(parsed.images).toEqual([image]);
    await dbSetMany([["customBgs", [{ id: "other", name: "Keep me" }]], ["custom-bg:other", blob()]]);
    const writes = await backupImageEntries(parsed.images);
    await dbSetMany([...Object.entries(parsed.data), ...writes]);
    expect(await dbGet("customBgs")).toEqual([{ id: "other", name: "Keep me", size: blob().size }, { id: image.id, name: image.name, size: processed.size }]);
    const stored = await dbGet<Blob>(`custom-bg:${image.id}`);
    expect(stored?.type).toBe("image/webp");
    expect(await stored!.arrayBuffer()).toEqual(await processed.arrayBuffer());
    expect(await dbGet("custom-bg:other")).toBeInstanceOf(Blob);
  });
  it("does not touch existing uploads when a backup omits images", async () => {
    await dbSet("customBgs", [{ id: "keep", name: "Keep" }]);
    expect(await backupImageEntries()).toEqual([]);
    expect(await backupImageEntries([])).toEqual([]);
    expect(await dbGet("customBgs")).toEqual([{ id: "keep", name: "Keep" }]);
  });
  it("rejects invalid base64, non-raster payloads, wrong types, bad IDs and duplicates", () => {
    for (const patch of [{ base64: "!!!=" }, { base64: "A===" }, { base64: "abc" }, { base64: "" }, { id: "../settings" }, { type: "image/svg+xml" }, { type: "image/jpeg" }, { base64: btoa("<svg onload=alert(1) />") }, { name: 1 }]) {
      expect(() => parseBackup(wrap({ notes: "ok" }, [{ ...image, ...patch }]))).toThrow();
    }
    expect(() => parseBackup(wrap({ notes: "ok" }, [image, image]))).toThrow(/image/);
    expect(() => parseBackup(wrap({ notes: "ok" }, {}))).toThrow(/image/);
  });
  it("rejects large files and image payloads, and never writes on validation failure", async () => {
    await dbSet("notes", "original");
    expect(() => parseBackup(wrap({ notes: "new" }, [{ ...image, base64: "A".repeat(4 * Math.ceil(MAX_BACKUP_IMAGE_BYTES / 3) + 4) }]))).toThrow(/image/);
    expect(() => parseBackup(" ".repeat(MAX_BACKUP_BYTES + 1))).toThrow(/large/);
    expect(await dbGet("notes")).toBe("original");
    expect(await dbGet(`custom-bg:${image.id}`)).toBeUndefined();
  });
  it("rejects decoded images over the byte cap or dimension limits", () => {
    const bytes = new Uint8Array(MAX_BACKUP_IMAGE_BYTES + 1); bytes.set(Uint8Array.from(atob(base64), char => char.charCodeAt(0)));
    const encode = (input: Uint8Array) => { let text = ""; for (let at = 0; at < input.length; at += 8192) text += String.fromCharCode(...input.subarray(at, at + 8192)); return btoa(text); };
    expect(() => parseBackup(wrap({ notes: "ok" }, [{ ...image, base64: encode(bytes) }]))).toThrow(/limit/);
    const huge = Uint8Array.from(atob(base64), char => char.charCodeAt(0)); new DataView(huge.buffer).setUint32(16, 20000);
    expect(() => parseBackup(wrap({ notes: "ok" }, [{ ...image, base64: encode(huge) }]))).toThrow(/pixels/);
  });
  it("fails clearly when a saved background is missing or images exceed the export cap", async () => {
    await dbSetMany([["notes", "ok"], ["customBgs", [{ id: "missing", name: "Missing" }]]]);
    await expect(createBackup(true)).rejects.toThrow(/missing/);
    await dbSet("custom-bg:missing", new Blob([new Uint8Array(MAX_BACKUP_IMAGE_BYTES + 1)], { type: "image/png" }));
    await expect(createBackup(true)).rejects.toThrow(/limit/);
  });
  it("rejects imports that would exceed the local image count without modifying storage", async () => {
    const saved = Array.from({ length: 12 }, (_, i) => ({ id: `old-${i}`, name: "old" }));
    await dbSet("customBgs", saved);
    await expect(backupImageEntries([image])).rejects.toThrow(/limit/);
    expect(await dbGet("customBgs")).toEqual(saved);
  });
  it("downscales a large-dimension PNG header through the normal upload processor", async () => {
    const bytes = Uint8Array.from(atob(base64), char => char.charCodeAt(0));
    const view = new DataView(bytes.buffer); view.setUint32(16, 10000); view.setUint32(20, 5000);
    vi.stubGlobal("Image", class { src = ""; naturalWidth = 10000; naturalHeight = 5000; decode = vi.fn().mockResolvedValue(undefined); });
    const imported = { ...image, base64: btoa(String.fromCharCode(...bytes)) };
    const parsed = parseBackup(wrap({ notes: "keep" }, [imported]));
    const writes = await backupImageEntries(parsed.images);
    expect(canvas.width).toBe(2560); expect(canvas.height).toBe(1280);
    expect(drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, 2560, 1280);
    expect(canvas.toBlob).toHaveBeenCalledWith(expect.any(Function), "image/webp", 0.9);
    expect(writes).toEqual([["customBgs", [{ id: image.id, name: image.name, size: processed.size }]], [`custom-bg:${image.id}`, processed]]);
    expect(await dbGet(`custom-bg:${image.id}`)).toBeUndefined();
  });
  it("rejects failed decoding before writing any imported data", async () => {
    await dbSet("notes", "original");
    const revoke = vi.spyOn(URL, "revokeObjectURL");
    vi.stubGlobal("Image", class { src = ""; decode = vi.fn().mockRejectedValue(new Error("Unreadable image")); });
    await expect(backupImageEntries([image])).rejects.toThrow(/Unreadable/);
    expect(revoke).toHaveBeenCalledOnce();
    expect(canvas.toBlob).not.toHaveBeenCalled();
    expect(await dbGet("notes")).toBe("original");
    expect(await dbGet(`custom-bg:${image.id}`)).toBeUndefined();
  });
  it("rejects failed encoding before returning any writes", async () => {
    canvas.toBlob.mockImplementation((callback: (b: Blob | null) => void) => callback(null));
    await expect(backupImageEntries([image])).rejects.toThrow(/resize/);
    expect(await dbGet(`custom-bg:${image.id}`)).toBeUndefined();
  });
});
