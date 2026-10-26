import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { dismissInterruption, interruptionPrompt, keepInterruption, saveInterruption } from "../../state/parked";
import type { InterruptionPrompt } from "../../state/parked";
import { INTERRUPTION_TAGS } from "../../lib/parked";
import type { InterruptionTag } from "../../lib/parked";
import { setInterruptionPrompt } from "../../state/notes";
import "./InterruptionCapture.css";

/** Mounted once in the dashboard, including Home and Ambient; native mini controls route here too. */
export function InterruptionCapture() {
  const prompt = useSyncExternalStore(interruptionPrompt.subscribe, interruptionPrompt.get);
  return prompt ? <InterruptionForm key={prompt.id} prompt={prompt} /> : null;
}
function InterruptionForm({ prompt }: { prompt: InterruptionPrompt }) {
  const [tag, setTag] = useState<InterruptionTag>("Other");
  const [note, setNote] = useState("");
  const [seconds, setSeconds] = useState(8);
  const form = useRef<HTMLFormElement>(null);
  const previousFocus = useRef<Element | null>(null);
  useEffect(() => {
    previousFocus.current = document.activeElement;
    return () => {
      // Do not steal focus if the user moved on while the countdown was running.
      if ((document.activeElement === document.body || form.current?.contains(document.activeElement)) && previousFocus.current instanceof HTMLElement && previousFocus.current.isConnected) previousFocus.current.focus();
    };
  }, []);
  useEffect(() => {
    if (prompt.expiresAt === null) return;
    const update = () => setSeconds(Math.max(0, Math.ceil((prompt.expiresAt! - Date.now()) / 1000)));
    update(); const interval = setInterval(update, 200); return () => clearInterval(interval);
  }, [prompt.expiresAt]);
  return <form ref={form} className="interruption-capture" aria-label="What interrupted you?" onSubmit={event => { event.preventDefault(); saveInterruption(prompt.id, tag, note); }} onKeyDown={event => {
    event.stopPropagation();
    if (event.key === "Escape") { event.preventDefault(); dismissInterruption(prompt.id); }
  }}>
    <div className="row"><h3>What interrupted you?</h3><button className="btn small" type="button" onClick={() => dismissInterruption(prompt.id)}>Dismiss</button></div>
    <div className="interruption-tags" role="group" aria-label="Interruption type">{INTERRUPTION_TAGS.map(value => <button className="btn small" type="button" key={value} aria-pressed={tag === value} onClick={() => setTag(value)}>{value}</button>)}</div>
    <label className="small">Note (optional)<textarea className="input" value={note} maxLength={500} rows={2} onChange={event => setNote(event.target.value)} /></label>
    <div className="row"><span className="faint small">{note.length}/500</span>{prompt.expiresAt !== null && <><span className="muted small">Closes in {seconds}s</span><button className="btn small" type="button" onClick={() => keepInterruption(prompt.id)}>Keep</button></>}<button className="btn primary small" type="submit">Save interruption</button></div>
    <label className="small interruption-setting"><input type="checkbox" checked onChange={() => setInterruptionPrompt(false)} /> Ask when I pause focus</label>
  </form>;
}
