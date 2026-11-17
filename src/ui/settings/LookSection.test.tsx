import { afterEach, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS, settings } from "../../state/settings";
import { pickLook } from "./LookSection";

vi.mock("./ClockTab", () => ({ applyFont: vi.fn() }));

vi.hoisted(() => { vi.stubGlobal("navigator", {}); });

vi.mock("react", async original => ({
  ...await original<typeof import("react")>(),
  useSyncExternalStore: (_subscribe: unknown, get: () => unknown) => get(),
  useState: (initial: unknown) => [initial, vi.fn()],
  useEffect: vi.fn(),
}));

afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); settings.set(DEFAULT_SETTINGS); });

it("chessboard pick sets clock style and chess tally only from defaults", async () => {
  await settings.ready;
  settings.set({ ...DEFAULT_SETTINGS, timer: { ...DEFAULT_SETTINGS.timer, style: "default", tally: "dots" } });
  vi.stubGlobal("window", {});
  pickLook("chessboard");
  expect(settings.get().appearance.look).toBe("chessboard");
  expect(settings.get().timer.style).toBe("clock");
  expect(settings.get().timer.tally).toBe("chess");
});

it("preserves explicit style/tally choices when picking chessboard", async () => {
  await settings.ready;
  settings.set({ ...DEFAULT_SETTINGS, timer: { ...DEFAULT_SETTINGS.timer, style: "flip", tally: "star" } });
  vi.stubGlobal("window", {});
  pickLook("chessboard");
  expect(settings.get().timer.style).toBe("flip");
  expect(settings.get().timer.tally).toBe("star");
});

it("sweet-tape pick sets tape style only from default", async () => {
  await settings.ready;
  settings.set({ ...DEFAULT_SETTINGS, timer: { ...DEFAULT_SETTINGS.timer, style: "default" } });
  vi.stubGlobal("window", {});
  pickLook("sweet-tape");
  expect(settings.get().appearance.look).toBe("sweet-tape");
  expect(settings.get().timer.style).toBe("tape");
});

it("preserves explicit style when picking sweet-tape", async () => {
  await settings.ready;
  settings.set({ ...DEFAULT_SETTINGS, timer: { ...DEFAULT_SETTINGS.timer, style: "gauge" } });
  vi.stubGlobal("window", {});
  pickLook("sweet-tape");
  expect(settings.get().timer.style).toBe("gauge");
});