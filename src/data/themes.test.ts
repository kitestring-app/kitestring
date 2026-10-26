import { afterEach, describe, expect, it, vi } from "vitest";
import { BACKGROUND_LIMITS, backgroundCapacityError, backgroundDimensions, customBgs, prepareBackground, saveCustomBackground, THEMES } from "./themes";
import { dbDel, dbGet, dbSet } from "../lib/db";
import * as db from "../lib/db";

function png(width: number, height: number) {
  const bytes = new Uint8Array(24), data = new DataView(bytes.buffer);
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10]); bytes.set([73, 72, 68, 82], 12);
  data.setUint32(16, width); data.setUint32(20, height);
  return bytes.buffer;
}
function gif(width: number, height: number) {
  const bytes = new Uint8Array(10), data = new DataView(bytes.buffer);
  bytes.set(new TextEncoder().encode("GIF89a"));
  data.setUint16(6, width, true); data.setUint16(8, height, true);
  return bytes.buffer;
}
function jpeg(width: number, height: number, marker = 0xc0) {
  const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0, 0xff, marker, 0, 7, 8, 0, 0, 0, 0]);
  const data = new DataView(bytes.buffer);
  data.setUint16(13, height); data.setUint16(15, width);
  return bytes.buffer;
}
function webp(width: number, height: number, kind = "VP8X") {
  const bytes = new Uint8Array(30), data = new DataView(bytes.buffer);
  const text = (value: string, offset: number) => bytes.set(new TextEncoder().encode(value), offset);
  text("RIFF", 0); data.setUint32(4, 22, true); text("WEBP", 8); text(kind, 12); data.setUint32(16, 10, true);
  const uint24 = (offset: number, value: number) => { bytes[offset] = value; bytes[offset + 1] = value >>> 8; bytes[offset + 2] = value >>> 16; };
  if (kind === "VP8X") { uint24(24, width - 1); uint24(27, height - 1); }
  if (kind === "VP8 ") { bytes.set([0x9d, 1, 0x2a], 23); data.setUint16(26, width, true); data.setUint16(28, height, true); }
  if (kind === "VP8L") { bytes[20] = 0x2f; data.setUint32(21, (width - 1) | ((height - 1) << 14), true); }
  return bytes.buffer;
}

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("expanded theme library", () => {
  it("meets the audited category breadth with unique compositions and credited, allowlisted photos", () => {
    for (const [category, count] of Object.entries({ gradients: 24, abstract: 12, scenic: 24, nature: 7, urban: 7, interior: 15, animated: 7 }))
      expect(THEMES.filter((theme) => theme.category === category), category).toHaveLength(count);
    expect(new Set(THEMES.map((theme) => theme.background)).size).toBe(THEMES.length);
    for (const theme of THEMES) {
      if (theme.background.includes("url(")) {
        expect(theme.background).toMatch(/^url\("https:\/\/images\.unsplash\.com\/photo-[\w-]+\?auto=format&fit=crop&w=2400&q=80"\) center \/ cover no-repeat$/);
        expect(theme.credit).toBeTruthy();
      }
      expect(!!theme.animated).toBe(theme.category === "animated");
    }
    for (const id of ["porcelain-sky", "apricot-mist", "paper-arcs"]) expect(THEMES.find((theme) => theme.id === id)?.light).toBe(true);
    for (const id of ["carbon-night", "violet-horizon", "moss-pool", "rust-bloom", "pacific-ink", "garnet", "interference", "glass-blocks", "contour", "amber-ribbon", "lattice", "tide-pools"]) expect(THEMES.find((theme) => theme.id === id)?.light).not.toBe(true);
  });
});

describe("encoded image dimension guard", () => {
  for (const [name, header] of [["PNG", png], ["GIF", gif], ["JPEG", jpeg], ["progressive JPEG", (w: number, h: number) => jpeg(w, h, 0xc2)], ["WebP extended", webp], ["WebP lossy", (w: number, h: number) => webp(w, h, "VP8 ")], ["WebP lossless", (w: number, h: number) => webp(w, h, "VP8L")]] as const) {
    it(`reads ${name} headers and rejects excessive axes/pixels`, () => {
      expect(backgroundDimensions(header(6000, 3000))).toEqual({ width: 6000, height: 3000 });
      expect(backgroundDimensions(header(10000, 5000))).toEqual({ width: 10000, height: 5000 });
      for (const [w, h] of [[12001, 1], [1, 12001], [8000, 8000]]) expect(() => backgroundDimensions(header(w, h))).toThrow(/12000.*50 megapixels/);
    });
  }
  it("rejects truncated, empty and unknown headers without invoking a decoder", async () => {
    for (const bytes of [new ArrayBuffer(0), png(0, 100), png(100, 100).slice(0, 18), jpeg(100, 100).slice(0, 12), webp(100, 100).slice(0, 25)]) expect(() => backgroundDimensions(bytes)).toThrow(/dimensions/);
    const image = vi.fn(); vi.stubGlobal("Image", image);
    await expect(prepareBackground(new File([png(12001, 2)], "large.png", { type: "image/png" }))).rejects.toThrow(/12000/);
    await expect(prepareBackground(new File(["invalid"], "bad.png", { type: "image/png" }))).rejects.toThrow(/dimensions/);
    expect(image).not.toHaveBeenCalled();
  });
});

describe("saved image capacity", () => {
  const item = { id: "a", name: "A", size: 10 };
  it("enforces count, total bytes and free-storage reserve at their exact boundaries", () => {
    expect(backgroundCapacityError(Array(12).fill(item), 0)).toMatch(/12 backgrounds/);
    expect(backgroundCapacityError(Array(11).fill(item), 1)).toBeNull();
    expect(backgroundCapacityError([{ ...item, size: BACKGROUND_LIMITS.bytes - 1 }], 1)).toBeNull();
    expect(backgroundCapacityError([{ ...item, size: BACKGROUND_LIMITS.bytes }], 1)).toMatch(/60 MB/);
    expect(backgroundCapacityError([], 10, { quota: BACKGROUND_LIMITS.reserve + 110, usage: 100 })).toBeNull();
    expect(backgroundCapacityError([], 11, { quota: BACKGROUND_LIMITS.reserve + 110, usage: 100 })).toMatch(/20 MB/);
    expect(backgroundCapacityError([], 10, {})).toBeNull();
  });
  function processing(blob = new Blob(["resized"], { type: "image/webp" })) {
    const decode = vi.fn(async () => {});
    vi.stubGlobal("Image", class { naturalWidth = 100; naturalHeight = 100; decode = decode; });
    vi.stubGlobal("document", { createElement: () => ({ getContext: () => ({ drawImage() {} }), toBlob: (done: (blob: Blob) => void) => done(blob) }) });
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:test");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    return decode;
  }
  const file = () => new File([png(100, 100)], "photo.png", { type: "image/png" });
  it("counts legacy blobs, refuses a full library before decoding, and measures encoded output", async () => {
    await customBgs.ready;
    customBgs.set([{ id: "legacy-test", name: "Legacy" }]);
    await dbSet("custom-bg:legacy-test", new Blob(["legacy"]));
    processing();
    const bg = await saveCustomBackground(file());
    expect(bg).toMatchObject({ name: "photo", size: 7 });
    expect(customBgs.get()[0].size).toBe(6);
    expect((await dbGet<Blob>(`custom-bg:${bg.id}`))?.size).toBe(7);
    await dbDel(`custom-bg:${bg.id}`); await dbDel("custom-bg:legacy-test");
    const image = vi.fn(); vi.stubGlobal("Image", image);
    customBgs.set(Array.from({ length: 12 }, (_, i) => ({ id: `limit-${i}`, name: "Saved" })));
    await expect(saveCustomBackground(file())).rejects.toThrow(/12 backgrounds/);
    expect(image).not.toHaveBeenCalled();
    customBgs.set([]);
  });
  it("serializes concurrent uploads so neither can pass a stale count check", async () => {
    await customBgs.ready;
    customBgs.set(Array.from({ length: 11 }, (_, i) => ({ id: `concurrent-${i}`, name: "Saved", size: 0 })));
    processing();
    const results = await Promise.allSettled([saveCustomBackground(file()), saveCustomBackground(file())]);
    expect(results[0].status).toBe("fulfilled"); expect(results[1].status).toBe("rejected");
    expect(customBgs.get()).toHaveLength(12);
    if (results[0].status === "fulfilled") await dbDel(`custom-bg:${results[0].value.id}`);
    customBgs.set([]);
  });
  it("refuses low quota before decode and checks quota again against the saved size", async () => {
    await customBgs.ready; customBgs.set([]);
    const decode = processing();
    const estimate = vi.fn().mockResolvedValue({ quota: BACKGROUND_LIMITS.reserve - 1, usage: 0 });
    vi.stubGlobal("navigator", { storage: { estimate } });
    await expect(saveCustomBackground(file())).rejects.toThrow(/20 MB/);
    expect(decode).not.toHaveBeenCalled();
    estimate.mockResolvedValueOnce({ quota: BACKGROUND_LIMITS.reserve + 6, usage: 0 });
    estimate.mockResolvedValueOnce({ quota: BACKGROUND_LIMITS.reserve + 6, usage: 0 });
    await expect(saveCustomBackground(file())).rejects.toThrow(/20 MB/);
    expect(decode).toHaveBeenCalledOnce();
    expect(customBgs.get()).toHaveLength(0);
  });
  it("cleans up a failed blob write and leaves the library unchanged", async () => {
    await customBgs.ready; customBgs.set([]);
    processing();
    vi.spyOn(db, "dbSet").mockResolvedValueOnce();
    const remove = vi.spyOn(db, "dbDel");
    await expect(saveCustomBackground(file())).rejects.toThrow(/Could not save/);
    expect(remove).toHaveBeenCalledWith(expect.stringMatching(/^custom-bg:/));
    expect(customBgs.get()).toEqual([]);
  });
  it("measures existing blobs rather than trusting forged size metadata", async () => {
    await customBgs.ready;
    customBgs.set([{ id: "size-test", name: "Image", size: -9999 }]);
    await dbSet("custom-bg:size-test", new Blob([new Uint8Array(BACKGROUND_LIMITS.bytes)]));
    processing();
    await expect(saveCustomBackground(file())).rejects.toThrow(/60 MB/);
    expect(customBgs.get()[0].size).toBe(BACKGROUND_LIMITS.bytes);
    await dbDel("custom-bg:size-test"); customBgs.set([]);
  });
});
