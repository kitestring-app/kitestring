/** One whole-document LWW value, including the optional cue and reward. */
export interface IntentDocument {
  action: string;
  why: string;
  cue?: string;
  reward?: string;
  rev: number;
  updatedAt: number;
}
export const EMPTY_INTENT: IntentDocument = { action: "", why: "", rev: 0, updatedAt: 0 };
export function isIntentDocument(value: unknown): value is IntentDocument {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  if (Object.keys(v).some(key => !["action", "why", "cue", "reward", "rev", "updatedAt"].includes(key))) return false;
  return typeof v.action === "string" && v.action.length <= 500 && !/[\r\n]/.test(v.action) &&
    typeof v.why === "string" && v.why.length <= 500 && !/[\r\n]/.test(v.why) &&
    [v.cue, v.reward].every(item => item === undefined || (typeof item === "string" && item.length <= 500 && !/[\r\n]/.test(item))) &&
    Number.isSafeInteger(v.rev) && (v.rev as number) >= 0 &&
    Number.isSafeInteger(v.updatedAt) && (v.updatedAt as number) >= 0;
}

/** Clients accept future fields, but only persist the fields this version understands. */
export function parseIntentDocument(value: unknown): IntentDocument | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const known = Object.fromEntries(["action", "why", "cue", "reward", "rev", "updatedAt"].filter(key => Object.hasOwn(raw, key)).map(key => [key, raw[key]]));
  return isIntentDocument(known) ? known : null;
}
