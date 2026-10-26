import { Children, isValidElement, type ReactElement, type ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { ALERT_SOUNDS } from "../../audio/alertSynth";
import { DEFAULT_SETTINGS, settings, sanitizeSettings, presetState, STRONG_PATCH } from "../../state/settings";
import { previewChime } from "../../audio/core";
import { testCompanion } from "../../audio/companion";
import { TimerTab } from "./TimerTab";

// Component tests use a single clock owner; follower delivery is covered separately.
vi.hoisted(() => { vi.stubGlobal("navigator", {}); });

vi.mock("react", async original => ({
  ...await original<typeof import("react")>(),
  useSyncExternalStore: (_subscribe: unknown, get: () => unknown) => get(),
  useState: (initial: unknown) => [initial === null ? true : initial, vi.fn()],
  useEffect: vi.fn(),
}));
vi.mock("../../audio/core", () => ({ previewChime: vi.fn() }));
vi.mock("../../audio/companion", () => ({ companionAvailable: vi.fn(), testCompanion: vi.fn().mockResolvedValue(true) }));
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

type Props = { children?: ReactNode; "aria-label"?: string; onClick?: () => void };
function elements(node: ReactNode): ReactElement<Props>[] {
  return Children.toArray(node).flatMap(child => isValidElement<Props>(child) ? [child, ...elements(child.props.children)] : []);
}

it.each(ALERT_SOUNDS)("the macOS test button uses the current %s selection", async (alertSound) => {
  await settings.ready;
  settings.set({ ...DEFAULT_SETTINGS, timer: { ...DEFAULT_SETTINGS.timer, focusDoneSound: alertSound, breakOverSound: alertSound, alertVolume: 0.35 } });
  vi.stubGlobal("window", {});
  const status = elements(TimerTab()).find(el => typeof el.type === "function" && el.type.name === "CompanionStatus")!;
  const tree = (status.type as (props: unknown) => ReactNode)(status.props);
  const button = elements(tree).find(el => el.type === "button" && el.props.children === "Test macOS alert")!;
  button.props.onClick!();
  expect(testCompanion).toHaveBeenCalledWith("break-over", 0.35, alertSound);
});

it("the two signature previews keep their phase and volume", async () => {
  await settings.ready;
  settings.set(DEFAULT_SETTINGS);
  const buttons = elements(TimerTab()).filter(el => el.type === "button");
  buttons.find(el => el.props["aria-label"] === "Preview focus done")!.props.onClick!();
  expect(previewChime).toHaveBeenLastCalledWith("signature", DEFAULT_SETTINGS.timer.alertVolume, "focus-done");
  buttons.find(el => el.props["aria-label"] === "Preview break over")!.props.onClick!();
  expect(previewChime).toHaveBeenLastCalledWith("signature", DEFAULT_SETTINGS.timer.alertVolume, "break-over");
});

it.each([false, true])("explains None and shows the notification settings hint only on Mac (%s)", async mac => {
  const { renderToStaticMarkup } = await import("react-dom/server");
  settings.set({ ...DEFAULT_SETTINGS, timer: { ...DEFAULT_SETTINGS.timer, focusDoneSound: "none", breakOverSound: "none" } });
  vi.stubGlobal("window", mac ? { desktop: {} } : {});
  let html = renderToStaticMarkup(<TimerTab />);
  expect(html).toContain("No sound will play when a segment ends.");
  expect(html.includes("macOS notifications follow System Settings &gt; Notifications &gt; Kitestring.")).toBe(mac);
  settings.set(DEFAULT_SETTINGS);
  html = renderToStaticMarkup(<TimerTab />);
  expect(html).not.toContain("No sound will play when a segment ends.");
});

it("keeps the legacy alertSound current and preserves None through an older-client round trip", async () => {
  await settings.ready; vi.stubGlobal("window", {}); settings.set(DEFAULT_SETTINGS);
  const choose = (label: string, value: string) => {
    const select = elements(TimerTab()).find(el => el.type === "select" && el.props["aria-label"] === label)!;
    (select.props as unknown as { onChange: (event: { target: { value: string } }) => void }).onChange({ target: { value } });
  };
  choose("Focus done", "wood");
  expect(settings.get().timer).toMatchObject({ focusDoneSound: "wood", breakOverSound: "signature", alertSound: "wood" });
  choose("Break over", "digital");
  expect(settings.get().timer.alertSound).toBe("wood");
  choose("Focus done", "none"); choose("Break over", "none");
  expect(settings.get().timer).toMatchObject({ focusDoneSound: "none", breakOverSound: "none", alertSound: "none" });
  const { focusDoneSound: _focus, breakOverSound: _break, ...legacy } = settings.get().timer;
  expect(sanitizeSettings({ timer: legacy }).timer).toMatchObject({ focusDoneSound: "none", breakOverSound: "none", alertSound: "none" });
});

it("2: Strong is hidden at defaults, available for Your setup, and explains the reset", async () => {
  await settings.ready; vi.stubGlobal("window", {});
  settings.set(DEFAULT_SETTINGS);
  presetState.set(state => ({ ...state, mode: "Strong", baseline: STRONG_PATCH }));
  expect(elements(TimerTab()).some(el => el.type === "button" && el.props.children === "Strong")).toBe(false);
  settings.set({ ...DEFAULT_SETTINGS, timer: { ...DEFAULT_SETTINGS.timer, speak: false } });
  presetState.set(state => ({ ...state, mode: "Your setup", baseline: { ...STRONG_PATCH, speak: false } }));
  const tree = TimerTab();
  expect(elements(tree).some(el => el.type === "h3" && el.props.children === "Your setup")).toBe(true);
  expect(elements(tree).some(el => el.type === "button" && el.props.children === "Strong")).toBe(true);
  expect(elements(tree).some(el => typeof el.props.children === "string" && el.props.children.includes("Resets reminders to defaults"))).toBe(true);
});

it("keeps parking review timing in Timer Settings with all three device-only choices", async () => {
  const { parkingReview, chooseReviewBoundary } = await import("../../state/parkingReview");
  await parkingReview.ready;
  chooseReviewBoundary("never");
  const select = elements(TimerTab()).find(el => el.type === "select" && el.props["aria-label"] === "Review parked thoughts")!;
  expect(select).toBeDefined();
  const options = elements(select.props.children).filter(el => el.type === "option");
  expect(options.map(o => o.props.children)).toEqual(["Never automatically", "End of block", "End of session"]);
  (select.props as unknown as { onChange: (e: { target: { value: string } }) => void }).onChange({ target: { value: "session" } });
  expect(parkingReview.get().boundary).toBe("session");
});
