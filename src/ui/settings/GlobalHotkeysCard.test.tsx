import { Children, isValidElement, type ReactElement, type ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { globalHotkeys, DEFAULT_GLOBAL_HOTKEYS, recordHotkey } from "../../state/globalHotkeys";
import { GlobalHotkeysCard } from "./GlobalHotkeysCard";
import { ExtrasTab } from "./ExtrasTab";

vi.mock("react", async original => ({
  ...await original<typeof import("react")>(),
  useSyncExternalStore: (_subscribe: unknown, get: () => unknown) => get(),
  useState: (initial: unknown) => [initial, vi.fn()],
  useEffect: vi.fn(),
  useRef: () => ({ current: {} }),
}));
afterEach(() => { vi.unstubAllGlobals(); globalHotkeys.set(DEFAULT_GLOBAL_HOTKEYS); });
type Props = { children?: ReactNode; onClick?: () => void; "aria-label"?: string; className?: string };
function elements(node: ReactNode): ReactElement<Props>[] {
  return Children.toArray(node).flatMap(child => isValidElement<Props>(child) ? [child, ...elements(child.props.children)] : []);
}
const text = (node: ReactNode): string => Children.toArray(node).map(child => typeof child === "string" ? child : isValidElement<Props>(child) ? text(child.props.children) : "").join("");
const key = (code: string, mods: Partial<Record<"ctrlKey" | "altKey" | "shiftKey" | "metaKey", boolean>> = {}) =>
  ({ code, ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, ...mods });

it("starts with every shortcut off and no Clear buttons", () => {
  const tree = elements(GlobalHotkeysCard());
  const buttons = tree.filter(el => el.type === "button");
  expect(buttons.map(b => text(b.props.children))).toEqual(["Set shortcut", "Set shortcut", "Set shortcut", "Set shortcut"]);
  expect(text(GlobalHotkeysCard())).toContain("Start or pause");
});

it("shows a saved shortcut with symbols and clears it", () => {
  globalHotkeys.set({ ...DEFAULT_GLOBAL_HOTKEYS, toggle: "Control+Alt+Space" });
  const tree = elements(GlobalHotkeysCard());
  expect(text(GlobalHotkeysCard())).toContain("⌃⌥Space");
  const clear = tree.find(el => el.props["aria-label"] === "Clear Start or pause shortcut")!;
  clear.props.onClick!();
  expect(globalHotkeys.get().toggle).toBeNull();
});

it("recording accepts safe shortcuts and explains the rest", () => {
  const saved = { ...DEFAULT_GLOBAL_HOTKEYS, stop: "Control+Alt+S" };
  expect(recordHotkey(key("KeyT", { ctrlKey: true, altKey: true }), "toggle", saved)).toEqual({ kind: "set", accelerator: "Control+Alt+T" });
  expect(recordHotkey(key("ControlLeft", { ctrlKey: true }), "toggle", saved)).toEqual({ kind: "wait" });
  expect(recordHotkey(key("Escape"), "toggle", saved)).toEqual({ kind: "cancel" });
  expect(recordHotkey(key("KeyT", { metaKey: true }), "toggle", saved)).toMatchObject({ kind: "hint" });
  expect(recordHotkey(key("KeyP", { altKey: true, metaKey: true }), "toggle", saved)).toMatchObject({ kind: "hint", hint: expect.stringContaining("⌥⌘P") });
  expect(recordHotkey(key("KeyS", { ctrlKey: true, altKey: true }), "toggle", saved)).toMatchObject({ kind: "hint", hint: expect.stringContaining("Stop") });
  expect(recordHotkey(key("KeyS", { ctrlKey: true, altKey: true }), "stop", saved)).toEqual({ kind: "set", accelerator: "Control+Alt+S" });
});

it("Extras shows the card only in the Mac app", () => {
  vi.stubGlobal("navigator", {});
  for (const [win, shown] of [[{}, false], [{ desktop: { setGlobalHotkeys: vi.fn() } }, true]] as const) {
    vi.stubGlobal("window", win);
    expect(elements(ExtrasTab()).some(el => el.type === GlobalHotkeysCard)).toBe(shown);
  }
});
