import { Children, isValidElement } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS, LOOKS, settings } from "../state/settings";
import { Background, wallpaperIsLight } from "./Background";
import { LookBackdrop, PAPER_LOOKS } from "./Look";
vi.mock("react", async original => ({ ...await original<typeof import("react")>(), useEffect: vi.fn(), useState: () => [null, vi.fn()], useSyncExternalStore: (_s: unknown, get: () => unknown) => get() }));
vi.mock("./BackgroundMotion", () => ({ useBackgroundMotion: vi.fn() }));
afterEach(() => settings.set(DEFAULT_SETTINGS));
it.each(LOOKS)("renders the selected backdrop for %s with either flag", async look => {
  await settings.ready;
  for (const lookBackdrop of [true, false]) {
    settings.set({ ...DEFAULT_SETTINGS, appearance: { ...DEFAULT_SETTINGS.appearance, look, lookBackdrop } });
    const children = Children.toArray(Background().props.children).filter(isValidElement);
    expect(children.some(child => child.type === LookBackdrop)).toBe(lookBackdrop && PAPER_LOOKS.includes(look));
    expect(children.some(child => (child.props as { className?: string }).className?.startsWith("bg"))).toBe(!lookBackdrop || !PAPER_LOOKS.includes(look));
  }
});
it.each(PAPER_LOOKS)("reads the actual override rather than %s paper when choosing ink", look => {
  expect(wallpaperIsLight({ kind: "color", id: "#000000" }, "none", .5, look, false)).toBe(false);
  expect(wallpaperIsLight({ kind: "color", id: "#ffffff" }, "none", .5, look, false)).toBe(true);
});
