import "fake-indexeddb/auto";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import type { TimerState } from "../state/timerEngine";
import { INITIAL_TIMER } from "../state/timerEngine";
vi.mock("react", async original => ({ ...await original<typeof import("react")>(), useSyncExternalStore: (_s: unknown, get: () => unknown) => get() }));
const state = vi.hoisted(() => ({ current: {} as TimerState }));
vi.mock("../state/timer", () => ({ useTimerView: () => ({ state: state.current }) }));
vi.mock("./RecoveryCard", () => ({ RecoveryCard: () => null }));
import { FocusCardSlot } from "./FocusCardSlot";
it.each(["countdown end", "stopwatch finish", "Stop"])("N5 boundary link covers %s without running or fresh-idle prompts", name => {
  state.current = { ...INITIAL_TIMER, context: { actionId: "test", actionRevision: 1, action: "Study", why: "", taskTitle: "", spentMs: 1000 } };
  if (name === "countdown end") state.current.boundary = { id: "end", ended: "focus", at: 1, missed: false } as typeof state.current.boundary;
  const render = () => renderToStaticMarkup(<FocusCardSlot onChooseTask={() => {}} onRecall={() => {}} />);
  expect(render()).toContain("Explain from memory in Notes");
  state.current.startedAt = 1; expect(render()).not.toContain("Explain from memory in Notes");
  state.current = { ...INITIAL_TIMER }; expect(render()).not.toContain("Explain from memory in Notes");
});
