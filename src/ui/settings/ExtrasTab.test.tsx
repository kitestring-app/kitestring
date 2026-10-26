import { Children, isValidElement, type ReactElement, type ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS, settings, localPreferences, localPreferencesReady, localPreferencesUpdate } from "../../state/settings";
import { ExtrasTab } from "./ExtrasTab";
import { Toggle } from "./SettingsDrawer";

vi.mock("react", async original => ({
  ...await original<typeof import("react")>(),
  useSyncExternalStore: (_subscribe: unknown, get: () => unknown) => get(),
  useState: (initial: unknown) => [initial, vi.fn()],
  useEffect: vi.fn(),
}));
afterEach(() => { vi.unstubAllGlobals(); settings.set(DEFAULT_SETTINGS); });
type ToggleProps = Parameters<typeof Toggle>[0];
function elements(node: ReactNode): ReactElement<ToggleProps & { children?: ReactNode; disabled?: boolean }>[] {
  return Children.toArray(node).flatMap(child => isValidElement<ToggleProps & { children?: ReactNode }>(child) ? [child, ...elements(child.props.children)] : []);
}
it.each([true, false])("Mac menu bar visibility %s keeps the time preference but disables its input when hidden", async showMenuBar => {
  await localPreferencesReady;
  localPreferencesUpdate({ showMenuBar, menuBarTime: true });
  vi.stubGlobal("window", { desktop: { floatTimer: vi.fn() } });
  vi.stubGlobal("navigator", {});
  const controls = elements(ExtrasTab());
  const visibility = controls.find(el => el.props.title === "Show in menu bar")!;
  const time = controls.find(el => el.props.title === "Show time in menu bar")!;
  expect(visibility.props.checked).toBe(showMenuBar);
  expect(time.props.checked).toBe(true);
  expect(time.props.disabled).toBe(!showMenuBar);
  const input = elements(Toggle(time.props)).find(el => el.type === "input")!;
  expect(input.props.disabled).toBe(!showMenuBar);
  visibility.props.onChange(!showMenuBar);
  expect(localPreferences.get().showMenuBar).toBe(!showMenuBar);
});
it("web settings omit the Mac menu bar controls", () => {
  vi.stubGlobal("window", {});
  vi.stubGlobal("navigator", {});
  expect(elements(ExtrasTab()).some(el => el.props.title === "Show in menu bar" || el.props.title === "Show time in menu bar")).toBe(false);
});

it.each([undefined, { getSecureDns: vi.fn(), setSecureDns: vi.fn() }])("DNS options appear only with the Mac device bridge", desktop => {
  vi.stubGlobal("window", { desktop });
  vi.stubGlobal("navigator", {});
  expect(elements(ExtrasTab()).some(el => typeof el.type === "function" && el.type.name === "SecureDnsSettings")).toBe(!!desktop);
});

it("dims only a disabled switch, preserving its explanatory text", () => {
  const label = Toggle({ title: "Show time", help: "Still readable", checked: true, disabled: true, onChange: vi.fn() });
  expect(label.props.style).toBeUndefined();
  const input = elements(label).find(el => el.type === "input")!;
  expect((input.props as unknown as { style: object }).style).toEqual({ opacity: 0.5 });
});
