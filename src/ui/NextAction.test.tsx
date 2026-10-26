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
  hooks.state = []; hooks.refs = []; hooks.effects = []; vi.useFakeTimers();
});
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });
type Props = { children?: ReactNode; onChange?: (event: { target: { value: string } }) => void; onClick?: () => void; ref?: { current: unknown } };
const elements = (node: ReactNode): ReactElement<Props>[] => Children.toArray(node).flatMap(child => isValidElement<Props>(child) ? [child, ...elements(child.props.children)] : []);
function render() { hooks.stateIndex = hooks.refIndex = 0; hooks.effects = []; return NextAction(); }
function click(text: string) { elements(render()).find(el => el.type === "button" && el.props.children === text)!.props.onClick!(); }
function type(index: number, value: string) { elements(render()).filter(el => el.type === "input")[index].props.onChange!({ target: { value } }); }
it("picks a subtask as saved text, keeps the optional why and survives deleting the source", () => {
  tasks.set([{ id: "parent", title: "Draft", done: false, createdAt: 1 }, { id: "child", parentId: "parent", title: "Open the document", done: false, createdAt: 1 }]);
  updateIntent({ why: "Share an outline" }); click("Pin a next action");
  elements(render()).find(el => el.type === "select")!.props.onChange!({ target: { value: "child" } });
  vi.advanceTimersByTime(400);
  expect(intent.get()).toMatchObject({ action: "Open the document", why: "Share an outline" });
  deleteTask("parent"); click("Done");
  const html = renderToStaticMarkup(render()); expect(html).toContain("Open the document"); expect(html).toContain("Share an outline");
});
it("permits empty optional fields in a named accessible group", () => {
  expect(renderToStaticMarkup(render())).toContain('role="group" aria-label="Pinned next action"');
  click("Pin a next action"); const html = renderToStaticMarkup(render());
  expect(html).toContain("Next action (optional)"); expect(html).toContain("Why this matters (optional)");
  expect(html).not.toMatch(/required=/i);
  expect(html).toContain("If-then cue (optional)"); expect(html).toContain("Small reward for finishing this action (optional)");
});
it("debounces both fields into one revision and Done flushes pending edits", () => {
  click("Pin a next action"); type(0, "O"); vi.advanceTimersByTime(200); type(0, "Open draft"); type(1, "Share it");
  vi.advanceTimersByTime(399); expect(intent.get().rev).toBe(0);
  vi.advanceTimersByTime(1); expect(intent.get()).toMatchObject({ action: "Open draft", why: "Share it", rev: 1 });
  type(0, "Final draft"); click("Done");
  expect(intent.get()).toMatchObject({ action: "Final draft", rev: 2 });
  vi.advanceTimersByTime(400); expect(intent.get().rev).toBe(2);
});
it("Edit focuses the input and Done returns focus to Edit", () => {
  updateIntent({ action: "Draft" }); click("Edit next action");
  const input = elements(render()).find(el => el.type === "input")!;
  const focusInput = vi.fn(); input.props.ref!.current = { focus: focusInput }; hooks.effects[0]();
  expect(focusInput).toHaveBeenCalledOnce();
  click("Done"); const edit = elements(render()).find(el => el.type === "button")!;
  const focusEdit = vi.fn(); edit.props.ref!.current = { focus: focusEdit }; hooks.effects[0]();
  expect(focusEdit).toHaveBeenCalledOnce();
});
it("surfaces failed debounced and Done saves, keeps editing, and recovers after correction", () => {
  click("Pin a next action"); type(0, "first\nsecond");
  expect(() => vi.advanceTimersByTime(400)).not.toThrow();
  expect(renderToStaticMarkup(render())).toContain('role="alert"');
  click("Done"); expect(renderToStaticMarkup(render())).toContain("Done"); expect(intent.get().rev).toBe(0);
  type(0, "One line"); click("Done");
  expect(intent.get().action).toBe("One line"); expect(renderToStaticMarkup(render())).not.toContain('role="alert"');
});

it("saves cue and reward with the same action, shows the cue and displays a reward only on Finish action", () => {
  click("Pin a next action"); type(0, "Open draft"); type(2, "After lunch, open the draft"); type(3, "Tea outside"); click("Done");
  expect(intent.get()).toMatchObject({ action: "Open draft", cue: "After lunch, open the draft", reward: "Tea outside", rev: 1 });
  expect(renderToStaticMarkup(render())).toContain("After lunch, open the draft");
  expect(renderToStaticMarkup(render())).not.toContain('aria-label="Your chosen reward"');
  click("Finish action"); expect(intent.get().action).toBe("");
  expect(rewardMoment.get()).toMatchObject({ reward: "Tea outside" });
  expect(renderToStaticMarkup(render())).not.toContain("reward-moment");
});
it("keeps an unsaved cue draft separate from a remote replacement and lets the user reopen saved fields", () => {
  updateIntent({ action: "First", cue: "First cue", reward: "Tea" }); click("Edit next action");
  type(2, "My unsaved cue"); updateIntent({ action: "Remote action", cue: "Remote cue", reward: "Walk" });
  vi.advanceTimersByTime(400); expect(renderToStaticMarkup(render())).toContain("My unsaved cue");
  expect(intent.get()).toMatchObject({ action: "Remote action", cue: "Remote cue", reward: "Walk" });
  expect(renderToStaticMarkup(render())).toContain("Your draft is kept");
  click("Use saved action"); expect(renderToStaticMarkup(render())).not.toContain("My unsaved cue");
  expect(renderToStaticMarkup(render())).toContain("Remote cue");
});

it("clears a Finish conflict after the current action finishes successfully", () => {
  updateIntent({ action: "Old action", reward: "Tea" });
  const staleFinish = elements(render()).find(el => el.type === "button" && el.props.children === "Finish action")!;
  updateIntent({ action: "Current action", reward: "Walk" });
  staleFinish.props.onClick!();
  expect(renderToStaticMarkup(render())).toContain("Your next action changed");
  click("Finish action");
  expect(intent.get().action).toBe("");
  expect(rewardMoment.get()).toMatchObject({ reward: "Walk" });
  expect(renderToStaticMarkup(render())).not.toContain('role="alert"');
});
