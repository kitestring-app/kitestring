import { storageMode } from "../lib/db";
import { commitStoreEntries, storeReadFailed, createStore } from "../lib/store";
import { EMPTY_NOTES, NOTES_LIMIT, migrateNotes, notesInterruptionPreference } from "./notesModel";
import { migrateInterruptionPreference, settings, settingsUpdate } from "./settings";

let recoveredObject = false;
let preferenceMigration = Promise.resolve();
const store = createStore("notes", EMPTY_NOTES, value => {
  const text = migrateNotes(value);
  if (typeof value !== "string") {
    recoveredObject = true;
    preferenceMigration = migrateInterruptionPreference(notesInterruptionPreference(value));
  }
  return text;
});
export const notes = { ...store, ready: store.ready.then(async () => {
  await settings.ready;
  await preferenceMigration;
  // Replace temporary dev objects on disk even if the user never edits the text.
  if (recoveredObject) store.set(store.get());
}) };
export function setNotesText(text: string) { notes.set(text); }
export function setInterruptionPrompt(enabled: boolean) { settingsUpdate("timer", { interruptionPrompt: enabled }); }

/** Append to the current plain-text note, publishing only after the guarded save. */
export async function appendRecall(text: string): Promise<void> {
  await notes.ready;
  if (!text.trim()) throw new Error("Write something to save, or close without an answer.");
  if (storageMode() !== "indexeddb" || storeReadFailed("notes")) throw new Error("Storage is unavailable. Your explanation is kept here. Reload to retry.");
  const saved = await commitStoreEntries(() => {
    const current = notes.get();
    const next = `${current}${current ? "\n\n" : ""}## Explain from memory\n${text}`;
    if (next.length > NOTES_LIMIT) throw new Error("Notes is full. Your explanation is kept here. Make room in Notes and retry.");
    return [["notes", next]];
  });
  if (!saved) throw new Error("Notes changed while saving. Your explanation is kept here. Retry to append to the latest Notes.");
}
