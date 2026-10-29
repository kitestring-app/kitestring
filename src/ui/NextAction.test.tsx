import "fake-indexeddb/auto";
import { Children, isValidElement } from "react";
import type { ReactElement, ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const hooks = vi.hoisted(() => ({ state: [] as unknown[], refs: [] as { current: unknown }[], effects: [] as (() => unknown)[], stateIndex: 0, refIndex: 0 }));
vi.mock("react", async original => ({ ...await original<typeof import("react")>(),
  useState: (initial: unknown) => {
    const i = hooks.stateIndex++;
    if (!(i in hooks.state)) hooks.state[i] = initial;
    return [hooks.state[i], (next: unknown) => { hooks.state[i] = typeof next === "function" ? next(hooks.state[i]) : next; }];
  },
  useRef: (value: unknown) => hooks.refs[hooks.refIndex++] ??= { current: value },
  useEffect: (effect: () => unknown) => hooks.effects.push(effect),
  useSyncExternalStore: (_s: unknown, get: () => unknown) => get() }));
import { NextAction } from "./NextAction";
import { intent, rewardMoment, updateIntent } from "../state/intent";
import { tasks, deleteTask } from "../state/tasks";
import { EMPTY_INTENT } from "../lib/intent";
beforeEach(async () => {
  await Promise.all([intent.ready, tasks.ready, rewardMoment.ready]); intent.set(EMPTY_INTENT); tasks.set([]); rewardMoment.set(null);
  hooks.state = []; hooks.refs = []; hooks.effects = []; vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
});
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });
type Props = { disabled?: boolean; value?: string; children?: ReactNode; onChange?: (event: { target: { value: string } }) => void; onClick?: () => unknown; ref?: { current: unknown } };
const elements = (node: ReactNode): ReactElement<Props>[] => Children.toArray(node).flatMap(child => isValidElement<Props>(child) ? [child, ...elements(child.props.children)] : []);
async function advance(ms: number) { await vi.advanceTimersByTimeAsync(ms); await (await import("../lib/store")).flushReadyStores(); }
function render() { hooks.stateIndex = hooks.refIndex = 0; hooks.effects = []; return NextAction(); }
async function click(text: string) { return elements(render()).find(el => el.type === "button" && el.props.children === text)!.props.onClick!(); }
function type(index: number, value: string) { elements(render()).filter(el => el.type === "input")[index].props.onChange!({ target: { value } }); }
it("picks a subtask as saved text, keeps the optional why and survives deleting the source", async () => {
  tasks.set([{ id: "parent", title: "Draft", done: false, createdAt: 1 }, { id: "child", parentId: "parent", title: "Open the document", done: false, createdAt: 1 }]);
  updateIntent({ why: "Share an outline" }); await click("Pin a next action");
  elements(render()).find(el => el.type === "select")!.props.onChange!({ target: { value: "child" } });
  await advance(400);
  expect(intent.get()).toMatchObject({ action: "Open the document", why: "Share an outline" });
  deleteTask("parent"); await click("Done");
  const html = renderToStaticMarkup(render()); expect(html).toContain("Open the document"); expect(html).toContain("Share an outline");
});
it("permits empty optional fields in a named accessible group", async () => {
  expect(renderToStaticMarkup(render())).toContain('role="group" aria-label="Pinned next action"');
  await click("Pin a next action"); const html = renderToStaticMarkup(render());
  expect(html).toContain("Next action (optional)"); expect(html).toContain("Why this matters (optional)");
  expect(html).not.toMatch(/required=/i);
  expect(html).toContain("If-then cue (optional)"); expect(html).toContain("Small reward for finishing this action (optional)");
});
it("debounces both fields into one revision and Done flushes pending edits", async () => {
  await click("Pin a next action"); type(0, "O"); await advance(200); type(0, "Open draft"); type(1, "Share it");
  await advance(399); expect(intent.get().rev).toBe(0);
  await advance(1); expect(intent.get()).toMatchObject({ action: "Open draft", why: "Share it", rev: 1 });
  type(0, "Final draft"); await click("Done");
  expect(intent.get()).toMatchObject({ action: "Final draft", rev: 2 });
  await advance(400); expect(intent.get().rev).toBe(2);
});
it("Edit focuses the input and Done returns focus to Edit", async () => {
  updateIntent({ action: "Draft" }); await click("Edit next action");
  const input = elements(render()).find(el => el.type === "input")!;
  const focusInput = vi.fn(); input.props.ref!.current = { focus: focusInput }; hooks.effects[0]();
  expect(focusInput).toHaveBeenCalledOnce();
  await click("Done"); const edit = elements(render()).find(el => el.type === "button")!;
  const focusEdit = vi.fn(); edit.props.ref!.current = { focus: focusEdit }; hooks.effects[0]();
  expect(focusEdit).toHaveBeenCalledOnce();
});
it("surfaces failed debounced and Done saves, keeps editing, and recovers after correction", async () => {
  await click("Pin a next action"); type(0, "first\nsecond");
  await advance(400);
  expect(renderToStaticMarkup(render())).toContain('role="alert"');
  await click("Done"); expect(renderToStaticMarkup(render())).toContain("Done"); expect(intent.get().rev).toBe(0);
  type(0, "One line"); await click("Done");
  expect(intent.get().action).toBe("One line"); expect(renderToStaticMarkup(render())).not.toContain('role="alert"');
});

it("saves cue and reward with the same action, shows the cue and displays a reward only on Finish action", async () => {
  await click("Pin a next action"); type(0, "Open draft"); type(2, "After lunch, open the draft"); type(3, "Tea outside"); await click("Done");
  expect(intent.get()).toMatchObject({ action: "Open draft", cue: "After lunch, open the draft", reward: "Tea outside", rev: 1 });
  expect(renderToStaticMarkup(render())).toContain("After lunch, open the draft");
  expect(renderToStaticMarkup(render())).not.toContain('aria-label="Your chosen reward"');
  await click("Finish action"); expect(intent.get().action).toBe("");
  expect(rewardMoment.get()).toMatchObject({ reward: "Tea outside" });
  expect(renderToStaticMarkup(render())).not.toContain("reward-moment");
});
it("keeps an unsaved cue draft separate from a remote replacement and lets the user reopen saved fields", async () => {
  updateIntent({ action: "First", cue: "First cue", reward: "Tea" }); await click("Edit next action");
  type(2, "My unsaved cue"); updateIntent({ action: "Remote action", cue: "Remote cue", reward: "Walk" });
  await advance(400); expect(renderToStaticMarkup(render())).toContain("My unsaved cue");
  expect(intent.get()).toMatchObject({ action: "Remote action", cue: "Remote cue", reward: "Walk" });
  expect(renderToStaticMarkup(render())).toContain("Your draft is kept");
  await click("Use saved action"); expect(renderToStaticMarkup(render())).not.toContain("My unsaved cue");
  expect(renderToStaticMarkup(render())).toContain("Remote cue");
});

it("clears a Finish conflict after the current action finishes successfully", async () => {
  updateIntent({ action: "Old action", reward: "Tea" });
  const staleFinish = elements(render()).find(el => el.type === "button" && el.props.children === "Finish action")!;
  updateIntent({ action: "Current action", reward: "Walk" });
  staleFinish.props.onClick!();
  expect(renderToStaticMarkup(render())).toContain("Your next action changed");
  await click("Finish action");
  expect(intent.get().action).toBe("");
  expect(rewardMoment.get()).toMatchObject({ reward: "Walk" });
  expect(renderToStaticMarkup(render())).not.toContain('role="alert"');
});

it("N1b: enough is a collapsed optional detail and Finish needs no proof", async () => {
  await click("Pin a next action");
  expect(renderToStaticMarkup(render())).toContain("Optional details");
  expect(renderToStaticMarkup(render())).toContain("Sufficient finish (optional)");
  expect(elements(render()).find(el => el.type === "details")!.props).not.toHaveProperty("open", true);
  updateIntent({ action: "Draft", sufficientFinish: "Three rough paragraphs" });
  await click("Done"); expect(renderToStaticMarkup(render())).toContain("Enough for this pass: Three rough paragraphs");
  await click("Finish action"); expect(intent.get().action).toBe("");
});

it("N1b review: a pending retry disables discard and ignores a stale discard callback", async () => {
  const db = await import("../lib/db"); const original = db.dbSetMany;
  updateIntent({ action: "Draft", sufficientFinish: "One paragraph" }); await (await import("../lib/store")).flushReadyStores();
  await click("Edit next action"); type(4, "Three paragraphs");
  const spy = vi.spyOn(db, "dbSetMany").mockRejectedValueOnce(new DOMException("Storage full", "QuotaExceededError"));
  await click("Done"); expect(renderToStaticMarkup(render())).toContain('role="alert"');
  let release!: () => void; let started!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; }); const entered = new Promise<void>(resolve => { started = resolve; });
  spy.mockImplementationOnce(async entries => { started(); await gate; await original(entries); });
  const retry = click("Done"); await entered;
  try {
    const discard = elements(render()).find(el => el.type === "button" && el.props.children === "Use saved action")!;
    expect(discard.props.disabled).toBe(true);
    discard.props.onClick!();
    expect(elements(render()).filter(el => el.type === "input")[4].props.value).toBe("Three paragraphs");
  } finally { release(); await retry; spy.mockRestore(); }
  expect(intent.get().sufficientFinish).toBe("Three paragraphs");
  expect(await db.dbGet("intent")).toEqual(intent.get());
});
