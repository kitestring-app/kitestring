import { createStore } from "../lib/store";

export interface TinyStarts { version: 1; finished: string[]; offer: "available" | "dismissed" | "accepted" }
export const EMPTY_TINY_STARTS: TinyStarts = { version: 1, finished: [], offer: "available" };
/** Only two completion identities are needed. Pauses, gaps and opens never touch this. */
export const tinyStarts = createStore<TinyStarts>("tinyStarts", EMPTY_TINY_STARTS, value => {
  const v = value as TinyStarts;
  return v?.version === 1 && Array.isArray(v.finished) && v.finished.length <= 2 &&
    v.finished.every(id => typeof id === "string" && id.length <= 64) && new Set(v.finished).size === v.finished.length &&
    ["available", "dismissed", "accepted"].includes(v.offer) ? v : { ...EMPTY_TINY_STARTS, finished: [] };
});
export function recordTinyFinish(segId: string) {
  tinyStarts.set(s => s.finished.length >= 2 || s.finished.includes(segId) ? s : { ...s, finished: [...s.finished, segId] });
}
export const longerOfferAvailable = () => tinyStarts.get().finished.length === 2 && tinyStarts.get().offer === "available";
export function settleLongerOffer(choice: "dismissed" | "accepted") {
  if (longerOfferAvailable()) tinyStarts.set(s => ({ ...s, offer: choice }));
}
