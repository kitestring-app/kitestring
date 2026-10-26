import { useState } from "react";
import { useStore } from "../lib/store";
import { clearDoneThoughts, deleteThought, finishThought, parked, taskThought } from "../state/parked";
import { Icon } from "./icons";
import { showDeleteUndo } from "./stats/DeleteUndo";
import "./ParkingLot.css";

/** Later hides an item for this review only; it remains open for the next review. */
export function ParkingLot({ history = false, review = false }: { history?: boolean; review?: boolean }) {
  const all = useStore(parked);
  const [showDone, setShowDone] = useState(false);
  const [later, setLater] = useState<string[]>([]);
  const open = all.filter(item => item.status === "open");
  const visible = all.filter(item => (item.status === "open" || showDone) && !later.includes(item.id));
  if (review && !open.length) return null;
  return (
    <section className="parking-lot" aria-label="Parking lot">
      <div className="row">
        <h3>{review ? (open.some(item => item.kind === "interruption") ? `Review ${open.length} parked ${open.length === 1 ? "item" : "items"}` : `You parked ${open.length} ${open.length === 1 ? "thought" : "thoughts"}`) : "Parking lot"}</h3>
        {history && <label className="small"><input type="checkbox" checked={showDone} onChange={e => setShowDone(e.target.checked)} /> Show done</label>}
      </div>
      {showDone && all.some(item => item.status !== "open") && <button type="button" className="btn small parked-clear" onClick={e => showDeleteUndo("Done items cleared.", clearDoneThoughts(), e.currentTarget.closest("dialog") ?? document.body)}>Clear done</button>}
      {!visible.length && <p className="muted small">{open.length ? "Set aside for later." : "Nothing waiting."}</p>}
      <ul className="parked-list" tabIndex={visible.length ? 0 : undefined} aria-label="Parked thoughts">
        {visible.map(item => <li key={item.id}>
          {item.kind === "interruption" && <div className="muted small">Interruption · {item.tag} · <time dateTime={new Date(item.at).toISOString()}>{new Date(item.at).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</time></div>}
          <p>{item.text}</p>
          <div className="row parked-actions">
            {item.status === "open" ? <>
              <button className="btn small" onClick={() => taskThought(item.id)}>Make it a task</button>
              <button className="btn small" onClick={() => finishThought(item.id)}>Done</button>
              <button className="btn small" onClick={() => setLater(ids => [...ids, item.id])}>Later</button>
            </> : <span className="muted small">{item.status === "tasked" ? "Made into a task" : "Done"}</span>}
            <button type="button" className="iconbtn parked-delete" aria-label="Delete" title="Delete" onClick={e => showDeleteUndo("Item deleted.", deleteThought(item.id), e.currentTarget.closest("dialog") ?? document.body)}><Icon.trash /></button>
          </div>
        </li>)}
      </ul>
    </section>
  );
}
