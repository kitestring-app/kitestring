import { canWriteClockStore, createStore, registerPersistenceGroup, uid } from "../lib/store";
import { deleteThought, parked, taskThought } from "./parked";
import { purposefulAction } from "./returnActivity";

export type ReviewBoundary = "block" | "session" | "never";
interface Review { id: string; itemIds: string[]; cursor: number }
export interface ParkingReviewState { version: 1; boundary: ReviewBoundary; lastBoundary: string | null; review: Review | null; deferred: boolean }
export const EMPTY_PARKING_REVIEW: ParkingReviewState = { version: 1, boundary: "never", lastBoundary: null, review: null, deferred: false };
const validId = (s: unknown) => typeof s === "string" && s.length > 0 && s.length <= 100;
export const parkingReview = createStore<ParkingReviewState>("parkingReview", EMPTY_PARKING_REVIEW, value => {
  const v = value as ParkingReviewState, r = v?.review;
  return v?.version === 1 && ["block", "session", "never"].includes(v.boundary) && typeof v.deferred === "boolean" &&
    (v.lastBoundary === null || validId(v.lastBoundary)) && (r === null || (r && validId(r.id) && Array.isArray(r.itemIds) &&
      r.itemIds.length <= 500 && r.itemIds.every(validId) && new Set(r.itemIds).size === r.itemIds.length &&
      Number.isSafeInteger(r.cursor) && r.cursor >= 0 && r.cursor <= r.itemIds.length)) ? v : { ...EMPTY_PARKING_REVIEW };
});
// Task creation, parked status and checkpoint cannot be committed independently.
registerPersistenceGroup(["parkingReview", "parked", "tasks"]);
let ownsReview = () => canWriteClockStore("parkingReview");
let forwardReview: (choice: "open" | ReviewBoundary) => void = () => {};
export function registerReviewOwner(owns: () => boolean, forward: (choice: "open" | ReviewBoundary) => void) {
  ownsReview = owns;
  forwardReview = forward;
}
export function chooseReviewBoundary(boundary: ReviewBoundary) {
  if (!ownsReview()) { forwardReview(boundary); return; }
  parkingReview.set(s => ({ ...s, boundary, deferred: boundary === "never" || s.deferred }));
}
export function openParkingReview() {
  if (!ownsReview()) { forwardReview("open"); return; }
  parkingReview.set(s => {
    const ids = parked.get().filter(item => item.status === "open").map(item => item.id);
    return { ...s, deferred: false, review: s.review ?? (ids.length ? { id: uid(), itemIds: ids, cursor: 0 } : null) };
  });
}
export function queueParkingReview(boundary: Exclude<ReviewBoundary, "never">, token: string) {
  if (!canWriteClockStore("parkingReview", true)) return;
  const s = parkingReview.get(), id = `${boundary}:${token}`;
  if (s.boundary !== boundary || s.lastBoundary === id) return;
  parkingReview.set({ ...s, lastBoundary: id });
  openParkingReview();
}
export function currentReviewItem() {
  const r = parkingReview.get().review;
  if (!r) return undefined;
  const items = parked.get();
  return r.itemIds.slice(r.cursor).map(id => items.find(item => item.id === id && item.status === "open")).find(Boolean);
}
export function deferParkingReview(reviewId: string) {
  parkingReview.set(s => s.review?.id === reviewId ? { ...s, deferred: true } : s);
}
export function closeParkingReview(reviewId: string) {
  parkingReview.set(s => s.review?.id === reviewId ? { ...s, review: null } : s);
}
export function answerParkingReview(reviewId: string, itemId: string, choice: "keep" | "task" | "drop"): { ok: boolean; undo?: () => void } {
  if (!canWriteClockStore("parkingReview", true)) return { ok: false };
  const s = parkingReview.get(), r = s.review, item = currentReviewItem();
  if (!r || r.id !== reviewId || s.deferred || !item || item.id !== itemId) return { ok: false };
  let undo: (() => void) | undefined;
  if (choice === "task" && !taskThought(item.id)) return { ok: false };
  if (choice === "drop") undo = deleteThought(item.id);
  const cursor = r.itemIds.indexOf(item.id) + 1;
  const remaining = r.itemIds.slice(cursor).some(id => parked.get().some(p => p.id === id && p.status === "open"));
  parkingReview.set({ ...s, review: remaining ? { ...r, cursor } : null });
  purposefulAction();
  return { ok: true, undo };
}
