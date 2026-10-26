import { afterEach, describe, expect, it, vi } from "vitest";
import { customBgs, fitBackgroundSize, prepareBackground, removeCustomBackground, validateBackgroundFile } from "../../data/themes";
import { QUOTE_CATEGORIES, QUOTES, quoteForDay } from "../../data/quotes";
import { dbGet, dbSet } from "../../lib/db";
import { DEFAULT_SETTINGS, settings } from "../../state/settings";
import { findTheme, THEMES, THEME_CATEGORIES } from "../../data/themes";

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("custom image processing", () => {
  it("accepts only the four supported formats at or below the size limit", () => {
    for (const type of ["image/jpeg", "image/png", "image/webp", "image/gif"]) {
      expect(validateBackgroundFile({ type, size: 15 * 1024 * 1024 })).toBeNull();
    }
    expect(validateBackgroundFile({ type: "image/png", size: 15 * 1024 * 1024 + 1 })).toMatch(/15 MB/);
    expect(validateBackgroundFile({ type: "image/svg+xml", size: 50 })).toMatch(/JPG/);
    expect(validateBackgroundFile({ type: "image/png", size: 0 })).toMatch(/empty/);
  });

  it("preserves aspect ratio, never enlarges, and handles portrait and extreme sizes", () => {
    expect(fitBackgroundSize(6000, 3000)).toEqual({ width: 2560, height: 1280 });
    expect(fitBackgroundSize(3000, 6000)).toEqual({ width: 1280, height: 2560 });
    expect(fitBackgroundSize(1200, 800)).toEqual({ width: 1200, height: 800 });
    expect(fitBackgroundSize(1, 10000)).toEqual({ width: 1, height: 2560 });
    for (const size of [0, -1, NaN, Infinity]) expect(() => fitBackgroundSize(size, 20)).toThrow(/dimensions/);
  });

  it("deletes the Blob and metadata, resets every affected mode, and preserves other uploads", async () => {
    await Promise.all([customBgs.ready, settings.ready]);
    const a = { id: "delete-test-a", name: "A" };
    const b = { id: "keep-test-b", name: "B" };
    const beforeSettings = settings.get();
    const beforeCustom = customBgs.get();
    try {
      customBgs.set([a, b]);
      settings.set({ ...DEFAULT_SETTINGS, themes: {
        home: { kind: "custom", id: a.id }, focus: { kind: "custom", id: a.id }, ambient: { kind: "custom", id: b.id },
      } });
      await dbSet(`custom-bg:${a.id}`, new Blob(["a"]));
      await dbSet(`custom-bg:${b.id}`, new Blob(["b"]));
      await removeCustomBackground(a.id);
      expect(await dbGet(`custom-bg:${a.id}`)).toBeUndefined();
      expect(await dbGet(`custom-bg:${b.id}`)).toBeInstanceOf(Blob);
      expect(customBgs.get()).toEqual([b]);
      expect(settings.get().themes).toEqual({
        home: { kind: "library", id: "dusk-glass" }, focus: { kind: "library", id: "dusk-glass" }, ambient: { kind: "custom", id: b.id },
      });
      await removeCustomBackground(b.id);
    } finally { settings.set(beforeSettings); customBgs.set(beforeCustom); }
  });

  function imageFile(name = "image.png", type = "image/png") {
    const header = new Uint8Array(24);
    header.set([137, 80, 78, 71, 13, 10, 26, 10]);
    header.set([73, 72, 68, 82], 12);
    const view = new DataView(header.buffer);
    view.setUint32(16, 6000); view.setUint32(20, 3000);
    return new File([header], name, { type });
  }

  function mockCanvas(blob: Blob | null = new Blob(["processed"], { type: "image/webp" })) {
    const drawImage = vi.fn();
    const canvas = { width: 0, height: 0, getContext: vi.fn(() => ({ drawImage })), toBlob: vi.fn((callback: (b: Blob | null) => void) => callback(blob)) };
    vi.stubGlobal("document", { createElement: vi.fn(() => canvas) });
    vi.stubGlobal("Image", class { src = ""; naturalWidth = 6000; naturalHeight = 3000; decode = vi.fn().mockResolvedValue(undefined); });
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:test");
    const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    return { canvas, drawImage, revoke };
  }

  it("draws at the bounded size, encodes a Blob, and releases the temporary URL", async () => {
    const { canvas, drawImage, revoke } = mockCanvas();
    const output = await prepareBackground(imageFile("background.gif", "image/gif"));
    expect(output.type).toBe("image/webp");
    expect(canvas.width).toBe(2560);
    expect(canvas.height).toBe(1280);
    expect(drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, 2560, 1280);
    expect(canvas.toBlob).toHaveBeenCalledWith(expect.any(Function), "image/webp", 0.9);
    expect(revoke).toHaveBeenCalledWith("blob:test");
  });

  it("rejects failed decoding and still releases the temporary URL", async () => {
    const { revoke } = mockCanvas();
    vi.stubGlobal("Image", class { src = ""; decode = vi.fn().mockRejectedValue(new Error("Unreadable image")); });
    await expect(prepareBackground(imageFile())).rejects.toThrow("Unreadable image");
    expect(revoke).toHaveBeenCalledWith("blob:test");
  });

  it("rejects a failed canvas encoding instead of saving an empty image", async () => {
    const { revoke } = mockCanvas(null);
    await expect(prepareBackground(imageFile())).rejects.toThrow(/resize/);
    expect(revoke).toHaveBeenCalledOnce();
  });
});

describe("daily quote selection", () => {
  it("matches the dashboard's local-day selection and is stable on the same day", () => {
    const date = new Date(2026, 9, 24, 1);
    const seed = date.getFullYear() * 400 + date.getMonth() * 31 + date.getDate();
    expect(quoteForDay("all", date)).toBe(QUOTES[seed % QUOTES.length]);
    expect(quoteForDay("all", date)).toBe(quoteForDay("all", new Date(2026, 9, 24, 23)));
  });
  it("filters categories, cycles previews, and handles an unknown category", () => {
    const date = new Date(2026, 9, 24);
    const count = QUOTES.filter((q) => q.category === "calm").length;
    expect(quoteForDay("calm", date)?.category).toBe("calm");
    expect(quoteForDay("calm", date, 1)).not.toBe(quoteForDay("calm", date));
    expect(quoteForDay("calm", date, count)).toBe(quoteForDay("calm", date));
    expect(quoteForDay("missing", date)).toBeNull();
  });
  it("includes 120 unique, attributed, short excerpts and 20 per category", () => {
    expect(QUOTES).toHaveLength(120);
    expect(new Set(QUOTES.map((q) => q.text)).size).toBe(120);
    for (const q of QUOTES) {
      expect(q.author).toBeTruthy(); expect(q.source).toBeTruthy();
      expect(q.text.length).toBeLessThan(180);
    }
    for (const c of QUOTE_CATEGORIES.filter((c) => c.id !== "all")) expect(QUOTES.filter((q) => q.category === c.id)).toHaveLength(20);
  });
});

describe("theme catalog compatibility", () => {
  it("keeps the original IDs and provides 96 unique entries across all categories", () => {
    expect(THEMES).toHaveLength(96);
    expect(new Set(THEMES.map((t) => t.id)).size).toBe(96);
    for (const id of ["dusk-glass", "thermal", "cotton", "autumn", "midnight", "forest-dusk", "blue-flare", "pink-flare", "aurora", "lava"]) expect(findTheme(id)).toBeTruthy();
    expect(THEMES.filter((t) => t.animated)).toHaveLength(7);
    expect(THEMES.filter((t) => t.credit)).toHaveLength(53);
    for (const c of THEME_CATEGORIES) expect(THEMES.some((t) => t.category === c.id)).toBe(true);
  });
});
