import { storageMode } from "../lib/db";
import { purposefulAction } from "./returnActivity";
import { createStore, registerPersistenceGroup, commitStoreEntries, storeReadFailed } from "../lib/store";
import { EMPTY_INTENT, isIntentDocument, parseIntentDocument } from "../lib/intent";
import type { IntentDocument } from "../lib/intent";

export const intent = createStore<IntentDocument>("intent", EMPTY_INTENT, value => {
  return parseIntentDocument(value) ?? { ...EMPTY_INTENT };
});
type IntentPatch = Partial<Pick<IntentDocument, "action" | "why" | "cue" | "reward" | "sufficientFinish" | "portion">>;
type IntentRevision = Pick<IntentDocument, "rev" | "updatedAt">;
function nextIntent(previous: IntentDocument, patch: IntentPatch, expected?: IntentRevision): IntentDocument {
  if (expected && (previous.rev !== expected.rev || previous.updatedAt !== expected.updatedAt)) throw new Error("Your next action changed elsewhere. Your draft is kept. Reopen the editor to use the saved action.");
  const next = { ...previous, ...(patch.action !== undefined && patch.action !== previous.action ? { sufficientFinish: "", portion: "" } : {}), ...patch,
    rev: previous.rev + 1, updatedAt: Math.max(Date.now(), previous.updatedAt + 1) };
  if (!isIntentDocument(next)) throw new Error("Use a single line of up to 500 characters.");
  return next;
}
export function updateIntent(patch: IntentPatch, expected?: IntentRevision) {
  intent.set(previous => nextIntent(previous, patch, expected));
  purposefulAction();
}
/** Editors retain their draft until the guarded transaction commits. */
export async function saveIntent(patch: IntentPatch, expected: IntentRevision): Promise<void> {
  await intent.ready;
  if (storageMode() !== "indexeddb" || storeReadFailed("intent")) throw new Error("Storage is unavailable. Your draft is kept. Reload to retry.");
  const saved = await commitStoreEntries(() => [["intent", nextIntent(intent.get(), patch, expected)]]);
  if (!saved) throw new Error("Your next action changed while saving. Your draft is kept. Reopen the editor to use the saved action.");
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
  updateIntent({ action: "", why: "", cue: undefined, reward: undefined, sufficientFinish: "", portion: "" }, expected);
  return true;
}
export function dismissReward(id: string) {
  if (rewardMoment.get()?.id === id) rewardMoment.set(null);
}
