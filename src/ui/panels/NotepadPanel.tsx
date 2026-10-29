import { useStore } from "../../lib/store";
import { notes, setNotesText, setInterruptionPrompt } from "../../state/notes";
import { Recall } from "../notepad/Recall";
import { NotesEditor } from "../notepad/NotesEditor";
import { noteCounts } from "../notepad/markdown";
import "./NotepadPanel.css";
import { Icon } from "../icons";
import { settings } from "../../state/settings";

import { ParkingLot } from "../ParkingLot";

export { notes } from "../../state/notes";

export function NotepadPanel({ onClose, recallRequested = 0 }: { onClose: () => void; recallRequested?: number }) {
  const value = useStore(notes);
  const interruptionPrompt = useStore(settings, s => s.timer.interruptionPrompt);
  const { words, characters } = noteCounts(value);
  return (
    <aside className="panel" aria-label="Notepad">
      <div className="panel-head">
        <span className="badge"><Icon.note /></span>
        <h2>Notepad</h2>
        <span className="faint small" style={{ marginLeft: "auto" }}>{words} words · {characters} characters</span>
        <button className="iconbtn" style={{ width: 34, height: 34 }} onClick={onClose} aria-label="Close notepad · Escape"><Icon.close /></button>
      </div>
      <div className="panel-body">
        <Recall requested={recallRequested} />
        <NotesEditor text={value} onChange={setNotesText} />
        <label className="note-preference small"><input type="checkbox" checked={interruptionPrompt} onChange={e => setInterruptionPrompt(e.target.checked)} /> Ask what interrupted me when I pause focus</label>
        <ParkingLot history />
      </div>
    </aside>
  );
}
