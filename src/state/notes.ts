import { createStore } from "../lib/store";
import { EMPTY_NOTES, migrateNotes, notesInterruptionPreference } from "./notesModel";
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
