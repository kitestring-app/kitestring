import type { Segment } from "../state/timerEngine";

export const INTERRUPTION_TAGS = ["Phone", "Meeting", "Person", "Other"] as const;
export const HARD_MODE_END_TAG = "Hard mode: ended early";
export type InterruptionTag = (typeof INTERRUPTION_TAGS)[number];

export interface ParkedItem {
  kind?: "thought" | "interruption";
  tag?: InterruptionTag | typeof HARD_MODE_END_TAG;
  id: string;
  text: string;
  at: number;
  segment: Segment;
  segId?: string;
  taskId?: string;
  status: "open" | "done" | "tasked";
}
export const PARKED_LIMIT = 500;
export const cleanThought = (text: string) => text.replace(/[\u0000-\u001f\u007f-\u009f]/g, "").trim();
export function isParkedItem(value: unknown): value is ParkedItem {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  const id = (x: unknown) => typeof x === "string" && x.length > 0 && x.length <= 64;
  return id(v.id) && typeof v.text === "string" && v.text.length > 0 && v.text.length <= 500 && cleanThought(v.text) === v.text &&
    typeof v.at === "number" && Number.isFinite(v.at) && v.at >= 0 && v.at <= Date.UTC(2100, 0, 1) &&
    ["focus", "short", "long"].includes(v.segment as string) && ["open", "done", "tasked"].includes(v.status as string) &&
    (v.segId === undefined || id(v.segId)) && (v.taskId === undefined || id(v.taskId)) &&
    (v.kind === undefined || v.kind === "thought" || v.kind === "interruption") &&
    (v.kind === "interruption" ? (v.segment === "focus" || v.tag === "Hard mode: ended early") && id(v.segId) && (INTERRUPTION_TAGS.includes(v.tag as InterruptionTag) || v.tag === HARD_MODE_END_TAG) : v.tag === undefined);
}
/** Retain insertion order; evict the oldest done entries before any other items. */
export function capParked(items: ParkedItem[]): ParkedItem[] {
  if (items.length <= PARKED_LIMIT) return items;
  const evict = new Set([...items].sort((a, b) => Number(b.status === "done") - Number(a.status === "done") || a.at - b.at)
    .slice(0, items.length - PARKED_LIMIT).map(item => item.id));
  return items.filter(item => !evict.has(item.id));
}
