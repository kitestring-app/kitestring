import { capParked, cleanThought, isParkedItem, INTERRUPTION_TAGS } from "../lib/parked";
import type { InterruptionTag, ParkedItem } from "../lib/parked";
import { createStore, uid } from "../lib/store";
import { addTask } from "./tasks";
import { notes } from "./notes";
import { settings } from "./settings";
export type { ParkedItem } from "../lib/parked";

export const parked = createStore<ParkedItem[]>("parked", [], value => capParked(Array.isArray(value) ?
  value.filter(isParkedItem).filter((item, i, all) => all.findIndex(other => other.id === item.id) === i) : []));

export function parkThought(text: string, context: Pick<ParkedItem, "segment" | "segId" | "taskId">): string | undefined {
  const clean = cleanThought(text);
  if (!clean || clean.length > 500) return;
  const item: ParkedItem = { id: uid(), text: clean, at: Date.now(), ...context, status: "open" };
  parked.set(all => capParked([...all, item]));
  return item.id;
}
export function finishThought(id: string) {
  parked.set(all => all.map(item => item.id === id && item.status === "open" ? { ...item, status: "done" } : item));
}

/** The returned undo restores only removed items, preserving newer edits and tasks. */
export function deleteThought(id: string): (() => void) | undefined {
  return removeThoughts(item => item.id === id);
}
export function clearDoneThoughts(): (() => void) | undefined {
  return removeThoughts(item => item.status !== "open");
}
function removeThoughts(matches: (item: ParkedItem) => boolean): (() => void) | undefined {
  const original = parked.get();
  const removed = original.filter(matches);
  if (!removed.length) return;
  const originalIds = new Set(original.map(item => item.id));
  parked.set(all => all.filter(item => !removed.some(old => old.id === item.id)));
  let undone = false;
  return () => {
    if (undone) return;
    undone = true;
    parked.set(all => {
      const restored = [...all];
      for (const item of removed) {
        if (restored.some(current => current.id === item.id)) continue;
        const following = new Set(original.slice(original.indexOf(item) + 1).map(next => next.id));
        const index = restored.findIndex(current => following.has(current.id));
        const firstNew = restored.findIndex(current => !originalIds.has(current.id));
        restored.splice(index < 0 ? (firstNew < 0 ? restored.length : firstNew) : index, 0, item);
      }
      return capParked(restored);
    });
  };
}
export function taskThought(id: string): string | undefined {
  const item = parked.get().find(item => item.id === id && item.status === "open");
  if (!item) return;
  const taskId = addTask({ title: item.text });
  parked.set(all => all.map(item => item.id === id ? { ...item, status: "tasked" } : item));
  return taskId;
}

/** End is exclusive: local midnight to the next local midnight also handles DST. */
export function getInterruptions(dayRange: { start?: number; end?: number; from?: number; to?: number } = {}): ParkedItem[] {
  const start = dayRange.start ?? dayRange.from ?? 0;
  const end = dayRange.end ?? dayRange.to ?? Infinity;
  return parked.get().filter(item => item.kind === "interruption" && item.at >= start && item.at < end);
}
export interface InterruptionContext { segId: string; taskId?: string; at: number }
export interface InterruptionPrompt extends InterruptionContext { id: string; expiresAt: number | null }
let prompt: InterruptionPrompt | null = null;
let timeout: ReturnType<typeof setTimeout> | undefined;
const promptListeners = new Set<() => void>();
function showPrompt(next: InterruptionPrompt | null) {
  clearTimeout(timeout);
  prompt = next;
  promptListeners.forEach(listener => listener());
}
export const interruptionPrompt = {
  get: () => prompt,
  subscribe: (listener: () => void) => { promptListeners.add(listener); return () => { promptListeners.delete(listener); }; },
};
export function dismissInterruption(id?: string) {
  if (!id || prompt?.id === id) showPrompt(null);
}
export function keepInterruption(id: string) {
  if (prompt?.id === id) showPrompt({ ...prompt, expiresAt: null });
}
export async function requestInterruption(context: InterruptionContext) {
  await notes.ready;
  if (!settings.get().timer.interruptionPrompt) return;
  const id = uid();
  showPrompt({ ...context, id, expiresAt: Date.now() + 8000 });
  timeout = setTimeout(() => dismissInterruption(id), 8000);
}
export function saveInterruption(id: string, tag: InterruptionTag, note: string): string | undefined {
  if (prompt?.id !== id || !INTERRUPTION_TAGS.includes(tag) || note.length > 500) return;
  const context = prompt;
  const text = cleanThought(note) || tag;
  const item: ParkedItem = { id: uid(), kind: "interruption", tag, text, segment: "focus", status: "open", segId: context.segId, taskId: context.taskId, at: context.at };
  if (!isParkedItem(item)) return;
  parked.set(all => capParked([...all, item]));
  dismissInterruption(id);
  return item.id;
}
// Turning the preference off also closes a prompt already on screen.
settings.subscribe(() => { if (!settings.get().timer.interruptionPrompt) dismissInterruption(); });

/** Hard-mode exits always leave a reason, independent of the optional pause prompt. */
export function recordHardInterruption(context: InterruptionContext & { segment: ParkedItem["segment"] }, reason: string) {
  const item: ParkedItem = { ...context, id: uid(), kind: "interruption", tag: "Hard mode: ended early", text: cleanThought(reason), status: "done" };
  parked.set(all => capParked([...all, item]));
}
