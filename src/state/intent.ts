import { purposefulAction } from "./returnActivity";
import { createStore, registerPersistenceGroup } from "../lib/store";
import { EMPTY_INTENT, isIntentDocument, parseIntentDocument } from "../lib/intent";
import type { IntentDocument } from "../lib/intent";

export const intent = createStore<IntentDocument>("intent", EMPTY_INTENT, value => {
  return parseIntentDocument(value) ?? { ...EMPTY_INTENT };
});
export function updateIntent(patch: Partial<Pick<IntentDocument, "action" | "why" | "cue" | "reward" | "sufficientFinish">>, expected?: Pick<IntentDocument, "rev" | "updatedAt">) {
  intent.set(previous => {
    if (expected && (previous.rev !== expected.rev || previous.updatedAt !== expected.updatedAt)) throw new Error("Your next action changed elsewhere. Your draft is kept. Reopen the editor to use the saved action.");
    const next = { ...previous, ...(patch.action !== undefined && patch.action !== previous.action ? { sufficientFinish: "" } : {}), ...patch, rev: previous.rev + 1, updatedAt: Math.max(Date.now(), previous.updatedAt + 1) };
    if (!isIntentDocument(next)) throw new Error("Use a single line of up to 500 characters.");
    return next;
  });
  purposefulAction();
}

interface RewardMoment { id: string; action: string; reward: string }
/** Acknowledgement belongs to this device, never to the synced intent. */
export const rewardMoment = createStore<RewardMoment | null>("rewardMoment", null, value => {
  const v = value as RewardMoment | null;
  return v && [v.id, v.action, v.reward].every(s => typeof s === "string" && s.length <= 500 && !/[\r\n]/.test(s)) ? v : null;
});
registerPersistenceGroup(["intent", "rewardMoment"]);
export function finishIntent(expected: Pick<IntentDocument, "rev" | "updatedAt">): boolean {
  const pin = intent.get();
  if (!pin.action.trim() || pin.rev !== expected.rev || pin.updatedAt !== expected.updatedAt) return false;
  // Finishing an action is explicit. A timer ending never grants or removes a reward.
  rewardMoment.set(pin.reward?.trim() ? { id: `${pin.updatedAt}:${pin.rev}`, action: pin.action, reward: pin.reward } : null);
  updateIntent({ action: "", why: "", cue: undefined, reward: undefined, sufficientFinish: "" }, expected);
  return true;
}
export function dismissReward(id: string) {
  if (rewardMoment.get()?.id === id) rewardMoment.set(null);
}
