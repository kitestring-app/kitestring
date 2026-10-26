import { Children, isValidElement, type ReactElement, type ReactNode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const hooks = vi.hoisted(() => ({ values: [] as unknown[], index: 0, locked: true }));
vi.mock("react", async original => ({ ...await original<typeof import("react")>(),
  useSyncExternalStore: (_subscribe: unknown, get: () => unknown) => get(),
  useRef: () => ({ current: null }),
  useState: (initial: unknown) => { const i = hooks.index++; if (!(i in hooks.values)) hooks.values[i] = initial; return [hooks.values[i], (value: unknown) => { hooks.values[i] = value; }]; },
}));
vi.mock("../../state/timer", () => ({ hardModeLocked: () => hooks.locked }));
vi.mock("../../lib/sync", () => ({ syncStatus: { subscribe: vi.fn(), get: () => ({ state: "off" }) }, metaAfterImport: vi.fn(), chooseInitialData: vi.fn(), openPasswordReset: vi.fn(), signIn: vi.fn(), signOut: vi.fn(), syncNow: vi.fn() }));
vi.mock("../../lib/db", () => ({ dbKeys: vi.fn().mockResolvedValue(["timer", "notes"]), dbDel: vi.fn() }));
vi.mock("../../lib/backup", () => ({ BACKUP_SECTIONS: ["settings", "sounds", "device", "focus", "images"], STORE_CLASS: { notes: { class: "content", section: "focus" } }, MAX_BACKUP_BYTES: 20_000_000, parseBackup: vi.fn(() => ({ version: 1, sections: ["focus"], data: { notes: "restored" } })), restoreBackup: vi.fn().mockResolvedValue(true), createBackup: vi.fn() }));
import { DataTab } from "./DataTab";
import { dbDel, dbKeys } from "../../lib/db";
import { restoreBackup } from "../../lib/backup";
type Props = { children?: ReactNode; [key: string]: any };
function elements(node: ReactNode): ReactElement<Props>[] { return Children.toArray(node).flatMap(child => isValidElement<Props>(child) ? [child, ...elements(child.props.children)] : []); }
const render = () => { hooks.index = 0; return elements(DataTab()); };
beforeEach(() => { hooks.values = []; hooks.locked = true; vi.clearAllMocks(); vi.useFakeTimers(); vi.stubGlobal("confirm", vi.fn(() => true)); vi.stubGlobal("location", { reload: vi.fn() }); });
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); });
it("blocks Delete all data before confirmation or storage access while locked", async () => {
  await render().find(el => el.props.children === "Delete all data")!.props.onClick();
  expect(confirm).not.toHaveBeenCalled(); expect(dbKeys).not.toHaveBeenCalled(); expect(dbDel).not.toHaveBeenCalled();
  expect(render().find(el => el.props.role === "status")!.props.children).toBe("End the Hard mode session first before deleting all data.");
});
it("reports that the running Hard mode block was kept after import", async () => {
  render().find(el => el.props.type === "file")!.props.onChange({ target: { files: [{ size: 12, text: async () => "backup" }] } });
  await vi.advanceTimersByTimeAsync(0);
  expect(restoreBackup).not.toHaveBeenCalled();
  await render().find(el => el.props.children === "Import selected sections")!.props.onClick();
  expect(restoreBackup).toHaveBeenCalledOnce();
  expect(render().find(el => el.props.role === "status")!.props.children).toContain("Your current timer block was kept");
  await vi.advanceTimersByTimeAsync(600); expect(location.reload).toHaveBeenCalledOnce();
});
it("rechecks the lock after reading deletion keys", async () => {
  hooks.locked = false;
  vi.mocked(dbKeys).mockImplementationOnce(async () => { hooks.locked = true; return ["timer"]; });
  render().find(el => el.props.children === "Delete all data")!.props.onClick(); await vi.advanceTimersByTimeAsync(0);
  expect(dbDel).not.toHaveBeenCalled(); expect(location.reload).not.toHaveBeenCalled();
});
