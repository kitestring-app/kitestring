import { Children, isValidElement, type ReactElement, type ReactNode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.hoisted(() => { vi.stubGlobal("navigator", {}); vi.stubGlobal("BroadcastChannel", undefined); });
vi.mock("react", async original => ({
  ...await original<typeof import("react")>(),
  useSyncExternalStore: (_subscribe: unknown, get: () => unknown) => get(),
  useState: (initial: unknown) => [initial, vi.fn()],
  useEffect: vi.fn(),
}));
vi.mock("../../audio/core", () => ({ cancelAllChimes: vi.fn(), previewChime: vi.fn() }));
import { DEFAULT_IDLE_NUDGE, idleNudge } from "../../state/idleNudge";
import { IdleNudgeCard } from "./IdleNudgeCard";
import { Toggle } from "./SettingsControls";

type Props = { children?: ReactNode; title?: string; id?: string; disabled?: boolean; value?: unknown; "aria-pressed"?: boolean; "aria-label"?: string;
  onChange?: (v: never) => void; onClick?: () => void; checked?: boolean; role?: string };
function elements(node: ReactNode): ReactElement<Props>[] {
  return Children.toArray(node).flatMap(child => {
    if (!isValidElement<Props>(child)) return [];
    const nested = child.type === Toggle ? Toggle(child.props as Parameters<typeof Toggle>[0]) : child.props.children;
    return [child, ...elements(nested)];
  });
}
const find = (id: string) => elements(IdleNudgeCard()).find(el => el.props.id === id)!;
beforeEach(async () => { await idleNudge.ready; idleNudge.set(DEFAULT_IDLE_NUDGE); });
afterEach(() => vi.unstubAllGlobals());

it("is off by default with every schedule control disabled", () => {
  vi.stubGlobal("window", {});
  const all = elements(IdleNudgeCard());
  const toggle = all.find(el => el.props.title === "Idle reminder")!;
  expect(toggle.props.checked).toBe(false);
  for (const id of ["nudge-every", "nudge-from", "nudge-to", "nudge-message"]) expect(find(id).props.disabled).toBe(true);
  expect(all.filter(el => el.props["aria-label"]?.endsWith("day")).every(el => el.props.disabled)).toBe(true);
});

it("switching on asks the browser once for notification permission", () => {
  const requestPermission = vi.fn(async () => "granted");
  const N = { permission: "default", requestPermission };
  vi.stubGlobal("window", { Notification: N });
  vi.stubGlobal("Notification", N);
  const toggle = elements(IdleNudgeCard()).find(el => el.props.title === "Idle reminder")!;
  (toggle.props.onChange as (v: boolean) => void)(true);
  expect(idleNudge.get().enabled).toBe(true);
  expect(requestPermission).toHaveBeenCalledOnce();
});

it("Mac app never asks for browser permission", () => {
  const requestPermission = vi.fn();
  vi.stubGlobal("window", { desktop: { nudge: vi.fn() }, Notification: { permission: "default", requestPermission } });
  vi.stubGlobal("Notification", { permission: "default", requestPermission });
  const toggle = elements(IdleNudgeCard()).find(el => el.props.title === "Idle reminder")!;
  (toggle.props.onChange as (v: boolean) => void)(true);
  expect(requestPermission).not.toHaveBeenCalled();
  expect(elements(IdleNudgeCard()).some(el => el.props.children === "Allow notifications")).toBe(false);
});

it("edits interval, hours, weekdays and message", () => {
  vi.stubGlobal("window", {});
  idleNudge.set({ ...DEFAULT_IDLE_NUDGE, enabled: true });
  (find("nudge-every").props.onChange as (e: unknown) => void)({ target: { value: "45" } });
  (find("nudge-from").props.onChange as (e: unknown) => void)({ target: { value: "08:30" } });
  (find("nudge-to").props.onChange as (e: unknown) => void)({ target: { value: "" } }); // cleared field keeps the old time
  (find("nudge-message").props.onChange as (e: unknown) => void)({ target: { value: "Open the draft" } });
  elements(IdleNudgeCard()).find(el => el.props["aria-label"] === "Saturday")!.props.onClick!();
  expect(idleNudge.get()).toEqual({ ...DEFAULT_IDLE_NUDGE, enabled: true, every: 45, from: "08:30", message: "Open the draft", days: [false, true, true, true, true, true, true] });
});
