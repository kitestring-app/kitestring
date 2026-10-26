/** Keep the stored and synced value readable by builds with plain-text notes. */
export type NotesValue = string;
export const EMPTY_NOTES = "";
export const NOTES_LIMIT = 1_000_000;
export function isNotesValue(value: unknown, maxLength = NOTES_LIMIT): value is NotesValue {
  return typeof value === "string" && value.length <= maxLength;
}

function recoveredText(value: unknown): string | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return;
  const text = (value as Record<string, unknown>).text;
  if (isNotesValue(text)) return text;
}

export function notesInterruptionPreference(value: unknown): boolean | undefined {
  if (recoveredText(value) === undefined) return;
  const flag = (value as Record<string, unknown>).interruptionPrompt;
  return typeof flag === "boolean" ? flag : undefined;
}

export function migrateNotes(value: unknown): NotesValue {
  // Original local notes had no length limit. Never truncate or blank a string.
  if (typeof value === "string") return value;
  const text = recoveredText(value);
  if (text !== undefined) return text;
  throw new Error("Could not read saved notes. The original value has been left unchanged.");
}
