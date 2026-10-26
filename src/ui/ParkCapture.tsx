import { useEffect, useRef, useState } from "react";
import { parkThought } from "../state/parked";
import { currentTask, tasks } from "../state/tasks";
import { timer } from "../state/timer";
import "./ParkingLot.css";

export function saveThought(text: string) {
  const state = timer.get();
  return parkThought(text, { segment: state.segment, segId: state.segId, taskId: state.taskId ?? currentTask(tasks.get())?.id });
}
export function ParkCapture({ open, onClose }: { open: boolean; onClose: () => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [text, setText] = useState("");
  const [saved, setSaved] = useState(false);
  useEffect(() => { if (open) { setText(""); setSaved(false); input.current?.focus(); } }, [open]);
  useEffect(() => {
    if (!saved) return;
    const timeout = setTimeout(() => setSaved(false), 1800);
    return () => clearTimeout(timeout);
  }, [saved]);
  return <div className="park-capture">
    {open && <form onSubmit={e => { e.preventDefault(); if (saveThought(text)) { setSaved(true); onClose(); } }}>
      <label className="sr-only" htmlFor="park-thought">Park a thought</label>
      <input ref={input} id="park-thought" className="input" value={text} maxLength={500} placeholder="Save it for later… Enter to park, Esc to close" onChange={e => setText(e.target.value)} onKeyDown={e => {
        e.stopPropagation();
        if (e.key === "Escape") { e.preventDefault(); onClose(); }
        if (e.key === "Enter" && e.nativeEvent.isComposing) e.preventDefault();
      }} />
    </form>}
    {saved && <span className="park-confirm muted small" role="status">Parked</span>}
  </div>;
}

export { InterruptionCapture } from "./notepad/InterruptionCapture";
